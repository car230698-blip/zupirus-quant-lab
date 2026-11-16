"""Billing, FX rate, and subscription data schemas."""
from typing import Literal, Optional, List, Dict, Any
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
    status: Literal['PENDING', 'PAID', 'EXPIRED']
    qr_code_url: Optional[str] = None
    qr_url: Optional[str] = None
    account_number: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder: Optional[str] = None
    payment_content: str
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
            max_acc = values.get("max_mt5_accounts") or values.get("max_cloud_accounts") or 1
            values["max_mt5_accounts"] = int(max_acc)
            values["max_cloud_accounts"] = int(max_acc)
            values["status"] = "ACTIVE" if values.get("is_active", True) else "EXPIRED"
        return values

