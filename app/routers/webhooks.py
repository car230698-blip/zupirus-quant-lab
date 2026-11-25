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
    SEPAY_WEBHOOK_SECRET,
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


@router.post("/api/sepay/webhook")
@router.post("/api/webhooks/sepay")
@router.post("/api/v1/webhooks/sepay")
@router.post("/api/v1/sepay/webhook")
async def handle_sepay_webhook(
    request: Request,
    authorization: str = Header(default=""),
):
    """Handle SePay VietQR payment webhook and automatically fulfill order.
    Strictly secured: requires valid secret/API key, verifies transferType=='in' and full amount.
    Supports standard endpoints: /api/sepay/webhook, /api/webhooks/sepay, /api/v1/webhooks/sepay.
    """
    raw_body = await request.body()
    expected_secret = ""
    # 1. Check SePay secret authorization: prefer decrypted Admin UI setting, then get_sepay_secret(), then env
    try:
        from app.security import decrypt_secret
        with tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
            if not row or not row[0]:
                row = c.execute("SELECT value FROM kv WHERE key = 'billing_settings'").fetchone()
            if row and row[0]:
                import json
                b_settings = json.loads(row[0])
                raw_sec = str(
                    b_settings.get("sepay_webhook_secret_encrypted")
                    or b_settings.get("sepay_webhook_secret")
                    or ""
                ).strip()
                if raw_sec:
                    dec_sec = decrypt_secret(raw_sec)
                    expected_secret = dec_sec if dec_sec else ("" if raw_sec.startswith("enc:") else raw_sec)
    except Exception as err:
        logger.warning(f"Error reading DB secret in SePay webhook: {err}")

    if not expected_secret:
        from app.sepay import get_sepay_secret
        expected_secret = get_sepay_secret() or SEPAY_WEBHOOK_SECRET

    if not expected_secret:
        logger.error("SePay webhook rejected: SEPAY_WEBHOOK_SECRET is not configured.")
        raise HTTPException(status_code=503, detail="Payment webhook secret not configured")

    valid_secrets = {expected_secret.strip()}
    if SEPAY_WEBHOOK_SECRET and str(SEPAY_WEBHOOK_SECRET).strip():
        valid_secrets.add(str(SEPAY_WEBHOOK_SECRET).strip())

    # 2. Check SePay authentication: HMAC-SHA256 signature OR API key / token header
    sig_header = request.headers.get("x-sepay-signature")
    timestamp_header = request.headers.get("x-sepay-timestamp")
    auth_valid = False

    if sig_header:
        from app.sepay import verify_sepay_signature
        for s in valid_secrets:
            if verify_sepay_signature(raw_body, sig_header, s, timestamp_header=timestamp_header):
                auth_valid = True
                break

    def _extract_token(val: str) -> str:
        s = str(val or "").strip()
        for prefix in ("apikey ", "bearer ", "token "):
            if s.lower().startswith(prefix):
                return s[len(prefix):].strip()
        return s

    token_candidates = []
    if authorization:
        token_candidates.append(_extract_token(authorization))
    for h in ("x-api-key", "apikey", "x-sepay-key", "x-sepay-api-key"):
        val = request.headers.get(h)
        if val:
            token_candidates.append(_extract_token(val))

    for param in ("token", "key", "secret", "api_key"):
        val = request.query_params.get(param)
        if val:
            token_candidates.append(str(val).strip())

    try:
        import json, math
        def _reject_nan(val: str):
            raise ValueError(f"Invalid JSON numeric constant: {val}")
        payload = json.loads(raw_body.decode("utf-8"), parse_constant=_reject_nan)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Also check if payload contains api_key or token
    for p_field in ("api_key", "token", "secret"):
        if payload.get(p_field):
            token_candidates.append(str(payload[p_field]).strip())

    if not auth_valid:
        for t in token_candidates:
            if not t:
                continue
            for s in valid_secrets:
                if secrets.compare_digest(t, s):
                    auth_valid = True
                    break
            if auth_valid:
                break

    if not auth_valid:
        logger.warning(
            f"Invalid SePay webhook authorization: bad signature or token mismatch "
            f"(received {len(token_candidates)} candidate tokens)"
        )
        raise HTTPException(status_code=401, detail="Unauthorized")

    # 3. Verify transfer direction: MUST BE EXPLICIT INBOUND ("in")
    raw_type = payload.get("transferType")
    if not raw_type:
        logger.warning("SePay webhook rejected: missing transferType in payload")
        return {"success": False, "message": "Missing transferType"}
    transfer_type = str(raw_type).lower().strip()
    if transfer_type not in ("in", "inbound"):
        logger.warning(f"SePay webhook rejected debit/outbound transaction (transferType='{transfer_type}')")
        return {"success": False, "message": f"Rejected non-inbound transaction (type={transfer_type})"}

    try:
        amount_in = float(payload.get("transferAmount") or payload.get("amount") or 0.0)
    except (ValueError, TypeError):
        amount_in = 0.0
    if not math.isfinite(amount_in) or amount_in <= 0:
        logger.warning(f"SePay webhook rejected invalid transferAmount: {amount_in}")
        return {"success": False, "message": "Invalid transfer amount"}

    # Aggregate all possible content fields from SePay bank push
    content_parts = [
        str(payload.get("transactionContent") or ""),
        str(payload.get("content") or ""),
        str(payload.get("description") or ""),
        str(payload.get("code") or ""),
        str(payload.get("referenceCode") or ""),
        str(payload.get("body") or ""),
    ]
    combined_content = " ".join(p for p in content_parts if p).strip()
    trans_id = str(payload.get("id") or payload.get("transaction_id") or "")
    logger.info(f"Received SePay transaction: ID={trans_id}, Amount={amount_in} VND, Content='{combined_content}'")

    # Deduplication check
    if trans_id:
        with tx() as c:
            existing = c.execute("SELECT id FROM payment_transactions WHERE sepay_id = ?", (trans_id,)).fetchone()
            if existing:
                return {"success": True, "amount": amount_in, "message": "Transaction already recorded"}

    # 4. Match order pattern: strictly match token "ZP <order_suffix>" or "ORD_<suffix>"
    # Supports bank memos formatted with spaces, hyphens, underscores, dots or prefixes (including SEVQR for VietinBank)
    match = re.search(r"\b(?:SEVQR[\s\-_.:]*)?ZP[\s\-_.:]*([A-F0-9]{6,12})\b", combined_content, re.IGNORECASE)
    if not match:
        match = re.search(r"\b(?:SEVQR[\s\-_.:]*)?ORD[\s\-_.:]*([A-F0-9]{6,16})\b", combined_content, re.IGNORECASE)
    if not match and payload.get("code"):
        code_str = str(payload.get("code") or "").strip()
        m_code = re.search(r"^(?:SEVQR[\s\-_.:]*)?(?:ZP[\s\-_.:]*)?([A-F0-9]{6,12})$", code_str, re.IGNORECASE)
        if m_code:
            match = m_code

    if match:
        import hashlib
        order_suffix = match.group(1).lower()
        fallback_tid = hashlib.sha256(raw_body).hexdigest()[:24] if raw_body else str(int(time.time()))
        success = await process_successful_payment(
            order_suffix,
            sepay_trans_id=trans_id or fallback_tid,
            amount_received_vnd=amount_in,
            raw_payload=payload
        )
        return {"success": success, "order_key": order_suffix, "amount": amount_in, "amount_vnd": amount_in}

    # 5. Fallback: match by customer email or user identifier in memo
    from app.sepay import extract_user_identifier

    user_identifier = extract_user_identifier(combined_content)
    matched_user_id = None
    matched_email = None
    tx_id = f"pay_{secrets.token_hex(8)}"

    with tx() as c:
        if user_identifier:
            if "@" in user_identifier:
                u_row = c.execute("SELECT id, email FROM users WHERE email = ?", (user_identifier.lower(),)).fetchone()
            else:
                u_row = c.execute("SELECT id, email FROM users WHERE id = ?", (user_identifier,)).fetchone()
            if u_row:
                matched_user_id = u_row["id"]
                matched_email = u_row["email"]

        ref_code = str(payload.get("referenceCode") or "")
        gateway = str(payload.get("gateway") or "SEPAY")
        now_ts = time.time()
        if trans_id:
            dup_row = c.execute("SELECT id FROM payment_transactions WHERE sepay_id = ?", (trans_id,)).fetchone()
            if dup_row:
                return {
                    "success": True,
                    "transaction_id": dup_row[0],
                    "amount": amount_in,
                    "matched_user": matched_email or matched_user_id,
                    "message": "Duplicate transaction already recorded (idempotent)"
                }
        c.execute(
            """
            INSERT INTO payment_transactions(id, sepay_id, user_id, amount, currency, gateway, content, reference_code, status, created_at)
            VALUES(?, ?, ?, ?, 'VND', ?, ?, ?, 'completed', ?)
            ON CONFLICT DO NOTHING
            """,
            (tx_id, trans_id or None, matched_user_id, amount_in, gateway, combined_content, ref_code, now_ts)
        )

    if not matched_user_id:
        return {
            "success": True,
            "transaction_id": tx_id,
            "amount": amount_in,
            "manual_reconciliation": True,
            "message": "Giao dịch đã được ghi nhận thành công và chuyển vào danh sách đối soát thủ công."
        }

    return {
        "success": True,
        "transaction_id": tx_id,
        "amount": amount_in,
        "matched_user": matched_email or matched_user_id,
        "message": "Payment verified and recorded successfully"
    }
