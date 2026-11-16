"""Targeted regression tests for P0/P1 security and truthfulness remediation."""
import time
import os
import json
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import tx, setkv
from app.routers.telemetry import get_live_xauusd_quote
from app.research import discover_candidate_from_observations


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.headers.update({"X-Zupirus": "1"})
        yield c


def test_customer_cannot_call_dispatch_signal(client):
    """P0 Check: Normal authenticated customer gets 403 when calling /api/metaapi/dispatch-signal."""
    cust_email = f"user_{int(time.time() * 1000)}@zupirus.com"
    p = {"email": cust_email, "password": "UserPass123!"}
    r_reg = client.post("/api/register", json=p)
    assert r_reg.status_code == 200

    r_login = client.post("/api/login", json=p)
    assert r_login.status_code == 200
    token = r_login.cookies.get("s")

    payload = {
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2700.0,
        "sl": 2690.0,
        "tp": 2720.0,
        "comment": "ZUPIRUS_TEST",
    }
    r = client.post(
        "/api/metaapi/dispatch-signal",
        headers={"Cookie": f"s={token}"} if token else {},
        json=payload,
    )
    assert r.status_code == 403
    assert "Admin" in r.text


def test_halted_kill_switch_blocks_dispatch(client):
    """P0 Check: When kill-switch is active (halted=1), admin cannot dispatch signals."""
    admin_pw = os.getenv("ADMIN_PASSWORD", "test-only-admin-password-123")
    r_login = client.post("/api/login", json={"email": "admin@zupirus.local", "password": admin_pw})
    assert r_login.status_code == 200
    token = r_login.cookies.get("s")

    with tx() as c:
        setkv(c, "halted", 1)  # Enable kill-switch

    try:
        payload = {
            "symbol": "XAUUSD",
            "action": "BUY",
            "entry_price": 2700.0,
            "sl": 2690.0,
            "tp": 2720.0,
            "comment": "ZUPIRUS_TEST",
        }
        r = client.post(
            "/api/metaapi/dispatch-signal",
            headers={"Cookie": f"s={token}"} if token else {},
            json=payload,
        )
        assert r.status_code == 403
        assert "kill-switch is active" in r.text.lower()
    finally:
        with tx() as c:
            setkv(c, "halted", 0)


def test_missing_sl_rejected_on_dispatch(client):
    """P0 Check: Missing or zero Stop Loss is strictly rejected on dispatch."""
    with tx() as c:
        setkv(c, "halted", 0)

    admin_pw = os.getenv("ADMIN_PASSWORD", "test-only-admin-password-123")
    r_login = client.post("/api/login", json={"email": "admin@zupirus.local", "password": admin_pw})
    assert r_login.status_code == 200
    token = r_login.cookies.get("s")

    payload = {
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2700.0,
        "sl": 0.0,  # Zero SL
        "tp": 2720.0,
    }
    r = client.post(
        "/api/metaapi/dispatch-signal",
        headers={"Cookie": f"s={token}"} if token else {},
        json=payload,
    )
    assert r.status_code == 422
    assert "Mandatory Stop Loss" in r.text


def test_sepay_webhook_fails_closed_when_secret_unset(client, monkeypatch):
    """P0 Check: SePay webhook fails closed with 503 if secret is not configured."""
    monkeypatch.setattr("app.routers.webhooks.SEPAY_WEBHOOK_SECRET", "")
    with tx() as c:
        setkv(c, "billing_settings", json.dumps({"sepay_webhook_secret": ""}))

    payload = {
        "gateway": "vietinbank",
        "transferType": "in",
        "transferAmount": 199000,
        "content": "ZP 1A2B3C",
    }
    r = client.post("/api/sepay/webhook", json=payload)
    assert r.status_code == 503
    assert "not configured" in r.text.lower()


def test_sepay_webhook_rejects_outbound_debit_transfer(client, monkeypatch):
    """P0 Check: Outbound debit transfer (transferType != 'in') is ignored without modifying orders."""
    secret = "test_secret_123"
    monkeypatch.setattr("app.routers.webhooks.SEPAY_WEBHOOK_SECRET", secret)
    with tx() as c:
        setkv(c, "billing_settings", json.dumps({"sepay_webhook_secret": secret}))

    payload = {
        "gateway": "vietinbank",
        "transferType": "out",  # Debit / Outbound!
        "transferAmount": 500000,
        "content": "ZP 1A2B3C",
    }
    r = client.post(
        "/api/sepay/webhook",
        headers={"Authorization": f"Apikey {secret}"},
        json=payload,
    )
    assert r.status_code == 200
    assert "non-inbound" in r.json().get("message", "").lower() or "ignored" in r.json().get("message", "").lower()


def test_sepay_webhook_underpaid_rejected(client, monkeypatch):
    """P0 Check: Underpaid transaction is marked as UNDERPAID and rejected."""
    secret = "test_secret_123"
    monkeypatch.setattr("app.routers.webhooks.SEPAY_WEBHOOK_SECRET", secret)
    with tx() as c:
        setkv(c, "billing_settings", json.dumps({"sepay_webhook_secret": secret}))

    # Get valid user id
    with tx() as c:
        user_row = c.execute("SELECT id FROM users LIMIT 1").fetchone()
        user_id = user_row[0] if user_row else "usr_admin"

    # Create an order expecting 500,000 VND with valid hex id
    order_id = "ord_a1b2c3d4e5f6"
    now = time.time()
    with tx() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO orders (
                id, user_id, amount_usd, locked_exchange_rate,
                amount_vnd, plan_tier, status, payment_gateway,
                created_at, expires_at
            ) VALUES (?, ?, 20.0, 25000.0, 500000, 'pro', 'PENDING', 'SEPAY', ?, ?)
            """,
            (order_id, user_id, now, now + 3600)
        )

    # Send only 200,000 VND with matching hex suffix
    payload = {
        "gateway": "vietinbank",
        "transferType": "in",
        "transferAmount": 200000,
        "content": "Thanh toan ZP A1B2C3D4E5F6",
    }
    r = client.post(
        "/api/sepay/webhook",
        headers={"Authorization": f"Apikey {secret}"},
        json=payload,
    )
    assert r.status_code == 200
    res = r.json()
    assert res.get("success") is False

    # Verify order in DB was marked UNDERPAID and NOT PAID
    with tx() as c:
        row = c.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
        assert row[0] == "UNDERPAID"


def test_telemetry_no_fake_constants_when_offline():
    """P1 Check: Telemetry quote returns data_available=False when no real quote exists."""
    quote = get_live_xauusd_quote()
    # It should never return the old fake 3887.38
    assert quote.get("mid") != 3887.38
    if not quote.get("data_available"):
        assert quote.get("bid") is None
        assert quote.get("spread_pips") is None


def test_tabula_rasa_insufficient_data_behavior():
    """P1 Check: Tabula Rasa induction does not fake 0.65 win rate when data is insufficient."""
    with tx() as c:
        c.execute("DELETE FROM signal_audit_logs")

    res = discover_candidate_from_observations()
    assert res.get("status") == "insufficient_data"
    assert "Chưa đủ dữ liệu" in res.get("message", "")
    assert res.get("empirical_win_rate") is None
