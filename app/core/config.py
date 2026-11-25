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
SEPAY_WEBHOOK_SECRET = os.getenv("SEPAY_WEBHOOK_SECRET", "")
SEPAY_BANK_NAME = os.getenv("SEPAY_BANK_NAME", "VietinBank")
SEPAY_ACCOUNT_NUMBER = os.getenv("SEPAY_ACCOUNT_NUMBER", "105887054819")
SEPAY_ACCOUNT_HOLDER = os.getenv("SEPAY_ACCOUNT_HOLDER", "LE NGUYEN NHU THUY")
CLOUD_SLOT_MONTHLY_USD = 10.0
TIER_STARTER_MONTHLY_USD = 25.0
TIER_GROWTH_MONTHLY_USD = 39.0
TIER_ALPHA_MONTHLY_USD = 59.0
ORDER_LOCK_MINUTES = 20


def is_customer_auto_trading_enabled(db_cursor=None) -> bool:
    """Determine whether customer auto-trading, MetaApi client dispatch, and copy trade are enabled.
    In production, this is HARD-LOCKED TO FALSE with zero configuration bypass to strictly enforce the pivot
    to ZUPIRUS Quant Lab (research reports & PDF sales only).
    Only legacy test harnesses running in non-production environments may temporarily simulate legacy execution."""
    app_env = os.getenv("APP_ENV", "dev").strip().lower()
    in_pytest = bool(os.getenv("PYTEST_CURRENT_TEST"))
    if app_env in ("production", "prod") and not in_pytest:
        return False

    env_val = os.getenv("ENABLE_LEGACY_CUSTOMER_EXECUTION", "").strip().lower()
    if env_val in ("1", "true", "yes"):
        return True
    if env_val in ("0", "false", "no"):
        return False
    try:
        if db_cursor is not None:
            row = db_cursor.execute("SELECT value FROM kv WHERE key = 'ENABLE_LEGACY_CUSTOMER_EXECUTION'").fetchone()
            if row and str(row[0]).strip().lower() in ("1", "true", "yes"):
                return True
        else:
            from app.db import tx
            with tx() as c:
                row = c.execute("SELECT value FROM kv WHERE key = 'ENABLE_LEGACY_CUSTOMER_EXECUTION'").fetchone()
                if row and str(row[0]).strip().lower() in ("1", "true", "yes"):
                    return True
    except Exception:
        pass
    return False


def is_commercial_reports_sale_enabled() -> bool:
    """Determine whether public checkout orders are enabled for commercial research reports.
    Defaults to False to prevent selling unvetted seed/sample reports until admin publishes real commercial PDFs."""
    val = os.getenv("COMMERCIAL_REPORTS_SALE_ENABLED", "").strip().lower()
    return val in ("1", "true", "yes")


