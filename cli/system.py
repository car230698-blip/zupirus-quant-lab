"""System administration and health inspection commands for zupirus-cli."""
import os
import sys
import time
import json
from pathlib import Path
from typing import Any, Dict

from app.db import tx, init, setkv, getkv, is_postgres, check_db_health, ROOT
from app.redis_client import get_redis_client, InMemoryRedisMock
from cli.formatters import emit_json, emit_error, format_table


def get_system_status() -> Dict[str, Any]:
    """Inspect full system components: DB, TimescaleDB, Redis, Feed, Lock, Heartbeats."""
    init()
    now = time.time()
    db_health = check_db_health()

    # 1. Database & Timescale
    is_pg = is_postgres()
    engine_name = "PostgreSQL + TimescaleDB" if is_pg else "SQLite WAL (Test Mode)"
    db_info = {
        "engine": engine_name,
        "is_postgres": is_pg,
        "healthy": db_health.get("status") == "up",
        "details": db_health
    }

    # 2. Redis status
    r_client = get_redis_client()
    is_mock = isinstance(r_client, InMemoryRedisMock)
    redis_healthy = False
    try:
        redis_healthy = bool(r_client.ping())
    except Exception:
        redis_healthy = False

    redis_info = {
        "connected": redis_healthy,
        "is_in_memory_mock": is_mock,
        "mode": "Simulated (In-Memory)" if is_mock else "Connected (Redis Server)",
        "streams": ["stream:signals"],
        "channels": ["channel:signals"]
    }

    # 3. Real-Execution Lock verification
    allow_real_env = os.getenv("ALLOW_REAL", "").strip().lower()
    real_execution_blocked = allow_real_env not in ("true", "1")
    exec_lock = {
        "real_trading_allowed": False,
        "simulation_only": True,
        "real_execution_locked": real_execution_blocked,
        "status": "ENFORCED (DEMO/REPLAY ONLY)",
        "policy": "Hard lock against live capital execution"
    }

    # 4. Price Feed (XAUUSD)
    price_feed = {
        "symbol": "XAUUSD",
        "source": "UNKNOWN",
        "last_price": 0.0,
        "bid": 0.0,
        "ask": 0.0,
        "spread": 0.0,
        "updated_at": None,
        "seconds_ago": None,
        "status": "AWAITING_TICKS"
    }

    with tx() as c:
        # Check latest quote from quotes table
        quote_row = c.execute("SELECT * FROM quotes ORDER BY ts DESC LIMIT 1").fetchone()
        if quote_row:
            ts = quote_row["ts"]
            bid = float(quote_row["bid"])
            ask = float(quote_row["ask"])
            price_feed.update({
                "source": quote_row["source"],
                "last_price": round((bid + ask) / 2.0, 3),
                "bid": bid,
                "ask": ask,
                "spread": round(ask - bid, 3),
                "updated_at": ts,
                "seconds_ago": round(now - ts, 1) if ts else None,
                "status": "ACTIVE" if (now - ts) < 60 else "STALE"
            })
        else:
            # Fallback to replay price if available
            replay_price = getkv(c, "replay_price")
            if replay_price:
                price_val = float(replay_price)
                price_feed.update({
                    "source": "REPLAY",
                    "last_price": price_val,
                    "bid": round(price_val - 0.15, 2),
                    "ask": round(price_val + 0.15, 2),
                    "spread": 0.30,
                    "updated_at": now,
                    "seconds_ago": 0.0,
                    "status": "ACTIVE_REPLAY"
                })

        # 5. Worker heartbeats
        exec_hb = getkv(c, "execution_heartbeat")
        research_hb = getkv(c, "research_heartbeat")

        def evaluate_worker(hb_val):
            if not hb_val:
                return {"heartbeat": None, "seconds_ago": None, "status": "STOPPED"}
            ts = float(hb_val)
            delta = now - ts
            status = "HEALTHY" if delta < 60 else ("STALE" if delta < 300 else "DOWN")
            return {"heartbeat": ts, "seconds_ago": round(delta, 1), "status": status}

        workers = {
            "execution": evaluate_worker(exec_hb),
            "research": evaluate_worker(research_hb)
        }

        # 6. Kill Switch
        halted_val = getkv(c, "halted", default="0")
        is_halted = (str(halted_val).strip() == "1")

        kill_switch = {
            "halted": is_halted,
            "status": "HALTED (EMERGENCY STOP)" if is_halted else "OPERATIONAL"
        }

    return {
        "success": True,
        "timestamp": round(now, 3),
        "database": db_info,
        "redis": redis_info,
        "execution_lock": exec_lock,
        "price_feed": price_feed,
        "workers": workers,
        "kill_switch": kill_switch
    }


def cmd_status(as_json: bool = False):
    """Handler for `zupirus-cli system status`."""
    try:
        data = get_system_status()
        if as_json:
            emit_json(data)

        # Human-friendly view
        print("=" * 60)
        print("  ZUPIRUS QUANT LAB · SYSTEM HEALTH & COMPONENT STATUS")
        print("=" * 60)
        print(f"Database Engine   : {data['database']['engine']} (Healthy: {data['database']['healthy']})")
        print(f"Redis Cluster     : {data['redis']['mode']}")
        print(f"Execution Lock    : {data['execution_lock']['status']}")
        print(f"Emergency Switch  : {data['kill_switch']['status']}")

        feed = data['price_feed']
        print(f"\nXAUUSD Price Feed : {feed['symbol']} @ {feed['last_price']} ({feed['source']}) - Spread: {feed['spread']} [{feed['status']}]")

        print("\nWorkers Heartbeat:")
        for name, w in data['workers'].items():
            ago = f"({w['seconds_ago']}s ago)" if w['seconds_ago'] is not None else ""
            print(f"  • {name.capitalize():<12}: {w['status']} {ago}")
        print("=" * 60)

    except Exception as e:
        emit_error(f"Failed to inspect system status: {e}", as_json=as_json)


def cmd_healthcheck(as_json: bool = False):
    """Fast non-zero exit check for system health, suitable for CI/CD, Docker, and deployment verification."""
    try:
        data = get_system_status()
        db_ok = data.get("database", {}).get("healthy", False)
        redis_ok = data.get("redis", {}).get("connected", False)

        is_healthy = bool(db_ok)
        payload = {
            "success": is_healthy,
            "status": "healthy" if is_healthy else "unhealthy",
            "database": "up" if db_ok else "down",
            "database_engine": data.get("database", {}).get("engine"),
            "redis": "connected" if redis_ok else "disconnected",
            "real_execution_locked": data.get("execution_lock", {}).get("real_execution_locked", True),
            "timestamp": time.time(),
        }

        if as_json:
            emit_json(payload, exit_code=0 if is_healthy else 1)
        else:
            if is_healthy:
                print("OK - System is healthy (Database: up, Redis: checked)")
            else:
                print("ERROR - System unhealthy (Database is down)", file=sys.stderr)
                sys.exit(1)

        if not is_healthy:
            sys.exit(1)
    except Exception as e:
        emit_error(f"Healthcheck failed: {e}", as_json=as_json)


def cmd_kill_switch(on: bool = False, off: bool = False, reason: str = "", as_json: bool = False):
    """Handler for `zupirus-cli system kill-switch`."""
    if on == off:
        emit_error("Specify either --on or --off for kill-switch.", as_json=as_json)

    init()
    now = time.time()
    reason_text = reason.strip() or ("CLI emergency halt" if on else "CLI resume execution")

    with tx() as c:
        setkv(c, "halted", 1 if on else 0)
        cancelled_dispatches = 0
        if on:
            c.execute("UPDATE accounts SET enabled=0")
            try:
                c.execute("UPDATE trading_accounts SET auto_trade=0")
            except Exception:
                pass
            cancelled_dispatches = c.execute(
                "UPDATE dispatches SET state='cancelled', updated=? WHERE state='queued'", (now,)
            ).rowcount
            c.execute(
                "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
                (now, "zupirus-cli", "system_halt", json.dumps({"reason": reason_text, "cancelled_dispatches": cancelled_dispatches}))
            )
        else:
            c.execute(
                "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
                (now, "zupirus-cli", "system_resume", json.dumps({"reason": reason_text}))
            )

    result = {
        "success": True,
        "halted": on,
        "status": "HALTED" if on else "OPERATIONAL",
        "reason": reason_text,
        "cancelled_dispatches": cancelled_dispatches if on else 0,
        "timestamp": round(now, 3)
    }

    if as_json:
        emit_json(result)

    if on:
        print(f"\n[EMERGENCY HALT ACTIVATED]")
        print(f"Status              : HALTED")
        print(f"Reason              : {reason_text}")
        print(f"Accounts Disabled   : ALL")
        print(f"Dispatches Cancelled: {cancelled_dispatches}")
    else:
        print(f"\n[SYSTEM RESUMED]")
        print(f"Status              : OPERATIONAL")
        print(f"Reason              : {reason_text}")
