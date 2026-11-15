"""ZUPIRUS 4 Mandatory Safety Guards & Signal Sanitizer.
Ensures zero-compromise risk management for all ingested signals:
1. Mandatory Stop Loss & Anti-Martingale
2. News Shield (±15 min USD High-Impact)
3. Entry Slippage Guard
4. Redis Deduplication
"""
import time
import json
import hashlib
import logging
from typing import Tuple, Optional
from app.db import tx
from app.config import (
    AUTO_ATTACH_ATR_SL,
    MAX_ENTRY_SLIPPAGE_PIPS,
    NEWS_SHIELD_MINUTES,
)
from app.schemas.signals import NormalizedSignalSchema
from app.redis_client import get_redis_client

logger = logging.getLogger("zupirus.sanitizer")


def check_mandatory_sl(signal: NormalizedSignalSchema, current_price: float) -> Tuple[bool, Optional[str], NormalizedSignalSchema]:
    """Guard 1: Mandatory SL and auto-attach ATR SL if missing."""
    if signal.stop_loss is not None:
        return True, None, signal

    if not AUTO_ATTACH_ATR_SL:
        return False, "REJECTED_MISSING_STOP_LOSS: Signal lacks stop loss and auto-attach is disabled", signal

    # Auto attach default ATR-based stop loss (35 pips / $3.50 on Gold)
    atr_points = 3.50
    sl_price = current_price - atr_points if signal.action == "BUY" else current_price + atr_points
    signal.stop_loss = round(sl_price, 2)
    logger.info(f"Guard 1 [Auto-Attached SL]: Signal {signal.id} set SL={signal.stop_loss}")
    return True, None, signal


def check_news_shield(current_time: float) -> Tuple[bool, Optional[str]]:
    """Guard 2: Block signals during USD High-Impact economic news window (±15 mins)."""
    window_sec = NEWS_SHIELD_MINUTES * 60
    with tx() as c:
        row = c.execute(
            """
            SELECT title, currency FROM news
            WHERE lower(impact) = 'high' AND upper(currency) IN ('USD', 'ALL')
            AND ts >= ? AND ts <= ?
            LIMIT 1
            """,
            (current_time - window_sec, current_time + window_sec)
        ).fetchone()

        if row:
            event_name = row["title"] if isinstance(row, dict) and "title" in row else row[0]
            reason = f"REJECTED_NEWS_SHIELD: High-Impact USD event '{event_name}' within ±{NEWS_SHIELD_MINUTES}m"
            logger.warning(reason)
            return False, reason

    return True, None


def check_entry_slippage(signal: NormalizedSignalSchema, live_price: float) -> Tuple[bool, Optional[str]]:
    """Guard 3: Reject signal if market price has drifted beyond allowable slippage."""
    slippage_usd = abs(live_price - signal.entry_price)
    # 1 pip in XAUUSD = $0.10. 20 pips = $2.00
    max_allowed_usd = MAX_ENTRY_SLIPPAGE_PIPS * 0.10

    if slippage_usd > max_allowed_usd:
        reason = f"REJECTED_SLIPPAGE_EXCEEDED: Drift {slippage_usd:.2f} USD > max {max_allowed_usd:.2f} USD ({MAX_ENTRY_SLIPPAGE_PIPS} pips)"
        logger.warning(reason)
        return False, reason

    return True, None


def check_redis_deduplication(signal: NormalizedSignalSchema) -> Tuple[bool, Optional[str]]:
    """Guard 4: Reject duplicate signals within 60 seconds using Redis idempotency key."""
    raw_key = f"{signal.source}:{signal.symbol}:{signal.action}:{signal.entry_price:.2f}"
    sig_hash = hashlib.sha256(raw_key.encode()).hexdigest()[:16]
    redis_key = f"signal_ingest:{sig_hash}"

    try:
        redis_cli = get_redis_client()
        # Set NX with 60s TTL
        is_new = redis_cli.set(redis_key, "1", ex=60, nx=True)
        if not is_new:
            reason = f"REJECTED_DUPLICATE_SIGNAL: Identical signal received within 60s window (hash={sig_hash})"
            logger.warning(reason)
            return False, reason
    except Exception as e:
        logger.warning(f"Redis unavailable for signal deduplication check: {e}")

    return True, None


def sanitize_and_audit_signal(
    signal: NormalizedSignalSchema,
    live_price: Optional[float] = None,
    current_time: Optional[float] = None
) -> Tuple[bool, Optional[str], NormalizedSignalSchema]:
    """Execute all 4 safety guards and log decision into signal_audit_logs."""
    if live_price is None:
        live_price = signal.entry_price
    if current_time is None:
        current_time = time.time()

    reject_reason = None
    approved = True

    # 1. Guard 1: Mandatory SL
    ok, reason, signal = check_mandatory_sl(signal, live_price)
    if not ok:
        approved = False
        reject_reason = reason

    # 2. Guard 2: News Shield
    if approved:
        ok, reason = check_news_shield(current_time)
        if not ok:
            approved = False
            reject_reason = reason

    # 3. Guard 3: Entry Slippage Guard
    if approved:
        ok, reason = check_entry_slippage(signal, live_price)
        if not ok:
            approved = False
            reject_reason = reason

    # 4. Guard 4: Redis Deduplication
    if approved:
        ok, reason = check_redis_deduplication(signal)
        if not ok:
            approved = False
            reject_reason = reason

    # Persist decision into signal_audit_logs
    status = "APPROVED" if approved else "REJECTED"
    try:
        with tx() as c:
            c.execute(
                """
                INSERT INTO signal_audit_logs(
                    id, signal_id, source_name, strategy_tier, symbol, side,
                    entry_price, stop_loss, take_profit, raw_payload,
                    status, reject_reason, created_at, processed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"log_{signal.id}",
                    signal.id,
                    signal.source,
                    signal.strategy_tier,
                    signal.symbol,
                    signal.action,
                    signal.entry_price,
                    signal.stop_loss,
                    signal.take_profit,
                    json.dumps(signal.raw_payload or {}),
                    status,
                    reject_reason,
                    signal.created_at,
                    current_time,
                )
            )
    except Exception as e:
        logger.error(f"Error recording signal audit log: {e}")

    return approved, reject_reason, signal
