"""Trading account schemas for Direct Cloud MT5 execution."""
from typing import Optional, Literal
from pydantic import BaseModel, Field


class TradingAccountCreate(BaseModel):
    login: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    server: str = Field(min_length=1, max_length=128)
    account_name: Optional[str] = "My MT5 Account"
    platform: Literal['mt5', 'mt4'] = 'mt5'
    risk_multiplier: float = Field(default=1.0, ge=0.1, le=5.0)
    is_compounding: bool = False
    is_prop_firm_mode: bool = False
    prop_daily_dd_limit_pct: float = Field(default=4.5, ge=1.0, le=10.0)
    prop_profit_target_pct: float = Field(default=8.0, ge=2.0, le=20.0)


class TradingAccountUpdate(BaseModel):
    risk_multiplier: Optional[float] = Field(default=None, ge=0.1, le=5.0)
    is_compounding: Optional[bool] = None
    is_prop_firm_mode: Optional[bool] = None
    prop_daily_dd_limit_pct: Optional[float] = Field(default=None, ge=1.0, le=10.0)
    prop_profit_target_pct: Optional[float] = Field(default=None, ge=2.0, le=20.0)
    auto_trade: Optional[bool] = None


class TradingAccountResponse(BaseModel):
    id: str
    mt5_login: str
    broker_server: str
    account_name: Optional[str] = None
    deployment_state: str
    cloud_expires_at: Optional[float] = None
    is_cloud_active: bool = False
    risk_multiplier: float = 1.0
    is_compounding: bool = False
    is_prop_firm_mode: bool = False
    prop_daily_dd_limit_pct: float = 4.5
    prop_profit_target_pct: float = 8.0
    auto_trade: bool = True
    balance: float = 0.0
    equity: float = 0.0
    last_sync: Optional[float] = None
    created_at: float
