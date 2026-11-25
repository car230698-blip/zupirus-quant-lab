"""Admin Billing Settings, Bank & VietQR Configuration, Exchange Rate Management, and Subscription Grants."""
import os
import json
import time
import secrets
import logging
from typing import Optional
from urllib.parse import quote
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends

from app.db import tx
from app.routers.deps import get_current_admin, fail
from app.config import (
    SEPAY_BANK_NAME,
    SEPAY_ACCOUNT_NUMBER,
    SEPAY_ACCOUNT_HOLDER,
)
from app.services.fx_rate import get_usd_vnd_rate, REDIS_FX_KEY
from app.redis_client import get_redis_client

logger = logging.getLogger("zupirus.admin_billing")

router = APIRouter(tags=["Admin Billing & VietQR Settings"])

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


@router.get("/api/admin/billing/settings")
def get_billing_settings(_admin=Depends(get_current_admin)):
    """Retrieve active bank configuration, memo prefix, and USD/VND conversion mode."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
        saved = json.loads(row[0]) if row else {}

    bank_name = (saved.get("sepay_bank_name") or saved.get("bank_name") or SEPAY_BANK_NAME or "").strip()
    account_number = (saved.get("sepay_account_number") or saved.get("account_number") or SEPAY_ACCOUNT_NUMBER or "").strip()
    account_holder = (saved.get("sepay_account_holder") or saved.get("account_holder") or SEPAY_ACCOUNT_HOLDER or "").strip().upper()
    content_prefix = (saved.get("content_prefix") or "ZP").strip().upper()
    fx_mode = (saved.get("fx_mode") or "AUTO").strip().upper()
    manual_fx_rate = float(saved.get("fallback_usd_vnd_rate") or saved.get("manual_fx_rate") or 25600.0)

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

    bank_name = (req.sepay_bank_name or req.bank_name or existing.get("sepay_bank_name") or existing.get("bank_name") or SEPAY_BANK_NAME or "").strip()
    account_number = (req.sepay_account_number or req.account_number or existing.get("sepay_account_number") or existing.get("account_number") or SEPAY_ACCOUNT_NUMBER or "").strip()
    account_holder = (req.sepay_account_holder or req.account_holder or existing.get("sepay_account_holder") or existing.get("account_holder") or SEPAY_ACCOUNT_HOLDER or "").strip().upper()
    content_prefix = (req.content_prefix or existing.get("content_prefix") or "ZP").strip().upper()
    fx_mode = (req.fx_mode or existing.get("fx_mode") or "AUTO").strip().upper()

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


@router.put("/api/admin/billing/settings")
def put_billing_settings(req: FlexibleBillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save bank configuration and USD/VND exchange rate settings via PUT."""
    return _save_settings(req)


@router.post("/api/admin/billing/settings")
def update_billing_settings(req: FlexibleBillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save bank configuration and USD/VND exchange rate settings via POST."""
    return _save_settings(req)


@router.post("/api/admin/billing/preview-qr")
def generate_preview_qr(req: PreviewQRRequest, _admin=Depends(get_current_admin)):
    """Generate live preview URLs for SePay VietQR and fallback VietQR."""
    bank = req.bank_name or SEPAY_BANK_NAME
    acc = req.account_number or SEPAY_ACCOUNT_NUMBER
    holder = req.account_holder or SEPAY_ACCOUNT_HOLDER
    memo = req.content_memo
    if str(bank or "").lower() in ("vietinbank", "icb") and not memo.upper().startswith("SEVQR"):
        memo = f"SEVQR {memo}"
    encoded_memo = quote(memo)
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


@router.post("/api/admin/billing/flush-fx-cache")
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


@router.get("/api/admin/billing/summary")
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


@router.get("/api/admin/billing/orders")
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

            # 3 explicit provisioning milestone flags for Admin diagnostic triage
            st = str(d.get("status") or "").upper()
            is_paid = (st == "PAID" or d.get("paid_at") is not None)
            pay_st = str(d.get("payment_status") or "").upper()
            ent_st = str(d.get("entitlement_status") or "").upper()
            cld_st = str(d.get("cloud_deploy_status") or "").upper()

            d["payment_confirmed"] = is_paid or (pay_st in ("PAID", "CONFIRMED"))
            if ent_st in ("PENDING", "FAILED", "WAITING"):
                d["entitlement_applied"] = False
            else:
                d["entitlement_applied"] = (ent_st in ("APPLIED", "GRANTED")) or (is_paid and not ent_st)
            acc_cnt_row = c.execute("SELECT count(*) FROM trading_accounts WHERE user_id = ?", (d.get("user_id"),)).fetchone()
            user_acc_cnt = int(acc_cnt_row[0]) if acc_cnt_row else 0
            if cld_st == "DEPLOYED" and user_acc_cnt == 0:
                cld_st = "PENDING_LINK"
            d["cloud_ready"] = (cld_st == "DEPLOYED" and user_acc_cnt > 0)
            d["payment_status"] = "CONFIRMED" if d["payment_confirmed"] else (pay_st or st or "PENDING")
            d["entitlement_status"] = "APPLIED" if d["entitlement_applied"] else (ent_st or "PENDING")
            d["cloud_deploy_status"] = "DEPLOYED" if d["cloud_ready"] else (cld_st or ("PENDING_LINK" if (d["entitlement_applied"] and user_acc_cnt == 0) else "PENDING"))

            orders_list.append(d)

    return {"total": total, "orders": orders_list}


@router.post("/api/admin/billing/grant-subscription")
def grant_subscription(req: GrantSubscriptionRequest, _admin=Depends(get_current_admin)):
    """Grant or extend cloud subscription manually for a customer."""
    target_ident = req.user_id.strip()
    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE id=? OR LOWER(email)=?", (target_ident, target_ident.lower())).fetchone()
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

        # Sync cloud_expires_at and reactivate up to effective_slots trading_accounts
        acc_rows = c.execute(
            "SELECT id FROM trading_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT ?",
            (uid, effective_slots),
        ).fetchall()
        for ar in acc_rows:
            c.execute(
                """
                UPDATE trading_accounts
                SET subscription_expires_at = ?,
                    cloud_expires_at = ?,
                    auto_trade = 1,
                    deployment_state = CASE WHEN metaapi_account_id IS NOT NULL THEN 'DEPLOYED' ELSE deployment_state END
                WHERE id = ?
                """,
                (new_exp, new_exp, ar[0]),
            )

    return {
        "success": True,
        "message": f"Đã cấp thành công gói {req.plan_tier.upper()} ({effective_slots} trạm MT5) cho {user_row['email']} trong {effective_days} ngày.",
        "user_id": uid,
        "email": user_row["email"],
        "plan_tier": tier,
        "slots": effective_slots,
        "expires_at": new_exp,
    }


@router.post("/api/admin/billing/orders/{order_id}/approve")
async def admin_manual_approve_order(order_id: str, _admin=Depends(get_current_admin)):
    """Admin manual override to approve an order and activate/recover its subscription entitlements or cloud deploy."""
    from app.services.billing_service import process_successful_payment, fulfill_order_entitlements, retry_order_cloud_deployment
    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            fail(404, f"Không tìm thấy đơn hàng {order_id}")
        order = dict(row)

    if order.get("status") == "PAID":
        ent_st = str(order.get("entitlement_status") or "").upper()
        dep_st = str(order.get("cloud_deploy_status") or "").upper()
        if ent_st not in ("GRANTED", "APPLIED"):
            recovered = await fulfill_order_entitlements(order_id)
            if not recovered:
                fail(400, f"Không thể cấp bù quyền cho đơn hàng {order_id}.")
            return {
                "status": "ENTITLEMENTS_RECOVERED",
                "message": f"Đã cấp bù quyền gói cước và kích hoạt Cloud cho đơn hàng {order_id}.",
            }
        if dep_st in ("FAILED", "PENDING", "DEPLOY_PENDING", ""):
            retry_res = await retry_order_cloud_deployment(order_id)
            return {
                "status": retry_res.get("status", "CLOUD_DEPLOY_FAILED"),
                "ok": bool(retry_res.get("ok")),
                "message": retry_res.get("message"),
            }
        return {"status": "ALREADY_PAID", "message": f"Đơn hàng {order_id} đã được thanh toán và cấp quyền đầy đủ trước đó."}

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


# ----------------------------------------------------------------------
# Payment Transactions & Manual Bank Reconciliations
# ----------------------------------------------------------------------

class ManualPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)
    amount_vnd: float = Field(gt=0)
    gateway: str = Field(default='MANUAL_BANK', max_length=50)
    reference_code: str = Field(min_length=1, max_length=100)
    note: Optional[str] = Field(default='Duyệt thanh toán thủ công bởi Admin', max_length=255)


class LinkPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)


@router.get('/api/admin/billing/payments')
@router.get('/api/admin/payments')
def list_payments(u=Depends(get_current_admin)):
    """Returns recent SePay banking transactions and total revenue summary."""
    with tx() as c:
        rows = c.execute("""
            SELECT p.*, u.email as user_email
            FROM payment_transactions p
            LEFT JOIN users u ON u.id = p.user_id
            ORDER BY p.created_at DESC LIMIT 50
        """).fetchall()

        # Issue 9 Fix: Segregate VND and USDT revenue correctly
        total_vnd_row = c.execute("SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE status IN ('completed', 'manual_approved') AND UPPER(currency) = 'VND'").fetchone()
        total_vnd = float(total_vnd_row[0] if total_vnd_row else 0.0)

        total_usdt_row = c.execute("SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE status IN ('completed', 'manual_approved') AND UPPER(currency) IN ('USDT', 'USD')").fetchone()
        total_usdt = float(total_usdt_row[0] if total_usdt_row else 0.0)

    return {
        "total_revenue_vnd": total_vnd,
        "total_revenue_usdt": total_usdt,
        "revenue_by_currency": {
            "VND": total_vnd,
            "USDT": total_usdt
        },
        "total_transactions": len(rows),
        "transactions": [dict(r) for r in rows]
    }


@router.post('/api/admin/billing/payments/manual-approve')
@router.post('/api/admin/payments/manual-approve')
def admin_manual_approve_payment(p: ManualPaymentPayload, u=Depends(get_current_admin)):
    """Manually approves and records a payment transaction, crediting the customer and sending an official email receipt."""
    from app.sepay import build_payment_success_email
    from app.mailer import send_resend_email
    from app.db import audit
    email_clean = p.user_email.strip().lower()
    tx_id = f"manual_{secrets.token_hex(8)}"
    now_ts = time.time()

    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        user_id = user_row['id'] if user_row else None

        c.execute("""
            INSERT INTO payment_transactions(id, sepay_id, user_id, amount, currency, gateway, content, reference_code, status, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
        """, (
            tx_id,
            f"MANUAL-{int(now_ts)}-{secrets.randbelow(10000)}",
            user_id,
            p.amount_vnd,
            'VND',
            p.gateway,
            f"DUYỆT THỦ CÔNG: {p.note}",
            p.reference_code,
            'manual_approved',
            now_ts
        ))
        audit(c, u['id'], 'manual_payment_approved', {
            'tx_id': tx_id,
            'user_email': email_clean,
            'user_id': user_id,
            'amount': p.amount_vnd,
            'ref': p.reference_code
        })

    try:
        email_html = build_payment_success_email(
            user_email=email_clean,
            amount_vnd=p.amount_vnd,
            gateway=p.gateway,
            ref_code=p.reference_code,
            content=f"DUYỆT THỦ CÔNG: {p.note}"
        )
        send_resend_email(to=email_clean, subject="🎉 Xác nhận nạp tiền thành công (Duyệt thủ công) - ZUPIRUS Quant Lab", html=email_html)
    except Exception as e:
        logger.error("Failed to send manual receipt email: %s", e)

    return {
        "ok": True,
        "transaction_id": tx_id,
        "amount": p.amount_vnd,
        "user_email": email_clean,
        "message": f"Đã duyệt nạp thành công {p.amount_vnd:,.0f} VND cho tài khoản {email_clean}"
    }


@router.post('/api/admin/billing/payments/{tx_id}/link-user')
@router.post('/api/admin/payments/{tx_id}/link-user')
def admin_link_payment_user(tx_id: str, p: LinkPaymentPayload, u=Depends(get_current_admin)):
    """Links an unmatched incoming payment transaction to a specific customer account."""
    from app.db import audit
    email_clean = p.user_email.strip().lower()
    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        if not user_row:
            fail(404, "Không tìm thấy người dùng với email này")
        tx_row = c.execute("SELECT * FROM payment_transactions WHERE id=?", (tx_id,)).fetchone()
        if not tx_row:
            fail(404, "Không tìm thấy giao dịch thanh toán")
        c.execute("UPDATE payment_transactions SET user_id=? WHERE id=?", (user_row['id'], tx_id))
        audit(c, u['id'], 'payment_linked_user', {'tx_id': tx_id, 'user_id': user_row['id'], 'user_email': email_clean})

    return {"ok": True, "message": f"Đã liên kết giao dịch {tx_id} với tài khoản {email_clean}"}


class UpdateCryptoWalletsPayload(BaseModel):
    enabled: bool = True
    trc20_address: Optional[str] = None
    bep20_address: Optional[str] = None


@router.get('/api/v1/admin/billing/crypto-wallets')
@router.get('/api/admin/billing/crypto-wallets')
def admin_get_crypto_wallets(u=Depends(get_current_admin)):
    from app.domains.billing.crypto_direct import get_crypto_wallets_config
    return get_crypto_wallets_config()


@router.put('/api/v1/admin/billing/crypto-wallets')
@router.put('/api/admin/billing/crypto-wallets')
def admin_save_crypto_wallets(p: UpdateCryptoWalletsPayload, u=Depends(get_current_admin)):
    from app.domains.billing.crypto_direct import save_crypto_wallets_config
    try:
        updated = save_crypto_wallets_config(
            enabled=p.enabled,
            trc20_address=p.trc20_address,
            bep20_address=p.bep20_address,
            admin_id=u['id']
        )
        return updated
    except ValueError as err:
        fail(400, str(err))

