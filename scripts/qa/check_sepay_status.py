"""Diagnostic script for SePay configuration and webhook execution."""
import os
import sys
import json
import time
import hmac
import hashlib
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path("/app") if Path("/app/app").exists() else (Path(__file__).resolve().parents[2] if "__file__" in globals() and Path(__file__).exists() else Path("."))
sys.path.insert(0, str(ROOT))

from app.db import tx
from app.domains.billing.sepay import get_sepay_secret, verify_sepay_signature
from app.services.billing_service import get_effective_sepay_config

def main():
    print("=" * 60)
    print("SePay Diagnostics & Verification")
    print("=" * 60)

    # 1. Inspect Env & DB Settings
    env_secret = os.getenv("SEPAY_WEBHOOK_SECRET", "")
    resolved_secret = get_sepay_secret()
    bank_name, bank_acc, bank_holder = get_effective_sepay_config()

    print(f"ENV SEPAY_WEBHOOK_SECRET: {env_secret[:8]}... (len={len(env_secret)})")
    print(f"Resolved Secret: {resolved_secret[:8]}... (len={len(resolved_secret)})")
    print(f"Bank Config: Bank={bank_name}, Acc={bank_acc}, Holder={bank_holder}")

    with tx() as c:
        row = c.execute("SELECT key, value FROM kv WHERE key IN ('billing:settings', 'billing_settings')").fetchall()
        print("KV Billing Settings:")
        for r in row:
            print(f"  {r['key']}: {r['value']}")

        recent_orders = c.execute("SELECT id, user_id, plan_tier, amount_vnd, payment_status, created_at FROM orders ORDER BY created_at DESC LIMIT 5").fetchall()
        print(f"\nRecent Orders ({len(recent_orders)}):")
        for o in recent_orders:
            print(f"  Order: id={o['id']}, tier={o['plan_tier']}, vnd={o['amount_vnd']}, status={o['payment_status']}")

        recent_txs = c.execute("SELECT id, sepay_id, user_id, amount, status, created_at FROM payment_transactions ORDER BY created_at DESC LIMIT 5").fetchall()
        print(f"\nRecent Payment Transactions ({len(recent_txs)}):")
        for t in recent_txs:
            print(f"  Tx: id={t['id']}, sepay_id={t['sepay_id']}, amount={t['amount']}, status={t['status']}")

    # 2. Test Webhook Call Locally
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"
    endpoints = [
        "/api/webhooks/sepay",
        "/api/sepay/webhook",
        "/api/v1/webhooks/sepay",
    ]

    test_payload = {
        "id": f"test_{int(time.time())}",
        "gateway": bank_name or "MBBank",
        "transactionDate": time.strftime("%Y-%m-%d %H:%M:%S"),
        "accountNumber": bank_acc or "0123456789",
        "subAccount": None,
        "transferType": "in",
        "transferAmount": 100000.0,
        "accumulated": 500000.0,
        "code": None,
        "transactionContent": "ZP TEST_CHECKOUT_PRO",
        "referenceNumber": "FT99999",
        "body": "Test diagnostic payload",
    }
    raw_body = json.dumps(test_payload).encode("utf-8")
    sig = hmac.new(resolved_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()

    print("\nTesting Webhook Endpoints against", base_url)
    for ep in endpoints:
        url = f"{base_url}{ep}"
        req = urllib.request.Request(
            url,
            data=raw_body,
            headers={
                "Content-Type": "application/json",
                "x-sepay-signature": sig,
                "Authorization": f"Apikey {resolved_secret}",
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                print(f"  [+] {ep} -> HTTP {resp.status}: {data}")
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="ignore")
            print(f"  [-] {ep} -> HTTP {err.code}: {err_body}")
        except Exception as err:
            print(f"  [!] {ep} -> Connection error: {err}")

if __name__ == "__main__":
    main()
