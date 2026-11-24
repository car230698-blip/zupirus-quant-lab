import pytest
import time
from fastapi.testclient import TestClient
from app.main import app
from app.db import tx
from app.routers.deps import get_current_user

def test_dashboard_and_accounts_show_cloud_trading_account():
    test_user_id = "test_user_cloud_dash_123"
    test_account_id = "acc_test_cloud_dash_456"
    test_login = "279821746"
    test_server = "Exness-MT5Trial8"

    with tx() as c:
        # Create user if needed
        c.execute(
            "INSERT OR IGNORE INTO users (id, email, password, role) VALUES (?, ?, ?, ?)",
            (test_user_id, "test_cloud@example.com", "hash", "customer"),
        )
        # Create trading_accounts record
        c.execute(
            """
            INSERT OR REPLACE INTO trading_accounts (
                id, user_id, mt5_login, encrypted_master_password, broker_server,
                metaapi_account_id, deployment_state, auto_trade, balance, equity,
                created_at, last_sync
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                test_account_id,
                test_user_id,
                test_login,
                "enc_pwd",
                test_server,
                "meta_123",
                "DEPLOYED",
                1,
                1000.0,
                1050.0,
                time.time(),
                time.time(),
            ),
        )

    app.dependency_overrides[get_current_user] = lambda: {
        "id": test_user_id,
        "email": "test_cloud@example.com",
        "role": "customer",
    }

    try:
        client = TestClient(app)

        # 1. Test /api/dashboard returns the account
        res_dash = client.get("/api/dashboard")
        assert res_dash.status_code == 200, res_dash.text
        dash_data = res_dash.json()
        dash_accs = dash_data.get("accounts", [])
        assert len(dash_accs) >= 1
        found_dash = next((a for a in dash_accs if a.get("id") == test_account_id), None)
        assert found_dash is not None, f"Account {test_account_id} not found in dashboard accounts: {dash_accs}"
        assert str(found_dash.get("login") or found_dash.get("mt5_login")) == test_login
        assert found_dash.get("server") == test_server
        assert found_dash.get("deployment_state") == "DEPLOYED"

        # 2. Test /api/v1/accounts returns the account
        res_acc = client.get("/api/v1/accounts")
        assert res_acc.status_code == 200, res_acc.text
        acc_data = res_acc.json()
        acc_list = acc_data.get("accounts", [])
        assert len(acc_list) >= 1
        found_acc = next((a for a in acc_list if a.get("id") == test_account_id), None)
        assert found_acc is not None
        assert str(found_acc.get("login")) == test_login
        assert found_acc.get("is_active") is True
        assert found_acc.get("is_real") is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)
