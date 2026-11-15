"""Admin Billing Settings, Bank & VietQR Configuration, Exchange Rate Management."""
import json
import logging
from typing import Optional, List, Dict, Any
from urllib.parse import quote
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException

from app.db import tx
from app.routers.deps import get_current_admin, fail
from app.config import (
    SEPAY_BANK_NAME,
    SEPAY_ACCOUNT_NUMBER,
    SEPAY_ACCOUNT_HOLDER,
    CLOUD_SLOT_MONTHLY_USD,
)
from app.services.fx_rate import get_usd_vnd_rate, REDIS_FX_KEY
from app.redis_client import get_redis_client

logger = logging.getLogger("zupirus.admin_billing")

router = APIRouter(prefix="/api/admin/billing", tags=["Admin Billing & VietQR Settings"])

SUPPORTED_BANKS = [
    {"code": "ICB", "shortName": "VietinBank", "name": "Ngân hàng TMCP Công thương Việt Nam"},
    {"code": "MB", "shortName": "MBBank", "name": "Ngân hàng TMCP Quân đội"},
    {"code": "VCB", "shortName": "Vietcombank", "name": "Ngân hàng TMCP Ngoại thương Việt Nam"},
    {"code": "TCB", "shortName": "Techcombank", "name": "Ngân hàng TMCP Kỹ thương Việt Nam"},
    {"code": "ACB", "shortName": "ACB", "name": "Ngân hàng TMCP Á Châu"},
    {"code": "VPB", "shortName": "VPBank", "name": "Ngân hàng TMCP Việt Nam Thịnh Vượng"},
    {"code": "TPB", "shortName": "TPBank", "name": "Ngân hàng TMCP Tiên Phong"},
    {"code": "BIDV", "shortName": "BIDV", "name": "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam"},
    {"code": "STB", "shortName": "Sacombank", "name": "Ngân hàng TMCP Sài Gòn Thương Tín"},
    {"code": "HDB", "shortName": "HDBank", "name": "Ngân hàng TMCP Phát triển TP.HCM"},
]


class BillingSettingsUpdate(BaseModel):
    bank_name: str = Field(..., min_length=2)
    account_number: str = Field(..., min_length=4)
    account_holder: str = Field(..., min_length=2)
    content_prefix: str = Field("ZP", min_length=1, max_length=10)
    fx_mode: str = Field("AUTO", description="AUTO or MANUAL")
    manual_fx_rate: float = Field(25600.0, gt=1000.0)


class PreviewQRRequest(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder: Optional[str] = None
    amount_vnd: int = Field(772000, gt=0)
    content_memo: str = Field("ZP TESTQR", min_length=2)


@router.get("/settings")
def get_billing_settings(_admin=Depends(get_current_admin)):
    """Retrieve active bank configuration, memo prefix, and USD/VND conversion mode."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:settings'").fetchone()
        saved = json.loads(row[0]) if row else {}

    bank_name = saved.get("bank_name", SEPAY_BANK_NAME)
    account_number = saved.get("account_number", SEPAY_ACCOUNT_NUMBER)
    account_holder = saved.get("account_holder", SEPAY_ACCOUNT_HOLDER)
    content_prefix = saved.get("content_prefix", "ZP")
    fx_mode = saved.get("fx_mode", "AUTO")
    manual_fx_rate = float(saved.get("manual_fx_rate", 25600.0))

    rate, source, is_cached = get_usd_vnd_rate()

    return {
        "bank_name": bank_name,
        "account_number": account_number,
        "account_holder": account_holder,
        "content_prefix": content_prefix,
        "fx_mode": fx_mode,
        "manual_fx_rate": manual_fx_rate,
        "current_fx_rate": rate,
        "fx_source": source,
        "fx_is_cached": is_cached,
        "supported_banks": SUPPORTED_BANKS,
    }


@router.post("/settings")
def update_billing_settings(req: BillingSettingsUpdate, _admin=Depends(get_current_admin)):
    """Save bank configuration and USD/VND exchange rate settings."""
    payload = {
        "bank_name": req.bank_name.strip(),
        "account_number": req.account_number.strip(),
        "account_holder": req.account_holder.strip().upper(),
        "content_prefix": req.content_prefix.strip().upper(),
        "fx_mode": req.fx_mode.upper(),
        "manual_fx_rate": req.manual_fx_rate,
    }

    with tx() as c:
        c.execute(
            """
            INSERT INTO kv (key, value) VALUES ('billing:settings', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (json.dumps(payload),)
        )

    # If manual mode, update Redis cache directly
    if req.fx_mode.upper() == "MANUAL":
        try:
            r = get_redis_client()
            if r:
                r.set(REDIS_FX_KEY, str(req.manual_fx_rate), ex=86400 * 7)
        except Exception as e:
            logger.warning(f"Could not write manual FX rate to Redis: {e}")

    return {"message": "Cấu hình thanh toán SePay và tỷ giá đã được lưu thành công.", "settings": payload}


@router.post("/preview-qr")
def generate_preview_qr(req: PreviewQRRequest, _admin=Depends(get_current_admin)):
    """Generate live preview URLs for SePay VietQR and fallback VietQR."""
    bank = req.bank_name or SEPAY_BANK_NAME
    acc = req.account_number or SEPAY_ACCOUNT_NUMBER
    holder = req.account_holder or SEPAY_ACCOUNT_HOLDER
    encoded_memo = quote(req.content_memo)
    encoded_holder = quote(holder)

    sepay_qr = f"https://qr.sepay.vn/img?acc={acc}&bank={bank}&amount={req.amount_vnd}&des={encoded_memo}"
    vietqr_qr = f"https://img.vietqr.io/image/{bank}-{acc}-compact2.png?amount={req.amount_vnd}&addInfo={encoded_memo}&accountName={encoded_holder}"

    return {
        "sepay_qr_url": sepay_qr,
        "vietqr_qr_url": vietqr_qr,
        "bank_name": bank,
        "account_number": acc,
        "account_holder": holder,
        "amount_vnd": req.amount_vnd,
        "content_memo": req.content_memo,
    }


@router.post("/flush-fx-cache")
def flush_fx_cache(_admin=Depends(get_current_admin)):
    """Flush the USD/VND exchange rate from Redis cache and refresh from live provider."""
    try:
        r = get_redis_client()
        if r:
            r.delete(REDIS_FX_KEY)
            r.delete(f"{REDIS_FX_KEY}:updated_at")
    except Exception as e:
        logger.warning(f"Could not delete Redis FX keys: {e}")

    rate, source, _ = get_usd_vnd_rate(force_refresh=True)
    return {"message": "Đã làm mới bộ nhớ đệm tỷ giá USD/VND thành công.", "new_rate": rate, "source": source}
