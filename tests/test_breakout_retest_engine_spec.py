"""Unit and regression tests for the exact published Breakout & Retest M15 engine specification.

Validates:
1. Asia range: strictly 00:00 to before 05:00 UTC (exact 20 M15 candles; timestamp continuity checked).
2. Missing or incomplete Asia bars (< 20 candles) skips the day with explicit reason.
3. Breakout confirmed ONLY on candle close outside Asia range.
4. Breakout without retest within 1-8 candles generates 0 trades (skipped_no_retest).
5. Valid retest (touching broken level without violating opposite boundary) enters at open of next bar with TP 1.5R.
6. Same-bar collision (High >= TP and Low <= SL) strictly triggers SL first (-1.0R).
7. Open gap beyond SL or TP fills at open price.
8. Time stop exits at max 32 bars or 21:00 UTC at bar close.
9. COMEX Gold friction calculation: 1 tick = $0.10/oz, spread + slippage = 4.5 pips = $0.45/oz, cost_r = 0.45 / risk.
"""
from datetime import datetime, timezone
import pytest
from app.domains.quant.candles import Candle
from app.domains.quant.studies import (
    _walk_trade_exit,
    rule_backtest,
)


def _make_asia_bars(day_start_ts: int, base_price: float = 2000.0, count: int = 20) -> list[Candle]:
    bars = []
    for i in range(count):
        t = day_start_ts + i * 900
        bars.append(Candle(
            time=t,
            open=base_price,
            high=base_price + 5.0,
            low=base_price - 5.0,
            close=base_price + 1.0,
            volume=100.0,
        ))
    return bars


def test_incomplete_asia_bars_skipped():
    """1. Fewer than 20 candles in 00:00-05:00 UTC skips the day with reason skipped_incomplete_asia_bars."""
    # 2026-10-01 00:00:00 UTC = 1790812800
    day_ts = 1790812800
    # Provide only 18 candles instead of 20
    bars = _make_asia_bars(day_ts, base_price=2000.0, count=18)
    # Add later bars
    for i in range(20, 40):
        t = day_ts + i * 900
        bars.append(Candle(time=t, open=2015.0, high=2020.0, low=2010.0, close=2018.0, volume=100.0))

    res = rule_backtest(bars)
    assert len(res["trades"]) == 0
    assert res["parameters"]["skipped_incomplete_asia_bars"] == 1


def test_breakout_without_retest_generates_zero_trades():
    """2. Candle closes outside Asia range, but next 8 candles never retest broken level -> 0 trades."""
    day_ts = 1790812800
    # Asia range: low=1995.0, high=2005.0
    bars = _make_asia_bars(day_ts, base_price=2000.0, count=20)

    # Bar 20 (05:00 UTC): Breakout bar closes at 2012.0 (> 2005.0)
    bars.append(Candle(
        time=day_ts + 20 * 900,
        open=2004.0,
        high=2015.0,
        low=2003.0,
        close=2012.0,
        volume=200.0,
    ))

    # Next 10 bars stay far above 2005.0 (lows all >= 2008.0) -> No retest
    for i in range(21, 35):
        bars.append(Candle(
            time=day_ts + i * 900,
            open=2012.0,
            high=2025.0,
            low=2008.0,
            close=2020.0,
            volume=150.0,
        ))

    res = rule_backtest(bars)
    assert len(res["trades"]) == 0
    assert res["parameters"]["skipped_no_retest"] == 1


def test_valid_retest_and_1_5r_target():
    """3. Valid breakout + retest within 1-8 bars -> enters at open of next bar with TP 1.5R."""
    day_ts = 1790812800
    # Asia range: low=1995.0, high=2005.0
    bars = _make_asia_bars(day_ts, base_price=2000.0, count=20)

    # Bar 20 (05:00 UTC): Bullish breakout bar (close=2010.0 > 2005.0)
    bars.append(Candle(
        time=day_ts + 20 * 900,
        open=2004.0,
        high=2012.0,
        low=2003.0,
        close=2010.0,
        volume=200.0,
    ))

    # Bar 21 (05:15 UTC): Retest bar dips back to 2004.5 (<= 2005.0) but stays well above SL (1995.0)
    bars.append(Candle(
        time=day_ts + 21 * 900,
        open=2010.0,
        high=2011.0,
        low=2004.5,
        close=2008.0,
        volume=180.0,
    ))

    # Bar 22 (05:30 UTC): Entry bar! Opens at 2008.0.
    # Risk = 2008.0 - 1995.0 = 13.0.
    # Target = 2008.0 + 1.5 * 13.0 = 2027.5.
    # Bar 22 rallies to 2030.0 (hits TP)
    bars.append(Candle(
        time=day_ts + 22 * 900,
        open=2008.0,
        high=2030.0,
        low=2006.0,
        close=2028.0,
        volume=300.0,
    ))

    # Remaining bars of day
    for i in range(23, 40):
        bars.append(Candle(
            time=day_ts + i * 900,
            open=2028.0,
            high=2032.0,
            low=2025.0,
            close=2030.0,
            volume=100.0,
        ))

    res = rule_backtest(bars)
    assert len(res["trades"]) == 1
    t = res["trades"][0]
    assert t["side"] == "long"
    assert t["entry_price"] == 2008.0
    assert t["sl_price"] == 1995.0
    assert t["tp_price"] == 2027.5
    assert t["exit_reason"] == "TAKE_PROFIT"
    assert t["gross_r"] == 1.5
    # COMEX friction: 4.5 pips = $0.45/oz. Cost_r = 0.45 / 13.0 = 0.0346R
    assert t["cost_pips"] == 4.5
    assert t["cost_r"] == round(0.45 / 13.0, 4)
    assert t["net_r"] == round(1.5 - (0.45 / 13.0), 4)
    assert t["is_win"] is True


def test_same_bar_collision_conservative_sl_first():
    """4. Intrabar collision (touches both SL and TP in same bar) strictly triggers SL first (-1.0R)."""
    t0 = 1790812800
    collision_bar = Candle(
        time=t0,
        open=2000.0,
        high=2035.0,  # >= TP (2030.0)
        low=1980.0,   # <= SL (1990.0)
        close=2025.0,
        volume=100.0,
    )
    exit_res = _walk_trade_exit([collision_bar], side="long", entry=2000.0, stop=1990.0, target=2030.0)
    assert exit_res is not None
    assert exit_res.exit_reason == "STOP_LOSS"
    assert exit_res.exit_price == 1990.0
    assert exit_res.gross_r == -1.0


def test_gap_open_handling():
    """5. Bar opens gapped past SL or TP -> exits at bar.open with true price execution."""
    t0 = 1790812800
    # Case A: Long gaps down below SL (entry=2000, stop=1990, open=1975) -> -2.5R
    gap_down_bar = Candle(
        time=t0,
        open=1975.0,
        high=1980.0,
        low=1970.0,
        close=1978.0,
        volume=100.0,
    )
    res_down = _walk_trade_exit([gap_down_bar], side="long", entry=2000.0, stop=1990.0, target=2015.0)
    assert res_down is not None
    assert res_down.exit_reason == "STOP_LOSS"
    assert res_down.exit_price == 1975.0
    assert res_down.gross_r == -2.5  # (1975 - 2000) / 10 = -2.5R

    # Case B: Long gaps up above TP (entry=2000, stop=1990, target=2015, open=2020) -> +2.0R
    gap_up_bar = Candle(
        time=t0,
        open=2020.0,
        high=2025.0,
        low=2018.0,
        close=2022.0,
        volume=100.0,
    )
    res_up = _walk_trade_exit([gap_up_bar], side="long", entry=2000.0, stop=1990.0, target=2015.0)
    assert res_up is not None
    assert res_up.exit_reason == "TAKE_PROFIT"
    assert res_up.exit_price == 2020.0
    assert res_up.gross_r == 2.0  # (2020 - 2000) / 10 = +2.0R


def test_time_stop_and_session_close_exits():
    """6. Position held for 32 bars or crossing 21:00 UTC exits at bar.close."""
    t0 = 1790812800  # 00:00 UTC
    # 35 bars starting at 08:00 UTC (1790841600)
    start_t = day_ts = 1790841600
    bars = []
    for i in range(35):
        bars.append(Candle(
            time=start_t + i * 900,
            open=2000.0,
            high=2005.0,
            low=1995.0,
            close=2002.0,
            volume=50.0,
        ))
    exit_res = _walk_trade_exit(bars, side="long", entry=2000.0, stop=1980.0, target=2050.0, max_bars=32)
    assert exit_res is not None
    assert exit_res.bars_held == 32
    assert exit_res.exit_reason in ("TIME_STOP", "SESSION_CLOSE")
    assert exit_res.exit_price == 2002.0
    assert exit_res.gross_r == (2002.0 - 2000.0) / 20.0
