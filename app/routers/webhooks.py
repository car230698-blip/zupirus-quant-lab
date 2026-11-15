"""Webhook handlers for external signal providers (TradingView) and SePay banking payments."""
import time
import re
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
    # 1. Authenticate secret token
    provided_secret = p.secret or secret
    if provided_secret != TRADINGVIEW_WEBHOOK_SECRET:
        logger.warning("Unauthorized TradingView webhook attempt: invalid secret token")
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    now_ts = time.time()

    # 2. Normalize signal
    try:
        norm_signal = normalize_tradingview_signal(p)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Signal normalization error: {e}")

    # 3. Determine live reference price for Gold
    live_price = norm_signal.entry_price
    with tx() as c:
        q = c.execute("SELECT bid, ask FROM quotes ORDER BY ts DESC LIMIT 1").fetchone()
        if q:
            live_price = round((float(q["bid"]) + float(q["ask"])) / 2.0, 2)

    # 4. Pass through 4 Mandatory Safety Guards
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

    # 5. Query active accounts entitled to receive this signal
    with tx() as c:
        # Accounts must have active service subscription AND active cloud slot
        query = """
            SELECT
                a.id, a.user_id, a.metaapi_account_id, a.balance, a.equity,
                a.risk_multiplier, a.is_compounding, a.is_prop_firm_mode,
                a.prop_daily_dd_limit_pct, a.prop_profit_target_pct,
                s.plan_tier, s.allow_alpha_strategies
            FROM trading_accounts a
            JOIN subscriptions s ON s.user_id = a.user_id
            WHERE a.auto_trade = 1
              AND a.deployment_state = 'DEPLOYED'
              AND s.service_expires_at > ?
              AND (a.cloud_expires_at IS NULL OR a.cloud_expires_at > ?)
        """
        rows = c.execute(query, (now_ts, now_ts)).fetchall()

    eligible_accounts = []
    for r in rows:
        d = dict(r)
        # If strategy is ALPHA, verify user subscription permits ALPHA strategies
        if sanitized_signal.strategy_tier == "ALPHA" and not d.get("allow_alpha_strategies"):
            continue
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
async def handle_sepay_webhook(
    request: Request,
    authorization: str = Header(default=""),
):
    """Handle SePay VietQR payment webhook and automatically fulfill order."""
    # Check SePay secret authorization if configured
    if SEPAY_WEBHOOK_SECRET:
        token = authorization.replace("Apikey ", "").strip()
        if token != SEPAY_WEBHOOK_SECRET:
            logger.warning("Invalid SePay webhook authorization token")
            raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    content = payload.get("content") or payload.get("description") or ""
    trans_id = str(payload.get("id") or payload.get("transaction_id") or time.time())
    logger.info(f"Received SePay transaction: ID={trans_id}, Content='{content}'")

    # Match order pattern: "ZP <order_suffix>" or "ORD_<suffix>"
    match = re.search(r"ZP\s*([A-F0-9]{6})", content.upper())
    if not match:
        match = re.search(r"ORD_([A-F0-9]+)", content.upper())

    if not match:
        logger.warning(f"Could not extract order code from SePay memo: '{content}'")
        return {"success": False, "message": "No matching order code pattern found"}

    order_suffix = match.group(1).lower()
    success = await process_successful_payment(order_suffix, sepay_trans_id=trans_id)

    return {"success": success, "order_key": order_suffix}
