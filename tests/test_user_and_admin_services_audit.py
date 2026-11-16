"""Comprehensive integration test suite covering audited user services and admin functions.
Validates:
1. AI Assistant Chat (/api/chat/assistant) resilience against missing account fields ('positions', None balance/equity).
2. Cloud account deploy/undeploy lifecycle (/api/v1/accounts/cloud/{id}/deploy & undeploy).
3. Admin Billing & VietQR settings (GET /settings, PUT /settings, POST /preview-qr, POST /flush-fx-cache).
4. Admin Orders & Subscriptions KPI summary (/api/admin/billing/summary, /api/admin/billing/orders).
5. Admin manual grant subscription (/api/admin/billing/grant-subscription).
6. Admin Signal Sources & 3-Mode Architecture switcher (/api/admin/sources, /api/admin/sources/signal-mode).
"""
import pytest
import secrets
from starlette.testclient import TestClient

from app.db import tx


def test_ai_assistant_chat_resilience_and_positions_key_safety(client: TestClient):
    """Ensure /api/chat/assistant never crashes with KeyError: 'positions' or NoneType errors."""
    user_email = f"chat_trader_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    client.post("/api/register", json={"email": user_email, "password": pwd})
    client.post("/api/login", json={"email": user_email, "password": pwd})

    csrf = {"x-zupirus": "1"}

    # Test question asking about portfolio
    payload_portfolio = {
        "messages": [
            {"role": "user", "content": "Kiểm tra số dư và trạng thái danh mục của tôi"}
        ]
    }
    r_port = client.post("/api/chat/assistant", json=payload_portfolio, headers=csrf)
    assert r_port.status_code == 200
    assert "Trợ lý định lượng ZUPIRUS" in r_port.text or "Danh mục" in r_port.text

    # Test question asking about drawdown / risk
    payload_risk = {
        "messages": [
            {"role": "user", "content": "Ngưỡng sụt giảm Daily Drawdown và 4 lớp giáp bảo vệ vốn hoạt động thế nào?"}
        ]
    }
    r_risk = client.post("/api/chat/assistant", json=payload_risk, headers=csrf)
    assert r_risk.status_code == 200
    assert "4 Lớp Giáp Bảo Vệ Vốn" in r_risk.text or "Drawdown" in r_risk.text

    # Test question asking about orders
    payload_orders = {
        "messages": [
            {"role": "user", "content": "Liệt kê lịch sử lệnh gần nhất"}
        ]
    }
    r_ord = client.post("/api/chat/assistant", json=payload_orders, headers=csrf)
    assert r_ord.status_code == 200


def test_cloud_accounts_deploy_and_undeploy_endpoints(client: TestClient):
    """Ensure /api/v1/accounts/cloud/{account_id}/deploy and undeploy work seamlessly."""
    user_email = f"cloud_ops_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    client.post("/api/register", json={"email": user_email, "password": pwd})
    client.post("/api/login", json={"email": user_email, "password": pwd})
    csrf = {"x-zupirus": "1"}

    # Accept disclaimer
    client.post("/api/legal/accept", json={
        "signature_text": "Cloud Ops Trader",
        "confirmed_risk": True,
        "confirmed_age": True,
        "confirmed_no_solicitation": True
    }, headers=csrf)

    # Create account
    login_id = f"55{secrets.randbelow(89999) + 10000}"
    r_acc = client.post("/api/v1/accounts", json={
        "login": login_id,
        "password": "MockPassword123!",
        "server": "Exness-MT5Real",
        "account_name": "Test Cloud Node",
        "platform": "mt5",
    }, headers=csrf)
    assert r_acc.status_code == 200
    acc_id = r_acc.json()["id"]

    # Test Undeploy
    r_undep = client.post(f"/api/v1/accounts/cloud/{acc_id}/undeploy", headers=csrf)
    assert r_undep.status_code == 200
    assert r_undep.json()["deployment_state"] == "UNDEPLOYED"

    # Test Deploy
    r_dep = client.post(f"/api/v1/accounts/cloud/{acc_id}/deploy", headers=csrf)
    assert r_dep.status_code == 200
    assert r_dep.json()["deployment_state"] == "DEPLOYED"


def test_admin_billing_settings_and_vietqr_workflows(client: TestClient):
    """Validate Admin Billing settings (GET, PUT, Preview QR, Flush FX Cache)."""
    admin_email = f"admin_bill_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # 1. GET Settings
    r_get = client.get("/api/admin/billing/settings", headers=csrf)
    assert r_get.status_code == 200
    d_get = r_get.json()
    assert "sepay_bank_name" in d_get
    assert "fallback_usd_vnd_rate" in d_get
    assert "current_live_rate" in d_get

    # 2. PUT Settings with AdminBillingSettingsTab format
    update_payload = {
        "sepay_bank_name": "VietinBank",
        "sepay_account_number": "10987654321",
        "sepay_account_holder": "ZUPIRUS QUANT LAB",
        "fallback_usd_vnd_rate": 25750.0,
        "fx_rate_provider_url": "https://open.er-api.com/v6/latest/USD",
        "fx_rate_cache_ttl_seconds": 3600,
        "sepay_webhook_secret": "secure_secret_token_123"
    }
    r_put = client.put("/api/admin/billing/settings", json=update_payload, headers=csrf)
    assert r_put.status_code == 200
    assert r_put.json()["settings"]["sepay_bank_name"] == "VietinBank"

    # 3. Flush FX Cache
    r_flush = client.post("/api/admin/billing/flush-fx-cache", headers=csrf)
    assert r_flush.status_code == 200
    assert "new_rate" in r_flush.json()

    # 4. Preview QR
    qr_payload = {
        "bank_name": "MB",
        "account_number": "0987654321",
        "account_holder": "QUANT ADMIN",
        "amount_vnd": 772000,
        "content_memo": "ZP TEST ORDER"
    }
    r_qr = client.post("/api/admin/billing/preview-qr", json=qr_payload, headers=csrf)
    assert r_qr.status_code == 200
    assert "sepay_qr_url" in r_qr.json()
    assert "vietqr_qr_url" in r_qr.json()


def test_admin_orders_subscriptions_summary_and_grant(client: TestClient):
    """Validate Admin Orders & Subscriptions KPI summary and manual subscription grant."""
    admin_email = f"admin_kpi_{secrets.token_hex(4)}@example.com"
    trader_email = f"target_trader_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/register", json={"email": trader_email, "password": pwd})

    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # 1. GET Summary
    r_sum = client.get("/api/admin/billing/summary", headers=csrf)
    assert r_sum.status_code == 200
    d_sum = r_sum.json()
    assert "orders" in d_sum
    assert "subscriptions" in d_sum
    assert "cloud_accounts" in d_sum

    # 2. GET Orders list
    r_ords = client.get("/api/admin/billing/orders", headers=csrf)
    assert r_ords.status_code == 200
    assert "orders" in r_ords.json()

    # 3. Grant Subscription
    grant_payload = {
        "user_id": trader_email,
        "plan_tier": "PRO",
        "slots": 3,
        "days": 60
    }
    r_grant = client.post("/api/admin/billing/grant-subscription", json=grant_payload, headers=csrf)
    assert r_grant.status_code == 200
    res = r_grant.json()
    assert res["success"] is True
    assert res["slots"] == 3
    assert res["email"] == trader_email


def test_admin_sources_decision_mode_and_learning_progress(client: TestClient):
    """Validate Admin Signal Sources 3-mode switcher and Tabula Rasa learning progress."""
    admin_email = f"admin_src_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # 1. GET Sources with active_signal_mode & learning_progress
    r_get = client.get("/api/admin/sources", headers=csrf)
    assert r_get.status_code == 200
    d_src = r_get.json()
    assert "sources" in d_src
    assert "active_signal_mode" in d_src
    assert "learning_progress" in d_src

    # 2. Switch mode to ZUPIRUS_AGENT
    r_mode = client.post("/api/admin/sources/signal-mode", json={"mode": "ZUPIRUS_AGENT"}, headers=csrf)
    assert r_mode.status_code == 200
    assert r_mode.json()["active_signal_mode"] == "ZUPIRUS_AGENT"

    # Verify mode persisted
    r_get2 = client.get("/api/admin/sources", headers=csrf)
    assert r_get2.json()["active_signal_mode"] == "ZUPIRUS_AGENT"
