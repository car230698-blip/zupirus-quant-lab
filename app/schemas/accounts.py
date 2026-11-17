"""Trading account schemas for Direct Cloud MT5 execution."""
from typing import Optional, Literal
from pydantic import BaseModel, Field, model_validator


class TradingAccountCreate(BaseModel):
    login: Optional[str] = None
    mt5_login: Optional[str] = None
    password: Optional[str] = None
    mt5_password: Optional[str] = None
    server: Optional[str] = None
    mt5_server: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = "My MT5 Account"
    platform: Literal['mt5', 'mt4'] = 'mt5'
    connection_type: Optional[str] = "CLOUD_METAAPI"
    risk_multiplier: Optional[float] = Field(default=None, ge=0.01, le=10.0)
    lot_multiplier: Optional[float] = Field(default=None, ge=0.01, le=10.0)
    is_compounding: bool = False
    is_prop_firm_mode: bool = False
    prop_stage: Literal["CHALLENGE", "LIVE"] = "CHALLENGE"
    max_daily_dd_pct: Optional[float] = None
    prop_daily_dd_limit_pct: float = Field(default=4.5, ge=0.5, le=20.0)
    prop_profit_target_pct: float = Field(default=8.0, ge=1.0, le=50.0)
    disclaimer_accepted: Optional[bool] = False

    @model_validator(mode="before")
    def resolve_fields(cls, values):
        if not isinstance(values, dict):
            return values

        # 1. Resolve login
        login_val = values.get("login") or values.get("mt5_login") or values.get("account_id")
        if login_val is not None:
            values["login"] = str(login_val).strip()
            values["mt5_login"] = str(login_val).strip()

        # 2. Resolve password
        pwd_val = values.get("password") or values.get("mt5_password")
        if pwd_val is not None:
            values["password"] = str(pwd_val)
            values["mt5_password"] = str(pwd_val)

        # 3. Resolve server
        srv_val = values.get("server") or values.get("mt5_server")
        if srv_val is not None:
            values["server"] = str(srv_val).strip()
            values["mt5_server"] = str(srv_val).strip()

        # 4. Resolve lot / risk multiplier
        mult = values.get("risk_multiplier") if values.get("risk_multiplier") is not None else values.get("lot_multiplier")
        if mult is not None:
            try:
                m_float = float(mult)
                values["risk_multiplier"] = m_float
                values["lot_multiplier"] = m_float
            except (ValueError, TypeError):
                values["risk_multiplier"] = 1.0
                values["lot_multiplier"] = 1.0
        else:
            values["risk_multiplier"] = 1.0
            values["lot_multiplier"] = 1.0

        # 5. Resolve daily DD limit
        dd = values.get("prop_daily_dd_limit_pct") if values.get("prop_daily_dd_limit_pct") is not None else values.get("max_daily_dd_pct")
        if dd is not None:
            try:
                d_float = float(dd)
                values["prop_daily_dd_limit_pct"] = d_float
                values["max_daily_dd_pct"] = d_float
            except (ValueError, TypeError):
                pass

        return values

    @model_validator(mode="after")
    def validate_required_credentials(self):
        if not self.login:
            raise ValueError("Mã đăng nhập MT5 (Login ID) là bắt buộc.")
        if not self.password:
            raise ValueError("Mật khẩu giao dịch MT5 là bắt buộc.")
        if not self.server:
            raise ValueError("Máy chủ sàn (Broker Server) là bắt buộc.")
        return self



class TradingAccountUpdate(BaseModel):
    risk_multiplier: Optional[float] = Field(default=None, ge=0.01, le=10.0)
    lot_multiplier: Optional[float] = Field(default=None, ge=0.01, le=10.0)
    max_lot: Optional[float] = Field(default=None, ge=0.01, le=50.0)
    is_compounding: Optional[bool] = None
    is_prop_firm_mode: Optional[bool] = None
    prop_stage: Optional[Literal["CHALLENGE", "LIVE"]] = None
    auto_be_partial_tp: Optional[bool] = None
    prop_daily_dd_limit_pct: Optional[float] = Field(default=None, ge=0.5, le=20.0)
    max_daily_dd_pct: Optional[float] = Field(default=None, ge=0.5, le=20.0)
    prop_profit_target_pct: Optional[float] = Field(default=None, ge=1.0, le=50.0)
    daily_profit_target_usd: Optional[float] = None
    symbol_mapping_custom: Optional[str] = None
    auto_trade: Optional[bool] = None

    @model_validator(mode="before")
    def resolve_update_fields(cls, values):
        if isinstance(values, dict):
            if values.get("risk_multiplier") is None and values.get("lot_multiplier") is not None:
                values["risk_multiplier"] = values["lot_multiplier"]
            if values.get("prop_daily_dd_limit_pct") is None and values.get("max_daily_dd_pct") is not None:
                values["prop_daily_dd_limit_pct"] = values["max_daily_dd_pct"]
        return values


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
    prop_stage: Literal["CHALLENGE", "LIVE"] = "CHALLENGE"
    auto_be_partial_tp: bool = False
    prop_daily_dd_limit_pct: float = 4.5
    prop_profit_target_pct: float = 8.0
    auto_trade: bool = True
    account_type: str = "STANDARD"
    currency: str = "USD"
    contract_size: float = 100.0
    latency_ms: int = 35
    balance: float = 0.0
    equity: float = 0.0
    last_sync: Optional[float] = None
    created_at: float

