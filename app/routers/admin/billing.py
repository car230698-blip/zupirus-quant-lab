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
    fallback_usd_vnd_rate: Optional[float] = None
    fx_rate_provider_url: Optional[str] = None
    fx_rate_cache_ttl_seconds: Optional[int] = None
    manual_fx_rate: Optional[float] = None
    # Compatibility optional fields (ignored)
    sepay_bank_name: Optional[str] = None
    sepay_account_number: Optional[str] = None
    sepay_account_holder: Optional[str] = None
    sepay_webhook_secret: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder: Optional[str] = None
    content_prefix: Optional[str] = None
    fx_mode: Optional[str] = None


class GrantSubscriptionRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    plan_tier: str = Field("PRO")
    slots: Optional[int] = Field(default=None, ge=1, le=50)
    max_cloud_accounts: Optional[int] = Field(default=None, ge=1, le=50)
    days: Optional[int] = Field(default=None, ge=1, le=365)
    duration_days: Optional[int] = Field(default=None, ge=1, le=365)


@router.get("/api/admin/billing/settings")
def get_billing_settings(_admin=Depends(get_current_admin)):
    """Retrieve USD/VND conversion rate and provider configuration."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
        saved = json.loads(row[0]) if row else {}

    manual_fx_rate = float(saved.get("fallback_usd_vnd_rate") or saved.get("manual_fx_rate") or 25600.0)
    rate, source, is_cached = get_usd_vnd_rate()

    return {
        "fallback_usd_vnd_rate": manual_fx_rate,
        "manual_fx_rate": manual_fx_rate,
        "fx_rate_provider_url": saved.get("fx_rate_provider_url", "https://open.er-api.com/v6/latest/USD"),
        "fx_rate_cache_ttl_seconds": int(saved.get("fx_rate_cache_ttl_seconds", 1800)),
        "current_live_rate": rate,
        "current_fx_rate": rate,
        "current_rate_source": source,
        "fx_source": source,
        "fx_is_cached": is_cached,
    }


def _save_settings(req: FlexibleBillingSettingsUpdate):
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
        existing = json.loads(row[0]) if row else {}

    rate_val = req.fallback_usd_vnd_rate if req.fallback_usd_vnd_rate is not None else req.manual_fx_rate
    if rate_val is None:
        rate_val = float(existing.get("manual_fx_rate", 25600.0))

    provider_url = req.fx_rate_provider_url or existing.get("fx_rate_provider_url", "https://open.er-api.com/v6/latest/USD")
    ttl = req.fx_rate_cache_ttl_seconds if req.fx_rate_cache_ttl_seconds is not None else int(existing.get("fx_rate_cache_ttl_seconds", 1800))

    payload = {
        "manual_fx_rate": rate_val,
        "fallback_usd_vnd_rate": rate_val,
        "fx_rate_provider_url": provider_url,
        "fx_rate_cache_ttl_seconds": ttl,
    }

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

    return {"message": "Cấu hình tỷ giá USD/VND đã được lưu thành công.", "settings": payload}


@router.put("/api/admin/billing/settings")
def put_billing_settings(req: FlexibleBillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save USD/VND exchange rate settings via PUT."""
    return _save_settings(req)


@router.post("/api/admin/billing/settings")
def update_billing_settings(req: FlexibleBillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save USD/VND exchange rate settings via POST."""
    return _save_settings(req)


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
                    coalesce(sum(case when status='PAID' and payment_status != 'FREE_TRIAL' and id not like 'trial_%' then amount_usd else 0 end), 0) as paid_usd,
                    coalesce(sum(case when status='PAID' and payment_status != 'FREE_TRIAL' and id not like 'trial_%' then amount_vnd else 0 end), 0) as paid_vnd,
                    coalesce(sum(case when status='PENDING' and payment_status != 'FREE_TRIAL' and id not like 'trial_%' then 1 else 0 end), 0) as pending_orders,
                    coalesce(sum(case when status='PAID' and payment_status != 'FREE_TRIAL' and id not like 'trial_%' then 1 else 0 end), 0) as paid_orders
                FROM orders
            """).fetchone()

            trial_cnt = 0
            try:
                t_row = c.execute("SELECT count(*) FROM report_entitlements WHERE is_trial = 1 AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?)", (now_ts,)).fetchone()
                trial_cnt = int(t_row[0]) if t_row else 0
            except Exception:
                pass

            ord_summary = {
                "total_orders": stats[0],
                "paid_revenue_usd": round(float(stats[1]), 2),
                "paid_revenue_vnd": int(stats[2]),
                "pending_orders": stats[3],
                "paid_orders": stats[4],
                "trial_licenses": trial_cnt,
            }
        except Exception:
            ord_summary = {
                "total_orders": 0,
                "paid_revenue_usd": 0.0,
                "paid_revenue_vnd": 0,
                "pending_orders": 0,
                "paid_orders": 0,
                "trial_licenses": 0,
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
    product_type: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    offset: Optional[int] = None,
    _admin=Depends(get_current_admin)
):
    """Retrieve orders with user email, server-side pagination, and flexible filtering."""
    limit = min(max(limit, 1), 200)
    page = max(page, 1)
    effective_offset = offset if offset is not None else (page - 1) * limit
    effective_offset = max(effective_offset, 0)

    with tx() as c:
        where_clauses = []
        params = []

        if status and status.upper() != "ALL":
            where_clauses.append("o.status = ?")
            params.append(status.upper())

        if product_type and product_type.upper() != "ALL":
            where_clauses.append("(UPPER(o.product_type) = ? OR UPPER(o.plan_tier) LIKE ?)")
            params.extend([product_type.upper(), f"%{product_type.lower()}%"])

        if search and search.strip():
            s_clean = f"%{search.strip().lower()}%"
            where_clauses.append("(LOWER(o.id) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(coalesce(o.tx_hash, '')) LIKE ?)")
            params.extend([s_clean, s_clean, s_clean])

        where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        count_sql = f"SELECT count(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id {where_sql}"
        total_row = c.execute(count_sql, tuple(params)).fetchone()
        total = total_row[0] if total_row else 0

        query = f"""
            SELECT o.*, u.email as user_email
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            {where_sql}
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
        """
        fetch_params = list(params) + [limit, effective_offset]
        rows = c.execute(query, tuple(fetch_params)).fetchall()

        orders_list = []
        for r in rows:
            d = dict(r)
            d["order_code"] = d.get("id")
            d["cloud_accounts_count"] = d.get("cloud_slots_count", 1)
            cy_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_cycle:{d.get('id')}",)).fetchone()
            d["billing_cycle"] = str(cy_row[0]).upper() if cy_row and cy_row[0] else "MONTHLY"

            st = str(d.get("status") or "").upper()
            is_paid = (st == "PAID" or d.get("paid_at") is not None)
            pay_st = str(d.get("payment_status") or "").upper()
            ent_st = str(d.get("entitlement_status") or "").upper()

            d["payment_confirmed"] = is_paid or (pay_st in ("PAID", "CONFIRMED"))
            d["entitlement_applied"] = (ent_st in ("APPLIED", "GRANTED")) or (is_paid and not ent_st)
            d["payment_status"] = "CONFIRMED" if d["payment_confirmed"] else (pay_st or st or "PENDING")
            d["entitlement_status"] = "APPLIED" if d["entitlement_applied"] else (ent_st or "PENDING")
            orders_list.append(d)

    return {"total": total, "page": page, "limit": limit, "orders": orders_list}


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


class ManualApproveOrderPayload(BaseModel):
    tx_hash: str = Field(min_length=8, max_length=128)


@router.post("/api/admin/billing/orders/{order_id}/approve")
async def admin_manual_approve_order(order_id: str, p: ManualApproveOrderPayload, _admin=Depends(get_current_admin)):
    """Admin manual override to approve a PDF_REPORT research order with an on-chain blockchain transaction hash."""
    from app.domains.reports.service import grant_report_entitlement_tx
    from app.db import audit

    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            fail(404, f"Không tìm thấy đơn hàng {order_id}")
        order = dict(row)

    if order.get("payment_status") == "FREE_TRIAL" or str(order.get("id") or "").startswith("trial_"):
        fail(400, "Đơn dùng thử không được duyệt như đơn trả tiền và không tính vào doanh thu.")

    p_type = str(order.get("product_type") or "PDF_REPORT").upper()
    if p_type != "PDF_REPORT" and not str(order.get("plan_tier") or "").startswith("report:"):
        fail(400, "Lệnh duyệt thủ công nghiên cứu chỉ mở cho sản phẩm PDF_REPORT.")

    clean_tx = p.tx_hash.strip()
    admin_id = _admin.get("id", "admin") if isinstance(_admin, dict) else "admin"
    now_ts = time.time()

    if order.get("status") == "PAID":
        with tx() as c:
            grant_report_entitlement_tx(c, order=order, is_trial=0)
        return {
            "status": "ALREADY_PAID",
            "ok": True,
            "message": f"Đơn hàng {order_id} đã được thanh toán và cấp quyền tải đầy đủ trước đó.",
        }

    with tx() as c:
        c.execute("""
            UPDATE orders SET
                status = 'PAID',
                payment_status = 'PAID',
                tx_hash = ?,
                paid_at = ?,
                entitlement_status = 'GRANTED'
            WHERE id = ?
        """, (clean_tx, now_ts, order_id))

        order_upd = dict(c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone())
        grant_report_entitlement_tx(c, order=order_upd, now_ts=now_ts, is_trial=0)

        audit(c, admin_id, 'admin_order_approved_manual', {
            'order_id': order_id,
            'tx_hash': clean_tx,
            'user_id': order.get('user_id'),
            'product_type': p_type,
        })

    return {
        "status": "SUCCESS",
        "ok": True,
        "message": f"Đã duyệt thủ công đơn hàng {order_id} thành công với tx_hash {clean_tx}.",
    }


# ----------------------------------------------------------------------
# Trial Licenses Management (Dedicated Evaluation Entitlements)
# ----------------------------------------------------------------------

class GrantTrialPayload(BaseModel):
    email: str = Field(min_length=3, max_length=150)
    report_id: str = Field(min_length=1)
    version: str = Field(default="v1.0")
    duration_days: int = Field(default=30, ge=1, le=365)
    notes: Optional[str] = Field(default=None)


class ExtendTrialPayload(BaseModel):
    extra_days: int = Field(default=30, ge=1, le=365)


class RevokeTrialPayload(BaseModel):
    reason: Optional[str] = Field(default=None)


class ChangeTrialEmailPayload(BaseModel):
    new_email: str = Field(min_length=3, max_length=150)


@router.get("/api/v1/admin/billing/trials")
@router.get("/api/admin/billing/trials")
def list_admin_trials(_admin=Depends(get_current_admin)):
    """List all active and expired trial evaluation licenses."""
    now_ts = time.time()
    with tx() as c:
        rows = c.execute("""
            SELECT re.*, u.email as user_email, r.title as report_title
            FROM report_entitlements re
            LEFT JOIN users u ON u.id = re.user_id
            LEFT JOIN research_reports r ON r.id = re.report_id
            WHERE re.is_trial = 1 OR re.order_id LIKE 'trial_%'
            ORDER BY re.granted_at DESC
        """).fetchall()

        trials_list = []
        for r in rows:
            d = dict(r)
            exp = float(d.get("expires_at") or 0.0)
            is_active = (d.get("status") == "ACTIVE") and (exp == 0.0 or exp > now_ts) and not d.get("revoked_at")
            d["is_active"] = is_active
            d["days_remaining"] = max(0, int((exp - now_ts) / 86400)) if exp > now_ts else 0
            trials_list.append(d)

    return {"total": len(trials_list), "trials": trials_list}


@router.post("/api/v1/admin/billing/trials/grant")
@router.post("/api/admin/billing/trials/grant")
def admin_grant_trial_license(p: GrantTrialPayload, _admin=Depends(get_current_admin)):
    """Grant new trial license to team/institutional evaluator under pilot agreement."""
    from app.domains.reports.service import grant_report_entitlement_tx
    from app.db import audit
    from app.security import password_hash

    email_clean = p.email.strip().lower()
    now_ts = time.time()
    trial_order_id = f"trial_{secrets.token_hex(6)}"
    exp_ts = now_ts + (p.duration_days * 86400)
    admin_id = _admin.get("id", "admin") if isinstance(_admin, dict) else "admin"

    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        if user_row:
            user_id = user_row["id"]
        else:
            user_id = f"usr_{secrets.token_hex(8)}"
            rand_pw = secrets.token_urlsafe(12)
            c.execute("INSERT INTO users (id, email, password, role) VALUES (?, ?, ?, 'customer')", (user_id, email_clean, password_hash(rand_pw)))

        from app.domains.reports.service import ensure_gold_research_suite_v1_seeded
        ensure_gold_research_suite_v1_seeded(c)

        rep_row = c.execute(
            "SELECT id, title, version FROM research_reports WHERE id=? OR slug=? OR id LIKE ? OR slug LIKE ?",
            (p.report_id, p.report_id, f"%{p.report_id}%", f"%{p.report_id}%")
        ).fetchone()
        if not rep_row:
            fail(404, f"Không tìm thấy ấn phẩm {p.report_id}")
        real_rep_id = str(rep_row[0])

        order_stub = {
            "id": trial_order_id,
            "user_id": user_id,
            "amount_usd": 0.0,
            "amount_vnd": 0,
            "status": "COMPLETED",
            "payment_status": "FREE_TRIAL",
            "entitlement_status": "GRANTED",
            "payment_gateway": "DIRECT_USDT",
            "created_at": now_ts,
            "expires_at": exp_ts,
            "paid_at": now_ts,
            "currency": "USDT",
            "product_type": "PDF_REPORT",
            "report_id": real_rep_id,
            "report_version": p.version or "v1.0",
            "plan_tier": f"report:{real_rep_id}",
            "notes": p.notes or "Institutional Trial License",
            "is_trial": 1,
        }

        c.execute("""
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_status, entitlement_status,
                payment_gateway, created_at, expires_at, paid_at,
                currency, expected_amount_usdt, product_type, report_id, report_version
            ) VALUES (?, ?, 0.0, 1.0, 0, ?, 1, 'COMPLETED', 'FREE_TRIAL', 'GRANTED', 'DIRECT_USDT', ?, ?, ?, 'USDT', 0.0, 'PDF_REPORT', ?, ?)
        """, (
            trial_order_id, user_id, f"report:{real_rep_id}", now_ts, exp_ts, now_ts, real_rep_id, p.version or "v1.0"
        ))

        ent = grant_report_entitlement_tx(c, order=order_stub, now_ts=now_ts, is_trial=1, expires_at=exp_ts)
        audit(c, admin_id, 'trial_license_granted', {
            'order_id': trial_order_id,
            'user_email': email_clean,
            'report_id': real_rep_id,
            'version': p.version or "v1.0",
            'duration_days': p.duration_days,
        })

    return {
        "ok": True,
        "message": f"Đã cấp giấy phép dùng thử {real_rep_id} ({p.version}) cho {email_clean} ({p.duration_days} ngày).",
        "entitlement": ent,
    }


@router.post("/api/v1/admin/billing/trials/{entitlement_id}/extend")
@router.post("/api/admin/billing/trials/{entitlement_id}/extend")
def admin_extend_trial_license(entitlement_id: str, p: ExtendTrialPayload, _admin=Depends(get_current_admin)):
    """Extend duration of an existing trial license."""
    from app.db import audit
    now_ts = time.time()
    admin_id = _admin.get("id", "admin") if isinstance(_admin, dict) else "admin"

    with tx() as c:
        row = c.execute("SELECT * FROM report_entitlements WHERE id=?", (entitlement_id,)).fetchone()
        if not row:
            fail(404, f"Không tìm thấy giấy phép dùng thử {entitlement_id}")
        ent = dict(row)
        current_exp = float(ent.get("expires_at") or now_ts)
        new_exp = max(current_exp, now_ts) + (p.extra_days * 86400)

        c.execute("""
            UPDATE report_entitlements SET
                expires_at = ?,
                status = 'ACTIVE',
                revoked_at = NULL
            WHERE id = ?
        """, (new_exp, entitlement_id))

        if ent.get("order_id"):
            c.execute("UPDATE orders SET expires_at = ? WHERE id = ?", (new_exp, ent["order_id"]))

        audit(c, admin_id, 'trial_license_extended', {
            'entitlement_id': entitlement_id,
            'new_expires_at': new_exp,
            'extra_days': p.extra_days,
        })

    return {
        "ok": True,
        "message": f"Đã gia hạn giấy phép dùng thử thêm {p.extra_days} ngày.",
        "new_expires_at": new_exp,
    }


@router.post("/api/v1/admin/billing/trials/{entitlement_id}/revoke")
@router.post("/api/admin/billing/trials/{entitlement_id}/revoke")
def admin_revoke_trial_license(entitlement_id: str, p: RevokeTrialPayload, _admin=Depends(get_current_admin)):
    """Revoke an active trial license immediately."""
    from app.db import audit
    now_ts = time.time()
    admin_id = _admin.get("id", "admin") if isinstance(_admin, dict) else "admin"

    with tx() as c:
        row = c.execute("SELECT * FROM report_entitlements WHERE id=?", (entitlement_id,)).fetchone()
        if not row:
            fail(404, f"Không tìm thấy giấy phép dùng thử {entitlement_id}")
        ent = dict(row)

        c.execute("""
            UPDATE report_entitlements SET
                status = 'REVOKED',
                revoked_at = ?,
                expires_at = ?
            WHERE id = ?
        """, (now_ts, now_ts - 1, entitlement_id))

        if ent.get("order_id"):
            c.execute("UPDATE orders SET entitlement_status = 'REVOKED' WHERE id = ?", (ent["order_id"],))

        audit(c, admin_id, 'trial_license_revoked', {
            'entitlement_id': entitlement_id,
            'reason': p.reason or "Revoked by admin",
        })

    return {
        "ok": True,
        "message": f"Đã thu hồi giấy phép dùng thử {entitlement_id} thành công.",
    }


@router.post("/api/v1/admin/billing/trials/{entitlement_id}/change-email")
@router.post("/api/admin/billing/trials/{entitlement_id}/change-email")
def admin_change_trial_email(entitlement_id: str, p: ChangeTrialEmailPayload, _admin=Depends(get_current_admin)):
    """Transfer an existing trial license to a different email address."""
    from app.db import audit
    from app.security import password_hash
    clean_email = p.new_email.strip().lower()
    admin_id = _admin.get("id", "admin") if isinstance(_admin, dict) else "admin"

    with tx() as c:
        row = c.execute("SELECT * FROM report_entitlements WHERE id=?", (entitlement_id,)).fetchone()
        if not row:
            fail(404, f"Không tìm thấy giấy phép dùng thử {entitlement_id}")
        ent = dict(row)

        u_row = c.execute("SELECT id FROM users WHERE email=?", (clean_email,)).fetchone()
        if u_row:
            new_uid = u_row["id"]
        else:
            new_uid = f"usr_{secrets.token_hex(8)}"
            rand_pw = secrets.token_urlsafe(12)
            c.execute("INSERT INTO users (id, email, password, role) VALUES (?, ?, ?, 'customer')", (new_uid, clean_email, password_hash(rand_pw)))

        c.execute("UPDATE report_entitlements SET user_id=? WHERE id=?", (new_uid, entitlement_id))
        if ent.get("order_id"):
            c.execute("UPDATE orders SET user_id=? WHERE id=?", (new_uid, ent["order_id"]))

        audit(c, admin_id, 'trial_license_email_transferred', {
            'entitlement_id': entitlement_id,
            'old_user_id': ent.get("user_id"),
            'new_email': clean_email,
        })

    return {
        "ok": True,
        "message": f"Đã chuyển giấy phép dùng thử sang email {clean_email} thành công.",
    }


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
        email_html = (
            f"<div style='font-family: sans-serif; padding: 20px; line-height: 1.6;'>"
            f"<h2>Xác Nhận Thanh Toán Thành Công</h2>"
            f"<p>Chào bạn,</p>"
            f"<p>Khoản thanh toán của bạn đã được quản trị viên duyệt thành công:</p>"
            f"<ul>"
            f"<li>Số tiền: {int(p.amount_vnd):,} VND</li>"
            f"<li>Cổng thanh toán: {p.gateway}</li>"
            f"<li>Mã tham chiếu: {p.reference_code}</li>"
            f"<li>Ghi chú: {p.note}</li>"
            f"</ul>"
            f"<p>Cảm ơn bạn đã đồng hành cùng ZUPIRUS Quant Lab.</p>"
            f"</div>"
        )
        send_resend_email(to=email_clean, subject="🎉 Xác nhận thanh toán thành công (Duyệt thủ công) - ZUPIRUS Quant Lab", html=email_html)
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

