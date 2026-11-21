"""Real-time USD to VND exchange rate conversion service.
Supports Redis caching, automated fallback, and ceil-to-thousand rounding.
"""
import math
import time
import logging
from typing import Tuple, Optional, Union
from decimal import Decimal
import httpx

from app.config import (
    FX_RATE_PROVIDER_URL,
    FX_RATE_CACHE_TTL_SECONDS,
    FALLBACK_USD_VND_RATE,
)
from app.redis_client import get_redis_client

logger = logging.getLogger("zupirus.fx")

REDIS_FX_KEY = "fx:usd_vnd"
REDIS_FX_UPDATED_KEY = "fx:usd_vnd:updated_at"


def get_usd_vnd_rate(force_refresh: bool = False) -> Tuple[float, str, bool]:
    """Retrieve USD/VND exchange rate.
    Returns:
        (rate: float, source: str, is_cached: bool)
        source in ("API", "REDIS_CACHE", "FALLBACK")
    """
    # 0. Check Admin manual FX override stored in DB kv (billing:settings)
    try:
        import json
        from app.db import tx
        with tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key IN ('billing:settings', 'billing_settings') LIMIT 1").fetchone()
            if row and row[0]:
                cfg = json.loads(row[0])
                fx_mode = str(cfg.get("fx_mode") or "").upper()
                manual_val = float(cfg.get("manual_fx_rate") or cfg.get("fallback_usd_vnd_rate") or 0)
                if fx_mode == "MANUAL" and manual_val > 1000.0:
                    return manual_val, "ADMIN_MANUAL", False
    except Exception:
        pass

    redis_cli = None
    try:
        redis_cli = get_redis_client()
    except Exception as e:
        logger.debug(f"Redis not available for FX caching: {e}")

    # 1. Try reading from Redis cache if not forced
    if redis_cli and not force_refresh:
        try:
            cached_val = redis_cli.get(REDIS_FX_KEY)
            if cached_val:
                rate = float(cached_val.decode() if isinstance(cached_val, bytes) else cached_val)
                if rate > 1000.0:
                    return rate, "REDIS_CACHE", True
        except Exception as e:
            logger.warning(f"Error reading FX cache from Redis: {e}")

    # 2. Try fetching from live FX rate provider
    if FX_RATE_PROVIDER_URL:
        try:
            with httpx.Client(timeout=4.0) as client:
                res = client.get(FX_RATE_PROVIDER_URL)
                if res.status_code == 200:
                    data = res.json()
                    # Handles various open formats (exchangerate-api, open.er-api, etc.)
                    rates = data.get("rates") or data.get("conversion_rates") or {}
                    vnd_rate = rates.get("VND")
                    if vnd_rate and float(vnd_rate) > 1000.0:
                        rate = float(vnd_rate)
                        now_ts = time.time()
                        # Cache in Redis
                        if redis_cli:
                            try:
                                if hasattr(redis_cli, "setex"):
                                    redis_cli.setex(REDIS_FX_KEY, FX_RATE_CACHE_TTL_SECONDS, str(rate))
                                    redis_cli.setex(REDIS_FX_UPDATED_KEY, FX_RATE_CACHE_TTL_SECONDS, str(now_ts))
                                else:
                                    redis_cli.set(REDIS_FX_KEY, str(rate), ex=FX_RATE_CACHE_TTL_SECONDS)
                                    redis_cli.set(REDIS_FX_UPDATED_KEY, str(now_ts), ex=FX_RATE_CACHE_TTL_SECONDS)
                            except Exception as ex:
                                logger.warning(f"Could not cache FX rate in Redis: {ex}")
                        logger.info(f"Updated live USD/VND FX rate: {rate:,.1f}")
                        return rate, "API", False
        except Exception as e:
            logger.warning(f"Failed to fetch live FX rate from {FX_RATE_PROVIDER_URL}: {e}")

    # 3. Fallback rate
    logger.info(f"Using fallback USD/VND rate: {FALLBACK_USD_VND_RATE}")
    return FALLBACK_USD_VND_RATE, "FALLBACK", False


def convert_usd_to_vnd(usd_amount: Union[float, Decimal], rate: Optional[float] = None) -> int:
    """Convert a USD dollar amount into VND integer, rounded up to the nearest 1,000 VND."""
    if rate is None:
        rate, _, _ = get_usd_vnd_rate()
    amount_vnd = float(usd_amount) * rate
    # Ceil to the next multiple of 1,000 VND
    return int(math.ceil(amount_vnd / 1000.0) * 1000)
