"""
ZUPIRUS Quant Lab - MetaApi Cloud Management CLI
Direct-to-User Cloud MT5 execution, lifecycle operations, and fan-out testing.
"""
import time
import json
import asyncio
from typing import Optional, List, Dict, Any

from app.db import tx, init
from app.metaapi import MetaApiClient, calculate_lot_size, execute_fan_out_for_signal
from cli.formatters import emit_json, emit_error, format_table


def cmd_cloud_list(as_json: bool = False):
    """List all connected MetaApi Cloud MT5 accounts with metrics and deployment state."""
    init()
    now = time.time()

    with tx() as c:
        rows = c.execute("""
            SELECT a.*, u.email
            FROM trading_accounts a
            LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
        """).fetchall()

    accounts_data: List[Dict[str, Any]] = []
    for r in rows:
        aid = r["id"]
        bal = float(r["balance"] or 0.0)
        eq = float(r["equity"] or 0.0)
        risk_conf = {}
        try:
            risk_conf = json.loads(r["risk_config"]) if r["risk_config"] else {}
        except Exception:
            pass

        exp = r.get("cloud_expires_at") if isinstance(r, dict) else (r["cloud_expires_at"] if "cloud_expires_at" in r.keys() else None)
        exp_str = time.strftime("%Y-%m-%d %H:%M", time.localtime(exp)) if exp else "LIFETIME"
        is_expired = bool(exp and exp < now)

        accounts_data.append({
            "account_id": aid,
            "mt5_login": r["mt5_login"],
            "broker_server": r["broker_server"],
            "user_email": r["email"] or "N/A",
            "metaapi_id": r["metaapi_account_id"] or "N/A",
            "deployment_state": r["deployment_state"],
            "auto_trade": bool(r["auto_trade"]),
            "balance": round(bal, 2),
            "equity": round(eq, 2),
            "risk_percent": risk_conf.get("risk_percent", 1.0),
            "max_lot": risk_conf.get("max_lot", 1.0),
            "subscription_expires": exp_str,
            "is_expired": is_expired,
            "last_sync": round(now - r["last_sync"], 1) if r["last_sync"] > 0 else None
        })

    if as_json:
        emit_json({
            "success": True,
            "total_accounts": len(accounts_data),
            "active_auto_trading": sum(1 for a in accounts_data if a["auto_trade"] and not a["is_expired"]),
            "accounts": accounts_data
        })

    print(f"\n================================================================================")
    print(f" ZUPIRUS Quant Lab · MetaApi Cloud Accounts ({len(accounts_data)} registered)")
    print(f"================================================================================\n")
    if not accounts_data:
        print("No Cloud MT5 accounts connected yet.\n")
        return

    headers = ["LOGIN", "SERVER", "USER", "STATE", "AUTO", "EQUITY", "EXPIRES"]
    rows_display = [
        [
            a["mt5_login"],
            a["broker_server"],
            a["user_email"],
            a["deployment_state"],
            "ON" if a["auto_trade"] else "OFF",
            f"${a['equity']:,.2f}",
            a["subscription_expires"]
        ]
        for a in accounts_data
    ]
    print(format_table(headers, rows_display))
    print("")


def cmd_cloud_sync(account_login: Optional[str] = None, as_json: bool = False):
    """Sync real-time equity and balance from MetaApi Cloud terminal."""
    init()
    client = MetaApiClient()

    with tx() as c:
        if account_login:
            rows = c.execute("SELECT * FROM trading_accounts WHERE mt5_login=?", (account_login.strip(),)).fetchall()
        else:
            rows = c.execute("SELECT * FROM trading_accounts WHERE auto_trade=1").fetchall()

    if not rows:
        emit_error(f"No trading accounts found{' for login ' + account_login if account_login else ''}.", as_json=as_json)

    synced = []
    now = time.time()

    async def _do_sync():
        for r in rows:
            meta_id = r["metaapi_account_id"] or r["id"]
            try:
                info = await client.get_account_information(meta_id)
                eq = float(info.get("equity", r["equity"]))
                bal = float(info.get("balance", r["balance"]))
                with tx() as c:
                    c.execute("UPDATE trading_accounts SET equity=?, balance=?, last_sync=? WHERE id=?", (eq, bal, now, r["id"]))
                synced.append({
                    "mt5_login": r["mt5_login"],
                    "server": r["broker_server"],
                    "balance": bal,
                    "equity": eq,
                    "connected": info.get("connected", True)
                })
            except Exception as e:
                synced.append({
                    "mt5_login": r["mt5_login"],
                    "server": r["broker_server"],
                    "error": str(e)
                })

    asyncio.run(_do_sync())

    if as_json:
        emit_json({
            "success": True,
            "synced_count": len(synced),
            "accounts": synced
        })

    print(f"✓ Synchronized {len(synced)} Cloud MT5 accounts with MetaApi.")


def cmd_cloud_undeploy_expired(as_json: bool = False):
    """Scan and undeploy accounts with expired subscriptions to prevent cloud hosting charges."""
    init()
    now = time.time()
    client = MetaApiClient()

    with tx() as c:
        rows = c.execute("""
            SELECT * FROM trading_accounts
            WHERE cloud_expires_at IS NOT NULL
              AND cloud_expires_at < ?
              AND deployment_state = 'DEPLOYED'
        """, (now,)).fetchall()

    undeployed = []

    async def _do_undeploy():
        for r in rows:
            meta_id = r["metaapi_account_id"]
            if meta_id:
                try:
                    await client.undeploy_account(meta_id)
                    with tx() as c:
                        c.execute("UPDATE trading_accounts SET deployment_state='UNDEPLOYED', auto_trade=0 WHERE id=?", (r["id"],))
                    undeployed.append(r["mt5_login"])
                except Exception as e:
                    pass

    asyncio.run(_do_undeploy())

    if as_json:
        emit_json({
            "success": True,
            "undeployed_count": len(undeployed),
            "logins": undeployed
        })

    print(f"✓ Undeployed {len(undeployed)} expired accounts.")


def cmd_cloud_dispatch_test(
    symbol: str = "XAUUSD",
    action: str = "BUY",
    price: Optional[float] = None,
    as_json: bool = False
):
    """Test microsecond Fan-Out dispatch across all active Cloud MT5 accounts."""
    init()
    client = MetaApiClient()

    with tx() as c:
        rows = c.execute("""
            SELECT id, user_id, mt5_login, broker_server, metaapi_account_id, balance, equity, risk_config
            FROM trading_accounts
            WHERE auto_trade=1 AND deployment_state='DEPLOYED'
        """).fetchall()

    if not rows:
        if as_json:
            emit_json({
                "success": True,
                "message": "No active DEPLOYED cloud accounts found to dispatch.",
                "executed": 0,
                "total_accounts": 0
            })
        print("No active DEPLOYED cloud accounts found.\n")
        return

    accounts = []
    for r in rows:
        conf = {}
        try:
            conf = json.loads(r["risk_config"]) if r["risk_config"] else {}
        except Exception:
            pass
        accounts.append({
            "id": r["id"],
            "metaapi_account_id": r["metaapi_account_id"] or r["id"],
            "user_id": r["user_id"],
            "equity": r["equity"],
            "balance": r["balance"],
            "risk_percent": conf.get("risk_percent", 1.0),
            "max_lot": conf.get("max_lot", 1.0),
            "multiplier": conf.get("multiplier", 1.0)
        })

    ref_price = price or 2650.0
    sl = ref_price - 5.0 if action.upper() == "BUY" else ref_price + 5.0
    tp = ref_price + 10.0 if action.upper() == "BUY" else ref_price - 10.0

    sig = {
        "id": f"cli_test_{int(time.time())}",
        "symbol": symbol.upper(),
        "action": action.upper(),
        "entry_price": ref_price,
        "sl": sl,
        "tp": tp
    }

    report = asyncio.run(execute_fan_out_for_signal(sig, accounts, client))

    if as_json:
        emit_json({
            "success": True,
            "executed": report.get("executed", 0),
            "total_accounts": report.get("total_accounts", 0),
            "report": report,
        })

    print(f"\n================================================================================")
    print(f" ZUPIRUS Quant Lab · Fan-Out Dispatch Test ({report['total_accounts']} accounts)")
    print(f"================================================================================")
    print(f" Signal ID:        {report['signal_id']}")
    print(f" Symbol / Action:  {report['symbol']} {report['action']} @ {ref_price:.2f}")
    print(f" Accounts Executed: {report['executed']} filled, {report['failed']} failed")
    print(f" Total Fan-Out Latency: {report.get('total_fanout_elapsed_ms', 0)} ms")
    print(f" Avg Order Latency:     {report.get('avg_latency_ms', 0)} ms\n")

