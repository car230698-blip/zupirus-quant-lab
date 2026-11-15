"""Macro News Interpreter tool.
Queries USD economic calendar to assess proximity to high-impact releases.
Purely analytical — does not open or modify trade orders.
"""
import time
from typing import Dict, Any, Optional
from app.db import tx


def interpret_macro_news(
    current_time: Optional[float] = None,
    currency: str = "USD",
    window_hours: float = 4.0
) -> Dict[str, Any]:
    """Analyze economic news calendar and compute distance to highest-impact macro release."""
    now_ts = current_time or time.time()
    min_dist_mins = 999.0
    nearest_title = None
    nearest_impact = "NONE"

    try:
        with tx() as c:
            rows = c.execute(
                """
                SELECT title, currency, impact, ts
                FROM news
                WHERE currency = ? AND abs(ts - ?) <= ?
                ORDER BY abs(ts - ?) ASC
                LIMIT 5
                """,
                (currency, now_ts, window_hours * 3600.0, now_ts)
            ).fetchall()

            for r in rows:
                title = r["title"] if hasattr(r, 'keys') else r[0]
                impact = (r["impact"] if hasattr(r, 'keys') else r[2]).upper()
                news_ts = float(r["ts"] if hasattr(r, 'keys') else r[3])
                dist = abs(news_ts - now_ts) / 60.0

                if impact == "HIGH" and dist < min_dist_mins:
                    min_dist_mins = dist
                    nearest_title = title
                    nearest_impact = impact
    except Exception:
        min_dist_mins = 999.0

    # Risk categorization
    if min_dist_mins <= 30.0:
        status = "BLACKOUT_HIGH_RISK"
        rec = "Khoảng cách tới tin đỏ dưới 30 phút. Bắt buộc kích hoạt News Shield để chặn rủi ro trượt giá."
        is_safe = False
    elif min_dist_mins <= 60.0:
        status = "PRE_NEWS_VOLATILITY"
        rec = "Sắp có tin kinh tế vĩ mô trong 1 giờ. Thanh khoản có thể mỏng đi và spread có xu hướng nới rộng."
        is_safe = True
    else:
        status = "CLEAR_MACRO_WINDOW"
        rec = "Bối cảnh vĩ mô bình thường, không có tin tức USD tác động mạnh trong vùng lân cận."
        is_safe = True

    return {
        "currency": currency,
        "nearest_event_title": nearest_title or "Không có tin USD tác động mạnh",
        "nearest_impact": nearest_impact,
        "distance_minutes": round(min_dist_mins, 1),
        "is_in_blackout": min_dist_mins <= 30.0,
        "risk_status": status,
        "is_safe_for_execution": is_safe,
        "recommendation": rec,
        "timestamp": now_ts,
    }
