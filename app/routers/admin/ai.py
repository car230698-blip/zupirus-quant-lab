"""Admin AI Agent Model, Provider, and API Key Management."""
import os
import json
import time
import httpx
import logging
from typing import Optional, Dict, Any, Tuple
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends

from app.db import tx
from app.routers.deps import get_current_admin
from app.gemini_client import call_gemini, seed_default_keys, hash_key, mask_key
from app.security import encrypt_secret, decrypt_secret


def _decrypt_ai_key(raw: str) -> str:
    val = str(raw or "").strip()
    if not val:
        return ""
    try:
        dec = decrypt_secret(val)
        return dec if dec else ("" if val.startswith("enc:") else val)
    except Exception:
        return "" if val.startswith("enc:") else val

logger = logging.getLogger("zupirus.admin_ai")

router = APIRouter(prefix="/api/admin/ai", tags=["Admin AI Agent Configuration"])

AVAILABLE_MODELS = [
    {"id": "gemini-3-flash-preview", "name": "Google Gemini 3 Flash Preview (Khuyên dùng)", "provider": "gemini", "desc": "Tốc độ cao, ổn định nhất cho Pool Gemini hiện tại"},
    {"id": "gemini-3.1-flash-lite", "name": "Google Gemini 3.1 Flash Lite (Siêu nhanh)", "provider": "gemini", "desc": "Độ trễ cực thấp, phù hợp phân tích M15 thời gian thực"},
    {"id": "gemini-flash-latest", "name": "Google Gemini Flash Latest", "provider": "gemini", "desc": "Tự động trỏ tới phiên bản Gemini Flash mới nhất của Google"},
    {"id": "gpt-4o-mini", "name": "OpenAI GPT-4o Mini", "provider": "openai", "desc": "Nhanh, tiết kiệm chi phí, phân tích dữ liệu định lượng chuẩn xác"},
    {"id": "gpt-4o", "name": "OpenAI GPT-4o Flagship", "provider": "openai", "desc": "Mô hình cao cấp nhất, suy luận logic sâu và đọc biểu đồ thông minh"},
    {"id": "deepseek-chat", "name": "DeepSeek V3 (DeepSeek API / OpenRouter)", "provider": "openai", "desc": "Hiệu năng định lượng toán học cao, chi phí cực thấp"},
    {"id": "claude-3-5-sonnet-20241022", "name": "Anthropic Claude 3.5 Sonnet (qua OpenRouter)", "provider": "openai", "desc": "Lập luận xuất sắc, phát hiện anomaly thị trường chuẩn xác"},
]


class AISettingsUpdate(BaseModel):
    provider: str = Field(default="OPENAI", description="OPENAI, GEMINI, or HYBRID")
    api_key: Optional[str] = Field(default=None, description="OpenAI/OpenRouter API Key")
    base_url: Optional[str] = Field(default="https://api.openai.com/v1")
    model: str = Field(default="gpt-4o-mini")
    gemini_model: Optional[str] = Field(default="gemini-2.0-flash")


class TestAIRequest(BaseModel):
    prompt: str = Field(default="Đánh giá điều kiện rủi ro và chế độ thị trường XAU/USD M15 hiện tại.")
    provider: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    gemini_model: Optional[str] = None



def _build_live_market_system_instruction() -> Tuple[str, Dict[str, Any]]:
    """Fetch real-time XAU/USD quote, M15 range, and ATR(14) from DB/Telemetry to ground AI responses."""
    from app.routers.telemetry import get_topbar_telemetry
    from app.services.signal_ingestion.context import get_market_atr14
    tele = get_topbar_telemetry()
    xau = tele.get("xauusd") or {}
    bid = xau.get("bid")
    ask = xau.get("ask")
    mid = xau.get("mid")
    spread_pips = xau.get("spread_pips")
    q_source = xau.get("source", "DB_QUOTES")
    news_info = tele.get("news_shield") or {}

    m15_low = None
    m15_high = None
    atr_14 = 3.50
    try:
        with tx() as c:
            atr_14 = get_market_atr14(c, "XAUUSD", "M15")
            c_rows = c.execute(
                "SELECT high, low, close FROM candles WHERE symbol = 'XAUUSD' ORDER BY time DESC LIMIT 14"
            ).fetchall()
            if c_rows:
                highs = [float(r[0]) for r in c_rows if r[0] is not None]
                lows = [float(r[1]) for r in c_rows if r[1] is not None]
                if highs and lows:
                    m15_high = round(max(highs), 2)
                    m15_low = round(min(lows), 2)
                if mid is None and c_rows[0][2] is not None:
                    mid = round(float(c_rows[0][2]), 2)
                    bid = mid
                    ask = mid
    except Exception:
        pass

    snapshot = {
        "symbol": "XAUUSD",
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "spread_pips": spread_pips,
        "m15_range": f"{m15_low} - {m15_high}" if (m15_low and m15_high) else "Đang đồng bộ",
        "atr_14": round(float(atr_14 or 3.5), 2),
        "news_status": news_info.get("status", "CLEAR"),
        "source": q_source,
    }

    sys_text = (
        "Bạn là trợ lý AI định lượng ZUPIRUS Quant Lab. Trả lời chuyên nghiệp, súc tích bằng tiếng Việt.\n"
        "DỮ LIỆU THỊ TRƯỜNG XAU/USD THỰC TẾ TRỰC TIẾP TỪ HỆ THỐNG NGAY LÚC NÀY:\n"
        f"- Giá XAU/USD hiện tại: Bid = {bid or 'N/A'}, Ask = {ask or 'N/A'}, Mid = {mid or 'N/A'}, Spread = {spread_pips if spread_pips is not None else 'N/A'} pips (Nguồn: {q_source})\n"
        f"- Biên độ 14 nến M15 gần nhất: {snapshot['m15_range']}, ATR(14) = {snapshot['atr_14']} USD\n"
        f"- Lá chắn tin tức USD (News Shield): {snapshot['news_status']} (Khoảng cách: {news_info.get('distance_mins', 999)} phút)\n"
        "BẮT BUỘC sử dụng chính xác mức giá XAU/USD và số liệu thực tế ở trên trong câu trả lời, tuyệt đối không tự bịa mức giá cũ."
    )
    return sys_text, snapshot


@router.get("/settings")
def get_ai_settings(_admin=Depends(get_current_admin)):
    """Retrieve active AI model, API key status, connected endpoint, and provider configuration."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'ai:settings'").fetchone()
        saved = json.loads(row[0]) if row else {}

        seed_default_keys(c)
        gem_rows = c.execute(
            "SELECT id, key_masked, is_active, calls_count, status FROM gemini_keys ORDER BY created DESC"
        ).fetchall()
        gem_list = [dict(r) for r in gem_rows]
        active_gem = [g for g in gem_list if g.get("is_active") == 1]
        gem_keys_count = len(active_gem)

    provider = saved.get("provider") or "HYBRID"
    raw_key = _decrypt_ai_key(saved.get("api_key") or "") or os.getenv("AI_API_KEY", "")
    base_url = saved.get("base_url") or os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
    model = saved.get("model") or os.getenv("AI_MODEL", "gpt-4o-mini")
    gemini_model = saved.get("gemini_model") or "gemini-2.0-flash"

    if raw_key and len(raw_key) >= 12:
        masked_key = f"{raw_key[:7]}***{raw_key[-4:]}"
    elif raw_key:
        masked_key = "***"
    elif active_gem:
        masked_key = f"Gemini Pool ({active_gem[0]['key_masked']})"
    else:
        masked_key = "CHƯA_CẤU_HÌNH"

    has_any_key = bool(raw_key) or (gem_keys_count > 0 and provider in ("GEMINI", "HYBRID"))
    if raw_key:
        connected_api = f"{provider} · {base_url} · Key: {masked_key}"
    elif gem_keys_count > 0 and provider in ("GEMINI", "HYBRID"):
        connected_api = f"Google Gemini API · {gem_keys_count} Active Key(s) ({active_gem[0]['key_masked']})"
    else:
        connected_api = "Chưa có khóa API nào được kết nối"

    return {
        "provider": provider,
        "api_key_masked": masked_key,
        "connected_api": connected_api,
        "has_api_key": has_any_key,
        "base_url": base_url,
        "model": model,
        "gemini_model": gemini_model,
        "gemini_keys_count": gem_keys_count,
        "gemini_keys": gem_list,
        "available_models": AVAILABLE_MODELS,
    }


def _save_ai_settings(req: AISettingsUpdate):
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'ai:settings'").fetchone()
        existing = json.loads(row[0]) if row else {}

    api_key = req.api_key.strip() if req.api_key else (_decrypt_ai_key(existing.get("api_key", "")) or os.getenv("AI_API_KEY", ""))
    base_url = (req.base_url or existing.get("base_url", "https://api.openai.com/v1")).strip().rstrip("/")
    from app.skills.mcp_bridge import _is_safe_external_url
    if base_url and not _is_safe_external_url(base_url):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="base_url không hợp lệ hoặc bị chặn bởi bộ lọc bảo mật SSRF (chỉ chấp nhận HTTPS công khai).")
    model = (req.model or existing.get("model", "gpt-4o-mini")).strip()
    provider = (req.provider or existing.get("provider", "OPENAI")).strip().upper()
    gemini_model = (req.gemini_model or existing.get("gemini_model", "gemini-2.0-flash")).strip()

    now_ts = time.time()
    payload = {
        "provider": provider,
        "api_key": encrypt_secret(api_key) if api_key else "",
        "base_url": base_url,
        "model": model,
        "gemini_model": gemini_model,
        "updated_at": now_ts,
    }

    with tx() as c:
        c.execute(
            """
            INSERT INTO kv (key, value) VALUES ('ai:settings', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (json.dumps(payload),)
        )
        # If the user entered a Google Gemini API key (AIza... or AQ....), also register it in gemini_keys pool
        if req.api_key and (req.api_key.strip().startswith("AIza") or req.api_key.strip().startswith("AQ.")):
            g_raw = req.api_key.strip()
            g_hash = hash_key(g_raw)
            g_mask = mask_key(g_raw)
            existing_g = c.execute("SELECT id FROM gemini_keys WHERE key_hash = ?", (g_hash,)).fetchone()
            if existing_g:
                c.execute(
                    "UPDATE gemini_keys SET is_active = 1, status = 'active' WHERE id = ?",
                    (existing_g[0],)
                )
            else:
                g_id = f"gemini_custom_{g_hash[:8]}"
                c.execute(
                    """
                    INSERT INTO gemini_keys (id, key_hash, key_masked, key_cipher, is_active, calls_count, last_used, status, created)
                    VALUES (?, ?, ?, ?, 1, 0, NULL, 'active', ?)
                    """,
                    (g_id, g_hash, g_mask, encrypt_secret(g_raw), now_ts)
                )

    # Dynamically update process environment (never store Google AIza/AQ keys in OpenAI AI_API_KEY)
    if api_key and not (api_key.startswith("AIza") or api_key.startswith("AQ.")):
        os.environ["AI_API_KEY"] = api_key
    if base_url:
        os.environ["AI_BASE_URL"] = base_url
    if model:
        os.environ["AI_MODEL"] = model

    masked = f"{api_key[:7]}***{api_key[-4:]}" if len(api_key) >= 12 else ("***" if api_key else "CHƯA_CẤU_HÌNH")

    return {
        "success": True,
        "message": f"Đã lưu cấu hình AI thành công: Nhà cung cấp {provider}, Mô hình {model}.",
        "provider": provider,
        "api_key_masked": masked,
        "connected_api": f"{provider} · {base_url} · Key: {masked}",
        "base_url": base_url,
        "model": model,
        "gemini_model": gemini_model,
    }


@router.put("/settings")
def put_ai_settings(req: AISettingsUpdate, _admin=Depends(get_current_admin)):
    return _save_ai_settings(req)


@router.post("/settings")
def post_ai_settings(req: AISettingsUpdate, _admin=Depends(get_current_admin)):
    return _save_ai_settings(req)


@router.post("/test")
async def test_ai_connection(req: TestAIRequest, _admin=Depends(get_current_admin)):
    """Test the configured AI model with a real-time prompt and return latency & response."""
    with tx() as c:
        row = c.execute("SELECT value FROM kv WHERE key = 'ai:settings'").fetchone()
        cfg = json.loads(row[0]) if row else {}

    provider = (req.provider or cfg.get("provider", "HYBRID")).strip().upper()
    key = (req.api_key.strip() if req.api_key else None) or _decrypt_ai_key(cfg.get("api_key", "")) or os.getenv("AI_API_KEY", "")
    base_url = (req.base_url.strip() if req.base_url else None) or cfg.get("base_url") or os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
    model = (req.model.strip() if req.model else None) or cfg.get("model") or os.getenv("AI_MODEL", "gpt-4o-mini")
    gemini_model = (req.gemini_model.strip() if req.gemini_model else None) or cfg.get("gemini_model", "gemini-2.0-flash")

    t0 = time.perf_counter()
    sys_instruction, live_snapshot = _build_live_market_system_instruction()

    # 1. Try Gemini if provider is GEMINI or HYBRID
    gem_error = None
    if provider in ("GEMINI", "HYBRID"):
        try:
            explicit_keys = None
            if key and (key.startswith("AIza") or key.startswith("AQ.")):
                explicit_keys = [{"id": "direct_input", "key_cipher": key}]
            eff_gem_model = model if model.startswith("gemini") else gemini_model
            import asyncio
            def _run_gem():
                with tx() as _c:
                    return call_gemini(
                        req.prompt,
                        system_instruction=sys_instruction,
                        active_keys=explicit_keys,
                        c=_c,
                        timeout=8.0,
                        max_tries=5,
                        model=eff_gem_model,
                    )
            gem_res, used_k = await asyncio.to_thread(_run_gem)
            if gem_res:
                latency = round((time.perf_counter() - t0) * 1000, 1)
                return {
                    "success": True,
                    "provider": "Google Gemini",
                    "model": eff_gem_model,
                    "connected_api": f"Google Gemini ({used_k or 'Pool'})",
                    "live_market_snapshot": live_snapshot,
                    "latency_ms": latency,
                    "response": gem_res,
                }
            gem_error = "Google Gemini API tạm thời quá tải (503) hoặc các Key trong Pool đều bị từ chối."
        except Exception as e:
            logger.warning(f"Gemini call failed in test_ai_connection: {e}")
            gem_error = str(e)
        if provider == "GEMINI":
            from fastapi.responses import JSONResponse
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return JSONResponse(
                status_code=502,
                content={
                    "success": False,
                    "provider": "Google Gemini",
                    "model": gemini_model,
                    "latency_ms": latency,
                    "error": f"Kết nối Google Gemini thất bại: {gem_error}",
                    "detail": f"Kết nối Google Gemini thất bại: {gem_error}",
                },
            )

    # 2. Try OpenAI / OpenRouter / Custom LLM if key is provided (never send Google AIza keys to OpenAI)
    from app.skills.mcp_bridge import _is_safe_external_url
    if base_url and not _is_safe_external_url(base_url):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="base_url không hợp lệ hoặc bị chặn bởi bộ lọc bảo mật SSRF.")
    is_real_key = bool(
        key and len(key) >= 10
        and not key.startswith("AIza")
        and not key.startswith("AQ.")
        and not any(x in key.lower() for x in ("chua_cau_hinh",))
    )

    if is_real_key:
        masked_k = f"{key[:7]}***{key[-4:]}" if len(key) >= 12 else "***"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    f"{base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": sys_instruction},
                            {"role": "user", "content": req.prompt}
                        ],
                        "max_tokens": 500,
                        "temperature": 0.3
                    }
                )
                r.raise_for_status()
                d = r.json()
                ans = d["choices"][0]["message"]["content"]
                latency = round((time.perf_counter() - t0) * 1000, 1)
                return {
                    "success": True,
                    "provider": f"{provider} Live API",
                    "model": model,
                    "connected_api": f"{base_url} · Key: {masked_k}",
                    "live_market_snapshot": live_snapshot,
                    "latency_ms": latency,
                    "response": ans,
                }
        except Exception as e:
            logger.error(f"Live AI test connection error: {e}")
            from fastapi.responses import JSONResponse
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return JSONResponse(
                status_code=502,
                content={
                    "success": False,
                    "provider": provider,
                    "model": model,
                    "latency_ms": latency,
                    "error": f"Lỗi kết nối tới mô hình '{model}' ({base_url}): {str(e)}",
                    "detail": f"Lỗi kết nối tới mô hình '{model}' ({base_url}): {str(e)}",
                },
            )

    # 3. No valid key configured -> fail honestly with HTTP 400 (never fake success: True)
    from fastapi.responses import JSONResponse
    latency = round((time.perf_counter() - t0) * 1000, 1)
    err_msg = "Chưa cấu hình API Key hợp lệ cho AI Agent. Vui lòng nhập API Key (OpenAI / OpenRouter / Gemini) và bấm 'Lưu Cấu Hình AI'."
    return JSONResponse(
        status_code=400,
        content={
            "success": False,
            "provider": provider,
            "model": model,
            "latency_ms": latency,
            "error": err_msg,
            "detail": err_msg,
        },
    )

