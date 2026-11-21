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
from app.services.billing_service import process_successful_payment
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
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

    # 2b. Global Kill Switch Check (Fail-Closed)
    with tx() as c:
        halt_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        is_halted = bool(halt_row and str(halt_row[0]).strip() in ("1", "true", "True"))
    if is_halted:
        logger.warning(f"TradingView signal {norm_signal.id} rejected: Kill switch is ACTIVE (halted=1)")
        return {"status": "REJECTED", "signal_id": norm_signal.id, "reason": "KILL_SWITCH_ACTIVE", "executed": 0}

    # 3. Determine live reference price for symbol with strict freshness check (<120s)
    live_price = None
    with tx() as c:
        q = c.execute(
            "SELECT bid, ask, ts FROM quotes WHERE symbol = ? AND (? - ts) < 120 ORDER BY ts DESC LIMIT 1",
            (norm_signal.symbol, now_ts)
        ).fetchone()
        if q and q["bid"] and q["ask"]:
            from app.services.symbol_precision import digits_for_symbol
            live_price = round((float(q["bid"]) + float(q["ask"])) / 2.0, digits_for_symbol(norm_signal.symbol))

    if live_price is None:
        try:
            rc = get_redis_client()
            cached = rc.get(f"quote:{norm_signal.symbol}:live")
            if cached:
                from app.services.symbol_precision import digits_for_symbol
                val = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
                parts = val.split(":")
                if len(parts) < 3 or (now_ts - float(parts[2])) < 120.0:
                    live_price = round((float(parts[0]) + float(parts[1])) / 2.0, digits_for_symbol(norm_signal.symbol))
        except Exception:
            pass

    if live_price is None:
        logger.warning(f"Signal {norm_signal.id} rejected: No fresh live quote available for {norm_signal.symbol}")
        return {
            "status": "REJECTED",
            "signal_id": norm_signal.id,
            "reason": "REJECTED_STALE_MARKET_DATA: No fresh tick quote (<120s) available to verify slippage",
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

    # 6. Query active accounts entitled to receive this signal
    with tx() as c:
        # Accounts must have active service subscription AND active cloud slot (or admin bypass)
        query = """
            SELECT
                a.id, a.user_id, a.metaapi_account_id, a.balance, a.equity,
                a.max_lot,
                a.risk_config, a.risk_multiplier, a.is_compounding, a.is_prop_firm_mode,
                a.prop_stage, a.prop_daily_dd_limit_pct, a.prop_profit_target_pct,
                a.account_type, a.contract_size,
                s.plan_tier, s.allow_alpha_strategies
            FROM trading_accounts a
            LEFT JOIN subscriptions s ON s.user_id = a.user_id
            WHERE a.auto_trade = 1
              AND a.deployment_state = 'DEPLOYED'
              AND a.equity > 0
              AND (
                  (s.service_expires_at IS NOT NULL AND s.service_expires_at > ?)
                  OR (a.cloud_expires_at IS NOT NULL AND a.cloud_expires_at > ?)
                  OR a.user_id IN (SELECT id FROM users WHERE role = 'admin')
              )
        """
        rows = c.execute(query, (now_ts, now_ts)).fetchall()

    eligible_accounts = []
    seen_acc_ids = set()
    import json
    for r in rows:
        d = dict(r)
        if d["id"] in seen_acc_ids:
            continue
        seen_acc_ids.add(d["id"])
        # If strategy is ALPHA, verify user subscription permits ALPHA strategies
        if sanitized_signal.strategy_tier == "ALPHA" and not d.get("allow_alpha_strategies"):
            continue
        raw_cfg = d.get("risk_config")
        rc = {}
        if raw_cfg:
            try:
                rc = json.loads(raw_cfg) if isinstance(raw_cfg, str) else raw_cfg
            except Exception:
                rc = {}
        d["risk_percent"] = float(rc.get("risk_percent", 1.0))
        d_max = d.get("max_lot")
        if d_max is not None and float(d_max) > 0:
            d["max_lot"] = float(d_max)
        else:
            d["max_lot"] = float(rc.get("max_lot", 5.0) or 5.0)
        eligible_accounts.append(d)

    # Also enqueue into Direct MT5 EA Bridge (dispatches) for any connected & enabled DEMO EA terminals
    ea_queued = 0
    try:
        from app.routers.ea import _ensure_ea_tables
        with tx() as c_ea:
            _ensure_ea_tables(c_ea)
            ea_rows = c_ea.execute(
                """
                SELECT a.id FROM accounts a
                JOIN devices d ON d.account_id = a.id
                WHERE a.enabled = 1 AND a.mode = 'DEMO'
                """
            ).fetchall()
            if ea_rows:
                act_u = sanitized_signal.action.upper()
                c_ea.execute(
                    """
                    INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
                    VALUES(?, 'DEMO', ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO NOTHING
                    """,
                    (sanitized_signal.id, act_u, float(sanitized_signal.entry_price), float(sanitized_signal.stop_loss or 0), float(sanitized_signal.take_profit or 0), now_ts, now_ts + 300),
                )
                for er in ea_rows:
                    c_ea.execute(
                        """
                        INSERT INTO dispatches(signal_id, account_id, state, volume, created, updated)
                        VALUES(?, ?, 'queued', 0.01, ?, ?)
                        ON CONFLICT(account_id, signal_id) DO UPDATE SET updated=excluded.updated
                        """,
                        (sanitized_signal.id, er["id"], now_ts, now_ts),
                    )
                    ea_queued += 1
    except Exception as ea_err:
        logger.warning(f"EA Bridge dispatch enqueue skipped in webhook: {ea_err}")

    if not eligible_accounts:
        logger.info(f"Signal {sanitized_signal.id} approved, but no active eligible accounts currently online.")
        return {
            "status": "APPROVED",
            "signal_id": sanitized_signal.id,
            "message": "Signal passed all 4 guards, but no active eligible accounts found.",
            "total_accounts": 0,
            "executed": 0,
        }

    # 6. Fan-Out Direct Dispatch
    client = MetaApiClient()
    redis_cli = None
    try:
        redis_cli = get_redis_client()
    except Exception:
        pass

    sig_dict = {
        "id": sanitized_signal.id,
        "symbol": sanitized_signal.symbol,
        "action": sanitized_signal.action,
        "entry_price": sanitized_signal.entry_price,
        "sl": sanitized_signal.stop_loss,
        "tp": sanitized_signal.take_profit,
        "strategy_tier": sanitized_signal.strategy_tier,
    }

    report = await execute_fan_out_for_signal(
        signal=sig_dict,
        accounts=eligible_accounts,
        metaapi_client=client,
        redis_client=redis_cli,
    )

    logger.info(f"Dispatched signal {sanitized_signal.id} to {len(eligible_accounts)} accounts. Executed: {report.get('executed')}")
    return {
        "status": "APPROVED",
        "signal_id": sanitized_signal.id,
        "total_eligible_accounts": len(eligible_accounts),
        "executed": report.get("executed", 0),
        "failed": report.get("failed", 0),
        "avg_latency_ms": report.get("avg_latency_ms", 0),
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
