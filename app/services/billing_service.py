"""Billing and subscription lifecycle service.
Manages plan tiers, locked FX rate orders, SePay VietQR payment processing, and cloud deployment retries.
"""
import time
import secrets
import logging
import asyncio
from typing import Dict, Any, Tuple, Optional
from urllib.parse import quote
from app.db import tx
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
from app.metaapi import MetaApiClient

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


def calculate_order_totals(
    plan_tier: str,
    cloud_slots: int = 1,
    cloud_slots_count: Optional[int] = None
) -> OrderTotals:
    """Calculate total USD, converted VND, and locked exchange rate."""
    if cloud_slots_count is not None:
        cloud_slots = cloud_slots_count

    tier_price = TIER_PRICES.get(plan_tier.lower(), TIER_STARTER_MONTHLY_USD)
    cloud_price = cloud_slots * CLOUD_SLOT_MONTHLY_USD
    total_usd = round(tier_price + cloud_price, 2)

    rate, _, _ = get_usd_vnd_rate()
    amount_vnd = convert_usd_to_vnd(total_usd, rate)
    return OrderTotals({
        "copy_trade_usd": tier_price,
        "cloud_bridge_usd": cloud_price,
        "total_usd": total_usd,
        "amount_vnd": amount_vnd,
        "locked_rate": rate,
    })


def create_checkout_order(
    user_id: str,
    plan_tier: str,
    cloud_slots: int = 1,
    cloud_slots_count: Optional[int] = None
) -> Dict[str, Any]:
    """Create a new payment order with locked FX rate valid for ORDER_LOCK_MINUTES."""
    if cloud_slots_count is not None:
        cloud_slots = cloud_slots_count

    total_usd, amount_vnd, locked_rate = calculate_order_totals(plan_tier, cloud_slots)
    now_ts = time.time()
    expires_at = now_ts + (ORDER_LOCK_MINUTES * 60)
    order_id = f"ord_{secrets.token_hex(6)}"
    content_memo = f"ZP {order_id[-6:].upper()}"

    with tx() as c:
        c.execute(
            """
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_gateway,
                created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 'SEPAY', ?, ?)
            """,
            (order_id, user_id, total_usd, locked_rate, amount_vnd, plan_tier.lower(), cloud_slots, now_ts, expires_at)
        )

    # Sepay VietQR generation (Configured account: VietinBank)
    bank_acc = SEPAY_ACCOUNT_NUMBER
    bank_name = SEPAY_BANK_NAME
    bank_holder = SEPAY_ACCOUNT_HOLDER
    encoded_memo = quote(content_memo)
    qr_url = f"https://qr.sepay.vn/img?acc={bank_acc}&bank={bank_name}&amount={amount_vnd}&des={encoded_memo}"

    return {
        "id": order_id,
        "order_id": order_id,
        "plan_tier": plan_tier.lower(),
        "cloud_slots_count": cloud_slots,
        "amount_usd": total_usd,
        "locked_exchange_rate": locked_rate,
        "amount_vnd": amount_vnd,
        "status": "PENDING",
        "qr_code_url": qr_url,
        "qr_url": qr_url,
        "account_number": bank_acc,
        "bank_name": bank_name,
        "account_holder": bank_holder,
        "payment_content": content_memo,
        "expires_at": expires_at,
        "created_at": now_ts,
    }


async def process_successful_payment(order_id: str, sepay_trans_id: str) -> bool:
    """Process paid webhook from SePay: activate subscription, extend cloud slots, and deploy MetaApi."""
    now_ts = time.time()
    order = None

    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            # Check by payment memo if order_id was a suffix
            row = c.execute("SELECT * FROM orders WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1", (f"%{order_id}%",)).fetchone()
        if not row:
            logger.error(f"Order {order_id} not found for SePay fulfillment.")
            return False

        order = dict(row)
        if order["status"] == "PAID":
            logger.info(f"Order {order['id']} is already fulfilled.")
            return True

        # Mark Order PAID
        c.execute(
            "UPDATE orders SET status = 'PAID', sepay_transaction_id = ?, paid_at = ? WHERE id = ?",
            (sepay_trans_id, now_ts, order["id"])
        )

        user_id = order["user_id"]
        tier = order["plan_tier"].lower()
        cloud_slots = order["cloud_slots_count"]
        duration_sec = 30 * 86400  # 30 days

        # 1. Update or create subscription
        sub = c.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        current_sub_exp = float(sub["service_expires_at"] or 0) if sub and sub["service_expires_at"] else 0.0
        new_sub_exp = max(current_sub_exp, now_ts) + duration_sec

        is_growth = tier in ("growth", "alpha")
        is_alpha = tier == "alpha"
        max_accounts = TIER_MAX_ACCOUNTS.get(tier, 1)

        sub_id = sub["id"] if sub else f"sub_{secrets.token_hex(6)}"
        if sub:
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

        # 2. Update cloud_expires_at on user's trading_accounts
        acc_rows = c.execute("SELECT id, metaapi_account_id, cloud_expires_at FROM trading_accounts WHERE user_id = ? LIMIT ?", (user_id, cloud_slots)).fetchall()
        accounts_to_deploy = []
        for a in acc_rows:
            curr_c_exp = float(a["cloud_expires_at"] or 0) if a["cloud_expires_at"] else 0.0
            new_c_exp = max(curr_c_exp, now_ts) + duration_sec
            c.execute("UPDATE trading_accounts SET cloud_expires_at = ?, deployment_state = 'DEPLOYED' WHERE id = ?", (new_c_exp, a["id"]))
            if a["metaapi_account_id"]:
                accounts_to_deploy.append(a["metaapi_account_id"])

    # 3. MetaApi Auto-Deploy with 3 retries (10s intervals)
    if accounts_to_deploy:
        asyncio.create_task(_deploy_with_retries(accounts_to_deploy))

    logger.info(f"Order {order['id']} fulfilled successfully for user {order['user_id']}.")
    return True


async def _deploy_with_retries(metaapi_ids: list, max_retries: int = 3, delay: int = 10):
    """Attempt deployment with backoff to accommodate MetaApi auto-recharge."""
    client = MetaApiClient()
    for meta_id in metaapi_ids:
        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"MetaApi deploy attempt {attempt}/{max_retries} for account {meta_id}...")
                await client.deploy_account(meta_id)
                logger.info(f"MetaApi account {meta_id} successfully deployed.")
                break
            except Exception as e:
                logger.warning(f"MetaApi deploy attempt {attempt} failed for {meta_id}: {e}")
                if attempt < max_retries:
                    await asyncio.sleep(delay)


def get_user_subscription(user_id: str) -> Dict[str, Any]:
    """Get active subscription and feature entitlement details for user."""
    now_ts = time.time()
    with tx() as c:
        sub = c.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        connected_count = c.execute("SELECT count(*) FROM trading_accounts WHERE user_id = ?", (user_id,)).fetchone()[0]

        if not sub:
            return {
                "plan_tier": "starter",
                "service_expires_at": None,
                "is_active": False,
                "max_mt5_accounts": 1,
                "allow_custom_multiplier": False,
                "allow_compounding": False,
                "allow_partial_tp_be": False,
                "allow_prop_firm_mode": False,
                "allow_alpha_strategies": False,
                "connected_accounts_count": connected_count,
            }

        s_dict = dict(sub)
        exp = s_dict.get("service_expires_at")
        is_active = bool(exp and exp > now_ts)

        return {
            "plan_tier": s_dict.get("plan_tier", "starter"),
            "service_expires_at": exp,
            "is_active": is_active,
            "max_mt5_accounts": int(s_dict.get("max_mt5_accounts", 1)),
            "allow_custom_multiplier": bool(s_dict.get("allow_custom_multiplier")),
            "allow_compounding": bool(s_dict.get("allow_compounding")),
            "allow_partial_tp_be": bool(s_dict.get("allow_partial_tp_be")),
            "allow_prop_firm_mode": bool(s_dict.get("allow_prop_firm_mode")),
            "allow_alpha_strategies": bool(s_dict.get("allow_alpha_strategies")),
            "connected_accounts_count": connected_count,
        }
