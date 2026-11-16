"""Signal inspection, telemetry, and audit logs endpoints."""
import time
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from app.db import tx
from app.routers.deps import get_current_user, get_current_admin
from app.config import (
    SIGNAL_SOURCE,
    AUTO_ATTACH_ATR_SL,
    MAX_ENTRY_SLIPPAGE_PIPS,
    NEWS_SHIELD_MINUTES,
)
import re
import secrets
from app.schemas.signals import TradingViewWebhookPayload, TestIngestPayload, NormalizedSignalSchema
from app.services.signal_ingestion.normalizer import normalize_tradingview_signal
from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal

router = APIRouter(prefix="/api/v1/signals", tags=["signals"])


class SignalConfigUpdate(BaseModel):
    signal_source: str


@router.get("/config")
def get_signal_pipeline_config(admin=Depends(get_current_admin)):
    """Admin: Get current signal pipeline configurations and active source."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'signal_source'").fetchone()
        active_source = row[0] if row else SIGNAL_SOURCE

    return {
        "signal_source": active_source,
        "auto_attach_atr_sl": AUTO_ATTACH_ATR_SL,
        "max_entry_slippage_pips": MAX_ENTRY_SLIPPAGE_PIPS,
        "news_shield_minutes": NEWS_SHIELD_MINUTES,
    }


@router.post("/config")
def set_signal_pipeline_config(p: SignalConfigUpdate, admin=Depends(get_current_admin)):
    """Admin: Switch active signal source (EXTERNAL_FEED | HYBRID_AGENT_SCORER | ZUPIRUS_AGENT)."""
    valid_sources = ("EXTERNAL_FEED", "HYBRID_AGENT_SCORER", "ZUPIRUS_AGENT")
    clean = p.signal_source.strip().upper()
    if clean not in valid_sources:
        raise HTTPException(status_code=400, detail=f"Invalid signal source. Must be one of {valid_sources}")

    with tx() as c:
        c.execute("INSERT INTO kv(key, value) VALUES('signal_source', ?) ON CONFLICT(key) DO UPDATE SET value = ?", (clean, clean))

    return {"ok": True, "signal_source": clean}


@router.get("/audit-logs")
def get_signal_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    status: Optional[str] = Query(default=None),
    admin=Depends(get_current_admin),
):
    """Admin: Query recent signal audit logs to review 4 safety guard decisions."""
    with tx() as c:
        if status:
            rows = c.execute(
                """
                SELECT * FROM signal_audit_logs
                WHERE status = ?
                ORDER BY created_at DESC LIMIT ?
                """,
                (status.upper(), limit)
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT * FROM signal_audit_logs
                ORDER BY created_at DESC LIMIT ?
                """,
                (limit,)
            ).fetchall()

        return {"logs": [dict(r) for r in rows]}


@router.get("/stats")
def get_signal_stats(admin=Depends(get_current_admin)):
    """Admin: Aggregate metrics on signal ingestion and rejection rates."""
    with tx() as c:
        total = c.execute("SELECT count(*) FROM signal_audit_logs").fetchone()[0]
        approved = c.execute("SELECT count(*) FROM signal_audit_logs WHERE status = 'APPROVED'").fetchone()[0]
        rejected = c.execute("SELECT count(*) FROM signal_audit_logs WHERE status = 'REJECTED'").fetchone()[0]

        reasons = c.execute(
            """
            SELECT reject_reason, count(*) as cnt
            FROM signal_audit_logs
            WHERE status = 'REJECTED' AND reject_reason IS NOT NULL
            GROUP BY reject_reason
            ORDER BY cnt DESC LIMIT 5
            """
        ).fetchall()

        return {
            "total_signals_received": total,
            "approved_signals": approved,
            "rejected_signals": rejected,
            "approval_rate_percent": round((approved / total * 100.0), 1) if total > 0 else 100.0,
            "top_rejection_reasons": [
                {"reason": r[0], "count": r[1]} for r in reasons
            ]
        }


def _parse_raw_signal_text(text: str, default_price: float = 2900.0):
    t = text.strip()
    upper_t = t.upper()

    action = "BUY"
    if "SELL" in upper_t:
        action = "SELL"
    elif "BUY" in upper_t:
        action = "BUY"

    symbol = "XAUUSD"
    if "GOLD" in upper_t or "XAU" in upper_t:
        symbol = "XAUUSD"

    # Match price: e.g. "BUY 2900.5" or "@ 2900" or "ENTRY 2900" or "NOW 2900"
    price = default_price
    m_price = re.search(r"(?:BUY|SELL|ENTRY|AT|PRICE|NOW)\s*([0-9]{4}(?:\.[0-9]+)?)", upper_t)
    if m_price:
        try:
            price = float(m_price.group(1))
        except ValueError:
            pass

    # Match TP: e.g. "TP 2880" or "TP1 2880" or "TP: 2880"
    tp = None
    m_tp = re.search(r"TP[1-3]?\s*[:=]?\s*([0-9]{4}(?:\.[0-9]+)?)", upper_t)
    if m_tp:
        try:
            tp = float(m_tp.group(1))
        except ValueError:
            pass

    # Match SL: e.g. "SL 2915" or "SL: 2915"
    sl = None
    m_sl = re.search(r"SL\s*[:=]?\s*([0-9]{4}(?:\.[0-9]+)?)", upper_t)
    if m_sl:
        try:
            sl = float(m_sl.group(1))
        except ValueError:
            pass

    return action, symbol, price, sl, tp


@router.post("/test-ingest")
def test_ingest_signal(p: TestIngestPayload, admin=Depends(get_current_admin)):
    """Admin & CLI: Test signal ingestion through all 4 safety guards without executing real trades."""
    now_ts = time.time()

    # Get fresh market price from quotes table
    live_price = 2900.0
    with tx() as c:
        q = c.execute("SELECT bid, ask FROM quotes ORDER BY ts DESC LIMIT 1").fetchone()
        if q:
            live_price = round((float(q["bid"]) + float(q["ask"])) / 2.0, 2)

    if p.raw_message:
        action, symbol, entry_p, sl, tp = _parse_raw_signal_text(p.raw_message, default_price=live_price)
        norm_signal = NormalizedSignalSchema(
            id=f"test_{secrets.token_hex(4)}",
            source=p.source or "ADMIN_TEST_BENCH",
            strategy_tier=p.strategy or "STANDARD",
            symbol=symbol,
            action=action,
            entry_price=entry_p,
            stop_loss=sl,
            take_profit=tp,
            created_at=now_ts,
            raw_payload={"raw_message": p.raw_message},
        )
    else:
        # Fall back to structured parameters
        action = (p.action or "BUY").upper()
        if action not in ("BUY", "SELL"):
            action = "BUY"
        entry_price = float(p.price or p.entry_price or live_price)
        norm_signal = NormalizedSignalSchema(
            id=f"test_{secrets.token_hex(4)}",
            source=p.source or "ADMIN_TEST_BENCH",
            strategy_tier=p.strategy or "STANDARD",
            symbol=p.symbol or p.ticker or "XAUUSD",
            action=action,
            entry_price=entry_price,
            stop_loss=p.sl or p.stop_loss,
            take_profit=p.tp or p.take_profit,
            created_at=now_ts,
            raw_payload={"source": p.source},
        )

    approved, reject_reason, sanitized = sanitize_and_audit_signal(
        signal=norm_signal,
        live_price=live_price,
        current_time=now_ts,
    )

    return {
        "status": "APPROVED" if approved else "REJECTED",
        "signal_id": sanitized.id,
        "symbol": sanitized.symbol,
        "action": sanitized.action,
        "entry_price": sanitized.entry_price,
        "stop_loss": sanitized.stop_loss,
        "take_profit": sanitized.take_profit,
        "live_price": live_price,
        "reject_reason": reject_reason,
    }


