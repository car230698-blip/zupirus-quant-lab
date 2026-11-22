"""
ZUPIRUS Quant Lab - NOWPayments International Cryptocurrency Gateway Engine
Enables USDT payments (TRC20 / BEP20 / ERC20) alongside domestic SePay VietQR.
Provides invoice generation and HMAC-SHA512 IPN signature verification.
"""
from __future__ import annotations

import hmac
import hashlib
import json
import logging
import os
import urllib.request
import urllib.error
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("zupirus.billing.nowpayments")

NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1"


def get_nowpayments_api_key() -> str:
    """Load NOWPayments API key strictly from environment. Returns empty string if unconfigured."""
    return os.getenv("NOWPAYMENTS_API_KEY", "").strip()


def get_nowpayments_ipn_secret() -> str:
    """Load NOWPayments IPN Secret Key strictly from environment. Returns empty string if unconfigured."""
    return os.getenv("NOWPAYMENTS_IPN_SECRET", "").strip()


def verify_nowpayments_signature(
    raw_payload: Dict[str, Any] | bytes,
    signature_header: Optional[str],
    ipn_secret: Optional[str] = None,
) -> bool:
    """
    Verify NOWPayments IPN HMAC-SHA512 signature.
    Per NOWPayments official documentation:
    1. Parse the JSON body.
    2. Sort all dictionary keys alphabetically.
    3. Serialize back to JSON with no whitespace (separators=(',', ':')).
    4. Compute HMAC-SHA512 using the IPN Secret Key.
    5. Compare against the 'x-nowpayments-sig' HTTP header using constant-time comparison.
    """
    secret = (ipn_secret or get_nowpayments_ipn_secret()).strip()
    if not secret:
        logger.warning("NOWPAYMENTS_IPN_SECRET not configured. Rejecting webhook.")
        return False

    if not signature_header or not signature_header.strip():
        logger.warning("Missing x-nowpayments-sig header.")
        return False

    try:
        if isinstance(raw_payload, (bytes, bytearray)):
            parsed = json.loads(raw_payload.decode("utf-8"))
        elif isinstance(raw_payload, dict):
            parsed = raw_payload
        else:
            return False

        # Sort dictionary keys recursively if needed, but NOWPayments IPN is a flat JSON dict
        sorted_keys = sorted(parsed.keys())
        sorted_dict = {k: parsed[k] for k in sorted_keys}
        serialized = json.dumps(sorted_dict, separators=(",", ":"), ensure_ascii=False)

        computed = hmac.new(
            secret.encode("utf-8"),
            serialized.encode("utf-8"),
            hashlib.sha512
        ).hexdigest()

        return hmac.compare_digest(computed.lower(), signature_header.strip().lower())
    except Exception as exc:
        logger.error(f"Error verifying NOWPayments signature: {exc}")
        return False


def create_nowpayments_invoice(
    order_id: str,
    price_amount: float,
    price_currency: str = "usd",
    order_description: str = "ZUPIRUS Quant Lab Plan Subscription",
    ipn_callback_url: Optional[str] = None,
    success_url: str = "https://app.zupirus.com/",
    cancel_url: str = "https://app.zupirus.com/",
) -> Dict[str, Any]:
    """
    Create a payment invoice on NOWPayments REST API.
    Returns invoice dictionary containing 'invoice_url' and 'id'.
    Fails safely if API key is not configured or HTTP fails.
    """
    api_key = get_nowpayments_api_key()
    if not api_key:
        logger.warning("NOWPAYMENTS_API_KEY is not configured. Cannot create crypto invoice.")
        return {
            "ok": False,
            "error": "NOWPAYMENTS_API_KEY_NOT_CONFIGURED",
            "message": "Cổng thanh toán USDT chưa được cấu hình API Key.",
        }

    callback_url = ipn_callback_url or os.getenv(
        "NOWPAYMENTS_IPN_URL",
        "https://zupirus.com/api/v1/billing/webhooks/nowpayments"
    )

    payload = {
        "price_amount": float(price_amount),
        "price_currency": price_currency.lower(),
        "order_id": order_id,
        "order_description": order_description,
        "ipn_callback_url": callback_url,
        "success_url": success_url,
        "cancel_url": cancel_url,
    }

    req = urllib.request.Request(
        f"{NOWPAYMENTS_API_URL}/invoice",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "User-Agent": "ZupirusQuantLab/0.2.0 (NOWPaymentsEngine)",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {
                "ok": True,
                "invoice_id": data.get("id"),
                "invoice_url": data.get("invoice_url"),
                "raw": data,
            }
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        logger.error(f"NOWPayments API HTTP error {e.code}: {err_body}")
        return {
            "ok": False,
            "status_code": e.code,
            "error": "NOWPAYMENTS_API_ERROR",
            "detail": err_body,
        }
    except Exception as e:
        logger.error(f"Failed to create NOWPayments invoice: {e}")
        return {
            "ok": False,
            "error": "NOWPAYMENTS_REQUEST_FAILED",
            "detail": str(e),
        }
