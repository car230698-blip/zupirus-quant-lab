"""ZUPIRUS Quant Lab - Empirical Quantitative Research Engine.
Topic: Breakout & Retest on XAU/USD (Gold Futures GC=F) M15:
Expectancy After Transaction Costs & Cross-Session Heterogeneity.

Formal Specification & Rules:
1. Swing Levels: 20-bar rolling Swing High & Swing Low (excluding active bar).
2. Breakout: Candle Close strictly exceeds Swing High (Bullish) or Swing Low (Bearish)
   with Range Expansion: (High - Low) >= 1.0 * ATR(14).
3. Retest: Within max 6 bars (90 mins), price revisits breakout level within +/- 0.5 * ATR(14)
   with Wick Rejection Ratio >= 0.30 in direction of breakout.
4. Entry: Immediate market order at Close of confirmed Retest bar (zero lookahead).
5. SL / TP:
   - SL: Beyond retest bar extreme + 0.5 * ATR(14) buffer (minimum 15 pips).
   - TP: 2.0 * Risk (R:R = 2.0).
6. Time Stop: Closed at bar 32 (8 hours) if neither SL nor TP triggered.
7. Same-Bar Collision: Conservative worst-case assumption — if High >= TP and Low <= SL in the same bar,
   SL is strictly assumed to trigger first (100% Loss).
8. Sessions (UTC):
   - Asian: 00:00 - 08:00 UTC
   - London: 08:00 - 13:00 UTC
   - London / NY Overlap: 13:00 - 17:00 UTC
   - Late NY: 17:00 - 22:00 UTC
   - CME Maintenance Halt / Rollover: 22:00 - 00:00 UTC (no new entries)
9. Cost Model:
   - Baseline Cost: 3.5 pips ($0.35/oz) round-trip spread & slippage.
   - High Stress Cost: 5.0 pips ($0.50/oz) round-trip spread & slippage.
"""
import math
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple


def get_utc_session(epoch_ts: float) -> str:
    """Categorize UTC timestamp into standard forex / metals liquidity sessions."""
    dt = datetime.fromtimestamp(epoch_ts, tz=timezone.utc)
    hour = dt.hour + dt.minute / 60.0
    if 0.0 <= hour < 8.0:
        return "Asian"
    elif 8.0 <= hour < 13.0:
        return "London"
    elif 13.0 <= hour < 17.0:
        return "London_NY_Overlap"
    elif 17.0 <= hour < 22.0:
        return "Late_NY"
    else:
        return "CME_Rollover_Halt"


def calculate_atr(candles: List[Dict[str, Any]], period: int = 14) -> List[float]:
    """Calculate causal Average True Range (ATR) with zero future lookahead."""
    n = len(candles)
    if n == 0:
        return []
    tr_list = [float(candles[0]["high"]) - float(candles[0]["low"])]
    for i in range(1, n):
        h = float(candles[i]["high"])
        l = float(candles[i]["low"])
        prev_c = float(candles[i - 1]["close"])
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        tr_list.append(tr)

    atr = []
    current_atr = sum(tr_list[:period]) / period if len(tr_list) >= period else (tr_list[0] if tr_list else 1.0)
    for i in range(n):
        if i < period:
            atr.append(current_atr)
        else:
            current_atr = (current_atr * (period - 1) + tr_list[i]) / period
            atr.append(current_atr)
    return atr


def detect_breakout_retest_signals(
    candles: List[Dict[str, Any]],
    swing_period: int = 20,
    max_retest_wait: int = 6,
    min_wick_ratio: float = 0.30,
    min_atr_expansion: float = 1.0,
) -> List[Dict[str, Any]]:
    """Detect all causal Breakout & Retest trade signals on chronological M15 candles."""
    n = len(candles)
    if n < swing_period + 10:
        return []

    atrs = calculate_atr(candles, period=14)
    signals = []

    # State tracking for pending breakout awaiting retest
    pending_breakout: Optional[Dict[str, Any]] = None

    for i in range(swing_period, n):
        bar = candles[i]
        c = float(bar["close"])
        o = float(bar["open"])
        h = float(bar["high"])
        l = float(bar["low"])
        t = float(bar["time"])
        atr = atrs[i] if i < len(atrs) else 2.0
        session = get_utc_session(t)

        # 1. Check if an existing pending breakout has expired or invalidated
        if pending_breakout is not None:
            bars_since = i - pending_breakout["breakout_bar_idx"]
            breakout_level = pending_breakout["level"]
            side = pending_breakout["side"]

            if bars_since > max_retest_wait:
                # Retest window timed out
                pending_breakout = None
            else:
                tolerance = 0.5 * atr
                # Retest Condition
                if side == "BUY":
                    # For bullish: price dips back near breakout resistance level
                    retested = (l <= breakout_level + tolerance) and (h >= breakout_level - tolerance)
                    # Invalidation: candle closes deeply below breakout level
                    invalidated = c < breakout_level - tolerance

                    if invalidated:
                        pending_breakout = None
                    elif retested:
                        # Check rejection wick (lower wick indicates buying support)
                        total_range = h - l
                        lower_wick = min(o, c) - l
                        wick_ratio = (lower_wick / total_range) if total_range > 0 else 0.0

                        if wick_ratio >= min_wick_ratio and session != "CME_Rollover_Halt":
                            signals.append({
                                "signal_bar_idx": i,
                                "time": t,
                                "datetime": bar.get("datetime", ""),
                                "side": "BUY",
                                "entry_price": c,
                                "retest_low": l,
                                "retest_high": h,
                                "breakout_level": breakout_level,
                                "atr": atr,
                                "session": session,
                                "wick_ratio": round(wick_ratio, 3),
                                "bars_to_retest": bars_since,
                            })
                            pending_breakout = None
                else:  # SELL
                    # For bearish: price bounces back near breakdown support level
                    retested = (h >= breakout_level - tolerance) and (l <= breakout_level + tolerance)
                    invalidated = c > breakout_level + tolerance

                    if invalidated:
                        pending_breakout = None
                    elif retested:
                        # Check rejection wick (upper wick indicates selling resistance)
                        total_range = h - l
                        upper_wick = h - max(o, c)
                        wick_ratio = (upper_wick / total_range) if total_range > 0 else 0.0

                        if wick_ratio >= min_wick_ratio and session != "CME_Rollover_Halt":
                            signals.append({
                                "signal_bar_idx": i,
                                "time": t,
                                "datetime": bar.get("datetime", ""),
                                "side": "SELL",
                                "entry_price": c,
                                "retest_low": l,
                                "retest_high": h,
                                "breakout_level": breakout_level,
                                "atr": atr,
                                "session": session,
                                "wick_ratio": round(wick_ratio, 3),
                                "bars_to_retest": bars_since,
                            })
                            pending_breakout = None

        # 2. Look for new Breakout if no pending breakout is active
        if pending_breakout is None and session != "CME_Rollover_Halt":
            # 20-bar prior swing high and low (strictly excluding current bar)
            prior_highs = [float(candles[k]["high"]) for k in range(i - swing_period, i)]
            prior_lows = [float(candles[k]["low"]) for k in range(i - swing_period, i)]
            swing_high = max(prior_highs)
            swing_low = min(prior_lows)
            candle_range = h - l

            # Bullish Breakout
            if c > swing_high and candle_range >= min_atr_expansion * atr:
                pending_breakout = {
                    "breakout_bar_idx": i,
                    "level": swing_high,
                    "side": "BUY",
                    "breakout_atr": atr,
                }
            # Bearish Breakdown
            elif c < swing_low and candle_range >= min_atr_expansion * atr:
                pending_breakout = {
                    "breakout_bar_idx": i,
                    "level": swing_low,
                    "side": "SELL",
                    "breakout_atr": atr,
                }

    return signals


def simulate_trade_outcomes(
    candles: List[Dict[str, Any]],
    signals: List[Dict[str, Any]],
    cost_pips: float = 3.5,
    rr_ratio: float = 2.0,
    time_stop_bars: int = 32,
    conservative_collision: bool = True,
) -> List[Dict[str, Any]]:
    """Simulate trade executions chronologically with realistic friction and conservative collision."""
    # Pip value: For Gold ($/oz), 1 pip = $0.10. Therefore, 3.5 pips = $0.35, 5.0 pips = $0.50.
    cost_dollar = cost_pips * 0.10
    trades: List[Dict[str, Any]] = []
    n = len(candles)

    # Prevent concurrent position overlap (single-position execution model)
    last_exit_bar = -1

    for sig in signals:
        entry_bar = sig["signal_bar_idx"]
        if entry_bar <= last_exit_bar:
            continue  # Busy with previous active trade

        side = sig["side"]
        entry_price = float(sig["entry_price"])
        atr = float(sig["atr"])

        # Define Stop Loss and Take Profit
        min_sl_dist = 1.50  # Minimum 15 pips = $1.50/oz on gold
        if side == "BUY":
            sl_dist = max(entry_price - (sig["retest_low"] - 0.5 * atr), min_sl_dist)
            sl_price = round(entry_price - sl_dist, 2)
            tp_price = round(entry_price + rr_ratio * sl_dist, 2)
        else:
            sl_dist = max((sig["retest_high"] + 0.5 * atr) - entry_price, min_sl_dist)
            sl_price = round(entry_price + sl_dist, 2)
            tp_price = round(entry_price - rr_ratio * sl_dist, 2)

        exit_bar = entry_bar
        exit_price = entry_price
        exit_reason = "TIME_STOP"
        r_multiple = 0.0
        collision_occurred = False

        # Step through subsequent bars
        for k in range(entry_bar + 1, min(entry_bar + 1 + time_stop_bars, n)):
            bar_k = candles[k]
            k_h = float(bar_k["high"])
            k_l = float(bar_k["low"])
            k_c = float(bar_k["close"])

            if side == "BUY":
                hit_tp = k_h >= tp_price
                hit_sl = k_l <= sl_price

                if hit_tp and hit_sl:
                    collision_occurred = True
                    if conservative_collision:
                        # Conservative worst-case: Assume SL triggered first
                        exit_price = sl_price
                        exit_reason = "SL_COLLISION"
                        exit_bar = k
                        break
                    else:
                        exit_price = tp_price
                        exit_reason = "TP_COLLISION"
                        exit_bar = k
                        break
                elif hit_sl:
                    exit_price = sl_price
                    exit_reason = "SL"
                    exit_bar = k
                    break
                elif hit_tp:
                    exit_price = tp_price
                    exit_reason = "TP"
                    exit_bar = k
                    break
            else:  # SELL
                hit_tp = k_l <= tp_price
                hit_sl = k_h >= sl_price

                if hit_tp and hit_sl:
                    collision_occurred = True
                    if conservative_collision:
                        exit_price = sl_price
                        exit_reason = "SL_COLLISION"
                        exit_bar = k
                        break
                    else:
                        exit_price = tp_price
                        exit_reason = "TP_COLLISION"
                        exit_bar = k
                        break
                elif hit_sl:
                    exit_price = sl_price
                    exit_reason = "SL"
                    exit_bar = k
                    break
                elif hit_tp:
                    exit_price = tp_price
                    exit_reason = "TP"
                    exit_bar = k
                    break

            # If reached maximum time stop window
            if k == entry_bar + time_stop_bars:
                exit_price = k_c
                exit_reason = "TIME_STOP"
                exit_bar = k
                break

        last_exit_bar = exit_bar

        # PnL Calculation
        raw_diff = (exit_price - entry_price) if side == "BUY" else (entry_price - exit_price)
        net_dollar = raw_diff - cost_dollar
        r_net = net_dollar / sl_dist if sl_dist > 0 else 0.0

        exit_time = candles[exit_bar].get("time", sig["time"])
        exit_dt = candles[exit_bar].get("datetime", "")

        trades.append({
            "trade_id": len(trades) + 1,
            "entry_time": sig["time"],
            "entry_datetime": sig["datetime"],
            "exit_time": exit_time,
            "exit_datetime": exit_dt,
            "session": sig["session"],
            "side": side,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "sl_price": sl_price,
            "tp_price": tp_price,
            "sl_distance": round(sl_dist, 2),
            "exit_reason": exit_reason,
            "collision_occurred": collision_occurred,
            "cost_pips": cost_pips,
            "cost_dollar": cost_dollar,
            "net_dollar": round(net_dollar, 2),
            "r_multiple": round(r_net, 3),
            "is_win": net_dollar > 0,
            "bars_held": exit_bar - entry_bar,
        })

    return trades


def compute_performance_metrics(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate key quantitative performance metrics (Win Rate, Expectancy, Profit Factor, Max DD)."""
    if not trades:
        return {
            "trade_count": 0,
            "win_count": 0,
            "loss_count": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "expectancy_r": 0.0,
            "net_r": 0.0,
            "net_dollar_total": 0.0,
            "max_drawdown_r": 0.0,
            "max_drawdown_pct": 0.0,
            "avg_win_r": 0.0,
            "avg_loss_r": 0.0,
        }

    wins = [t for t in trades if t["r_multiple"] > 0]
    losses = [t for t in trades if t["r_multiple"] <= 0]

    gross_profit = sum(t["r_multiple"] for t in wins)
    gross_loss = abs(sum(t["r_multiple"] for t in losses))

    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    net_r = sum(t["r_multiple"] for t in trades)
    net_dollar = sum(t["net_dollar"] for t in trades)
    expectancy_r = net_r / len(trades) if trades else 0.0

    # Drawdown computation (in R units and equity peak-to-trough)
    equity_r = 0.0
    peak_r = 0.0
    max_dd_r = 0.0

    eq_curve = [10000.0]
    peak_eq = 10000.0
    max_dd_pct = 0.0

    # Assume fixed 1% risk ($100 per R on $10,000 base)
    for t in trades:
        r = t["r_multiple"]
        equity_r += r
        if equity_r > peak_r:
            peak_r = equity_r
        dd_r = peak_r - equity_r
        if dd_r > max_dd_r:
            max_dd_r = dd_r

        # Dollar balance
        current_eq = eq_curve[-1] + (r * 100.0)
        eq_curve.append(current_eq)
        if current_eq > peak_eq:
            peak_eq = current_eq
        dd_pct = ((peak_eq - current_eq) / peak_eq) * 100.0 if peak_eq > 0 else 0.0
        if dd_pct > max_dd_pct:
            max_dd_pct = dd_pct

    return {
        "trade_count": len(trades),
        "win_count": len(wins),
        "loss_count": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100.0, 1),
        "profit_factor": round(profit_factor, 2),
        "expectancy_r": round(expectancy_r, 3),
        "net_r": round(net_r, 2),
        "net_dollar_total": round(net_dollar, 2),
        "max_drawdown_r": round(max_dd_r, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "avg_win_r": round(sum(t["r_multiple"] for t in wins) / len(wins), 2) if wins else 0.0,
        "avg_loss_r": round(abs(sum(t["r_multiple"] for t in losses)) / len(losses), 2) if losses else 0.0,
    }


def run_session_breakdown(trades: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Group trade outcomes by major trading session and compute metrics."""
    sessions = ["Asian", "London", "London_NY_Overlap", "Late_NY"]
    breakdown = {}
    for s in sessions:
        s_trades = [t for t in trades if t["session"] == s]
        breakdown[s] = compute_performance_metrics(s_trades)
    return breakdown


def compute_hourly_breakdown(trades_3_5: List[Dict[str, Any]], trades_5_0: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group trade outcomes into 24 UTC hourly buckets, recording trades, expectancy and Profit Factor across 3.5 and 5.0 pips.
    If an hour has 0 trades, explicitly mark metrics as unverified."""
    rows = []
    for h in range(24):
        t35 = [t for t in trades_3_5 if datetime.fromtimestamp(t["entry_time"], tz=timezone.utc).hour == h]
        t50 = [t for t in trades_5_0 if datetime.fromtimestamp(t["entry_time"], tz=timezone.utc).hour == h]
        count = len(t35)
        if count > 0:
            m35 = compute_performance_metrics(t35)
            m50 = compute_performance_metrics(t50)
            rows.append({
                "hour": h,
                "hour_label": f"{h:02d}:00 - {h:02d}:59 UTC",
                "trade_count": count,
                "pf_3_5": m35["profit_factor"],
                "expectancy_r_3_5": m35["expectancy_r"],
                "win_rate_3_5": m35["win_rate"],
                "net_r_3_5": m35["net_r"],
                "pf_5_0": m50["profit_factor"],
                "expectancy_r_5_0": m50["expectancy_r"],
                "win_rate_5_0": m50["win_rate"],
                "net_r_5_0": m50["net_r"],
                "is_verified": True,
                "status_note": f"{count} lenh da xac minh",
            })
        else:
            rows.append({
                "hour": h,
                "hour_label": f"{h:02d}:00 - {h:02d}:59 UTC",
                "trade_count": 0,
                "pf_3_5": None,
                "expectancy_r_3_5": None,
                "win_rate_3_5": None,
                "net_r_3_5": None,
                "pf_5_0": None,
                "expectancy_r_5_0": None,
                "win_rate_5_0": None,
                "net_r_5_0": None,
                "is_verified": False,
                "status_note": "Chua xac minh duoc (0 lenh)",
            })
    return rows


def run_full_walk_forward_study(
    candles: List[Dict[str, Any]],
    train_bars: int = 1500,
    test_bars: int = 750,
    step_bars: int = 750,
) -> Dict[str, Any]:
    """Rolling Walk-Forward Optimization across the candle dataset:
    Splits candles into sequential train (In-Sample) and test (Out-of-Sample) folds.
    Evaluates both 3.5 pips baseline and 5.0 pips stress cost.
    """
    total_bars = len(candles)
    folds = []

    # Rolling window
    start_idx = 0
    fold_num = 1

    while start_idx + train_bars + test_bars <= total_bars:
        train_slice = candles[start_idx : start_idx + train_bars]
        test_slice = candles[start_idx + train_bars : start_idx + train_bars + test_bars]

        # 1. In-Sample Signal & Outcome
        is_signals = detect_breakout_retest_signals(train_slice)
        is_trades_base = simulate_trade_outcomes(train_slice, is_signals, cost_pips=3.5)
        is_metrics_base = compute_performance_metrics(is_trades_base)

        # 2. Out-of-Sample Signal & Outcome (Unseen Data)
        oos_signals = detect_breakout_retest_signals(test_slice)
        oos_trades_base = simulate_trade_outcomes(test_slice, oos_signals, cost_pips=3.5)
        oos_metrics_base = compute_performance_metrics(oos_trades_base)

        oos_trades_severe = simulate_trade_outcomes(test_slice, oos_signals, cost_pips=5.0)
        oos_metrics_severe = compute_performance_metrics(oos_trades_severe)

        oos_session_base = run_session_breakdown(oos_trades_base)
        oos_session_severe = run_session_breakdown(oos_trades_severe)

        folds.append({
            "fold": fold_num,
            "train_range": f"{train_slice[0]['datetime']} -> {train_slice[-1]['datetime']}",
            "test_range": f"{test_slice[0]['datetime']} -> {test_slice[-1]['datetime']}",
            "in_sample_base": is_metrics_base,
            "out_of_sample_base": oos_metrics_base,
            "out_of_sample_severe": oos_metrics_severe,
            "out_of_sample_sessions_base": oos_session_base,
            "out_of_sample_sessions_severe": oos_session_severe,
            "oos_trades_count": len(oos_trades_base),
        })

        fold_num += 1
        start_idx += step_bars

    # Full period simulation for comprehensive baseline & stress analysis
    all_signals = detect_breakout_retest_signals(candles)
    all_trades_base = simulate_trade_outcomes(candles, all_signals, cost_pips=3.5)
    all_trades_severe = simulate_trade_outcomes(candles, all_signals, cost_pips=5.0)

    # Chronological 70% In-Sample / 30% Holdout Split
    split_70_idx = int(total_bars * 0.70)
    oos_holdout_candles = candles[split_70_idx:]
    oos_holdout_signals = detect_breakout_retest_signals(oos_holdout_candles)
    holdout_trades_base = simulate_trade_outcomes(oos_holdout_candles, oos_holdout_signals, cost_pips=3.5)
    holdout_trades_severe = simulate_trade_outcomes(oos_holdout_candles, oos_holdout_signals, cost_pips=5.0)

    holdout_metrics_base = compute_performance_metrics(holdout_trades_base)
    holdout_metrics_severe = compute_performance_metrics(holdout_trades_severe)
    holdout_sessions_base = run_session_breakdown(holdout_trades_base)
    holdout_sessions_severe = run_session_breakdown(holdout_trades_severe)

    overall_metrics_base = compute_performance_metrics(all_trades_base)
    overall_metrics_severe = compute_performance_metrics(all_trades_severe)
    overall_sessions_base = run_session_breakdown(all_trades_base)
    overall_sessions_severe = run_session_breakdown(all_trades_severe)

    hourly_full = compute_hourly_breakdown(all_trades_base, all_trades_severe)
    hourly_holdout = compute_hourly_breakdown(holdout_trades_base, holdout_trades_severe)

    return {
        "dataset_info": {
            "symbol": "GC=F (COMEX Gold Continuous Futures)",
            "underlying_asset": "Gold Futures (CME Globex)",
            "timeframe": "M15 (15 Minutes)",
            "total_bars": total_bars,
            "start_time": candles[0]["datetime"],
            "end_time": candles[-1]["datetime"],
            "data_source": "Yahoo Finance (COMEX GC=F)",
            "disclaimer_spot_vs_futures": (
                "Nghiên cứu sử dụng dữ liệu nến M15 của hợp đồng tương lai vàng liên tục COMEX (GC=F). "
                "Hợp đồng tương lai có các đặc thù: chênh lệch giá cơ sở (basis/carrying cost) so với giá giao ngay (spot), "
                "bước nhảy giá tại kỳ đáo hạn chuyển tháng (rollover gaps), và phiên nghỉ bảo trì CME Globex (17:00-18:00 ET / 22:00-23:00 UTC), "
                "khác biệt so với thị trường XAU/USD giao ngay (spot OTC/CFD) hoạt động 24/5 liên tục."
            ),
        },
        "wfo_folds": folds,
        "holdout_30pct_oos": {
            "bar_count": len(oos_holdout_candles),
            "start_time": oos_holdout_candles[0]["datetime"],
            "end_time": oos_holdout_candles[-1]["datetime"],
            "baseline_3_5_pips": holdout_metrics_base,
            "severe_5_0_pips": holdout_metrics_severe,
            "sessions_baseline": holdout_sessions_base,
            "sessions_severe": holdout_sessions_severe,
            "hourly_breakdown": hourly_holdout,
            "sample_trades": holdout_trades_base[:15],
        },
        "full_period_metrics": {
            "baseline_3_5_pips": overall_metrics_base,
            "severe_5_0_pips": overall_metrics_severe,
            "sessions_baseline": overall_sessions_base,
            "sessions_severe": overall_sessions_severe,
            "hourly_breakdown": hourly_full,
        },
    }
