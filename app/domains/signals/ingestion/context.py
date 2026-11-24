"""Market context capture and feature extraction for Tabula Rasa observational learning.
Captures real-time market snapshots whenever an external signal is ingested.
"""
import datetime
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


def get_trading_session(ts: float) -> str:
    """Determine the global FX trading session from timestamp (UTC)."""
    utc_dt = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)
    hour = utc_dt.hour
    if 0 <= hour < 8:
        return "Asia"
    elif 8 <= hour < 13:
        return "London"
    elif 13 <= hour < 17:
        return "London/New York Overlap"
    elif 17 <= hour < 22:
        return "New York"
    else:
        return "Late NY / Pre-Asia"


def get_market_atr14(c, symbol: str = "XAUUSD", timeframe: str = "M15") -> float:
    """Calculate live ATR(14) from closed candles in TimescaleDB or fallback safely."""
    sym_u = (symbol or "XAUUSD").strip().upper()
    default_atr = 5.0 if "XAU" in sym_u else (0.35 if "JPY" in sym_u else 0.0020)
    try:
        rows = c.execute(
            """
            SELECT high, low, close FROM candles
            WHERE symbol = ? AND timeframe = ? AND (source IS NULL OR source != 'YAHOO_REFERENCE')
            ORDER BY time DESC LIMIT 15
            """,
            (sym_u, timeframe)
        ).fetchall()
        if rows and len(rows) >= 5:
            trs = []
            candles = [dict(r) if hasattr(r, 'keys') else {"high": r[0], "low": r[1], "close": r[2]} for r in rows]
            for i in range(len(candles) - 1):
                cur = candles[i]
                prev = candles[i + 1]
                tr = max(
                    cur["high"] - cur["low"],
                    abs(cur["high"] - prev["close"]),
                    abs(cur["low"] - prev["close"]),
                )
                trs.append(tr)
            if trs:
                from app.services.symbol_precision import digits_for_symbol
                return round(sum(trs) / len(trs), digits_for_symbol(sym_u))
    except Exception as e:
        logger.warning(f"Failed to calculate ATR(14) for {sym_u} ({timeframe}): {e}")
    return default_atr


def get_nearest_news_info(c, current_time: float) -> Tuple[float, Optional[str]]:
    """Return distance in minutes and title of the nearest high-impact USD economic event."""
    try:
        row = c.execute(
            """
            SELECT title, ts FROM news
            WHERE lower(impact) = 'high' AND upper(currency) IN ('USD', 'ALL')
            ORDER BY abs(ts - ?) ASC LIMIT 1
            """,
            (current_time,)
        ).fetchone()
        if row:
            title = row["title"] if hasattr(row, 'keys') else row[0]
            event_ts = row["ts"] if hasattr(row, 'keys') else row[1]
            dist_mins = round((event_ts - current_time) / 60.0, 1)
            return dist_mins, title
    except Exception:
        pass
    return 999.0, None


def get_live_spread(c, symbol: str = "XAUUSD") -> float:
    """Return live spread in pips for symbol from quotes."""
    from app.services.symbol_mapper import canonical_symbol
    from app.services.symbol_precision import pip_multiplier_for_symbol
    sym_u = canonical_symbol(symbol)
    try:
        q = c.execute(
            "SELECT bid, ask FROM quotes WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
            (sym_u,),
        ).fetchone()
        if q:
            bid = float(q["bid"] if hasattr(q, 'keys') else q[0])
            ask = float(q["ask"] if hasattr(q, 'keys') else q[1])
            diff = max(0.0, ask - bid)
            mult = pip_multiplier_for_symbol(sym_u)
            return round(diff * mult, 1)
    except Exception:
        pass
    return 1.5  # Safe neutral fallback spread in pips when quote cache is cold


def get_fresh_live_price(c, symbol: str = "XAUUSD", max_age_sec: float = 120.0) -> Optional[float]:
    """Retrieve verified fresh live price (< max_age_sec) for symbol with seamless fallback (quotes -> Redis).
    Prevents autonomous agent loop and webhooks from false-rejecting STALE_QUOTE when Redis tick stream is live.
    """
    import time
    from app.services.symbol_mapper import canonical_symbol
    from app.services.symbol_precision import digits_for_symbol

    sym_u = canonical_symbol(symbol)
    now_ts = time.time()
    dec = digits_for_symbol(sym_u)

    # 1. Check TimescaleDB/Postgres quotes hypertable
    try:
        q = c.execute(
            "SELECT bid, ask, ts FROM quotes WHERE symbol = ? AND (source IS NULL OR source != 'YAHOO_REFERENCE') ORDER BY ts DESC LIMIT 1",
            (sym_u,),
        ).fetchone()
        if q:
            q_bid = float(q["bid"] if hasattr(q, "keys") else q[0])
            q_ask = float(q["ask"] if hasattr(q, "keys") else q[1])
            q_ts = float(q["ts"] if hasattr(q, "keys") else q[2])
            if (now_ts - q_ts) <= max_age_sec and q_bid > 0:
                return round((q_bid + (q_ask if q_ask > 0 else q_bid)) / 2.0, dec)
    except Exception:
        pass

    # 2. Seamless Redis live quote stream fallback
    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        for key in (f"quote:{sym_u}:live", f"quote:{symbol}:live", "quote:XAUUSD:live" if "XAU" in sym_u else None):
            if not key:
                continue
            cached = rc.get(key)
            if cached:
                val = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
                parts = val.split(":")
                if len(parts) >= 2:
                    c_bid = float(parts[0])
                    c_ask = float(parts[1]) if len(parts) > 1 and float(parts[1]) > 0 else c_bid
                    c_ts = float(parts[2]) if len(parts) > 2 else now_ts
                    if (now_ts - c_ts) <= max_age_sec and c_bid > 0:
                        return round((c_bid + c_ask) / 2.0, dec)
    except Exception:
        pass

    return None


def get_microstructure_features(c, symbol: str = "XAUUSD", atr_14: float = 3.5) -> Dict[str, Any]:
    """Compute 4 pure-Python quantitative microstructure features from candles (< 2ms, zero LLM).
    - h1_trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    - swept_liquidity: bool (candle pierced past 20-candle Swing High/Low and closed back inside)
    - wick_ratio: float (0.0 to 1.0, rejection wick ratio over total range)
    - dist_to_swing_atr: float (distance to nearest swing high/low in multiples of ATR(14))
    """
    from app.services.symbol_mapper import canonical_symbol
    sym_u = canonical_symbol(symbol)

    default_features = {
        "h1_trend": "UNKNOWN",
        "swept_liquidity": False,
        "wick_ratio": 0.35,
        "dist_to_swing_atr": 1.25,
    }

    try:
        rows = c.execute(
            """
            SELECT open, high, low, close FROM candles
            WHERE symbol = ? AND timeframe = 'M15'
            ORDER BY time DESC LIMIT 25
            """,
            (sym_u,)
        ).fetchall()
        if not rows or len(rows) < 16:
            return default_features

        candles = [dict(r) if hasattr(r, "keys") else {"open": float(r[0]), "high": float(r[1]), "low": float(r[2]), "close": float(r[3])} for r in rows]
        latest = candles[0]
        prev_bars = candles[1:]

        # 1. H1 Trend (aggregate 4 M15 bars vs SMA of last 16 M15 bars)
        closes = [cb["close"] for cb in candles]
        sma_short = sum(closes[:4]) / 4.0
        sma_long = sum(closes[:16]) / min(len(closes), 16)
        if sma_short > sma_long * 1.0006:
            h1_trend = "BULLISH"
        elif sma_short < sma_long * 0.9994:
            h1_trend = "BEARISH"
        else:
            h1_trend = "NEUTRAL"

        # 2. Swept Liquidity (check if latest bar pierced 20-bar Swing High/Low and closed back within)
        swing_high = max(cb["high"] for cb in prev_bars)
        swing_low = min(cb["low"] for cb in prev_bars)
        swept = bool(
            (latest["high"] > swing_high and latest["close"] < swing_high) or
            (latest["low"] < swing_low and latest["close"] > swing_low)
        )

        # 3. Wick Ratio (rejection wick over total candle range)
        c_rng = max(0.00001, latest["high"] - latest["low"])
        c_body = abs(latest["close"] - latest["open"])
        wick_ratio = round(max(0.0, min(1.0, (c_rng - c_body) / c_rng)), 3)

        # 4. Distance to nearest swing in ATR(14) units
        dist_to_swing = min(abs(latest["close"] - swing_high), abs(latest["close"] - swing_low))
        safe_atr = max(0.0001, float(atr_14 or 3.5))
        dist_to_swing_atr = round(dist_to_swing / safe_atr, 2)

        return {
            "h1_trend": h1_trend,
            "swept_liquidity": swept,
            "wick_ratio": wick_ratio,
            "dist_to_swing_atr": dist_to_swing_atr,
        }
    except Exception:
        return default_features


def capture_market_context_snapshot(
    c,
    signal,
    live_price: float,
    current_time: float,
) -> Dict[str, Any]:
    """Take a full snapshot of actual market conditions when an external signal arrives."""
    session = get_trading_session(current_time)
    atr_14 = get_market_atr14(c, signal.symbol, "M15")
    news_dist_mins, news_title = get_nearest_news_info(c, current_time)
    spread_pips = get_live_spread(c, signal.symbol)
    from app.services.symbol_precision import pip_multiplier_for_symbol
    drift_pips = round(abs(live_price - signal.entry_price) * pip_multiplier_for_symbol(signal.symbol), 1)

    micro_features = get_microstructure_features(c, signal.symbol, atr_14)

    return {
        "session": session,
        "atr_14": atr_14,
        "spread_pips": spread_pips,
        "news_distance_mins": news_dist_mins,
        "nearest_news_title": news_title,
        "live_price": live_price,
        "price_drift_pips": drift_pips,
        "captured_at": current_time,
        "h1_trend": micro_features["h1_trend"],
        "swept_liquidity": micro_features["swept_liquidity"],
        "wick_ratio": micro_features["wick_ratio"],
        "dist_to_swing_atr": micro_features["dist_to_swing_atr"],
    }

