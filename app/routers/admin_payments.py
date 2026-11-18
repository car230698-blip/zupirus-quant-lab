import time, secrets, logging
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.db import tx, audit
from app.routers.deps import fail, get_current_admin

logger = logging.getLogger("zupirus.api")
router = APIRouter()


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

        total_row = c.execute("SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE status IN ('completed', 'manual_approved')").fetchone()
        total_vnd = total_row[0] if total_row else 0.0

    return {
        "total_revenue_vnd": float(total_vnd),
        "total_transactions": len(rows),
        "transactions": [dict(r) for r in rows]
    }

class ManualPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)
    amount_vnd: float = Field(gt=0)
    gateway: str = Field(default='MANUAL_BANK', max_length=50)
    reference_code: str = Field(min_length=1, max_length=100)
    note: Optional[str] = Field(default='Duyệt thanh toán thủ công bởi Admin', max_length=255)

@router.post('/api/admin/payments/manual-approve')
def admin_manual_approve_payment(p: ManualPaymentPayload, u=Depends(get_current_admin)):
    """Manually approves and records a payment transaction, crediting the customer and sending an official email receipt."""
    from app.sepay import build_payment_success_email
    from app.mailer import send_resend_email
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

    # Dispatch cybernetic receipt email
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

class LinkPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)

@router.post('/api/admin/payments/{tx_id}/link-user')
def admin_link_payment_user(tx_id: str, p: LinkPaymentPayload, u=Depends(get_current_admin)):
    """Links an unmatched incoming payment transaction to a specific customer account."""
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
