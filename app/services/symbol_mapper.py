"""Symbol mapping utility for standardizing market symbols.
Used by market data ingestion and quantitative research models.
"""

STANDARD_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"]

def canonical_symbol(symbol: str) -> str:
    """Normalize market symbol (e.g. XAUUSDm, GOLD, EURUSD.ecn) to canonical form."""
    s = str(symbol or "XAUUSD").strip().upper()
    for sep in (".", "_", "-"):
        if sep in s:
            s = s.split(sep, 1)[0]
    if s.startswith("GOLD"):
        return "XAUUSD"
    if s.startswith("SILVER"):
        return "XAGUSD"
    for base in ("XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "US30", "NAS100", "SPX500", "DE40",
                 "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
                 "EURJPY", "GBPJPY", "EURGBP", "AUDCAD", "GBPAUD", "EURCHF"):
        if s == base or (s.startswith(base) and len(s) - len(base) <= 2):
            return base
    return s
