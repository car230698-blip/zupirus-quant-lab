"""Market Regime Scanner tool.
Calculates ATR(14) from historical candles and classifies active market trading session.
Purely analytical — does not open or modify trade orders.
"""
import time
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from app.db import tx


def scan_market_regime(
    symbol: str = "XAUUSD",
    current_time: Optional[float] = None,
    timeframe: str = "M15"
) -> Dict[str, Any]:
    """Scan market regime, calculate ATR(14), and determine session."""
    now_ts = current_time or time.time()
    dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    hour = dt.hour + (dt.minute / 60.0)

    # 1. Determine canonical session matching context snapshot
    from app.services.signal_ingestion.context import get_trading_session
    session = get_trading_session(now_ts)

    # 2. Query recent candles to compute ATR(14)
    atr = 3.50
    last_close = 2684.50
    candles = []

    try:
        from app.db import is_postgres
        time_cmp = "time <= to_timestamp(?)" if is_postgres() else "time <= ?"
        with tx() as c:
            rows = c.execute(
                f"""
                SELECT open, high, low, close, time
                FROM candles
                WHERE symbol = ? AND timeframe = ? AND {time_cmp}
                ORDER BY time DESC
                LIMIT 20
                """,
                (symbol, timeframe, now_ts)
            ).fetchall()
            candles = [dict(r) for r in reversed(rows)]
    except Exception:
        candles = []

    if len(candles) >= 5:
        tr_list = []
        for i in range(1, len(candles)):
            curr = candles[i]
            prev = candles[i - 1]
            h = float(curr["high"])
            l = float(curr["low"])
            prev_c = float(prev["close"])
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
            tr_list.append(tr)
        if tr_list:
            from app.services.symbol_precision import digits_for_symbol
            atr = round(sum(tr_list[-14:]) / min(len(tr_list), 14), max(2, digits_for_symbol(symbol)))
            last_close = float(candles[-1]["close"])

    # 3. Classify volatility regime (normalized to pips so FX pairs and XAUUSD use consistent pip thresholds)
    from app.services.symbol_precision import pip_size_for_symbol
    p_size = pip_size_for_symbol(symbol)
    atr_pips = (atr / p_size) if p_size > 0 else (atr * 10.0)
    if atr_pips < 20.0:
        regime = "LOW_VOLATILITY"
    elif atr_pips <= 55.0:
        regime = "NORMAL_VOLATILITY"
    elif atr_pips <= 100.0:
        regime = "HIGH_VOLATILITY"
    else:
        regime = "EXTREME_VOLATILITY"

    return {
        "symbol": symbol,
        "session": session,
        "timeframe": timeframe,
        "atr_14": atr,
        "volatility_regime": regime,
        "last_close": last_close,
        "is_safe_volatility": regime in ("NORMAL_VOLATILITY", "HIGH_VOLATILITY"),
        "timestamp": now_ts,
    }
