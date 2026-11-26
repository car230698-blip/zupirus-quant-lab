import pytest
from app.domains.quant.candles import Candle
from app.domains.quant.studies import (
    run_studies,
    rule_backtest,
    rule_backtest_asian_mean_reversion,
    rule_backtest_london_liquidity_sweep,
)
from app.domains.ai.report_writer import generate_research_report


def _make_test_candles():
    base_ts = 1704067200  # 2024-01-01 00:00 UTC (Asia open)
    candles = []
    # Generate 40 bars of M15 data spanning Asia (00:00-06:00, 24 bars) and London (07:00-11:00, 16 bars)
    for i in range(40):
        t = base_ts + i * 900
        # Simulated price cycle
        o = 2050.0 + (i % 8) * 0.5
        c = o + (0.3 if i % 2 == 0 else -0.3)
        h = max(o, c) + 0.8
        l = min(o, c) - 0.8
        candles.append(Candle(time=t, open=o, high=h, low=l, close=c, volume=100.0))
    return candles


def test_multi_strategy_studies():
    candles = _make_test_candles()
    
    # 1. Breakout & Retest
    res_break = run_studies(candles, symbol="XAUUSD", timeframe="M15", strategy_name="breakout_retest")
    assert res_break["symbol"] == "XAUUSD"
    assert any(s["id"] == "rule_backtest_asia_break" for s in res_break["studies"])

    # 2. Asian Mean-Reversion
    res_mr = run_studies(candles, symbol="XAUUSD", timeframe="M15", strategy_name="asian_mean_reversion")
    assert any(s["id"] == "rule_backtest_asian_mean_reversion" for s in res_mr["studies"])
    mr_study = next(s for s in res_mr["studies"] if s["id"] == "rule_backtest_asian_mean_reversion")
    assert "monte_carlo_risk" in mr_study
    assert "cost_stress_matrix" in mr_study

    # 3. London Liquidity Sweep
    res_sweep = run_studies(candles, symbol="XAUUSD", timeframe="M15", strategy_name="london_sweep")
    assert any(s["id"] == "rule_backtest_london_liquidity_sweep" for s in res_sweep["studies"])
    sweep_study = next(s for s in res_sweep["studies"] if s["id"] == "rule_backtest_london_liquidity_sweep")
    assert "equity_series" in sweep_study


def test_ai_report_writer_synthesis():
    candles = _make_test_candles()
    bundle = run_studies(candles, symbol="XAUUSD", timeframe="M15", strategy_name="breakout_retest")
    
    report = generate_research_report(bundle, use_gemini=False)
    assert report["success"] is True
    assert len(report["sections"]) == 5
    assert "Phần 1: Tóm Tắt Điều Hành" in report["sections"][0]["title"]
    assert "Phần 5: Phân Bổ Vốn" in report["sections"][4]["title"]
    assert len(report["highlights_vi"]) >= 3
    assert len(report["executive_summary_en"]) > 20
