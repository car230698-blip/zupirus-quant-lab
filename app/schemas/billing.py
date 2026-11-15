"""Billing, FX rate, and subscription data schemas."""
from typing import Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field

PlanTier = Literal['starter', 'growth', 'alpha']


class ExchangeRateResponse(BaseModel):
    base: str = "USD"
    target: str = "VND"
    rate: float
    source: str
    is_cached: bool
    updated_at: float


class CreateOrderRequest(BaseModel):
    plan_tier: PlanTier
    cloud_slots: int = Field(default=1, ge=1, le=10)


class OrderResponse(BaseModel):
    id: str
    plan_tier: PlanTier
    cloud_slots_count: int
    amount_usd: float
    locked_exchange_rate: float
    amount_vnd: int
    status: Literal['PENDING', 'PAID', 'EXPIRED']
    qr_code_url: Optional[str] = None
    account_number: Optional[str] = None
    bank_name: Optional[str] = None
    payment_content: str
    expires_at: float
    created_at: float


class SubscriptionResponse(BaseModel):
    plan_tier: PlanTier
    service_expires_at: Optional[float] = None
    is_active: bool
    max_mt5_accounts: int
    allow_custom_multiplier: bool
    allow_compounding: bool
    allow_partial_tp_be: bool
    allow_prop_firm_mode: bool
    allow_alpha_strategies: bool
    connected_accounts_count: int = 0
