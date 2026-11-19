#!/usr/bin/env python3
"""
End-to-End Portal & Real-Time SSE Smoke Test for ZUPIRUS Quant Lab.

Usage:
  python scripts/e2e_portal_smoke.py --base-url http://127.0.0.1:8000 \
      --email prop.passed@zupirus.com --password ...
"""

import argparse
import json
import sys
import urllib.error
import urllib.request


def http_json(base_url: str, path: str, method: str = "GET", body=None, cookie: str | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=12) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8")), resp.headers


def check_sse_stream(base_url: str, path: str, cookie: str | None = None) -> str:
    headers = {"Accept": "text/event-stream"}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(f"{base_url}{path}", headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=10) as resp:
        assert resp.status == 200, f"SSE {path} returned {resp.status}"
        ctype = resp.headers.get("Content-Type", "")
        assert "text/event-stream" in ctype, f"SSE {path} wrong Content-Type: {ctype}"
        for _ in range(20):
            line = resp.readline().decode("utf-8", errors="ignore").strip()
            if line.startswith("data:"):
                return line[:120]
    raise AssertionError(f"SSE {path} emitted no data frame")


def main() -> int:
    parser = argparse.ArgumentParser(description="ZUPIRUS E2E Portal & SSE Smoke Test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")

    # 1. Health endpoint
    st, health, _ = http_json(base, "/api/health")
    assert st == 200 and health.get("ok") is not False, f"Unhealthy: {health}"
    print("[E2E 1/5] /api/health OK")

    # 2. Login
    st, login_data, hdrs = http_json(
        base, "/api/login", method="POST", body={"email": args.email, "password": args.password}
    )
    assert st == 200 and login_data.get("email") == args.email, f"Login failed: {login_data}"
    raw_cookie = hdrs.get("Set-Cookie") or ""
    cookie = raw_cookie.split(";")[0]
    assert cookie, "Missing session cookie on /api/login"
    print(f"[E2E 2/5] /api/login OK (role={login_data.get('role')})")

    # 3. User Dashboard & Accounts
    st, dash, _ = http_json(base, "/api/dashboard?days=30", cookie=cookie)
    assert st == 200 and isinstance(dash.get("accounts"), list), "Invalid /api/dashboard payload"
    st, v1_accs, _ = http_json(base, "/api/v1/accounts", cookie=cookie)
    assert st == 200 and isinstance(v1_accs.get("accounts"), list), "Invalid /api/v1/accounts payload"
    print(
        f"[E2E 3/5] /api/dashboard & /api/v1/accounts OK "
        f"(accounts={len(dash['accounts'])}, orders={len(dash.get('orders', []))}, series={len(dash.get('series', []))})"
    )

    # 4. SSE Public Topbar Stream
    frame = check_sse_stream(base, "/api/v1/stream/topbar")
    print(f"[E2E 4/5] SSE /api/v1/stream/topbar OK ({frame}...)")

    # 5. SSE Authenticated User Stream
    uframe = check_sse_stream(base, "/api/v1/stream/user", cookie=cookie)
    print(f"[E2E 5/5] SSE /api/v1/stream/user OK ({uframe}...)")

    print("ALL E2E PORTAL & SSE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, urllib.error.URLError, Exception) as exc:
        print(f"E2E SMOKE FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
