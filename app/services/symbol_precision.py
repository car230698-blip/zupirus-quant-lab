"""Symbol-aware price precision, pip size, and USD quote conversion helpers."""


def digits_for_symbol(symbol: str) -> int:
    """Return standard broker price decimal places for Gold, JPY pairs, and 5-digit FX."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if "JPY" in sym_u:
        return 3
    if any(k in sym_u for k in ("XAU", "GOLD", "XAG", "SILVER", "US30", "NAS100", "SPX", "BTC")):
        return 2
    return 5


def pip_size_for_symbol(symbol: str) -> float:
    """Return 1 pip price movement for Gold (0.1), JPY pairs (0.01), and 4/5-digit FX (0.0001)."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if "JPY" in sym_u:
        return 0.01
    if any(k in sym_u for k in ("XAU", "GOLD", "XAG", "SILVER")):
        return 0.1
    return 0.0001


def pip_multiplier_for_symbol(symbol: str) -> float:
    """Return multiplier to convert raw price delta into pips."""
    return 1.0 / pip_size_for_symbol(symbol)


def quote_to_usd_rate(symbol: str, price: float = 0.0, usdjpy_rate: float | None = None) -> float:
    """Convert 1 unit of quote currency PnL into USD (handles XAU, USD-quote, USDJPY, and JPY crosses)."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if sym_u.endswith("USD") or "XAU" in sym_u:
        return 1.0
    if sym_u.startswith("USD") and price and price > 0:
        return 1.0 / float(price)
    if sym_u.endswith("JPY") or "JPY" in sym_u:
        if sym_u == "USDJPY" and price and price > 0:
            return 1.0 / float(price)
        jpy_rate = float(usdjpy_rate) if usdjpy_rate and usdjpy_rate > 0 else 0.0
        if jpy_rate <= 0:
            try:
                from app.db import tx
                with tx() as c:
                    q = c.execute(
                        "SELECT bid, ask FROM quotes WHERE symbol = 'USDJPY' ORDER BY ts DESC LIMIT 1"
                    ).fetchone()
                    if q and q[0] and q[1]:
                        jpy_rate = (float(q[0]) + float(q[1])) / 2.0
            except Exception:
                jpy_rate = 0.0
        return 1.0 / (jpy_rate if jpy_rate > 0 else 150.0)
    return 1.0
