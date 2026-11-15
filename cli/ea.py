"""EA MT5 Client management and pairing operations for zupirus-cli."""
import time
import secrets
import hashlib
from typing import Optional, List, Dict, Any

from app.db import tx, init
from app.security import digest
from app.redis_client import get_cached_heartbeat
from cli.formatters import emit_json, emit_error, format_table


def cmd_ea_list(as_json: bool = False):
    """List all connected MT5 EAs with metrics, heartbeats, and pairing status."""
    init()
    now = time.time()

    with tx() as c:
        rows = c.execute("""
            SELECT a.*, u.email, d.token as device_token
            FROM accounts a
            LEFT JOIN users u ON u.id = a.user_id
            LEFT JOIN devices d ON d.account_id = a.id
            ORDER BY a.mode ASC, a.login ASC
        """).fetchall()

    accounts_data: List[Dict[str, Any]] = []
    for r in rows:
        aid = r["id"]
        peak = float(r["peak"] or 10000.0)
        equity = float(r["equity"] or 10000.0)
        balance = float(r["balance"] or 10000.0)
        seen = float(r["seen"] or 0.0)
        dd_pct = round(((peak - equity) / max(peak, 1.0)) * 100.0, 2)
        if dd_pct < 0:
            dd_pct = 0.0

        sec_ago = round(now - seen, 1) if seen > 0 else None
        if seen <= 0:
            status = "NEVER_CONNECTED"
        elif sec_ago is not None and sec_ago <= 60:
            status = "ONLINE"
        elif sec_ago is not None and sec_ago <= 300:
            status = "IDLE"
        else:
            status = "OFFLINE"

        # Check Redis cached heartbeat if available
        cached_hb = get_cached_heartbeat(aid)

        accounts_data.append({
            "account_id": aid,
            "login": r["login"],
            "server": r["server"],
            "mode": r["mode"],
            "user_email": r["email"] or "N/A",
            "enabled": bool(r["enabled"]),
            "paired": bool(r["device_token"]),
            "balance": round(balance, 2),
            "equity": round(equity, 2),
            "peak": round(peak, 2),
            "drawdown_pct": dd_pct,
            "open_positions": int(r["positions"] or 0),
            "last_heartbeat": seen if seen > 0 else None,
            "seconds_ago": sec_ago,
            "status": status,
            "cached_redis_heartbeat": cached_hb
        })

    payload = {
        "success": True,
        "total_count": len(accounts_data),
        "accounts": accounts_data
    }

    if as_json:
        emit_json(payload)

    # Human-readable table
    headers = ["Login", "Server", "Mode", "Paired", "Enabled", "Equity ($)", "DD %", "Positions", "Status", "Heartbeat"]
    table_rows = []
    for a in accounts_data:
        hb_str = f"{a['seconds_ago']}s ago" if a['seconds_ago'] is not None else "never"
        table_rows.append([
            a["login"],
            a["server"],
            a["mode"],
            "YES" if a["paired"] else "NO",
            "ON" if a["enabled"] else "OFF",
            f"{a['equity']:,.2f}",
            f"{a['drawdown_pct']}%",
            a["open_positions"],
            a["status"],
            hb_str
        ])

    print("=" * 80)
    print(f"  ZUPIRUS QUANT LAB · CONNECTED EA MT5 ACCOUNTS ({len(accounts_data)})")
    print("=" * 80)
    print(format_table(headers, table_rows))
    print("=" * 80)


def cmd_ea_pair_code(user_email: str, account_login: Optional[str] = None, as_json: bool = False):
    """Generate a single-use 10-minute pairing code for an EA."""
    init()
    now = time.time()
    clean_email = (user_email or "").strip().lower()

    if not clean_email:
        emit_error("Missing required --user email parameter.", as_json=as_json)

    with tx() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (clean_email,)).fetchone()
        if not u:
            # Create user if doesn't exist
            uid = secrets.token_hex(16)
            c.execute("INSERT INTO users(id, email, password, role) VALUES(?,?,?,?)",
                      (uid, clean_email, "cli-managed-account", "customer"))
            u = {"id": uid, "email": clean_email}

        # Find or create target DEMO account
        account = None
        if account_login:
            account = c.execute("SELECT * FROM accounts WHERE login=? AND user_id=?", (str(account_login), u["id"])).fetchone()
            if not account:
                emit_error(f"Account with login '{account_login}' not found for user {clean_email}.", as_json=as_json)
        else:
            account = c.execute("SELECT * FROM accounts WHERE user_id=? AND mode='DEMO'", (u["id"],)).fetchone()

        if not account:
            # Auto-create demo account for pairing test
            aid = secrets.token_hex(12)
            gen_login = str(secrets.randbelow(90000000) + 10000000)
            c.execute("""
                INSERT INTO accounts(id, user_id, login, server, mode, enabled, balance, equity, peak, seen, positions)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """, (aid, u["id"], gen_login, "MetaQuotes-Demo", "DEMO", 1, 10000.0, 10000.0, 10000.0, now, 0))
            account = c.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone()

        aid = account["id"]
        # Clear existing active pairings, reset enabled=1, and unpair previous device to allow clean pairing
        c.execute("UPDATE accounts SET enabled=1 WHERE id=?", (aid,))
        c.execute("DELETE FROM devices WHERE account_id=?", (aid,))
        c.execute("DELETE FROM pairings WHERE account_id=?", (aid,))

        # Generate single-use pairing code (e.g. ZP-A78291)
        rand_code = secrets.token_hex(3).upper()
        pairing_code = f"ZP-{rand_code}"
        expires_at = now + 600  # 10 minutes

        c.execute(
            "INSERT INTO pairings(code, account_id, expires, used) VALUES(?,?,?,0)",
            (digest(pairing_code), aid, expires_at)
        )
        c.execute(
            "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
            (now, "zupirus-cli", "ea_pair_code_issued", f'{{"account_id":"{aid}","login":"{account["login"]}"}}')
        )

    payload = {
        "success": True,
        "account_id": aid,
        "user_email": clean_email,
        "login": account["login"],
        "server": account["server"],
        "pairing_code": pairing_code,
        "expires_in_seconds": 600,
        "expires_at": round(expires_at, 1),
        "usage_instructions": "Enter this pairing code into InpPairingCode in MT5 EA settings."
    }

    if as_json:
        emit_json(payload)

    print("\n[EA PAIRING CODE GENERATED]")
    print(f"Account ID   : {aid}")
    print(f"Login        : {account['login']} ({account['server']})")
    print(f"Pairing Code : {pairing_code}")
    print(f"Valid For    : 10 minutes (Expires: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(expires_at))})")
    print(f"\nFill into EA:\n  InpPairingCode = {pairing_code}")


def cmd_ea_revoke(account_login: str, reason: str = "", as_json: bool = False):
    """Revoke an EA device token and disable copying for the account."""
    init()
    now = time.time()
    clean_login = (account_login or "").strip()

    if not clean_login:
        emit_error("Missing required --account login parameter.", as_json=as_json)

    with tx() as c:
        account = c.execute("SELECT * FROM accounts WHERE login=?", (clean_login,)).fetchone()
        if not account:
            emit_error(f"Account with login '{clean_login}' not found.", as_json=as_json)

        aid = account["id"]
        c.execute("DELETE FROM devices WHERE account_id=?", (aid,))
        c.execute("DELETE FROM pairings WHERE account_id=?", (aid,))
        c.execute("UPDATE accounts SET enabled=0 WHERE id=?", (aid,))
        cancelled_dispatches = c.execute(
            "UPDATE dispatches SET state='cancelled', updated=? WHERE account_id=? AND state='queued'", (now, aid)
        ).rowcount

        c.execute(
            "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
            (now, "zupirus-cli", "ea_revoked", f'{{"account_id":"{aid}","login":"{clean_login}","reason":"{reason}"}}')
        )

    payload = {
        "success": True,
        "account_id": aid,
        "login": clean_login,
        "server": account["server"],
        "revoked": True,
        "enabled": False,
        "cancelled_dispatches": cancelled_dispatches,
        "reason": reason.strip() or "Revoked via zupirus-cli",
        "timestamp": round(now, 3)
    }

    if as_json:
        emit_json(payload)

    print(f"\n[EA ACCESS REVOKED]")
    print(f"Account Login       : {clean_login}")
    print(f"Copy Status         : DISABLED (enabled=0)")
    print(f"Queued Dispatches   : {cancelled_dispatches} cancelled")
    print(f"Reason              : {payload['reason']}")
