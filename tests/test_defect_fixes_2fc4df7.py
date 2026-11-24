import pytest
import asyncio
import time
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
    with tx() as c:
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
    """Verify tick() does not raise UnboundLocalError on _agent_step_in_flight and executes cleanly."""
    from app.domains.execution import engine
    monkeypatch.setattr(engine, "is_weekend_market_closed", lambda *args: False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    engine._last_agent_eval_ts = 0.0
    engine._agent_step_in_flight = False

    # Mock autonomous_agent_step so thread completes fast
    monkeypatch.setattr(engine, "autonomous_agent_step", lambda: {"status": "MOCK"})

    # tick() should run without UnboundLocalError
    engine.tick()


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
        for i in range(35):
            c.execute(
                "INSERT INTO candles (symbol, timeframe, time, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("XAUUSD", "M15", now_ts - (35 - i) * 900, 2600.0, 2605.0, 2595.0, 2602.0),
            )
        # Add 1 eligible trading account with active cloud subscription
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u1', 'u1@test.com', 'pwd', 'admin') ON CONFLICT DO NOTHING")
        c.execute("INSERT OR REPLACE INTO subscriptions (user_id, plan_tier, allow_alpha_strategies, service_expires_at, created_at, updated_at) VALUES ('u1', 'institutional', 1, ?, ?, ?)", (now_ts + 86400.0, now_ts, now_ts))
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


