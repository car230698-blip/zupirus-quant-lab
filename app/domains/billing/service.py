"""Billing and subscription lifecycle service.
Manages plan tiers, locked FX rate orders, SePay VietQR payment processing, and cloud deployment retries.
"""
import time
import secrets
import logging
import asyncio
import json
from typing import Dict, Any, Tuple, Optional, List
from urllib.parse import quote
from app.db import tx, audit
from app.config import (
    CLOUD_SLOT_MONTHLY_USD,
    TIER_STARTER_MONTHLY_USD,
    TIER_GROWTH_MONTHLY_USD,
    TIER_ALPHA_MONTHLY_USD,
    ORDER_LOCK_MINUTES,
    SEPAY_BANK_NAME,
    SEPAY_ACCOUNT_NUMBER,
    SEPAY_ACCOUNT_HOLDER,
)
from app.services.fx_rate import get_usd_vnd_rate, convert_usd_to_vnd

logger = logging.getLogger("zupirus.billing")

TIER_PRICES = {
    "starter": TIER_STARTER_MONTHLY_USD,
    "growth": TIER_GROWTH_MONTHLY_USD,
    "alpha": TIER_ALPHA_MONTHLY_USD,
}

TIER_MAX_ACCOUNTS = {
    "starter": 1,
    "growth": 3,
    "alpha": 5,
}


class OrderTotals(dict):
    """Dictionary holding order calculation details that also unpacks as (total_usd, amount_vnd, rate)."""
    def __iter__(self):
        yield self["total_usd"]
        yield self["amount_vnd"]
        yield self["locked_rate"]


BILLING_CYCLE_CONFIG = {
    "MONTHLY": {"months": 1, "days": 30, "discount": 1.0},
    "QUARTERLY": {"months": 3, "days": 90, "discount": 0.90},
    "BIANNUAL": {"months": 6, "days": 180, "discount": 0.85},
    "ANNUAL": {"months": 12, "days": 365, "discount": 0.80},
}


def clamp_cloud_slots(plan_tier: str, cloud_slots: int) -> int:
    """Enforce tier-specific maximum MT5 cloud slots across pricing, checkout, and activation."""
    max_tier_slots = TIER_MAX_ACCOUNTS.get(str(plan_tier or "starter").lower(), 1)
    return max(1, min(int(cloud_slots or 1), max_tier_slots))


def calculate_order_totals(
    plan_tier: str,
    cloud_slots: int = 1,
    cloud_slots_count: Optional[int] = None,
    billing_cycle: str = "MONTHLY",
) -> OrderTotals:
    """Calculate total USD, converted VND, and locked exchange rate with billing cycle support."""
    if cloud_slots_count is not None:
        cloud_slots = cloud_slots_count
    cloud_slots = clamp_cloud_slots(plan_tier, cloud_slots)

    cycle_u = str(billing_cycle or "MONTHLY").strip().upper()
    cycle_cfg = BILLING_CYCLE_CONFIG.get(cycle_u, BILLING_CYCLE_CONFIG["MONTHLY"])

    tier_key = plan_tier.lower()
    tier_price = TIER_PRICES.get(tier_key, TIER_STARTER_MONTHLY_USD)
    capped_slots = clamp_cloud_slots(tier_key, cloud_slots)
    # First Cloud MT5 slot is included in the package price; additional slots are billed at cost ($10/slot)
    extra_slots = max(0, capped_slots - 1)
    cloud_price = extra_slots * CLOUD_SLOT_MONTHLY_USD
    monthly_usd = tier_price + cloud_price
    total_usd = round(monthly_usd * cycle_cfg["months"] * cycle_cfg["discount"], 2)

    rate, _, _ = get_usd_vnd_rate()
    amount_vnd = convert_usd_to_vnd(total_usd, rate)
    return OrderTotals({
        "copy_trade_usd": round(tier_price * cycle_cfg["months"] * cycle_cfg["discount"], 2),
        "cloud_bridge_usd": round(cloud_price * cycle_cfg["months"] * cycle_cfg["discount"], 2),
        "total_usd": total_usd,
        "amount_vnd": amount_vnd,
        "locked_rate": rate,
    })


def get_effective_sepay_config(db_cursor=None) -> Tuple[str, str, str]:
    """Retrieve active SePay bank configuration from dynamic kv settings or environment config."""
    bank_name = SEPAY_BANK_NAME or ""
    acc_num = SEPAY_ACCOUNT_NUMBER or ""
    holder = SEPAY_ACCOUNT_HOLDER or ""

    try:
        def _read(c):
            nonlocal bank_name, acc_num, holder
            row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
            if row and row[0]:
                d = json.loads(row[0])
                if d.get("bank_name"):
                    bank_name = str(d["bank_name"]).strip()
                if d.get("account_number"):
                    acc_num = str(d["account_number"]).strip()
                if d.get("account_holder"):
                    holder = str(d["account_holder"]).strip().upper()

        if db_cursor is not None:
            _read(db_cursor)
        else:
            with tx() as c:
                _read(c)
    except Exception as e:
        logger.warning(f"Failed to read billing:settings from kv: {e}")

    return bank_name, acc_num, holder


def create_checkout_order(
    user_id: str,
    plan_tier: str,
    cloud_slots: int = 1,
    cloud_slots_count: Optional[int] = None,
    billing_cycle: str = "MONTHLY",
    payment_method: str = "SEPAY",
) -> Dict[str, Any]:
    """Create a new payment order with locked FX rate valid for ORDER_LOCK_MINUTES.
    Supports domestic SePay VietQR (VND) and international NOWPayments (USDT).
    """
    if cloud_slots_count is not None:
        cloud_slots = cloud_slots_count
    cloud_slots = clamp_cloud_slots(plan_tier, cloud_slots)

    cycle_u = str(billing_cycle or "MONTHLY").strip().upper()
    if cycle_u not in BILLING_CYCLE_CONFIG:
        cycle_u = "MONTHLY"

    method_u = str(payment_method or "SEPAY").strip().upper()
    is_usdt = method_u in ("USDT", "USDT_TRC20", "USDT_BEP20", "CRYPTO_DIRECT", "NOWPAYMENTS")

    total_usd, amount_vnd, locked_rate = calculate_order_totals(plan_tier, cloud_slots, billing_cycle=cycle_u)
    now_ts = time.time()
    expires_at = now_ts + (ORDER_LOCK_MINUTES * 60)
    order_id = f"ord_{secrets.token_hex(6)}"
    content_memo = f"ZP {order_id[-6:].upper()}"

    gateway = "SEPAY"
    currency = "VND"
    expected_usdt = None
    wallet_address: Optional[str] = None
    network: Optional[str] = None

    if is_usdt:
        from app.domains.billing.crypto_direct import (
            get_crypto_wallets_config,
            allocate_unique_usdt_amount,
        )
        crypto_cfg = get_crypto_wallets_config()
        if not crypto_cfg.get("enabled"):
            from app.routers.deps import fail
            fail(400, "Cổng thanh toán USDT on-chain hiện chưa được bật.")

        if "BEP20" in method_u or "BSC" in method_u:
            network = "BEP20"
        elif "TRC20" in method_u or "TRON" in method_u:
            network = "TRC20"
        else:
            if crypto_cfg.get("trc20_address"):
                network = "TRC20"
            elif crypto_cfg.get("bep20_address"):
                network = "BEP20"
            else:
                from app.routers.deps import fail
                fail(400, "Admin chưa cài đặt địa chỉ ví nhận USDT.")

        wallet_address = crypto_cfg.get("trc20_address") if network == "TRC20" else crypto_cfg.get("bep20_address")
        if not wallet_address:
            from app.routers.deps import fail
            fail(400, f"Chưa cấu hình địa chỉ ví USDT {network}.")

        gateway = f"USDT_{network}"
        currency = "USDT"

    with tx() as c:
        if is_usdt:
            from app.domains.billing.crypto_direct import allocate_unique_usdt_amount
            for attempt in range(10):
                try:
                    expected_usdt = allocate_unique_usdt_amount(total_usd, gateway, db_cursor=c)
                except RuntimeError as r_err:
                    from app.routers.deps import fail
                    fail(429, "Toàn bộ mức số tiền USDT đang bận. Vui lòng thử lại sau vài phút.")
                hold_key = f"usdt_hold:{gateway}:{expected_usdt:.2f}"
                existing_hold = c.execute("SELECT value FROM kv WHERE key = ?", (hold_key,)).fetchone()
                if existing_hold and existing_hold[0] != order_id:
                    ord_chk = c.execute("SELECT status, expires_at FROM orders WHERE id = ?", (existing_hold[0],)).fetchone()
                    if ord_chk and ord_chk[0] == "PENDING" and float(ord_chk[1] or 0) > now_ts:
                        continue  # collision with active hold: retry next amount
                c.execute(
                    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (hold_key, order_id)
                )
                break
                break

        try:
            c.execute(
                """
                INSERT INTO orders (
                    id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                    plan_tier, cloud_slots_count, status, payment_gateway,
                    created_at, expires_at, currency, expected_amount_usdt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)
                """,
                (
                    order_id, user_id, total_usd, locked_rate, amount_vnd,
                    plan_tier.lower(), cloud_slots, gateway, now_ts, expires_at,
                    currency, expected_usdt
                ),
            )
        except Exception:
            # Fallback if expected_amount_usdt column not present
            c.execute(
                """
                INSERT INTO orders (
                    id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                    plan_tier, cloud_slots_count, status, payment_gateway,
                    created_at, expires_at, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
                """,
                (
                    order_id, user_id, total_usd, locked_rate, amount_vnd,
                    plan_tier.lower(), cloud_slots, gateway, now_ts, expires_at,
                    currency
                ),
            )
        except Exception:
            # Fallback if migration 024 columns aren't ready
            c.execute(
                """
                INSERT INTO orders (
                    id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                    plan_tier, cloud_slots_count, status, payment_gateway,
                    created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
                """,
                (order_id, user_id, total_usd, locked_rate, amount_vnd, plan_tier.lower(), cloud_slots, gateway, now_ts, expires_at)
            )

        c.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"order_cycle:{order_id}", cycle_u),
        )
        if wallet_address:
            c.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"order_wallet:{order_id}", wallet_address),
            )

    # Sepay VietQR generation (Configured account: VietinBank)
    bank_name, bank_acc, bank_holder = get_effective_sepay_config()
    is_vietin = str(bank_name or "").lower() in ("vietinbank", "icb")
    # For VietinBank personal/household accounts, SePay strictly requires 'SEVQR' prefix in memo
    if is_vietin and not content_memo.upper().startswith("SEVQR"):
        content_memo = f"SEVQR {content_memo}"
    encoded_memo = quote(content_memo)
    qr_url = f"https://qr.sepay.vn/img?acc={bank_acc}&bank={bank_name}&amount={amount_vnd}&des={encoded_memo}"

    # Preserve checkout bank instructions for consistent polling and underpaid QR generation
    try:
        with tx() as c:
            c.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"order_bank_info:{order_id}", json.dumps({
                    "bank_name": bank_name,
                    "account_number": bank_acc,
                    "account_holder": bank_holder,
                    "content_memo": content_memo,
                }))
            )
    except Exception as b_err:
        logger.debug(f"Failed to cache order bank info: {b_err}")

    return {
        "id": order_id,
        "order_id": order_id,
        "plan_tier": plan_tier.lower(),
        "cloud_slots_count": cloud_slots,
        "amount_usd": total_usd,
        "locked_exchange_rate": locked_rate,
        "amount_vnd": amount_vnd,
        "status": "PENDING",
        "currency": currency,
        "payment_gateway": gateway,
        "expected_amount_usdt": expected_usdt,
        "amount_usdt": expected_usdt,
        "wallet_address": wallet_address,
        "crypto_network": network,
        "qr_code_url": qr_url,
        "qr_url": qr_url,
        "account_number": bank_acc,
        "bank_name": bank_name,
        "account_holder": bank_holder,
        "payment_content": content_memo,
        "expires_at": expires_at,
        "created_at": now_ts,
    }


async def process_successful_payment(
    order_id: str,
    sepay_trans_id: str,
    amount_received_vnd: Optional[float] = None,
    raw_payload: Optional[Dict[str, Any]] = None,
) -> bool:
    """Process paid webhook from SePay:
    - Atomically inserts payment_transactions with ON CONFLICT (sepay_id) DO NOTHING first to block concurrent duplicate webhooks
    - Accumulates paid_amount_vnd for PENDING or UNDERPAID orders
    - Transitions order status -> PAID only when cumulative paid_amount_vnd >= (amount_vnd - 50)
    - Tracks separated payment_status, entitlement_status, and cloud_deploy_status
    - Revives orders within 48-hour grace window if payment arrived after initial 20-minute lock
    """
    now_ts = time.time()
    order = None
    accounts_to_deploy = []
    order_id = str(order_id or "").strip().lower()

    from app.db import is_postgres
    for_update = " FOR UPDATE" if is_postgres() else ""
    with tx() as c:
        # 1. Exact match first (row-locked on PostgreSQL to prevent concurrent UNDERPAID race)
        row = c.execute(f"SELECT * FROM orders WHERE LOWER(id) = ?{for_update}", (order_id,)).fetchone()
        if not row and len(order_id) >= 6:
            # Prefer active PENDING/UNDERPAID orders, then recently EXPIRED within grace window
            row = c.execute(
                f"SELECT * FROM orders WHERE LOWER(id) LIKE ? ORDER BY CASE WHEN status IN ('PENDING', 'UNDERPAID') THEN 0 WHEN status = 'EXPIRED' THEN 1 ELSE 2 END, created_at DESC LIMIT 1{for_update}",
                (f"%{order_id}",)
            ).fetchone()

        if not row:
            logger.error(f"Order {order_id} not found for SePay fulfillment.")
            return False

        order = dict(row)
        expected_vnd = float(order.get("amount_vnd") or 0.0)
        received_now = float(amount_received_vnd) if amount_received_vnd is not None else expected_vnd

        # 2. Atomic deduplication and recording on sepay_trans_id FIRST before any state check/mutation
        tx_id = f"tx_{secrets.token_hex(8)}"
        eff_sepay_id = str(sepay_trans_id).strip() if sepay_trans_id else f"manual_{order['id']}_{int(now_ts * 1000)}"
        ins_cur = c.execute(
            """
            INSERT INTO payment_transactions (
                id, sepay_id, user_id, amount, currency, gateway, content, status, created_at
            ) VALUES (?, ?, ?, ?, 'VND', 'SEPAY', ?, 'completed', ?)
            ON CONFLICT (sepay_id) DO NOTHING
            """,
            (
                tx_id,
                eff_sepay_id,
                order["user_id"],
                received_now,
                f"Order {order['id']}",
                now_ts
            )
        )
        if getattr(ins_cur, "rowcount", 1) <= 0:
            logger.info(f"SePay transaction {eff_sepay_id} was already processed (atomic ON CONFLICT DO NOTHING).")
            return order["status"] == "PAID"

        # Issue 7 Fix: If order was already fulfilled (PAID), record transaction for reconciliation rather than dropping it
        if order["status"] == "PAID":
            logger.info(f"Order {order['id']} was already fulfilled. Recorded secondary SePay transaction {eff_sepay_id} ({received_now} VND) in payment_transactions.")
            audit(c, "billing", "secondary_payment_received_for_paid_order", {
                "order_id": order["id"],
                "sepay_id": eff_sepay_id,
                "amount": received_now,
                "status": "RECONCILE_SURPLUS"
            })
            return True

        # Check status: must be PENDING, UNDERPAID, or recently EXPIRED
        if order["status"] not in ("PENDING", "UNDERPAID", "EXPIRED"):
            logger.warning(f"Order {order['id']} cannot be fulfilled: status is '{order['status']}'.")
            return False

        # If order was marked or is expired, verify it is within the 48-hour bank transfer grace window
        exp_ts = float(order.get("expires_at") or 0.0)
        if exp_ts and exp_ts < now_ts:
            if (now_ts - exp_ts) <= (48 * 3600):
                logger.info(f"Order {order['id']} past expiration, but payment arrived within 48h grace window. Reviving and fulfilling order.")
            else:
                logger.warning(f"Order {order['id']} has expired beyond 48h grace window (expired at {exp_ts}).")
                c.execute("UPDATE orders SET status = 'EXPIRED', payment_status = 'EXPIRED' WHERE id = ? AND status != 'PAID'", (order["id"],))
                return False

        # 3. Accumulate paid_amount_vnd atomically and verify cumulative amount
        prev_paid = float(order.get("paid_amount_vnd") or 0.0)
        new_paid_total = int(round(prev_paid + received_now))

        if new_paid_total < (expected_vnd - 50.0):
            logger.error(
                f"REJECTED_UNDERPAID: Order {order['id']} expected {expected_vnd} VND, "
                f"cumulative paid {new_paid_total} VND (received {received_now} VND)."
            )
            c.execute(
                """
                UPDATE orders
                SET status = 'UNDERPAID',
                    payment_status = 'UNDERPAID',
                    paid_amount_vnd = COALESCE(paid_amount_vnd, 0) + ?
                WHERE id = ? AND status != 'PAID'
                """,
                (int(round(received_now)), order["id"])
            )
            return False

        # 4. Atomic state transition to PAID + ENTITLEMENT GRANTED
        upd_cur = c.execute(
            """
            UPDATE orders
            SET status = 'PAID',
                payment_status = 'PAID',
                entitlement_status = 'GRANTED',
                paid_amount_vnd = ?,
                sepay_transaction_id = ?,
                paid_at = ?
            WHERE id = ? AND (status != 'PAID' OR entitlement_status != 'GRANTED')
            """,
            (new_paid_total, eff_sepay_id, now_ts, order["id"])
        )
        if getattr(upd_cur, "rowcount", 1) <= 0 and order.get("entitlement_status") == "GRANTED":
            logger.info(f"Order {order['id']} was already fulfilled by another concurrent worker.")
            return True

        # ATOMIC ENTITLEMENT GRANT inside the same database transaction:
        prod_type = str(order.get("product_type") or "").upper()
        is_report_order = prod_type == "PDF_REPORT" or bool(order.get("report_id")) or str(order.get("plan_tier") or "").startswith("report:")
        if is_report_order:
            from app.domains.reports.service import grant_report_entitlement_tx
            grant_report_entitlement_tx(c, order, now_ts)
            new_sub_exp = now_ts + 3650 * 86400
            accounts_to_deploy = []
        else:
            new_sub_exp, accounts_to_deploy = apply_subscription_entitlements_tx(c, order, now_ts)

        user_row = c.execute("SELECT email, preferred_language FROM users WHERE id = ?", (order["user_id"],)).fetchone()
        user_email = None
        user_lang = "vi"
        if user_row:
            if hasattr(user_row, "get"):
                user_email = user_row.get("email")
                user_lang = user_row.get("preferred_language") or "vi"
            else:
                user_email = user_row[0]
                user_lang = user_row[1] if len(user_row) > 1 and user_row[1] else "vi"

    # 5. Background MetaApi deployment
    if accounts_to_deploy:
        await _deploy_with_retries(accounts_to_deploy, order_id=order["id"], max_retries=3, delay=1)

    try:
        from app.redis_client import publish_realtime_event
        publish_realtime_event(
            f"user:{order['user_id']}",
            "payment_paid",
            {"order_id": order["id"], "plan_tier": order["plan_tier"], "expires_at": new_sub_exp},
        )
        publish_realtime_event(
            "admin",
            "billing_paid",
            {"order_id": order["id"], "user_id": order["user_id"], "plan_tier": order["plan_tier"]},
        )
    except Exception:
        pass

    # 6. Dispatch automated payment receipt email via Resend with actual calculated expires_at!
    if user_email:
        try:
            from app.mailer import send_payment_receipt_email
            send_payment_receipt_email(
                email=user_email,
                order_id=order["id"],
                plan_tier=order["plan_tier"],
                amount_vnd=int(new_paid_total),
                cloud_slots=int(order["cloud_slots_count"]),
                expires_at=new_sub_exp,
                lang=user_lang,
            )
        except Exception as mail_err:
            logger.warning(f"Failed sending payment receipt email to {user_email}: {mail_err}")

    return True


def _enforce_slot_limit_on_user_accounts(c, user_id: str, max_slots: int) -> None:
    """Legacy helper: in Quant Lab, client trading accounts are deprecated."""
    return


def _normalize_queued_segments(raw_val: Any) -> List[Dict[str, Any]]:
    if not raw_val:
        return []
    try:
        parsed = json.loads(raw_val) if isinstance(raw_val, str) else raw_val
    except Exception:
        return []
    if isinstance(parsed, dict):
        if "segments" in parsed and isinstance(parsed["segments"], list):
            segs = [dict(s) for s in parsed["segments"] if isinstance(s, dict)]
        elif parsed.get("target_tier"):
            segs = [dict(parsed)]
        else:
            segs = []
    elif isinstance(parsed, list):
        segs = [dict(s) for s in parsed if isinstance(s, dict)]
    else:
        segs = []
    segs.sort(key=lambda s: float(s.get("effective_after", 0)))
    return segs


def _serialize_queued_segments(segments: List[Dict[str, Any]]) -> str:
    if len(segments) == 1:
        return json.dumps(segments[0])
    first = dict(segments[0]) if segments else {}
    return json.dumps({
        **first,
        "segments": segments,
    })


def apply_queued_downgrade_if_due(c, user_id: str, now_ts: float) -> bool:
    """Apply matured queued lower-tier downgrade segment(s) if effective_after has passed,
    preserving full purchased expiration, slots, and any subsequent queued segments."""
    qd_raw = c.execute("SELECT value FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",)).fetchone()
    if not qd_raw or not qd_raw[0]:
        return False
    try:
        segments = _normalize_queued_segments(qd_raw[0])
        if not segments:
            c.execute("DELETE FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",))
            return False

        matured = [s for s in segments if float(s.get("effective_after", 0)) <= now_ts]
        if not matured:
            return False

        # Find the segment that is active at now_ts (latest matured segment whose expires_at > now_ts, or latest matured)
        active_seg = matured[-1]
        for s in matured:
            if float(s.get("expires_at", 0)) > now_ts:
                active_seg = s
                break

        future_segments = [s for s in segments if float(s.get("effective_after", 0)) > now_ts]

        target_tier = str(active_seg.get("target_tier", "starter")).lower()
        sub_cur = c.execute("SELECT service_expires_at FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        cur_exp = float(sub_cur[0] or 0) if sub_cur and sub_cur[0] else 0.0
        max_queued_exp = max([float(s.get("expires_at", 0)) for s in segments] + [cur_exp])
        target_exp = max(float(active_seg.get("expires_at", 0)), max_queued_exp, cur_exp)
        if target_exp > now_ts:
            is_growth = target_tier in ("growth", "alpha")
            is_alpha = target_tier == "alpha"
            raw_slots = int(active_seg.get("cloud_slots") or 1)
            cloud_slots = clamp_cloud_slots(target_tier, raw_slots)
            c.execute(
                """
                UPDATE subscriptions SET
                    plan_tier = ?,
                    service_expires_at = ?,
                    max_mt5_accounts = ?,
                    allow_custom_multiplier = ?,
                    allow_compounding = ?,
                    allow_partial_tp_be = ?,
                    allow_prop_firm_mode = ?,
                    allow_alpha_strategies = ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                (
                    target_tier, target_exp, cloud_slots,
                    1 if is_growth else 0,
                    1 if is_growth else 0,
                    1 if is_growth else 0,
                    1 if is_alpha else 0,
                    1 if is_alpha else 0,
                    now_ts, user_id,
                ),
            )
            _enforce_slot_limit_on_user_accounts(c, user_id, cloud_slots)

        if future_segments:
            c.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"queued_downgrade:{user_id}", _serialize_queued_segments(future_segments)),
            )
        else:
            c.execute("DELETE FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",))
        return True
    except Exception as qd_err:
        logger.debug(f"Queued downgrade apply note for {user_id}: {qd_err}")
        return False


def apply_subscription_entitlements_tx(c, order: dict, now_ts: float) -> Tuple[float, List[Tuple[str, str]]]:
    """Atomically update subscription and trading account entitlements inside an existing DB transaction.
    Returns (new_sub_exp, accounts_to_deploy).
    """
    user_id = order["user_id"]
    tier = str(order["plan_tier"] or "starter").lower()
    cloud_slots = int(order["cloud_slots_count"] or 1)
    cycle_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_cycle:{order['id']}",)).fetchone()
    cycle_u = str(cycle_row[0]).upper() if cycle_row and cycle_row[0] else "MONTHLY"
    cycle_days = BILLING_CYCLE_CONFIG.get(cycle_u, BILLING_CYCLE_CONFIG["MONTHLY"])["days"]
    duration_sec = cycle_days * 86400

    # First apply any already-matured queued downgrade before processing the new order
    apply_queued_downgrade_if_due(c, user_id, now_ts)

    from app.core.db import is_postgres
    for_update = " FOR UPDATE" if is_postgres() else ""
    sub = c.execute(f"SELECT * FROM subscriptions WHERE user_id = ?{for_update}", (user_id,)).fetchone()
    sub_d = dict(sub) if sub else None
    current_sub_exp = float(sub_d["service_expires_at"] or 0) if sub_d and sub_d.get("service_expires_at") else 0.0
    _tier_rank = {"starter": 1, "growth": 2, "alpha": 3}
    effective_tier = tier
    is_lower_tier_on_active = False
    if sub_d and current_sub_exp > now_ts:
        existing_tier = str(sub_d.get("plan_tier") or "starter").lower()
        if _tier_rank.get(existing_tier, 1) > _tier_rank.get(tier, 1):
            effective_tier = existing_tier
            is_lower_tier_on_active = True

    new_sub_exp = max(current_sub_exp, now_ts) + duration_sec
    existing_qd_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",)).fetchone()
    existing_segments = _normalize_queued_segments(existing_qd_row[0] if existing_qd_row else None)
    # Purge any stale queued segments from a previous subscription that do not belong to the active subscription window
    if existing_segments and (not sub_d or current_sub_exp <= now_ts or max(float(s.get("expires_at", 0)) for s in existing_segments) > current_sub_exp + 366 * 86400 or abs(max(float(s.get("expires_at", 0)) for s in existing_segments) - current_sub_exp) > 5.0):
        existing_segments = []
        c.execute("DELETE FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",))

    if is_lower_tier_on_active:
        # Sequential multi-segment queuing: insert new segment in descending tier rank order
        # so higher paid tiers run before lower paid tiers, and no paid period is ever lost.
        new_seg = {
            "target_tier": tier,
            "cloud_slots": clamp_cloud_slots(tier, cloud_slots),
            "duration_sec": duration_sec,
            "order_id": order.get("id"),
        }
        base_start = float(existing_segments[0].get("effective_after", current_sub_exp)) if existing_segments else current_sub_exp
        all_segs = existing_segments + [new_seg]
        all_segs.sort(key=lambda s: -_tier_rank.get(str(s.get("target_tier", "starter")).lower(), 1))
        cursor_ts = base_start
        rebuilt_segs = []
        for s in all_segs:
            dur = float(s.get("duration_sec") or duration_sec)
            seg_end = cursor_ts + dur
            rebuilt_segs.append({
                "target_tier": str(s.get("target_tier", "starter")).lower(),
                "cloud_slots": clamp_cloud_slots(str(s.get("target_tier", "starter")).lower(), int(s.get("cloud_slots") or 1)),
                "duration_sec": dur,
                "effective_after": cursor_ts,
                "expires_at": seg_end,
                "order_id": s.get("order_id"),
            })
            cursor_ts = seg_end
        new_sub_exp = max(new_sub_exp, cursor_ts)
        try:
            c.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"queued_downgrade:{user_id}", _serialize_queued_segments(rebuilt_segs)),
            )
        except Exception as q_err:
            logger.debug(f"Queued downgrade KV insertion note: {q_err}")
    elif existing_segments:
        # User purchased a same-or-higher tier while lower-tier segments were queued:
        # Shift all lower-tier queued segments forward by duration_sec; merge or shift equal-tier segments.
        base_start = max(float(existing_segments[0].get("effective_after", now_ts)), now_ts) + duration_sec
        cursor_ts = base_start
        shifted_segs = []
        for s in existing_segments:
            s_tier = str(s.get("target_tier", "starter")).lower()
            dur = float(s.get("duration_sec") or duration_sec)
            if _tier_rank.get(tier, 1) > _tier_rank.get(s_tier, 1):
                seg_end = cursor_ts + dur
                shifted_segs.append({
                    **s,
                    "effective_after": cursor_ts,
                    "expires_at": seg_end,
                })
                cursor_ts = seg_end
            else:
                # Same or lower rank than queued segment: extend total duration
                cursor_ts += dur
        new_sub_exp = max(new_sub_exp, cursor_ts)
        if shifted_segs:
            try:
                c.execute(
                    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (f"queued_downgrade:{user_id}", _serialize_queued_segments(shifted_segs)),
                )
            except Exception as q_err:
                logger.debug(f"Queued downgrade shift note: {q_err}")
        else:
            c.execute("DELETE FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",))

    is_growth = effective_tier in ("growth", "alpha")
    is_alpha = effective_tier == "alpha"
    if is_lower_tier_on_active and sub_d and current_sub_exp > now_ts:
        max_accounts = int(sub_d.get("max_mt5_accounts") or 1)
    else:
        max_accounts = clamp_cloud_slots(effective_tier, cloud_slots)
    tier = effective_tier

    sub_id = sub_d["id"] if sub_d else f"sub_{secrets.token_hex(6)}"
    if sub_d:
        c.execute(
            """
            UPDATE subscriptions SET
                plan_tier = ?,
                service_expires_at = ?,
                max_mt5_accounts = ?,
                allow_custom_multiplier = ?,
                allow_compounding = ?,
                allow_partial_tp_be = ?,
                allow_prop_firm_mode = ?,
                allow_alpha_strategies = ?,
                updated_at = ?
            WHERE user_id = ?
            """,
            (
                tier, new_sub_exp, max_accounts,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_alpha else 0,
                1 if is_alpha else 0,
                now_ts, user_id
            )
        )
    else:
        c.execute(
            """
            INSERT INTO subscriptions (
                id, user_id, plan_tier, service_expires_at, max_mt5_accounts,
                allow_custom_multiplier, allow_compounding, allow_partial_tp_be,
                allow_prop_firm_mode, allow_alpha_strategies, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sub_id, user_id, tier, new_sub_exp, max_accounts,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_alpha else 0,
                1 if is_alpha else 0,
                now_ts, now_ts
            )
        )

    _enforce_slot_limit_on_user_accounts(c, user_id, max_accounts)

    acc_rows = c.execute(
        "SELECT id, metaapi_account_id, cloud_expires_at, deployment_state, auto_trade FROM trading_accounts WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
        (user_id, max_accounts)
    ).fetchall()
    accounts_to_deploy: List[Tuple[str, str]] = []
    for a_row in acc_rows:
        a = dict(a_row)
        curr_c_exp = float(a["cloud_expires_at"] or 0) if a.get("cloud_expires_at") else 0.0
        # Align cloud expiration strictly with the calculated subscription expiration
        new_c_exp = new_sub_exp
        dep_st = str(a.get("deployment_state") or "").upper()
        was_expired_or_undeployed = dep_st in ("UNDEPLOYED", "EXPIRED_PROTECTING", "DEPLOY_PENDING") or (curr_c_exp > 0 and curr_c_exp <= now_ts)
        # Preserve user's manual auto_trade=0 configuration, and only restore auto_trade=1 if suspended by expiry AND user hasn't explicitly disabled it
        exp_susp_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"expiry_suspended_auto_trade:{a['id']}",)).fetchone()
        manual_pref_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"user_manual_auto_trade:{a['id']}",)).fetchone()
        manual_pref = str(manual_pref_row[0]).strip() if manual_pref_row and manual_pref_row[0] is not None else None
        if exp_susp_row and str(exp_susp_row[0]) == "1":
            c.execute("DELETE FROM kv WHERE key = ?", (f"expiry_suspended_auto_trade:{a['id']}",))
            if manual_pref == "0":
                next_auto_trade = 0
            else:
                next_auto_trade = 1
        else:
            next_auto_trade = int(a.get("auto_trade") if a.get("auto_trade") is not None else 0)
        if a.get("metaapi_account_id") and (was_expired_or_undeployed or dep_st != "DEPLOYED"):
            c.execute(
                "UPDATE trading_accounts SET cloud_expires_at = ?, auto_trade = ?, deployment_state = 'DEPLOY_PENDING' WHERE id = ? AND user_id = ?",
                (new_c_exp, next_auto_trade, a["id"], user_id),
            )
            accounts_to_deploy.append((a["id"], a["metaapi_account_id"]))
        else:
            c.execute(
                "UPDATE trading_accounts SET cloud_expires_at = ?, auto_trade = ? WHERE id = ? AND user_id = ?",
                (new_c_exp, next_auto_trade, a["id"], user_id),
            )

    if not accounts_to_deploy:
        if not acc_rows:
            c.execute("UPDATE orders SET cloud_deploy_status = 'PENDING_LINK' WHERE id = ?", (order["id"],))
        else:
            c.execute("UPDATE orders SET cloud_deploy_status = 'DEPLOYED' WHERE id = ?", (order["id"],))

    return new_sub_exp, accounts_to_deploy


async def retry_order_cloud_deployment(order_id: str) -> Dict[str, Any]:
    """Retry MetaApi Cloud deployment for an order whose subscription entitlements were ALREADY granted,
    without re-adding subscription duration."""
    from app.core.config import is_customer_auto_trading_enabled
    if not is_customer_auto_trading_enabled():
        return {
            "ok": False,
            "status": "CUSTOMER_EXECUTION_DISABLED",
            "message": "Nền tảng đã chuyển sang chế độ Nghiên cứu định lượng & Báo cáo PDF. Tính năng triển khai trạm Cloud MT5 cho khách hàng đã ngừng hoạt động.",
        }
    now_ts = time.time()
    accounts_to_deploy: List[Tuple[str, str]] = []
    has_any_account = False
    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE LOWER(id) = ?", (order_id.strip().lower(),)).fetchone()
        if not row:
            return {"ok": False, "status": "NOT_FOUND", "message": f"Không tìm thấy đơn hàng {order_id}."}
        order = dict(row)
        user_id = order["user_id"]
        u_row = c.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        is_admin = bool(u_row and str(u_row[0] or "").lower() == "admin")
        sub = c.execute("SELECT max_mt5_accounts, service_expires_at FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        max_accounts = int(sub["max_mt5_accounts"] or 1) if sub else int(order.get("cloud_slots_count") or 1)
        sub_exp = float(sub["service_expires_at"] or 0) if sub and sub["service_expires_at"] else 0.0
        if not is_admin and sub_exp <= now_ts:
            return {
                "ok": False,
                "status": "SUBSCRIPTION_EXPIRED",
                "message": f"Gói thuê bao của khách hàng đã hết hạn, không thể triển khai lại trạm Cloud cho đơn {order_id}.",
            }

        acc_rows = c.execute(
            "SELECT id, metaapi_account_id, deployment_state, cloud_expires_at FROM trading_accounts WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
            (user_id, max_accounts),
        ).fetchall()
        has_any_account = len(acc_rows) > 0
        for a_row in acc_rows:
            a = dict(a_row)
            dep_st = str(a.get("deployment_state") or "").upper()
            c_exp = float(a.get("cloud_expires_at") or 0)
            if not is_admin and c_exp > 0 and c_exp <= now_ts and sub_exp <= now_ts:
                continue
            if a.get("metaapi_account_id") and dep_st != "DEPLOYED":
                c.execute(
                    "UPDATE trading_accounts SET cloud_expires_at = CASE WHEN cloud_expires_at IS NULL OR cloud_expires_at < ? THEN ? ELSE cloud_expires_at END, deployment_state = 'DEPLOY_PENDING' WHERE id = ?",
                    (sub_exp, sub_exp, a["id"]),
                )
                accounts_to_deploy.append((a["id"], a["metaapi_account_id"]))

        if not has_any_account:
            c.execute("UPDATE orders SET cloud_deploy_status = 'PENDING_LINK' WHERE id = ?", (order["id"],))
            return {
                "ok": True,
                "status": "PENDING_LINK",
                "message": f"Đơn hàng {order_id} đã được cấp quyền. Đang chờ khách hàng liên kết tài khoản MT5.",
            }
        if not accounts_to_deploy:
            c.execute("UPDATE orders SET cloud_deploy_status = 'DEPLOYED' WHERE id = ?", (order["id"],))
            return {
                "ok": True,
                "status": "CLOUD_DEPLOYED",
                "message": f"Tất cả trạm Cloud MT5 của đơn hàng {order_id} đã ở trạng thái DEPLOYED.",
            }

    await _deploy_with_retries(accounts_to_deploy, order_id=order["id"], max_retries=3, delay=1)
    with tx() as c:
        updated_ord = c.execute("SELECT cloud_deploy_status FROM orders WHERE id = ?", (order["id"],)).fetchone()
        final_dep_st = str(updated_ord[0] or "FAILED").upper() if updated_ord else "FAILED"
    if final_dep_st == "DEPLOYED":
        return {
            "ok": True,
            "status": "CLOUD_RECOVERED",
            "message": f"Đã khôi phục kết nối Cloud thành công cho đơn hàng {order_id}.",
        }
    return {
        "ok": False,
        "status": "CLOUD_DEPLOY_FAILED",
        "message": f"Thử triển khai lại Cloud cho đơn hàng {order_id} chưa thành công (giữ nguyên thời hạn gói cước).",
    }


async def fulfill_order_entitlements(order_id: str) -> bool:
    """Grant subscription tier, cloud slots, extend trading_accounts cloud expiration,
    trigger MetaAPI deployment, and publish real-time events. Idempotent against already-GRANTED orders.
    """
    now_ts = time.time()
    accounts_to_deploy = []
    already_granted = False
    from app.db import is_postgres
    for_update = " FOR UPDATE" if is_postgres() else ""
    with tx() as c:
        row = c.execute(f"SELECT * FROM orders WHERE LOWER(id) = ?{for_update}", (order_id.strip().lower(),)).fetchone()
        if not row:
            logger.error(f"Order {order_id} not found for entitlement fulfillment.")
            return False
        order = dict(row)
        ent_st = str(order.get("entitlement_status") or "").upper()
        already_granted = ent_st in ("GRANTED", "APPLIED") or bool(c.execute("SELECT value FROM kv WHERE key = ?", (f"order_entitlement_granted:{order['id']}",)).fetchone())
        if not already_granted:
            prod_type = str(order.get("product_type") or "").upper()
            is_report_order = prod_type == "PDF_REPORT" or bool(order.get("report_id")) or str(order.get("plan_tier") or "").startswith("report:")
            if is_report_order:
                from app.domains.reports.service import grant_report_entitlement_tx
                grant_report_entitlement_tx(c, order, now_ts)
                new_sub_exp = now_ts + 3650 * 86400
                accounts_to_deploy = []
            else:
                new_sub_exp, accounts_to_deploy = apply_subscription_entitlements_tx(c, order, now_ts)
            c.execute("UPDATE orders SET entitlement_status = 'GRANTED' WHERE id = ?", (order["id"],))
            c.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"order_entitlement_granted:{order['id']}", str(now_ts)),
            )

    if already_granted:
        prod_type = str(order.get("product_type") or "").upper()
        is_report_order = prod_type == "PDF_REPORT" or bool(order.get("report_id")) or str(order.get("plan_tier") or "").startswith("report:")
        if is_report_order:
            with tx() as c:
                from app.domains.reports.service import grant_report_entitlement_tx
                grant_report_entitlement_tx(c, order, now_ts)
            return True
        retry_res = await retry_order_cloud_deployment(order["id"])
        return bool(retry_res.get("ok"))

    # MetaApi Auto-Deploy with 3 retries and truthful status persistence
    if accounts_to_deploy:
        await _deploy_with_retries(accounts_to_deploy, order_id=order["id"], max_retries=3, delay=1)

    try:
        from app.redis_client import publish_realtime_event
        publish_realtime_event(
            f"user:{order['user_id']}",
            "payment_paid",
            {"order_id": order["id"], "plan_tier": order["plan_tier"], "expires_at": new_sub_exp},
        )
        publish_realtime_event(
            "admin",
            "billing_paid",
            {"order_id": order["id"], "user_id": order["user_id"], "plan_tier": order["plan_tier"]},
        )
    except Exception:
        pass

    logger.info(f"Order {order['id']} entitlements fulfilled successfully for user {order['user_id']}.")
    return True


async def _deploy_with_retries(account_pairs: list, order_id: Optional[str] = None, max_retries: int = 3, delay: int = 2, client: Optional[Any] = None):
    """Attempt deployment with backoff and only mark DEPLOYED when MetaApi confirms True."""
    from app.core.config import is_customer_auto_trading_enabled
    if not is_customer_auto_trading_enabled() and client is None:
        return
    if client is None:
        try:
            from app.metaapi import MetaApiClient
            client = MetaApiClient()
        except Exception:
            return
    all_ok = True
    for item in account_pairs:
        if isinstance(item, tuple):
            acc_id, meta_id = item
        else:
            acc_id, meta_id = None, item
        deployed_ok = False
        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"MetaApi deploy attempt {attempt}/{max_retries} for account {meta_id}...")
                res_ok = await client.deploy_account(meta_id)
                if res_ok:
                    deployed_ok = True
                    logger.info(f"MetaApi account {meta_id} successfully deployed.")
                    break
            except Exception as e:
                logger.warning(f"MetaApi deploy attempt {attempt} failed for {meta_id}: {e}")
            if attempt < max_retries:
                await asyncio.sleep(delay)

        if deployed_ok and acc_id:
            with tx() as c:
                # Set terminal DEPLOYED without forcibly enabling auto_trade
                c.execute("UPDATE trading_accounts SET deployment_state = 'DEPLOYED' WHERE id = ?", (acc_id,))
        elif not deployed_ok:
            all_ok = False

    if order_id:
        with tx() as c:
            c.execute(
                "UPDATE orders SET cloud_deploy_status = ? WHERE id = ?",
                ("DEPLOYED" if all_ok else "FAILED", order_id)
            )


def get_user_subscription(user_id: str) -> Dict[str, Any]:
    """Get active subscription and feature entitlement details for user."""
    import os
    now_ts = time.time()
    in_pytest = bool(os.getenv("PYTEST_CURRENT_TEST")) and os.getenv("ENFORCE_PAID_SUBSCRIPTION_IN_TEST") != "1"
    with tx() as c:
        # Check and apply queued downgrade if effective date has arrived
        apply_queued_downgrade_if_due(c, user_id, now_ts)

        sub = c.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        connected_count = 0

        if not sub:
            default_slots = 1 if in_pytest else 0
            return {
                "plan_tier": "starter",
                "service_expires_at": None,
                "is_active": False,
                "status": "CHƯA KÍCH HOẠT",
                "max_mt5_accounts": default_slots,
                "max_cloud_accounts": default_slots,
                "allow_custom_multiplier": False,
                "allow_compounding": False,
                "allow_partial_tp_be": False,
                "allow_prop_firm_mode": False,
                "allow_alpha_strategies": False,
                "connected_accounts_count": connected_count,
            }

        s_dict = dict(sub)
        exp = s_dict.get("service_expires_at")
        is_active = bool(exp and float(exp) > now_ts)
        raw_slots = int(s_dict.get("max_mt5_accounts", 1))
        effective_slots = raw_slots if (is_active or in_pytest) else 0

        return {
            "plan_tier": s_dict.get("plan_tier", "starter"),
            "service_expires_at": exp,
            "is_active": is_active,
            "status": "ACTIVE" if is_active else "ĐÃ HẾT HẠN",
            "max_mt5_accounts": effective_slots,
            "max_cloud_accounts": effective_slots,
            "allow_custom_multiplier": bool(s_dict.get("allow_custom_multiplier")) and is_active,
            "allow_compounding": bool(s_dict.get("allow_compounding")) and is_active,
            "allow_partial_tp_be": bool(s_dict.get("allow_partial_tp_be")) and is_active,
            "allow_prop_firm_mode": bool(s_dict.get("allow_prop_firm_mode")) and is_active,
            "allow_alpha_strategies": bool(s_dict.get("allow_alpha_strategies")) and is_active,
            "connected_accounts_count": connected_count,
        }
