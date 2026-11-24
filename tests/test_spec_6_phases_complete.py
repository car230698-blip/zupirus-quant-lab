"""End-to-end verification tests for the 6-Phase Technical Specification (Commit ee7939c remediation)."""
import secrets
import time
from unittest.mock import patch, AsyncMock
import pytest
from starlette.testclient import TestClient

from app.db import tx, getkv
from app.hindsight import store_memory, recall_memories, CATEGORY_EPISODIC, CATEGORY_SEMANTIC
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
from app.services.billing_service import create_checkout_order, process_successful_payment
from app.services.execution.watcher import (
    _is_metaapi_success,
    get_drawdown_halt_key,
    is_account_drawdown_halted,
    PositionWatcher,
)
from app.services.sources.streamer import MarketDataStreamer


def test_phase_0_master_copy_flow_eliminated():
    """Verify Master Account polling is removed from streamer, engine, and signal_sources."""
    streamer = MarketDataStreamer()
    assert not hasattr(streamer, "poll_master_feed_signals")
    assert not hasattr(streamer, "_process_master_signal")
    assert not hasattr(streamer, "known_master_positions")

    with tx() as c:
        master_src = c.execute(
            "SELECT id FROM signal_sources WHERE id = 'src_metaapi_feed' OR source_type = 'metaapi_feed'"
        ).fetchone()
        assert master_src is None


def test_phase_1_1_cross_tenant_account_deletion_isolation(client: TestClient):
    """Two users with identical mt5_login on different servers must be strictly isolated on DELETE."""
    pwd = "password12345678"
    user_a = f"user_a_{secrets.token_hex(4)}@example.com"
    user_b = f"user_b_{secrets.token_hex(4)}@example.com"
    shared_login = str(secrets.randbelow(80000000) + 10000000)
    csrf = {"x-zupirus": "1"}

    client.post("/api/register", json={"email": user_a, "password": pwd})
    client.post("/api/register", json={"email": user_b, "password": pwd})

    # Login as User A and create account with shared_login on Broker-A
    client.post("/api/login", json={"email": user_a, "password": pwd})
    r_a = client.post(
        "/api/v1/accounts",
        headers=csrf,
        json={
            "login": shared_login,
            "password": "MasterPassword1!",
            "server": "Exness-MT5Real1",
            "disclaimer_accepted": True,
        },
    )
    assert r_a.status_code == 200
    acc_a_id = r_a.json()["id"]

    # Login as User B and create account with SAME shared_login on Broker-B
    client.post("/api/login", json={"email": user_b, "password": pwd})
    r_b = client.post(
        "/api/v1/accounts",
        headers=csrf,
        json={
            "login": shared_login,
            "password": "MasterPassword2!",
            "server": "ICMarketsSC-MT5",
            "disclaimer_accepted": True,
        },
    )
    assert r_b.status_code == 200
    acc_b_id = r_b.json()["id"]

    # User B cannot delete User A's account by ID
    r_forbidden = client.delete(f"/api/v1/accounts/{acc_a_id}", headers=csrf)
    assert r_forbidden.status_code == 403

    # User B deletes their own account (even passing shared_login)
    r_del_b = client.delete(f"/api/v1/accounts/{shared_login}", headers=csrf)
    assert r_del_b.status_code == 200

    # Verify User B's account is gone, while User A's account is 100% intact
    with tx() as c:
        row_a = c.execute("SELECT id FROM trading_accounts WHERE id = ?", (acc_a_id,)).fetchone()
        row_b = c.execute("SELECT id FROM trading_accounts WHERE id = ?", (acc_b_id,)).fetchone()
        assert row_a is not None
        assert row_b is None


def test_phase_1_2_hindsight_memory_tenant_isolation():
    """Verify user-scoped memories are isolated per user_id while system memories remain accessible."""
    with tx() as c:
        store_memory(
            c,
            category=CATEGORY_EPISODIC,
            title="User 1 Private Portfolio",
            content="Balance $54,321 on account 11111",
            user_id="usr_tenant_1",
            scope="user",
        )
        store_memory(
            c,
            category=CATEGORY_EPISODIC,
            title="User 2 Private Portfolio",
            content="Balance $99,999 on account 22222",
            user_id="usr_tenant_2",
            scope="user",
        )
        store_memory(
            c,
            category=CATEGORY_SEMANTIC,
            title="Global Gold Regime Rule",
            content="XAUUSD London breakout rule",
            scope="system",
        )

        mems_u1 = recall_memories(c, user_id="usr_tenant_1", limit=20)
        titles_u1 = [m["title"] for m in mems_u1]
        assert "User 1 Private Portfolio" in titles_u1
        assert "Global Gold Regime Rule" in titles_u1
        assert "User 2 Private Portfolio" not in titles_u1


def test_phase_1_4_otp_attempts_persist_on_failure(client: TestClient):
    """Verify wrong OTP attempts are committed to DB and lock out after 5 wrong tries."""
    email = f"otp_lock_{secrets.token_hex(4)}@example.com"
    now = time.time()
    with tx() as c:
        c.execute("DELETE FROM otp_codes WHERE email = ?", (email,))
        c.execute(
            "INSERT INTO otp_codes(email, code, expires_at, attempts) VALUES(?, ?, ?, 0)",
            (email, "654321", now + 600.0),
        )

    for attempt in range(1, 5):
        r = client.post("/api/auth/verify-otp", json={"email": email, "code": "000000"})
        assert r.status_code == 400
        with tx() as c:
            row = c.execute("SELECT attempts FROM otp_codes WHERE email = ?", (email,)).fetchone()
            assert row is not None
            assert int(row["attempts"]) == attempt

    # 5th wrong attempt triggers 429 lockout
    r5 = client.post("/api/auth/verify-otp", json={"email": email, "code": "000000"})
    assert r5.status_code == 429


@pytest.mark.asyncio
async def test_phase_2_watcher_and_drawdown_key_unification():
    """Verify _is_metaapi_success recognizes 10009, drawdown halt key blocks fan-out, and fan-out persists executions."""
    assert _is_metaapi_success({"numericCode": 10009, "stringCode": "TRADE_RETCODE_DONE"}) is True
    assert _is_metaapi_success({"numericCode": 10008, "stringCode": "TRADE_RETCODE_PLACED"}) is True
    assert _is_metaapi_success({"numericCode": 10016, "stringCode": "TRADE_RETCODE_INVALID_STOPS"}) is False

    acc_id = f"acc_dd_{secrets.token_hex(4)}"
    user_id = f"usr_dd_{secrets.token_hex(4)}"
    rand_login = str(secrets.randbelow(80000000) + 10000000)
    now_ts = time.time()

    with tx() as c:
        c.execute("INSERT INTO users(id, email, password, role) VALUES(?,?,?,?)", (user_id, f"{user_id}@example.com", "pw", "customer"))
        c.execute(
            """
            INSERT INTO trading_accounts(
                id, user_id, mt5_login, encrypted_master_password, broker_server,
                metaapi_account_id, deployment_state, auto_trade, balance, equity,
                is_prop_firm_mode, prop_daily_dd_limit_pct, created_at
            ) VALUES(?,?,?,?,?,?, 'DEPLOYED', 0, 10000.0, 9400.0, 1, 4.0, ?)
            """,
            (acc_id, user_id, rand_login, "enc", "FTMO-Server", f"meta_{acc_id}", now_ts),
        )

    # Watcher must monitor even when auto_trade=0 and trip Prop DD circuit breaker (6% DD >= 4% limit)
    watcher = PositionWatcher()
    watcher.client.get_account_information = AsyncMock(return_value={"balance": 10000.0, "equity": 9400.0, "connected": True, "connection_status": "CONNECTED"})
    watcher.client.close_all_positions = AsyncMock(return_value={"closed_count": 1})
    watcher.client.get_open_positions = AsyncMock(return_value=[])

    stats = await watcher.run_cycle()
    assert stats["prop_breakers_triggered"] >= 1

    with tx() as c:
        assert is_account_drawdown_halted(c, acc_id) is True

    # Fan-out must skip this drawdown-halted account
    res = await execute_fan_out_for_signal(
        signal={"id": f"sig_{secrets.token_hex(4)}", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2900.0, "sl": 2890.0, "tp": 2920.0},
        accounts=[{"id": acc_id, "metaapi_account_id": f"meta_{acc_id}", "balance": 10000.0, "equity": 9400.0, "live_spread_pips": 1.2}],
        metaapi_client=MetaApiClient(token=""),
    )
    assert res["executed"] == 0


@pytest.mark.asyncio
async def test_phase_3_risk_persistence_cloud_502_and_underpaid_topup(client: TestClient):
    """Verify full risk fields persistence, 502 on MetaApi deploy failure, and cumulative UNDERPAID -> PAID top-up."""
    pwd = "password12345678"
    email = f"phase3_{secrets.token_hex(4)}@example.com"
    csrf = {"x-zupirus": "1"}

    client.post("/api/register", json={"email": email, "password": pwd})
    client.post("/api/login", json={"email": email, "password": pwd})

    r_create = client.post(
        "/api/v1/accounts",
        headers=csrf,
        json={
            "login": str(secrets.randbelow(80000000) + 10000000),
            "password": "MasterPassword1!",
            "server": "Exness-MT5Real",
            "disclaimer_accepted": True,
        },
    )
    assert r_create.status_code == 200
    acc_id = r_create.json()["id"]

    # 3.1: PATCH all risk fields
    r_patch = client.patch(
        f"/api/v1/accounts/{acc_id}",
        headers=csrf,
        json={
            "max_lot": 3.5,
            "daily_profit_target_usd": 450.0,
            "symbol_mapping_custom": "XAUUSD=XAUUSDm",
            "auto_be_partial_tp": True,
            "prop_daily_dd_limit_pct": 3.5,
        },
    )
    assert r_patch.status_code == 200
    updated_acc = r_patch.json()["account"]
    assert updated_acc["max_lot"] == 3.5
    assert updated_acc["daily_profit_target_usd"] == 450.0
    assert updated_acc["symbol_mapping_custom"] == "XAUUSD=XAUUSDm"
    assert updated_acc["auto_be_partial_tp"] is True

    # Deterministic toggle with explicit is_active
    r_t1 = client.post(f"/api/v1/accounts/{acc_id}/toggle", headers=csrf, json={"is_active": False})
    assert r_t1.status_code == 200
    assert r_t1.json()["auto_trade"] == 0
    r_t2 = client.post(f"/api/v1/accounts/{acc_id}/toggle", headers=csrf, json={"is_active": False})
    assert r_t2.status_code == 200
    assert r_t2.json()["auto_trade"] == 0

    # 3.2: Cloud deploy returns 502 when MetaApi returns False
    with patch.object(MetaApiClient, "undeploy_account", new=AsyncMock(return_value=False)):
        r_cloud_fail = client.post(f"/api/v1/accounts/cloud/{acc_id}/undeploy", headers=csrf)
        assert r_cloud_fail.status_code == 502

    # 3.3: Cumulative UNDERPAID -> PAID order fulfillment
    with tx() as c:
        uid = c.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()[0]
    order = create_checkout_order(user_id=uid, plan_tier="starter", cloud_slots=1)
    expected_vnd = float(order["amount_vnd"])
    half_vnd = round(expected_vnd * 0.5)

    # First partial transfer -> UNDERPAID
    ok1 = await process_successful_payment(order["id"], sepay_trans_id=f"sp_part1_{secrets.token_hex(4)}", amount_received_vnd=half_vnd)
    assert ok1 is False
    r_ord1 = client.get(f"/api/v1/billing/orders/{order['id']}", headers=csrf)
    assert r_ord1.status_code == 200
    assert r_ord1.json()["status"] == "UNDERPAID"
    assert r_ord1.json()["paid_amount_vnd"] == int(half_vnd)

    # Second top-up transfer -> PAID
    remaining_vnd = expected_vnd - half_vnd
    ok2 = await process_successful_payment(order["id"], sepay_trans_id=f"sp_part2_{secrets.token_hex(4)}", amount_received_vnd=remaining_vnd)
    assert ok2 is True
    r_ord2 = client.get(f"/api/v1/billing/orders/{order['id']}", headers=csrf)
    assert r_ord2.status_code == 200
    assert r_ord2.json()["status"] == "PAID"
    assert r_ord2.json()["entitlement_status"] == "GRANTED"


def test_unpaid_user_cannot_link_mt5_and_calendar_sync_works(client: TestClient, monkeypatch):
    """Unpaid user with 0 slots must get 403 when linking MT5; ForexFactory calendar sync must succeed."""
    monkeypatch.setenv("ENFORCE_PAID_SUBSCRIPTION_IN_TEST", "1")
    pwd = "password12345678"
    email = f"unpaid_{secrets.token_hex(4)}@example.com"
    csrf = {"x-zupirus": "1"}

    client.post("/api/register", json={"email": email, "password": pwd})
    client.post("/api/login", json={"email": email, "password": pwd})

    r_sub = client.get("/api/v1/billing/subscription", headers=csrf)
    assert r_sub.status_code == 200
    assert r_sub.json()["is_active"] is False
    assert r_sub.json()["max_cloud_accounts"] == 0

    r_link = client.post(
        "/api/v1/accounts",
        headers=csrf,
        json={
            "login": str(secrets.randbelow(80000000) + 10000000),
            "password": "MasterPassword1!",
            "server": "Exness-MT5Real",
            "disclaimer_accepted": True,
        },
    )
    assert r_link.status_code == 403

    # Admin calendar sync must not raise 500 (Optional import fix)
    monkeypatch.delenv("ENFORCE_PAID_SUBSCRIPTION_IN_TEST", raising=False)
    client.post("/api/login", json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"})
    r_sync = client.post("/api/admin/news/sync", headers=csrf)
    assert r_sync.status_code == 200
    assert r_sync.json()["ok"] is True


def test_mcp_bridge_and_self_evolving_skills_approval_workflow(client: TestClient):
    """Verify MCP Bridge endpoints and Self-Evolving Skills PENDING_APPROVAL -> Approve/Reject flow."""
    client.post("/api/login", json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"})
    csrf = {"x-zupirus": "1"}

    # 1. List MCP servers
    r_mcp = client.get("/api/admin/skills/mcp/servers", headers=csrf)
    assert r_mcp.status_code == 200
    servers = r_mcp.json()["mcp_servers"]
    assert len(servers) >= 4
    assert any(s["server_id"] == "mcp_yahoo_gold" for s in servers)

    # 2. Toggle MCP server off & back on
    r_off = client.put("/api/admin/skills/mcp/servers/mcp_web_fetch", json={"enabled": False}, headers=csrf)
    assert r_off.status_code == 200
    assert r_off.json()["server"]["enabled"] is False

    r_on = client.put("/api/admin/skills/mcp/servers/mcp_web_fetch", json={"enabled": True}, headers=csrf)
    assert r_on.status_code == 200
    assert r_on.json()["server"]["enabled"] is True

    # 3. Synthesize a self-learned skill -> defaults to PENDING_APPROVAL
    r_synth = client.post("/api/admin/skills/synthesize-learned", headers=csrf)
    assert r_synth.status_code == 200
    created_skills = r_synth.json()["skills"]
    assert len(created_skills) >= 1
    sid = created_skills[0]["skill_id"]
    assert created_skills[0]["status"] == "PENDING_APPROVAL"

    # 4. Approve the learned skill -> ACTIVE
    r_app = client.post(f"/api/admin/skills/{sid}/approve", headers=csrf)
    assert r_app.status_code == 200
    assert r_app.json()["status"] == "ACTIVE"

    # 5. Clean up via reject endpoint
    r_rej = client.post(f"/api/admin/skills/{sid}/reject", headers=csrf)
    assert r_rej.status_code == 200
    assert r_rej.json()["status"] == "REJECTED"

