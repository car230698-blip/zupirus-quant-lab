"""Signal ingestion normalizers for TradingView and MetaApi Demo feeds."""
import time
import secrets
from typing import Dict, Any
from app.schemas.signals import NormalizedSignalSchema, TradingViewWebhookPayload


def normalize_tradingview_signal(p: TradingViewWebhookPayload) -> NormalizedSignalSchema:
    """Normalize TradingView webhook payload into NormalizedSignalSchema."""
    symbol = (p.ticker or p.symbol or "XAUUSD").strip().upper()
    action = p.action.strip().upper()
    if action not in ("BUY", "SELL"):
        raise ValueError(f"Invalid order action: {p.action}. Must be BUY or SELL.")

    strategy_tier = "ALPHA" if (p.strategy or "").strip().upper() == "ALPHA" else "STANDARD"
    now_ts = time.time()
    sid = f"tv_{secrets.token_hex(6)}"

    return NormalizedSignalSchema(
        id=sid,
        source="TRADINGVIEW",
        strategy_tier=strategy_tier,
        symbol=symbol,
        action=action, # type: ignore
        entry_price=round(float(p.price), 2),
        stop_loss=round(float(p.sl), 2) if p.sl is not None else None,
        take_profit=round(float(p.tp), 2) if p.tp is not None else None,
        created_at=now_ts,
        raw_payload=p.model_dump(),
    )


def normalize_metaapi_demo_signal(data: Dict[str, Any]) -> NormalizedSignalSchema:
    """Normalize a MetaApi demo terminal order event into NormalizedSignalSchema."""
    symbol = (data.get("symbol") or "XAUUSD").strip().upper()
    order_type = str(data.get("type") or data.get("action") or "ORDER_TYPE_BUY").upper()
    action = "BUY" if "BUY" in order_type else "SELL"
    price = float(data.get("openPrice") or data.get("price") or 2650.0)
    sl = float(data["stopLoss"]) if data.get("stopLoss") else None
    tp = float(data["takeProfit"]) if data.get("takeProfit") else None
    now_ts = time.time()
    sid = f"demo_{secrets.token_hex(6)}"

    return NormalizedSignalSchema(
        id=sid,
        source="METAAPI_DEMO",
        strategy_tier="STANDARD",
        symbol=symbol,
        action=action, # type: ignore
        entry_price=round(price, 2),
        stop_loss=round(sl, 2) if sl is not None else None,
        take_profit=round(tp, 2) if tp is not None else None,
        created_at=now_ts,
        raw_payload=data,
    )
