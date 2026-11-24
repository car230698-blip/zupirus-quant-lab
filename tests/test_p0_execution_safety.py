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

    # Fire concurrent orders simultaneously across simulated workers:
    res_pair = await asyncio.gather(
        execute_fan_out_for_signal(signal_1, accounts, mock_client),
        execute_fan_out_for_signal(signal_2, accounts, mock_client),
    )
    total_executed = sum(r["executed"] for r in res_pair)
    assert total_executed == 2, "Two concurrent 1.0% orders within 2.0% risk cap must succeed"

    # Fire concurrent third and fourth orders: both must be blocked because in-flight risk is already 2.0%
    res_excess = await asyncio.gather(
        execute_fan_out_for_signal(signal_3, accounts, mock_client),
        execute_fan_out_for_signal({"id": "sig_a4_4", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2000.0, "sl": 1980.0, "tp": 2040.0}, accounts, mock_client),
    )
    assert sum(r["executed"] for r in res_excess) == 0, "Concurrent orders exceeding 2.0% risk cap must be skipped"

    with tx() as c:
        total_reserved = c.execute(
            "SELECT sum(reserved_risk_pct) FROM metaapi_trade_executions WHERE account_id = 'acc_4' AND status IN ('PENDING_SUBMIT', 'FILLED')"
        ).fetchone()[0]
        assert float(total_reserved or 0.0) <= 2.001, f"Total reserved risk {total_reserved}% must never exceed 2.0%"


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


@pytest.mark.asyncio
async def test_a6_operational_invariants_and_edge_cases(tmp_path, monkeypatch):
    """
    Test A6:
    1. Partial close on UNKNOWN_EXECUTION keeps status FILLED (not CLOSED) and preserves remaining volume.
    2. TRADE_RETCODE_DONE_PARTIAL in close_bot_positions_only does not mark position CLOSED.
    3. Personal account and challenge prop account pass fanout without risk_cfg NameError.
    4. Subscription lifecycle fail-closed: failed get_open_orders prevents premature undeployment.
    5. Handover alert imports and dispatches cleanly to both user and admin.
    6. Broker circuit breaker is shared across accounts sharing the same broker_server.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_a6.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u6', 'u6@example.com', 'pass_hash_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO quotes (symbol, bid, ask, ts, source) VALUES ('XAUUSD', 2000.0, 2000.3, ?, 'live')", (now,))
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, risk_config, deployment_state, created_at
            ) VALUES (
                'acc_pers', 'u6', 'meta_pers', '6001', 'enc_pass', 'CommonBrokerServer',
                1, 10000.0, 10000.0, '{"risk_percent": 1.0, "max_lot": 5.0, "max_portfolio_risk_pct": 2.0}', 'DEPLOYED', ?
            )
        """, (now,))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_pers', 'u6', '6001', 'CommonBrokerServer', 'meta_pers', ?)", (now,))

    # 1. Partial close test on UNKNOWN_EXECUTION: 0.50 lot closed on a 1.00 lot position
    with tx() as c:
        c.execute("""
            INSERT INTO metaapi_trade_executions (
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price,
                client_order_id, status, origin, executed_at
            ) VALUES (
                'uexec_part', 'sig_part', 'acc_pers', 'meta_pers', 'XAUUSD', 'BUY', 1.00, 2000.0,
                'ZV2_part123', 'UNKNOWN_EXECUTION', 'BOT', ?
            )
        """, (now,))
        setkv(c, "account_locked:acc_pers", "UNKNOWN_PENDING")

        part_deals = [
            {"id": "deal_part_out", "clientId": "ZV2_part123", "positionId": "pos_part_1", "volume": 0.50, "entryType": "DEAL_ENTRY_OUT"}
        ]
        live_part_positions = [
            {"id": "pos_part_1", "clientId": "ZV2_part123", "volume": 0.50, "stopLoss": 1980.0, "openPrice": 2000.0, "type": "POSITION_TYPE_BUY"}
        ]
        reconcile_account_positions(c, "acc_pers", "meta_pers", ok=True, live_positions=live_part_positions, deals=part_deals, now_ts=now)

        row = c.execute("SELECT status, closed_volume FROM metaapi_trade_executions WHERE id = 'uexec_part'").fetchone()
        assert row[0] == "FILLED", "Partially closed position must remain FILLED, NEVER marked CLOSED"
        assert float(row[1]) == 0.50, "closed_volume must reflect partial 0.50 lot closed"

    # 2. close_bot_positions_only with TRADE_RETCODE_DONE_PARTIAL
    mock_client = MagicMock(spec=MetaApiClient)
    mock_client.close_position = AsyncMock(return_value={
        "numericCode": 10009,
        "stringCode": "TRADE_RETCODE_DONE_PARTIAL",
        "volume": 0.50,
        "message": "Partially executed"
    })
    mock_client.get_positions_verified = AsyncMock(return_value=(True, live_part_positions, {"synchronized": True}))

    watcher = PositionWatcher(mock_client)
    res_close = await watcher.close_bot_positions_only("meta_pers", "acc_pers")
    assert res_close["failed_count"] >= 1, "Partial close must NOT be counted as complete close"
    with tx() as c:
        row = c.execute("SELECT status FROM metaapi_trade_executions WHERE id = 'uexec_part'").fetchone()
        assert row[0] != "CLOSED", "TRADE_RETCODE_DONE_PARTIAL must never set status to CLOSED"
        assert getkv(c, "account_locked:acc_pers") == "PARTIAL_CLOSE_PENDING"

    # 3. Personal account fanout (verifies absence of NameError: risk_cfg)
    mock_client.execute_order = AsyncMock(return_value={
        "numericCode": 10009,
        "stringCode": "TRADE_RETCODE_DONE",
        "positionId": "pos_new_1",
        "orderId": "ord_new_1",
        "stopLoss": 1980.0,
        "latency_ms": 12,
        "volume": 0.1
    })
    with tx() as c:
        setkv(c, "account_locked:acc_pers", "")  # clear for test
    signal = {"id": "sig_pers_1", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2000.0, "sl": 1980.0, "tp": 2040.0}
    pers_accounts = [{
        "id": "acc_pers", "metaapi_account_id": "meta_pers", "broker_server": "CommonBrokerServer",
        "risk_percent": 1.0, "is_prop_firm_mode": 0, "balance": 10000.0, "equity": 10000.0,
        "risk_config": '{"max_portfolio_risk_pct": 2.0}'
    }]
    fanout_res = await execute_fan_out_for_signal(signal, pers_accounts, mock_client)
    assert fanout_res["executed"] == 1, "Personal account must execute fanout cleanly without NameError"

    # 4. Subscription lifecycle fail-closed when get_open_orders fails
    with tx() as c:
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, deployment_state, created_at
            ) VALUES (
                'acc_exp', 'u6', 'meta_exp', '6002', 'enc_pass', 'CommonBrokerServer',
                1, 5000.0, 5000.0, 'DEPLOYED', ?
            )
        """, (now - 86400 * 2,))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_exp', 'u6', '6002', 'CommonBrokerServer', 'meta_exp', ?)", (now,))
        c.execute("INSERT INTO subscriptions (id, user_id, service_expires_at, plan_tier, created_at, updated_at) VALUES ('sub_exp', 'u6', ?, 'alpha', ?, ?)", (now - 3600, now, now))

    mock_client.get_positions_verified = AsyncMock(return_value=(True, [], {"synchronized": True}))
    mock_client.get_open_orders_verified = AsyncMock(return_value=(False, [], {"error": "Gateway Timeout"}))
    mock_client.undeploy_account = AsyncMock(return_value=True)

    stats = await run_subscription_lifecycle_cycle(meta_client=mock_client, now_ts=now)
    with tx() as c:
        row = c.execute("SELECT deployment_state FROM trading_accounts WHERE id = 'acc_exp'").fetchone()
        assert row[0] == "EXPIRED_PROTECTING", "Failed open_orders check must keep station in EXPIRED_PROTECTING"

    # 5. Handover email dispatch after 24h
    with tx() as c:
        # Move expiry to > 24h ago with unverified items
        c.execute("UPDATE subscriptions SET service_expires_at = ? WHERE id = 'sub_exp'", (now - 86400 * 2,))
        c.execute("""
            INSERT INTO metaapi_trade_executions (
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price, status, origin, executed_at
            ) VALUES ('ex_unver_exp', 'sig_e', 'acc_exp', 'meta_exp', 'XAUUSD', 'BUY', 0.1, 2000.0, 'UNKNOWN_EXECUTION', 'BOT', ?)
        """, (now - 86400 * 2,))

    # 5a. With live open positions on broker, MUST stay in EXPIRED_PROTECTING even after 24h expired
    mock_client.get_positions_verified = AsyncMock(return_value=(True, [{"id": "pos_rem"}], {"synchronized": True}))
    mock_client.get_open_orders_verified = AsyncMock(return_value=(True, [], {"status_code": 200}))
    mock_client.undeploy_account = AsyncMock(return_value=True)

    await run_subscription_lifecycle_cycle(meta_client=mock_client, now_ts=now)
    with tx() as c:
        row = c.execute("SELECT deployment_state FROM trading_accounts WHERE id = 'acc_exp'").fetchone()
        assert row[0] == "EXPIRED_PROTECTING", "Live positions on broker must prevent undeploy even after 24h"

    # 5b. When broker positions close (0 open positions and orders), undeploy after 24h and dispatch handover alerts
    mock_client.get_positions_verified = AsyncMock(return_value=(True, [], {"synchronized": True}))
    dispatched_emails = []
    from app.core import mailer
    monkeypatch.setattr(mailer, "send_resend_email", lambda *args, **kwargs: dispatched_emails.append(kwargs) or {"ok": True})
    monkeypatch.setattr(mailer, "send_admin_alert_email", lambda title, detail: dispatched_emails.append({"admin_alert": title}) or {"ok": True})

    stats_handover = await run_subscription_lifecycle_cycle(meta_client=mock_client, now_ts=now)
    with tx() as c:
        row = c.execute("SELECT deployment_state FROM trading_accounts WHERE id = 'acc_exp'").fetchone()
        assert row[0] == "UNDEPLOYED", "Account expired > 24h with 0 broker positions must be undeployed"
    assert len(dispatched_emails) >= 2, "Handover alerts must be dispatched to BOTH admin and customer"

    # 6. Shared Broker Circuit Breaker across accounts
    with tx() as c:
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, deployment_state, created_at
            ) VALUES (
                'acc_peer', 'u6', 'meta_peer', '6003', 'enc_pass', 'CommonBrokerServer',
                1, 10000.0, 10000.0, 'DEPLOYED', ?
            )
        """, (now,))
        from app.domains.execution.compliance import record_broker_execution_error
        # Trip circuit breaker on CommonBrokerServer (3 consecutive errors)
        record_broker_execution_error(server="CommonBrokerServer", error_type="502_BAD_GATEWAY", db_cursor=c, now_ts=now)
        record_broker_execution_error(server="CommonBrokerServer", error_type="502_BAD_GATEWAY", db_cursor=c, now_ts=now)
        record_broker_execution_error(server="CommonBrokerServer", error_type="502_BAD_GATEWAY", db_cursor=c, now_ts=now)

    peer_accounts = [{
        "id": "acc_peer", "metaapi_account_id": "meta_peer", "broker_server": "CommonBrokerServer",
        "risk_percent": 1.0, "is_prop_firm_mode": 0, "balance": 10000.0, "equity": 10000.0
    }]
    res_cb = await execute_fan_out_for_signal(signal, peer_accounts, mock_client)
    assert res_cb["executed"] == 0 and res_cb["skipped"] == 1, "Account sharing failing broker_server must be skipped by Circuit Breaker"


@pytest.mark.asyncio
async def test_a7_production_hardening_and_edge_cases(monkeypatch):
    """Verify:
    1. Deal deduplication across cycles (UNKNOWN_EXECUTION -> FILLED -> transient missing does not double-count).
    2. Personal account open MT5 portfolio risk cap (2.0%) enforcement.
    3. MetaApiClient.get_open_orders_verified fails closed on non-list HTTP 200 payload.
    4. Macro Shield stand-aside (DANGER_FREEZE blocks all, gold BUY with DXY UP scales risk to 0.5x).
    5. Payment webhook preserves customer auto_trade preference and EXPIRED_PROTECTING state.
    """
    now = time.time()
    mock_client = AsyncMock()

    # --- 1. Deal Deduplication Across Cycles ---
    cyc_login = f"701_{int(now * 1000) % 100000}"
    with tx() as c:
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = 'acc_cycle'")
        c.execute("DELETE FROM metaapi_cloud_accounts WHERE id = 'acc_cycle'")
        c.execute("DELETE FROM trading_accounts WHERE id = 'acc_cycle'")
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_cyc', 'u_cyc@test.com', 'pass_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, deployment_state, created_at
            ) VALUES (
                'acc_cycle', 'u_cyc', 'meta_cyc', ?, 'enc_pass', 'CycleServer',
                1, 10000.0, 10000.0, 'DEPLOYED', ?
            )
        """, (cyc_login, now))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_cycle', 'u_cyc', '7001', 'CycleServer', 'meta_cyc', ?)", (now,))
        c.execute("""
            INSERT INTO metaapi_trade_executions (
                id, signal_id, account_id, metaapi_account_id, client_order_id, symbol, action, volume,
                entry_price, status, origin, executed_at
            ) VALUES (
                'ex_cycle_1', 'sig_c1', 'acc_cycle', 'meta_cyc', 'cid_cycle_1', 'XAUUSD', 'BUY', 1.0,
                2000.0, 'UNKNOWN_EXECUTION', 'BOT', ?
            )
        """, (now,))
        setkv(c, "account_locked:acc_cycle", "UNKNOWN_EXECUTION_PENDING")

    # Cycle 1: 0.50 partial close deal observed, 0.50 volume position still open on MT5
    c1_positions = [{"id": "pos_cyc_1", "clientId": "cid_cycle_1", "symbol": "XAUUSD", "type": "POSITION_TYPE_BUY", "volume": 0.50, "openPrice": 2000.0, "stopLoss": 1980.0}]
    c1_deals = [{"id": "deal_cyc_out_1", "positionId": "pos_cyc_1", "entryType": "DEAL_ENTRY_OUT", "volume": 0.50}]

    mock_client.get_positions_verified = AsyncMock(return_value=(True, c1_positions, {"synchronized": True}))
    mock_client.get_closed_deals = AsyncMock(return_value=c1_deals)

    with tx() as c:
        reconcile_account_positions(c, "acc_cycle", "meta_cyc", ok=True, live_positions=c1_positions, deals=c1_deals, now_ts=now)
        row1 = c.execute("SELECT status, closed_volume, evidence_json FROM metaapi_trade_executions WHERE id = 'ex_cycle_1'").fetchone()
        assert row1[0] == "FILLED", "Must transition from UNKNOWN_EXECUTION to FILLED"
        assert row1[1] == 0.5, "Closed volume must reflect 0.50 partial close"
        ev1 = json.loads(row1[2])
        assert "deal_cyc_out_1" in ev1.get("deal_ids", [])
        assert "deal_cyc_out_1" in ev1.get("partial_deals", [])

    # Cycle 2: live_positions temporarily empty (e.g. broker blip), deals still return deal_cyc_out_1
    with tx() as c:
        reconcile_account_positions(c, "acc_cycle", "meta_cyc", ok=True, live_positions=[], deals=c1_deals, now_ts=now + 10)
        row2 = c.execute("SELECT status, closed_volume FROM metaapi_trade_executions WHERE id = 'ex_cycle_1'").fetchone()
        assert row2[0] == "FILLED", "Cycle 2 MUST NOT transition to CLOSED due to deal deduplication"
        assert row2[1] == 0.5, "Closed volume MUST remain 0.50 and NOT be double-counted to 1.00"

    # --- 2. Personal Account MT5 Portfolio Risk Cap (2.0%) ---
    pers_login = f"702_{int(now * 1000) % 100000}"
    with tx() as c:
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = 'acc_pers_cap'")
        c.execute("DELETE FROM metaapi_cloud_accounts WHERE id = 'acc_pers_cap'")
        c.execute("DELETE FROM trading_accounts WHERE id = 'acc_pers_cap'")
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_pers', 'u_pers@test.com', 'pass_123', 'customer') ON CONFLICT DO NOTHING")
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, deployment_state, created_at
            ) VALUES (
                'acc_pers_cap', 'u_pers', 'meta_pers_cap', ?, 'enc_pass', 'PersServer',
                1, 10000.0, 10000.0, 'DEPLOYED', ?
            )
        """, (pers_login, now))
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, metaapi_account_id, created_at) VALUES ('acc_pers_cap', 'u_pers', '7002', 'PersServer', 'meta_pers_cap', ?)", (now,))

    # Open broker position risking 1.8% ($180 risk on $10,000 capital: 0.09 lot XAUUSD with 2000 SL = $180)
    # Open: 2000.0, SL: 1980.0 (20 pts) * 0.09 lot * 100 oz = $180 = 1.80%
    existing_broker_positions = [{
        "id": "pos_existing_pers",
        "symbol": "XAUUSD",
        "type": "POSITION_TYPE_BUY",
        "openPrice": 2000.0,
        "stopLoss": 1980.0,
        "volume": 0.09,
    }]
    mock_client.get_open_positions = AsyncMock(return_value=existing_broker_positions)
    mock_client.execute_order = AsyncMock(return_value={"numericCode": 10009, "stringCode": "TRADE_RETCODE_DONE", "positionId": "p_new", "orderId": "o_new"})

    signal_pers = {"id": "sig_pers_risk", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2000.0, "sl": 1980.0, "tp": 2040.0}
    pers_acc_list = [{
        "id": "acc_pers_cap", "metaapi_account_id": "meta_pers_cap", "broker_server": "PersServer",
        "risk_percent": 0.5, "is_prop_firm_mode": 0, "balance": 10000.0, "equity": 10000.0,
        "risk_config": '{"max_portfolio_risk_pct": 2.0}'
    }]

    fanout_cap_res = await execute_fan_out_for_signal(signal_pers, pers_acc_list, mock_client)
    assert fanout_cap_res["executed"] == 0 and fanout_cap_res["skipped"] == 1, (
        f"Personal account with 1.8% existing open risk + 0.5% new risk must exceed 2.0% cap and be skipped, got: {fanout_cap_res}"
    )

    # --- 3. MetaApiClient.get_open_orders_verified Fails Closed on Non-List HTTP 200 ---
    from app.domains.execution.metaapi_client import MetaApiClient
    real_meta_client = MetaApiClient(token="test_token")

    class MockHttpxResponse:
        def __init__(self, status_code, json_data):
            self.status_code = status_code
            self._json = json_data
            self.text = json.dumps(json_data)
        def json(self):
            return self._json

    class MockAsyncHttpxClient:
        def __init__(self, resp):
            self.resp = resp
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass
        async def get(self, *args, **kwargs):
            return self.resp

    # Test HTTP 200 with dict instead of list
    monkeypatch.setattr("httpx.AsyncClient", lambda **kwargs: MockAsyncHttpxClient(MockHttpxResponse(200, {"error": "unexpected format"})))
    ok, orders, meta = await real_meta_client.get_open_orders_verified("real_acc_123")
    assert ok is False, "Must return ok=False when response body is not a list"
    assert orders == []

    # Test HTTP 200 with valid list
    monkeypatch.setattr("httpx.AsyncClient", lambda **kwargs: MockAsyncHttpxClient(MockHttpxResponse(200, [{"id": "ord_1"}])))
    ok, orders, meta = await real_meta_client.get_open_orders_verified("real_acc_123")
    assert ok is True, "Must return ok=True when response body is a valid list"
    assert len(orders) == 1

    # --- 4. Macro Filter Stand-Aside and Risk Scaling ---
    from app.domains.ai.macro_station import save_macro_state
    # 4a: DANGER_FREEZE blocks all fanout
    save_macro_state({"shock": "DANGER_FREEZE", "dxy_trend": "FLAT", "us10y_trend": "FLAT", "updated_at": now})
    res_freeze = await execute_fan_out_for_signal(signal_pers, pers_acc_list, mock_client)
    assert res_freeze.get("error") == "MACRO_SHOCK_FREEZE", "DANGER_FREEZE must block fanout execution"
    assert res_freeze["executed"] == 0

    # 4b: Gold BUY with DXY UP scales risk to 0.5x
    save_macro_state({"shock": "NONE", "dxy_trend": "UP", "us10y_trend": "FLAT", "updated_at": now})
    mock_client.get_open_positions = AsyncMock(return_value=[])
    recorded_exec = {}
    async def capture_order(*args, **kwargs):
        recorded_exec["volume"] = kwargs.get("volume")
        return {"numericCode": 10009, "stringCode": "TRADE_RETCODE_DONE", "positionId": "pos_scaled", "orderId": "ord_scaled"}
    mock_client.execute_order = capture_order

    with tx() as c:
        c.execute("DELETE FROM kv WHERE key LIKE '%acc_pers_cap%'")
    pers_acc_scaled = [{
        "id": "acc_pers_cap", "metaapi_account_id": "meta_pers_cap", "broker_server": "PersServer",
        "risk_percent": 1.0, "is_prop_firm_mode": 0, "balance": 20000.0, "equity": 20000.0,
        "risk_config": '{"max_portfolio_risk_pct": 2.0}'
    }]
    res_scaled = await execute_fan_out_for_signal(signal_pers, pers_acc_scaled, mock_client)
    assert res_scaled["executed"] == 1, f"Must execute with scaled risk, got: {res_scaled}"
    # $20k equity * 1.0% base * min(0.5, 0.5) = $100 risk -> 0.05 lot
    captured_vol = recorded_exec.get("volume")
    assert captured_vol == 0.05, f"Expected 0.05 lot for scaled risk on gold BUY with DXY UP, got {captured_vol}"

    # Reset macro state
    save_macro_state({"shock": "NONE", "dxy_trend": "FLAT", "us10y_trend": "FLAT", "updated_at": now})

    # --- 5. Payment Webhook Safety: Preserve auto_trade preference and EXPIRED_PROTECTING state ---
    from app.routers.webhooks import handle_sepay_webhook
    from fastapi import Request

    pay_login = f"703_{int(now * 1000) % 100000}"
    with tx() as c:
        c.execute("DELETE FROM payment_transactions WHERE id = 'sepay_tx_test_1'")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = 'acc_pay'")
        c.execute("DELETE FROM metaapi_cloud_accounts WHERE id = 'acc_pay'")
        c.execute("DELETE FROM trading_accounts WHERE id = 'acc_pay'")
        c.execute("""
            INSERT INTO users (id, email, password, role)
            VALUES ('u_pay', 'user_pay@zupirus.com', 'pass_123', 'customer')
            ON CONFLICT DO NOTHING
        """)
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                auto_trade, balance, equity, deployment_state, created_at
            ) VALUES (
                'acc_pay', 'u_pay', 'meta_pay', ?, 'enc_pass', 'PayServer',
                0, 5000.0, 5000.0, 'EXPIRED_PROTECTING', ?
            )
        """, (pay_login, now))

    webhook_payload = {
        "id": "sepay_tx_test_1",
        "gateway": "vietcombank",
        "transactionDate": "2026-11-22 12:00:00",
        "accountNumber": "9999999",
        "code": None,
        "content": "ZUPIRUS SUB user_pay@zupirus.com",
        "transferType": "in",
        "transferAmount": 500000,
        "accumulated": 500000,
        "subAccount": None,
        "referenceCode": "REF_TEST_1",
        "description": "Payment test"
    }

    mock_req = AsyncMock(spec=Request)
    mock_req.body = AsyncMock(return_value=json.dumps(webhook_payload).encode("utf-8"))
    mock_req.headers = {"authorization": "Apikey test_key"}
    mock_req.query_params = {}
    monkeypatch.setenv("SEPAY_WEBHOOK_SECRET", "test_key")
    monkeypatch.setattr("app.routers.webhooks.SEPAY_WEBHOOK_SECRET", "test_key")

    webhook_res = await handle_sepay_webhook(mock_req, authorization="Apikey test_key")
    assert webhook_res.get("success") is True, f"Webhook should record transaction successfully, got: {webhook_res}"

    with tx() as c:
        acc_state = c.execute("SELECT deployment_state, auto_trade FROM trading_accounts WHERE id = 'acc_pay'").fetchone()
        assert acc_state[0] == "EXPIRED_PROTECTING", "Payment webhook must NOT forcefully mutate deployment_state"
        assert acc_state[1] == 0, "Payment webhook must NOT forcefully override user's auto_trade preference"


# ===========================================================================
# 5 REGRESSION TESTS POST-COMMIT e2672af
# ===========================================================================

@pytest.mark.asyncio
async def test_regression_75pct_daily_drawdown_no_unbound_and_no_close(tmp_path, monkeypatch):
    """1. Tài khoản chạm vùng cảnh báo 75% Daily Drawdown không văng UnboundLocalError, không đóng lệnh bot."""
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_reg_dd75.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    import datetime
    date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_dd75', 'u_dd75@example.com', 'pass', 'customer') ON CONFLICT DO NOTHING")
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                balance, equity, is_prop_firm_mode, prop_daily_dd_limit_pct, deployment_state, created_at
            ) VALUES (
                'acc_dd75', 'u_dd75', 'meta_dd75', '7501', 'enc', 'DemoServer',
                10000.0, 9690.0, 1, 4.0, 'DEPLOYED', ?
            )
        """, (now,))
        setkv(c, f"daily_start_bal:acc_dd75:{date_str}", "10000.0")

    mock_client = AsyncMock(spec=MetaApiClient)
    close_called = False
    async def mock_close(*args, **kwargs):
        nonlocal close_called
        close_called = True
        return {"status": "OK"}
    mock_client.close_position = mock_close

    mock_client.get_positions_verified = AsyncMock(return_value=(True, [], {"synchronized": True}))
    mock_client.get_open_orders_verified = AsyncMock(return_value=(True, [], {"synchronized": True}))
    watcher = PositionWatcher(mock_client)
    # Drawdown is (10000 - 9690) / 10000 = 3.1%, which is >= 0.75 * 4.0% (3.0%) and < 4.0%
    res = await watcher.run_cycle()

    assert close_called is False, "Bot positions must NOT be closed at 75% drawdown warning"
    with tx() as c:
        locked = getkv(c, "account_locked:acc_dd75")
        assert not locked, "Account must NOT be locked at 75% drawdown warning"


def test_regression_verify_position_ownership_rejects_prefix_without_db(tmp_path, monkeypatch):
    """2. verify_position_ownership() từ chối vị thế chỉ có tiền tố ZP- / Zupirus mà không có bản ghi DB trên đúng account_id."""
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_reg_prefix.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    with tx() as c:
        run_all_migrations(c, is_pg=False)
        # Position with prefix comment but no DB trade execution
        pos_fake_zp = {"id": "pos_fake_1", "volume": 0.10, "comment": "ZP-12345678"}
        orig_zp, _ = verify_position_ownership(c, "acc_no_db", pos_fake_zp)
        assert orig_zp == "MANUAL", "Prefix ZP- without DB record must be treated as MANUAL"

        pos_fake_zup = {"id": "pos_fake_2", "volume": 0.10, "comment": "Zupirus-Auto"}
        orig_zup, _ = verify_position_ownership(c, "acc_no_db", pos_fake_zup)
        assert orig_zup == "MANUAL", "Prefix Zupirus without DB record must be treated as MANUAL"

        pos_fake_e2e = {"id": "pos_e2e_12345", "volume": 0.10, "comment": "any"}
        orig_e2e, _ = verify_position_ownership(c, "acc_no_db", pos_fake_e2e)
        assert orig_e2e == "MANUAL", "ID pos_e2e_ without DB record must be treated as MANUAL"


def test_regression_non_protective_sl_unconfirmed():
    """3. Vị thế có stopLoss đặt sai phía (BUY có SL >= currentPrice hoặc SELL có SL <= currentPrice) giữ sl_confirmed = 0."""
    from app.domains.execution.watcher import _is_protective_sl

    # BUY cases
    assert _is_protective_sl({"type": "POSITION_TYPE_BUY", "currentPrice": 2000.0, "stopLoss": 1990.0}) is True
    assert _is_protective_sl({"type": "POSITION_TYPE_BUY", "currentPrice": 2000.0, "stopLoss": 2000.0}) is False
    assert _is_protective_sl({"type": "POSITION_TYPE_BUY", "currentPrice": 2000.0, "stopLoss": 2005.0}) is False
    assert _is_protective_sl({"type": "POSITION_TYPE_BUY", "currentPrice": 2000.0, "stopLoss": 0.0}) is False

    # SELL cases
    assert _is_protective_sl({"type": "POSITION_TYPE_SELL", "currentPrice": 2000.0, "stopLoss": 2010.0}) is True
    assert _is_protective_sl({"type": "POSITION_TYPE_SELL", "currentPrice": 2000.0, "stopLoss": 2000.0}) is False
    assert _is_protective_sl({"type": "POSITION_TYPE_SELL", "currentPrice": 2000.0, "stopLoss": 1995.0}) is False
    assert _is_protective_sl({"type": "POSITION_TYPE_SELL", "currentPrice": 2000.0, "stopLoss": 0.0}) is False


@pytest.mark.asyncio
async def test_regression_timeout_unknown_execution_does_not_set_last_verified_at(tmp_path, monkeypatch):
    """4. Lệnh timeout sang UNKNOWN_EXECUTION không cập nhật last_verified_at."""
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_reg_timeout.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_to', 'u_to@example.com', 'pass', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO quotes (symbol, bid, ask, ts, source) VALUES ('XAUUSD', 2650.0, 2650.2, ?, 'TEST')", (now,))
        c.execute("""
            INSERT INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server,
                balance, equity, is_prop_firm_mode, deployment_state, created_at
            ) VALUES (
                'acc_to', 'u_to', 'meta_to', '7502', 'enc', 'DemoServer',
                10000.0, 10000.0, 0, 'DEPLOYED', ?
            )
        """, (now,))

    mock_client = AsyncMock(spec=MetaApiClient)
    async def mock_timeout_exec(*args, **kwargs):
        raise asyncio.TimeoutError("MetaApi execution gateway timed out")
    mock_client.execute_order = mock_timeout_exec

    signal = {"id": "sig_to_1", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2650.0, "sl": 2640.0, "tp": 2670.0}
    accounts = [{
        "id": "acc_to", "metaapi_account_id": "meta_to", "broker_server": "DemoServer",
        "risk_percent": 1.0, "is_prop_firm_mode": 0, "balance": 10000.0, "equity": 10000.0,
    }]

    res = await execute_fan_out_for_signal(signal, accounts, mock_client)
    assert res["failed"] == 1

    with tx() as c:
        row = c.execute("SELECT status, last_verified_at FROM metaapi_trade_executions WHERE account_id = 'acc_to'").fetchone()
        assert row is not None
        assert row[0] == "UNKNOWN_EXECUTION", f"Expected UNKNOWN_EXECUTION on timeout, got {row[0]}"
        assert row[1] is None, f"last_verified_at must remain NULL on unverified timeout, got {row[1]}"


def test_regression_telemetry_admin_macro_degraded_over_2h(tmp_path, monkeypatch):
    """5. Endpoint telemetry_admin trả đúng macro_degraded == True khi macro_age > 2h."""
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_reg_telemetry.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    from app.domains.ai.macro_station import save_macro_state, evaluate_macro_filter
    from app.routers.telemetry_admin import get_admin_command_radar

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('adm_1', 'admin@example.com', 'pass', 'admin') ON CONFLICT DO NOTHING")

    # Save macro state older than 2 hours (7500s ago)
    save_macro_state({
        "shock": None,
        "dxy_trend": "FLAT",
        "us10y_trend": "FLAT",
        "updated_at": now - 7500.0,
    })

    flt = evaluate_macro_filter("XAUUSD", "BUY", now_ts=now)
    assert flt["macro_degraded"] is True, "Macro filter must flag macro_degraded=True when age > 7200s"
    assert flt["macro_scale"] == 0.5, "Macro scale must degrade to 0.5 when age > 7200s"

    radar = get_admin_command_radar(_admin={"id": "adm_1", "role": "admin"})
    assert radar.get("macro_degraded") is True, f"Admin telemetry radar must return macro_degraded=True, got {radar}"


def test_admin_radar_dry_run_endpoints(tmp_path, monkeypatch):
    """Test both /api/v1/telemetry/dry-run and /api/v1/telemetry/admin-radar/dry-run routes return 200."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core import db as core_db
    from app import db
    from app.security import digest

    db_file = tmp_path / "test_dry_run.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('adm_dry', 'admin@example.com', 'x', 'admin') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO sessions (token, user_id, expires) VALUES (?, 'adm_dry', ?)", (digest("admin_dry_run_token"), now + 3600))

    client = TestClient(app)
    headers = {"Authorization": "Bearer admin_dry_run_token"}

    # 1. Test /api/v1/telemetry/dry-run
    res1 = client.post("/api/v1/telemetry/dry-run", headers=headers)
    assert res1.status_code == 200, f"Expected 200, got {res1.status_code}: {res1.text}"
    data1 = res1.json()
    assert "steps" in data1
    assert len(data1["steps"]) >= 4

    # 2. Test /api/v1/telemetry/admin-radar/dry-run
    res2 = client.post("/api/v1/telemetry/admin-radar/dry-run", headers=headers)
    assert res2.status_code == 200, f"Expected 200, got {res2.status_code}: {res2.text}"
    data2 = res2.json()
    assert "steps" in data2
    assert len(data2["steps"]) >= 4

    # 3. Test GET method also works smoothly for both endpoints
    res_get1 = client.get("/api/v1/telemetry/dry-run", headers=headers)
    assert res_get1.status_code == 200, f"Expected 200 on GET, got {res_get1.status_code}"
    res_get2 = client.get("/api/v1/telemetry/admin-radar/dry-run", headers=headers)
    assert res_get2.status_code == 200, f"Expected 200 on GET, got {res_get2.status_code}"

    # 4. Test unauthorized request is rejected
    res3 = client.post("/api/v1/telemetry/dry-run")
    assert res3.status_code in (401, 403)

    # 5. Test unmatched POST /api/* route returns clean 404 (not 405 Method Not Allowed)
    res_404 = client.post("/api/nonexistent/random-endpoint-xyz", json={"test": True})
    assert res_404.status_code == 404, f"Expected 404 for unmatched API route, got {res_404.status_code}"


@pytest.mark.asyncio
async def test_full_lifecycle_deploy_disconnect_reconnect_stale_block(tmp_path, monkeypatch):
    """
    Integration Test:
    1. Deploy account: DEPLOYED, last_sync fresh, connection_status='CONNECTED' -> Order executes successfully.
    2. Disconnect: Watcher updates connection_status='DISCONNECTED', last_sync is preserved -> Fan-out skips with offline rationale.
    3. Reconnect / Update credentials: /update-credentials restores CONNECTED -> Fan-out executes successfully.
    4. Stale data: last_sync > 300s ago without fresh heartbeat -> Fan-out skips with stale data rationale.
    """
    from app.core import db as core_db
    from app import db
    from fastapi.testclient import TestClient
    from app.main import app
    from app.security import digest

    db_file = tmp_path / "test_lifecycle_flow.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_lc', 'user_lc@test.com', 'pwd_hash', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO sessions (token, user_id, expires) VALUES (?, 'u_lc', ?)", (digest("tok_user_lc"), now + 3600))
        c.execute(
            """
            INSERT INTO trading_accounts(id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, deployment_state, auto_trade, balance, equity, last_sync, risk_config, created_at)
            VALUES('acc_lc', 'u_lc', 'meta_lc', '88888', 'enc_p', 'Exness-Real', 'DEPLOYED', 1, 10000.0, 10000.0, ?, ?, ?)
            """,
            (now, json.dumps({"connection_status": "CONNECTED"}), now)
        )
        c.execute(
            """
            INSERT INTO metaapi_cloud_accounts(id, user_id, login, server, platform, account_name, metaapi_account_id, metaapi_state, auto_trade, created_at)
            VALUES('acc_lc', 'u_lc', '88888', 'Exness-Real', 'mt5', 'Test Lifecycle', 'meta_lc', 'DEPLOYED', 1, ?)
            """,
            (now,)
        )
        c.execute(
            "INSERT INTO quotes (symbol, bid, ask, ts, source) VALUES ('XAUUSD', 2000.0, 2000.15, ?, 'METAAPI')",
            (now,)
        )

    # 1. Step 1: Account is fresh and connected -> execute_fan_out_for_signal succeeds
    client = MetaApiClient(token="test_tok")
    monkeypatch.setattr(client, "is_mock", False)
    monkeypatch.setattr(client, "execute_order", AsyncMock(return_value={
        "numericCode": 10009,
        "stringCode": "TRADE_RETCODE_DONE",
        "orderId": "ord_lc_1",
        "positionId": "pos_lc_1",
    }))
    monkeypatch.setattr(client, "get_open_positions", AsyncMock(return_value=[]))
    monkeypatch.setattr(client, "get_positions_verified", AsyncMock(return_value=(True, [], {"synchronized": True})))
    monkeypatch.setattr(client, "get_account_information", AsyncMock(return_value={
        "connected": True,
        "connectionStatus": "CONNECTED",
        "balance": 10000.0,
        "equity": 10000.0,
    }))

    accounts = [{
        "id": "acc_lc",
        "metaapi_account_id": "meta_lc",
        "user_id": "u_lc",
        "auto_trade": 1,
        "deployment_state": "DEPLOYED",
        "balance": 10000.0,
        "equity": 10000.0,
        "risk_config": json.dumps({"connection_status": "CONNECTED"}),
    }]
    sig1 = {"id": "sig_lc_1", "symbol": "XAUUSD", "action": "BUY", "risk_pct": 0.5, "entry_price": 2000.0, "sl": 1990.0, "tp": 2020.0}

    res1 = await execute_fan_out_for_signal(sig1, accounts, client)
    assert res1["executed"] == 1, f"Step 1: Expected 1 executed, got {res1}"

    # 2. Step 2: Broker disconnects -> Watcher runs and updates connection_status='DISCONNECTED'
    watcher = PositionWatcher(metaapi_client=client)
    monkeypatch.setattr(client, "get_account_information", AsyncMock(return_value={
        "connected": False,
        "connectionStatus": "DISCONNECTED",
        "error": "DISCONNECTED_FROM_BROKER",
    }))
    await watcher.run_cycle()

    # Verify last_sync was NOT overwritten to fresh now!
    with tx() as c:
        row_disc = c.execute("SELECT risk_config, last_sync FROM trading_accounts WHERE id='acc_lc'").fetchone()
        rc_disc = json.loads(row_disc[0])
        assert rc_disc.get("connection_status") == "DISCONNECTED", f"Expected DISCONNECTED, got {rc_disc}"
        assert row_disc[1] == pytest.approx(now, abs=1.0), "last_sync must not advance on disconnection failure"

    # Step 2b: Next signal attempt must be blocked and recorded as SKIPPED
    sig2 = {"id": "sig_lc_2", "symbol": "XAUUSD", "action": "BUY", "risk_pct": 0.5, "entry_price": 2000.0, "sl": 1990.0, "tp": 2020.0}
    res2 = await execute_fan_out_for_signal(sig2, accounts, client)
    assert res2["executed"] == 0, "Step 2: Execution must be blocked when disconnected"
    with tx() as c:
        skip_exec = c.execute("SELECT status, error_message FROM metaapi_trade_executions WHERE signal_id='sig_lc_2' AND account_id='acc_lc'").fetchone()
        assert skip_exec is not None, "Skipped record must be persisted"
        assert skip_exec[0] == "SKIPPED"
        assert "Broker Offline" in skip_exec[1] or "Sàn ngắt kết nối" in skip_exec[1]

    # 3. Step 3: Reconnect via /update-credentials endpoint
    monkeypatch.setattr(client, "update_account_credentials", AsyncMock(return_value=True))
    monkeypatch.setattr(client, "deploy_account", AsyncMock(return_value=True))
    monkeypatch.setattr(client, "get_account_information", AsyncMock(return_value={
        "connected": True,
        "connectionStatus": "CONNECTED",
        "balance": 10000.0,
        "equity": 10000.0,
    }))

    http_client = TestClient(app)
    cred_res = http_client.post(
        "/api/v1/accounts/acc_lc/update-credentials",
        headers={"Authorization": "Bearer tok_user_lc"},
        json={"password": "NewMasterPassword123!"}
    )
    assert cred_res.status_code == 200, f"Credentials update failed: {cred_res.text}"
    cred_data = cred_res.json()
    assert cred_data["connected"] is True
    assert cred_data["connection_status"] == "CONNECTED"

    # Step 3b: Signal execution succeeds after reconnect
    sig3 = {"id": "sig_lc_3", "symbol": "XAUUSD", "action": "BUY", "risk_pct": 0.5, "entry_price": 2000.0, "sl": 1990.0, "tp": 2020.0}
    res3 = await execute_fan_out_for_signal(sig3, accounts, client)
    assert res3["executed"] == 1, f"Step 3: Expected 1 executed after reconnect, got {res3}"

    # 4. Step 4: Stale data block (> 300s ago, no fresh heartbeat)
    with tx() as c:
        c.execute("UPDATE trading_accounts SET last_sync = ? WHERE id='acc_lc'", (time.time() - 400.0,))
    try:
        from app.redis_client import cache_heartbeat
        cache_heartbeat("acc_lc", {"last_seen": time.time() - 400.0, "connected": True, "connection_status": "CONNECTED"}, ttl=1)
    except Exception:
        pass

    sig4 = {"id": "sig_lc_4", "symbol": "XAUUSD", "action": "BUY", "risk_pct": 0.5, "entry_price": 2000.0, "sl": 1990.0, "tp": 2020.0}
    res4 = await execute_fan_out_for_signal(sig4, accounts, client)
    assert res4["executed"] == 0, f"Step 4: Expected 0 executed on stale data, got {res4}"
    with tx() as c:
        stale_exec = c.execute("SELECT status, error_message FROM metaapi_trade_executions WHERE signal_id='sig_lc_4' AND account_id='acc_lc'").fetchone()
        assert stale_exec is not None
        assert stale_exec[0] == "SKIPPED"
        assert ">5p" in stale_exec[1] or "quá cũ" in stale_exec[1]



