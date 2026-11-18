"""Symbol-aware price precision, pip size, and USD quote conversion helpers."""


def digits_for_symbol(symbol: str) -> int:
    """Return standard broker price decimal places for Gold, Crypto, Indices, JPY pairs, and 5-digit FX."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if "JPY" in sym_u:
        return 3
    if any(k in sym_u for k in ("XAU", "GOLD", "XAG", "SILVER", "US30", "NAS100", "SPX", "DE40", "BTC", "ETH")):
        return 2
    return 5


def pip_size_for_symbol(symbol: str) -> float:
    """Return 1 pip price movement for Crypto/Indices (1.0), Gold/Silver (0.1), JPY pairs (0.01), and FX (0.0001)."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if any(k in sym_u for k in ("BTC", "ETH", "US30", "NAS100", "SPX", "DE40")):
        return 1.0
    if "JPY" in sym_u:
        return 0.01
    if any(k in sym_u for k in ("XAU", "GOLD", "XAG", "SILVER")):
        return 0.1
    return 0.0001


def pip_multiplier_for_symbol(symbol: str) -> float:
    """Return multiplier to convert raw price delta into pips."""
    return 1.0 / pip_size_for_symbol(symbol)


def point_size_for_symbol(symbol: str) -> float:
    """Return 1 broker point (tick) price increment for a symbol."""
    return 10.0 ** (-digits_for_symbol(symbol))


def contract_size_for_symbol(symbol: str, is_cent: bool = False, account_contract_size: float = 100.0) -> float:
    """Return standard 1.0-lot contract size for metals, crypto, indices, and FX."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if "XAU" in sym_u or "GOLD" in sym_u:
        if is_cent:
            return 1.0
        return float(account_contract_size) if account_contract_size and account_contract_size > 1.0 else 100.0
    if "XAG" in sym_u or "SILVER" in sym_u:
        return 50.0 if is_cent else 5000.0
    if any(k in sym_u for k in ("BTC", "ETH", "US30", "NAS100", "SPX", "DE40")):
        return 1.0
    return 1000.0 if is_cent else 100000.0


def _lookup_quote_mid(symbol: str) -> float:
    try:
        from app.db import tx
        with tx() as c:
            q = c.execute(
                "SELECT bid, ask FROM quotes WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
                (symbol,),
            ).fetchone()
            if q and q[0] and q[1]:
                return (float(q[0]) + float(q[1])) / 2.0
    except Exception:
        pass
    return 0.0


_FALLBACK_USD_RATES = {
    "EUR": 1.08,
    "GBP": 1.27,
    "AUD": 0.65,
    "NZD": 0.60,
    "CAD": 1.0 / 1.39,
    "CHF": 1.0 / 0.88,
    "JPY": 1.0 / 150.0,
}


def quote_to_usd_rate(symbol: str, price: float = 0.0, usdjpy_rate: float | None = None) -> float:
    """Convert 1 unit of quote currency PnL into USD (handles XAU, USD-quote, USD-base, JPY, and FX crosses)."""
    sym_u = str(symbol or "XAUUSD").strip().upper()
    if "DE40" in sym_u:
        eur_rate = _lookup_quote_mid("EURUSD")
        return eur_rate if eur_rate > 0 else _FALLBACK_USD_RATES["EUR"]
    if sym_u.endswith("USD") or any(k in sym_u for k in ("XAU", "GOLD", "XAG", "SILVER", "BTC", "ETH", "US30", "NAS100", "SPX")):
        return 1.0
    if sym_u.startswith("USD") and price and price > 0:
        return 1.0 / float(price)
    if sym_u.endswith("JPY") or "JPY" in sym_u:
        if sym_u == "USDJPY" and price and price > 0:
            return 1.0 / float(price)
        jpy_rate = float(usdjpy_rate) if usdjpy_rate and usdjpy_rate > 0 else _lookup_quote_mid("USDJPY")
        return 1.0 / (jpy_rate if jpy_rate > 0 else 150.0)
    if len(sym_u) >= 6:
        quote_ccy = sym_u[3:6]
        direct = _lookup_quote_mid(f"{quote_ccy}USD")
        if direct > 0:
            return direct
        inv = _lookup_quote_mid(f"USD{quote_ccy}")
        if inv > 0:
            return 1.0 / inv
        if quote_ccy in _FALLBACK_USD_RATES:
            return _FALLBACK_USD_RATES[quote_ccy]
    return 1.0
