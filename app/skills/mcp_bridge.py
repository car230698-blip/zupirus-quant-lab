"""Model Context Protocol (MCP) Bridge & External Quantitative Data Connectors.
Provides dynamic discovery, configuration (via kv `mcp:servers`), and safe read-only execution
of external MCP servers and financial data tools (Web Fetch, Yahoo Finance Cross-Asset,
FRED/Macro Feed, and Tavily/Brave News Search) with automatic fallback.
Strictly isolated from MetaApi trade execution.
"""
import json
import time
import logging
import re
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional
import httpx

from app.db import tx

logger = logging.getLogger("zupirus.mcp_bridge")

DEFAULT_MCP_SERVERS: List[Dict[str, Any]] = [
    {
        "server_id": "mcp_yahoo_gold",
        "name": "Yahoo Finance Cross-Asset MCP",
        "transport": "mcp_http",
        "endpoint_url": "https://query1.finance.yahoo.com/v8/finance/chart/GC=F",
        "description": "Tra cứu dữ liệu liên thị trường thời gian thực: Gold Futures (GC=F), DXY (DX-Y.NYB), Lợi suất TPCP Mỹ 10Y (^TNX).",
        "trigger_condition": "Khi Agent cần kiểm tra tương quan DXY / US10Y với XAU/USD trước khi xác nhận xu hướng.",
        "enabled": True,
        "requires_api_key": False,
        "api_key_masked": "PUBLIC_FEED",
        "has_api_key": True,
    },
    {
        "server_id": "mcp_news_search",
        "name": "Tavily / Brave Financial News MCP",
        "transport": "mcp_search",
        "endpoint_url": "https://api.tavily.com/search",
        "description": "Tìm kiếm tin tức nóng XAU/USD, ngân hàng trung ương và địa chính trị qua Tavily/Brave API (kèm Google News RSS fallback).",
        "trigger_condition": "Khi có biến động giá bất thường hoặc cần quét tin tức địa chính trị ảnh hưởng tới giá Vàng.",
        "enabled": True,
        "requires_api_key": False,
        "api_key_masked": "RSS_FALLBACK_ACTIVE",
        "has_api_key": False,
    },
    {
        "server_id": "mcp_macro_fred",
        "name": "FRED & US Macro Economic MCP",
        "transport": "mcp_http",
        "endpoint_url": "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
        "description": "Truy vấn lịch công bố CPI, NFP, FOMC, GDP Hoa Kỳ và chỉ báo vĩ mô định lượng.",
        "trigger_condition": "Trước mỗi phiên Âu/Mỹ để cập nhật các mốc thời gian tin tức High-Impact USD.",
        "enabled": True,
        "requires_api_key": False,
        "api_key_masked": "PUBLIC_FEED",
        "has_api_key": True,
    },
    {
        "server_id": "mcp_web_fetch",
        "name": "Clean Web Reader MCP (Fetch)",
        "transport": "mcp_fetch",
        "endpoint_url": "https://www.federalreserve.gov/feeds/press_all.xml",
        "description": "Đọc và bóc tách văn bản sạch từ URL báo cáo tài chính, thông cáo FOMC/Fed phục vụ nghiên cứu của Agent.",
        "trigger_condition": "Khi Agent cần đọc chi tiết nội dung một bài phân tích hoặc thông cáo báo chí từ URL.",
        "enabled": True,
        "requires_api_key": False,
        "api_key_masked": "PUBLIC_FEED",
        "has_api_key": True,
    },
]


def _load_saved_mcp_config() -> Dict[str, Dict[str, Any]]:
    try:
        with tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key = 'mcp:servers'").fetchone()
            if row and row[0]:
                data = json.loads(row[0])
                if isinstance(data, dict):
                    return data
    except Exception as e:
        logger.debug(f"Could not read mcp:servers from kv: {e}")
    return {}


def list_mcp_servers(enabled_only: bool = False) -> List[Dict[str, Any]]:
    """Return all configured MCP servers merged with saved kv state."""
    saved_map = _load_saved_mcp_config()
    result: List[Dict[str, Any]] = []

    seen_ids = set()
    for base in DEFAULT_MCP_SERVERS:
        sid = base["server_id"]
        seen_ids.add(sid)
        ovr = saved_map.get(sid, {})
        enabled = bool(ovr.get("enabled", base["enabled"]))
        raw_key = str(ovr.get("api_key") or "").strip()
        if raw_key and len(raw_key) >= 10:
            masked = f"{raw_key[:5]}***{raw_key[-3:]}"
            has_key = True
        else:
            masked = base["api_key_masked"]
            has_key = base["has_api_key"]

        item = {
            **base,
            "name": ovr.get("name") or base["name"],
            "endpoint_url": ovr.get("endpoint_url") or base["endpoint_url"],
            "description": ovr.get("description") or base["description"],
            "enabled": enabled,
            "api_key_masked": masked,
            "has_api_key": has_key,
            "updated_at": ovr.get("updated_at"),
        }
        if not enabled_only or enabled:
            result.append(item)

    # Also include any custom MCP servers added by Admin
    for sid, ovr in saved_map.items():
        if sid in seen_ids:
            continue
        enabled = bool(ovr.get("enabled", True))
        if enabled_only and not enabled:
            continue
        raw_key = str(ovr.get("api_key") or "").strip()
        masked = f"{raw_key[:5]}***{raw_key[-3:]}" if len(raw_key) >= 10 else ("***" if raw_key else "NONE")
        result.append({
            "server_id": sid,
            "name": ovr.get("name") or sid,
            "transport": ovr.get("transport") or "mcp_sse",
            "endpoint_url": ovr.get("endpoint_url") or "",
            "description": ovr.get("description") or "Custom MCP Server",
            "trigger_condition": ovr.get("trigger_condition") or "Khi Agent cần truy vấn dữ liệu mở rộng qua MCP.",
            "enabled": enabled,
            "requires_api_key": bool(ovr.get("requires_api_key", False)),
            "api_key_masked": masked,
            "has_api_key": bool(raw_key),
            "updated_at": ovr.get("updated_at"),
        })

    return result


def update_mcp_server(
    server_id: str,
    enabled: Optional[bool] = None,
    api_key: Optional[str] = None,
    endpoint_url: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Update or register an MCP server configuration in kv (`mcp:servers`)."""
    saved_map = _load_saved_mcp_config()
    curr = saved_map.get(server_id, {})

    if enabled is not None:
        curr["enabled"] = bool(enabled)
    if api_key is not None and api_key.strip():
        curr["api_key"] = api_key.strip()
    if endpoint_url is not None and endpoint_url.strip():
        curr["endpoint_url"] = endpoint_url.strip()
    if name is not None and name.strip():
        curr["name"] = name.strip()
    if description is not None and description.strip():
        curr["description"] = description.strip()
    curr["updated_at"] = time.time()

    saved_map[server_id] = curr
    with tx() as c:
        c.execute(
            """
            INSERT INTO kv (key, value) VALUES ('mcp:servers', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (json.dumps(saved_map),)
        )

    all_srv = {s["server_id"]: s for s in list_mcp_servers(enabled_only=False)}
    return all_srv.get(server_id, curr)


def execute_mcp_tool(server_id: str, **kwargs) -> Dict[str, Any]:
    """Execute a read-only external query via the specified MCP connector with safe fallback."""
    t0 = time.perf_counter()
    saved_map = _load_saved_mcp_config()
    all_srv = {s["server_id"]: s for s in list_mcp_servers(enabled_only=False)}
    srv = all_srv.get(server_id)
    if not srv:
        return {"ok": False, "server_id": server_id, "error": f"MCP Server '{server_id}' không tồn tại."}
    if not srv.get("enabled", True):
        return {"ok": False, "server_id": server_id, "error": f"MCP Server '{server_id}' đang bị tắt bởi Admin."}

    raw_cfg = saved_map.get(server_id, {})
    api_key = str(raw_cfg.get("api_key") or "").strip()
    headers = {"User-Agent": "ZUPIRUS-QuantLab-MCP/0.2.0 (+https://zupirus.com)"}

    try:
        if server_id == "mcp_yahoo_gold":
            symbols = kwargs.get("symbols") or ["GC=F", "DX-Y.NYB", "^TNX"]
            quotes = {}
            with httpx.Client(timeout=6.0, headers=headers) as client:
                for sym in symbols:
                    try:
                        r = client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=15m&range=1d")
                        if r.status_code == 200:
                            meta = r.json().get("chart", {}).get("result", [{}])[0].get("meta", {})
                            quotes[sym] = {
                                "price": meta.get("regularMarketPrice"),
                                "prev_close": meta.get("chartPreviousClose"),
                                "currency": meta.get("currency", "USD"),
                            }
                    except Exception:
                        pass
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return {
                "ok": True,
                "server_id": server_id,
                "name": srv["name"],
                "latency_ms": latency,
                "cross_asset_quotes": quotes,
                "note": "Dữ liệu liên thị trường phục vụ phân tích tương quan XAU/USD.",
            }

        if server_id == "mcp_news_search":
            query = str(kwargs.get("query") or "XAUUSD Gold Federal Reserve inflation").strip()
            if api_key and len(api_key) >= 10:
                with httpx.Client(timeout=8.0, headers=headers) as client:
                    r = client.post(
                        srv["endpoint_url"],
                        json={"api_key": api_key, "query": query, "max_results": 5},
                    )
                    if r.status_code == 200:
                        data = r.json()
                        return {
                            "ok": True,
                            "server_id": server_id,
                            "provider": "Tavily MCP Search",
                            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                            "headlines": [
                                {"title": item.get("title"), "url": item.get("url"), "snippet": str(item.get("content", ""))[:200]}
                                for item in data.get("results", [])[:5]
                            ],
                        }
            # Safe fallback to Google News RSS for Gold / Federal Reserve
            rss_url = "https://news.google.com/rss/search?q=Gold+XAUUSD+Federal+Reserve&hl=en-US&gl=US&ceid=US:en"
            headlines = []
            try:
                with httpx.Client(timeout=6.0, headers=headers) as client:
                    r = client.get(rss_url)
                    if r.status_code == 200:
                        root = ET.fromstring(r.text)
                        for item in root.findall(".//item")[:5]:
                            t_el = item.find("title")
                            p_el = item.find("pubDate")
                            if t_el is not None and t_el.text:
                                headlines.append({
                                    "title": t_el.text,
                                    "published": p_el.text if p_el is not None else "",
                                })
            except Exception as rss_err:
                logger.debug(f"RSS fallback error: {rss_err}")
            return {
                "ok": True,
                "server_id": server_id,
                "provider": "Financial News RSS Stream (MCP Fallback)",
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "query": query,
                "headlines": headlines,
            }

        if server_id == "mcp_macro_fred":
            from app.calendar_sync import fetch_live_calendar
            events = fetch_live_calendar()
            return {
                "ok": True,
                "server_id": server_id,
                "name": srv["name"],
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "upcoming_high_impact_usd": events[:6],
            }

        if server_id == "mcp_web_fetch":
            target_url = str(kwargs.get("url") or srv["endpoint_url"]).strip()
            with httpx.Client(timeout=7.0, headers=headers, follow_redirects=True) as client:
                r = client.get(target_url)
                raw_text = re.sub(r"<[^>]+>", " ", r.text)
                clean_text = re.sub(r"\s+", " ", raw_text).strip()[:800]
                return {
                    "ok": True,
                    "server_id": server_id,
                    "url": target_url,
                    "status_code": r.status_code,
                    "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                    "excerpt": clean_text,
                }

        # Custom MCP Server HTTP check
        target_url = srv.get("endpoint_url")
        if target_url:
            with httpx.Client(timeout=6.0, headers=headers) as client:
                r = client.get(target_url)
                return {
                    "ok": r.status_code < 400,
                    "server_id": server_id,
                    "url": target_url,
                    "status_code": r.status_code,
                    "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                    "preview": r.text[:400],
                }
    except Exception as e:
        logger.warning(f"MCP tool execution fallback for {server_id}: {e}")
        return {
            "ok": False,
            "server_id": server_id,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "error": f"Kết nối MCP '{server_id}' tạm thời gián đoạn: {e}",
        }

    return {"ok": False, "server_id": server_id, "error": "Chưa cấu hình endpoint cho MCP server này."}
