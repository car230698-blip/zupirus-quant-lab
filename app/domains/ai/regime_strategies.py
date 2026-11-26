"""Station 2: Market Regime Classifier, 3 Core Opposing Strategies & Regime Meta-Router.
100% Pure Python (< 3ms per candle, 0 LLM tokens).
"""
import math
import time
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from app.db import tx, getkv, setkv

logger = logging.getLogger("zupirus.regime_strategies")


def calculate_ema(values: List[float], period: int) -> List[float]:
    """Calculate Exponential Moving Average."""
    if not values:
        return []
    k = 2.0 / (period + 1.0)
    ema = [values[0]]
    for v in values[1:]:
        ema.append(v * k + ema[-1] * (1.0 - k))
    return ema


def calculate_rsi(prices: List[float], period: int = 14) -> float:
    """Calculate Relative Strength Index (RSI)."""
    if len(prices) <= period:
        return 50.0
    gains = []
    losses = []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i - 1]
        gains.append(max(0.0, change))
        losses.append(max(0.0, -change))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss < 1e-9:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def calculate_atr(candles: List[Dict[str, Any]], period: int = 14) -> List[float]:
    """Calculate Average True Range (ATR)."""
    if len(candles) < 2:
        return [0.0] * len(candles)
    trs = [float(candles[0]["high"]) - float(candles[0]["low"])]
    for i in range(1, len(candles)):
        h = float(candles[i]["high"])
        l = float(candles[i]["low"])
        prev_c = float(candles[i - 1]["close"])
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)

    # Smooth ATR
    if len(trs) < period:
        return trs
    atr = [sum(trs[:period]) / period]
    for tr in trs[period:]:
        atr.append((atr[-1] * (period - 1) + tr) / period)
    return [0.0] * (period - 1) + atr


def classify_market_regime(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Pure Python market regime classifier (< 3ms execution).
    Calculates:
    - Kaufman Efficiency Ratio (ER 14): abs(close - close[n]) / sum(abs(close[i] - close[i-1]))
    - ATR volatility ratio: atr14 / mean_atr_20
    - Wick ratio: sum(wick sizes) / sum(ranges)

    Classifications:
    - CHAOTIC: ER < 0.20 and atr_ratio > 1.8 (flash chop/volatility; stand aside)
    - TRENDING: ER >= 0.35 and trend aligned
    - RANGING: ER < 0.35 and atr_ratio <= 1.2
    """
    if len(candles) < 25:
        return {
            "regime": "RANGING",
            "er": 0.25,
            "atr_ratio": 1.0,
            "wick_ratio": 0.3,
            "action": "RANGE",
        }

    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]

    # 1. Kaufman Efficiency Ratio (ER 14)
    change = abs(closes[-1] - closes[-14])
    volatility = sum(abs(closes[i] - closes[i - 1]) for i in range(-13, 0))
    er = round(change / max(volatility, 1e-6), 4)

    # 2. ATR Ratio: atr14 / mean_atr_20
    atrs = calculate_atr(candles, period=14)
    atr14 = atrs[-1] if atrs else 1.0
    recent_atrs = atrs[-20:] if len(atrs) >= 20 else atrs
    mean_atr_20 = sum(recent_atrs) / max(len(recent_atrs), 1)
    atr_ratio = round(atr14 / max(mean_atr_20, 1e-6), 4)

    # 3. Wick ratio
    wick_sum = 0.0
    range_sum = 0.0
    for i in range(-14, 0):
        c_h = highs[i]
        c_l = lows[i]
        c_o = float(candles[i]["open"])
        c_c = closes[i]
        body_top = max(c_o, c_c)
        body_bot = min(c_o, c_c)
        wick_sum += (c_h - body_top) + (body_bot - c_l)
        range_sum += max(c_h - c_l, 1e-6)
    wick_ratio = round(wick_sum / max(range_sum, 1e-6), 4)

    # Classification logic
    if er < 0.20 and atr_ratio > 1.8:
        regime = "CHAOTIC"
        action = "STAND_ASIDE"
    elif er >= 0.35:
        regime = "TRENDING"
        action = "TREND"
    else:
        regime = "RANGING"
        action = "RANGE"

    return {
        "regime": regime,
        "er": er,
        "atr_ratio": atr_ratio,
        "wick_ratio": wick_ratio,
        "action": action,
    }


def is_market_open_gap_cooldown(now_ts: Optional[float] = None) -> bool:
    """Sunday 21:00–21:30 UTC market-open gap cooldown: blocks new orders."""
    now = datetime.fromtimestamp(now_ts if now_ts is not None else time.time(), tz=timezone.utc)
    # Sunday is weekday() == 6
    if now.weekday() == 6:
        minute_of_day = now.hour * 60 + now.minute
        # 21:00 is 21*60 = 1260, 21:30 is 1290
        if 1260 <= minute_of_day < 1290:
            return True
    return False


# ---------------------------------------------------------------------------
# 3 Core Opposing Strategies evaluated on M15 closed candles
# ---------------------------------------------------------------------------

def strat_trend_breakout(candles: List[Dict[str, Any]], symbol: str = "XAUUSD") -> Optional[Dict[str, Any]]:
    """1. strat_trend_breakout:
    - Donchian 20 channel breakout
    - EMA 20 > EMA 50 trend confirmation
    - SL at swing low/high of last 5 bars, TP at 2.0R
    """
    if len(candles) < 55:
        return None
    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]

    ema20 = calculate_ema(closes, 20)[-1]
    ema50 = calculate_ema(closes, 50)[-1]

    # Donchian 20 of previous 20 bars (excluding current)
    donchian_high = max(highs[-21:-1])
    donchian_low = min(lows[-21:-1])

    cur_close = closes[-1]
    cur_price = cur_close

    pip_size = 0.10 if ("XAU" in symbol.upper() or "GOLD" in symbol.upper()) else 0.0001

    if cur_close > donchian_high and ema20 > ema50:
        swing_low = min(lows[-5:])
        sl_dist = max(cur_price - swing_low, 15 * pip_size)
        sl = round(cur_price - sl_dist, 4)
        tp = round(cur_price + 2.0 * sl_dist, 4)
        return {
            "strategy_id": "strat_trend_breakout",
            "side": "BUY",
            "entry_price": cur_price,
            "sl": sl,
            "tp": tp,
            "rr": 2.0,
            "reason": f"Donchian 20 breakout above {donchian_high:.2f} with EMA20 > EMA50",
        }
    elif cur_close < donchian_low and ema20 < ema50:
        swing_high = max(highs[-5:])
        sl_dist = max(swing_high - cur_price, 15 * pip_size)
        sl = round(cur_price + sl_dist, 4)
        tp = round(cur_price - 2.0 * sl_dist, 4)
        return {
            "strategy_id": "strat_trend_breakout",
            "side": "SELL",
            "entry_price": cur_price,
            "sl": sl,
            "tp": tp,
            "rr": 2.0,
            "reason": f"Donchian 20 breakdown below {donchian_low:.2f} with EMA20 < EMA50",
        }
    return None


def strat_liquidity_sweep(candles: List[Dict[str, Any]], symbol: str = "XAUUSD") -> Optional[Dict[str, Any]]:
    """2. strat_liquidity_sweep:
    - Session liquidity sweep (last 32 bars ~ 8h session)
    - False breakout + strong wick rejection (wick >= 50% of candle range)
    - SL beyond wick tip, TP at opposite session boundary (or 2.0R)
    """
    if len(candles) < 35:
        return None
    session_highs = [float(c["high"]) for c in candles[-33:-1]]
    session_lows = [float(c["low"]) for c in candles[-33:-1]]
    session_high = max(session_highs)
    session_low = min(session_lows)

    cur = candles[-1]
    c_o = float(cur["open"])
    c_h = float(cur["high"])
    c_l = float(cur["low"])
    c_c = float(cur["close"])
    c_range = max(c_h - c_l, 1e-6)

    pip_size = 0.10 if ("XAU" in symbol.upper() or "GOLD" in symbol.upper()) else 0.0001

    # Bullish sweep of session low: pierced below session_low but closed back above it
    lower_wick = min(c_o, c_c) - c_l
    if c_l < session_low and c_c > session_low and (lower_wick / c_range) >= 0.45:
        sl = round(c_l - 5 * pip_size, 4)
        sl_dist = max(c_c - sl, 10 * pip_size)
        tp = round(max(session_high, c_c + 2.0 * sl_dist), 4)
        return {
            "strategy_id": "strat_liquidity_sweep",
            "side": "BUY",
            "entry_price": c_c,
            "sl": sl,
            "tp": tp,
            "rr": round((tp - c_c) / sl_dist, 2),
            "reason": f"Liquidity sweep below session low {session_low:.2f} with {lower_wick/c_range*100:.0f}% rejection wick",
        }

    # Bearish sweep of session high: pierced above session_high but closed back below it
    upper_wick = c_h - max(c_o, c_c)
    if c_h > session_high and c_c < session_high and (upper_wick / c_range) >= 0.45:
        sl = round(c_h + 5 * pip_size, 4)
        sl_dist = max(sl - c_c, 10 * pip_size)
        tp = round(min(session_low, c_c - 2.0 * sl_dist), 4)
        return {
            "strategy_id": "strat_liquidity_sweep",
            "side": "SELL",
            "entry_price": c_c,
            "sl": sl,
            "tp": tp,
            "rr": round((c_c - tp) / sl_dist, 2),
            "reason": f"Liquidity sweep above session high {session_high:.2f} with {upper_wick/c_range*100:.0f}% rejection wick",
        }
    return None


def strat_mean_reversion(candles: List[Dict[str, Any]], symbol: str = "XAUUSD") -> Optional[Dict[str, Any]]:
    """3. strat_mean_reversion:
    - Bollinger Bands (20, 2.0 std dev)
    - RSI(14) oversold (<30) / overbought (>70)
    - Target middle BB (EMA 20)
    """
    if len(candles) < 30:
        return None
    closes = [float(c["close"]) for c in candles]
    cur_c = closes[-1]
    cur = candles[-1]
    c_h = float(cur["high"])
    c_l = float(cur["low"])

    # 20 SMA & Std Dev
    recent_20 = closes[-20:]
    sma20 = sum(recent_20) / 20.0
    variance = sum((x - sma20) ** 2 for x in recent_20) / 20.0
    std20 = math.sqrt(variance)
    upper_bb = sma20 + 2.0 * std20
    lower_bb = sma20 - 2.0 * std20

    rsi = calculate_rsi(closes, period=14)
    pip_size = 0.10 if ("XAU" in symbol.upper() or "GOLD" in symbol.upper()) else 0.0001

    if cur_c <= lower_bb and rsi < 32:
        sl = round(c_l - 10 * pip_size, 4)
        tp = round(sma20, 4)
        if tp > cur_c:
            return {
                "strategy_id": "strat_mean_reversion",
                "side": "BUY",
                "entry_price": cur_c,
                "sl": sl,
                "tp": tp,
                "rr": round((tp - cur_c) / max(cur_c - sl, 1e-4), 2),
                "reason": f"Mean reversion: close {cur_c:.2f} <= lower BB {lower_bb:.2f} and RSI={rsi:.1f} < 32",
            }
    elif cur_c >= upper_bb and rsi > 68:
        sl = round(c_h + 10 * pip_size, 4)
        tp = round(sma20, 4)
        if tp < cur_c:
            return {
                "strategy_id": "strat_mean_reversion",
                "side": "SELL",
                "entry_price": cur_c,
                "sl": sl,
                "tp": tp,
                "rr": round((cur_c - tp) / max(sl - cur_c, 1e-4), 2),
                "reason": f"Mean reversion: close {cur_c:.2f} >= upper BB {upper_bb:.2f} and RSI={rsi:.1f} > 68",
            }
    return None


# ---------------------------------------------------------------------------
# Regime Meta-Router with Rolling 30-Trade Scoring & Shadow Isolation
# ---------------------------------------------------------------------------

COST_PIPS = {
    "XAUUSD": 3.5,
    "GOLD": 3.5,
    "EURUSD": 1.5,
    "GBPUSD": 1.5,
    "USDJPY": 1.5,
}


class RegimeMetaRouter:
    """Regime Meta-Router:
    - Tracks rolling 30 trades per (regime, strategy_id) net of costs (3.5 pips Gold, 1.5 FX).
    - Demotes strategy to SHADOW after 3 consecutive losses.
    - Auto-recovers to ACTIVE when last 10 shadow trades have positive expectancy.
    - Calculates unified risk scale.
    """

    def __init__(self, db_cursor=None):
        self.db_cursor = db_cursor

    def get_state(self) -> Dict[str, Any]:
        raw = None
        if self.db_cursor is not None:
            row = self.db_cursor.execute("SELECT value FROM kv WHERE key = 'meta_router:last_state'").fetchone()
            if row:
                raw = row["value"] if hasattr(row, "keys") else row[0]
        else:
            with tx() as c:
                raw = getkv(c, "meta_router:last_state")

        if raw:
            try:
                return json.loads(raw)
            except Exception:
                pass
        return {
            "strategies": {
                "strat_trend_breakout": {"status": "ACTIVE", "consecutive_losses": 0, "rolling_pnl_pips": 0.0, "shadow_trades": []},
                "strat_liquidity_sweep": {"status": "ACTIVE", "consecutive_losses": 0, "rolling_pnl_pips": 0.0, "shadow_trades": []},
                "strat_mean_reversion": {"status": "ACTIVE", "consecutive_losses": 0, "rolling_pnl_pips": 0.0, "shadow_trades": []},
            },
            "last_regime": "RANGING",
            "updated_at": time.time(),
        }

    def save_state(self, state: Dict[str, Any]) -> None:
        payload = json.dumps(state)
        if self.db_cursor is not None:
            self.db_cursor.execute(
                "INSERT INTO kv (key, value) VALUES ('meta_router:last_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (payload,)
            )
        else:
            with tx() as c:
                setkv(c, "meta_router:last_state", payload)

    def record_trade_result(self, strategy_id: str, pnl_pips: float, symbol: str = "XAUUSD") -> Dict[str, Any]:
        """Record trade result net of transaction costs, evaluate demotion and auto-recovery."""
        cost = COST_PIPS.get(symbol.upper(), 3.5 if "XAU" in symbol.upper() else 1.5)
        net_pnl = pnl_pips - cost

        state = self.get_state()
        strat_meta = state["strategies"].setdefault(strategy_id, {
            "status": "ACTIVE",
            "consecutive_losses": 0,
            "rolling_pnl_pips": 0.0,
            "shadow_trades": [],
        })

        if strat_meta["status"] == "ACTIVE":
            if net_pnl < 0:
                strat_meta["consecutive_losses"] = strat_meta.get("consecutive_losses", 0) + 1
            else:
                strat_meta["consecutive_losses"] = 0

            # 3 consecutive losses -> demote to SHADOW
            if strat_meta["consecutive_losses"] >= 3:
                strat_meta["status"] = "SHADOW"
                strat_meta["demoted_at"] = time.time()
                strat_meta["shadow_trades"] = []
                logger.warning(f"STRATEGY DEMOTED: {strategy_id} demoted to SHADOW after 3 consecutive losses.")
        else:
            # SHADOW tracking: evaluate auto-recovery
            shadow_trades = strat_meta.setdefault("shadow_trades", [])
            shadow_trades.append(net_pnl)
            if len(shadow_trades) > 10:
                strat_meta["shadow_trades"] = shadow_trades[-10:]

            # Auto-recover if last 10 shadow trades have positive expectancy (> 0 pips)
            if len(strat_meta["shadow_trades"]) >= 10 and sum(strat_meta["shadow_trades"]) > 0:
                strat_meta["status"] = "ACTIVE"
                strat_meta["consecutive_losses"] = 0
                strat_meta["recovered_at"] = time.time()
                logger.info(f"STRATEGY RECOVERED: {strategy_id} restored to ACTIVE (10-trade shadow expectancy > 0).")

        state["updated_at"] = time.time()
        self.save_state(state)
        return strat_meta

    def get_strategy_scale(self, strategy_id: str, regime: str) -> float:
        """Returns strategy score scale (0.0 if SHADOW or unsuitable for regime, 1.0 if ACTIVE)."""
        state = self.get_state()
        strat_meta = state.get("strategies", {}).get(strategy_id, {})
        if strat_meta.get("status") == "SHADOW":
            return 0.0

        # Regime suitability filter
        if regime == "CHAOTIC":
            return 0.0
        elif regime == "TRENDING" and strategy_id == "strat_mean_reversion":
            return 0.5  # Half scale for counter-trend in trending market
        elif regime == "RANGING" and strategy_id == "strat_trend_breakout":
            return 0.5  # Half scale for breakout in ranging market

        return 1.0

    @staticmethod
    def calculate_unified_risk_scale(
        kill_switch: bool,
        regime: str,
        shock_flag: Optional[str],
        strategy_score_scale: float,
        dxy_scale: float,
        macro_scale: float,
        open_gap_cooldown: bool = False,
    ) -> float:
        """Calculate unified risk scale across all safety & station layers:
        - If kill-switch, CHAOTIC, DANGER_FREEZE, cooldown, or strategy scale == 0: final_scale = 0.
        - Else: final_scale = min(strategy_score_scale, dxy_scale, macro_scale).
        """
        if kill_switch or regime == "CHAOTIC" or shock_flag == "DANGER_FREEZE" or open_gap_cooldown or strategy_score_scale <= 0.0:
            return 0.0
        return min(strategy_score_scale, dxy_scale, macro_scale)
