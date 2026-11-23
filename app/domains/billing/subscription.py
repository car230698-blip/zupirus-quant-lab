"""Subscription Lifecycle Worker:
1. Sends automated renewal reminders 3 days and 1 day before expiry via Resend.
2. When expired: disables new entries (`auto_trade = 0`) and undeploys MetaApi Cloud
   terminals with no open positions, while preserving `EXPIRED_PROTECTING` state so
   `PositionWatcher` continues protecting open trades (BE 1R, TP1 50%, DD 4.5%) until closed.
3. Retries any `DEPLOY_PENDING` accounts whose initial Cloud deploy failed transiently.
"""
import asyncio
import logging
import sys
import time
from typing import Any, Dict, Optional

from app.db import tx, getkv, setkv, audit
from app.mailer import send_subscription_expiry_reminder
from app.metaapi import MetaApiClient

logger = logging.getLogger("zupirus.subscription_lifecycle")


def _get_reminder_sender():
    shim = sys.modules.get("app.services.subscription_lifecycle")
    if shim and hasattr(shim, "send_subscription_expiry_reminder"):
        return getattr(shim, "send_subscription_expiry_reminder")
    return send_subscription_expiry_reminder


async def run_subscription_lifecycle_cycle(
    now_ts: Optional[float] = None,
    client: Optional[MetaApiClient] = None,
    meta_client: Optional[MetaApiClient] = None,
) -> Dict[str, Any]:
    """Run one hourly subscription & Cloud lifecycle maintenance pass."""
    now = float(now_ts if now_ts is not None else time.time())
    meta_client = client or meta_client or MetaApiClient()
    stats = {
        "reminded_3d": 0,
        "reminded_1d": 0,
        "expired_suspended": 0,
        "undeployed_idle": 0,
        "protecting_open": 0,
        "pending_redeployed": 0,
    }

    with tx() as c:
        subs = c.execute(
            """
            SELECT s.id, s.user_id, s.plan_tier, s.service_expires_at, u.email
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            WHERE s.service_expires_at IS NOT NULL AND s.service_expires_at > 0
            """
        ).fetchall()
        sub_rows = [dict(r) for r in subs]

        pending_accs = c.execute(
            """
            SELECT id, user_id, metaapi_account_id
            FROM trading_accounts
            WHERE deployment_state = 'DEPLOY_PENDING' AND metaapi_account_id IS NOT NULL
            """
        ).fetchall()
        pending_list = [dict(r) for r in pending_accs]

    # 1. Retry any DEPLOY_PENDING accounts
    for acc in pending_list:
        try:
            if await meta_client.deploy_account(acc["metaapi_account_id"]):
                with tx() as c:
                    c.execute(
                        "UPDATE trading_accounts SET deployment_state = 'DEPLOYED' WHERE id = ?",
                        (acc["id"],),
                    )
                stats["pending_redeployed"] += 1
        except Exception as e:
            logger.debug(f"Pending redeploy retry failed for {acc['id']}: {e}")

    # 2. Process expiry reminders and expired subscriptions
    for sub in sub_rows:
        exp = float(sub["service_expires_at"])
        remaining = exp - now
        sub_id = sub["id"]
        user_id = sub["user_id"]
        email = sub.get("email")
        tier = str(sub.get("plan_tier") or "starter")

        # 3-day reminder window: (1 day, 3 days]
        if 86400 < remaining <= 3 * 86400 and email:
            kv_key = f"sub_reminded_3d:{sub_id}:{int(exp)}"
            with tx() as c:
                already = getkv(c, kv_key)
                if not already:
                    _get_reminder_sender()(email=email, plan_tier=tier, days_left=3, expires_at=exp)
                    setkv(c, kv_key, str(now))
                    stats["reminded_3d"] += 1

        # 1-day reminder window: (0, 1 day]
        elif 0 < remaining <= 86400 and email:
            kv_key = f"sub_reminded_1d:{sub_id}:{int(exp)}"
            with tx() as c:
                already = getkv(c, kv_key)
                if not already:
                    _get_reminder_sender()(email=email, plan_tier=tier, days_left=1, expires_at=exp)
                    setkv(c, kv_key, str(now))
                    stats["reminded_1d"] += 1

        # Expired subscription: suspend new entries (`auto_trade = 0`), undeploy idle terminals,
        # keep `EXPIRED_PROTECTING` on accounts with active open positions so PositionWatcher guards them.
        elif remaining <= 0:
            with tx() as c:
                acc_rows = c.execute(
                    """
                    SELECT id, metaapi_account_id, auto_trade, deployment_state
                    FROM trading_accounts
                    WHERE user_id = ?
                      AND (auto_trade = 1 OR COALESCE(deployment_state, 'DEPLOYED') != 'UNDEPLOYED')
                    """,
                    (user_id,),
                ).fetchall()
                accs = [dict(a) for a in acc_rows]
                if accs:
                    c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE user_id = ?", (user_id,))
                    stats["expired_suspended"] += len(accs)

            for acc in accs:
                meta_id = acc.get("metaapi_account_id")
                cur_state = str(acc.get("deployment_state") or "DEPLOYED").upper()
                if cur_state == "UNDEPLOYED":
                    continue
                if not meta_id:
                    with tx() as c:
                        c.execute("UPDATE trading_accounts SET deployment_state = 'UNDEPLOYED' WHERE id = ?", (acc["id"],))
                    stats["undeployed_idle"] += 1
                    continue

                is_read_ok = False
                open_positions = []
                open_orders = []
                sync_meta = {}
                try:
                    is_pos_ok = False
                    is_orders_ok = False
                    if hasattr(meta_client, "get_positions_verified"):
                        is_pos_ok, open_positions, sync_meta = await meta_client.get_positions_verified(meta_id)
                    else:
                        open_positions = await meta_client.get_open_positions(meta_id) or []
                        is_pos_ok = True

                    if hasattr(meta_client, "get_open_orders_verified"):
                        is_orders_ok, open_orders, _ = await meta_client.get_open_orders_verified(meta_id)
                    elif hasattr(meta_client, "get_open_orders"):
                        open_orders = await meta_client.get_open_orders(meta_id, raise_on_error=True)
                        is_orders_ok = True
                    else:
                        is_orders_ok = True

                    is_read_ok = is_pos_ok and is_orders_ok
                except Exception as e:
                    logger.debug(f"Could not check positions/orders before undeploy for {acc['id']}: {e}")
                    is_read_ok = False

                with tx() as c:
                    unverified_reqs = c.execute(
                        """
                        SELECT id, status, client_order_id, origin
                        FROM metaapi_trade_executions
                        WHERE account_id = ? AND (
                            status IN ('PENDING_SUBMIT', 'UNKNOWN_EXECUTION', 'AMBIGUOUS_LOCKED')
                            OR (origin = 'BOT' AND status IN ('OPEN', 'FILLED'))
                        )
                        """,
                        (acc["id"],)
                    ).fetchall()
                    last_ver_row = c.execute("SELECT last_verified_at FROM trading_accounts WHERE id = ?", (acc["id"],)).fetchone()
                    last_verified_ts = (last_ver_row[0] if last_ver_row and last_ver_row[0] else None) or 0

                if not is_read_ok:
                    with tx() as c:
                        c.execute(
                            "UPDATE trading_accounts SET deployment_state = 'EXPIRED_PROTECTING', auto_trade = 0 WHERE id = ?",
                            (acc["id"],),
                        )
                    stats["protecting_open"] += 1
                    logger.warning(f"EXPIRED ACCOUNT PROTECTED: Broker read unverified for {acc['id']} (is_read_ok=False). Keeping EXPIRED_PROTECTING.")
                    continue

                has_live_broker_items = bool(open_positions) or bool(open_orders) or (not is_read_ok)
                has_blocking_items = has_live_broker_items or bool(unverified_reqs)
                is_24h_expired = (now - exp) >= 86400

                # Never undeploy terminal while broker still has open positions, open orders, or unverified read state
                if has_live_broker_items or (bool(unverified_reqs) and not is_24h_expired):
                    with tx() as c:
                        c.execute(
                            "UPDATE trading_accounts SET deployment_state = 'EXPIRED_PROTECTING', auto_trade = 0 WHERE id = ?",
                            (acc["id"],),
                        )
                    stats["protecting_open"] += 1
                    if is_24h_expired and has_live_broker_items:
                        logger.warning(
                            f"EXPIRED ACCOUNT > 24H: Account {acc['id']} has live positions/orders or unverified read. "
                            f"Preserving EXPIRED_PROTECTING to keep risk watcher active until positions close."
                        )
                    continue

                # Re-verify latest expiration from DB right before undeploy to eliminate race with concurrent renewals
                with tx() as c:
                    fresh_sub = c.execute("SELECT service_expires_at FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
                    fresh_exp = float(fresh_sub[0] or 0) if fresh_sub and fresh_sub[0] else 0.0
                    fresh_acc = c.execute("SELECT cloud_expires_at FROM trading_accounts WHERE id = ?", (acc["id"],)).fetchone()
                    fresh_acc_exp = float(fresh_acc[0] or 0) if fresh_acc and fresh_acc[0] else 0.0

                if fresh_exp > now or fresh_acc_exp > now:
                    logger.info(f"Account {acc['id']} was renewed concurrently. Skipping undeploy.")
                    continue

                undeploy_ok = True
                try:
                    if meta_id:
                        undeploy_ok = bool(await meta_client.undeploy_account(meta_id))
                except Exception as e:
                    logger.debug(f"Undeploy error for expired account {acc['id']}: {e}")
                    undeploy_ok = False

                with tx() as c:
                    if undeploy_ok:
                        upd_res = c.execute(
                            """
                            UPDATE trading_accounts SET deployment_state = 'UNDEPLOYED', auto_trade = 0
                            WHERE id = ? AND (cloud_expires_at IS NULL OR cloud_expires_at <= ?)
                            """,
                            (acc["id"], now),
                        )
                        was_updated = getattr(upd_res, "rowcount", 0) > 0
                        if not was_updated:
                            logger.info(f"Account {acc['id']} was renewed during undeploy call! Setting DEPLOY_PENDING and triggering immediate re-deploy.")
                            c.execute("UPDATE trading_accounts SET deployment_state = 'DEPLOY_PENDING' WHERE id = ?", (acc["id"],))
                            if meta_id:
                                asyncio.create_task(meta_client.deploy_account(meta_id))
                            continue

                        audit(c, "subscription_lifecycle", "expired_account_undeployed", {
                            "account_id": acc["id"],
                            "user_id": user_id,
                            "forced_24h": is_24h_expired,
                            "is_read_ok": is_read_ok,
                            "synchronized": bool(sync_meta.get("synchronized", False)),
                            "open_positions_count": len(open_positions),
                            "open_orders_count": len(open_orders),
                            "unverified_count": len(unverified_reqs),
                            "last_verified_at": last_verified_ts,
                        })
                        stats["undeployed_idle"] += 1

                        if is_24h_expired and has_blocking_items:
                            logger.warning(
                                f"24H EXPIRED LIMIT: Account {acc['id']} undeployed after 24h expired protecting. "
                                f"Sending handover alert to user and admin."
                            )
                            try:
                                from app.core.mailer import send_admin_alert_email, send_email_template
                                u_row = c.execute("SELECT email, preferred_language FROM users WHERE id = ?", (user_id,)).fetchone()
                                user_email = None
                                user_lang = "vi"
                                if u_row:
                                    u_dict = dict(u_row) if hasattr(u_row, "keys") else {}
                                    if u_dict:
                                        user_email = u_dict.get("email")
                                        user_lang = u_dict.get("preferred_language", "vi") or "vi"
                                    else:
                                        user_email = u_row[0]
                                        user_lang = u_row[1] if len(u_row) > 1 and u_row[1] else "vi"
                                user_lang = str(user_lang).strip().lower()
                                unverified_cids = []
                                for ur in unverified_reqs:
                                    cid = None
                                    if isinstance(ur, dict):
                                        cid = ur.get("client_order_id")
                                    elif hasattr(ur, "keys"):
                                        cid = ur["client_order_id"] if "client_order_id" in ur.keys() else (ur[2] if len(ur) > 2 else None)
                                    elif len(ur) > 2:
                                        cid = ur[2]
                                    if cid:
                                        unverified_cids.append(str(cid))
                                sync_label = "ĐỒNG BỘ" if (is_read_ok and bool(sync_meta.get("synchronized", False))) else "MẤT KẾT NỐI"
                                unverified_str = ", ".join(unverified_cids) if unverified_cids else "Không có"
                                send_admin_alert_email(
                                    f"[ZUPIRUS] Bàn giao tài khoản hết hạn 24h: {acc['id']}",
                                    f"Tài khoản {acc['id']} (User: {user_email or user_id}) đã hết hạn > 24 giờ.\n"
                                    f"Trạng thái kết nối: {sync_label}.\n"
                                    f"Thời điểm xác minh gần nhất: {last_verified_ts}.\n"
                                    f"Danh sách mã lệnh chưa rõ (PENDING/UNKNOWN/AMBIGUOUS): {unverified_str}.\n"
                                    f"Vị thế mở trên sàn: {len(open_positions)}, Lệnh chờ: {len(open_orders)}.\n"
                                    f"Lưu ý: Không thể xác nhận SL/TP còn hiệu lực nếu kết nối chưa được xác minh.\n"
                                    f"Hệ thống đã thu hồi trạm sau 24h bảo vệ và bàn giao cho khách hàng tự quản lý."
                                )
                                if user_email:
                                    if user_lang == "en":
                                        sync_label_en = "SYNCHRONIZED" if (is_read_ok and bool(sync_meta.get("synchronized", False))) else "DISCONNECTED"
                                        unverified_str_en = ", ".join(unverified_cids) if unverified_cids else "None"
                                        send_email_template(
                                            to=user_email,
                                            subject="[ZUPIRUS] Handover Notice for Cloud MT5 Account After Protection Period",
                                            body_text=(
                                                f"Dear Trader,\n\n"
                                                f"Your ZUPIRUS Cloud MT5 instance for account {acc['id']} has expired over 24 hours ago.\n"
                                                f"Broker terminal connection state: {sync_label_en}.\n"
                                                f"Last verified broker timestamp: {last_verified_ts}.\n"
                                                f"Unverified client order IDs needing verification on MT5: {unverified_str_en}.\n\n"
                                                f"CRITICAL SAFETY NOTICE: Since the cloud station has been decommissioned, the system CANNOT guarantee Stop Loss (SL) or Take Profit (TP) orders remain active on the broker unless previously confirmed by the broker engine.\n"
                                                f"Please open your MetaTrader 5 (MT5) application on your mobile device or desktop immediately to audit and manage any remaining open positions and orders.\n\n"
                                                f"Best regards,\nZUPIRUS Quant Lab Engineering Team"
                                            )
                                        )
                                    else:
                                        send_email_template(
                                            to=user_email,
                                            subject="[ZUPIRUS] Bàn giao tài khoản Cloud MT5 sau thời gian bảo vệ",
                                            body_text=(
                                                f"Kính gửi Quý khách,\n\n"
                                                f"Gói dịch vụ ZUPIRUS Cloud MT5 cho tài khoản {acc['id']} đã hết hạn quá 24 giờ.\n"
                                                f"Trạng thái kết nối trạm với broker: {sync_label}.\n"
                                                f"Thời điểm xác minh broker gần nhất: {last_verified_ts}.\n"
                                                f"Mã lệnh cần kiểm tra lại trên MT5: {unverified_str}.\n\n"
                                                f"CẢNH BÁO AN TOÀN: Do trạm đã thu hồi, hệ thống KHÔNG THỂ đảm bảo các mức Cắt lỗ (SL) hoặc Chốt lời (TP) còn hiệu lực trên sàn nếu lệnh chưa được sàn xác nhận trước đó.\n"
                                                f"Quý khách vui lòng mở ứng dụng MetaTrader 5 (MT5) trực tiếp trên điện thoại hoặc máy tính để kiểm tra và xử lý các vị thế/lệnh chờ còn lại.\n\n"
                                                f"Trân trọng,\nĐội ngũ ZUPIRUS Quant Lab"
                                            )
                                        )
                            except Exception as he:
                                logger.debug(f"Handover email note: {he}")
                    else:
                        c.execute(
                            "UPDATE trading_accounts SET deployment_state = 'EXPIRED_PROTECTING', auto_trade = 0 WHERE id = ?",
                            (acc["id"],),
                        )
                        stats["protecting_open"] += 1

    return stats
