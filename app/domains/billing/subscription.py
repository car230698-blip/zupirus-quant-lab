"""Subscription Lifecycle Worker:
1. Sends automated renewal reminders 3 days and 1 day before expiry via Resend.
2. When expired: disables new entries (`auto_trade = 0`) and undeploys MetaApi Cloud
   terminals with no open positions, while preserving `EXPIRED_PROTECTING` state so
   `PositionWatcher` continues protecting open trades (BE 1R, TP1 50%, DD 4.5%) until closed.
3. Retries any `DEPLOY_PENDING` accounts whose initial Cloud deploy failed transiently.
"""
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
                sync_meta = {}
                try:
                    if hasattr(meta_client, "get_positions_verified"):
                        is_read_ok, open_positions, sync_meta = await meta_client.get_positions_verified(meta_id)
                    else:
                        open_positions = await meta_client.get_open_positions(meta_id) or []
                        is_read_ok = True
                except Exception as e:
                    logger.debug(f"Could not check positions before undeploy for {acc['id']}: {e}")
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

                has_blocking_items = bool(unverified_reqs) or bool(open_positions) or (not is_read_ok)
                is_24h_expired = (now - exp) >= 86400

                if has_blocking_items and not is_24h_expired:
                    with tx() as c:
                        c.execute(
                            "UPDATE trading_accounts SET deployment_state = 'EXPIRED_PROTECTING', auto_trade = 0 WHERE id = ?",
                            (acc["id"],),
                        )
                    stats["protecting_open"] += 1
                    continue

                if has_blocking_items and is_24h_expired:
                    logger.warning(
                        f"24H EXPIRED LIMIT: Undeploying account {acc['id']} after 24h expired protecting. "
                        f"Sending handover alert to user and admin."
                    )
                    try:
                        from app.core.mailer import send_admin_alert_email
                        send_admin_alert_email(
                            f"[ZUPIRUS] Bàn giao tài khoản hết hạn 24h: {acc['id']}",
                            f"Tài khoản {acc['id']} đã hết hạn > 24 giờ. Còn các mục chưa xác minh hoặc vị thế bot đang mở. "
                            f"Trạng thái kết nối: {'ĐỒNG BỘ' if is_read_ok else 'MẤT KẾT NỐI'}. Mốc xác minh gần nhất: {last_verified_ts}. "
                            f"Hệ thống đã thu hồi trạm và bàn giao cho khách hàng tự quản lý."
                        )
                    except Exception as he:
                        logger.debug(f"Handover email note: {he}")

                undeploy_ok = True
                try:
                    if meta_id:
                        undeploy_ok = bool(await meta_client.undeploy_account(meta_id))
                except Exception as e:
                    logger.debug(f"Undeploy error for expired account {acc['id']}: {e}")
                    undeploy_ok = False

                with tx() as c:
                    if undeploy_ok:
                        c.execute(
                            "UPDATE trading_accounts SET deployment_state = 'UNDEPLOYED', auto_trade = 0 WHERE id = ?",
                            (acc["id"],),
                        )
                        audit(c, "subscription_lifecycle", "expired_account_undeployed", {
                            "account_id": acc["id"], "user_id": user_id, "forced_24h": is_24h_expired
                        })
                        stats["undeployed_idle"] += 1
                    else:
                        c.execute(
                            "UPDATE trading_accounts SET deployment_state = 'EXPIRED_PROTECTING', auto_trade = 0 WHERE id = ?",
                            (acc["id"],),
                        )
                        stats["protecting_open"] += 1

    return stats
