"""Market context capture and feature extraction for Tabula Rasa observational learning.
Captures real-time market snapshots whenever an external signal is ingested.
"""
import time
import math
import datetime
from typing import Dict, Any, Optional, Tuple


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
    try:
        rows = c.execute(
            """
            SELECT high, low, close FROM candles
            WHERE symbol = ? AND timeframe = ?
            ORDER BY time DESC LIMIT 15
            """,
            (symbol, timeframe)
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
                return round(sum(trs) / len(trs), digits_for_symbol(symbol))
    except Exception:
        pass
    return 3.50  # Default institutional ATR on XAUUSD (~35 pips)


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

    return {
        "session": session,
        "atr_14": atr_14,
        "spread_pips": spread_pips,
        "news_distance_mins": news_dist_mins,
        "nearest_news_title": news_title,
        "live_price": live_price,
        "price_drift_pips": drift_pips,
        "captured_at": current_time,
    }

