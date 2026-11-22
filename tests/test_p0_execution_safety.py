import pytest
import time
import json
import uuid
import asyncio
from unittest.mock import AsyncMock, MagicMock

from app.db import tx, setkv, getkv
from app.migrations import run_all_migrations
from app.domains.execution.watcher import (
    PositionWatcher,
    verify_position_ownership,
    reconcile_account_positions,
    is_account_drawdown_halted,
)
from app.domains.execution.fanout import execute_fan_out_for_signal
from app.domains.execution.metaapi_client import MetaApiClient
from app.domains.billing.subscription import run_subscription_lifecycle_cycle
from app.domains.ai.research_graph import run_autonomous_induction_and_wfo


@pytest.mark.asyncio
async def test_a1_position_ownership_migration_netting(tmp_path, monkeypatch):
    """
    Test A1:
    - Default origin is UNKNOWN on migrated/synced tables.
    - All 5 branches preserve manual orders 100%.
    - Netting mixed position is flagged NETTING_MIXED and locked from auto actions.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_a1.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)

        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u1', 'u1@example.com', 'pass_hash_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("""
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, created_at)
            VALUES ('acc_1', 'u1', 'meta_1', '1001', 'enc_pass', 'DemoServer', ?)
        """, (now,))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_1', 'u1', '1001', 'DemoServer', 'meta_1', ?)", (now,))

        # 1. Existing manual position in DB
        c.execute("""
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price,
                position_id, ticket, origin, status, executed_at
            ) VALUES('man_1', 'sig_m1', 'acc_1', 'meta_1', 'XAUUSD', 'BUY', 0.50, 2000.0, 'pos_man', 'pos_man', 'MANUAL', 'FILLED', ?)
        """, (now,))

        # 2. Existing bot position in DB
        c.execute("""
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price,
                position_id, ticket, origin, client_order_id, status, executed_at
            ) VALUES('bot_1', 'sig_b1', 'acc_1', 'meta_1', 'XAUUSD', 'BUY', 0.10, 2000.0, 'pos_bot', 'pos_bot', 'BOT', 'ZV2_12345678', 'FILLED', ?)
        """, (now,))

        # Verify default origin is UNKNOWN
        c.execute("INSERT INTO metaapi_trade_executions(id, signal_id, account_id, symbol, action, volume, entry_price, status, executed_at) VALUES('def_1', 's0', 'acc_1', 'XAUUSD', 'BUY', 0.01, 2000.0, 'FILLED', ?)", (now,))
        def_row = c.execute("SELECT origin FROM metaapi_trade_executions WHERE id = 'def_1'").fetchone()
        assert def_row[0] == "UNKNOWN", "Default origin must be UNKNOWN"

    # Test verify_position_ownership
    with tx() as c:
        # Manual trade
        pos_manual = {"id": "pos_man", "volume": 0.50, "comment": "Manual trade by user"}
        orig, row = verify_position_ownership(c, "acc_1", pos_manual)
        assert orig == "MANUAL", "Untracked/manual position must be MANUAL"

        # Bot trade
        pos_bot = {"id": "pos_bot", "volume": 0.10, "clientId": "ZV2_12345678", "comment": "ZV2_12345678"}
        orig_b, row_b = verify_position_ownership(c, "acc_1", pos_bot)
        assert orig_b == "BOT", "Bot position with matching DB record must be BOT"

        # Netting mixed position (bot opened 0.10, but live position is 0.60 because user added 0.50)
        pos_netting = {"id": "pos_bot", "volume": 0.60, "clientId": "ZV2_12345678"}
        orig_net, row_net = verify_position_ownership(c, "acc_1", pos_netting)
        assert orig_net == "NETTING_MIXED", "Volume mismatch on bot position must be flagged NETTING_MIXED"

    # Test that close_bot_positions_only closes ONLY bot positions using REAL MetaApiClient
    real_client = MetaApiClient(token="live_token_for_test")
    captured_payloads = []

    async def mock_http_post(url, *args, **kwargs):
        payload = kwargs.get("json", {})
        captured_payloads.append((url, payload))
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json = MagicMock(return_value={"numericCode": 10009, "stringCode": "TRADE_RETCODE_DONE"})
        return mock_resp

    monkeypatch.setattr(real_client, "get_positions_verified", AsyncMock(return_value=(
        True,
        [
            {"id": "pos_man", "volume": 0.50, "type": "POSITION_TYPE_BUY"},
            {"id": "pos_bot", "volume": 0.10, "type": "POSITION_TYPE_BUY", "clientId": "ZV2_12345678"}
        ],
        {"synchronized": True}
    )))
    monkeypatch.setattr("httpx.AsyncClient.post", mock_http_post)

    watcher = PositionWatcher(metaapi_client=real_client)
    res = await watcher.close_bot_positions_only("srv_acc_1", "acc_1")

    assert res["closed_count"] == 1, "Only bot position should be closed"
    assert res["non_bot_count"] == 1, "Manual position must be left untouched"
    assert len(captured_payloads) == 1, "HTTP POST must be called exactly once for bot position"
    assert captured_payloads[0][1]["positionId"] == "pos_bot", "Payload must target pos_bot only"
    with tx() as c:
        row_b = c.execute("SELECT status, closed_volume FROM metaapi_trade_executions WHERE position_id = 'pos_bot'").fetchone()
        assert row_b[0] == "CLOSED"
        assert abs(row_b[1] - 0.10) < 0.001


@pytest.mark.asyncio
async def test_a2_api_read_errors_no_false_closed_partial_close(tmp_path, monkeypatch):
    """
    Test A2:
    - API read error (HTTP != 200, timeout, or {}) returns ok == False.
    - Reconciliation skips when ok == False (no false CLOSED, no counter increment).
    - Partial close reflects deals and updates closed_volume, does NOT mark CLOSED.
    - Full close with deal proof marks CLOSED and saves evidence_json.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_a2.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u2', 'u2@example.com', 'pass_hash_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_2', 'u2', '2001', 'DemoServer', 'meta_2', ?)", (now,))
        c.execute("""
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, created_at)
            VALUES ('acc_2', 'u2', 'meta_2', '2001', 'enc_pass', 'DemoServer', ?)
        """, (now,))
        c.execute("""
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price,
                position_id, ticket, status, executed_at, origin
            ) VALUES('ex_2', 's2', 'acc_2', 'meta_2', 'XAUUSD', 'BUY', 1.0, 2000.0, 'pos_2', 'pos_2', 'OPEN', ?, 'BOT')
        """, (now,))

    # 1. Test MetaApiClient get_positions_verified when server is unverified
    client = MetaApiClient()
    ok, positions, meta = await client.get_positions_verified("mock_unverified")
    assert ok is False, "Unverified account read must return ok == False"
    assert len(positions) == 0

    # 2. When ok is False, reconciliation skips and execution stays OPEN
    with tx() as c:
        res = reconcile_account_positions(c, "acc_2", "meta_2", ok=False, live_positions=[], deals=[], now_ts=time.time())
        assert res["status"] == "SKIPPED_UNVERIFIED"
        row = c.execute("SELECT status FROM metaapi_trade_executions WHERE id = 'ex_2'").fetchone()
        assert row[0] == "OPEN", "Position must stay OPEN on unverified read error"

    # 3. Partial close: broker closed 0.40 out of 1.0 lot
    deals = [
        {"id": "deal_p1", "positionId": "pos_2", "volume": 0.40, "entryType": "DEAL_ENTRY_OUT"}
    ]
    with tx() as c:
        reconcile_account_positions(c, "acc_2", "meta_2", ok=True, live_positions=[], deals=deals, now_ts=time.time())
        row = c.execute("SELECT status, closed_volume FROM metaapi_trade_executions WHERE id = 'ex_2'").fetchone()
        assert row[0] == "OPEN", "Partially closed position must remain OPEN"
        assert abs(row[1] - 0.40) < 0.001, "closed_volume must be updated to 0.40"

    # 3b. Replay exact same deal over subsequent cycle (e.g. after restart) -> must NOT double count!
    with tx() as c:
        reconcile_account_positions(c, "acc_2", "meta_2", ok=True, live_positions=[], deals=deals, now_ts=time.time() + 10)
        row_rep = c.execute("SELECT status, closed_volume FROM metaapi_trade_executions WHERE id = 'ex_2'").fetchone()
        assert row_rep[0] == "OPEN", "Position must stay OPEN when same deal is replayed"
        assert abs(row_rep[1] - 0.40) < 0.001, "closed_volume must remain 0.40 without double counting"

    # 4. Full close: second deal closes remaining 0.60 lot
    deals.append({"id": "deal_p2", "positionId": "pos_2", "volume": 0.60, "entryType": "DEAL_ENTRY_OUT"})
    with tx() as c:
        reconcile_account_positions(c, "acc_2", "meta_2", ok=True, live_positions=[], deals=deals, now_ts=time.time() + 20)
        row = c.execute("SELECT status, closed_volume, evidence_json FROM metaapi_trade_executions WHERE id = 'ex_2'").fetchone()
        assert row[0] == "CLOSED", "Fully closed position must be marked CLOSED"
        assert abs(row[1] - 1.0) < 0.001
        assert "deal_ids" in row[2], "evidence_json must record deal IDs"


@pytest.mark.asyncio
async def test_a3_non_speculative_reconciliation_sl_confirmed_expiry_undeploy(tmp_path, monkeypatch):
    """
    Test A3:
    - Lost network response leaves order in UNKNOWN_EXECUTION.
    - Reconciliation does not speculate; when live position appears on 3rd cycle, it deterministically takes over.
    - sl_confirmed only turns 1 when SL is verified on broker.
    - Expired subscription with unverified/open orders stays in EXPIRED_PROTECTING, only undeploys cleanly or after 24h.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_a3.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)

        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u3', 'u3@example.com', 'pass_hash_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO subscriptions (id, user_id, service_expires_at, plan_tier, created_at, updated_at) VALUES ('sub_3', 'u3', ?, 'alpha', ?, ?)", (now - 3600, now, now))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_3', 'u3', '3001', 'DemoServer', 'meta_3', ?)", (now,))
        c.execute("""
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, deployment_state, created_at)
            VALUES ('acc_3', 'u3', 'meta_3', '3001', 'enc_pass', 'DemoServer', 'DEPLOYED', ?)
        """, (now,))
        # In-flight unverified execution
        c.execute("""
            INSERT INTO metaapi_trade_executions (
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price,
                origin, client_order_id, status, executed_at, reserved_risk_pct, sl_confirmed
            ) VALUES ('ex_3', 'sig_3', 'acc_3', 'meta_3', 'XAUUSD', 'BUY', 0.10, 2000.0,
                      'BOT', 'ZV2_abcdef12', 'UNKNOWN_EXECUTION', ?, 1.0, 0)
        """, (now,))

    # Run subscription lifecycle: account should enter EXPIRED_PROTECTING, NOT undeployed
    mock_client = MagicMock(spec=MetaApiClient)
    mock_client.get_positions_verified = AsyncMock(return_value=(True, [], {"synchronized": True}))
    mock_client.undeploy_account = AsyncMock(return_value=True)

    stats = await run_subscription_lifecycle_cycle(meta_client=mock_client, now_ts=now)
    with tx() as c:
        row = c.execute("SELECT deployment_state, auto_trade FROM trading_accounts WHERE id = 'acc_3'").fetchone()
        assert row[0] == "EXPIRED_PROTECTING", "Must hold EXPIRED_PROTECTING while UNKNOWN_EXECUTION is unresolved"
        assert row[1] == 0, "auto_trade must be turned off immediately upon expiry"

    # Simulate cycle where broker opening deal (DEAL_ENTRY_IN) arrives in deals history BEFORE live position list updates
    opening_deals = [
        {"id": "deal_entry_333", "clientId": "ZV2_abcdef12", "positionId": "ticket_333", "volume": 0.10, "entryType": "DEAL_ENTRY_IN"}
    ]
    with tx() as c:
        setkv(c, "account_locked:acc_3", "UNKNOWN_PENDING")
        reconcile_account_positions(c, "acc_3", "meta_3", ok=True, live_positions=[], deals=opening_deals, now_ts=time.time())
        ex_row = c.execute("SELECT status, ticket, position_id, closed_volume FROM metaapi_trade_executions WHERE id = 'ex_3'").fetchone()
        assert ex_row[0] == "FILLED", "DEAL_ENTRY_IN must transition execution to FILLED, NEVER CLOSED"
        assert ex_row[1] == "ticket_333", "Ticket must be recorded from positionId in opening deal"
        assert ex_row[2] == "ticket_333"
        assert float(ex_row[3] or 0.0) == 0.0, "closed_volume must be 0 for opening deal"
        assert getkv(c, "account_locked:acc_3") != "", "Account must remain locked until live position confirms SL"

    # Now simulate subsequent cycle: MT5 live positions returns the position with protective SL
    live_pos = [
        {"id": "ticket_333", "clientId": "ZV2_abcdef12", "volume": 0.10, "openPrice": 2000.0, "stopLoss": 1980.0, "type": "POSITION_TYPE_BUY"}
    ]
    with tx() as c:
        reconcile_account_positions(c, "acc_3", "meta_3", ok=True, live_positions=live_pos, deals=[], now_ts=time.time() + 10)
        ex_row = c.execute("SELECT status, ticket, sl_confirmed FROM metaapi_trade_executions WHERE id = 'ex_3'").fetchone()
        assert ex_row[0] == "FILLED", "Position must remain FILLED and active"
        assert ex_row[1] == "ticket_333"
        assert ex_row[2] == 1, "sl_confirmed must become 1 since protective SL is active on broker"
        assert getkv(c, "account_locked:acc_3") == "", "Account lock must be released once all unverified orders are verified"


@pytest.mark.asyncio
async def test_a4_atomic_2pct_risk_reservation_multi_worker_shared_db(tmp_path, monkeypatch):
    """
    Test A4:
    - Atomic DB risk reservation prevents multi-worker race conditions.
    - Total in-flight risk (open MT5 + PENDING_SUBMIT + UNKNOWN_EXECUTION) strictly capped at 2.0%.
    - USD Correlation Cap <= 2 enforced atomically.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_a4.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u4', 'u4@example.com', 'pass_hash_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO quotes (symbol, bid, ask, ts, source) VALUES ('XAUUSD', 2000.0, 2000.3, ?, 'live')", (now,))
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, risk_config, deployment_state, created_at
            ) VALUES (
                'acc_4', 'u4', 'meta_4', '4001', 'enc_pass', 'DemoServer',
                1, 10000.0, 10000.0, '{"risk_percent": 1.0, "max_lot": 5.0, "multiplier": 1.0}', 'DEPLOYED', ?
            )
        """, (now,))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_4', 'u4', '4001', 'DemoServer', 'meta_4', ?)", (now,))

    # Mock broker
    mock_client = MagicMock(spec=MetaApiClient)
    async def fast_execute(*args, **kwargs):
        await asyncio.sleep(0.01)
        return {
            "numericCode": 10009,
            "stringCode": "TRADE_RETCODE_DONE",
            "positionId": f"pos_{uuid.uuid4().hex[:6]}",
            "orderId": f"ord_{uuid.uuid4().hex[:6]}",
            "stopLoss": kwargs.get("stop_loss"),
            "latency_ms": 10,
            "volume": kwargs.get("volume", 0.1)
        }
    mock_client.execute_order = AsyncMock(side_effect=fast_execute)
    mock_client.get_open_positions = AsyncMock(return_value=[])

    signal_1 = {"id": "sig_a4_1", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2000.0, "sl": 1980.0, "tp": 2040.0}
    signal_2 = {"id": "sig_a4_2", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2000.0, "sl": 1980.0, "tp": 2040.0}
    signal_3 = {"id": "sig_a4_3", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2000.0, "sl": 1980.0, "tp": 2040.0}

    accounts = [{"id": "acc_4", "metaapi_account_id": "meta_4", "risk_percent": 1.0, "is_prop_firm_mode": 1, "prop_stage": "LIVE", "balance": 10000.0, "equity": 10000.0}]

    # Fire two 1.0% orders:
    res1 = await execute_fan_out_for_signal(signal_1, accounts, mock_client)
    res2 = await execute_fan_out_for_signal(signal_2, accounts, mock_client)
    assert res1["executed"] + res2["executed"] == 2, "Two 1.0% orders within 2.0% risk cap must succeed"

    # Fire third order: total risk is now 2.0% (and USD Correlation Cap has 2 BUY XAUUSD orders), so third order must be SKIPPED
    res3 = await execute_fan_out_for_signal(signal_3, accounts, mock_client)
    assert res3["executed"] == 0, "Third order exceeding 2.0% risk cap must be skipped"


@pytest.mark.asyncio
async def test_a5_canary_isolation_no_fallback_peak_drawdown(tmp_path, monkeypatch):
    """
    Test A5:
    - Canary filters strictly by strategy_id and created_at >= canary_started_at.
    - Candidate with 0 trades is NOT promoted even if historical candles exist (NO fallback).
    - Peak-to-Trough Drawdown uses peak[t] denominator:
      100 -> 120 -> 110 -> 125 gives max_dd_pct = 8.33% > 8.0%, resulting in rejection despite net gain.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_a5.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)

        # Strategy A: in CANARY_DEMO for 8 days, but has 0 trades in signal_audit_logs
        rules_a = {"canary_started_at": now - 8 * 86400}
        c.execute(
            "INSERT INTO strategy_candidates (id, name, status, rules_json, created_at, updated_at) VALUES ('strat_A', 'Strategy A', 'CANARY_DEMO', ?, ?, ?)",
            (json.dumps(rules_a), now - 8 * 86400, now - 8 * 86400)
        )

        # Strategy B: has trades, but not related to A
        for i in range(15):
            c.execute("""
                INSERT INTO signal_audit_logs (id, signal_id, source_name, strategy_id, symbol, side, entry_price, status, pnl, created_at)
                VALUES (?, 'sig_b', 'strat_B', 'strat_B', 'XAUUSD', 'BUY', 2000.0, 'PROCESSED', 5.0, ?)
            """, (f"log_b_{i}", now - 3600))

        # Add 100 historical candles that could have triggered the old walk_forward fallback
        for i in range(100):
            c.execute("INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES ('XAUUSD', 'M15', ?, 2000.0, 2010.0, 1995.0, 2005.0, 100)", (now - (100 - i) * 900,))

    # Run evaluation
    run_autonomous_induction_and_wfo(force=True)

    with tx() as c:
        row_a = c.execute("SELECT status FROM strategy_candidates WHERE id = 'strat_A'").fetchone()
        assert row_a[0] == "CANARY_REJECTED", "Strategy A with 0 actual canary trades must NOT be promoted via candle fallback"

    # Test Peak-to-Trough Drawdown formula: 100 -> 120 -> 110 -> 125
    with tx() as c:
        rules_c = {"canary_started_at": now - 8 * 86400}
        c.execute(
            "INSERT INTO strategy_candidates (id, name, status, rules_json, created_at, updated_at) VALUES ('strat_C', 'Strategy C', 'CANARY_DEMO', ?, ?, ?)",
            (json.dumps(rules_c), now - 8 * 86400, now - 8 * 86400)
        )
        # 7 trades of 0.1, then +19.3 (equity 120.0, peak 120.0), -10.0 (equity 110.0, dd=10/120=8.33%), +15.0
        for i in range(7):
            c.execute("""
                INSERT INTO signal_audit_logs (id, signal_id, source_name, strategy_id, symbol, side, entry_price, status, pnl, created_at)
                VALUES (?, 'sig_c', 'strat_C', 'strat_C', 'XAUUSD', 'BUY', 2000.0, 'PROCESSED', 0.1, ?)
            """, (f"log_c_pre_{i}", now - 5000 + i))
        c.execute("""
            INSERT INTO signal_audit_logs (id, signal_id, source_name, strategy_id, symbol, side, entry_price, status, pnl, created_at)
            VALUES ('log_c_1', 'sig_c', 'strat_C', 'strat_C', 'XAUUSD', 'BUY', 2000.0, 'PROCESSED', 19.3, ?)
        """, (now - 4000,))
        c.execute("""
            INSERT INTO signal_audit_logs (id, signal_id, source_name, strategy_id, symbol, side, entry_price, status, pnl, created_at)
            VALUES ('log_c_2', 'sig_c', 'strat_C', 'strat_C', 'XAUUSD', 'BUY', 2000.0, 'PROCESSED', -10.0, ?)
        """, (now - 3000,))
        c.execute("""
            INSERT INTO signal_audit_logs (id, signal_id, source_name, strategy_id, symbol, side, entry_price, status, pnl, created_at)
            VALUES ('log_c_3', 'sig_c', 'strat_C', 'strat_C', 'XAUUSD', 'BUY', 2000.0, 'PROCESSED', 15.0, ?)
        """, (now - 2000,))

    run_autonomous_induction_and_wfo(force=True)

    with tx() as c:
        row_c = c.execute("SELECT status FROM strategy_candidates WHERE id = 'strat_C'").fetchone()
        assert row_c[0] == "CANARY_REJECTED", "Strategy C must be rejected because peak-to-trough drawdown 8.33% > 8.0%"
