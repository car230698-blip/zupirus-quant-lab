"""Billing, real-time exchange rates, and checkout endpoints."""
import time
import json
from typing import Optional
from urllib.parse import quote
from pydantic import BaseModel
from fastapi import APIRouter, Depends
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


@router.get("/methods")
def get_billing_methods():
    """Retrieve currently active and available billing methods."""
    from app.domains.billing.crypto_direct import get_active_billing_methods
    return get_active_billing_methods()


@router.get("/gateways")
def get_available_gateways():
    """Retrieve available payment gateways and their live enablement state."""
    from app.domains.billing.crypto_direct import get_crypto_wallets_config
    cfg = get_crypto_wallets_config()
    is_enabled = bool(cfg.get("enabled", False))
    has_trc20 = is_enabled and bool(cfg.get("trc20_address"))
    has_bep20 = is_enabled and bool(cfg.get("bep20_address"))
    return {
        "sepay": False,
        "usdt": bool(has_trc20 or has_bep20 or True),
        "usdt_trc20": has_trc20,
        "usdt_bep20": has_bep20,
        "supported_currencies": ["USDT", "USD"],
    }


@router.get("/subscription", response_model=SubscriptionResponse)
def get_my_subscription(u=Depends(get_current_user)):
    """Retrieve active subscription and entitlements for current user."""
    data = get_user_subscription(u["id"])
    return SubscriptionResponse(**data)


@router.post("/checkout", response_model=OrderResponse)
def checkout(p: CreateOrderRequest, u=Depends(get_current_user)):
    """Create checkout order with default Direct USDT (TRC20/BEP20)."""
    order_data = create_checkout_order(
        user_id=u["id"],
        plan_tier=p.plan_tier,
        cloud_slots=p.cloud_slots,
        billing_cycle=p.billing_cycle or "MONTHLY",
        payment_method=p.payment_method or "USDT",
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

        now_ts = time.time()
        if d.get("status") == "PENDING" and d.get("expires_at") and float(d["expires_at"]) < now_ts:
            c.execute("UPDATE orders SET status = 'EXPIRED', payment_status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'", (d["id"],))
            d["status"] = "EXPIRED"
            d["payment_status"] = "EXPIRED"

        gw = str(d.get("payment_gateway") or "").upper()
        if gw.startswith("USDT"):
            net = "BEP20" if "BEP20" in gw else "TRC20"
            d["crypto_network"] = net
            # Read saved destination wallet from kv (consistent with checkout and verification)
            saved_w = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_wallet:{d['id']}",)).fetchone()
            wallet_addr = saved_w[0] if saved_w and saved_w[0] else None
            if not wallet_addr:
                from app.domains.billing.crypto_direct import get_crypto_wallets_config
                cfg = get_crypto_wallets_config(db_cursor=c)
                wallet_addr = cfg.get("bep20_address") if net == "BEP20" else cfg.get("trc20_address")
            d["wallet_address"] = wallet_addr
            d["amount_usdt"] = d.get("expected_amount_usdt") or d.get("amount_usd")
            d["payment_content"] = f"USDT {d['id']}"
        else:
            # Issue 6 Fix: Check cached order bank info from checkout, ensure SEVQR prefix for VietinBank,
            # and calculate QR amount based on remaining underpaid balance.
            saved_bank_info = None
            try:
                bi_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_bank_info:{d['id']}",)).fetchone()
                if bi_row and bi_row[0]:
                    saved_bank_info = json.loads(bi_row[0])
            except Exception:
                saved_bank_info = None

            if saved_bank_info:
                bank_name = saved_bank_info.get("bank_name")
                bank_acc = saved_bank_info.get("account_number")
                bank_holder = saved_bank_info.get("account_holder")
                content_memo = saved_bank_info.get("content_memo")
            else:
                bank_name, bank_acc, bank_holder = get_effective_sepay_config(db_cursor=c)
                content_memo = f"ZP {d['id'][-6:].upper()}"
                is_vietin = str(bank_name or "").lower() in ("vietinbank", "icb")
                if is_vietin and not content_memo.upper().startswith("SEVQR"):
                    content_memo = f"SEVQR {content_memo}"

            total_vnd = int(d.get("amount_vnd") or 0)
            paid_vnd = float(d.get("paid_amount_vnd") or 0.0)
            charge_vnd = max(0, int(total_vnd - paid_vnd)) if (d.get("status") == "UNDERPAID" or paid_vnd > 0) else total_vnd

            encoded_memo = quote(content_memo)
            qr_url = f"https://qr.sepay.vn/img?acc={bank_acc}&bank={bank_name}&amount={charge_vnd}&des={encoded_memo}"
            d["qr_code_url"] = qr_url
            d["account_number"] = bank_acc
            d["bank_name"] = bank_name
            d["account_holder"] = bank_holder
            d["payment_content"] = content_memo
        return OrderResponse(**d)


class VerifyTxPayload(BaseModel):
    tx_hash: str


@router.post("/orders/{order_id}/verify-tx")
async def verify_order_crypto_tx(order_id: str, p: VerifyTxPayload, u=Depends(get_current_user)):
    """User submission of blockchain transaction hash for immediate verification and fulfillment."""
    from app.domains.billing.crypto_direct import verify_and_fulfill_crypto_order
    with tx() as c:
        row = c.execute("SELECT user_id FROM orders WHERE LOWER(id) = ?", (order_id.strip().lower(),)).fetchone()
        if not row:
            fail(404, "Đơn hàng không tồn tại.")
        if u["role"] != "admin" and row["user_id"] != u["id"]:
            fail(403, "Không có quyền xác minh đơn hàng này.")

    result = await verify_and_fulfill_crypto_order(order_id, p.tx_hash)
    if not result.get("ok"):
        fail(400, result.get("message", "Xác minh giao dịch thất bại."))
    return result


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

