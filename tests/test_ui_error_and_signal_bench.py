"""Tests for UI error formatting, signal bench raw message parsing, and MT5/Billing schema aliases."""
import secrets
import pytest
from starlette.testclient import TestClient
from app.db import tx


def test_signal_test_bench_raw_message(client: TestClient):
    admin_email = f"admin_sig_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"
    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # Test raw message signal ingestion
    r_test = client.post(
        "/api/v1/signals/test-ingest",
        headers=csrf,
        json={"raw_message": "SELL GOLD NOW TP 2880", "source": "ADMIN_TEST_BENCH"}
    )
    assert r_test.status_code == 200
    data = r_test.json()
    assert data["action"] == "SELL"
    assert data["symbol"] == "XAUUSD"
    assert data["take_profit"] == 2880.0
    assert data["status"] in ("APPROVED", "REJECTED")


def test_cloud_mt5_account_creation_with_aliases(client: TestClient):
    trader_email = f"trader_mt5_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"
    client.post("/api/register", json={"email": trader_email, "password": pwd})
    client.post("/api/login", json={"email": trader_email, "password": pwd})

    csrf = {"x-zupirus": "1"}

    # Connect MT5 account with frontend payload shape
    payload = {
        "account_id": "279821746",
        "account_name": "RAW",
        "connection_type": "CLOUD_METAAPI",
        "mt5_login": "279821746",
        "mt5_password": "MasterPassword123!",
        "mt5_server": "Exness-MT5Trial8",
        "lot_multiplier": 0.01,
        "max_daily_dd_pct": 4.0,
        "disclaimer_accepted": True,
    }
    r_conn = client.post(
        "/api/v1/accounts",
        headers=csrf,
        json=payload
    )
    # Should succeed or return 200/201 (or 403 only if max accounts exceeded)
    assert r_conn.status_code in (200, 201, 403, 409)
    if r_conn.status_code == 422:
        pytest.fail(f"Validation failed unexpectedly: {r_conn.json()}")


def test_admin_ai_test_bench_sandbox_and_params(client: TestClient):
    admin_email = f"admin_ai_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"
    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # 1-Click test with live form inputs
    r_ai = client.post(
        "/api/admin/ai/test",
        headers=csrf,
        json={
            "prompt": "Đánh giá điều kiện rủi ro XAU/USD",
            "provider": "HYBRID",
            "model": "gpt-4o-mini",
            "api_key": ""
        }
    )
    assert r_ai.status_code == 200
    d = r_ai.json()
    assert d["success"] is True
    assert "response" in d
    assert len(d["response"]) > 0


def test_vietqr_checkout_order_response_fields(client: TestClient):
    trader_email = f"trader_ord_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"
    client.post("/api/register", json={"email": trader_email, "password": pwd})
    client.post("/api/login", json={"email": trader_email, "password": pwd})

    csrf = {"x-zupirus": "1"}

    r_order = client.post(
        "/api/v1/billing/checkout",
        headers=csrf,
        json={"plan_tier": "starter", "cloud_accounts_count": 1}
    )
    assert r_order.status_code == 200
    d = r_order.json()
    assert "id" in d
    assert "qr_code_url" in d
    assert "qr_url" in d
    assert "order_code" in d
    assert "amount_vnd" in d
    assert "payment_content" in d
    assert d["qr_code_url"] is not None
