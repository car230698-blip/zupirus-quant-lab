"""Out-of-Sample (OOS) 70/30 Statistical Validator (C2).
Pure Python, zero-leakage, strict 5-gate threshold enforcement.
- Splits candle series strictly 70% In-Sample / 30% Out-of-Sample.
- Runs simulation on 30% OOS across 2 fee regimes:
    * Standard Fee (3.5 pips Gold / 1.5 pips FX)
    * Severe Fee (5.0 pips Gold / 2.5 pips FX)
- 4 Candidate Systems:
    1. strat_trend_breakout
    2. strat_liquidity_sweep
    3. strat_mean_reversion
    4. regime_meta_router
- Peak-to-Trough Drawdown calculated with peak[t] denominator.
- 5 Absolute Mandatory Gates:
    1. Standard Net PnL > 0
    2. Standard Profit Factor >= 1.25
    3. Standard Max Drawdown <= 12%
    4. 30% OOS Trade Count >= 30
    5. Severe Net PnL >= 0 AND Severe Max Drawdown <= 15%
Returns QUALIFIED only if all 5 gates pass; otherwise NO_QUALIFIED_STRATEGY.
"""
import math
import random
from typing import Dict, Any, List, Tuple, Optional

from app.domains.execution.regime_strategies import (
    classify_market_regime,
    strat_trend_breakout,
    strat_liquidity_sweep,
    strat_mean_reversion,
)

FEE_REGIMES = {
    "STANDARD": {"XAUUSD": 3.5, "DEFAULT": 1.5},
    "SEVERE": {"XAUUSD": 5.0, "DEFAULT": 2.5},
}


def get_fee_pips(regime_name: str, symbol: str = "XAUUSD") -> float:
    regime = FEE_REGIMES.get(regime_name.upper(), FEE_REGIMES["STANDARD"])
    sym_upper = symbol.upper()
    if "XAU" in sym_upper or "GOLD" in sym_upper:
        return float(regime.get("XAUUSD", 3.5))
    return float(regime.get("DEFAULT", 1.5))


def split_candles_70_30(
    candles: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Strict chronological split: first 70% In-Sample, last 30% Out-of-Sample."""
    n = len(candles)
    split_point = int(n * 0.70)
    return candles[:split_point], candles[split_point:]


def simulate_strategy_on_candles(
    candles: List[Dict[str, Any]],
    strategy_name: str,
    fee_pips: float,
    symbol: str = "XAUUSD",
) -> List[Dict[str, Any]]:
    """Simulate strategy execution on chronological candles with exact fee deduction."""
    pip_size = 0.10 if ("XAU" in symbol.upper() or "GOLD" in symbol.upper()) else 0.0001
    trades: List[Dict[str, Any]] = []
    active_pos: Optional[Dict[str, Any]] = None

    start_idx = 55
    for i in range(start_idx, len(candles)):
        bar = candles[i]
        c_h = float(bar["high"])
        c_l = float(bar["low"])
        c_c = float(bar["close"])

        # 1. Manage active position if open
        if active_pos is not None:
            side = active_pos["side"]
            entry = active_pos["entry_price"]
            sl = active_pos["sl"]
            tp = active_pos["tp"]
            active_pos["bars_held"] += 1

            closed = False
            exit_price = entry
            reason = "HOLD"

            if side == "BUY":
                if c_l <= sl:
                    exit_price = sl
                    closed = True
                    reason = "SL"
                elif c_h >= tp:
                    exit_price = tp
                    closed = True
                    reason = "TP"
                elif active_pos["bars_held"] >= 32:  # 8h time stop
                    exit_price = c_c
                    closed = True
                    reason = "TIME_STOP"

                if closed:
                    gross_pips = (exit_price - entry) / pip_size
                    net_pips = round(gross_pips - fee_pips, 2)
                    trades.append({
                        "side": side,
                        "entry": entry,
                        "exit": exit_price,
                        "gross_pips": gross_pips,
                        "net_pips": net_pips,
                        "reason": reason,
                        "strategy": strategy_name,
                    })
                    active_pos = None
                    continue

            elif side == "SELL":
                if c_h >= sl:
                    exit_price = sl
                    closed = True
                    reason = "SL"
                elif c_l <= tp:
                    exit_price = tp
                    closed = True
                    reason = "TP"
                elif active_pos["bars_held"] >= 32:
                    exit_price = c_c
                    closed = True
                    reason = "TIME_STOP"

                if closed:
                    gross_pips = (entry - exit_price) / pip_size
                    net_pips = round(gross_pips - fee_pips, 2)
                    trades.append({
                        "side": side,
                        "entry": entry,
                        "exit": exit_price,
                        "gross_pips": gross_pips,
                        "net_pips": net_pips,
                        "reason": reason,
                        "strategy": strategy_name,
                    })
                    active_pos = None
                    continue

        # 2. Check for new signal if no active position
        window = candles[: i + 1]
        sig = None
        if strategy_name == "strat_trend_breakout":
            sig = strat_trend_breakout(window, symbol=symbol)
        elif strategy_name == "strat_liquidity_sweep":
            sig = strat_liquidity_sweep(window, symbol=symbol)
        elif strategy_name == "strat_mean_reversion":
            sig = strat_mean_reversion(window, symbol=symbol)
        elif strategy_name in ("regime_meta_router", "Regime Meta-Router"):
            reg_info = classify_market_regime(window)
            regime = reg_info.get("regime", "RANGING")
            if regime == "TRENDING":
                sig = strat_trend_breakout(window, symbol=symbol) or strat_liquidity_sweep(window, symbol=symbol)
            elif regime == "RANGING":
                sig = strat_mean_reversion(window, symbol=symbol) or strat_liquidity_sweep(window, symbol=symbol)
            else:
                sig = None

        if sig and sig.get("side"):
            active_pos = {
                "side": sig["side"],
                "entry_price": float(sig["entry_price"]),
                "sl": float(sig["sl"]),
                "tp": float(sig["tp"]),
                "bars_held": 0,
            }

    return trades


def calculate_metrics_from_trades(
    trades: List[Dict[str, Any]], base_capital_pips: float = 1000.0
) -> Dict[str, Any]:
    """Calculate performance metrics with peak[t] drawdown."""
    count = len(trades)
    if count == 0:
        return {
            "trade_count": 0,
            "net_pnl": 0.0,
            "profit_factor": 0.0,
            "max_drawdown_pct": 0.0,
            "win_rate": 0.0,
        }

    net_pnls = [t["net_pips"] for t in trades]
    total_net = round(sum(net_pnls), 2)
    wins = [p for p in net_pnls if p > 0]
    losses = [abs(p) for p in net_pnls if p < 0]

    sum_wins = sum(wins)
    sum_losses = sum(losses)
    if sum_losses > 0:
        pf = round(sum_wins / sum_losses, 2)
    elif sum_wins > 0:
        pf = 999.0
    else:
        pf = 0.0

    win_rate = round(len(wins) / count, 4)

    # Peak-to-Trough Drawdown with peak[t] denominator:
    # 100 * max((peak[t] - equity[t]) / peak[t])
    equity = base_capital_pips
    peak = base_capital_pips
    max_dd = 0.0
    for pnl in net_pnls:
        equity += pnl
        if equity > peak:
            peak = equity
        if peak > 0:
            dd = ((peak - equity) / peak) * 100.0
            if dd > max_dd:
                max_dd = dd

    return {
        "trade_count": count,
        "net_pnl": total_net,
        "profit_factor": pf,
        "max_drawdown_pct": round(max_dd, 2),
        "win_rate": win_rate,
    }


def evaluate_oos_metrics(
    std_net_pnl: float,
    std_pf: float,
    std_max_dd: float,
    trade_count: int,
    sev_net_pnl: float,
    sev_max_dd: float,
) -> str:
    """Enforces the 5 absolute mandatory gates:
    1. Standard fee: Net PnL > 0
    2. Standard fee: Profit Factor >= 1.25
    3. Standard fee: Max Drawdown <= 12%
    4. On 30% OOS: Trade count >= 30
    5. Severe fee: Net PnL >= 0 AND Max Drawdown <= 15%
    """
    g1 = std_net_pnl > 0.0
    g2 = std_pf >= 1.25
    g3 = std_max_dd <= 12.0
    g4 = trade_count >= 30
    g5 = (sev_net_pnl >= 0.0) and (sev_max_dd <= 15.0)

    if g1 and g2 and g3 and g4 and g5:
        return "QUALIFIED"
    return "NO_QUALIFIED_STRATEGY"


def run_oos_validation_suite(
    candles: Optional[List[Dict[str, Any]]] = None,
    symbol: str = "XAUUSD",
) -> Dict[str, Any]:
    """Execute complete Out-of-Sample 70/30 validation across the 4 candidate strategies."""
    if not candles:
        # Generate or load benchmark candles
        candles = generate_benchmark_candles(n_bars=1500, symbol=symbol)

    is_candles, oos_candles = split_candles_70_30(candles)
    std_fee = get_fee_pips("STANDARD", symbol)
    sev_fee = get_fee_pips("SEVERE", symbol)

    strategies = [
        "strat_trend_breakout",
        "strat_liquidity_sweep",
        "strat_mean_reversion",
        "regime_meta_router",
    ]

    results: Dict[str, Any] = {}
    any_qualified = False

    for strat in strategies:
        std_trades = simulate_strategy_on_candles(oos_candles, strat, std_fee, symbol)
        sev_trades = simulate_strategy_on_candles(oos_candles, strat, sev_fee, symbol)

        std_metrics = calculate_metrics_from_trades(std_trades)
        sev_metrics = calculate_metrics_from_trades(sev_trades)

        status = evaluate_oos_metrics(
            std_net_pnl=std_metrics["net_pnl"],
            std_pf=std_metrics["profit_factor"],
            std_max_dd=std_metrics["max_drawdown_pct"],
            trade_count=std_metrics["trade_count"],
            sev_net_pnl=sev_metrics["net_pnl"],
            sev_max_dd=sev_metrics["max_drawdown_pct"],
        )

        if status == "QUALIFIED":
            any_qualified = True

        results[strat] = {
            "strategy": strat,
            "status": status,
            "standard_fee": {
                "fee_pips": std_fee,
                "trade_count": std_metrics["trade_count"],
                "net_pnl": std_metrics["net_pnl"],
                "profit_factor": std_metrics["profit_factor"],
                "max_drawdown_pct": std_metrics["max_drawdown_pct"],
                "win_rate": std_metrics["win_rate"],
            },
            "severe_fee": {
                "fee_pips": sev_fee,
                "trade_count": sev_metrics["trade_count"],
                "net_pnl": sev_metrics["net_pnl"],
                "profit_factor": sev_metrics["profit_factor"],
                "max_drawdown_pct": sev_metrics["max_drawdown_pct"],
                "win_rate": sev_metrics["win_rate"],
            },
        }

    overall_conclusion = "QUALIFIED" if any_qualified else "NO_QUALIFIED_STRATEGY"
    return {
        "conclusion": overall_conclusion,
        "total_candles": len(candles),
        "in_sample_count": len(is_candles),
        "oos_count": len(oos_candles),
        "symbol": symbol,
        "results": results,
    }


def generate_benchmark_candles(n_bars: int = 1500, symbol: str = "XAUUSD") -> List[Dict[str, Any]]:
    """Generate realistic synthetic M15 benchmark candles for robust statistical testing."""
    rng = random.Random(42)
    base_price = 2650.0 if "XAU" in symbol.upper() else 1.0850
    pip = 0.10 if "XAU" in symbol.upper() else 0.0001
    candles = []

    price = base_price
    trend_mode = 1.0
    for i in range(n_bars):
        if i % 120 == 0:
            trend_mode = rng.choice([-1.0, 1.0, 0.0])

        volatility = rng.uniform(8 * pip, 25 * pip)
        drift = trend_mode * rng.uniform(0.5 * pip, 4 * pip)

        c_open = price
        c_close = c_open + drift + rng.uniform(-volatility * 0.5, volatility * 0.5)
        c_high = max(c_open, c_close) + rng.uniform(1 * pip, volatility * 0.6)
        c_low = min(c_open, c_close) - rng.uniform(1 * pip, volatility * 0.6)

        candles.append({
            "time": 1700000000 + i * 900,
            "open": round(c_open, 4),
            "high": round(c_high, 4),
            "low": round(c_low, 4),
            "close": round(c_close, 4),
        })
        price = c_close

    return candles
