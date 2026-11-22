"""Station 1: Real-time Macro Bias, Yield & Breaking Shock Filter.
Pure Python, 0 LLM tokens, 5s timeout, resilient fallback, and 1-tier decay.
"""
import time
import json
import logging
from typing import Dict, Any, Optional, List

from app.db import tx, getkv, setkv

logger = logging.getLogger("zupirus.macro_station")

SHOCK_KEYWORDS = [
    "nuclear",
    "emergency rate cut",
    "declaring war",
    "martial law",
    "central bank intervention",
]

DEFAULT_MACRO_STATE = {
    "dxy_trend": "FLAT",
    "us10y_trend": "FLAT",
    "shock": None,
    "updated_at": 0.0,
}


PUBLIC_RSS_FEEDS = [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.fxstreet.com/rss/news",
    "https://www.investing.com/rss/news_25.rss",
]


def scan_shock_headlines(headlines: List[str]) -> Optional[str]:
    """Scan news headlines for high-severity black swan keywords.
    Pure Python keyword scanning (0 LLM tokens).
    """
    for hl in headlines:
        hl_clean = hl.lower()
        for kw in SHOCK_KEYWORDS:
            if kw in hl_clean:
                logger.warning(f"MACRO SHOCK DETECTED: headline matched keyword '{kw}': {hl}")
                return "DANGER_FREEZE"
    return None


def get_macro_state(db_cursor=None) -> Dict[str, Any]:
    """Retrieve current macro state from KV storage, with sensible fallback."""
    raw = None
    if db_cursor is not None:
        row = db_cursor.execute("SELECT value FROM kv WHERE key = 'macro:bias_state'").fetchone()
        if row:
            raw = row["value"] if hasattr(row, "keys") else row[0]
    else:
        with tx() as c:
            raw = getkv(c, "macro:bias_state")

    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return dict(DEFAULT_MACRO_STATE)


def save_macro_state(state: Dict[str, Any], db_cursor=None) -> None:
    """Save macro state to KV storage."""
    payload = json.dumps(state)
    if db_cursor is not None:
        db_cursor.execute("INSERT INTO kv (key, value) VALUES ('macro:bias_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (payload,))
    else:
        with tx() as c:
            setkv(c, "macro:bias_state", payload)


async def fetch_macro_bias(
    now_ts: Optional[float] = None,
    mock_dxy: Optional[float] = None,
    mock_us10y: Optional[float] = None,
    mock_headlines: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fetch DXY, US10Y, and breaking news headlines with 5s timeout.
    Falls back gracefully to last known state on failure.
    """
    now = float(now_ts if now_ts is not None else time.time())
    current = get_macro_state()

    # 1. Shock scanning
    shock = current.get("shock")
    shock_source_title = None
    if mock_headlines is not None:
        detected_shock = scan_shock_headlines(mock_headlines)
        shock = detected_shock
        if detected_shock:
            shock_source_title = mock_headlines[0] if mock_headlines else "Shock Event"
    else:
        # RSS / feed fetch with 5s timeout across public financial/gold news feeds
        try:
            import httpx
            import re
            async with httpx.AsyncClient(timeout=5.0) as client:
                for feed_url in PUBLIC_RSS_FEEDS:
                    try:
                        resp = await client.get(feed_url)
                        if resp.status_code == 200:
                            titles = re.findall(r"<title><!\[CDATA\[(.*?)\]\]></title>", resp.text)
                            if not titles:
                                titles = re.findall(r"<title>(.*?)</title>", resp.text)
                            detected = scan_shock_headlines(titles)
                            if detected:
                                shock = detected
                                shock_source_title = titles[0] if titles else "RSS Shock Event"
                                break
                    except Exception as f_err:
                        logger.debug(f"RSS feed {feed_url} error: {f_err}")
        except Exception as exc:
            logger.debug(f"RSS news scan non-fatal error: {exc}")

    # If shock detected and not analyzed yet, invoke Sentinel Agent for concise risk assessment
    if shock == "DANGER_FREEZE" and shock_source_title:
        try:
            from app.domains.ai.gemini_client import call_gemini
            sentinel_prompt = (
                f"Tin tức chấn động vĩ mô nguy hiểm phát hiện: '{shock_source_title}'. "
                f"Đánh giá rủi ro ngắn hạn 1 câu cho thị trường Vàng/Forex (dưới 30 từ)."
            )
            analysis, _ = call_gemini(sentinel_prompt, caller_agent="sentinel")
            if analysis:
                current["shock_analysis"] = analysis
        except Exception as s_err:
            logger.debug(f"Sentinel Agent shock assessment note: {s_err}")

    # 2. DXY and US10Y trend determination
    dxy_trend = current.get("dxy_trend", "FLAT")
    us10y_trend = current.get("us10y_trend", "FLAT")

    if mock_dxy is not None:
        prev_dxy = float(current.get("last_dxy") or mock_dxy)
        diff = mock_dxy - prev_dxy
        if diff > 0.05:
            dxy_trend = "UP"
        elif diff < -0.05:
            dxy_trend = "DOWN"
        else:
            dxy_trend = current.get("dxy_trend", "FLAT")
        current["last_dxy"] = mock_dxy
    else:
        # Live cross-asset intermarket read with 5s timeout & fallback
        try:
            from app.domains.signals.sources.discovery import fetch_cross_asset_context
            ca = fetch_cross_asset_context()
            dxy_info = ca.get("dxy")
            if dxy_info and "price" in dxy_info:
                dxy_val = float(dxy_info["price"])
                chg = float(dxy_info.get("change_pct", 0.0))
                if chg > 0.05:
                    dxy_trend = "UP"
                elif chg < -0.05:
                    dxy_trend = "DOWN"
                else:
                    dxy_trend = "FLAT"
                current["last_dxy"] = dxy_val
        except Exception as dxy_err:
            logger.debug(f"Live DXY read note: {dxy_err}")

    if mock_us10y is not None:
        prev_us10y = float(current.get("last_us10y") or mock_us10y)
        diff = mock_us10y - prev_us10y
        if diff > 0.02:
            us10y_trend = "UP"
        elif diff < -0.02:
            us10y_trend = "DOWN"
        else:
            us10y_trend = current.get("us10y_trend", "FLAT")
        current["last_us10y"] = mock_us10y
    else:
        try:
            if "ca" in locals():
                us10y_info = ca.get("us10y")
                if us10y_info and "price" in us10y_info:
                    us10y_val = float(us10y_info["price"])
                    chg10 = float(us10y_info.get("change_pct", 0.0))
                    if chg10 > 0.02:
                        us10y_trend = "UP"
                    elif chg10 < -0.02:
                        us10y_trend = "DOWN"
                    else:
                        us10y_trend = "FLAT"
                    current["last_us10y"] = us10y_val
        except Exception as us_err:
            logger.debug(f"Live US10Y read note: {us_err}")

    new_state = {
        **current,
        "dxy_trend": dxy_trend,
        "us10y_trend": us10y_trend,
        "shock": shock,
        "updated_at": now,
    }
    save_macro_state(new_state)
    return new_state


def evaluate_macro_filter(
    symbol: str,
    side: str,
    now_ts: Optional[float] = None,
    db_cursor=None,
) -> Dict[str, Any]:
    """Evaluate Macro Shield:
    - If DANGER_FREEZE: block all new trades.
    - If macro data age > 2h (7200s): macro_degraded = True, macro_scale = 0.5x.
    - If DXY is UP and signal is BUY Gold (XAUUSD): dxy_scale = 0.5x.
    - Final risk scale = min(dxy_scale, macro_scale).
    """
    now = float(now_ts if now_ts is not None else time.time())
    state = get_macro_state(db_cursor=db_cursor)

    shock = state.get("shock")
    if shock == "DANGER_FREEZE":
        return {
            "permitted": False,
            "reason": "MACRO_SHOCK_FREEZE",
            "final_scale": 0.0,
            "dxy_scale": 0.0,
            "macro_scale": 0.0,
            "macro_degraded": False,
            "macro_age": round(now - float(state.get("updated_at") or 0.0), 1),
            "shock": shock,
        }

    updated_at = float(state.get("updated_at") or 0.0)
    macro_age = max(0.0, now - updated_at) if updated_at > 0 else 0.0

    # 1-tier decay: when macro_age > 2 hours -> degraded scale 0.5x
    if updated_at > 0 and macro_age > 7200:
        macro_degraded = True
        macro_scale = 0.5
    else:
        macro_degraded = False
        macro_scale = 1.0

    # DXY correlation on Gold
    dxy_trend = state.get("dxy_trend", "FLAT")
    sym_upper = symbol.upper()
    is_gold = "XAU" in sym_upper or "GOLD" in sym_upper
    if dxy_trend == "UP" and side.upper() == "BUY" and is_gold:
        dxy_scale = 0.5
    else:
        dxy_scale = 1.0

    final_scale = min(dxy_scale, macro_scale)

    return {
        "permitted": True,
        "reason": "OK" if not macro_degraded else "MACRO_DEGRADED_HALF_RISK",
        "final_scale": final_scale,
        "dxy_scale": dxy_scale,
        "macro_scale": macro_scale,
        "macro_degraded": macro_degraded,
        "macro_age": round(macro_age, 1),
        "dxy_trend": dxy_trend,
        "us10y_trend": state.get("us10y_trend", "FLAT"),
        "shock": shock,
        "regime": state.get("regime", "RANGING"),
    }
