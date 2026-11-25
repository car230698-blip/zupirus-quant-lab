"""ZUPIRUS 4 Mandatory Safety Guards & Signal Sanitizer with Tabula Rasa Context Snapshotting.
Ensures zero-compromise risk management for all ingested signals:
1. Lớp 1: Redis Deduplication (60s idempotency)
2. Lớp 2: Mandatory Stop Loss & Anti-Martingale (auto-attach ATR(14) SL, max 2 trades)
3. Lớp 3: News Shield (±15 min USD High-Impact)
4. Lớp 4: Entry Slippage Guard (<= 20 pips)
Also snapshots real-time market context for Tabula Rasa observational & inductive learning.
"""
import os
import secrets
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
    from app.services.symbol_precision import digits_for_symbol
    dec = digits_for_symbol(signal.symbol)
    tier = str(getattr(signal, "strategy_tier", "STANDARD") or "STANDARD").upper()
    raw_key = f"{signal.source}:{tier}:{signal.symbol}:{signal.action}:{round(float(signal.entry_price), dec)}"
    sig_hash = hashlib.sha256(raw_key.encode()).hexdigest()[:16]
    redis_key = f"signal_ingest:{signal.source}:{tier}:{sig_hash}"

    try:
        redis_cli = get_redis_client()
        is_new = redis_cli.set(redis_key, "1", ex=60, nx=True)
        if not is_new:
            reason = f"REJECTED_DUPLICATE_SIGNAL: Identical signal received within 60s window (hash={sig_hash})"
            logger.warning(reason)
            return False, reason
    except Exception as e:
        logger.warning(f"Redis unavailable for signal deduplication check ({e}), checking DB fallback")
        from app.services.symbol_precision import pip_size_for_symbol
        tol = 5.0 * pip_size_for_symbol(signal.symbol)
        with tx() as c:
            now_sec = time.time()
            # Atomic lock row per 60s time bucket to prevent TOCTOU race when Redis is down
            bucket = int(now_sec // 60)
            fp_key = f"san:{sig_hash}:{bucket}"
            try:
                lck_cur = c.execute(
                    "INSERT INTO signal_dispatch_locks (id, signal_fingerprint, account_id, worker_id, created_at) VALUES (?, ?, '__SANITIZER__', 'sanitizer', ?) ON CONFLICT (signal_fingerprint, account_id) DO NOTHING",
                    (f"lck_{secrets.token_hex(6)}", fp_key, now_sec),
                )
                if getattr(lck_cur, "rowcount", 1) == 0:
                    reason = f"REJECTED_DUPLICATE_SIGNAL: Identical signal locked in DB within 60s window (hash={sig_hash})"
                    logger.warning(reason)
                    return False, reason
            except Exception:
                pass
            recent_dup = c.execute(
                """
                SELECT id FROM signal_audit_logs
                WHERE source_name = ? AND symbol = ? AND side = ? AND strategy_tier = ? AND ABS(entry_price - ?) < ? AND (? - created_at) < 60
                  AND status NOT IN ('REJECTED', 'FANOUT_FAILED')
                LIMIT 1
                """,
                (signal.source, signal.symbol, signal.action, tier, signal.entry_price, tol, now_sec)
            ).fetchone()
            if recent_dup:
                reason = f"REJECTED_DUPLICATE_SIGNAL: Identical signal found in DB within 60s window (id={recent_dup[0]})"
                logger.warning(reason)
                return False, reason

    return True, None


def clear_signal_deduplication(signal: NormalizedSignalSchema) -> None:
    """Xóa khóa dedup trong Redis và DB fallback khi việc phân phối/thực thi lệnh không thành công,
    cho phép hệ thống retry lại mà không bị bộ chống trùng 60s chặn."""
    try:
        from app.services.symbol_precision import digits_for_symbol
        dec = digits_for_symbol(signal.symbol)
        tier = str(getattr(signal, "strategy_tier", "STANDARD") or "STANDARD").upper()
        raw_key = f"{signal.source}:{tier}:{signal.symbol}:{signal.action}:{round(float(signal.entry_price), dec)}"
        sig_hash = hashlib.sha256(raw_key.encode()).hexdigest()[:16]
        redis_key = f"signal_ingest:{signal.source}:{tier}:{sig_hash}"
        try:
            redis_cli = get_redis_client()
            redis_cli.delete(redis_key)
        except Exception:
            pass

        with tx() as c:
            c.execute("DELETE FROM signal_dispatch_locks WHERE signal_fingerprint LIKE ?", (f"san:{sig_hash}:%",))
            c.execute("UPDATE signal_audit_logs SET status = 'FANOUT_FAILED' WHERE signal_id = ? OR id = ?", (signal.id, signal.id))
    except Exception as e:
        logger.debug(f"clear_signal_deduplication note: {e}")


def check_mandatory_sl(
    signal: NormalizedSignalSchema,
    current_price: float,
    atr_points: float = 3.50,
) -> Tuple[bool, Optional[str], NormalizedSignalSchema]:
    """Lớp 2: Bắt buộc Stop Loss (Anti-Martingale) & Tự gắn SL theo ATR(14) thực tế nếu thiếu."""
    if signal.stop_loss is not None:
        if signal.stop_loss <= 0:
            return False, f"REJECTED_INVALID_STOP_LOSS: Non-positive SL {signal.stop_loss}", signal
        if signal.action == "BUY" and signal.stop_loss >= current_price:
            return False, f"REJECTED_INVALID_STOP_LOSS: BUY SL {signal.stop_loss} >= entry {current_price}", signal
        if signal.action == "SELL" and signal.stop_loss <= current_price:
            return False, f"REJECTED_INVALID_STOP_LOSS: SELL SL {signal.stop_loss} <= entry {current_price}", signal
        if signal.take_profit is not None:
            if signal.take_profit <= 0:
                return False, f"REJECTED_INVALID_TAKE_PROFIT: Non-positive TP {signal.take_profit}", signal
            if signal.action == "BUY" and signal.take_profit <= current_price:
                return False, f"REJECTED_INVALID_TAKE_PROFIT: BUY TP {signal.take_profit} <= entry {current_price}", signal
            if signal.action == "SELL" and signal.take_profit >= current_price:
                return False, f"REJECTED_INVALID_TAKE_PROFIT: SELL TP {signal.take_profit} >= entry {current_price}", signal
        return True, None, signal

    if not AUTO_ATTACH_ATR_SL:
        return False, "REJECTED_MISSING_STOP_LOSS: Signal lacks stop loss and auto-attach is disabled", signal

    # Auto attach ATR-based stop loss scaled safely for symbol precision
    from app.services.symbol_precision import digits_for_symbol, pip_size_for_symbol
    p_size = pip_size_for_symbol(signal.symbol)
    p_dec = digits_for_symbol(signal.symbol)
    sym_u = signal.symbol.upper()
    is_gold = "XAU" in sym_u or "GOLD" in sym_u
    default_atr = atr_points if is_gold else min(atr_points, 25.0 * p_size)
    atr_val = max(15.0 * p_size, default_atr)
    if signal.action == "BUY" and atr_val >= current_price * 0.5:
        atr_val = max(15.0 * p_size, current_price * 0.005)
    sl_price = current_price - atr_val if signal.action == "BUY" else current_price + atr_val
    signal.stop_loss = round(sl_price, p_dec)
    logger.info(f"Guard 2 [Auto-Attached ATR SL]: Signal {signal.id} set SL={signal.stop_loss} (ATR={atr_val})")
    return True, None, signal


def check_news_shield(current_time: float) -> Tuple[bool, Optional[str]]:
    """Lớp 3: Lá chắn tin tức đỏ USD (CPI, NFP, FOMC) trong khung giờ ±15 phút."""
    window_sec = NEWS_SHIELD_MINUTES * 60
    with tx() as c:
        app_env = os.getenv("APP_ENV", "dev").strip().lower()
        if app_env == "production":
            sync_row = c.execute("SELECT value FROM kv WHERE key = 'news_last_synced_at'").fetchone()
            last_sync = float(sync_row[0]) if sync_row and sync_row[0] else 0.0
            if (current_time - last_sync > 86400):
                reason = "REJECTED_NEWS_SHIELD: Macro calendar unverified (Fail-Closed active, no calendar sync in 24h)"
                logger.warning(reason)
                return False, reason
        rows = c.execute(
            """
            SELECT title, currency FROM news
            WHERE lower(impact) = 'high' AND upper(currency) IN ('USD', 'ALL')
            AND ts >= ? AND ts <= ?
            ORDER BY abs(ts - ?) ASC
            """,
            (current_time - window_sec, current_time + window_sec, current_time)
        ).fetchall()

        if rows:
            titles = []
            for r in rows:
                t_val = r["title"] if hasattr(r, 'keys') and "title" in r else r[0]
                if t_val and str(t_val) not in titles:
                    titles.append(str(t_val))
            event_name = ", ".join(titles)
            reason = f"REJECTED_NEWS_SHIELD: High-Impact USD event '{event_name}' within ±{NEWS_SHIELD_MINUTES}m"
            logger.warning(reason)
            return False, reason

    return True, None


def _symbol_pip_size(symbol: str) -> float:
    from app.services.symbol_precision import pip_size_for_symbol
    return pip_size_for_symbol(symbol)


def check_entry_slippage(signal: NormalizedSignalSchema, live_price: float) -> Tuple[bool, Optional[str]]:
    """Lớp 4: Hủy lệnh nếu giá Live Tick lệch quá MAX_ENTRY_SLIPPAGE_PIPS (20 pips) so với entry_price gốc."""
    pip_size = _symbol_pip_size(signal.symbol)
    drift_pips = abs(live_price - signal.entry_price) / pip_size

    if drift_pips > MAX_ENTRY_SLIPPAGE_PIPS:
        reason = f"REJECTED_SLIPPAGE_EXCEEDED: Drift {drift_pips:.1f} pips > max {MAX_ENTRY_SLIPPAGE_PIPS} pips for {signal.symbol}"
        logger.warning(reason)
        return False, reason

    return True, None


def check_live_spread_guard(symbol: str, spread_pips: float) -> Tuple[bool, Optional[str]]:
    """Live Spread Guard (Lớp 2 tại broker): Chặn lệnh nếu broker bị giãn Spread quá mức an toàn."""
    sym_upper = symbol.upper()
    is_gold = "XAU" in sym_upper or "GOLD" in sym_upper
    is_crypto_or_idx = any(k in sym_upper for k in ("BTC", "ETH", "US30", "NAS100", "SPX", "DE40"))
    max_allowed = 50.0 if is_crypto_or_idx else (4.5 if is_gold else 2.5)

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

            # Extract strategy_id / candidate_id if present for canary auditing
            payload = signal.raw_payload or {}
            strat_id = getattr(signal, "strategy_id", None) or (payload.get("strategy_id") if isinstance(payload, dict) else None) or (payload.get("candidate_id") if isinstance(payload, dict) else None)

            # Persist to signal_audit_logs
            try:
                c.execute(
                    """
                    INSERT INTO signal_audit_logs(
                        id, signal_id, source_name, strategy_tier, symbol, side,
                        entry_price, stop_loss, take_profit, raw_payload,
                        status, reject_reason, context_snapshot, created_at, processed_at, strategy_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"log_{secrets.token_hex(6)}",
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
                        strat_id,
                    ),
                )
            except Exception:
                c.execute(
                    """
                    INSERT INTO signal_audit_logs(
                        id, signal_id, source_name, strategy_tier, symbol, side,
                        entry_price, stop_loss, take_profit, raw_payload,
                        status, reject_reason, context_snapshot, created_at, processed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"log_{secrets.token_hex(6)}",
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
                    ),
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
