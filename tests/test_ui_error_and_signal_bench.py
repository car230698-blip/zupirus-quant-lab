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


def test_admin_ai_test_bench_honest_failure_without_key(client: TestClient, monkeypatch):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    admin_email = f"admin_ai_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"
    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))
        c.execute("DELETE FROM kv WHERE key = 'ai:settings'")
        c.execute("UPDATE gemini_keys SET is_active = 0")

    csrf = {"x-zupirus": "1"}

    # 1-Click test with empty API key must honestly fail with 400 and success=False (no fake Sandbox fallback)
    r_ai = client.post(
        "/api/admin/ai/test",
        headers=csrf,
        json={
            "prompt": "Đánh giá điều kiện rủi ro XAU/USD",
            "provider": "OPENAI",
            "model": "gpt-4o-mini",
            "api_key": ""
        }
    )
    assert r_ai.status_code == 400
    d = r_ai.json()
    assert d["success"] is False
    assert "error" in d


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


def test_full_admin_and_user_e2e_flows(client: TestClient):
    """Verify newly audited flows: PRO/INSTITUTIONAL checkout, manual order approval, grant sub, user role='user', safety reason, and PATCH account config."""
    admin_email = f"admin_e2e_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"
    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # 1. Admin creates user with role='user' and name
    new_u_email = f"member_{secrets.token_hex(4)}@example.com"
    r_create_u = client.post(
        "/api/admin/users",
        headers=csrf,
        json={"email": new_u_email, "password": pwd, "role": "user", "name": "Test Trader"}
    )
    assert r_create_u.status_code == 200
    assert r_create_u.json()["role"] == "customer"

    # 2. Admin toggles safety with reason field
    r_safe = client.post(
        "/api/admin/safety",
        headers=csrf,
        json={"halted": False, "reason": "Routine test"}
    )
    assert r_safe.status_code == 200

    # 3. Admin grants INSTITUTIONAL subscription to new user
    r_grant = client.post(
        "/api/admin/billing/grant-subscription",
        headers=csrf,
        json={
            "user_id": new_u_email,
            "plan_tier": "INSTITUTIONAL",
            "slots": 5,
            "days": 60,
        }
    )
    assert r_grant.status_code == 200
    assert r_grant.json()["plan_tier"] == "alpha"

    # 4. Login as the new user and verify /api/v1/billing/subscription
    client.post("/api/login", headers=csrf, json={"email": new_u_email, "password": pwd})
    r_sub = client.get("/api/v1/billing/subscription")
    assert r_sub.status_code == 200
    sub_d = r_sub.json()
    assert sub_d["plan_tier"] == "alpha"
    assert sub_d["max_cloud_accounts"] == 5

    # 5. User creates checkout order with uppercase 'PRO'
    r_pro_ord = client.post(
        "/api/v1/billing/checkout",
        headers=csrf,
        json={"plan_tier": "PRO", "cloud_accounts_count": 2, "billing_cycle": "MONTHLY"}
    )
    assert r_pro_ord.status_code == 200
    order_id = r_pro_ord.json()["id"]

    # 6. User connects MT5 account and updates its risk config via PATCH
    r_acc = client.post(
        "/api/v1/accounts",
        headers=csrf,
        json={
            "mt5_login": "88991122",
            "mt5_password": "TradePassword123!",
            "mt5_server": "Exness-MT5Real",
            "lot_multiplier": 0.05,
            "max_daily_dd_pct": 4.0,
            "disclaimer_accepted": True,
        }
    )
    assert r_acc.status_code == 200
    acc_id = r_acc.json()["id"]

    r_patch = client.patch(
        f"/api/v1/accounts/{acc_id}",
        headers=csrf,
        json={"lot_multiplier": 0.02, "max_daily_dd_pct": 3.5, "max_lot": 2.5}
    )
    assert r_patch.status_code == 200

    # 7. Admin manually approves the pending order
    client.post("/api/login", headers=csrf, json={"email": admin_email, "password": pwd})
    r_app = client.post(
        f"/api/admin/billing/orders/{order_id}/approve",
        headers=csrf,
    )
    assert r_app.status_code == 200
    assert r_app.json()["status"] == "SUCCESS"

