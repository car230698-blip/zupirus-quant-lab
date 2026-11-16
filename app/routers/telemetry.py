"""Global Top Telemetry Bar API Endpoint for app.zupirus.com and adm.zupirus.com."""
import time
import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter

from app.db import tx
from app.services.fx_rate import get_usd_vnd_rate
from app.services.signal_ingestion.context import get_nearest_news_info
from app.services.sources.curator import count_active_sources, get_sources_counts

logger = logging.getLogger("zupirus.telemetry")

router = APIRouter(prefix="/api/v1/telemetry", tags=["Telemetry"])


def get_live_xauusd_quote() -> Dict[str, Any]:
    """Retrieve real-time XAUUSD quote strictly from authentic market sources:
    1. Redis live quote cache (updated by MetaApi streamer)
    2. TimescaleDB/Postgres latest quote tick
    3. TimescaleDB/Postgres latest M1/M15 candle
    Returns data_available=False if no authentic market data is reachable (no synthetic PAXG or fake constants).
    """
    now_ts = time.time()

    # 1. Redis live stream quote check
    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        cached = rc.get("quote:XAUUSD:live")
        if cached:
            val_str = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
            parts = val_str.split(":")
            if len(parts) >= 2:
                bid, ask = float(parts[0]), float(parts[1])
                spread_pips = round(max(abs(ask - bid), 0.10) * 10, 1)
                return {
                    "bid": bid,
                    "ask": ask,
                    "mid": round((bid + ask) / 2, 2),
                    "spread_pips": spread_pips,
                    "live": True,
                    "data_available": True,
                    "stale": False,
                    "source": "REDIS_STREAM",
                }
    except Exception:
        pass

    # 2. Database quotes check (from MetaApi real quotes stream)
    try:
        with tx() as c:
            q_row = c.execute(
                "SELECT bid, ask, ts FROM quotes WHERE symbol = 'XAUUSD' ORDER BY ts DESC LIMIT 1"
            ).fetchone()
            if q_row and q_row[0] and q_row[1]:
                bid = float(q_row[0])
                ask = float(q_row[1])
                quote_ts = float(q_row[2]) if q_row[2] else 0.0
                age_seconds = now_ts - quote_ts
                is_stale = age_seconds > 180.0  # Older than 3 minutes
                spread_pips = round(max(abs(ask - bid), 0.10) * 10, 1)
                return {
                    "bid": bid,
                    "ask": ask,
                    "mid": round((bid + ask) / 2, 2),
                    "spread_pips": spread_pips,
                    "live": not is_stale,
                    "data_available": True,
                    "stale": is_stale,
                    "source": "DB_QUOTES",
                    "age_seconds": round(age_seconds, 1),
                }

            # 3. Fallback to latest closed candle
            c_row = c.execute(
                "SELECT close, time FROM candles WHERE symbol = 'XAUUSD' ORDER BY time DESC LIMIT 1"
            ).fetchone()
            if c_row and c_row[0]:
                close_p = float(c_row[0])
                candle_ts = float(c_row[1]) if c_row[1] else 0.0
                age_seconds = now_ts - candle_ts
                bid = close_p
                ask = close_p
                return {
                    "bid": bid,
                    "ask": ask,
                    "mid": close_p,
                    "spread_pips": 0.0,
                    "live": False,
                    "data_available": True,
                    "stale": True,
                    "source": "DB_CANDLE_FALLBACK",
                    "age_seconds": round(age_seconds, 1),
                }
    except Exception as e:
        logger.debug(f"DB quote read error: {e}")

    # No authentic quote available
    return {
        "bid": None,
        "ask": None,
        "mid": None,
        "spread_pips": None,
        "live": False,
        "data_available": False,
        "stale": True,
        "source": "NONE",
    }


@router.get("/topbar")
def get_topbar_telemetry():
    """Retrieve unified telemetry for the live header bar:
    - Live XAUUSD price and spread from TimescaleDB / MetaApi / Market Stream
    - USD/VND rate
    - High-impact USD News Shield countdown & state (aligned with 15m blackout)
    - MetaApi London G2 terminal latency
    - Active live and shadow signal sources count
    """
    now_ts = time.time()

    # 1. USD/VND Rate
    rate, source, _ = get_usd_vnd_rate()

    # 2. XAUUSD Live Market Quote
    quote = get_live_xauusd_quote()

    # 3. News Shield info (Blackout threshold 15 minutes, Warning 60 minutes)
    news_dist_mins, nearest_title = 999.0, None
    try:
        with tx() as c:
            news_dist_mins, nearest_title = get_nearest_news_info(c, now_ts)
    except Exception as e:
        logger.debug(f"Telemetry News Shield error: {e}")

    # Determine News Shield state
    news_status = "CLEAR"
    if news_dist_mins <= 15.0:
        news_status = "BLACKOUT"
    elif news_dist_mins <= 60.0:
        news_status = "WARNING"

    # Signal sources counts
    sources_counts = {"active_live": 0, "shadow_only": 0}
    try:
        sources_counts = get_sources_counts()
    except Exception:
        try:
            sources_counts["active_live"] = count_active_sources()
        except Exception:
            pass

    # 4. Measure real Redis & DB latency and query average MetaApi execution latency
    redis_ok = False
    redis_ping_ms = 0.0
    try:
        from app.redis_client import get_redis_client
        t_r = time.perf_counter()
        rc = get_redis_client()
        redis_ok = bool(rc.ping())
        redis_ping_ms = round((time.perf_counter() - t_r) * 1000.0, 2)
    except Exception:
        pass

    db_ping_ms = 0.0
    avg_exec_lat_ms = 0
    is_halted = False
    try:
        t_db = time.perf_counter()
        with tx() as c:
            c.execute("SELECT 1").fetchone()
            db_ping_ms = round((time.perf_counter() - t_db) * 1000.0, 2)
            lat_row = c.execute(
                "SELECT AVG(latency_ms) FROM metaapi_trade_executions WHERE latency_ms > 0"
            ).fetchone()
            if lat_row and lat_row[0]:
                avg_exec_lat_ms = int(round(float(lat_row[0])))
            h_row = c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()
            if h_row and str(h_row[0]).strip() in ("1", "true", "True"):
                is_halted = True
    except Exception:
        pass

    spread_val = quote.get("spread_pips")
    spread_ok = spread_val is not None and float(spread_val) <= 4.5
    shields = [
        {
            "layer": "L1",
            "name": "Chống Lặp Tín Hiệu (Idempotency Lock)",
            "detail": f"Redis + DB Lock ({redis_ping_ms}ms)" if redis_ok else "DB Atomic Lock Fallback",
            "status": "ACTIVE" if not is_halted else "HALTED",
            "latency_ms": redis_ping_ms,
        },
        {
            "layer": "L2",
            "name": "Bắt Buộc SL & Kiểm Soát Spread",
            "detail": f"ATR(14) Auto-SL · Spread {spread_val}p" if spread_val is not None else "ATR(14) Auto-SL · Chờ giá live",
            "status": "ACTIVE" if spread_ok else ("WARNING" if spread_val is not None else "IDLE"),
            "latency_ms": db_ping_ms,
        },
        {
            "layer": "L3",
            "name": "Lá Chắn Tin Đỏ USD (News Shield)",
            "detail": (
                f"ĐANG CHẶN ({nearest_title})" if news_status == "BLACKOUT"
                else (f"Cảnh báo sau {round(news_dist_mins)}p ({nearest_title})" if news_status == "WARNING" else "Không có tin đỏ ±15p")
            ),
            "status": "BLOCKED" if news_status == "BLACKOUT" else ("WARNING" if news_status == "WARNING" else "ACTIVE"),
            "latency_ms": db_ping_ms,
        },
        {
            "layer": "L4",
            "name": "Kiểm Soát Trượt Giá (Slippage Guard)",
            "detail": "Biên độ khớp tối đa ≤ 20 pips ($2.00)",
            "status": "ACTIVE" if quote.get("live") else "STANDBY",
            "latency_ms": avg_exec_lat_ms or int(round(db_ping_ms + redis_ping_ms)),
        },
    ]

    return {
        "xauusd": {
            "symbol": "XAUUSD",
            "bid": quote["bid"],
            "ask": quote["ask"],
            "mid": quote["mid"],
            "spread_pips": quote["spread_pips"],
            "live": quote.get("live", False),
            "data_available": quote.get("data_available", False),
            "stale": quote.get("stale", True),
            "source": quote.get("source", "NONE"),
        },
        "usd_vnd": {
            "rate": rate,
            "source": source,
        },
        "news_shield": {
            "status": news_status,
            "distance_mins": round(news_dist_mins, 1),
            "nearest_title": nearest_title,
        },
        "shields": shields,
        "redis_ping_ms": redis_ping_ms,
        "db_ping_ms": db_ping_ms,
        "metaapi_latency_ms": avg_exec_lat_ms if avg_exec_lat_ms > 0 else int(round(db_ping_ms + redis_ping_ms)),
        "region": "London G2",
        "active_sources_count": sources_counts.get("active_live", 0),
        "shadow_sources_count": sources_counts.get("shadow_only", 0),
        "system_status": "HALTED" if is_halted else "OPERATIONAL",
        "server_time": now_ts,
    }

