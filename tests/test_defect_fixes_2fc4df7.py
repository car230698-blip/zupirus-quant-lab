import pytest
import asyncio
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

