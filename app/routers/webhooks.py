"""Webhook handlers for external signal providers (TradingView) and SePay banking payments."""
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
            live_price = round((float(q["bid"]) + float(q["ask"])) / 2.0, 2)

    if live_price is None:
        try:
            rc = get_redis_client()
            cached = rc.get(f"quote:{norm_signal.symbol}:live")
            if cached:
                val = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
                parts = val.split(":")
                live_price = round((float(parts[0]) + float(parts[1])) / 2.0, 2)
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

    if src_status == "SHADOW_ONLY":
        logger.info(f"Signal from SHADOW_ONLY source '{norm_signal.source}' recorded for observation.")
        from app.services.sources.curator import record_shadow_signal
        is_buy = norm_signal.action == "BUY"
        def_sl = round(norm_signal.entry_price - 3.5 if is_buy else norm_signal.entry_price + 3.5, 2)
        def_tp = round(norm_signal.entry_price + 7.0 if is_buy else norm_signal.entry_price - 7.0, 2)
        with tx() as c:
            record_shadow_signal(
                source_id=norm_signal.source,
                symbol=norm_signal.symbol,
                side=norm_signal.action,
                entry_price=norm_signal.entry_price,
                sl=norm_signal.stop_loss or def_sl,
                tp=norm_signal.take_profit or def_tp,
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
        # Accounts must have active service subscription AND active cloud slot
        query = """
            SELECT
                a.id, a.user_id, a.metaapi_account_id, a.balance, a.equity,
                a.risk_config, a.risk_multiplier, a.is_compounding, a.is_prop_firm_mode,
                a.prop_daily_dd_limit_pct, a.prop_profit_target_pct,
                a.account_type, a.contract_size,
                s.plan_tier, s.allow_alpha_strategies
            FROM trading_accounts a
            JOIN subscriptions s ON s.user_id = a.user_id
            WHERE a.auto_trade = 1
              AND a.deployment_state = 'DEPLOYED'
              AND a.equity > 0
              AND s.service_expires_at > ?
              AND (a.cloud_expires_at IS NULL OR a.cloud_expires_at > ?)
        """
        rows = c.execute(query, (now_ts, now_ts)).fetchall()

    eligible_accounts = []
    import json
    for r in rows:
        d = dict(r)
        # If strategy is ALPHA, verify user subscription permits ALPHA strategies
        if sanitized_signal.strategy_tier == "ALPHA" and not d.get("allow_alpha_strategies"):
            continue
        raw_cfg = d.get("risk_config")
        if raw_cfg:
            try:
                cfg_obj = json.loads(raw_cfg) if isinstance(raw_cfg, str) else raw_cfg
                d["risk_percent"] = float(cfg_obj.get("risk_percent", 1.0))
                d["max_lot"] = float(cfg_obj.get("max_lot", 5.0))
            except Exception:
                pass
        eligible_accounts.append(d)

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
async def handle_sepay_webhook(
    request: Request,
    authorization: str = Header(default=""),
):
    """Handle SePay VietQR payment webhook and automatically fulfill order.
    Strictly secured: requires valid secret, verifies transferType=='in' and full amount.
    """
    # 1. Check SePay secret authorization: fail-closed if not configured or token mismatch
    raw_body = await request.body()
    expected_secret = SEPAY_WEBHOOK_SECRET
    try:
        with tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key IN ('billing:settings', 'billing_settings')").fetchone()
            if row and row[0]:
                import json
                b_settings = json.loads(row[0])
                if b_settings.get("sepay_webhook_secret"):
                    expected_secret = b_settings["sepay_webhook_secret"]
    except Exception:
        pass

    if not expected_secret:
        from app.sepay import get_sepay_secret
        expected_secret = get_sepay_secret()

    if not expected_secret:
        logger.error("SePay webhook rejected: SEPAY_WEBHOOK_SECRET is not configured.")
        raise HTTPException(status_code=503, detail="Payment webhook secret not configured")

    # Support either Authorization header (Apikey <secret>) or x-sepay-signature header (HMAC-SHA256)
    sig_header = request.headers.get("x-sepay-signature")
    auth_valid = False

    if sig_header:
        from app.sepay import verify_sepay_signature
        if verify_sepay_signature(raw_body, sig_header, expected_secret):
            auth_valid = True

    if not auth_valid and authorization:
        token = authorization.replace("Apikey ", "").strip()
        if token == expected_secret:
            auth_valid = True

    if not auth_valid:
        logger.warning("Invalid SePay webhook authorization: bad signature or token mismatch")
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        import json
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # 2. Verify transfer direction: MUST BE EXPLICIT INBOUND ("in")
    raw_type = payload.get("transferType")
    if not raw_type:
        logger.warning("SePay webhook rejected: missing transferType in payload")
        return {"success": False, "message": "Missing transferType"}
    transfer_type = str(raw_type).lower().strip()
    if transfer_type not in ("in", "inbound"):
        logger.warning(f"SePay webhook rejected debit/outbound transaction (transferType='{transfer_type}')")
        return {"success": False, "message": f"Rejected non-inbound transaction (type={transfer_type})"}

    amount_in = float(payload.get("transferAmount") or payload.get("amount") or 0.0)
    if amount_in <= 0:
        logger.warning(f"SePay webhook rejected invalid transferAmount: {amount_in}")
        return {"success": False, "message": "Invalid transfer amount"}

    content = payload.get("content") or payload.get("description") or ""
    trans_id = str(payload.get("id") or payload.get("transaction_id") or "")
    logger.info(f"Received SePay transaction: ID={trans_id}, Amount={amount_in} VND, Content='{content}'")

    # Deduplication check
    if trans_id:
        with tx() as c:
            existing = c.execute("SELECT id FROM payment_transactions WHERE sepay_id = ?", (trans_id,)).fetchone()
            if existing:
                return {"success": True, "amount": amount_in, "message": "Transaction already recorded"}

    # 3. Match order pattern: strictly match token "ZP <order_suffix>" or "ORD_<suffix>"
    match = re.search(r"\bZP\s*([A-F0-9]{6,12})\b", content.upper())
    if not match:
        match = re.search(r"\bORD_([A-F0-9]{6,16})\b", content.upper())

    if match:
        order_suffix = match.group(1).lower()
        success = await process_successful_payment(
            order_suffix,
            sepay_trans_id=trans_id or str(time.time()),
            amount_received_vnd=amount_in,
            raw_payload=payload
        )
        return {"success": success, "order_key": order_suffix, "amount": amount_in, "amount_vnd": amount_in}

    # 4. Fallback: match by customer email or user identifier in memo
    from app.sepay import extract_user_identifier
    import secrets

    user_identifier = extract_user_identifier(content)
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
        c.execute(
            """
            INSERT INTO payment_transactions(id, sepay_id, user_id, amount, currency, gateway, content, reference_code, status, created_at)
            VALUES(?, ?, ?, ?, 'VND', ?, ?, ?, 'completed', ?)
            """,
            (tx_id, trans_id or None, matched_user_id, amount_in, gateway, content, ref_code, now_ts)
        )

    return {
        "success": True,
        "transaction_id": tx_id,
        "amount": amount_in,
        "matched_user": matched_email or matched_user_id,
        "message": "Payment verified and recorded successfully"
    }
