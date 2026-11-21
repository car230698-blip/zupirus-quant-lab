"""Google Gemini API Pool Manager with Multi-Key Failover and Quota Rotation.
Pre-configured with Gemini API Keys pool for admin management and AI assistance."""
import os
import time
import json
import hashlib
import logging
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional, Tuple
from app.security import encrypt_secret, decrypt_secret

logger = logging.getLogger("zupirus.gemini")


def _decrypt_gemini_key(raw: str) -> str:
    val = str(raw or "").strip()
    if not val:
        return ""
    try:
        dec = decrypt_secret(val)
        return dec if dec else ("" if val.startswith("enc:") else val)
    except Exception:
        return "" if val.startswith("enc:") else val

DEFAULT_GEMINI_KEYS = [
    k.strip() for k in os.getenv("GEMINI_API_KEYS", "").split(",") if k.strip()
]


def mask_key(key: str) -> str:
    """Masks an API key for safe display (e.g. AQ.Ab8...XVA)."""
    if len(key) <= 12:
        return key[:3] + "..." + key[-3:]
    return key[:8] + "..." + key[-4:]


def hash_key(key: str) -> str:
    """Produces a deterministic hash for deduplication."""
    return hashlib.sha256(key.strip().encode("utf-8")).hexdigest()


def seed_default_keys(c):
    """Ensure the 5 default Gemini keys exist in the database."""
    now = time.time()
    for idx, raw_key in enumerate(DEFAULT_GEMINI_KEYS):
        k_hash = hash_key(raw_key)
        k_masked = mask_key(raw_key)
        kid = f"gemini_key_{idx + 1}"
        try:
            # Check if exists
            row = c.execute("SELECT id FROM gemini_keys WHERE key_hash = ?", (k_hash,)).fetchone()
            if not row:
                c.execute(
                    """INSERT INTO gemini_keys (id, key_hash, key_masked, key_cipher, is_active, calls_count, last_used, status, created)
                       VALUES (?, ?, ?, ?, 1, 0, NULL, 'active', ?)""",
                    (kid, k_hash, k_masked, encrypt_secret(raw_key.strip()), now),
                )
        except Exception as e:
            logger.debug(f"Key seed note: {e}")


def get_active_keys(c) -> List[Dict[str, Any]]:
    """Retrieves all active Gemini keys ordered by calls count (round-robin / least used)."""
    try:
        rows = c.execute(
            """SELECT id, key_hash, key_masked, key_cipher, is_active, calls_count, last_used, status, created
               FROM gemini_keys
               WHERE is_active = 1 AND status = 'active'
               ORDER BY calls_count ASC, id ASC"""
        ).fetchall()
        return [dict(r) if hasattr(r, 'keys') else {
            "id": r[0], "key_hash": r[1], "key_masked": r[2], "key_cipher": r[3],
            "is_active": r[4], "calls_count": r[5], "last_used": r[6], "status": r[7], "created": r[8]
        } for r in rows]
    except Exception as e:
        logger.warning(f"Error fetching active gemini keys: {e}")
        # Fallback to in-memory default list
        return [{"id": f"fallback_{i}", "key_cipher": k, "key_masked": mask_key(k), "is_active": 1, "calls_count": 0} for i, k in enumerate(DEFAULT_GEMINI_KEYS)]


def update_key_usage(c, key_id: str, success: bool, error_msg: Optional[str] = None):
    """Updates call count, timestamp, and status if rate-limited."""
    now = time.time()
    try:
        if success:
            c.execute(
                "UPDATE gemini_keys SET calls_count = calls_count + 1, last_used = ?, status = 'active' WHERE id = ?",
                (now, key_id),
            )
        else:
            err_s = str(error_msg or "")
            if "429" in err_s:
                status = "rate_limited"
            elif "503" in err_s or "502" in err_s or "500" in err_s:
                # Transient server/demand spike; keep key active in pool
                status = "active"
            else:
                status = "error"
            c.execute(
                "UPDATE gemini_keys SET last_used = ?, status = ? WHERE id = ?",
                (now, status, key_id),
            )
    except Exception as e:
        logger.debug(f"Update key usage note: {e}")


DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-4-hydrogen").strip()

GEMINI_FALLBACK_MODELS = [
    "gemini-4-hydrogen",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-3.8-flash",
]


def call_gemini(
    prompt: str,
    system_instruction: Optional[str] = None,
    active_keys: Optional[List[Dict[str, Any]]] = None,
    c = None,
    timeout: float = 8.0,
    max_tries: int = 5,
    model: Optional[str] = None,
    image: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """Calls Google Gemini API with multi-key AND multi-model failover across the configured pool.
    Returns (response_text, used_key_id)."""
    keys = active_keys or []
    if not keys and c:
        keys = get_active_keys(c)
        if not keys:
            # Fallback to any enabled key even if previously rate-limited
            try:
                rows = c.execute(
                    "SELECT id, key_hash, key_masked, key_cipher, is_active, calls_count, last_used, status, created FROM gemini_keys WHERE is_active = 1 ORDER BY calls_count ASC"
                ).fetchall()
                keys = [dict(r) for r in rows]
            except Exception:
                pass
    if not keys:
        keys = [{"id": f"k_{i}", "key_cipher": k} for i, k in enumerate(DEFAULT_GEMINI_KEYS)]

    req_model = (model or DEFAULT_GEMINI_MODEL).strip()
    if req_model in ("gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash"):
        req_model = DEFAULT_GEMINI_MODEL

    model_candidates = [req_model] + [m for m in GEMINI_FALLBACK_MODELS if m != req_model]

    parts_list: List[Dict[str, Any]] = [{"text": prompt}]
    if image and isinstance(image, str):
        img_str = image.strip()
        mime_type = "image/png"
        b64_data = img_str
        if img_str.startswith("data:") and ";base64," in img_str:
            header, b64_data = img_str.split(";base64,", 1)
            mime_type = header[5:] or "image/png"
        if b64_data and not b64_data.startswith("http"):
            parts_list.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})

    payload: Dict[str, Any] = {
        "contents": [{"parts": parts_list}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
        }
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    headers = {"Content-Type": "application/json"}
    body_bytes = json.dumps(payload).encode("utf-8")

    last_error = None
    attempt = 0
    for target_model in model_candidates:
        url_template = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={{key}}"
        for k_item in keys:
            if attempt >= max_tries * 2:
                break
            api_key = _decrypt_gemini_key(k_item.get("key_cipher") or "")
            kid = k_item.get("id", "unknown")
            if not api_key:
                continue
            attempt += 1

            endpoint = url_template.format(key=api_key)
            req = urllib.request.Request(endpoint, data=body_bytes, headers=headers, method="POST")

            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    candidates = res_data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            text = parts[0]["text"]
                            if c:
                                update_key_usage(c, kid, success=True)
                            return text, f"{kid} · {target_model}"
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="ignore")
                logger.warning(f"Gemini {target_model} key {mask_key(api_key)} failed (HTTP {e.code}): {err_body[:100]}")
                last_error = f"HTTP {e.code}: {err_body[:120]}"
                if c and e.code == 429:
                    update_key_usage(c, kid, success=False, error_msg=str(e.code))
                # If 404/503 on this model, break inner key loop and try next fallback model immediately
                if e.code in (404, 503):
                    break
                continue
            except Exception as e:
                logger.warning(f"Gemini {target_model} network error on key {mask_key(api_key)}: {e}")
                last_error = str(e)
                continue

    logger.info(f"Gemini pool exhausted or offline, returning fallback. Last err: {last_error}")
    return None, None


def ping_single_key(raw_cipher: str, timeout: float = 6.0) -> Dict[str, Any]:
    """Tests an individual key directly against Gemini API to verify health, quota and latency."""
    api_key = _decrypt_gemini_key(raw_cipher)
    if not api_key:
        return {"ok": False, "status": "invalid", "message": "Không thể giải mã key", "latency_ms": 0}

    payload = {
        "contents": [{"parts": [{"text": "Hi"}]}],
        "generationConfig": {"maxOutputTokens": 5}
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    # Probe models: priority gemini-4-hydrogen, fallback to gemini-3-flash-preview
    probe_models = ["gemini-4-hydrogen", "gemini-3-flash-preview"]
    last_err_msg = ""
    for target_model in probe_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={api_key}"
        req = urllib.request.Request(url, data=body, headers=headers)
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                resp.read()
                latency = round((time.perf_counter() - t0) * 1000, 1)
                note = f"Hoạt động tốt ({target_model})"
                return {"ok": True, "status": "active", "message": note, "latency_ms": latency}
        except urllib.error.HTTPError as he:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            if he.code == 429:
                return {"ok": False, "status": "rate_limited", "message": "Đạt giới hạn Quota (429)", "latency_ms": latency}
            elif he.code in (400, 403):
                return {"ok": False, "status": "invalid", "message": f"Key không hợp lệ hoặc bị khóa ({he.code})", "latency_ms": latency}
            elif he.code == 503:
                last_err_msg = f"{target_model} quá tải (503)"
                continue  # Try next fallback model
            last_err_msg = f"HTTP {he.code}: {he.reason}"
        except Exception as e:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            last_err_msg = str(e)
            continue

    return {"ok": False, "status": "error", "message": last_err_msg or "Lỗi kết nối", "latency_ms": 0}


