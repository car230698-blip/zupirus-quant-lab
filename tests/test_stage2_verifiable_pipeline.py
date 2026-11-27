import csv
import io
import math
import pytest
from app.domains.quant.candles import Candle
from app.domains.quant.data_feed import build_dataset_identity, compute_candles_sha256
from app.domains.quant.studies import (
    run_studies,
    rule_backtest,
    _walk_trade_exit,
    _compile_rule_study_result,
    generate_ledger_csv,
)
from app.domains.ai.autonomous_gate import evaluate_institutional_gate


def _make_dummy_candles(n_days=10, bars_per_day=30):
    candles = []
    base_ts = 1700000000
    for day in range(n_days):
        day_start = base_ts + day * 86400
        for b in range(bars_per_day):
            t = day_start + b * 900
            p = 2000.0 + (day % 3) * 10.0 + b * 0.5
            candles.append(Candle(
                time=t,
                open=p,
                high=p + 2.0,
                low=p - 2.0,
                close=p + 0.5,
                volume=100.0,
            ))
    return candles


def test_stage2_1_dataset_identity_provenance():
    """Stage 2.1: GC=F is explicitly marked COMEX Gold Futures, never falsely claimed as Spot."""
    candles = _make_dummy_candles(n_days=3, bars_per_day=20)
    ds = build_dataset_identity("XAUUSD", "M15", candles)
    assert ds.asset_class == "COMEX_GOLD_FUTURES"
    assert ds.symbol == "GC=F"
    assert ds.timeframe == "M15"
    assert ds.timezone == "UTC"
    assert ds.is_spot_confirmed is False
    assert "Hợp đồng tương lai vàng COMEX" in ds.symbol_display
    assert "không phải giá giao ngay" in ds.limitations
    assert len(ds.data_sha256) == 64

    # ForeX spot
    ds_fx = build_dataset_identity("EURUSD", "M15", candles)
    assert ds_fx.asset_class == "FOREX_SPOT"
    assert ds_fx.symbol == "EURUSD=X"
    assert ds_fx.is_spot_confirmed is True


def test_stage2_2_conservative_same_bar_and_gap_handling():
    """Stage 2.2: Point-in-time Breakout & Retest rules with conservative SL first and gap execution."""
    t0 = 1700000000
    # Case A: Same-bar touch of both SL (1990) and TP (2020) for Long -> Stop loss hit first
    bar_touch_both = Candle(time=t0, open=2000.0, high=2025.0, low=1985.0, close=2010.0, volume=10.0)
    res_both = _walk_trade_exit([bar_touch_both], side="long", entry=2000.0, stop=1990.0, target=2020.0)
    assert res_both is not None
    assert res_both.exit_reason == "STOP_LOSS"
    assert res_both.gross_r == -1.0
    assert res_both.exit_price == 1990.0

    # Case B: Gap open below stop (stop=1990, open=1980) -> Fill at gap open with slippage loss
    bar_gap_down = Candle(time=t0, open=1980.0, high=1985.0, low=1975.0, close=1982.0, volume=10.0)
    res_gap = _walk_trade_exit([bar_gap_down], side="long", entry=2000.0, stop=1990.0, target=2020.0)
    assert res_gap is not None
    assert res_gap.exit_reason == "STOP_LOSS"
    assert res_gap.exit_price == 1980.0
    assert res_gap.gross_r == -2.0  # (1980 - 2000) / 10 = -2.0R

    # Case C: Time stop at bar 32
    long_walk = [
        Candle(time=t0 + i * 900, open=2000.0, high=2005.0, low=1995.0, close=2002.0, volume=10.0)
        for i in range(40)
    ]
    res_time = _walk_trade_exit(long_walk, side="long", entry=2000.0, stop=1990.0, target=2030.0, max_bars=32)
    assert res_time is not None
    assert res_time.exit_reason in ("TIME_STOP", "SESSION_CLOSE")
    assert res_time.bars_held <= 32


def test_stage2_3_ledger_derived_metrics_and_zero_loss_display():
    """Stage 2.3: All statistics, split breakdowns, and tables derive strictly from ledger.
    Profit factor with 0 losses displays 'Không xác định'."""
    # Test 0 losses scenario
    trades_all_win = [
        {
            "trade_id": "tr_001",
            "day": "2026-01-01",
            "split_set": "TRAIN",
            "side": "long",
            "session": "london",
            "entry_time_utc": 1700000000,
            "entry_datetime": "2026-01-01 08:00:00 UTC",
            "exit_time_utc": 1700003600,
            "exit_datetime": "2026-01-01 09:00:00 UTC",
            "entry_price": 2000.0,
            "exit_price": 2015.0,
            "sl_price": 1990.0,
            "tp_price": 2015.0,
            "cost_pips": 3.5,
            "cost_r": 0.035,
            "exit_reason": "TAKE_PROFIT",
            "gross_r": 1.5,
            "net_r": 1.465,
            "raw_r": 1.5,
            "r_multiple": 1.465,
            "gross_pnl": 15.0,
            "net_pnl": 14.65,
            "is_win": True,
            "bars_held": 4,
        }
    ]
    res_win = _compile_rule_study_result(
        study_id="rule_test_win",
        trades=trades_all_win,
        round_trip_cost_r=0.035,
        parameters={"cost_assumed_pips": 3.5},
        notes_en="notes",
        notes_vi="notes",
    )
    # Check table rows for profit factor display
    t_rows = dict(res_win["table"]["rows"])
    assert "Không xác định (0 lệnh lỗ" in t_rows.get("profit_factor_label", "")
    assert res_win["ledger_csv"] != ""
    assert "tr_001" in res_win["ledger_csv"]

    # Verify CSV is parseable
    f = io.StringIO(res_win["ledger_csv"])
    reader = list(csv.DictReader(f))
    assert len(reader) == 1
    assert reader[0]["trade_id"] == "tr_001"
    assert reader[0]["exit_reason"] == "TAKE_PROFIT"
    assert float(reader[0]["net_r"]) == 1.465


def test_stage2_4_gatekeeper_three_verdict_discrimination():
    """Stage 2.4: Gatekeeper properly differentiates INSUFFICIENT_EVIDENCE,
    VALID_METHODOLOGY_NEGATIVE_EDGE, and QUALIFIED_EDGE with explicit zero handling."""
    # Case A: Insufficient trades (< 20)
    bundle_sparse = {
        "candle_count": 20,
        "studies": [{
            "id": "rule_backtest_asia_break",
            "table": {"rows": [["trades", 5], ["profit_factor", 2.0], ["expectancy_r", 0.5]]},
        }],
    }
    gate_sparse = evaluate_institutional_gate(bundle_sparse)
    assert gate_sparse.status == "INSUFFICIENT_EVIDENCE"
    assert gate_sparse.passed is False

    # Case B: Valid methodology with negative edge (expectancy <= 0, PF < 1.25)
    bundle_neg = {
        "candle_count": 200,
        "studies": [{
            "id": "rule_backtest_asia_break",
            "table": {"rows": [
                ["trades", 50],
                ["win_rate", 0.35],
                ["profit_factor", 0.85],
                ["expectancy_r", -0.15],
                ["max_drawdown_r", 12.0],
                ["sharpe_ratio", -0.5],
                ["t_statistic", -1.2],
                ["p_value", 0.23],
            ]},
            "monte_carlo_risk": {"p95_max_dd": 16.0, "prob_loss_streak_7": 0.55},
            "cost_stress_matrix": {"rows": [["0.050R (Standard)", 0.05, 50, 35.0, -0.20, 0.7, 14.0, -1.5, 0.15]]},
        }],
    }
    gate_neg = evaluate_institutional_gate(bundle_neg)
    assert gate_neg.status == "VALID_METHODOLOGY_NEGATIVE_EDGE"
    assert gate_neg.passed is False
    assert "VALID_METHODOLOGY_NEGATIVE_EDGE" in gate_neg.summary_vi

    # Case C: Qualified Edge (5 hurdles passed)
    bundle_qual = {
        "candle_count": 500,
        "dataset_identity": {"asset_class": "COMEX_GOLD_FUTURES", "bars_count": 500},
        "studies": [{
            "id": "rule_backtest_asia_break",
            "table": {"rows": [
                ["trades", 45],
                ["win_rate", 0.60],
                ["profit_factor", 1.85],
                ["expectancy_r", 0.38],
                ["max_drawdown_r", 6.5],
                ["sharpe_ratio", 1.95],
                ["t_statistic", 2.65],
                ["p_value", 0.008],
            ]},
            "monte_carlo_risk": {"p95_max_dd": 11.0, "prob_loss_streak_7": 0.15},
            "cost_stress_matrix": {"rows": [["0.050R (Standard ~2.5 pips)", 0.05, 45, 60.0, 0.33, 1.70, 7.5, 2.45, 0.01]]},
        }],
    }
    gate_qual = evaluate_institutional_gate(bundle_qual)
    assert gate_qual.status == "QUALIFIED_EDGE"
    assert gate_qual.passed is True
    assert "QUALIFIED_EDGE" in gate_qual.summary_vi
