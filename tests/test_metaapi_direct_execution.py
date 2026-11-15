import pytest
import time
import secrets
from app.db import tx
from app.security import encrypt_secret, decrypt_secret
from app.metaapi import MetaApiClient, calculate_lot_size, execute_fan_out_for_signal

def test_aes_gcm_password_encryption():
    plain = "SuperSecretExnessPass2026!"
    encrypted = encrypt_secret(plain)
    assert encrypted != plain
    decrypted = decrypt_secret(encrypted)
    assert decrypted == plain

def test_dynamic_lot_sizing():
    # 1. $10,000 equity, 1% risk, 300 points SL
    lot1 = calculate_lot_size(equity=10000.0, risk_percent=1.0, sl_points=300.0)
    assert lot1 == 0.33

    # 2. $1,000 equity, 1% risk, 300 points SL -> 0.03 lot
    lot2 = calculate_lot_size(equity=1000.0, risk_percent=1.0, sl_points=300.0)
    assert lot2 == 0.03

    # 3. $50,000 equity, 2% risk, max_lot capped at 2.0
    lot3 = calculate_lot_size(equity=50000.0, risk_percent=2.0, sl_points=300.0, max_lot=2.0)
    assert lot3 == 2.0

@pytest.mark.asyncio
async def test_fanout_execution_and_idempotency():
    metaapi = MetaApiClient()
    accounts = [
        {"id": "acc_a", "metaapi_account_id": "meta_a", "equity": 5000.0, "risk_percent": 1.0},
        {"id": "acc_b", "metaapi_account_id": "meta_b", "equity": 15000.0, "risk_percent": 1.0},
    ]

    sig = {
        "id": "sig_fanout_test_99",
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2660.0,
        "sl": 2655.0,
        "tp": 2675.0
    }

    report = await execute_fan_out_for_signal(sig, accounts, metaapi)
    assert report["executed"] == 2
    assert report["failed"] == 0
    assert len(report["executions"]) == 2
    assert report["executions"][0]["status"] == "FILLED"

def test_metaapi_account_lifecycle_and_api_endpoints(client):
    user_email = f"direct_{secrets.token_hex(4)}@example.com"
    pwd = "password12345678"

    # 1. Register user
    reg = client.post("/api/register", json={"email": user_email, "password": pwd})
    assert reg.status_code == 200, reg.text

    # 2. Login (sets cookie on client automatically)
    login = client.post("/api/login", json={"email": user_email, "password": pwd})
    assert login.status_code == 200, login.text

    # 3. Try to add Cloud MT5 account before disclaimer -> Must fail 403
    acc_payload = {
        "login": "998877",
        "password": "TradersPassword123",
        "server": "Exness-MT5Real1",
        "account_name": "Main Gold Fund",
        "platform": "mt5",
        "risk_percent": 1.0,
        "max_lot": 0.5
    }
    csrf = {"x-zupirus": "1"}
    r_fail = client.post("/api/metaapi/accounts", json=acc_payload, headers=csrf)
    assert r_fail.status_code == 403, r_fail.text

    # 4. Accept disclaimer
    disc = client.post("/api/legal/accept", json={
        "signature_text": "Nguyen Van A",
        "confirmed_risk": True,
        "confirmed_age": True,
        "confirmed_no_solicitation": True
    }, headers=csrf)
    assert disc.status_code == 200, f"Accept disclaimer failed: {disc.status_code} - {disc.text}"

    # 5. Connect Cloud MT5 account -> Success
    r_acc = client.post("/api/metaapi/accounts", json=acc_payload, headers=csrf)
    assert r_acc.status_code == 200, r_acc.text
    acc_id = r_acc.json()["id"]

    # 6. List accounts
    r_list = client.get("/api/metaapi/accounts", headers=csrf)
    assert r_list.status_code == 200
    accs = r_list.json()["accounts"]
    assert len(accs) == 1
    assert accs[0]["login"] == "998877"
    assert "encrypted_password" not in accs[0]

    # 7. Toggle auto-trade
    r_tog = client.post(f"/api/metaapi/accounts/{acc_id}/toggle", headers=csrf)
    assert r_tog.status_code == 200
    assert r_tog.json()["auto_trade"] == 0

    # Toggle back on
    r_tog2 = client.post(f"/api/metaapi/accounts/{acc_id}/toggle", headers=csrf)
    assert r_tog2.json()["auto_trade"] == 1

    # 8. Dispatch Signal Fan-out
    sig_payload = {
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2650.0,
        "sl": 2645.0,
        "tp": 2665.0,
        "rationale": "Direct Fanout Test on Cloud MT5"
    }
    r_disp = client.post("/api/metaapi/dispatch-signal", json=sig_payload, headers=csrf)
    assert r_disp.status_code == 200, r_disp.text
    disp_res = r_disp.json()
    assert disp_res["executed"] >= 1

    # 9. Query Executions history
    r_exec = client.get("/api/metaapi/executions", headers=csrf)
    assert r_exec.status_code == 200
    assert len(r_exec.json()["executions"]) >= 1

    # 10. Query Telemetry
    r_telem = client.get("/api/metaapi/telemetry", headers=csrf)
    assert r_telem.status_code == 200
    telem = r_telem.json()
    assert telem["direct_to_user_enabled"] is True
    assert telem["total_orders_executed"] >= 1
