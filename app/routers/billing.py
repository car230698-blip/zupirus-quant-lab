"""Billing, real-time exchange rates, and checkout endpoints."""
import time
from typing import Optional
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from app.db import tx
from app.routers.deps import get_current_user, get_current_admin, fail
from app.schemas.billing import (
    ExchangeRateResponse,
    CreateOrderRequest,
    OrderResponse,
    SubscriptionResponse,
)
from app.services.fx_rate import get_usd_vnd_rate
from app.services.billing_service import (
    create_checkout_order,
    get_user_subscription,
    process_successful_payment,
    get_effective_sepay_config,
    TIER_PRICES,
)
from app.config import (
    CLOUD_SLOT_MONTHLY_USD,
    SEPAY_BANK_NAME,
    SEPAY_ACCOUNT_NUMBER,
    SEPAY_ACCOUNT_HOLDER,
)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


@router.get("/exchange-rate", response_model=ExchangeRateResponse)
def get_exchange_rate():
    """Retrieve current real-time USD -> VND exchange rate."""
    rate, source, is_cached = get_usd_vnd_rate()
    return ExchangeRateResponse(
        base="USD",
        target="VND",
        rate=rate,
        source=source,
        is_cached=is_cached,
        updated_at=time.time(),
    )


@router.post("/refresh-exchange-rate", response_model=ExchangeRateResponse)
def force_refresh_exchange_rate(admin=Depends(get_current_admin)):
    """Admin action: Force reload live FX rate from external provider, bypassing Redis cache."""
    rate, source, is_cached = get_usd_vnd_rate(force_refresh=True)
    return ExchangeRateResponse(
        base="USD",
        target="VND",
        rate=rate,
        source=source,
        is_cached=is_cached,
        updated_at=time.time(),
    )


@router.get("/subscription", response_model=SubscriptionResponse)
def get_my_subscription(u=Depends(get_current_user)):
    """Retrieve active subscription and entitlements for current user."""
    data = get_user_subscription(u["id"])
    return SubscriptionResponse(**data)


@router.post("/checkout", response_model=OrderResponse)
def checkout(p: CreateOrderRequest, u=Depends(get_current_user)):
    """Create checkout order with locked FX rate and SePay VietQR payment info."""
    order_data = create_checkout_order(
        user_id=u["id"],
        plan_tier=p.plan_tier,
        cloud_slots=p.cloud_slots,
    )
    return OrderResponse(**order_data)


@router.get("/orders/{order_id}", response_model=OrderResponse)
def get_order_status(order_id: str, u=Depends(get_current_user)):
    """Check payment status of an order."""
    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            fail(404, "Đơn hàng không tồn tại.")
        d = dict(row)
        if u["role"] != "admin" and d["user_id"] != u["id"]:
            fail(403, "Không có quyền xem đơn hàng này.")

        content_memo = f"ZP {d['id'][-6:].upper()}"
        encoded_memo = quote(content_memo)
        bank_name, bank_acc, bank_holder = get_effective_sepay_config()
        qr_url = f"https://qr.sepay.vn/img?acc={bank_acc}&bank={bank_name}&amount={d['amount_vnd']}&des={encoded_memo}"
        d["qr_code_url"] = qr_url
        d["account_number"] = bank_acc
        d["bank_name"] = bank_name
        d["account_holder"] = bank_holder
        d["payment_content"] = content_memo
        return OrderResponse(**d)


@router.post("/simulate-pay/{order_id}")
async def simulate_pay_order(order_id: str, admin=Depends(get_current_admin)):
    """Admin-only action: fulfill order as paid immediately."""
    with tx() as c:
        row = c.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            fail(404, "Đơn hàng không tồn tại.")

    success = await process_successful_payment(order_id, sepay_trans_id=f"sim_{int(time.time())}")
    return {"ok": success, "order_id": order_id, "status": "PAID" if success else "FAILED"}


@router.get("/admin/revenue")
def get_admin_revenue_stats(admin=Depends(get_current_admin)):
    """Admin analytics: Revenue breakdown in USD and VND."""
    with tx() as c:
        stats = c.execute(
            """
            SELECT
                count(*) as total_orders,
                coalesce(sum(case when status='PAID' then amount_usd else 0 end), 0) as paid_usd,
                coalesce(sum(case when status='PAID' then amount_vnd else 0 end), 0) as paid_vnd,
                coalesce(sum(case when status='PENDING' then 1 else 0 end), 0) as pending_orders,
                coalesce(sum(case when status='PAID' then 1 else 0 end), 0) as paid_orders
            FROM orders
            """
        ).fetchone()

        rate, source, _ = get_usd_vnd_rate()

        return {
            "total_orders": stats[0],
            "total_revenue_usd": round(float(stats[1]), 2),
            "total_revenue_vnd": int(stats[2]),
            "pending_orders": stats[3],
            "paid_orders": stats[4],
            "current_fx_rate": rate,
            "fx_source": source,
        }


@router.get("/admin/orders")
def get_admin_orders(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    admin=Depends(get_current_admin)
):
    """Admin endpoint: Retrieve list of SePay orders with customer email, status and FX rate."""
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

        orders = []
        for r in rows:
            d = dict(r)
            orders.append(d)

    return {"total": total, "orders": orders}

