"""Core statistical studies: same candles in, same tables out."""
from datetime import datetime, timezone

import pytest

from app.domains.quant.candles import CandleValidationError, normalize_candles, session_name
from app.domains.quant.methodology import DISCLAIMER_EN, DISCLAIMER_VI, build_methodology
from app.domains.quant.pdf_doc import build_license_page, build_methodology_pdf
from app.domains.quant.studies import run_studies


def _ts(day: int, hour: int, minute: int = 0) -> int:
    return int(datetime(2024, 1, day, hour, minute, tzinfo=timezone.utc).timestamp())


def _bar(day, hour, open_, high, low, close, minute=0):
    return {"time": _ts(day, hour, minute), "open": open_, "high": high, "low": low, "close": close, "volume": 1}


def _sample_day():
    """Asia range 2000-2010 (20 M15 bars), then London breakout, retest, entry and TP."""
    bars = []
    # 20 M15 bars for Asia (00:00 to 04:45 UTC)
    for i in range(20):
        h = i // 4
        m = (i % 4) * 15
        bars.append(_bar(2, h, 2005.0, 2010.0 if i == 5 else 2008.0, 2000.0 if i == 10 else 2002.0, 2005.0, minute=m))

    # Bar 20 at 05:00 UTC: Breakout long! Close at 2016 (> 2010)
    bars.append(_bar(2, 5, 2005.0, 2018.0, 2004.0, 2016.0, minute=0))
    # Bar 21 at 05:15 UTC: Retest! Low reaches 2009 (<= 2010 and > 2000)
    bars.append(_bar(2, 5, 2016.0, 2017.0, 2009.0, 2012.0, minute=15))
    # Bar 22 at 05:30 UTC: Entry at open 2012. Risk = 12.0. Target = 2012 + 18 = 2030. High reaches 2035 -> TP!
    bars.append(_bar(2, 5, 2012.0, 2035.0, 2011.0, 2032.0, minute=30))
    # Bar 23 at 05:45 UTC
    bars.append(_bar(2, 5, 2032.0, 2034.0, 2028.0, 2030.0, minute=45))
    return bars


def test_session_labels_use_utc():
    assert session_name(_ts(2, 1)) == "asia"
    assert session_name(_ts(2, 8)) == "london"
    assert session_name(_ts(2, 14)) == "new_york"
    assert session_name(_ts(2, 22)) == "off_hours"


def test_rejects_inconsistent_ohlc():
    with pytest.raises(CandleValidationError):
        normalize_candles([{"time": _ts(2, 1), "open": 10, "high": 9, "low": 11, "close": 10}])


def test_duplicate_timestamp_keeps_the_last_row():
    candles = normalize_candles([
        _bar(2, 1, 100, 101, 99, 100),
        _bar(2, 1, 110, 112, 109, 111),
    ])
    assert len(candles) == 1
    assert candles[0].close == 111


def test_studies_are_reproducible_and_do_not_promise_profit():
    bundle = run_studies(_sample_day(), symbol="xau/usd", timeframe="M15", round_trip_cost_r=0)
    again = run_studies(_sample_day(), symbol="XAUUSD", timeframe="M15", round_trip_cost_r=0)
    assert bundle == again
    assert bundle["symbol"] == "XAUUSD"
    assert bundle["candle_count"] == len(_sample_day())
    by_id = {item["id"]: item for item in bundle["studies"]}
    session = by_id["session_profile"]
    assert session["table"]["rows"][0][0] == "asia"
    rule = by_id["rule_backtest_asia_break"]
    assert rule["sample_size"] == 1
    metrics = {row[0]: row[1] for row in rule["table"]["rows"]}
    assert metrics["win_rate"] == 1.0
    assert metrics["expectancy_r"] == 1.4625
    assert metrics["max_drawdown_r"] == 0.0
    assert "promise" in rule["notes_en"]
    assert "cam kết" in rule["notes_vi"]


def test_cost_reduces_the_recorded_r_multiple():
    bundle = run_studies(_sample_day(), round_trip_cost_r=0.25)
    rule = next(item for item in bundle["studies"] if item["id"] == "rule_backtest_asia_break")
    assert rule["trades"][0]["r_multiple"] == 1.25


def test_directional_persistence_is_one_when_every_step_continues():
    bars = []
    price = 100.0
    for hour in range(6):
        nxt = price + 1
        bars.append(_bar(3, hour, price, nxt, price, nxt))
        price = nxt
    bundle = run_studies(bars, timeframe="H1")
    trend = next(item for item in bundle["studies"] if item["id"] == "mean_reversion_trend")
    metrics = {row[0]: row[1] for row in trend["table"]["rows"]}
    assert metrics["directional_persistence"] == 1.0


def test_methodology_preview_is_shorter_than_the_full_note_and_states_the_disclaimer():
    bundle = run_studies(_sample_day(), symbol="XAUUSD", timeframe="H1")
    document = build_methodology(
        bundle,
        title_vi="Phiên Á và biên độ London trên XAUUSD",
        title_en="Asia range and the London session on XAUUSD",
        version="v1.0",
    )
    assert len(document["preview_sections"]) < len(document["full_sections"])
    assert "không phải cam kết lợi nhuận" in DISCLAIMER_VI
    assert "not a promise of profit" in DISCLAIMER_EN
    preview = build_methodology_pdf(document, lang="vi", preview=True)
    full = build_methodology_pdf(document, lang="vi", preview=False)
    english = build_methodology_pdf(document, lang="en", preview=False)
    assert preview.startswith(b"%PDF")
    assert len(full) > len(preview)
    assert "Phiên".encode("utf-8") in full or b"Phien" in full or b"Asia" in english
    assert "không phải cam kết lợi nhuận".encode("utf-8") in full or "cam k" in full.decode("latin-1", "ignore")


def test_license_page_names_the_buyer():
    page = build_license_page(["Buyer / Người mua: minh@example.com", "Version / Phiên bản: v1.0"])
    assert page.startswith(b"%PDF")
    assert b"minh@example.com" in page


def test_gap_open_beyond_asia_boundary_enters_at_open():
    from app.domains.quant.studies import rule_backtest

    # 20 Asia bars + breakout + retest + entry bar opening with gap beyond broken level
    bars = []
    for i in range(20):
        h = i // 4
        m = (i % 4) * 15
        bars.append(_bar(2, h, 2005.0, 2010.0 if i == 5 else 2008.0, 2000.0 if i == 10 else 2002.0, 2005.0, minute=m))

    # Breakout at 05:00 UTC (close 2015 > 2010)
    bars.append(_bar(2, 5, 2005.0, 2018.0, 2004.0, 2015.0, minute=0))
    # Retest at 05:15 UTC (touches 2009 <= 2010)
    bars.append(_bar(2, 5, 2015.0, 2016.0, 2009.0, 2012.0, minute=15))
    # Next bar at 05:30 UTC opens with gap at 2023.0 -> entry fills at open 2023.0
    bars.append(_bar(2, 5, 2023.0, 2024.0, 2021.0, 2022.0, minute=30))
    bars.append(_bar(2, 5, 2022.0, 2022.0, 2020.0, 2020.0, minute=45))

    out = rule_backtest(normalize_candles(bars), round_trip_cost_r=0.0)
    assert out["trades"]
    assert out["trades"][0]["entry"] == 2023.0


def test_gap_open_then_trade_through_boundary_fills_at_boundary():
    from app.domains.quant.studies import rule_backtest

    # Retest confirmed, entry at bar open following retest
    bars = []
    for i in range(20):
        h = i // 4
        m = (i % 4) * 15
        bars.append(_bar(2, h, 2005.0, 2010.0 if i == 5 else 2008.0, 2000.0 if i == 10 else 2002.0, 2005.0, minute=m))

    # Breakout at 05:00 UTC
    bars.append(_bar(2, 5, 2005.0, 2018.0, 2004.0, 2015.0, minute=0))
    # Retest at 05:15 UTC
    bars.append(_bar(2, 5, 2015.0, 2016.0, 2009.0, 2012.0, minute=15))
    # Entry bar at 05:30 UTC opens at 2012.0
    bars.append(_bar(2, 5, 2012.0, 2035.0, 2011.0, 2030.0, minute=30))
    bars.append(_bar(2, 5, 2030.0, 2032.0, 2025.0, 2028.0, minute=45))

    out = rule_backtest(normalize_candles(bars), round_trip_cost_r=0.0)
    assert out["trades"]
    assert out["trades"][0]["entry"] == 2012.0
    assert out["trades"][0]["gross_r"] == 1.5
    assert out["trades"][0]["r_multiple"] == 1.4625


def test_rejects_non_finite_and_overflow_prices():
    with pytest.raises(CandleValidationError):
        normalize_candles([{"time": _ts(2, 1), "open": "nan", "high": "nan", "low": "nan", "close": "nan"}])
    with pytest.raises(CandleValidationError):
        normalize_candles([{"time": _ts(2, 1), "open": 10**400, "high": 10**400, "low": 10**400, "close": 10**400}])


def test_research_import_rejects_live_feed_source():
    from app.domains.quant.service import ingest_candles

    with pytest.raises(ValueError, match="live-feed"):
        ingest_candles([_bar(2, 1, 1, 1, 1, 1)], symbol="EURUSD", timeframe="H1", source="MARKET_LIVE")
