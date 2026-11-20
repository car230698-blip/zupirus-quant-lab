#!/usr/bin/env python3
"""
ZUPIRUS Quant Lab — MT5 Direct EA Bridge 5-Step Simulator (No MetaApi Required)
Demonstrates and verifies the complete end-to-end MT5 EA Bridge handshake:
  1. Provision DEMO Account & generate 5-minute single-use Pairing Code
  2. Pair simulated MT5 terminal via POST /api/ea/pair -> receive Device Bearer Token
  3. Stream live MT5 Heartbeat & Equity Snapshots via POST /api/ea/heartbeat
  4. Queue a live XAU/USD Signal & poll via POST /api/ea/next
  5. Verify Risk Gate + Redis Lock via POST /api/ea/intent (SEND_ONCE) & submit MT5 Ticket/Deal receipt via POST /api/ea/report
"""
import os
import sys
import time
import secrets
import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import tx, audit
from app.security import digest, token
from app.routers.telemetry import get_live_xauusd_quote


def run_ea_bridge_simulation(base_url: str = os.getenv("EA_BRIDGE_BASE_URL", "http://127.0.0.1:8000")) -> None:
    print("=" * 72)
    print(" ZUPIRUS MT5 DIRECT EA BRIDGE — 5-STEP LIVE PROTOCOL SIMULATION")
    print("=" * 72)

    quote = get_live_xauusd_quote()
    live_mid = round(float(quote.get("mid") or 3678.10), 2)
    sl_price = round(live_mid - 4.50, 2)
    tp_price = round(live_mid + 9.00, 2)
    now_ts = time.time()

    print(f"[LIVE FEED] XAU/USD Mid={live_mid} | Spread={quote.get('spread_pips', 2.8)} pips | Source={quote.get('source')}")

    # Target active accounts on the system so the user sees it immediately on Dashboard
    with tx() as c:
        users = c.execute(
            "SELECT id, email, role FROM users WHERE email IN ('tuleba2k8@gmail.com', 'admin@zupirus.local') ORDER BY role"
        ).fetchall()
        if not users:
            users = c.execute("SELECT id, email, role FROM users LIMIT 2").fetchall()

    for idx, u in enumerate(users, 1):
        uid = u["id"]
        email = u["email"]
        login_num = f"9988770{idx}"
        server_name = "MetaQuotes-Demo"

        print("-" * 72)
        print(f"Target User #{idx}: {email} (MT5 Demo Login: {login_num} @ {server_name})")

        # STEP 1: Create or reset DEMO account & generate 5-minute single-use Pairing Code
        pair_code = token()
        with tx() as c:
            from app.routers.ea import _ensure_ea_tables
            _ensure_ea_tables(c)
            existing = c.execute(
                "SELECT id FROM accounts WHERE login=? AND server=?",
                (login_num, server_name),
            ).fetchone()
            if existing:
                aid = existing["id"]
                c.execute(
                    "UPDATE accounts SET user_id=?, mode='DEMO', enabled=1, risk=0.5, max_spread=2.0, max_positions=5, max_dd=5.0, positions=0 WHERE id=?",
                    (uid, aid),
                )
            else:
                aid = f"ea_demo_{secrets.token_hex(6)}"
                c.execute(
                    """
                    INSERT INTO accounts(id, user_id, login, server, mode, enabled, risk, max_spread, max_positions, max_dd, balance, equity, peak, positions, seen)
                    VALUES(?, ?, ?, ?, 'DEMO', 1, 0.5, 2.0, 3, 5.0, 25000.0, 25000.0, 25000.0, 0, ?)
                    """,
                    (aid, uid, login_num, server_name, now_ts),
                )
            # Clear previous device/pairing so we can demonstrate fresh pairing
            c.execute("DELETE FROM devices WHERE account_id=?", (aid,))
            c.execute("DELETE FROM pairings WHERE account_id=?", (aid,))
            c.execute(
                "INSERT INTO pairings(code, account_id, expires, used) VALUES(?, ?, ?, 0)",
                (digest(pair_code), aid, now_ts + 300),
            )
        print(f"  [Step 1] Account {aid} ready | Generated 5-min Pairing Code: {pair_code[:12]}...")

        with httpx.Client(base_url=base_url, timeout=15.0) as client:
            # STEP 2: POST /api/ea/pair
            r_pair = client.post(
                "/api/ea/pair",
                json={
                    "login": login_num,
                    "server": server_name,
                    "mode": "DEMO",
                    "code": pair_code,
                },
            )
            assert r_pair.status_code == 200, f"Pair failed ({r_pair.status_code}): {r_pair.text}"
            device_token = r_pair.text.strip()
            auth_headers = {"Authorization": f"Bearer {device_token}"}
            print(f"  [Step 2] POST /api/ea/pair -> HTTP 200 | Device Bearer Token issued: {device_token[:14]}...")

            # STEP 3: POST /api/ea/heartbeat
            r_hb = client.post(
                "/api/ea/heartbeat",
                headers=auth_headers,
                json={
                    "login": login_num,
                    "server": server_name,
                    "mode": "DEMO",
                    "balance": 25000.0,
                    "equity": 25145.50,
                    "positions": 0,
                },
            )
            assert r_hb.status_code == 200 and r_hb.text.strip() == "OK", f"Heartbeat failed: {r_hb.text}"
            print("  [Step 3] POST /api/ea/heartbeat -> HTTP 200 (OK) | Synced Balance=$25,000.00, Equity=$25,145.50")

            # STEP 4: Queue a DEMO Signal & Dispatch for this account, then poll POST /api/ea/next
            sig_id = f"sig_ea_{secrets.token_hex(6)}"
            with tx() as c:
                c.execute(
                    """
                    INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
                    VALUES(?, 'DEMO', 'BUY', ?, ?, ?, ?, ?)
                    """,
                    (sig_id, live_mid, sl_price, tp_price, now_ts, now_ts + 300),
                )
                c.execute(
                    """
                    INSERT INTO dispatches(signal_id, account_id, state, created, updated)
                    VALUES(?, ?, 'queued', ?, ?)
                    """,
                    (sig_id, aid, now_ts, now_ts),
                )

            r_next = client.post(
                "/api/ea/next",
                headers=auth_headers,
                json={"login": login_num, "server": server_name, "mode": "DEMO"},
            )
            assert r_next.status_code == 200 and r_next.text.strip() != "NONE", f"Next failed: {r_next.text}"
            wire_payload = r_next.text.strip()
            parts = wire_payload.split("|")
            polled_disp_id = int(parts[0])
            print(f"  [Step 4] POST /api/ea/next -> HTTP 200 | Polled Dispatch #{polled_disp_id}: {wire_payload}")

            # STEP 5a: POST /api/ea/intent (Risk Gate + Redis Distributed Lock)
            intent_nonce = f"nonce_{secrets.token_hex(10)}"
            r_intent = client.post(
                "/api/ea/intent",
                headers=auth_headers,
                json={
                    "login": login_num,
                    "server": server_name,
                    "mode": "DEMO",
                    "dispatch": polled_disp_id,
                    "nonce": intent_nonce,
                    "spread": 0.28,
                    "risk_amount": 100.0,
                },
            )
            assert r_intent.status_code == 200 and r_intent.text.strip() == "SEND_ONCE", f"Intent failed ({r_intent.status_code}): {r_intent.text}"
            print(f"  [Step 5a] POST /api/ea/intent -> HTTP 200 ({r_intent.text.strip()}) | Risk Gate & Redis Lock PASSED")

            # STEP 5b: POST /api/ea/report (Submit MT5 Order Ticket & Deal Receipt)
            mt5_ticket = str(88000000 + secrets.randbelow(999999))
            mt5_deal = str(77000000 + secrets.randbelow(999999))
            r_rep = client.post(
                "/api/ea/report",
                headers=auth_headers,
                json={
                    "login": login_num,
                    "server": server_name,
                    "mode": "DEMO",
                    "dispatch": polled_disp_id,
                    "nonce": intent_nonce,
                    "state": "filled",
                    "ticket": mt5_ticket,
                    "deal": mt5_deal,
                    "reason": "Executed via Direct MT5 EA Bridge (0.22 Lot BUY XAUUSD)",
                    "price": live_mid,
                },
            )
            assert r_rep.status_code == 200 and r_rep.text.strip() == "OK", f"Report failed ({r_rep.status_code}): {r_rep.text}"
            print(
                f"  [Step 5b] POST /api/ea/report -> HTTP 200 (OK) | Confirmed FILLED @ ${live_mid} "
                f"(Ticket #{mt5_ticket}, Deal #{mt5_deal})"
            )

    print("=" * 72)
    print(" [SUCCESS] All 5 steps of MT5 Direct EA Bridge completed & persisted!")
    print("=" * 72)


if __name__ == "__main__":
    run_ea_bridge_simulation()
