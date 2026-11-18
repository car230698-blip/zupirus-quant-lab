"""Quant Portfolio Optimization & Multi-Asset Risk Allocation Engine.
Includes Multi-Asset Universe specifications, ATR & Kelly position sizing,
and Monte Carlo simulation for Drawdown & Risk of Ruin confidence intervals."""
import math
import random
from typing import Dict, Any, List, Optional, Tuple

# Multi-Asset Universe Configuration
ASSET_UNIVERSE = {
    "XAUUSD": {
        "name": "Gold vs US Dollar",
        "category": "commodities",
        "point_size": 0.01,
        "contract_multiplier": 100.0,
        "base_spread": 0.25,
        "typical_atr_m15": 3.8,
        "volatility_class": "high",
        "recommended_sl_atr": 1.5,
        "recommended_tp_atr": 3.0,
    },
    "EURUSD": {
        "name": "Euro vs US Dollar",
        "category": "forex_major",
        "point_size": 0.00001,
        "contract_multiplier": 100000.0,
        "base_spread": 0.00012,
        "typical_atr_m15": 0.0018,
        "volatility_class": "medium",
        "recommended_sl_atr": 1.5,
        "recommended_tp_atr": 3.0,
    },
    "GBPUSD": {
        "name": "British Pound vs US Dollar",
        "category": "forex_major",
        "point_size": 0.00001,
        "contract_multiplier": 100000.0,
        "base_spread": 0.00018,
        "typical_atr_m15": 0.0026,
        "volatility_class": "medium_high",
        "recommended_sl_atr": 1.5,
        "recommended_tp_atr": 3.0,
    },
    "USDJPY": {
        "name": "US Dollar vs Japanese Yen",
        "category": "forex_major",
        "point_size": 0.001,
        "contract_multiplier": 100000.0,
        "base_spread": 0.015,
        "typical_atr_m15": 0.22,
        "volatility_class": "medium",
        "recommended_sl_atr": 1.5,
        "recommended_tp_atr": 3.0,
    },
    "BTCUSD": {
        "name": "Bitcoin vs US Dollar",
        "category": "crypto",
        "point_size": 0.01,
        "contract_multiplier": 1.0,
        "base_spread": 12.0,
        "typical_atr_m15": 420.0,
        "volatility_class": "extreme",
        "recommended_sl_atr": 2.0,
        "recommended_tp_atr": 4.0,
    },
}


def get_universe_specs() -> Dict[str, Any]:
    """Returns the full multi-asset specification dictionary."""
    return ASSET_UNIVERSE


def scan_universe(prices: Optional[Dict[str, float]] = None) -> List[Dict[str, Any]]:
    """Scans all assets in the universe and returns current metrics, volatility rating,
    and regime classification."""
    default_base_prices = {
        "XAUUSD": 2652.40,
        "EURUSD": 1.08450,
        "GBPUSD": 1.29320,
        "USDJPY": 154.250,
        "BTCUSD": 91250.0,
    }
    current = prices or default_base_prices

    scan_results = []
    for symbol, spec in ASSET_UNIVERSE.items():
        price = current.get(symbol, default_base_prices.get(symbol, 100.0))
        atr = spec["typical_atr_m15"]
        vol_pct = round((atr / price) * 100, 3)

        # Classify regime based on volatility and asset profile
        if vol_pct > 1.2:
            regime = "High Volatility Breakout"
            strategy_bias = "breakout"
        elif vol_pct < 0.25:
            regime = "Low Volatility Consolidation"
            strategy_bias = "mean_reversion"
        else:
            regime = "Dynamic Trend Continuation"
            strategy_bias = "trend_following"

        scan_results.append({
            "symbol": symbol,
            "name": spec["name"],
            "category": spec["category"],
            "price": price,
            "atr_m15": atr,
            "volatility_pct": vol_pct,
            "volatility_class": spec["volatility_class"],
            "regime": regime,
            "strategy_bias": strategy_bias,
            "sl_points": round(atr * spec["recommended_sl_atr"], 4),
            "tp_points": round(atr * spec["recommended_tp_atr"], 4),
        })

    return scan_results


def calculate_position_size(
    equity: float,
    symbol: str,
    risk_percent: float = 1.0,
    custom_sl_points: Optional[float] = None,
    method: str = "atr_volatility",
    win_rate: float = 0.55,
    win_loss_ratio: float = 2.0,
    sl_unit: str = "auto",
    entry_price: Optional[float] = None,
) -> Dict[str, Any]:
    """Calculates optimal lot size using ATR Volatility or Half-Kelly scaling
    with fail-closed safety clamps. Normalizes MT5 points vs price distance."""
    if equity <= 0:
        return {"lot": 0.0, "error": "Invalid equity"}

    if symbol in ASSET_UNIVERSE:
        spec = ASSET_UNIVERSE[symbol]
        point_size = float(spec.get("point_size") or 0.01)
        contract_mult = float(spec.get("contract_multiplier") or 100.0)
        typical_atr = float(spec.get("typical_atr_m15") or 3.5)
        rec_sl_atr = float(spec.get("recommended_sl_atr") or 1.0)
    else:
        from app.services.symbol_precision import contract_size_for_symbol, pip_size_for_symbol, point_size_for_symbol
        point_size = point_size_for_symbol(symbol)
        contract_mult = contract_size_for_symbol(symbol)
        typical_atr = 20.0 * pip_size_for_symbol(symbol)
        rec_sl_atr = 1.0

    if custom_sl_points is not None and custom_sl_points > 0:
        if sl_unit == "points" or (sl_unit == "auto" and symbol != "BTCUSD" and custom_sl_points >= 20.0):
            sl_price_dist = float(custom_sl_points) * point_size
        else:
            sl_price_dist = float(custom_sl_points)
    else:
        sl_price_dist = typical_atr * rec_sl_atr

    # Monetary risk target
    risk_dollars = equity * (max(0.1, min(risk_percent, 3.0)) / 100.0)

    # 1. Base ATR Volatility Sizing
    # Loss per 1.0 standard lot if SL is hit (converted to USD for non-USD quote pairs)
    from app.services.symbol_precision import _lookup_quote_mid, quote_to_usd_rate
    spot_price = float(entry_price) if (entry_price and entry_price > 0) else _lookup_quote_mid(symbol)
    loss_per_lot = sl_price_dist * contract_mult * quote_to_usd_rate(symbol, spot_price)
    if loss_per_lot <= 0:
        loss_per_lot = 1.0

    raw_lot = risk_dollars / loss_per_lot

    # 2. Kelly Criterion Adjustment
    # Kelly fraction: f* = (p * b - q) / b where q = 1 - p
    if method == "half_kelly":
        q = 1.0 - win_rate
        full_kelly = (win_rate * win_loss_ratio - q) / win_loss_ratio
        # Use Half-Kelly for safety (fail-closed against estimation noise)
        half_kelly_factor = max(0.2, min(full_kelly * 0.5, 1.5)) if full_kelly > 0 else 0.2
        raw_lot = raw_lot * half_kelly_factor

    # Safety clamps
    clamped_lot = max(0.01, min(round(raw_lot, 2), 5.0))
    dollar_exposure = round(clamped_lot * loss_per_lot, 2)

    return {
        "symbol": symbol,
        "equity": equity,
        "risk_percent": risk_percent,
        "method": method,
        "recommended_lot": clamped_lot,
        "dollar_risk": dollar_exposure,
        "sl_price_distance": round(sl_price_dist, 5),
        "sl_points": round(sl_price_dist / point_size, 1) if point_size > 0 else round(sl_price_dist, 4),
        "contract_multiplier": spec["contract_multiplier"],
        "is_clamped": clamped_lot != raw_lot,
    }


def run_monte_carlo_simulation(
    trades: Optional[List[float]] = None,
    initial_equity: float = 10000.0,
    iterations: int = 2000,
    horizon_trades: int = 100,
    ruin_drawdown_pct: float = 20.0,
) -> Dict[str, Any]:
    """Simulates portfolio paths using bootstrap resampling of real trade returns
    to compute Value-at-Risk (VaR), Drawdown Confidence Intervals, and Risk of Ruin."""
    iterations = min(2000, max(100, int(iterations)))
    horizon_trades = min(250, max(10, int(horizon_trades)))
    initial_equity = max(100.0, float(initial_equity))

    if not trades or len(trades) < 5:
        return {
            "insufficient_data": True,
            "error": "Cần ít nhất 5 lệnh lịch sử để chạy mô phỏng Monte Carlo chính xác.",
            "trades_provided": len(trades or []),
            "iterations": 0,
            "horizon_trades": horizon_trades,
            "initial_equity": initial_equity,
            "ruin_threshold_pct": ruin_drawdown_pct,
            "risk_of_ruin_pct": 0.0,
            "median_max_drawdown_pct": 0.0,
            "var_95_max_drawdown_pct": 0.0,
            "var_99_max_drawdown_pct": 0.0,
            "median_final_equity": initial_equity,
            "robustness_score": 0.0,
        }

    max_drawdowns: List[float] = []
    final_equities: List[float] = []
    ruin_count = 0

    for _ in range(iterations):
        eq = initial_equity
        peak = eq
        max_dd = 0.0
        ruined = False

        for _ in range(horizon_trades):
            # Geometric compounding of trade return relative to initial equity
            ret = float(random.choice(trades))
            eq = max(0.0, eq * (1.0 + (ret / initial_equity)))
            if eq > peak:
                peak = eq
            dd = ((peak - eq) / peak) * 100.0 if peak > 0 else 100.0
            if dd > max_dd:
                max_dd = dd

            if dd >= ruin_drawdown_pct or eq <= 0.0:
                ruined = True

        max_drawdowns.append(max_dd)
        final_equities.append(eq)
        if ruined:
            ruin_count += 1

    max_drawdowns.sort()
    final_equities.sort()

    idx_95 = int(iterations * 0.95)
    idx_99 = int(iterations * 0.99)
    idx_50 = int(iterations * 0.50)

    dd_95 = round(max_drawdowns[min(idx_95, iterations - 1)], 2)
    dd_99 = round(max_drawdowns[min(idx_99, iterations - 1)], 2)
    median_dd = round(max_drawdowns[idx_50], 2)
    median_final_equity = round(final_equities[idx_50], 2)
    risk_of_ruin_pct = round((ruin_count / iterations) * 100.0, 2)

    return {
        "iterations": iterations,
        "horizon_trades": horizon_trades,
        "initial_equity": initial_equity,
        "ruin_threshold_pct": ruin_drawdown_pct,
        "risk_of_ruin_pct": risk_of_ruin_pct,
        "median_max_drawdown_pct": median_dd,
        "var_95_max_drawdown_pct": dd_95,
        "var_99_max_drawdown_pct": dd_99,
        "median_final_equity": median_final_equity,
        "robustness_score": round(max(0.0, min(100.0, 100.0 - (dd_95 * 2.0) - (risk_of_ruin_pct * 3.0))), 1),
    }

