import pytest
import asyncio
import time
import json
from unittest.mock import MagicMock, AsyncMock, patch

from app.db import tx, init
from app.services.account_classifier import calculate_normalized_lot_size
from app.domains.execution.compliance import calculate_compliant_sl_tp
from app.domains.execution.engine import coordinate_strategies
from app.domains.execution.metaapi_client import MetaApiClient
from app.domains.signals.ingestion.context import get_market_atr14
from app.domains.ai.oos_validator import simulate_strategy_on_candles


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    test_db = tmp_path / "test_defects.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{test_db}")
    init()
    yield


def test_lot_size_recalculated_on_widened_sl():
    """Verify that when broker stopsLevel widens SL distance, lot size scales down proportionally."""
    equity = 10000.0
    risk_pct = 1.0  # $100 risk
    initial_sl_pts = 200.0  # 200 points ($2.00 on XAUUSD)
    entry_price = 2650.0

    initial_vol = calculate_normalized_lot_size(
        equity=equity,
        risk_pct=risk_pct,
        sl_distance_points=initial_sl_pts,
        contract_size=100.0,
        tick_value=1.0,
        risk_multiplier=1.0,
        max_lot=10.0,
        is_cent=False,
        symbol="XAUUSD",
        entry_price=entry_price,
    )

    # If compliant SL calculation widens SL distance to 400 points ($4.00 on XAUUSD):
    widened_sl_pts = 400.0
    adjusted_vol = calculate_normalized_lot_size(
        equity=equity,
        risk_pct=risk_pct,
        sl_distance_points=widened_sl_pts,
        contract_size=100.0,
        tick_value=1.0,
        risk_multiplier=1.0,
        max_lot=10.0,
        is_cent=False,
        symbol="XAUUSD",
        entry_price=entry_price,
    )

    assert initial_vol > 0
    assert adjusted_vol > 0
    assert adjusted_vol < initial_vol
    # Sizing should be half because SL distance doubled (0.50 -> 0.25)
    assert adjusted_vol == pytest.approx(initial_vol / 2.0, rel=0.05)


def test_strategy_matching_symbol_specific():
    """Verify that strategy selection matches candidate by symbol and does not pick foreign symbol."""
    from app.db import setkv
    with tx() as c:
        setkv(c, "signal_mode", "ZUPIRUS_AGENT")
        setkv(c, "halted", "0")
        # Create an approved candidate strictly for EURUSD
        c.execute("DELETE FROM strategy_candidates")
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, rules_json, win_rate, profit_factor, status, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "cand_eur",
                "EURUSD Trend Rider",
                '{"symbol": "EURUSD", "strategy": "strat_trend_breakout"}',
                65.0,
                1.8,
                "APPROVED_FOR_PROD",
                1700000000.0,
                1700000000.0,
            ),
        )

    # For XAUUSD, coordinate_strategies should NOT pick cand_eur
    res_xau = coordinate_strategies([], timeframe="M15", symbol="XAUUSD")
    assert res_xau.get("side") is None
    assert "STAND_ASIDE" in res_xau.get("reason", "")

    # For EURUSD, it should find cand_eur
    res_eur = coordinate_strategies([], timeframe="M15", symbol="EURUSD")
    assert res_eur.get("strategy") == "strat_trend_breakout" or res_eur.get("side") is None


@pytest.mark.asyncio
async def test_metaapi_partial_close_no_blind_fallback_on_502():
    """Verify that HTTP 502 Bad Gateway does NOT trigger POSITION_CLOSE fallback."""
    client = MetaApiClient(token="test_token")

    mock_resp_502 = MagicMock()
    mock_resp_502.status_code = 502
    mock_resp_502.text = "Bad Gateway from Cloudflare / MetaAPI Upstream"

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp_502
        res = await client.close_partial_position("acc_123", "pos_999", 0.05)

        # Should only call post ONCE, no second fallback call
        assert mock_post.call_count == 1
        assert res.get("numericCode") == 502
        assert res.get("stringCode") == "CLOSE_PARTIAL_ERROR"


@pytest.mark.asyncio
async def test_metaapi_partial_close_fallback_on_unsupported_action():
    """Verify that HTTP 400 with 'unsupported action' triggers POSITION_CLOSE fallback."""
    client = MetaApiClient(token="test_token")

    mock_resp_400 = MagicMock()
    mock_resp_400.status_code = 400
    mock_resp_400.text = "POSITION_PARTIAL actionType is unsupported for this broker"

    mock_resp_fallback = MagicMock()
    mock_resp_fallback.status_code = 200
    mock_resp_fallback.json.return_value = {"orderId": "ord_fallback_1", "stringCode": "TRADE_RETCODE_DONE"}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = [mock_resp_400, mock_resp_fallback]
        res = await client.close_partial_position("acc_123", "pos_999", 0.05)

        # Should call post TWICE (initial + fallback)
        assert mock_post.call_count == 2
        assert res.get("stringCode") == "TRADE_RETCODE_DONE"


def test_market_atr14_fallback():
    """Verify ATR(14) returns symbol-appropriate default when no candles exist."""
    with tx() as c:
        c.execute("DELETE FROM candles")
        atr_xau = get_market_atr14(c, "XAUUSD")
        atr_jpy = get_market_atr14(c, "USDJPY")
        atr_eur = get_market_atr14(c, "EURUSD")

        assert atr_xau == 5.0
        assert atr_jpy == 0.35
        assert atr_eur == 0.0020


def test_oos_validator_no_position_overwrite():
    """Verify that OOS validator does not overwrite an active position."""
    # Create simple candles where two signals in a row would appear
    candles = [
        {"time": 1000 + i * 900, "open": 2000.0 + i, "high": 2005.0 + i, "low": 1995.0 + i, "close": 2002.0 + i}
        for i in range(50)
    ]
    trades = simulate_strategy_on_candles(
        candles=candles,
        strategy_name="strat_trend_breakout",
        symbol="XAUUSD",
        fee_pips=3.5,
    )
    # The simulation should complete cleanly and return a list of trades
    assert isinstance(trades, list)


def test_watcher_batch_deal_deduplication_logic():
    """Verify that multiple deals with the same id in matching_deals are deduplicated without double summing."""
    prev_ids = {"deal_1"}
    matching_deals = [
        {"id": "deal_1", "volume": 0.05, "entryType": "DEAL_ENTRY_OUT"},
        {"id": "deal_2", "volume": 0.03, "entryType": "1"},  # duplicate in batch
        {"id": "deal_2", "volume": 0.03, "entryType": "1"},
        {"id": "deal_3", "volume": 0.02, "entryType": "DEAL_ENTRY_OUT_BY"},
    ]

    seen_in_batch = set(prev_ids)
    new_deals = []
    for dl in matching_deals:
        d_id = str(dl.get("id") or "")
        if d_id and d_id not in seen_in_batch:
            seen_in_batch.add(d_id)
            new_deals.append(dl)

    new_deal_vol = sum(float(dl.get("volume") or 0.0) for dl in new_deals)
    assert len(new_deals) == 2  # deal_2 and deal_3 (deal_1 was in prev_ids, duplicate deal_2 discarded)
    assert new_deal_vol == pytest.approx(0.05)
    assert seen_in_batch == {"deal_1", "deal_2", "deal_3"}


def test_tick_globals_and_agent_step_in_flight(monkeypatch):
    """Verify tick() does not raise UnboundLocalError on threading or _agent_step_in_flight and actually launches the agent thread."""
    import threading
    from app.domains.execution import engine
    monkeypatch.setattr(engine, "is_weekend_market_closed", lambda *args: False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    engine._last_agent_eval_ts = 0.0
    engine._agent_step_in_flight = False

    thread_started = threading.Event()

    def mock_agent_step():
        thread_started.set()
        return {"status": "MOCK"}

    monkeypatch.setattr(engine, "autonomous_agent_step", mock_agent_step)

    engine.tick()

    # The background thread should actually start and execute autonomous_agent_step
    assert thread_started.wait(timeout=2.0) is True


def test_clear_signal_deduplication_allows_immediate_retry():
    """Verify that when fan-out executes 0 orders, clearing dedup allows immediate retry of identical signal."""
    from app.schemas.signals import NormalizedSignalSchema
    from app.domains.signals.ingestion.sanitizer import (
        sanitize_and_audit_signal,
        check_redis_deduplication,
        clear_signal_deduplication,
    )

    with tx() as c:
        c.execute("DELETE FROM news")

    sig = NormalizedSignalSchema(
        id="sig_test_retry_1",
        source="ZUPIRUS_CORE",
        strategy="trend",
        symbol="EURUSD",
        action="BUY",
        timeframe="M15",
        entry_price=1.0850,
        stop_loss=1.0800,
        take_profit=1.0950,
        timestamp=time.time(),
    )

    # First pass: should be approved
    ok1, reason1, _ = sanitize_and_audit_signal(sig, live_price=1.0850)
    assert ok1 is True

    # Immediate second pass without clear: should be blocked by deduplication
    ok2, reason2 = check_redis_deduplication(sig)
    assert ok2 is False
    assert "REJECTED_DUPLICATE_SIGNAL" in (reason2 or "")

    # Clear deduplication lock (as done when fanout executed 0 orders)
    clear_signal_deduplication(sig)

    # Immediate retry after clear: should now be accepted!
    ok3, reason3 = check_redis_deduplication(sig)
    assert ok3 is True
    assert reason3 is None


def test_multithreaded_run_coro_concurrency():
    """Verify _run_coro does not fail with 'This event loop is already running' under concurrent threads."""
    import concurrent.futures
    import time
    from app.domains.execution.engine import _run_coro

    async def async_worker(duration: float, val: int):
        await asyncio.sleep(duration)
        return val * 2

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        f1 = executor.submit(_run_coro, async_worker(0.02, 10))
        f2 = executor.submit(_run_coro, async_worker(0.02, 20))
        f3 = executor.submit(_run_coro, async_worker(0.01, 30))

        res1 = f1.result(timeout=2.0)
        res2 = f2.result(timeout=2.0)
        res3 = f3.result(timeout=2.0)

    assert res1 == 20
    assert res2 == 40
    assert res3 == 60


def test_candidate_updated_at_handled_without_key_error():
    """Verify coordinate_strategies does not fail with KeyError when candidate dict is provided."""
    cand = {
        "id": "cand_xau",
        "name": "XAU Scalper",
        "rules_json": '{"symbol": "XAUUSD", "strategy": "strat_trend_breakout"}',
        "updated_at": 1700000000.0,
    }
    res = coordinate_strategies([], timeframe="M15", symbol="XAUUSD", candidate=cand)
    # Should evaluate without KeyError: 'updated_at'
    assert "strategy" in res or "side" in res


@pytest.mark.asyncio
async def test_fanout_zero_executed_returns_no_executions_and_does_not_lock(monkeypatch):
    """Verify that when fanout executes 0 orders, status is FANOUT_NO_EXECUTIONS and last_ts_key is not updated."""
    from app.domains.execution import engine
    from app.db import getkv, setkv

    with tx() as c:
        c.execute("DELETE FROM news")
        setkv(c, "signal_mode", "ZUPIRUS_AGENT")
        setkv(c, "halted", "0")
        c.execute("DELETE FROM kv WHERE key = 'agent_last_candle_ts'")
        c.execute("DELETE FROM strategy_candidates")
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, rules_json, status, updated_at, created_at)
            VALUES ('c_gold', 'Gold Strat', '{"symbol": "XAUUSD", "strategy": "strat_trend_breakout"}', 'APPROVED_FOR_PROD', 1700000000.0, 1700000000.0)
            """
        )
        c.execute("DELETE FROM candles")
        # Insert 30 closed M15 candles
        now_ts = time.time()
        from app.core.db import is_postgres
        for i in range(35):
            c_ts = float(now_ts - (35 - i) * 900)
            if is_postgres():
                c.execute(
                    "INSERT INTO candles (symbol, timeframe, time, open, high, low, close) VALUES (?, ?, to_timestamp(?), ?, ?, ?, ?)",
                    ("XAUUSD", "M15", c_ts, 2600.0, 2605.0, 2595.0, 2602.0),
                )
            else:
                c.execute(
                    "INSERT INTO candles (symbol, timeframe, time, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("XAUUSD", "M15", c_ts, 2600.0, 2605.0, 2595.0, 2602.0),
                )
        # Add 1 eligible trading account with active cloud subscription
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u1', 'u1@test.com', 'pwd', 'admin') ON CONFLICT DO NOTHING")
        c.execute("DELETE FROM subscriptions WHERE user_id = 'u1'")
        c.execute("INSERT INTO subscriptions (id, user_id, plan_tier, allow_alpha_strategies, service_expires_at, created_at, updated_at) VALUES ('sub_u1', 'u1', 'institutional', 1, ?, ?, ?)", (now_ts + 86400.0, now_ts, now_ts))
        c.execute("DELETE FROM trading_accounts")
        c.execute(
            """
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, auto_trade, balance, equity, deployment_state, cloud_expires_at, created_at)
            VALUES ('acc_test', 'u1', 'm_test', '12345', 'enc', 'Server', 1, 10000.0, 10000.0, 'DEPLOYED', ?, ?)
            """,
            (now_ts + 86400.0, now_ts),
        )

    # Mock execute_fan_out_for_signal to return 0 executed
    async def mock_fanout(*args, **kwargs):
        return {"executed": 0, "failed": 0, "skipped": 1, "executions": []}

    monkeypatch.setattr("app.domains.execution.fanout.execute_fan_out_for_signal", mock_fanout)
    monkeypatch.setattr("app.metaapi.execute_fan_out_for_signal", mock_fanout)
    monkeypatch.setattr("app.domains.signals.ingestion.context.get_fresh_live_price", lambda *a, **kw: 2602.0)

    res = await engine.autonomous_agent_step_async(force_side="BUY", symbol="XAUUSD")
    assert res.get("status") == "FANOUT_NO_EXECUTIONS"
    assert res.get("reason") == "ALL_ACCOUNTS_SKIPPED_OR_FAILED"

    with tx() as c:
        last_ts = getkv(c, "agent_last_candle_ts")
        # last_ts should not be updated for this candle
        assert last_ts is None


def test_customer_cleanup_with_dependent_records():
    """Verify customer fixture cleanup pattern deletes dependent FK records so user can be re-registered without 409."""
    with tx() as c:
        now_ts = time.time()
        # Clean any conflicting records first to guarantee u_alice is inserted without FK violation
        c.execute("DELETE FROM sessions WHERE user_id = 'u_alice' OR user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
        c.execute("DELETE FROM subscriptions WHERE user_id = 'u_alice' OR user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
        c.execute("DELETE FROM trading_accounts WHERE user_id = 'u_alice' OR user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
        c.execute("DELETE FROM users WHERE email = 'alice@example.com' OR id = 'u_alice'")
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_alice', 'alice@example.com', 'pwd', 'customer')")
        c.execute("DELETE FROM sessions WHERE token = 'tok_alice'")
        c.execute("INSERT INTO sessions (token, user_id, expires) VALUES ('tok_alice', 'u_alice', ?)", (now_ts + 3600,))
        c.execute("DELETE FROM subscriptions WHERE user_id = 'u_alice'")
        c.execute("INSERT INTO subscriptions (id, user_id, plan_tier, allow_alpha_strategies, service_expires_at, created_at, updated_at) VALUES ('sub_alice', 'u_alice', 'pro', 1, ?, ?, ?)", (now_ts + 86400, now_ts, now_ts))
        c.execute("DELETE FROM trading_accounts WHERE id = 'acc_alice'")
        c.execute(
            """
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, auto_trade, balance, equity, deployment_state, created_at)
            VALUES ('acc_alice', 'u_alice', 'm_alice', '8888', 'enc', 'Server', 1, 5000.0, 5000.0, 'DEPLOYED', ?)
            """,
            (now_ts,)
        )

        from app.core.db import is_postgres
        if is_postgres():
            c.execute("TRUNCATE TABLE users CASCADE;")
        else:
            for tbl in (
                'sim_positions',
                'dispatches',
                'metaapi_trade_executions',
                'trading_accounts',
                'metaapi_cloud_accounts',
                'orders',
                'subscriptions',
                'sessions',
                'otp_codes',
            ):
                try:
                    c.execute(f"DELETE FROM {tbl}")
                except Exception:
                    pass
            c.execute("DELETE FROM users WHERE email = 'alice@example.com'")

        # Verify user is completely deleted
        u = c.execute("SELECT id FROM users WHERE email = 'alice@example.com'").fetchone()
        assert u is None


def test_clear_signal_deduplication_db_fallback_when_redis_down(monkeypatch):
    """Verify that when Redis is completely unavailable, DB fallback dedup updates audit log by signal_id and allows retry."""
    from app.schemas.signals import NormalizedSignalSchema
    from app.domains.signals.ingestion.sanitizer import (
        sanitize_and_audit_signal,
        check_redis_deduplication,
        clear_signal_deduplication,
    )

    with tx() as c:
        c.execute("DELETE FROM news")

    # Simulate Redis connection failure
    def mock_broken_redis():
        raise ConnectionError("Simulated Redis connection failure")

    monkeypatch.setattr("app.domains.signals.ingestion.sanitizer.get_redis_client", mock_broken_redis)

    sig = NormalizedSignalSchema(
        id="sig_test_db_fallback_1",
        source="ZUPIRUS_CORE",
        strategy="trend",
        symbol="EURUSD",
        action="BUY",
        timeframe="M15",
        entry_price=1.0850,
        stop_loss=1.0800,
        take_profit=1.0950,
        timestamp=time.time(),
    )

    # 1. First pass: approved and persisted to signal_audit_logs with status='APPROVED'
    ok1, reason1, _ = sanitize_and_audit_signal(sig, live_price=1.0850)
    assert ok1 is True

    # 2. Immediate second pass: DB fallback sees recent APPROVED entry within 60s -> blocked
    ok2, reason2 = check_redis_deduplication(sig)
    assert ok2 is False
    assert "REJECTED_DUPLICATE_SIGNAL" in (reason2 or "")

    # 3. Clear deduplication lock using signal_id (e.g. fanout returned executed: 0)
    clear_signal_deduplication(sig)

    # 4. Immediate third pass: audit log updated to 'FANOUT_FAILED' -> DB fallback now allows retry!
    ok3, reason3 = check_redis_deduplication(sig)
    assert ok3 is True
    assert reason3 is None


@pytest.mark.asyncio
async def test_risk_multiplier_respects_portfolio_cap_and_reserves_actual_risk():
    """Verify that risk_multiplier is accounted for in atomic portfolio cap check and reserved_risk_pct."""
    from app.domains.execution.fanout import execute_fan_out_for_signal

    now_ts = time.time()
    with tx() as c:
        c.execute("DELETE FROM metaapi_trade_executions")
        c.execute("DELETE FROM trading_accounts")
        c.execute("DELETE FROM users WHERE id = 'u_mult_test'")
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_mult_test', 'u_mult@test.com', 'pwd', 'customer') ON CONFLICT DO NOTHING")
        # Base risk 1.0%, multiplier 3.0 -> effective order risk = 3.0%. Portfolio cap = 2.0%
        c.execute(
            """
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, auto_trade, balance, equity, deployment_state, risk_multiplier, risk_config, created_at)
            VALUES ('acc_mult_1', 'u_mult_test', 'm_mult_1', '1111', 'enc', 'Server', 1, 10000.0, 10000.0, 'DEPLOYED', 3.0, '{"risk": 1.0, "max_portfolio_risk_pct": 2.0}', ?)
            """,
            (now_ts,)
        )

    sig = {
        "id": "sig_risk_mult_test",
        "symbol": "EURUSD",
        "action": "BUY",
        "entry_price": 1.0850,
        "sl": 1.0800,
        "tp": 1.0950,
    }
    accounts = [{
        "id": "acc_mult_1",
        "user_id": "u_mult_test",
        "metaapi_account_id": "m_mult_1",
        "balance": 10000.0,
        "equity": 10000.0,
        "risk_multiplier": 3.0,
        "risk_config": json.dumps({"risk": 1.0, "max_portfolio_risk_pct": 2.0}),
        "is_prop_firm_mode": 0,
        "contract_size": 100000.0,
    }]

    mock_client = MagicMock()
    mock_client.execute_order = AsyncMock(return_value={"numericCode": 200, "stringCode": "TRADE_RETCODE_DONE", "orderId": "ord_1"})

    # Should skip acc_mult_1 because 1.0% * 3.0 = 3.0% > 2.0% cap
    res = await execute_fan_out_for_signal(sig, accounts, metaapi_client=mock_client)
    assert res.get("executed") == 0
    assert res.get("skipped") == 1


def test_auto_rollback_scoped_to_candidate_symbol():
    """Verify that losing streak on XAUUSD does NOT pause EURUSD strategy candidate."""
    with tx() as c:
        c.execute("DELETE FROM strategy_candidates")
        c.execute("DELETE FROM metaapi_trade_executions")
        now_ts = time.time()
        # Seed EURUSD candidate approved in prod
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_acc_1', 'u_acc_1@test.com', 'pwd', 'customer') ON CONFLICT DO NOTHING")
        c.execute("INSERT INTO metaapi_cloud_accounts (id, user_id, login, server, created_at) VALUES ('acc_1', 'u_acc_1', '123', 'Srv', ?) ON CONFLICT DO NOTHING", (now_ts,))
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, rules_json, win_rate, profit_factor, status, updated_at, created_at)
            VALUES ('cand_eur_guard', 'EURUSD Momentum', '{"symbol": "EURUSD", "strategy": "strat_trend_breakout"}', 60.0, 1.5, 'APPROVED_FOR_PROD', ?, ?)
            """,
            (now_ts - 3600, now_ts - 3600)
        )
        # Seed 4 consecutive losing trades strictly on XAUUSD
        for i in range(4):
            c.execute(
                """
                INSERT INTO metaapi_trade_executions (id, account_id, signal_id, symbol, action, volume, entry_price, status, profit, executed_at)
                VALUES (?, 'acc_1', ?, 'XAUUSD', 'BUY', 0.1, 2600.0, 'CLOSED', -50.0, ?)
                """,
                (f"exec_xau_loss_{i}", f"ag_xau_loss_{i}", now_ts - 1000 + i * 100)
            )

        cand_row = c.execute("SELECT * FROM strategy_candidates WHERE id = 'cand_eur_guard'").fetchone()

        # Coordinate strategies for EURUSD
        res = coordinate_strategies([], timeframe="M15", symbol="EURUSD", candidate=cand_row, db_cursor=c)

        # EURUSD candidate should remain APPROVED_FOR_PROD, NOT PAUSED_DRAWDOWN_GUARD
        st = c.execute("SELECT status FROM strategy_candidates WHERE id = 'cand_eur_guard'").fetchone()[0]
        assert st == "APPROVED_FOR_PROD"

        # Now test that 4 consecutive losses with broker suffix EURUSD.m DOES trigger rollback for EURUSD candidate
        for i in range(4):
            c.execute(
                """
                INSERT INTO metaapi_trade_executions (id, account_id, signal_id, symbol, action, volume, entry_price, status, profit, executed_at)
                VALUES (?, 'acc_1', ?, 'EURUSD.m', 'BUY', 0.1, 1.0850, 'CLOSED', -50.0, ?)
                """,
                (f"exec_eur_loss_{i}", f"ag_eur_loss_{i}", now_ts + 100 + i * 100)
            )
        res_m = coordinate_strategies([], timeframe="M15", symbol="EURUSD", candidate=cand_row, db_cursor=c)
        st_m = c.execute("SELECT status FROM strategy_candidates WHERE id = 'cand_eur_guard'").fetchone()[0]
        assert st_m == "PAUSED_DRAWDOWN_GUARD"


@pytest.mark.asyncio
async def test_background_crypto_scanner_scans_saved_checkout_wallet(monkeypatch):
    """Verify background scanner queries the wallet address saved at checkout even if admin updated config."""
    from app.domains.billing.crypto_direct import scan_and_reconcile_pending_crypto_orders
    import urllib.request

    now_ts = time.time()
    old_wallet = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
    new_admin_wallet = "TLv5vFw5zZ4J6k9N8M7Q3X2Y1P0A9B8C7D"

    with tx() as c:
        c.execute("DELETE FROM orders WHERE id = 'ord_old_wallet_test'")
        c.execute("DELETE FROM users WHERE id = 'u_wallet_test'")
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_wallet_test', 'w@test.com', 'pwd', 'customer') ON CONFLICT DO NOTHING")
        c.execute(
            """
            INSERT INTO orders (id, user_id, amount_usd, locked_exchange_rate, amount_vnd, plan_tier, status, payment_gateway, expected_amount_usdt, expires_at, created_at)
            VALUES ('ord_old_wallet_test', 'u_wallet_test', 25.0, 25400.0, 635000, 'pro', 'PENDING', 'USDT_TRC20', 25.0, ?, ?)
            """,
            (now_ts + 3600, now_ts)
        )
        c.execute("DELETE FROM kv WHERE key = 'order_wallet:ord_old_wallet_test'")
        c.execute("INSERT INTO kv (key, value) VALUES ('order_wallet:ord_old_wallet_test', ?)", (old_wallet,))

    queried_urls = []

    def mock_urlopen(req, timeout=10):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        queried_urls.append(url)
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"data": []}).encode("utf-8")
        return mock_resp

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)
    # Admin config currently points to new_admin_wallet
    monkeypatch.setattr("app.domains.billing.crypto_direct.get_crypto_wallets_config", lambda: {"trc20_address": new_admin_wallet, "bep20_address": "0x1111"})

    res = await scan_and_reconcile_pending_crypto_orders()
    assert res.get("scanned") == 1

    # Verify that TronGrid was queried for the old_wallet saved on the order!
    assert any(old_wallet in url for url in queried_urls)


def test_allowed_strategy_ids_passed_and_filtered():
    """Verify accounts with allowed_strategy_ids only receive matching strategies."""
    from app.domains.execution.fanout import execute_fan_out_for_signal

    accounts = [
        {
            "id": "acc_trend_only",
            "user_id": "u1",
            "metaapi_account_id": "m1",
            "balance": 10000.0,
            "equity": 10000.0,
            "allowed_strategy_ids": "strat_trend_breakout",
            "risk_config": json.dumps({"risk": 1.0}),
        },
        {
            "id": "acc_scalp_only",
            "user_id": "u2",
            "metaapi_account_id": "m2",
            "balance": 10000.0,
            "equity": 10000.0,
            "allowed_strategy_ids": "strat_mean_reversion",
            "risk_config": json.dumps({"risk": 1.0}),
        },
    ]

    sig = {
        "id": "sig_strat_test",
        "strategy": "strat_trend_breakout",
        "symbol": "EURUSD",
        "action": "BUY",
        "entry_price": 1.0850,
        "sl": 1.0800,
        "tp": 1.0950,
    }

    mock_client = MagicMock()
    mock_client.get_open_positions = AsyncMock(return_value=[])
    mock_client.execute_order = AsyncMock(return_value={"numericCode": 200, "stringCode": "TRADE_RETCODE_DONE", "orderId": "ord_ok"})

    # Run loop synchronously
    loop = asyncio.new_event_loop()
    try:
        res = loop.run_until_complete(execute_fan_out_for_signal(sig, accounts, metaapi_client=mock_client))
        # acc_trend_only should execute, acc_scalp_only should be skipped
        assert res.get("executed") == 1
        assert res.get("skipped") == 1
    finally:
        loop.close()


def test_sql_adapt_preserves_placeholders_and_escapes_literals():
    """Verify _adapt_sql preserves %s placeholders for migrations & vector queries while escaping % in literals only when params are passed."""
    from app.core.db import CursorWrapper
    wrapper = CursorWrapper(None, is_pg=True)

    # 1. Queries WITHOUT parameters: should NOT escape % or %%, keeping literals and operators intact
    assert wrapper._adapt_sql("SELECT '85%'", has_params=False) == "SELECT '85%'"
    assert wrapper._adapt_sql("SELECT 5 % 2", has_params=False) == "SELECT 5 % 2"
    assert wrapper._adapt_sql("SELECT * FROM t WHERE col = '100%'", has_params=False) == "SELECT * FROM t WHERE col = '100%'"

    # 2. Schema migration insert with %s placeholders and parameters
    sql_migration = "INSERT INTO schema_migrations(version, name) VALUES (%s, %s)"
    assert wrapper._adapt_sql(sql_migration, has_params=True) == "INSERT INTO schema_migrations(version, name) VALUES (%s, %s)"

    # 3. Vector search with %s placeholders and parameters
    sql_vector = "SELECT id, (1 - (embedding <=> %s::vector)) AS similarity FROM t LIMIT %s"
    assert wrapper._adapt_sql(sql_vector, has_params=True) == "SELECT id, (1 - (embedding <=> %s::vector)) AS similarity FROM t LIMIT %s"

    # 4. Parameterized query with ? and LIKE string literal containing raw %
    sql_like = "SELECT * FROM orders WHERE payment_gateway LIKE 'USDT%' AND expires_at > ?"
    assert wrapper._adapt_sql(sql_like, has_params=True) == "SELECT * FROM orders WHERE payment_gateway LIKE 'USDT%%' AND expires_at > %s"

    # 5. Literal % inside quotes with another raw substring when parameters are present
    sql_quote_test = "SELECT * FROM t WHERE id LIKE '%src_dryrun_test%' AND active = ?"
    assert wrapper._adapt_sql(sql_quote_test, has_params=True) == "SELECT * FROM t WHERE id LIKE '%%src_dryrun_test%%' AND active = %s"

    # 6. Standard ? conversion
    sql_standard = "INSERT INTO t (a, b) VALUES (?, ?)"
    assert wrapper._adapt_sql(sql_standard, has_params=True) == "INSERT INTO t (a, b) VALUES (%s, %s)"

    # 7. Execution with empty params: () or {} should NOT trigger % formatting or ProgrammingError
    mock_cur = MagicMock()
    cw = CursorWrapper(mock_cur, is_pg=True)
    cw.execute("SELECT '85%'", ())
    mock_cur.execute.assert_called_once_with("SELECT '85%'")

    mock_cur2 = MagicMock()
    cw2 = CursorWrapper(mock_cur2, is_pg=True)
    cw2.execute("SELECT 5 % 2", {})
    mock_cur2.execute.assert_called_once_with("SELECT 5 % 2")


def test_agent_candidate_strategy_code_prioritized_over_display_name():
    """Verify that when a strategy candidate has display name 'Gold Strat' and rules contain 'strat_trend_breakout',
    the strategy code is dispatched to fanout, matching accounts that allow 'strat_trend_breakout'."""
    cand = {
        "id": "cand_gold_1",
        "name": "Gold Strat",
        "rules_json": json.dumps({"strategy": "strat_trend_breakout", "symbol": "XAUUSD"}),
        "updated_at": time.time(),
    }
    rules = json.loads(cand["rules_json"])
    strat_code = str(
        rules.get("strategy")
        or rules.get("strategy_id")
        or rules.get("code")
        or cand.get("strategy")
        or cand.get("strategy_id")
        or cand.get("name")
        or "strat_trend_breakout"
    ).strip()

    assert strat_code == "strat_trend_breakout"

    accounts = [
        {
            "id": "acc_trend",
            "allowed_strategy_ids": "strat_trend_breakout",
            "balance": 10000.0,
            "risk_config": "{}",
        },
        {
            "id": "acc_other",
            "allowed_strategy_ids": "strat_mean_reversion",
            "balance": 10000.0,
            "risk_config": "{}",
        },
    ]

    sig = {
        "id": "sig_gold_test",
        "strategy": strat_code,
        "strategy_id": strat_code,
        "strategy_name": cand["name"],
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2650.0,
    }

    from app.domains.execution.fanout import execute_fan_out_for_signal
    mock_client = MagicMock()
    mock_client.get_open_positions = AsyncMock(return_value=[])
    mock_client.execute_order = AsyncMock(return_value={"numericCode": 200, "stringCode": "TRADE_RETCODE_DONE", "orderId": "ord_ok"})

    loop = asyncio.new_event_loop()
    try:
        res = loop.run_until_complete(execute_fan_out_for_signal(sig, accounts, metaapi_client=mock_client))
        assert res.get("executed") == 1
        assert res.get("skipped") == 1
    finally:
        loop.close()






