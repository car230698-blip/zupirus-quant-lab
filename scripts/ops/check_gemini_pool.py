import time
from app.db import tx
from app.gemini_client import ping_single_key
from app.security import decrypt_secret

with tx() as c:
    rows = c.execute("SELECT id, key_masked, key_cipher, is_active FROM gemini_keys ORDER BY created ASC").fetchall()

print(f"Tổng số Gemini API Key trong bảng 'gemini_keys': {len(rows)}")
for r in rows:
    kid = r[0]
    masked = r[1]
    cipher = r[2]
    is_active = bool(r[3])
    try:
        raw_key = decrypt_secret(cipher)
        ping_res = ping_single_key(raw_key)
        status = ping_res.get("status")
        latency = ping_res.get("latency_ms", 0)
        err = ping_res.get("error", "")
        print(f"Key [{masked}] (Active={is_active}): STATUS = {status} ({latency}ms) {err}")
    except Exception as e:
        print(f"Key [{masked}] (Active={is_active}): LOI -> {e}")
