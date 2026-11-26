"""Webhook handlers for external signal providers (TradingView) and SePay banking payments."""
import os
import time
import re
import secrets
import logging
from fastapi import APIRouter, Header, Query, Request, HTTPException
from app.db import tx
from app.config import (
    TRADINGVIEW_WEBHOOK_SECRET,
)
from app.schemas.signals import TradingViewWebhookPayload
from app.services.signal_ingestion.normalizer import normalize_tradingview_signal
from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal
from app.services.signal_ingestion.context import get_fresh_live_price, capture_market_context_snapshot
from app.domains.signals.sources.curator import get_active_signal_mode, score_external_signal_hybrid
from app.services.billing_service import process_successful_payment
from app.redis_client import get_redis_client

logger = logging.getLogger("zupirus.webhooks")
router = APIRouter(tags=["webhooks"])


@router.post("/api/v1/webhooks/tradingview")
async def handle_tradingview_webhook(
    p: TradingViewWebhookPayload,
    secret: str = Query(default="", description="Webhook secret token")
):
    """Receive and process XAUUSD signals from TradingView Alerts."""
    # 1. Authenticate secret token (fail closed if unconfigured)
    if not TRADINGVIEW_WEBHOOK_SECRET:
        logger.error("TradingView webhook rejected: TRADINGVIEW_WEBHOOK_SECRET is not configured")
        raise HTTPException(status_code=503, detail="TradingView webhook secret is not configured")
    provided_secret = str(p.secret or secret or "")
    if not secrets.compare_digest(provided_secret, str(TRADINGVIEW_WEBHOOK_SECRET)):
        logger.warning("Unauthorized TradingView webhook attempt: invalid secret token")
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    now_ts = time.time()

    # 2. Normalize signal
    try:
        norm_signal = normalize_tradingview_signal(p)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Signal normalization error: {e}")

    # 2b. Global Kill Switch Check (Fail-Closed) & Autonomous Signal Mode Lock
    from app.core.config import is_customer_auto_trading_enabled
    with tx() as c:
        halt_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        is_halted = bool(halt_row and str(halt_row[0]).strip() in ("1", "true", "True"))
        active_mode = get_active_signal_mode(c)
        customer_exec_on = is_customer_auto_trading_enabled(db_cursor=c)
    if is_halted:
        logger.warning(f"TradingView signal {norm_signal.id} rejected: Kill switch is ACTIVE (halted=1)")
        return {"status": "REJECTED", "signal_id": norm_signal.id, "reason": "KILL_SWITCH_ACTIVE", "executed": 0}

    # 3. Determine live reference price for symbol with strict freshness check (<120s) via unified helper
    with tx() as c:
        live_price = get_fresh_live_price(c, norm_signal.symbol, max_age_sec=120.0)

    if live_price is None:
        logger.warning(f"Signal {norm_signal.id} rejected: No fresh live quote available for {norm_signal.symbol}")
        return {
            "status": "REJECTED",
            "signal_id": norm_signal.id,
            "reason": "REJECTED_STALE_MARKET_DATA: No fresh tick quote (<120s) available to verify slippage",
            "executed": 0,
        }

    # In Research & PDF Report mode (customer_exec_on == False) or ZUPIRUS_AGENT mode,
    # strictly block external real order fan-out and route signal to Shadow Ledger for research only.
    if not customer_exec_on or active_mode == "ZUPIRUS_AGENT":
        logger.info(f"Signal {norm_signal.id} routed to Shadow Ledger: Autonomous ZUPIRUS_AGENT mode is active.")
        from app.services.sources.curator import record_shadow_signal
        from app.services.symbol_precision import digits_for_symbol, pip_size_for_symbol
        is_buy = norm_signal.action == "BUY"
        p_size = pip_size_for_symbol(norm_signal.symbol)
        p_dec = digits_for_symbol(norm_signal.symbol)
        def_sl = round(norm_signal.entry_price - 35.0 * p_size if is_buy else norm_signal.entry_price + 35.0 * p_size, p_dec)
        def_tp = round(norm_signal.entry_price + 70.0 * p_size if is_buy else norm_signal.entry_price - 70.0 * p_size, p_dec)
        with tx() as c:
            record_shadow_signal(
                source_id=norm_signal.source,
                symbol=norm_signal.symbol,
                side=norm_signal.action,
                entry_price=norm_signal.entry_price,
                sl=norm_signal.stop_loss or def_sl,
                tp=norm_signal.take_profit or def_tp,
                db_cursor=c,
            )
        return {
            "status": "RECORDED_SHADOW",
            "signal_id": norm_signal.id,
            "source": norm_signal.source,
            "message": "Signal recorded into shadow_signals ledger (system running in autonomous ZUPIRUS_AGENT mode). Zero duplicate orders dispatched.",
            "executed": 0,
        }

    # If in HYBRID_AGENT_SCORER mode, score incoming external signal against learned skills & source trust
    if active_mode == "HYBRID_AGENT_SCORER":
        with tx() as c:
            ctx_snapshot = capture_market_context_snapshot(c, norm_signal, live_price, now_ts)
            h_ok, h_score, h_reason = score_external_signal_hybrid(c, norm_signal, ctx_snapshot)
        if not h_ok:
            logger.info(f"Signal {norm_signal.id} demoted to Shadow Ledger by HYBRID_AGENT_SCORER: {h_reason}")
            from app.services.sources.curator import record_shadow_signal
            with tx() as c:
                record_shadow_signal(
                    source_id=norm_signal.source,
                    symbol=norm_signal.symbol,
                    side=norm_signal.action,
                    entry_price=norm_signal.entry_price,
                    sl=norm_signal.stop_loss,
                    tp=norm_signal.take_profit,
                    db_cursor=c,
                )
            return {
                "status": "RECORDED_SHADOW",
                "signal_id": norm_signal.id,
                "source": norm_signal.source,
                "reason": f"HYBRID_AGENT_SCORER_BLOCKED: {h_reason}",
                "executed": 0,
            }

    # 4. Check Signal Source Registry Status (ACTIVE_LIVE vs SHADOW_ONLY vs SUSPENDED)
    with tx() as c:
        src_row = c.execute(
            "SELECT status FROM signal_sources WHERE id = ? OR name = ?",
            (norm_signal.source, norm_signal.source)
        ).fetchone()
        # Unknown/unregistered sources fail-closed to SHADOW_ONLY (never auto-promoted to ACTIVE_LIVE)
        src_status = (src_row["status"] if src_row else "SHADOW_ONLY").upper()

    if src_status == "SUSPENDED":
        logger.warning(f"Signal rejected: Source '{norm_signal.source}' is SUSPENDED.")
        return {"status": "REJECTED", "reason": "SOURCE_SUSPENDED", "executed": 0}

    # Fail-closed: Only explicitly ACTIVE_LIVE sources may dispatch live orders; SHADOW_ONLY and DEMOTED go to Shadow Ledger
    if src_status != "ACTIVE_LIVE":
        logger.info(f"Signal from {src_status} source '{norm_signal.source}' routed through Sanitizer + Shadow Ledger.")
        # Run 4-Layer Sanitizer (including L1 Dedup & Context Snapshot logging) before recording shadow signal
        sh_approved, sh_reason, sh_sanitized = sanitize_and_audit_signal(
            signal=norm_signal,
            live_price=live_price,
            current_time=now_ts,
        )
        if not sh_approved and sh_reason and "DUPLICATE" in sh_reason.upper():
            return {
                "status": "REJECTED",
                "signal_id": norm_signal.id,
                "reason": sh_reason,
                "executed": 0,
            }
        from app.services.sources.curator import record_shadow_signal
        from app.services.symbol_precision import digits_for_symbol, pip_size_for_symbol
        is_buy = norm_signal.action == "BUY"
        p_size = pip_size_for_symbol(norm_signal.symbol)
        p_dec = digits_for_symbol(norm_signal.symbol)
        def_sl = round(norm_signal.entry_price - 35.0 * p_size if is_buy else norm_signal.entry_price + 35.0 * p_size, p_dec)
        def_tp = round(norm_signal.entry_price + 70.0 * p_size if is_buy else norm_signal.entry_price - 70.0 * p_size, p_dec)
        with tx() as c:
            record_shadow_signal(
                source_id=norm_signal.source,
                symbol=norm_signal.symbol,
                side=norm_signal.action,
                entry_price=norm_signal.entry_price,
                sl=norm_signal.stop_loss or (sh_sanitized.stop_loss if sh_sanitized else None) or def_sl,
                tp=norm_signal.take_profit or (sh_sanitized.take_profit if sh_sanitized else None) or def_tp,
                db_cursor=c
            )
        return {
            "status": "RECORDED_SHADOW",
            "signal_id": norm_signal.id,
            "source": norm_signal.source,
            "message": "Signal recorded into shadow_signals ledger for Tabula Rasa EOD grading. Zero broker executions.",
            "executed": 0
        }

    # 5. Pass through 4 Mandatory Safety Guards
    approved, reject_reason, sanitized_signal = sanitize_and_audit_signal(
        signal=norm_signal,
        live_price=live_price,
        current_time=now_ts,
    )

    if not approved:
        logger.info(f"Signal {sanitized_signal.id} rejected by guard: {reject_reason}")
        return {
            "status": "REJECTED",
            "signal_id": sanitized_signal.id,
            "reason": reject_reason,
            "action": sanitized_signal.action,
            "entry_price": sanitized_signal.entry_price,
            "executed": 0,
        }

    # 6. Quantitative Research Mode (ZUPIRUS Quant Lab): Record signal into shadow ledger for research analysis
    # Customer auto-trading and MT5 broker execution are strictly eliminated.
    from app.services.sources.curator import record_shadow_signal
    with tx() as c:
        record_shadow_signal(
            source_id=sanitized_signal.source,
            symbol=sanitized_signal.symbol,
            side=sanitized_signal.action,
            entry_price=sanitized_signal.entry_price,
            sl=sanitized_signal.stop_loss,
            tp=sanitized_signal.take_profit,
            db_cursor=c,
        )
    logger.info(f"Signal {sanitized_signal.id} approved for quantitative research observation. Zero broker executions.")
    return {
        "status": "RECORDED_RESEARCH",
        "signal_id": sanitized_signal.id,
        "symbol": sanitized_signal.symbol,
        "action": sanitized_signal.action,
        "entry_price": sanitized_signal.entry_price,
        "message": "Signal recorded in quantitative research shadow ledger for WFO evaluation. Customer execution disabled.",
        "executed": 0,
    }
