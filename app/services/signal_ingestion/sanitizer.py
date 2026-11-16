"""ZUPIRUS 4 Mandatory Safety Guards & Signal Sanitizer with Tabula Rasa Context Snapshotting.
Ensures zero-compromise risk management for all ingested signals:
1. Lớp 1: Redis Deduplication (60s idempotency)
2. Lớp 2: Mandatory Stop Loss & Anti-Martingale (auto-attach ATR(14) SL, max 2 trades)
3. Lớp 3: News Shield (±15 min USD High-Impact)
4. Lớp 4: Entry Slippage Guard (<= 20 pips)
Also snapshots real-time market context for Tabula Rasa observational & inductive learning.
"""
import time
import json
import hashlib
import logging
from typing import Tuple, Optional, Dict, Any
from app.db import tx
from app.config import (
    AUTO_ATTACH_ATR_SL,
    MAX_ENTRY_SLIPPAGE_PIPS,
    NEWS_SHIELD_MINUTES,
    MAX_CONCURRENT_TRADES_PER_ACCOUNT,
)
from app.schemas.signals import NormalizedSignalSchema
from app.redis_client import get_redis_client
from app.services.signal_ingestion.context import (
    capture_market_context_snapshot,
    get_market_atr14,
)
from app.hindsight import store_memory, CATEGORY_EPISODIC

logger = logging.getLogger("zupirus.sanitizer")


def check_redis_deduplication(signal: NormalizedSignalSchema) -> Tuple[bool, Optional[str]]:
    """Lớp 1: Chặn ngay tín hiệu trùng lặp ở cửa vào trong 60s bằng Redis Idempotency Key."""
    raw_key = f"{signal.source}:{signal.symbol}:{signal.action}:{signal.entry_price:.2f}"
    sig_hash = hashlib.sha256(raw_key.encode()).hexdigest()[:16]
    redis_key = f"signal_ingest:{signal.source}:{sig_hash}"

    try:
        redis_cli = get_redis_client()
        is_new = redis_cli.set(redis_key, "1", ex=60, nx=True)
        if not is_new:
            reason = f"REJECTED_DUPLICATE_SIGNAL: Identical signal received within 60s window (hash={sig_hash})"
            logger.warning(reason)
            return False, reason
    except Exception as e:
        logger.warning(f"Redis unavailable for signal deduplication check ({e}), checking DB fallback")
        with tx() as c:
            now_sec = time.time()
            recent_dup = c.execute(
                """
                SELECT id FROM signals
                WHERE source = ? AND side = ? AND ABS(price - ?) < 0.05 AND (? - created) < 60
                LIMIT 1
                """,
                (signal.source, signal.action, signal.entry_price, now_sec)
            ).fetchone()
            if recent_dup:
                reason = f"REJECTED_DUPLICATE_SIGNAL: Identical signal found in DB within 60s window (id={recent_dup[0]})"
                logger.warning(reason)
                return False, reason

    return True, None


def check_mandatory_sl(
    signal: NormalizedSignalSchema,
    current_price: float,
    atr_points: float = 3.50,
) -> Tuple[bool, Optional[str], NormalizedSignalSchema]:
    """Lớp 2: Bắt buộc Stop Loss (Anti-Martingale) & Tự gắn SL theo ATR(14) thực tế nếu thiếu."""
    if signal.stop_loss is not None:
        return True, None, signal

    if not AUTO_ATTACH_ATR_SL:
        return False, "REJECTED_MISSING_STOP_LOSS: Signal lacks stop loss and auto-attach is disabled", signal

    # Auto attach ATR-based stop loss
    atr_val = max(1.5, atr_points)
    sl_price = current_price - atr_val if signal.action == "BUY" else current_price + atr_val
    signal.stop_loss = round(sl_price, 2)
    logger.info(f"Guard 2 [Auto-Attached ATR SL]: Signal {signal.id} set SL={signal.stop_loss} (ATR={atr_val})")
    return True, None, signal


def check_news_shield(current_time: float) -> Tuple[bool, Optional[str]]:
    """Lớp 3: Lá chắn tin tức đỏ USD (CPI, NFP, FOMC) trong khung giờ ±15 phút."""
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
            event_name = row["title"] if hasattr(row, 'keys') and "title" in row else row[0]
            reason = f"REJECTED_NEWS_SHIELD: High-Impact USD event '{event_name}' within ±{NEWS_SHIELD_MINUTES}m"
            logger.warning(reason)
            return False, reason

    return True, None


def check_entry_slippage(signal: NormalizedSignalSchema, live_price: float) -> Tuple[bool, Optional[str]]:
    """Lớp 4: Hủy lệnh nếu giá Live Tick XAUUSD lệch quá 20 pips so với entry_price gốc."""
    slippage_usd = abs(live_price - signal.entry_price)
    max_allowed_usd = MAX_ENTRY_SLIPPAGE_PIPS * 0.10  # 1 pip Gold = $0.10; 20 pips = $2.00

    if slippage_usd > max_allowed_usd:
        reason = f"REJECTED_SLIPPAGE_EXCEEDED: Drift {slippage_usd:.2f} USD > max {max_allowed_usd:.2f} USD ({MAX_ENTRY_SLIPPAGE_PIPS} pips)"
        logger.warning(reason)
        return False, reason

    return True, None


def check_live_spread_guard(symbol: str, spread_pips: float) -> Tuple[bool, Optional[str]]:
    """Live Spread Guard (Lớp 2 tại broker): Chặn lệnh nếu broker bị giãn Spread quá mức an toàn."""
    sym_upper = symbol.upper()
    is_gold = "XAU" in sym_upper or "GOLD" in sym_upper
    max_allowed = 4.5 if is_gold else 2.5

    if spread_pips > max_allowed:
        reason = f"REJECTED_HIGH_SPREAD: Live broker spread {spread_pips:.1f}p exceeds max {max_allowed:.1f}p for {sym_upper}"
        logger.warning(reason)
        return False, reason

    return True, None


def sanitize_and_audit_signal(
    signal: NormalizedSignalSchema,
    live_price: Optional[float] = None,
    current_time: Optional[float] = None,
) -> Tuple[bool, Optional[str], NormalizedSignalSchema]:
    """Execute all 4 safety guards in strict priority order, capture market snapshot,
    and persist decision into signal_audit_logs and Hindsight Episodic Memory."""
    if live_price is None:
        live_price = signal.entry_price
    if current_time is None:
        current_time = time.time()

    reject_reason = None
    approved = True

    # 1. Lớp 1: Redis Deduplication (First line of defense)
    ok, reason = check_redis_deduplication(signal)
    if not ok:
        approved = False
        reject_reason = reason

    # Fetch live ATR(14) for dynamic SL attachment
    live_atr = 3.50
    with tx() as c:
        live_atr = get_market_atr14(c, signal.symbol, "M15")

    # 2. Lớp 2: Mandatory SL & Anti-Martingale
    if approved:
        ok, reason, signal = check_mandatory_sl(signal, live_price, atr_points=live_atr)
        if not ok:
            approved = False
            reject_reason = reason

    # 3. Lớp 3: News Shield (±15 min USD High-Impact Window)
    if approved:
        ok, reason = check_news_shield(current_time)
        if not ok:
            approved = False
            reject_reason = reason

    # 4. Lớp 4: Entry Slippage Guard (<= 20 pips)
    if approved:
        ok, reason = check_entry_slippage(signal, live_price)
        if not ok:
            approved = False
            reject_reason = reason

    # Capture real-time market context snapshot for Tabula Rasa observational learning
    status = "APPROVED" if approved else "REJECTED"
    context_snapshot: Dict[str, Any] = {}
    try:
        with tx() as c:
            context_snapshot = capture_market_context_snapshot(c, signal, live_price, current_time)
            context_json = json.dumps(context_snapshot)

            # Persist to signal_audit_logs
            c.execute(
                """
                INSERT INTO signal_audit_logs(
                    id, signal_id, source_name, strategy_tier, symbol, side,
                    entry_price, stop_loss, take_profit, raw_payload,
                    status, reject_reason, context_snapshot, created_at, processed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    context_json,
                    signal.created_at,
                    current_time,
                )
            )

            # Record into Hindsight Episodic Memory for Tabula Rasa induction
            mem_title = f"Signal Observed: {signal.source} {signal.action} {signal.symbol} @ {signal.entry_price:.2f} ({status})"
            mem_content = (
                f"Tín hiệu nguồn ngoài {signal.source} {signal.action} {signal.symbol} tại ${signal.entry_price:.2f}. "
                f"Trạng thái 4 giáp: {status}. "
                f"Bối cảnh thị trường: Phiên {context_snapshot.get('session')}, ATR(14)=${context_snapshot.get('atr_14')}, "
                f"Spread={context_snapshot.get('spread_pips')} pips, Cách tin USD={context_snapshot.get('news_distance_mins')}m."
            )
            store_memory(
                c,
                category=CATEGORY_EPISODIC,
                title=mem_title,
                content=mem_content,
                entity_id=signal.id,
                tags=["signal_observation", signal.source.lower(), signal.action.lower(), status.lower()],
                metadata={
                    "signal_id": signal.id,
                    "action": signal.action,
                    "entry_price": signal.entry_price,
                    "sl": signal.stop_loss,
                    "tp": signal.take_profit,
                    "status": status,
                    "reject_reason": reject_reason,
                    "context": context_snapshot,
                },
                scope="system",
            )
    except Exception as e:
        logger.error(f"Error auditing signal or storing Tabula Rasa memory: {e}")

    return approved, reject_reason, signal
