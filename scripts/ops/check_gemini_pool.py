import json
import urllib.request
from app.db import tx, getkv

with tx() as c:
    data_val = getkv(c, 'gemini_api_key_pool')

keys = []
if data_val:
    try:
        data = json.loads(data_val)
        if isinstance(data, list):
            keys = [k["key"] if isinstance(k, dict) else str(k) for k in data]
        elif isinstance(data, dict):
            keys = list(data.values())
        else:
            keys = [str(data)]
    except Exception:
        keys = [k.strip() for k in data_val.split(',') if k.strip()]

print(f"Total keys in pool: {len(keys)}")
for i, k in enumerate(keys):
    masked = k[:6] + "..." + k[-4:] if len(k) > 10 else k
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={k}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Zupirus-HealthCheck"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Key {i+1} [{masked}]: HOẠT ĐỘNG TỐT (HTTP {resp.status})")
    except Exception as e:
        print(f"Key {i+1} [{masked}]: LỖI/KHÔNG HOẠT ĐỘNG -> {e}")

