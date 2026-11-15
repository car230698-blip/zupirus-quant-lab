"""Liquidity & Spread Auditor tool.
Audits Stop Loss triggers to classify root causes: TREND_FAIL, SPREAD_SPIKE_ROLLOVER, or LIQUIDITY_SWEEP.
Purely analytical — does not open or modify trade orders.
"""
import time
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from app.db import tx


def audit_liquidity_and_spread(
    symbol: str = "XAUUSD",
    stop_loss: float = 0.0,
    exit_price: float = 0.0,
    exit_time: Optional[float] = None,
    entry_price: float = 0.0,
    side: str = "BUY"
) -> Dict[str, Any]:
    """Audit trade exit to categorize whether loss was structural or execution friction."""
    now_ts = exit_time or time.time()
    dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    hour = dt.hour + (dt.minute / 60.0)

    # 1. Check rollover hours (21:45 to 23:15 UTC)
    is_rollover = (21.75 <= hour <= 23.25)

    # 2. Query spread around exit time if available
    observed_spread_pips = 3.5
    try:
        with tx() as c:
            row = c.execute(
                """
                SELECT bid, ask FROM quotes
                WHERE symbol = ? AND ts BETWEEN ? AND ?
                ORDER BY ts DESC LIMIT 1
                """,
                (symbol, now_ts - 300, now_ts + 60)
            ).fetchone()
            if row and row[0] and row[1]:
                diff = abs(float(row[1]) - float(row[0]))
                observed_spread_pips = round(diff * (10 if "XAU" in symbol else 10000), 1)
    except Exception:
        observed_spread_pips = 3.5

    # 3. Calculate distance between exit and stop loss
    diff_val = abs(exit_price - stop_loss) if stop_loss > 0 else 0.0
    mult = 10 if "XAU" in symbol or "GOLD" in symbol else 10000
    dist_pips = round(diff_val * mult, 1)

    # 4. Diagnose loss category
    if is_rollover or observed_spread_pips >= (6.0 if "XAU" in symbol else 3.5):
        category = "SPREAD_SPIKE_ROLLOVER"
        notes = (
            f"Lệnh bị đóng trong khung giờ giao phiên / giãn spread ({observed_spread_pips} pips). "
            f"Giá mid thị trường có thể chưa thực sự phá vỡ cấu trúc kỹ thuật."
        )
    elif dist_pips <= 3.5 and dist_pips >= 0.0:
        category = "LIQUIDITY_SWEEP"
        notes = (
            f"Vị thế chỉ bị quét qua SL {dist_pips} pips. Mô hình điển hình của Liquidity Sweep "
            f"(quét cụm SL trước khi đảo chiều). Khuyến nghị cộng thêm 0.3x ATR vùng đệm."
        )
    else:
        category = "TREND_FAIL"
        notes = (
            f"Giá phá vỡ dứt khoát qua ngưỡng Stop Loss {dist_pips} pips. "
            f"Chiến lược định hướng sai so với đà di chuyển thực tế của thị trường."
        )

    return {
        "symbol": symbol,
        "loss_category": category,
        "side": side,
        "stop_loss": stop_loss,
        "exit_price": exit_price,
        "distance_to_sl_pips": dist_pips,
        "max_spread_observed": observed_spread_pips,
        "is_rollover_hour": is_rollover,
        "audit_notes": notes,
        "timestamp": now_ts,
    }
