"""Verification for upgraded quant engine, statistics, tail risk, and PDF charts."""
import pytest
from app.domains.quant.candles import parse_csv_candles, normalize_candles
from app.domains.quant.studies import (
    _t_stat_and_p_value,
    _sharpe_ratio,
    _sortino_ratio,
    _calmar_ratio,
    _monte_carlo_simulation,
    _cost_stress_matrix,
    run_studies,
)
from app.domains.quant.methodology import build_methodology
from app.domains.quant.pdf_doc import build_methodology_pdf


def test_statistical_significance_and_ratios():
    # Symmetric wins and losses
    returns = [1.0, -0.5, 1.5, -0.8, 1.2, -0.3, 2.0, -1.0, 0.5, 0.8]
    t_stat, p_val = _t_stat_and_p_value(returns)
    assert t_stat is not None
    assert p_val is not None
    assert 0.0 <= p_val <= 1.0

    sharpe = _sharpe_ratio(returns)
    assert sharpe is not None
    assert sharpe > 0

    sortino = _sortino_ratio(returns)
    assert sortino is not None
    assert sortino > 0

    calmar = _calmar_ratio(sum(returns), 2.5)
    assert calmar is not None
    assert calmar > 0


def test_monte_carlo_simulation():
    returns = [1.2, -0.5, 1.0, -1.0, 0.8, -0.6, 1.5, -0.4, -0.5, 1.1] * 5
    mc = _monte_carlo_simulation(returns, num_simulations=500, seed=123)
    assert mc["simulations"] == 500
    assert mc["p50_max_dd"] is not None
    assert mc["p95_max_dd"] is not None
    assert mc["p95_max_dd"] >= mc["p50_max_dd"]
    assert 0.0 <= mc["prob_loss_streak_5"] <= 1.0


def test_cost_stress_matrix():
    raw = [1.0, -1.0, 2.0, -1.0, 1.5, -1.0, 0.8] * 10
    tbl = _cost_stress_matrix(raw)
    assert len(tbl["rows"]) == 4
    # With higher cost, win rate and expectancy should decrease monotonically
    exp_0 = tbl["rows"][0][4]
    exp_high = tbl["rows"][3][4]
    assert exp_0 > exp_high


def test_csv_parser_and_normalization():
    csv_content = """Date,Time,Open,High,Low,Close,Volume
2024.01.02,08:00,2060.50,2065.00,2058.00,2063.20,150
2024.01.02,08:15,2063.20,2068.50,2062.00,2067.80,210
2024.01.02,08:30,2067.80,2070.10,2065.50,2066.00,180
"""
    parsed = parse_csv_candles(csv_content)
    assert len(parsed) == 3
    candles = normalize_candles(parsed)
    assert len(candles) == 3
    assert candles[0].open == 2060.50
    assert candles[2].close == 2066.00


def test_pdf_generation_with_equity_and_drawdown_charts():
    # Build 3 days of candles covering Asia (0-7 UTC) and London/NY (7-20 UTC)
    from datetime import datetime, timezone
    candles = []
    p = 2050.0
    for day in (2, 3, 4):
        for minute_offset in range(0, 24 * 60, 15):
            hour = minute_offset // 60
            minute = minute_offset % 60
            ts = int(datetime(2024, 1, day, hour, minute, tzinfo=timezone.utc).timestamp())
            # Asia session tight range, London session breakout
            if hour < 7:
                change = (minute_offset % 3 - 1) * 0.4
            else:
                change = 2.5 if (day % 2 == 0) else -2.5
            o = p
            c = p + change
            h = max(o, c) + 1.2
            l = min(o, c) - 1.2
            candles.append({
                "time": ts,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": 100,
            })
            p = c

    bundle = run_studies(candles, symbol="XAUUSD", timeframe="M15", round_trip_cost_r=0.025)
    doc = build_methodology(
        bundle,
        title_vi="Báo Cáo Kiểm Định Vàng COMEX M15",
        title_en="COMEX Gold M15 Quantitative Study",
    )
    # Check that methodology contains specialized sections
    section_headings = [s["heading_vi"] for s in doc["full_sections"]]
    assert any("Hành vi theo phiên" in h for h in section_headings)
    assert any("Đường đi lịch sử" in h for h in section_headings)

    # Render PDF bytes
    pdf_bytes = build_methodology_pdf(doc, lang="vi", preview=False)
    assert len(pdf_bytes) > 2000
    assert pdf_bytes.startswith(b"%PDF")
