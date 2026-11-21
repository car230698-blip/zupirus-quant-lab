import urllib.request
import json
import http.cookiejar
import sys

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3102"

def run_acceptance_check(base_url: str = BASE_URL):
    print(f"[*] Starting VPS acceptance test against {base_url}...")

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    # 1. Check /readyz
    req = urllib.request.Request(f"{base_url}/readyz")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        print("[+] /readyz status:", data.get("status"))
        assert data.get("status") == "ready", f"Unexpected status: {data}"
        assert data.get("database", {}).get("connected") is True
        assert data.get("redis", {}).get("connected") is True
        assert data.get("timescaledb", {}).get("timescaledb_available") is True

    # 2. Login as Admin
    login_data = json.dumps({"email": "admin@zupirus.local", "password": "test-only-admin-password-123"}).encode()
    req = urllib.request.Request(
        f"{base_url}/api/login",
        data=login_data,
        headers={"Content-Type": "application/json", "x-zupirus": "1"}
    )
    resp = opener.open(req)
    print("[+] Admin login status:", resp.status)
    assert resp.status == 200

    # 3. Create DEMO account
    # Using random suffix to allow multiple runs
    import secrets
    acc_login = str(secrets.randbelow(899999) + 100000)
    acc_payload = json.dumps({"login": acc_login, "server": "ICMarketsSC-Demo", "mode": "DEMO"}).encode()
    req = urllib.request.Request(
        f"{base_url}/api/accounts",
        data=acc_payload,
        headers={"Content-Type": "application/json", "x-zupirus": "1"}
    )
    resp = opener.open(req)
    acc = json.loads(resp.read().decode())
    print(f"[+] DEMO Account created: id={acc['id']} login={acc_login}")

    # 4. Generate Pairing Code
    req = urllib.request.Request(
        f"{base_url}/api/accounts/{acc['id']}/pair",
        data=b"",
        headers={"Content-Type": "application/json", "x-zupirus": "1"}
    )
    resp = opener.open(req)
    pair_data = json.loads(resp.read().decode())
    code = pair_data["code"]
    print(f"[+] Pairing code generated: {code}")

    # 5. EA pairs with backend via /api/ea/pair
    ea_req = json.dumps({"login": acc_login, "server": "ICMarketsSC-Demo", "mode": "DEMO", "code": code}).encode()
    req = urllib.request.Request(f"{base_url}/api/ea/pair", data=ea_req, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        token = resp.read().decode().strip()
        print(f"[+] EA paired successfully! Device token received (length={len(token)})")
        assert len(token) > 20

    # 6. EA sends heartbeat via /api/ea/heartbeat
    hb_payload = json.dumps({
        "login": acc_login,
        "server": "ICMarketsSC-Demo",
        "mode": "DEMO",
        "balance": 10000.0,
        "equity": 10050.0,
        "positions": 0
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/api/ea/heartbeat",
        data=hb_payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }
    )
    with urllib.request.urlopen(req) as resp:
        hb_res = resp.read().decode().strip()
        print(f"[+] EA heartbeat response: {hb_res}")
        assert hb_res == "OK"

    # 7. Check Timescale candles endpoint
    req = urllib.request.Request(f"{base_url}/api/timescale/candles?timeframe=M15&source=DEMO")
    with urllib.request.urlopen(req) as resp:
        candles_res = json.loads(resp.read().decode())
        print(f"[+] /api/timescale/candles: symbol={candles_res['symbol']}, timeframe={candles_res['timeframe']}, count={len(candles_res['candles'])}")

    print("\n[SUCCESS] VPS Acceptance Test completed with 100% PASS!")

if __name__ == "__main__":
    run_acceptance_check()
