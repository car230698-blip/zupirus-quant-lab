"""Tests for Admin AI Settings & Model Selector and User Deletion Cascade."""
import json
import secrets
import pytest
from starlette.testclient import TestClient

from app.db import tx


def test_admin_ai_settings_lifecycle(client: TestClient):
    """Verify Admin AI settings GET, PUT, and test endpoints."""
    admin_email = f"ai_admin_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))

    csrf = {"x-zupirus": "1"}

    # 1. GET Settings
    r_get = client.get("/api/admin/ai/settings", headers=csrf)
    assert r_get.status_code == 200
    d_get = r_get.json()
    assert "provider" in d_get
    assert "model" in d_get
    assert "available_models" in d_get
    assert len(d_get["available_models"]) >= 5

    # 2. PUT Settings with new model and provider
    update_payload = {
        "provider": "OPENAI",
        "api_key": "sk-proj-test1234567890abcdef",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
    }
    r_put = client.put("/api/admin/ai/settings", json=update_payload, headers=csrf)
    assert r_put.status_code == 200
    d_put = r_put.json()
    assert d_put["success"] is True
    assert d_put["model"] == "gpt-4o"
    assert d_put["provider"] == "OPENAI"
    assert "sk-proj" in d_put["api_key_masked"]

    # Verify persisted in kv
    r_get2 = client.get("/api/admin/ai/settings", headers=csrf)
    assert r_get2.status_code == 200
    assert r_get2.json()["model"] == "gpt-4o"
    assert r_get2.json()["has_api_key"] is True

    # 3. Test AI endpoint
    test_req = {"prompt": "Kiểm tra tín hiệu thị trường XAU/USD"}
    r_test = client.post("/api/admin/ai/test", json=test_req, headers=csrf)
    # Since api_key is fake, it returns either 200 (if Gemini pool succeeded) or 502 (if calling external fake key failed gracefully)
    assert r_test.status_code in (200, 502)


def test_admin_delete_user_cascade(client: TestClient):
    """Verify Admin can delete a user and all their associated records without FK constraint errors."""
    admin_email = f"admin_del_{secrets.token_hex(4)}@example.com"
    trader_email = f"trader_del_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    # Register admin and trader
    client.post("/api/register", json={"email": admin_email, "password": pwd})
    client.post("/api/register", json={"email": trader_email, "password": pwd})

    with tx() as c:
        c.execute("UPDATE users SET role = 'admin' WHERE email = ?", (admin_email,))
        trader_row = c.execute("SELECT id FROM users WHERE email = ?", (trader_email,)).fetchone()
        trader_id = trader_row[0]

        # Insert some dependent records for trader
        now_ts = 1700000000.0
        c.execute("INSERT INTO orders(id, user_id, amount_usd, locked_exchange_rate, amount_vnd, plan_tier, status, created_at, expires_at) VALUES(?,?,?,25600,742400,'starter','PENDING',?,?)",
                  (f"ord_{secrets.token_hex(4)}", trader_id, 29.0, now_ts, now_ts + 3600))
        c.execute("INSERT INTO subscriptions(user_id, plan_tier, created_at, updated_at) VALUES(?,?,?,?)", (trader_id, "STARTER", now_ts, now_ts))

    # Login as admin
    client.post("/api/login", json={"email": admin_email, "password": pwd})
    csrf = {"x-zupirus": "1"}

    # Admin lists users
    r_list = client.get("/api/admin/users", headers=csrf)
    assert r_list.status_code == 200
    users = r_list.json()["users"]
    assert any(u["email"] == trader_email for u in users)

    # Admin deletes trader
    r_del = client.delete(f"/api/admin/users/{trader_id}", headers=csrf)
    assert r_del.status_code == 200
    assert r_del.json()["ok"] is True

    # Trader should no longer exist
    with tx() as c:
        assert c.execute("SELECT 1 FROM users WHERE id = ?", (trader_id,)).fetchone() is None
        assert c.execute("SELECT 1 FROM orders WHERE user_id = ?", (trader_id,)).fetchone() is None
        assert c.execute("SELECT 1 FROM subscriptions WHERE user_id = ?", (trader_id,)).fetchone() is None

    # Admin cannot delete themselves
    admin_row = client.get("/api/me").json()
    r_self_del = client.delete(f"/api/admin/users/{admin_row['id']}", headers=csrf)
    assert r_self_del.status_code == 400
