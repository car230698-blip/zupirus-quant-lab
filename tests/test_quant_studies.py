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
    """Asia range 90-110, then a London break that reaches the 1R target."""
    bars = [
        _bar(2, 1, 100, 110, 90, 100),
        _bar(2, 3, 100, 108, 92, 101),
        _bar(2, 8, 100, 120, 99, 115),
        _bar(2, 9, 115, 135, 112, 132),
        _bar(2, 14, 132, 133, 120, 125),
    ]
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
    bundle = run_studies(_sample_day(), symbol="xau/usd", timeframe="h1", round_trip_cost_r=0)
    again = run_studies(_sample_day(), symbol="XAUUSD", timeframe="H1", round_trip_cost_r=0)
    assert bundle == again
    assert bundle["symbol"] == "XAUUSD"
    assert bundle["candle_count"] == 5
    by_id = {item["id"]: item for item in bundle["studies"]}
    session = by_id["session_profile"]
    assert session["table"]["rows"][0][0] == "asia"
    rule = by_id["rule_backtest_asia_break"]
    assert rule["sample_size"] == 1
    metrics = {row[0]: row[1] for row in rule["table"]["rows"]}
    assert metrics["win_rate"] == 1.0
    assert metrics["expectancy_r"] == 1.0
    assert metrics["max_drawdown_r"] == 0.0
    assert "promise" in rule["notes_en"]
    assert "cam kết" in rule["notes_vi"]


def test_cost_reduces_the_recorded_r_multiple():
    bundle = run_studies(_sample_day(), round_trip_cost_r=0.25)
    rule = next(item for item in bundle["studies"] if item["id"] == "rule_backtest_asia_break")
    assert rule["trades"][0]["r_multiple"] == 0.75


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
