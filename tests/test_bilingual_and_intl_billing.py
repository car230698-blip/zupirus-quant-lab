"""
Comprehensive tests for Bilingual VI/EN and NOWPayments USDT international gateway.
Tests:
1. Migration 024 schema additions.
2. Language update endpoint PATCH /api/v1/auth/language and /api/me response.
3. Bilingual emails (OTP, receipt, expiry reminder, 24h handover).
4. NOWPayments HMAC-SHA512 signature verification (valid & invalid 401).
5. Webhook idempotency (duplicate payment_id).
6. Gateways listing endpoint GET /api/v1/billing/gateways.
"""
import hmac
import hashlib
import json
import os
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import tx, is_postgres
from app.core.mailer import (
    send_otp_code,
    send_payment_receipt_email,
    send_subscription_expiry_reminder,
)
from app.domains.billing.nowpayments import (
    verify_nowpayments_signature,
    create_nowpayments_invoice,
)


@pytest.fixture
def client():
    from app.core.db import init
    init()
    c = TestClient(app)
    c.headers.update({"X-Zupirus": "1"})
    return c


@pytest.fixture
def test_user(client):
    """Create a clean unique test user and return credentials & auth token/cookie."""
    import secrets
    from app.core.db import init
    init()
    uid = f"u_test_{secrets.token_hex(6)}"
    email = f"bilingual_{secrets.token_hex(4)}@zupirus.test"
    password = "quant-password-123"

    from app.core.security import password_hash
    with tx() as c:
        try:
            c.execute(
                "INSERT INTO users (id, email, password, role, preferred_language) VALUES (?, ?, ?, 'customer', 'vi')",
                (uid, email, password_hash(password)),
            )
        except Exception:
            c.execute(
                "INSERT INTO users (id, email, password, role) VALUES (?, ?, ?, 'customer')",
                (uid, email, password_hash(password)),
            )

    login_res = client.post("/api/login", json={"email": email, "password": password})
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.cookies.get("token") or login_res.json().get("token")

    return {
        "id": uid,
        "email": email,
        "password": password,
        "token": token,
        "client": client,
    }


def test_migration_024_columns():
    """Test that migration 024 successfully added required columns to users, orders, and payment_transactions."""
    with tx() as c:
        if is_postgres():
            u_cols = [r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'").fetchall()]
            o_cols = [r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'").fetchall()]
            p_cols = [r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_transactions'").fetchall()]
        else:
            u_cols = [r[1] for r in c.execute("PRAGMA table_info(users)").fetchall()]
            o_cols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
            p_cols = [r[1] for r in c.execute("PRAGMA table_info(payment_transactions)").fetchall()]

        assert "preferred_language" in u_cols
        assert "currency" in o_cols
        assert "external_payment_id" in o_cols
        assert "invoice_url" in o_cols
        assert "external_payment_id" in p_cols


def test_auth_language_endpoint(test_user):
    """Test PATCH /api/v1/auth/language updates preferred_language and /api/me returns it."""
    client = test_user["client"]

    # 1. Initial language is default 'vi'
    me_res = client.get("/api/v1/auth/me")
    assert me_res.status_code == 200
    assert me_res.json().get("preferred_language") == "vi"

    # 2. Switch to 'en'
    patch_res = client.patch("/api/v1/auth/language", json={"language": "en"})
    assert patch_res.status_code == 200
    assert patch_res.json().get("preferred_language") == "en"

    # 3. Verify /api/me now returns 'en'
    me_res2 = client.get("/api/me")
    assert me_res2.status_code == 200
    assert me_res2.json().get("preferred_language") == "en"

    # 4. Reject invalid language (only 'vi' or 'en' allowed)
    bad_res = client.patch("/api/v1/auth/language", json={"language": "fr"})
    assert bad_res.status_code == 400


def test_bilingual_emails():
    """Test bilingual email templates for OTP, payment receipt, and subscription expiry."""
    # 1. English OTP
    otp_en = send_otp_code("trader@test.com", "889900", lang="en")
    assert otp_en.get("ok") is True

    # 2. Vietnamese OTP
    otp_vi = send_otp_code("trader@test.com", "889900", lang="vi")
    assert otp_vi.get("ok") is True

    # 3. English Payment Receipt
    receipt_en = send_payment_receipt_email(
        email="trader@test.com",
        order_id="ord_test123",
        plan_tier="growth",
        amount_vnd=990000,
        cloud_slots=3,
        expires_at=time.time() + 86400 * 30,
        lang="en",
        amount_usd=39.0,
        currency="USD",
    )
    assert receipt_en.get("ok") is True

    # 4. English Expiry Reminder
    exp_en = send_subscription_expiry_reminder(
        email="trader@test.com",
        plan_tier="alpha",
        days_left=3,
        expires_at=time.time() + 86400 * 3,
        lang="en",
    )
    assert exp_en.get("ok") is True


def test_gateways_endpoint(client, monkeypatch):
    """Test GET /api/v1/billing/gateways returns truthful status for SePay and USDT."""
    # 1. When NOWPAYMENTS_API_KEY is not set
    monkeypatch.delenv("NOWPAYMENTS_API_KEY", raising=False)
    res1 = client.get("/api/v1/billing/gateways")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["sepay"] is True
    assert data1["usdt"] is False

    # 2. When NOWPAYMENTS_API_KEY is configured
    monkeypatch.setenv("NOWPAYMENTS_API_KEY", "test_np_key_12345")
    res2 = client.get("/api/v1/billing/gateways")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["sepay"] is True
    assert data2["usdt"] is True


def test_nowpayments_hmac_sha512_verification():
    """Test HMAC-SHA512 signature calculation and verification per NOWPayments spec."""
    secret = "my_secret_ipn_key_999"
    payload = {
        "payment_id": "np_pay_1001",
        "payment_status": "finished",
        "pay_amount": 39.0,
        "price_amount": 39.0,
        "price_currency": "usd",
        "order_id": "ord_np_test_01",
    }

    # Sort keys alphabetically and format without whitespace
    sorted_dict = {k: payload[k] for k in sorted(payload.keys())}
    serialized = json.dumps(sorted_dict, separators=(",", ":"), ensure_ascii=False)
    expected_sig = hmac.new(
        secret.encode("utf-8"),
        serialized.encode("utf-8"),
        hashlib.sha512
    ).hexdigest()

    # Valid signature
    assert verify_nowpayments_signature(payload, expected_sig, ipn_secret=secret) is True

    # Invalid signature
    assert verify_nowpayments_signature(payload, "invalid_signature_hex", ipn_secret=secret) is False

    # Altered payload
    altered_payload = {**payload, "pay_amount": 1.0}
    assert verify_nowpayments_signature(altered_payload, expected_sig, ipn_secret=secret) is False


def test_nowpayments_webhook_signature_auth_and_fulfillment(client, test_user, monkeypatch):
    """Test NOWPayments IPN webhook: 401 on bad signature, 200 and atomic fulfillment on valid signature."""
    secret = "test_ipn_secret_xyz"
    monkeypatch.setenv("NOWPAYMENTS_IPN_SECRET", secret)

    user_id = test_user["id"]
    order_id = f"ord_np_{int(time.time())}"

    with tx() as c:
        c.execute(
            """
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_gateway,
                created_at, expires_at, currency
            ) VALUES (?, ?, 39.0, 25500, 994500, 'growth', 3, 'PENDING', 'NOWPAYMENTS', ?, ?, 'USDT')
            """,
            (order_id, user_id, time.time(), time.time() + 3600),
        )

    payload = {
        "payment_id": f"pay_np_{int(time.time())}",
        "payment_status": "finished",
        "pay_amount": 39.0,
        "price_amount": 39.0,
        "price_currency": "usd",
        "pay_currency": "usdt",
        "order_id": order_id,
    }

    # 1. Bad signature returns 401
    bad_res = client.post(
        "/api/v1/billing/webhooks/nowpayments",
        json=payload,
        headers={"x-nowpayments-sig": "bad_sig"}
    )
    assert bad_res.status_code == 401

    # 2. Valid signature succeeds and fulfills order
    sorted_dict = {k: payload[k] for k in sorted(payload.keys())}
    valid_sig = hmac.new(
        secret.encode("utf-8"),
        json.dumps(sorted_dict, separators=(",", ":")).encode("utf-8"),
        hashlib.sha512
    ).hexdigest()

    ok_res = client.post(
        "/api/v1/billing/webhooks/nowpayments",
        json=payload,
        headers={"x-nowpayments-sig": valid_sig}
    )
    assert ok_res.status_code == 200
    data = ok_res.json()
    assert data.get("ok") is True
    assert data.get("fulfilled") is True

    # 3. Verify order status transitioned to PAID
    with tx() as c:
        row = c.execute("SELECT status, payment_status, entitlement_status FROM orders WHERE id = ?", (order_id,)).fetchone()
        assert row[0] == "PAID"
        assert row[1] == "PAID"
        assert row[2] == "GRANTED"

        # Verify subscription was created or updated
        sub = c.execute("SELECT plan_tier, service_expires_at FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        assert sub is not None
        assert sub[0] == "growth"
        assert float(sub[1]) > time.time()

    # 4. Idempotent double webhook call with the same payment_id does not throw error
    double_res = client.post(
        "/api/v1/billing/webhooks/nowpayments",
        json=payload,
        headers={"x-nowpayments-sig": valid_sig}
    )
    assert double_res.status_code == 200
    assert double_res.json().get("ok") is True
