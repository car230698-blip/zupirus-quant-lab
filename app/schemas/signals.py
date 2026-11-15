"""Signal schemas and normalization contracts."""
from typing import Literal, Optional, Dict, Any
from pydantic import BaseModel, Field


class NormalizedSignalSchema(BaseModel):
    id: str
    source: str = "TRADINGVIEW"
    strategy_tier: Literal['STANDARD', 'ALPHA'] = 'STANDARD'
    symbol: str = "XAUUSD"
    action: Literal['BUY', 'SELL']
    entry_price: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    created_at: float = Field(default_factory=lambda: 0.0)
    raw_payload: Optional[Dict[str, Any]] = None


class TradingViewWebhookPayload(BaseModel):
    ticker: Optional[str] = None
    symbol: Optional[str] = None
    action: str
    price: float
    sl: Optional[float] = None
    tp: Optional[float] = None
    strategy: Optional[str] = "STANDARD"
    secret: Optional[str] = None

