"""Reproducible statistical studies on a normalized OHLC series.

Nothing in this module forecasts future prices or places orders. Every number
is a description of the supplied sample, under the parameters recorded in the
result. The same candles and parameters always yield the same tables.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from app.domains.quant.candles import Candle, normalize_candles, session_name, utc_date_key, weekday_name


def _round(value: Optional[float], digits: int = 6) -> Optional[float]:
    if value is None or isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return round(float(value), digits)


def _mean(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def _stdev(values: Sequence[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    avg = sum(values) / len(values)
    var = sum((v - avg) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _pearson(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    n = min(len(xs), len(ys))
    if n < 3:
        return None
    ax = sum(xs[:n]) / n
    ay = sum(ys[:n]) / n
    num = sum((xs[i] - ax) * (ys[i] - ay) for i in range(n))
    dx = math.sqrt(sum((xs[i] - ax) ** 2 for i in range(n)))
    dy = math.sqrt(sum((ys[i] - ay) ** 2 for i in range(n)))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def _close_returns(candles: Sequence[Candle]) -> List[float]:
    out: List[float] = []
    for prev, cur in zip(candles, candles[1:]):
        if prev.close <= 0:
            continue
        out.append((cur.close - prev.close) / prev.close)
    return out


def _true_ranges(candles: Sequence[Candle]) -> List[float]:
    ranges: List[float] = []
    prev_close: Optional[float] = None
    for candle in candles:
        tr = candle.high - candle.low
        if prev_close is not None:
            tr = max(tr, abs(candle.high - prev_close), abs(candle.low - prev_close))
        ranges.append(tr)
        prev_close = candle.close
    return ranges


def _atr(candles: Sequence[Candle], period: int = 14) -> List[Optional[float]]:
    trs = _true_ranges(candles)
    out: List[Optional[float]] = [None] * len(candles)
    if period <= 0 or len(trs) < period:
        return out
    window = sum(trs[:period])
    out[period - 1] = window / period
    for i in range(period, len(trs)):
        window += trs[i] - trs[i - period]
        out[i] = window / period
    return out


def _percentile(sorted_values: Sequence[float], q: float) -> Optional[float]:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return sorted_values[lo]
    weight = pos - lo
    return sorted_values[lo] * (1 - weight) + sorted_values[hi] * weight


def _t_stat_and_p_value(values: Sequence[float]) -> Tuple[Optional[float], Optional[float]]:
    """Compute Student's t-statistic and two-tailed p-value against null hypothesis H0: mu = 0."""
    n = len(values)
    if n < 3:
        return None, None
    avg = sum(values) / n
    std = _stdev(values)
    if not std or std <= 0:
        return None, None
    se = std / math.sqrt(n)
    t = avg / se
    p = math.erfc(abs(t) / math.sqrt(2.0))
    return _round(t, 4), _round(p, 6)


def _sharpe_ratio(values: Sequence[float]) -> Optional[float]:
    """Trade-based Sharpe ratio (mean return / standard deviation)."""
    if len(values) < 2:
        return None
    avg = _mean(values)
    std = _stdev(values)
    if not std or std <= 0 or avg is None:
        return None
    return _round(avg / std, 4)


def _sortino_ratio(values: Sequence[float]) -> Optional[float]:
    """Sortino ratio using downside standard deviation below 0."""
    if len(values) < 2:
        return None
    avg = _mean(values)
    if avg is None:
        return None
    downside = [v for v in values if v < 0]
    if not downside:
        return None
    downside_dev = math.sqrt(sum(v ** 2 for v in downside) / len(values))
    if downside_dev <= 0:
        return None
    return _round(avg / downside_dev, 4)


def _calmar_ratio(sum_r: float, max_dd_r: float) -> Optional[float]:
    """Calmar ratio (Cumulative Return / Max Drawdown)."""
    if max_dd_r <= 0:
        return None
    return _round(sum_r / max_dd_r, 4)


def _monte_carlo_simulation(returns: Sequence[float], num_simulations: int = 1000, seed: int = 42) -> Dict[str, Any]:
    """1,000 bootstrap simulations of trade sequence to evaluate tail risk, drawdowns, and loss streaks."""
    import random
    if not returns or len(returns) < 5:
        return {
            "simulations": 0,
            "p50_max_dd": None,
            "p90_max_dd": None,
            "p95_max_dd": None,
            "p99_max_dd": None,
            "p95_max_losing_streak": None,
            "prob_loss_streak_5": None,
            "prob_loss_streak_7": None,
            "prob_loss_streak_10": None,
        }
    rng = random.Random(seed)
    n = len(returns)
    max_dds: List[float] = []
    max_streaks: List[int] = []
    streak_5_count = 0
    streak_7_count = 0
    streak_10_count = 0

    for _ in range(num_simulations):
        sim_sample = [rng.choice(returns) for _ in range(n)]
        eq = 0.0
        peak = 0.0
        dd = 0.0
        cur_streak = 0
        longest_streak = 0
        for r in sim_sample:
            eq += r
            if eq > peak:
                peak = eq
            if peak - eq > dd:
                dd = peak - eq
            if r < 0:
                cur_streak += 1
                if cur_streak > longest_streak:
                    longest_streak = cur_streak
            else:
                cur_streak = 0
        max_dds.append(dd)
        max_streaks.append(longest_streak)
        if longest_streak >= 5:
            streak_5_count += 1
        if longest_streak >= 7:
            streak_7_count += 1
        if longest_streak >= 10:
            streak_10_count += 1

    max_dds.sort()
    max_streaks.sort()
    return {
        "simulations": num_simulations,
        "p50_max_dd": _round(_percentile(max_dds, 0.50), 4),
        "p90_max_dd": _round(_percentile(max_dds, 0.90), 4),
        "p95_max_dd": _round(_percentile(max_dds, 0.95), 4),
        "p99_max_dd": _round(_percentile(max_dds, 0.99), 4),
        "p95_max_losing_streak": int(_percentile([float(s) for s in max_streaks], 0.95) or 0),
        "prob_loss_streak_5": _round(streak_5_count / num_simulations, 4),
        "prob_loss_streak_7": _round(streak_7_count / num_simulations, 4),
        "prob_loss_streak_10": _round(streak_10_count / num_simulations, 4),
    }


def _cost_stress_matrix(raw_returns: Sequence[float]) -> Dict[str, Any]:
    """Evaluate performance across 4 transaction friction tiers (0R, 0.025R, 0.05R, 0.10R)."""
    tiers = [
        ("0.00R (No Friction)", 0.0),
        ("0.025R (ECN Raw ~1.0 pip)", 0.025),
        ("0.050R (Standard ~2.5 pips)", 0.050),
        ("0.100R (High Stress ~5.0 pips)", 0.100),
    ]
    rows = []
    for label, cost in tiers:
        adjusted = [r - cost for r in raw_returns]
        wins = [r for r in adjusted if r > 0]
        losses = [r for r in adjusted if r < 0]
        n = len(adjusted)
        wr = (len(wins) / n) if n else 0.0
        exp = _mean(adjusted) if n else 0.0
        gross_w = sum(wins)
        gross_l = abs(sum(losses))
        pf = (gross_w / gross_l) if gross_l > 0 else (99.0 if gross_w > 0 else 0.0)
        eq = 0.0
        peak = 0.0
        mdd = 0.0
        for r in adjusted:
            eq += r
            peak = max(peak, eq)
            mdd = max(mdd, peak - eq)
        t_stat, p_val = _t_stat_and_p_value(adjusted)
        rows.append([
            label,
            _round(cost, 4),
            n,
            _round(wr * 100, 2),
            _round(exp, 4),
            _round(pf, 3),
            _round(mdd, 3),
            _round(t_stat, 2),
            _round(p_val, 4),
        ])
    return _table(
        ["cost_tier", "cost_r", "trades", "win_rate_pct", "expectancy_r", "profit_factor", "max_drawdown_r", "t_stat", "p_value"],
        rows,
    )


def _table(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> Dict[str, Any]:
    return {"columns": list(columns), "rows": [list(row) for row in rows]}


def _chart(title: str, labels: Sequence[str], values: Sequence[float], unit: str) -> Dict[str, Any]:
    return {
        "type": "bar",
        "title": title,
        "labels": list(labels),
        "values": [_round(v, 8) for v in values],
        "unit": unit,
    }


def session_profile(candles: Sequence[Candle]) -> Dict[str, Any]:
    """Range and close-to-close behaviour by UTC session."""
    grouped: Dict[str, List[Candle]] = defaultdict(list)
    # Close-to-close returns are computed on the chronological series, then
    # attributed to the destination candle's session (never across days by
    # stitching same-session bars from different calendar days).
    close_rets_by_session: Dict[str, List[float]] = defaultdict(list)
    for prev, cur in zip(candles, candles[1:]):
        if prev.close <= 0:
            continue
        close_rets_by_session[cur.session].append((cur.close - prev.close) / prev.close)
    for candle in candles:
        grouped[candle.session].append(candle)
    order = ["asia", "london", "new_york", "off_hours"]
    rows = []
    labels = []
    ranges = []
    for name in order:
        bucket = grouped.get(name) or []
        if not bucket:
            continue
        rets = close_rets_by_session.get(name) or []
        open_rets = [(c.close - c.open) / c.open for c in bucket]
        avg_range = _mean([c.range for c in bucket]) or 0.0
        rows.append([
            name,
            len(bucket),
            _round(avg_range, 4),
            _round(_mean(open_rets), 6),
            _round(_mean(rets), 6) if rets else None,
            _round(_stdev(open_rets), 6),
        ])
        labels.append(name)
        ranges.append(avg_range)
    return {
        "id": "session_profile",
        "sample_size": len(candles),
        "parameters": {"timezone": "UTC", "sessions": {"asia": "00:00-07:00", "london": "07:00-13:00", "new_york": "13:00-21:00", "off_hours": "21:00-24:00"}},
        "table": _table(
            ["session", "bars", "avg_range", "avg_open_to_close", "avg_close_to_close", "stdev_open_to_close"],
            rows,
        ),
        "chart": _chart("Average range by UTC session", labels, ranges, "price"),
        "notes_en": "Describes how far price typically travels inside each UTC session in this sample. It is not a forecast of the next session.",
        "notes_vi": "Mô tả biên độ thường gặp của từng phiên UTC trên mẫu này. Đây không phải dự báo phiên kế tiếp.",
    }


def volatility_regimes(candles: Sequence[Candle], atr_period: int = 14) -> Dict[str, Any]:
    """Split the sample into low, mid, and high ATR regimes by percentile."""
    atrs = _atr(candles, atr_period)
    usable = [(candle, atr) for candle, atr in zip(candles, atrs) if atr is not None]
    values = sorted(atr for _, atr in usable)
    p33 = _percentile(values, 0.33)
    p66 = _percentile(values, 0.66)
    buckets = {"low": [], "mid": [], "high": []}
    for candle, atr in usable:
        if p33 is None or p66 is None:
            break
        if atr <= p33:
            key = "low"
        elif atr <= p66:
            key = "mid"
        else:
            key = "high"
        buckets[key].append((candle, atr))
    rows = []
    labels = []
    heights = []
    for key in ("low", "mid", "high"):
        items = buckets[key]
        rets = [(c.close - c.open) / c.open for c, _ in items]
        avg_atr = _mean([atr for _, atr in items])
        rows.append([
            key,
            len(items),
            _round(avg_atr, 4),
            _round(_mean(rets), 6),
            _round(_stdev(rets), 6),
        ])
        labels.append(key)
        heights.append(avg_atr or 0.0)
    return {
        "id": "volatility_regimes",
        "sample_size": len(usable),
        "parameters": {
            "atr_period": atr_period,
            "low_max": _round(p33, 6),
            "mid_max": _round(p66, 6),
            "rule": "low <= p33, mid <= p66, high above p66 of ATR in this sample",
        },
        "table": _table(["regime", "bars", "avg_atr", "avg_open_to_close", "stdev_open_to_close"], rows),
        "chart": _chart(f"ATR({atr_period}) by regime", labels, heights, "price"),
        "notes_en": "Regimes are relative to this sample only. A 'high' bar here can be ordinary in another year.",
        "notes_vi": "Các vùng biến động chỉ so với chính mẫu này. Một nến 'cao' ở đây có thể là bình thường ở giai đoạn khác.",
    }


def range_breakout_stats(candles: Sequence[Candle]) -> Dict[str, Any]:
    """How often the London session breaks the Asia high or low, and whether it finishes outside."""
    by_day: Dict[str, List[Candle]] = defaultdict(list)
    for candle in candles:
        by_day[utc_date_key(candle.time)].append(candle)
    up = down = both = neither = 0
    up_hold = down_hold = 0
    for day in sorted(by_day):
        bars = by_day[day]
        asia = [c for c in bars if c.session == "asia"]
        london = [c for c in bars if c.session == "london"]
        if not asia or not london:
            continue
        asia_high = max(c.high for c in asia)
        asia_low = min(c.low for c in asia)
        broke_up = any(c.high > asia_high for c in london)
        broke_down = any(c.low < asia_low for c in london)
        if broke_up and broke_down:
            both += 1
        elif broke_up:
            up += 1
            if london[-1].close > asia_high:
                up_hold += 1
        elif broke_down:
            down += 1
            if london[-1].close < asia_low:
                down_hold += 1
        else:
            neither += 1
    days = up + down + both + neither
    def rate(n: int) -> Optional[float]:
        return _round(n / days, 4) if days else None
    rows = [
        ["up_only", up, rate(up), _round(up_hold / up, 4) if up else None],
        ["down_only", down, rate(down), _round(down_hold / down, 4) if down else None],
        ["both_sides", both, rate(both), None],
        ["inside", neither, rate(neither), None],
    ]
    return {
        "id": "range_breakout",
        "sample_size": days,
        "parameters": {
            "range_session": "asia 00:00-07:00 UTC",
            "break_session": "london 07:00-13:00 UTC",
            "hold_definition": "London close still outside the Asia range",
        },
        "table": _table(["outcome", "days", "share_of_days", "hold_rate"], rows),
        "chart": _chart("Asia-range outcomes during London", ["up_only", "down_only", "both_sides", "inside"], [up, down, both, neither], "days"),
        "notes_en": "A break of the Asia range is a description of what already happened in this sample, not a signal to trade.",
        "notes_vi": "Phá biên độ phiên Á là mô tả những gì đã xảy ra trên mẫu này, không phải tín hiệu để vào lệnh.",
    }


def mean_reversion_and_trend(candles: Sequence[Candle]) -> Dict[str, Any]:
    """Lag-1 autocorrelation and directional persistence of close-to-close returns."""
    returns = _close_returns(candles)
    if len(returns) >= 2:
        persistence_hits = sum(1 for a, b in zip(returns, returns[1:]) if (a > 0 and b > 0) or (a < 0 and b < 0) or (a == 0 and b == 0))
        pairs = len(returns) - 1
        persistence = persistence_hits / pairs
    else:
        pairs = 0
        persistence = None
    corr = _pearson(returns[:-1], returns[1:]) if len(returns) >= 4 else None
    if corr is None:
        tendency = "insufficient_sample"
    elif corr > 0.05:
        tendency = "trend_persistence"
    elif corr < -0.05:
        tendency = "mean_reversion"
    else:
        tendency = "near_zero"
    return {
        "id": "mean_reversion_trend",
        "sample_size": len(returns),
        "parameters": {"return": "close_to_close", "lag": 1, "near_zero_band": 0.05},
        "table": _table(
            ["metric", "value"],
            [
                ["lag1_autocorrelation", _round(corr, 6)],
                ["directional_persistence", _round(persistence, 6)],
                ["return_pairs", pairs],
                ["sample_label", tendency],
            ],
        ),
        "chart": _chart(
            "Persistence versus a coin-flip baseline",
            ["persistence", "baseline_0.5"],
            [persistence or 0.0, 0.5],
            "share",
        ),
        "tendency": tendency,
        "notes_en": (
            "Lag-1 Pearson autocorrelation measures how successive return values vary together; "
            "it is not the same as same-sign frequency. Use directional_persistence for how often "
            "adjacent returns share a sign. Either figure can disappear out of sample."
        ),
        "notes_vi": (
            "Tự tương quan Pearson trễ-1 đo mức hai suất sinh lời liên tiếp biến thiên cùng nhau; "
            "không phải tần suất cùng dấu. Dùng directional_persistence cho tần suất cùng dấu. "
            "Cả hai đều có thể biến mất ngoài mẫu."
        ),
    }


def seasonality(candles: Sequence[Candle]) -> Dict[str, Any]:
    """Average open-to-close return by UTC hour and by weekday."""
    by_hour: Dict[int, List[float]] = defaultdict(list)
    by_day: Dict[str, List[float]] = defaultdict(list)
    for candle in candles:
        ret = (candle.close - candle.open) / candle.open
        stamp = datetime.fromtimestamp(candle.time, tz=timezone.utc)
        by_hour[stamp.hour].append(ret)
        by_day[weekday_name(candle.time)].append(ret)
    hour_rows = []
    hour_labels = []
    hour_values = []
    for hour in range(24):
        vals = by_hour.get(hour) or []
        if not vals:
            continue
        avg = _mean(vals) or 0.0
        hour_rows.append([f"{hour:02d}:00", len(vals), _round(avg, 6)])
        hour_labels.append(f"{hour:02d}")
        hour_values.append(avg)
    day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_rows = []
    for name in day_order:
        vals = by_day.get(name) or []
        if vals:
            day_rows.append([name, len(vals), _round(_mean(vals), 6)])
    return {
        "id": "seasonality",
        "sample_size": len(candles),
        "parameters": {"clock": "UTC", "return": "open_to_close"},
        "table": _table(["hour_utc", "bars", "avg_open_to_close"], hour_rows),
        "weekday_table": _table(["weekday", "bars", "avg_open_to_close"], day_rows),
        "chart": _chart("Average open-to-close return by UTC hour", hour_labels, hour_values, "return"),
        "notes_en": "Hour-of-day averages are sensitive to the chosen window. A busy hour in one quarter can be quiet in the next.",
        "notes_vi": "Trung bình theo giờ phụ thuộc cửa sổ dữ liệu. Một giờ sôi động ở quý này có thể yên ắng ở quý sau.",
    }


def _walk_exit(bars: Sequence[Candle], side: str, entry: float, stop: float, target: float) -> Optional[float]:
    risk = (entry - stop) if side == "long" else (stop - entry)
    if risk <= 0:
        return None
    for bar in bars:
        if side == "long":
            hit_stop = bar.low <= stop
            hit_target = bar.high >= target
            if hit_stop and hit_target:
                return -1.0
            if hit_stop:
                return -1.0
            if hit_target:
                return 1.0
        else:
            hit_stop = bar.high >= stop
            hit_target = bar.low <= target
            if hit_stop and hit_target:
                return -1.0
            if hit_stop:
                return -1.0
            if hit_target:
                return 1.0
    if not bars:
        return None
    last = bars[-1].close
    raw = (last - entry) / risk if side == "long" else (entry - last) / risk
    return raw


def _compile_rule_study_result(
    *,
    study_id: str,
    trades: List[Dict[str, Any]],
    round_trip_cost_r: float,
    parameters: Dict[str, Any],
    notes_en: str,
    notes_vi: str,
) -> Dict[str, Any]:
    rs = [float(t["r_multiple"]) for t in trades]
    raw_rs = [float(t.get("raw_r", t["r_multiple"])) for t in trades]
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r < 0]
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    equity_series = []
    drawdown_series = []
    for idx, r in enumerate(rs):
        equity += r
        peak = max(peak, equity)
        dd = peak - equity
        max_dd = max(max_dd, dd)
        equity_series.append({
            "trade": idx + 1,
            "day": trades[idx]["day"],
            "equity_r": _round(equity, 4),
            "peak_r": _round(peak, 4),
            "drawdown_r": _round(dd, 4),
        })
        drawdown_series.append({
            "trade": idx + 1,
            "day": trades[idx]["day"],
            "drawdown_r": _round(-dd, 4),
        })
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = None if gross_loss == 0 else gross_win / gross_loss

    t_stat, p_val = _t_stat_and_p_value(rs)
    sharpe = _sharpe_ratio(rs)
    sortino = _sortino_ratio(rs)
    calmar = _calmar_ratio(sum(rs), max_dd)
    mc_risk = _monte_carlo_simulation(rs, num_simulations=1000)
    cost_matrix = _cost_stress_matrix(raw_rs)

    return {
        "id": study_id,
        "sample_size": len(trades),
        "parameters": parameters,
        "table": _table(
            ["metric", "value"],
            [
                ["trades", len(trades)],
                ["win_rate", _round(len(wins) / len(rs), 4) if rs else None],
                ["expectancy_r", _round(_mean(rs), 4) if rs else None],
                ["profit_factor", _round(profit_factor, 4) if profit_factor is not None else None],
                ["max_drawdown_r", _round(max_dd, 4)],
                ["sum_r", _round(sum(rs), 4) if rs else 0.0],
                ["sharpe_ratio", sharpe],
                ["sortino_ratio", sortino],
                ["calmar_ratio", calmar],
                ["t_statistic", t_stat],
                ["p_value", p_val],
            ],
        ),
        "trades": trades,
        "equity_series": equity_series,
        "drawdown_series": drawdown_series,
        "cost_stress_matrix": cost_matrix,
        "monte_carlo_risk": mc_risk,
        "chart": _chart(
            "Cumulative Equity Curve (R)",
            [pt["day"] for pt in equity_series] or ["none"],
            [float(pt["equity_r"]) for pt in equity_series] or [0.0],
            "R",
        ),
        "notes_en": notes_en,
        "notes_vi": notes_vi,
    }


def rule_backtest(candles: Sequence[Candle], round_trip_cost_r: float = 0.0) -> Dict[str, Any]:
    """Historical R-multiples of one published rule: London break of the Asia range."""
    by_day: Dict[str, List[Candle]] = defaultdict(list)
    for candle in candles:
        by_day[utc_date_key(candle.time)].append(candle)
    trades: List[Dict[str, Any]] = []
    skipped_ambiguous = 0
    skipped_incomplete = 0
    for day in sorted(by_day):
        bars = by_day[day]
        asia = [c for c in bars if c.session == "asia"]
        later = [c for c in bars if session_name(c.time) in ("london", "new_york")]
        if not asia or not later:
            skipped_incomplete += 1
            continue
        asia_high = max(c.high for c in asia)
        asia_low = min(c.low for c in asia)
        if asia_high <= asia_low:
            skipped_incomplete += 1
            continue
        chosen = None
        for index, bar in enumerate(later):
            up = bar.high > asia_high
            down = bar.low < asia_low
            open_up = bar.open > asia_high
            open_down = bar.open < asia_low
            if up and down:
                if open_up and not open_down:
                    side = "long"
                elif open_down and not open_up:
                    side = "short"
                else:
                    skipped_ambiguous += 1
                    chosen = "ambiguous"
                    break
            elif up or down:
                side = "long" if up else "short"
            else:
                continue
            pure_gap = (
                (side == "long" and bar.open > asia_high and bar.low > asia_high)
                or (side == "short" and bar.open < asia_low and bar.high < asia_low)
            )
            if side == "long":
                entry = bar.open if pure_gap else asia_high
                stop = asia_low
            else:
                entry = bar.open if pure_gap else asia_low
                stop = asia_high
            risk = abs(entry - stop)
            if risk <= 0:
                skipped_incomplete += 1
                chosen = "invalid_risk"
                break
            target = entry + risk if side == "long" else entry - risk
            retracing_fill = (
                (side == "long" and bar.open > asia_high and not pure_gap)
                or (side == "short" and bar.open < asia_low and not pure_gap)
            )
            if retracing_fill:
                stopped_on_fill = (
                    (side == "long" and bar.low <= stop)
                    or (side == "short" and bar.high >= stop)
                )
                result = -1.0 if stopped_on_fill else _walk_exit(later[index + 1 :], side, entry, stop, target)
            else:
                result = _walk_exit(later[index:], side, entry, stop, target)
            if result is None:
                skipped_incomplete += 1
            else:
                net = result - float(round_trip_cost_r)
                trades.append({
                    "day": day,
                    "side": side,
                    "entry": _round(entry, 6),
                    "stop": _round(stop, 6),
                    "target": _round(target, 6),
                    "raw_r": _round(result, 6),
                    "r_multiple": _round(net, 6),
                })
            chosen = side
            break
        if chosen is None:
            skipped_incomplete += 1

    return _compile_rule_study_result(
        study_id="rule_backtest_asia_break",
        trades=trades,
        round_trip_cost_r=round_trip_cost_r,
        parameters={
            "strategy": "Breakout & Retest of Asia Range in London",
            "rule": "first London/New York break of same-day Asia high or low",
            "stop": "opposite side of Asia range",
            "target_r": 1.0,
            "round_trip_cost_r": float(round_trip_cost_r),
            "skipped_ambiguous_days": skipped_ambiguous,
            "skipped_incomplete_days": skipped_incomplete,
        },
        notes_en="Expectancy, statistical significance, and tail risk describe this historical sample path. They are not a promise of future profit. The empirical edge varies across session times and market regimes.",
        notes_vi="Kỳ vọng, ý nghĩa thống kê (t-stat/p-value) và rủi ro đuôi mô tả mẫu dữ liệu lịch sử này. Chúng không phải cam kết lợi nhuận tương lai. Lợi thế định lượng thay đổi theo khung giờ phiên và cơ chế biến động.",
    )


def rule_backtest_asian_mean_reversion(candles: Sequence[Candle], round_trip_cost_r: float = 0.0) -> Dict[str, Any]:
    """Historical R-multiples of Asian Session Mean-Reversion strategy.

    Fades extreme price deviations outside 1.8 ATR during the lower-volatility Asian session (00:00-06:00 UTC),
    targeting reversion to the session mean.
    """
    by_day: Dict[str, List[Candle]] = defaultdict(list)
    for candle in candles:
        by_day[utc_date_key(candle.time)].append(candle)

    atrs = _atr(candles, period=14)
    candle_atr_map = {c.time: atrs[idx] for idx, c in enumerate(candles) if atrs[idx] is not None}

    trades: List[Dict[str, Any]] = []
    skipped_incomplete = 0

    for day in sorted(by_day):
        bars = by_day[day]
        asia = [c for c in bars if c.session == "asia"]
        if len(asia) < 6:
            skipped_incomplete += 1
            continue

        session_open = asia[0].open
        traded = False

        for idx, bar in enumerate(asia[3:], start=3):
            bar_atr = candle_atr_map.get(bar.time)
            if not bar_atr or bar_atr <= 0:
                continue

            running_mean = sum(c.close for c in asia[:idx]) / idx
            dev_up = bar.high - running_mean
            dev_down = running_mean - bar.low

            # Short condition: Upper extreme fade with bearish reaction
            if dev_up >= 1.8 * bar_atr and bar.close < bar.open:
                entry = bar.close
                stop = bar.high + 0.3 * bar_atr
                risk = stop - entry
                if risk <= 0:
                    continue
                target = entry - 1.5 * risk
                result = _walk_exit(asia[idx + 1:], "short", entry, stop, target)
                if result is not None:
                    net = result - float(round_trip_cost_r)
                    trades.append({
                        "day": day,
                        "side": "short",
                        "entry": _round(entry, 6),
                        "stop": _round(stop, 6),
                        "target": _round(target, 6),
                        "raw_r": _round(result, 6),
                        "r_multiple": _round(net, 6),
                    })
                    traded = True
                    break

            # Long condition: Lower extreme fade with bullish reaction
            elif dev_down >= 1.8 * bar_atr and bar.close > bar.open:
                entry = bar.close
                stop = bar.low - 0.3 * bar_atr
                risk = entry - stop
                if risk <= 0:
                    continue
                target = entry + 1.5 * risk
                result = _walk_exit(asia[idx + 1:], "long", entry, stop, target)
                if result is not None:
                    net = result - float(round_trip_cost_r)
                    trades.append({
                        "day": day,
                        "side": "long",
                        "entry": _round(entry, 6),
                        "stop": _round(stop, 6),
                        "target": _round(target, 6),
                        "raw_r": _round(result, 6),
                        "r_multiple": _round(net, 6),
                    })
                    traded = True
                    break

        if not traded:
            skipped_incomplete += 1

    return _compile_rule_study_result(
        study_id="rule_backtest_asian_mean_reversion",
        trades=trades,
        round_trip_cost_r=round_trip_cost_r,
        parameters={
            "strategy": "Asian Session Mean-Reversion",
            "rule": "Fade extreme deviations > 1.8 ATR from Asian running mean (00:00-06:00 UTC)",
            "stop": "Extreme wick + 0.3 ATR buffer",
            "target_r": 1.5,
            "round_trip_cost_r": float(round_trip_cost_r),
            "skipped_incomplete_days": skipped_incomplete,
        },
        notes_en="Asian mean-reversion exploits compressed volatility before European session open. Performance degrades on major Asian macroeconomic news days.",
        notes_vi="Chiến lược đảo chiều trung tính phiên Á khai thác giai đoạn nén biên độ trước giờ mở cửa châu Âu. Hiệu suất suy giảm khi có tin tức kinh tế vĩ mô đột biến.",
    )


def rule_backtest_london_liquidity_sweep(candles: Sequence[Candle], round_trip_cost_r: float = 0.0) -> Dict[str, Any]:
    """Historical R-multiples of London Liquidity Sweep strategy.

    Detects false breakouts (sweeps/purges) of the Asian high or low during the London open
    (07:00-09:30 UTC) with strong wick rejections back inside the range.
    """
    by_day: Dict[str, List[Candle]] = defaultdict(list)
    for candle in candles:
        by_day[utc_date_key(candle.time)].append(candle)

    trades: List[Dict[str, Any]] = []
    skipped_incomplete = 0

    for day in sorted(by_day):
        bars = by_day[day]
        asia = [c for c in bars if c.session == "asia"]
        london = [c for c in bars if session_name(c.time) in ("london", "new_york")]
        if not asia or not london:
            skipped_incomplete += 1
            continue

        asia_high = max(c.high for c in asia)
        asia_low = min(c.low for c in asia)
        if asia_high <= asia_low:
            skipped_incomplete += 1
            continue

        traded = False
        # Restrict entry search to the first 10 bars of London (approx 07:00 - 09:30 UTC)
        search_window = london[:10]

        for idx, bar in enumerate(search_window):
            bar_range = bar.high - bar.low
            if bar_range <= 0:
                continue

            # Bear trap (Long sweep): Purges asia_low but closes back above asia_low with lower wick >= 35%
            lower_wick = min(bar.open, bar.close) - bar.low
            if bar.low < asia_low and bar.close >= asia_low and (lower_wick / bar_range) >= 0.35:
                entry = bar.close
                stop = bar.low
                risk = entry - stop
                if risk <= 0:
                    continue
                target = entry + 1.8 * risk
                result = _walk_exit(london[idx + 1:], "long", entry, stop, target)
                if result is not None:
                    net = result - float(round_trip_cost_r)
                    trades.append({
                        "day": day,
                        "side": "long",
                        "entry": _round(entry, 6),
                        "stop": _round(stop, 6),
                        "target": _round(target, 6),
                        "raw_r": _round(result, 6),
                        "r_multiple": _round(net, 6),
                    })
                    traded = True
                    break

            # Bull trap (Short sweep): Purges asia_high but closes back below asia_high with upper wick >= 35%
            upper_wick = bar.high - max(bar.open, bar.close)
            if bar.high > asia_high and bar.close <= asia_high and (upper_wick / bar_range) >= 0.35:
                entry = bar.close
                stop = bar.high
                risk = stop - entry
                if risk <= 0:
                    continue
                target = entry - 1.8 * risk
                result = _walk_exit(london[idx + 1:], "short", entry, stop, target)
                if result is not None:
                    net = result - float(round_trip_cost_r)
                    trades.append({
                        "day": day,
                        "side": "short",
                        "entry": _round(entry, 6),
                        "stop": _round(stop, 6),
                        "target": _round(target, 6),
                        "raw_r": _round(result, 6),
                        "r_multiple": _round(net, 6),
                    })
                    traded = True
                    break

        if not traded:
            skipped_incomplete += 1

    return _compile_rule_study_result(
        study_id="rule_backtest_london_liquidity_sweep",
        trades=trades,
        round_trip_cost_r=round_trip_cost_r,
        parameters={
            "strategy": "London Liquidity Sweep (Asian Range Purge & Reversal)",
            "rule": "False breakout of Asian High/Low during 07:00-09:30 UTC with rejection wick >= 35%",
            "stop": "Extreme sweep wick",
            "target_r": 1.8,
            "round_trip_cost_r": float(round_trip_cost_r),
            "skipped_incomplete_days": skipped_incomplete,
        },
        notes_en="Liquidity sweep captures institutional stop-running at London open. Most effective on liquid instruments like XAUUSD, EURUSD, GBPUSD.",
        notes_vi="Mô hình quét thanh khoản nắm bắt hành vi săn lệnh dừng lỗ của tổ chức tại giờ mở cửa London. Đặc biệt hiệu quả trên các cặp tài sản có tính thanh khoản cao.",
    )


def run_studies(
    rows: Iterable[Any],
    *,
    symbol: str = "XAUUSD",
    timeframe: str = "M15",
    strategy_name: str = "breakout_retest",
    round_trip_cost_r: float = 0.0,
    atr_period: int = 14,
) -> Dict[str, Any]:
    """Run the full study set. Output depends only on the candles and parameters."""
    candles = normalize_candles(list(rows))
    strat = (strategy_name or "breakout_retest").strip().lower()

    if strat in ("asian_mean_reversion", "mean_reversion"):
        rule_eval = rule_backtest_asian_mean_reversion(candles, round_trip_cost_r=round_trip_cost_r)
    elif strat in ("london_sweep", "sweep", "liquidity_sweep"):
        rule_eval = rule_backtest_london_liquidity_sweep(candles, round_trip_cost_r=round_trip_cost_r)
    elif strat in ("all", "multi"):
        # Include all 3 backtests
        r1 = rule_backtest(candles, round_trip_cost_r=round_trip_cost_r)
        r2 = rule_backtest_asian_mean_reversion(candles, round_trip_cost_r=round_trip_cost_r)
        r3 = rule_backtest_london_liquidity_sweep(candles, round_trip_cost_r=round_trip_cost_r)
        studies = [
            session_profile(candles),
            volatility_regimes(candles, atr_period=atr_period),
            range_breakout_stats(candles),
            mean_reversion_and_trend(candles),
            seasonality(candles),
            r1,
            r2,
            r3,
        ]
        return {
            "symbol": str(symbol or "XAUUSD").upper().replace("/", ""),
            "timeframe": str(timeframe or "M15").upper(),
            "strategy": strat,
            "candle_count": len(candles),
            "range_start": candles[0].time,
            "range_end": candles[-1].time,
            "parameters": {
                "strategy": strat,
                "round_trip_cost_r": float(round_trip_cost_r),
                "atr_period": int(atr_period),
                "timezone": "UTC",
            },
            "studies": studies,
        }
    else:
        rule_eval = rule_backtest(candles, round_trip_cost_r=round_trip_cost_r)

    studies = [
        session_profile(candles),
        volatility_regimes(candles, atr_period=atr_period),
        range_breakout_stats(candles),
        mean_reversion_and_trend(candles),
        seasonality(candles),
        rule_eval,
    ]
    return {
        "symbol": str(symbol or "XAUUSD").upper().replace("/", ""),
        "timeframe": str(timeframe or "M15").upper(),
        "candle_count": len(candles),
        "range_start": candles[0].time,
        "range_end": candles[-1].time,
        "parameters": {
            "round_trip_cost_r": float(round_trip_cost_r),
            "atr_period": int(atr_period),
            "timezone": "UTC",
        },
        "studies": studies,
    }
