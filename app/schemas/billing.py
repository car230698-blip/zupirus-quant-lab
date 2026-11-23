"""Billing, FX rate, and subscription data schemas."""
from typing import Literal, Optional, Any
from pydantic import BaseModel, Field, model_validator

PlanTier = Literal['starter', 'growth', 'alpha']

_TIER_MAP = {
    'starter': 'starter',
    'growth': 'growth',
    'pro': 'growth',
    'quant_pro': 'growth',
    'alpha': 'alpha',
    'institutional': 'alpha',
    'vip': 'alpha',
    'fund_vip': 'alpha',
}


def normalize_plan_tier(raw: Any) -> str:
    if not raw:
        return 'starter'
    s = str(raw).strip().lower()
    return _TIER_MAP.get(s, s)


class ExchangeRateResponse(BaseModel):
    base: str = "USD"
    target: str = "VND"
    rate: float
    source: str
    is_cached: bool
    updated_at: float


class CreateOrderRequest(BaseModel):
    plan_tier: PlanTier
    cloud_slots: int = Field(default=1, ge=1, le=20)
    cloud_accounts_count: Optional[int] = None
    billing_cycle: Optional[str] = None
    payment_method: Optional[str] = "SEPAY"

    @model_validator(mode="before")
    def resolve_fields(cls, values):
        if isinstance(values, dict):
            if "plan_tier" in values:
                values["plan_tier"] = normalize_plan_tier(values["plan_tier"])
            if values.get("cloud_accounts_count") is not None and not values.get("cloud_slots"):
                values["cloud_slots"] = values["cloud_accounts_count"]
        return values


class OrderResponse(BaseModel):
    id: str
    order_id: Optional[str] = None
    order_code: Optional[str] = None
    plan_tier: PlanTier
    cloud_slots_count: int
    amount_usd: float
    locked_exchange_rate: float
    amount_vnd: int
    paid_amount_vnd: int = 0
    status: Literal['PENDING', 'UNDERPAID', 'PAID', 'EXPIRED']
    payment_status: str = "PENDING"
    entitlement_status: str = "PENDING"
    cloud_deploy_status: str = "PENDING"
    currency: Optional[str] = "VND"
    payment_gateway: Optional[str] = "SEPAY"
    expected_amount_usdt: Optional[float] = None
    amount_usdt: Optional[float] = None
    wallet_address: Optional[str] = None
    crypto_network: Optional[str] = None
    tx_hash: Optional[str] = None
    invoice_url: Optional[str] = None
    external_payment_id: Optional[str] = None
    qr_code_url: Optional[str] = None
    qr_url: Optional[str] = None
    account_number: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder: Optional[str] = None
    payment_content: Optional[str] = None
    expires_at: float
    created_at: float

    @model_validator(mode="before")
    def ensure_aliases(cls, values):
        if isinstance(values, dict):
            if "plan_tier" in values:
                values["plan_tier"] = normalize_plan_tier(values["plan_tier"])
            order_id = values.get("id") or values.get("order_id") or ""
            if not values.get("order_id"):
                values["order_id"] = order_id
            if not values.get("order_code"):
                values["order_code"] = order_id
            if values.get("paid_amount_vnd") is None:
                values["paid_amount_vnd"] = int(values.get("amount_vnd") or 0) if values.get("status") == "PAID" else 0
            if not values.get("payment_status"):
                values["payment_status"] = values.get("status") or "PENDING"
            if not values.get("entitlement_status"):
                values["entitlement_status"] = "GRANTED" if values.get("status") == "PAID" else "PENDING"
            if not values.get("cloud_deploy_status"):
                values["cloud_deploy_status"] = "DEPLOYED" if values.get("status") == "PAID" else "PENDING"
            qr = values.get("qr_code_url") or values.get("qr_url")
            if not values.get("qr_url"):
                values["qr_url"] = qr
            if not values.get("qr_code_url"):
                values["qr_code_url"] = qr
        return values


class SubscriptionResponse(BaseModel):
    plan_tier: PlanTier
    service_expires_at: Optional[float] = None
    is_active: bool
    status: str = "ACTIVE"
    max_mt5_accounts: int
    max_cloud_accounts: int = 1
    allow_custom_multiplier: bool
    allow_compounding: bool
    allow_partial_tp_be: bool
    allow_prop_firm_mode: bool
    allow_alpha_strategies: bool
    connected_accounts_count: int = 0

    @model_validator(mode="before")
    def normalize_sub(cls, values):
        if isinstance(values, dict):
            if "plan_tier" in values:
                values["plan_tier"] = normalize_plan_tier(values["plan_tier"])
            raw_m = values.get("max_mt5_accounts")
            if raw_m is None:
                raw_m = values.get("max_cloud_accounts")
            max_acc = int(raw_m) if raw_m is not None else 0
            values["max_mt5_accounts"] = max_acc
            values["max_cloud_accounts"] = max_acc
            if not values.get("status"):
                values["status"] = "ACTIVE" if values.get("is_active", False) else "CHƯA KÍCH HOẠT"
        return values

