"""Admin Billing Settings, Bank & VietQR Configuration, Exchange Rate Management, and Subscription Grants."""
import os
import json
import time
import secrets
import logging
from typing import Optional, List, Dict, Any
from urllib.parse import quote
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException

from app.db import tx
from app.routers.deps import get_current_admin, fail
from app.config import (
    SEPAY_BANK_NAME,
    SEPAY_ACCOUNT_NUMBER,
    SEPAY_ACCOUNT_HOLDER,
    SEPAY_WEBHOOK_SECRET,
    CLOUD_SLOT_MONTHLY_USD,
)
from app.services.fx_rate import get_usd_vnd_rate, REDIS_FX_KEY
from app.redis_client import get_redis_client

logger = logging.getLogger("zupirus.admin_billing")

router = APIRouter(prefix="/api/admin/billing", tags=["Admin Billing & VietQR Settings"])

SUPPORTED_BANKS = [
    {"code": "ICB", "shortName": "VietinBank", "name": "Ngân hàng TMCP Công thương Việt Nam"},
    {"code": "MB", "shortName": "MBBank", "name": "Ngân hàng TMCP Quân đội"},
    {"code": "VCB", "shortName": "Vietcombank", "name": "Ngân hàng TMCP Ngoại thương Việt Nam"},
    {"code": "TCB", "shortName": "Techcombank", "name": "Ngân hàng TMCP Kỹ thương Việt Nam"},
    {"code": "ACB", "shortName": "ACB", "name": "Ngân hàng TMCP Á Châu"},
    {"code": "VPB", "shortName": "VPBank", "name": "Ngân hàng TMCP Việt Nam Thịnh Vượng"},
    {"code": "TPB", "shortName": "TPBank", "name": "Ngân hàng TMCP Tiên Phong"},
    {"code": "BIDV", "shortName": "BIDV", "name": "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam"},
    {"code": "STB", "shortName": "Sacombank", "name": "Ngân hàng TMCP Sài Gòn Thương Tín"},
    {"code": "HDB", "shortName": "HDBank", "name": "Ngân hàng TMCP Phát triển TP.HCM"},
]


class FlexibleBillingSettingsUpdate(BaseModel):
    sepay_bank_name: Optional[str] = None
    sepay_account_number: Optional[str] = None
    sepay_account_holder: Optional[str] = None
    sepay_webhook_secret: Optional[str] = None
    fallback_usd_vnd_rate: Optional[float] = None
    fx_rate_provider_url: Optional[str] = None
    fx_rate_cache_ttl_seconds: Optional[int] = None

    # Alternate naming conventions
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder: Optional[str] = None
    content_prefix: Optional[str] = None
    fx_mode: Optional[str] = None
    manual_fx_rate: Optional[float] = None


class PreviewQRRequest(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder: Optional[str] = None
    amount_vnd: int = Field(772000, gt=0)
    content_memo: str = Field("ZP TESTQR", min_length=2)


class GrantSubscriptionRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    plan_tier: str = Field("PRO")
    slots: Optional[int] = Field(default=None, ge=1, le=50)
    max_cloud_accounts: Optional[int] = Field(default=None, ge=1, le=50)
    days: Optional[int] = Field(default=None, ge=1, le=365)
    duration_days: Optional[int] = Field(default=None, ge=1, le=365)


@router.get("/settings")
def get_billing_settings(_admin=Depends(get_current_admin)):
    """Retrieve active bank configuration, memo prefix, and USD/VND conversion mode."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
        saved = json.loads(row[0]) if row else {}

    bank_name = saved.get("sepay_bank_name") or saved.get("bank_name", SEPAY_BANK_NAME)
    account_number = saved.get("sepay_account_number") or saved.get("account_number", SEPAY_ACCOUNT_NUMBER)
    account_holder = saved.get("sepay_account_holder") or saved.get("account_holder", SEPAY_ACCOUNT_HOLDER)
    content_prefix = saved.get("content_prefix", "ZP")
    fx_mode = saved.get("fx_mode", "AUTO")
    manual_fx_rate = float(saved.get("fallback_usd_vnd_rate") or saved.get("manual_fx_rate", 25600.0))

    raw_enc_sec = saved.get("sepay_webhook_secret_encrypted")
    secret = ""
    if raw_enc_sec:
        try:
            from app.security import decrypt_secret
            secret = decrypt_secret(raw_enc_sec)
        except Exception:
            secret = ""
    if not secret:
        secret = saved.get("sepay_webhook_secret") or os.getenv("SEPAY_WEBHOOK_SECRET") or ""
    masked_secret = f"{secret[:4]}***{secret[-3:]}" if len(secret) >= 7 else ("***" if secret else "CHƯA_CẤU_HÌNH")

    rate, source, is_cached = get_usd_vnd_rate()

    return {
        # Frontend AdminBillingSettingsTab format:
        "sepay_bank_name": bank_name,
        "sepay_account_number": account_number,
        "sepay_account_holder": account_holder,
        "sepay_webhook_secret_masked": masked_secret,
        "fallback_usd_vnd_rate": manual_fx_rate,
        "fx_rate_provider_url": saved.get("fx_rate_provider_url", "https://open.er-api.com/v6/latest/USD"),
        "fx_rate_cache_ttl_seconds": int(saved.get("fx_rate_cache_ttl_seconds", 1800)),
        "current_live_rate": rate,
        "current_rate_source": source,

        # Standard legacy format:
        "bank_name": bank_name,
        "account_number": account_number,
        "account_holder": account_holder,
        "content_prefix": content_prefix,
        "fx_mode": fx_mode,
        "manual_fx_rate": manual_fx_rate,
        "current_fx_rate": rate,
        "fx_source": source,
        "fx_is_cached": is_cached,
        "supported_banks": SUPPORTED_BANKS,
    }


def _save_settings(req: FlexibleBillingSettingsUpdate):
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
        existing = json.loads(row[0]) if row else {}

    bank_name = (req.sepay_bank_name or req.bank_name or existing.get("bank_name", SEPAY_BANK_NAME)).strip()
    account_number = (req.sepay_account_number or req.account_number or existing.get("account_number", SEPAY_ACCOUNT_NUMBER)).strip()
    account_holder = (req.sepay_account_holder or req.account_holder or existing.get("account_holder", SEPAY_ACCOUNT_HOLDER)).strip().upper()
    content_prefix = (req.content_prefix or existing.get("content_prefix", "ZP")).strip().upper()
    fx_mode = (req.fx_mode or existing.get("fx_mode", "AUTO")).strip().upper()

    rate_val = req.fallback_usd_vnd_rate if req.fallback_usd_vnd_rate is not None else req.manual_fx_rate
    if rate_val is None:
        rate_val = float(existing.get("manual_fx_rate", 25600.0))

    provider_url = req.fx_rate_provider_url or existing.get("fx_rate_provider_url", "https://open.er-api.com/v6/latest/USD")
    ttl = req.fx_rate_cache_ttl_seconds if req.fx_rate_cache_ttl_seconds is not None else int(existing.get("fx_rate_cache_ttl_seconds", 1800))

    payload = {
        "bank_name": bank_name,
        "sepay_bank_name": bank_name,
        "account_number": account_number,
        "sepay_account_number": account_number,
        "account_holder": account_holder,
        "sepay_account_holder": account_holder,
        "content_prefix": content_prefix,
        "fx_mode": fx_mode,
        "manual_fx_rate": rate_val,
        "fallback_usd_vnd_rate": rate_val,
        "fx_rate_provider_url": provider_url,
        "fx_rate_cache_ttl_seconds": ttl,
    }
    if req.sepay_webhook_secret:
        from app.security import encrypt_secret
        payload["sepay_webhook_secret_encrypted"] = encrypt_secret(req.sepay_webhook_secret.strip())
    elif "sepay_webhook_secret_encrypted" in existing:
        payload["sepay_webhook_secret_encrypted"] = existing["sepay_webhook_secret_encrypted"]
    elif "sepay_webhook_secret" in existing:
        from app.security import encrypt_secret
        payload["sepay_webhook_secret_encrypted"] = encrypt_secret(str(existing["sepay_webhook_secret"]).strip())

    with tx() as c:
        c.execute(
            """
            INSERT INTO kv (key, value) VALUES ('billing:settings', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (json.dumps(payload),)
        )

    # If manual rate or fallback updated, refresh Redis cache
    try:
        r = get_redis_client()
        if r and rate_val:
            r.set(REDIS_FX_KEY, str(rate_val), ex=86400 * 7)
    except Exception as e:
        logger.warning(f"Could not write FX rate to Redis: {e}")

    return {"message": "Cấu hình thanh toán SePay và tỷ giá đã được lưu thành công.", "settings": payload}


@router.put("/settings")
def put_billing_settings(req: FlexibleBillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save bank configuration and USD/VND exchange rate settings via PUT."""
    return _save_settings(req)


@router.post("/settings")
def update_billing_settings(req: FlexibleBillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save bank configuration and USD/VND exchange rate settings via POST."""
    return _save_settings(req)


@router.post("/preview-qr")
def generate_preview_qr(req: PreviewQRRequest, _admin=Depends(get_current_admin)):
    """Generate live preview URLs for SePay VietQR and fallback VietQR."""
    bank = req.bank_name or SEPAY_BANK_NAME
    acc = req.account_number or SEPAY_ACCOUNT_NUMBER
    holder = req.account_holder or SEPAY_ACCOUNT_HOLDER
    encoded_memo = quote(req.content_memo)
    encoded_holder = quote(holder)

    sepay_qr = f"https://qr.sepay.vn/img?acc={acc}&bank={bank}&amount={req.amount_vnd}&des={encoded_memo}"
    vietqr_qr = f"https://img.vietqr.io/image/{bank}-{acc}-compact2.png?amount={req.amount_vnd}&addInfo={encoded_memo}&accountName={encoded_holder}"

    return {
        "sepay_qr_url": sepay_qr,
        "vietqr_qr_url": vietqr_qr,
        "bank_name": bank,
        "account_number": acc,
        "account_holder": holder,
        "amount_vnd": req.amount_vnd,
        "content_memo": req.content_memo,
    }


@router.post("/flush-fx-cache")
def flush_fx_cache(_admin=Depends(get_current_admin)):
    """Flush the USD/VND exchange rate from Redis cache and refresh from live provider."""
    try:
        r = get_redis_client()
        if r:
            r.delete(REDIS_FX_KEY)
            r.delete(f"{REDIS_FX_KEY}:updated_at")
    except Exception as e:
        logger.warning(f"Could not delete Redis FX keys: {e}")

    rate, source, _ = get_usd_vnd_rate(force_refresh=True)
    return {"message": "Đã làm mới bộ nhớ đệm tỷ giá USD/VND thành công.", "new_rate": rate, "source": source}


@router.get("/summary")
def get_admin_billing_summary(_admin=Depends(get_current_admin)):
    """Summary metrics for AdminOrdersSubscriptionsTab Bento KPI cards."""
    now_ts = time.time()
    with tx() as c:
        try:
            stats = c.execute("""
                SELECT
                    count(*) as total_orders,
                    coalesce(sum(case when status='PAID' then amount_usd else 0 end), 0) as paid_usd,
                    coalesce(sum(case when status='PAID' then amount_vnd else 0 end), 0) as paid_vnd,
                    coalesce(sum(case when status='PENDING' then 1 else 0 end), 0) as pending_orders,
                    coalesce(sum(case when status='PAID' then 1 else 0 end), 0) as paid_orders
                FROM orders
            """).fetchone()
            ord_summary = {
                "total_orders": stats[0],
                "paid_revenue_usd": round(float(stats[1]), 2),
                "paid_revenue_vnd": int(stats[2]),
                "pending_orders": stats[3],
                "paid_orders": stats[4],
            }
        except Exception:
            ord_summary = {
                "total_orders": 0,
                "paid_revenue_usd": 0.0,
                "paid_revenue_vnd": 0,
                "pending_orders": 0,
                "paid_orders": 0,
            }

        try:
            sub_row = c.execute("""
                SELECT count(*), coalesce(sum(max_mt5_accounts), 0)
                FROM subscriptions
                WHERE service_expires_at IS NULL OR service_expires_at > ?
            """, (now_ts,)).fetchone()
            sub_summary = {
                "active_subs": sub_row[0],
                "allocated_slots": int(sub_row[1]),
            }
        except Exception:
            sub_summary = {"active_subs": 0, "allocated_slots": 0}

        try:
            cloud_row = c.execute("""
                SELECT count(*), coalesce(sum(case when deployment_state='DEPLOYED' THEN 1 ELSE 0 END), 0)
                FROM trading_accounts
            """).fetchone()
            cloud_summary = {
                "total_cloud": cloud_row[0],
                "deployed_count": int(cloud_row[1]),
            }
        except Exception:
            cloud_summary = {"total_cloud": 0, "deployed_count": 0}

    return {
        "orders": ord_summary,
        "subscriptions": sub_summary,
        "cloud_accounts": cloud_summary,
    }


@router.get("/orders")
def get_admin_billing_orders(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    _admin=Depends(get_current_admin)
):
    """Retrieve orders with user email for AdminOrdersSubscriptionsTab."""
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with tx() as c:
        query = """
            SELECT o.*, u.email as user_email
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
        """
        params = []
        if status and status.upper() != "ALL":
            query += " WHERE o.status = ?"
            params.append(status.upper())
        query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = c.execute(query, tuple(params)).fetchall()

        count_sql = "SELECT count(*) FROM orders" + (" WHERE status = ?" if status and status.upper() != "ALL" else "")
        count_params = (status.upper(),) if status and status.upper() != "ALL" else ()
        total_row = c.execute(count_sql, count_params).fetchone()
        total = total_row[0] if total_row else len(rows)

        orders_list = []
        for r in rows:
            d = dict(r)
            d["order_code"] = d.get("id")
            d["cloud_accounts_count"] = d.get("cloud_slots_count", 1)
            cy_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_cycle:{d.get('id')}",)).fetchone()
            d["billing_cycle"] = str(cy_row[0]).upper() if cy_row and cy_row[0] else "MONTHLY"
            orders_list.append(d)

    return {"total": total, "orders": orders_list}


@router.post("/grant-subscription")
def grant_subscription(req: GrantSubscriptionRequest, _admin=Depends(get_current_admin)):
    """Grant or extend cloud subscription manually for a customer."""
    target_ident = req.user_id.strip()
    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE id=? OR email=?", (target_ident, target_ident)).fetchone()
        if not user_row:
            fail(404, f"Không tìm thấy người dùng có ID hoặc Email: '{target_ident}'.")

        uid = user_row["id"]
        raw_tier = req.plan_tier.lower().strip()
        tier_map = {
            "starter": "starter",
            "growth": "growth",
            "pro": "growth",
            "quant_pro": "growth",
            "alpha": "alpha",
            "institutional": "alpha",
            "vip": "alpha",
        }
        from app.services.billing_service import clamp_cloud_slots
        tier = tier_map.get(raw_tier, "starter")
        effective_slots = clamp_cloud_slots(tier, req.slots or req.max_cloud_accounts or 1)
        effective_days = req.days or req.duration_days or 30
        duration_sec = effective_days * 86400
        now_ts = time.time()

        sub = c.execute("SELECT * FROM subscriptions WHERE user_id = ?", (uid,)).fetchone()
        current_exp = float(sub["service_expires_at"] or 0) if sub and sub["service_expires_at"] else 0.0
        new_exp = max(current_exp, now_ts) + duration_sec

        is_growth = tier in ("growth", "alpha")
        is_alpha = tier == "alpha"

        if sub:
            c.execute("""
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
            """, (
                tier, new_exp, effective_slots,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_alpha else 0,
                1 if is_alpha else 0,
                now_ts, uid
            ))
        else:
            sub_id = f"sub_{secrets.token_hex(6)}"
            c.execute("""
                INSERT INTO subscriptions (
                    id, user_id, plan_tier, service_expires_at, max_mt5_accounts,
                    allow_custom_multiplier, allow_compounding, allow_partial_tp_be,
                    allow_prop_firm_mode, allow_alpha_strategies, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sub_id, uid, tier, new_exp, effective_slots,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_growth else 0,
                1 if is_alpha else 0,
                1 if is_alpha else 0,
                now_ts, now_ts
            ))

    return {
        "success": True,
        "message": f"Đã cấp thành công gói {req.plan_tier.upper()} ({effective_slots} trạm MT5) cho {user_row['email']} trong {effective_days} ngày.",
        "user_id": uid,
        "email": user_row["email"],
        "plan_tier": tier,
        "slots": effective_slots,
        "expires_at": new_exp,
    }


@router.post("/orders/{order_id}/approve")
async def admin_manual_approve_order(order_id: str, _admin=Depends(get_current_admin)):
    """Admin manual override to approve an order and activate its subscription."""
    from app.services.billing_service import process_successful_payment
    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            fail(404, f"Không tìm thấy đơn hàng {order_id}")
        order = dict(row)
        if order.get("status") == "PAID":
            return {"status": "ALREADY_PAID", "message": f"Đơn hàng {order_id} đã được thanh toán trước đó."}

    remaining_vnd = max(0.0, float(order.get("amount_vnd") or 0) - float(order.get("paid_amount_vnd") or 0))
    success = await process_successful_payment(
        order_id=order_id,
        sepay_trans_id=f"adm_{secrets.token_hex(6)}",
        amount_received_vnd=remaining_vnd,
        raw_payload={"approved_by_admin": _admin.get("email") if isinstance(_admin, dict) else "admin"}
    )
    if not success:
        fail(400, f"Không thể duyệt đơn hàng {order_id}.")
    return {"status": "SUCCESS", "message": f"Đã duyệt và kích hoạt đơn hàng {order_id} thành công."}
