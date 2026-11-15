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
TRADINGVIEW_WEBHOOK_SECRET = os.getenv("TRADINGVIEW_WEBHOOK_SECRET", "zupirus_tv_secret_2026")
METAAPI_SIGNAL_FEED_ACCOUNT_ID = os.getenv("METAAPI_SIGNAL_FEED_ACCOUNT_ID", "")

# 4 Mandatory Safety Guards Configuration
AUTO_ATTACH_ATR_SL = os.getenv("AUTO_ATTACH_ATR_SL", "true").lower() in ("true", "1", "yes")
MAX_CONCURRENT_TRADES_PER_ACCOUNT = int(os.getenv("MAX_CONCURRENT_TRADES_PER_ACCOUNT", "2"))
MAX_ENTRY_SLIPPAGE_PIPS = float(os.getenv("MAX_ENTRY_SLIPPAGE_PIPS", "20.0"))
NEWS_SHIELD_MINUTES = int(os.getenv("NEWS_SHIELD_MINUTES", "15"))

# Pricing & Billing Configuration (USD)
SEPAY_WEBHOOK_SECRET = os.getenv("SEPAY_WEBHOOK_SECRET", "")
CLOUD_SLOT_MONTHLY_USD = 10.0
TIER_STARTER_MONTHLY_USD = 20.0
TIER_GROWTH_MONTHLY_USD = 35.0
TIER_ALPHA_MONTHLY_USD = 49.0
ORDER_LOCK_MINUTES = 20
