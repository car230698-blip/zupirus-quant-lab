"""Signal ingestion normalizers for TradingView and MetaApi Demo feeds."""
import time
import secrets
from typing import Dict, Any
from app.schemas.signals import NormalizedSignalSchema, TradingViewWebhookPayload
from app.services.symbol_precision import digits_for_symbol


def normalize_tradingview_signal(p: TradingViewWebhookPayload) -> NormalizedSignalSchema:
    """Normalize TradingView webhook payload into NormalizedSignalSchema."""
    import hashlib
    symbol = (p.ticker or p.symbol or "XAUUSD").strip().upper()
    action = p.action.strip().upper()
    if action not in ("BUY", "SELL"):
        raise ValueError(f"Invalid order action: {p.action}. Must be BUY or SELL.")

    strategy_tier = "ALPHA" if (p.strategy or "").strip().upper() == "ALPHA" else "STANDARD"
    now_ts = time.time()

    # Deterministic signal deduplication key over 60s window if no explicit id is supplied
    source_name = getattr(p, "source", None) or (p.strategy if p.strategy and p.strategy != "STANDARD" else "TRADINGVIEW")
    time_bucket_60s = int(now_ts // 60)
    dec = digits_for_symbol(symbol)
    raw_sig_str = f"{source_name}:{symbol}:{action}:{round(float(p.price), dec)}:{p.sl}:{p.tp}:{time_bucket_60s}"
    sig_hash = hashlib.sha256(raw_sig_str.encode("utf-8")).hexdigest()[:12]
    sid = f"tv_{sig_hash}"

    return NormalizedSignalSchema(
        id=sid,
        source=source_name,
        strategy_tier=strategy_tier,
        symbol=symbol,
        action=action, # type: ignore
        entry_price=round(float(p.price), dec),
        stop_loss=round(float(p.sl), dec) if p.sl is not None else None,
        take_profit=round(float(p.tp), dec) if p.tp is not None else None,
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

    dec = digits_for_symbol(symbol)
    return NormalizedSignalSchema(
        id=sid,
        source="METAAPI_DEMO",
        strategy_tier="STANDARD",
        symbol=symbol,
        action=action, # type: ignore
        entry_price=round(price, dec),
        stop_loss=round(sl, dec) if sl is not None else None,
        take_profit=round(tp, dec) if tp is not None else None,
        created_at=now_ts,
        raw_payload=data,
    )

