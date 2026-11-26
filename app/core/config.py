"""Application configuration settings for ZUPIRUS Quant Lab.
Defines environment-driven parameters for FX rate conversion, signal ingestion, and safety limits.
"""
import os
from typing import Literal

# Real-Time FX Rate Configuration
FX_RATE_PROVIDER_URL = os.getenv(
    "FX_RATE_PROVIDER_URL",
    "https://api.exchangerate-api.com/v4/latest/USD"
)
FX_RATE_CACHE_TTL_SECONDS = int(os.getenv("FX_RATE_CACHE_TTL_SECONDS", "7200"))
FALLBACK_USD_VND_RATE = float(os.getenv("FALLBACK_USD_VND_RATE", "25500.0"))

# Signal Source & Ingestion Pipeline
SignalSourceType = Literal["EXTERNAL_FEED", "HYBRID_AGENT_SCORER", "ZUPIRUS_AGENT"]
SIGNAL_SOURCE: SignalSourceType = os.getenv("SIGNAL_SOURCE", "EXTERNAL_FEED") # type: ignore
TRADINGVIEW_WEBHOOK_SECRET = os.getenv("TRADINGVIEW_WEBHOOK_SECRET", "")

# 4 Mandatory Safety Guards Configuration
AUTO_ATTACH_ATR_SL = os.getenv("AUTO_ATTACH_ATR_SL", "true").lower() in ("true", "1", "yes")
MAX_CONCURRENT_TRADES_PER_ACCOUNT = int(os.getenv("MAX_CONCURRENT_TRADES_PER_ACCOUNT", "2"))
MAX_ENTRY_SLIPPAGE_PIPS = float(os.getenv("MAX_ENTRY_SLIPPAGE_PIPS", "20.0"))
NEWS_SHIELD_MINUTES = int(os.getenv("NEWS_SHIELD_MINUTES", "15"))

# Pricing & Billing Configuration (USD)
CLOUD_SLOT_MONTHLY_USD = 10.0
TIER_STARTER_MONTHLY_USD = 25.0
TIER_GROWTH_MONTHLY_USD = 39.0
TIER_ALPHA_MONTHLY_USD = 59.0
ORDER_LOCK_MINUTES = 20


def is_customer_auto_trading_enabled(db_cursor=None) -> bool:
    """Determine whether customer auto-trading, MetaApi client dispatch, and copy trade are enabled.
    In ZUPIRUS Quant Lab, customer auto-trading and MT5 broker execution are permanently decommissioned.
    Returns False unconditionally with zero configuration bypass."""
    return False


def is_commercial_reports_sale_enabled() -> bool:
    """Determine whether public checkout orders are enabled for commercial research reports.
    Defaults to False to prevent selling unvetted seed/sample reports until admin publishes real commercial PDFs."""
    val = os.getenv("COMMERCIAL_REPORTS_SALE_ENABLED", "").strip().lower()
    return val in ("1", "true", "yes")


def is_usdt_payment_enabled(db_cursor=None) -> bool:
    """Determine whether on-chain USDT direct payment is enabled.
    Strictly isolated from commercial report sales flag: commercial sales may be enabled
    while USDT remains locked, and vice versa. Defaults to False."""
    env_val = os.getenv("PAYMENT_USDT_ENABLED", "").strip().lower()
    if env_val in ("1", "true", "yes"):
        return True
    if env_val in ("0", "false", "no"):
        return False
    try:
        if db_cursor is not None:
            row = db_cursor.execute("SELECT value FROM kv WHERE key = 'billing:crypto_wallets'").fetchone()
        else:
            from app.db import tx
            with tx() as c:
                row = c.execute("SELECT value FROM kv WHERE key = 'billing:crypto_wallets'").fetchone()
        if row and row[0]:
            import json
            cfg = json.loads(row[0])
            if isinstance(cfg, dict):
                return bool(cfg.get("enabled", False))
    except Exception:
        pass
    return False


