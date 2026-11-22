"""Broker & Prop Firm Compliance Engine, Rule Profiles, Circuit Breakers & SePay Decoupling.
Pure Python, zero-leakage, strict risk enforcement.
"""
import time
import json
import random
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from app.db import tx, getkv, setkv

logger = logging.getLogger("zupirus.compliance")

# ---------------------------------------------------------------------------
# 5 Prop Rule Profiles
# ---------------------------------------------------------------------------

PROP_RULE_PROFILES = {
    "PERSONAL_STANDARD": {
        "profile_id": "PERSONAL_STANDARD",
        "name": "Personal Standard Account",
        "max_daily_dd_pct": 10.0,
        "max_total_dd_pct": 15.0,
        "news_shield": False,
        "allow_weekend_holding": True,
        "multiplier": 1.0,
        "daily_profit_lock_pct": 0.0,
    },
    "PERSONAL_CENT": {
        "profile_id": "PERSONAL_CENT",
        "name": "Personal Cent Account (100x Multiplier)",
        "max_daily_dd_pct": 10.0,
        "max_total_dd_pct": 15.0,
        "news_shield": False,
        "allow_weekend_holding": True,
        "multiplier": 100.0,
        "daily_profit_lock_pct": 0.0,
    },
    "FTMO_STANDARD": {
        "profile_id": "FTMO_STANDARD",
        "name": "FTMO Standard Challenge / Funded",
        "max_daily_dd_pct": 4.5,  # Strictly < 5.0%
        "max_total_dd_pct": 9.0,  # Strictly < 10.0%
        "news_shield": True,      # ±15m
        "allow_weekend_holding": False,
        "close_friday_utc": "20:30",
        "multiplier": 1.0,
        "daily_profit_lock_pct": 2.5,
    },
    "FTMO_SWING": {
        "profile_id": "FTMO_SWING",
        "name": "FTMO Swing Account",
        "max_daily_dd_pct": 4.5,
        "max_total_dd_pct": 9.0,
        "news_shield": False,
        "allow_weekend_holding": True,
        "multiplier": 1.0,
        "daily_profit_lock_pct": 3.0,
    },
    "FUNDEDNEXT_THE5ERS": {
        "profile_id": "FUNDEDNEXT_THE5ERS",
        "name": "FundedNext / The5ers Prop Account",
        "max_daily_dd_pct": 4.0,  # Conservatively under 5.0%
        "max_total_dd_pct": 8.0,
        "news_shield": True,
        "allow_weekend_holding": False,
        "close_friday_utc": "20:30",
        "trailing_dd": True,
        "multiplier": 1.0,
        "daily_profit_lock_pct": 2.0,
    },
}


def get_prop_rule_profile(profile_id: str) -> Dict[str, Any]:
    """Retrieve PropRuleProfile by ID with fallback to PERSONAL_STANDARD."""
    pid = profile_id.upper().strip() if profile_id else "PERSONAL_STANDARD"
    if pid in PROP_RULE_PROFILES:
        return dict(PROP_RULE_PROFILES[pid])
    # Mapping heuristics
    if "FTMO" in pid and "SWING" in pid:
        return dict(PROP_RULE_PROFILES["FTMO_SWING"])
    elif "FTMO" in pid:
        return dict(PROP_RULE_PROFILES["FTMO_STANDARD"])
    elif "CENT" in pid:
        return dict(PROP_RULE_PROFILES["PERSONAL_CENT"])
    elif "FUNDED" in pid or "5ER" in pid:
        return dict(PROP_RULE_PROFILES["FUNDEDNEXT_THE5ERS"])
    return dict(PROP_RULE_PROFILES["PERSONAL_STANDARD"])


def is_friday_weekend_close_window(now_ts: Optional[float] = None) -> bool:
    """Return True if current UTC time is between Friday 20:30 UTC and Sunday 21:00 UTC."""
    now = datetime.fromtimestamp(now_ts if now_ts is not None else time.time(), tz=timezone.utc)
    wd = now.weekday()  # Monday=0, Friday=4, Saturday=5, Sunday=6
    minute_of_day = now.hour * 60 + now.minute

    # Friday after 20:30 UTC (20 * 60 + 30 = 1230)
    if wd == 4 and minute_of_day >= 1230:
        return True
    # Saturday all day
    if wd == 5:
        return True
    # Sunday before 21:00 UTC (21 * 60 = 1260)
    if wd == 6 and minute_of_day < 1260:
        return True
    return False


def is_daily_profit_locked(account_id: str, daily_profit_pct: float, target_lock_pct: float = 2.5) -> bool:
    """Check if daily profit target is reached, locking further trades to protect challenge pass."""
    if target_lock_pct > 0 and daily_profit_pct >= target_lock_pct:
        logger.info(f"Account {account_id} daily profit {daily_profit_pct:.2f}% >= {target_lock_pct:.2f}%. Daily profit locked.")
        return True
    return False


def apply_execution_jitter_and_micro_variance(
    volume: float,
    min_vol: float = 0.01,
    vol_step: float = 0.01,
    seed: Optional[int] = None,
) -> Tuple[float, float]:
    """Calculate anti-fingerprinting execution jitter (0.3s - 1.8s) and micro-lot variance (±3%).
    Prevents broker copy-trading detection across multiple user accounts.
    """
    rng = random.Random(seed) if seed is not None else random

    delay = round(rng.uniform(0.3, 1.8), 2)
    # Variance ±3%
    var_factor = rng.uniform(0.97, 1.03)
    raw_var_vol = volume * var_factor

    # Round to volume step
    steps = round(raw_var_vol / vol_step)
    final_vol = max(min_vol, round(steps * vol_step, 2))
    return final_vol, delay


def calculate_compliant_sl_tp(
    symbol: str,
    side: str,
    entry_price: float,
    raw_sl: float,
    raw_tp: float,
    spec: Dict[str, Any],
    live_bid: Optional[float] = None,
    live_ask: Optional[float] = None,
) -> Tuple[float, float]:
    """Ensure SL/TP distance adheres strictly to broker's stopsLevel and freezeLevel.
    Anchors relative to live Bid/Ask.
    """
    pip_size = 0.10 if ("XAU" in symbol.upper() or "GOLD" in symbol.upper()) else 0.0001
    stops_level_points = float(spec.get("stopsLevel") or 0.0)
    min_dist = max(stops_level_points * (0.01 if "XAU" in symbol.upper() else 0.00001), 10 * pip_size)

    ref_price = (live_ask if side.upper() == "BUY" else live_bid) or entry_price

    if side.upper() == "BUY":
        # SL must be at least min_dist below ref_price
        sl = min(raw_sl, ref_price - min_dist)
        tp = max(raw_tp, ref_price + min_dist)
    else:
        # SL must be at least min_dist above ref_price
        sl = max(raw_sl, ref_price + min_dist)
        tp = min(raw_tp, ref_price - min_dist)

    digits = int(spec.get("digits") or (2 if "XAU" in symbol.upper() else 5))
    return round(sl, digits), round(tp, digits)


def tag_manual_closed_by_user(c, exec_id: str, now_ts: Optional[float] = None) -> None:
    """Tag an execution as MANUAL_CLOSED_BY_USER so Hindsight induction excludes it from strategy learning."""
    now = float(now_ts if now_ts is not None else time.time())
    ev_row = c.execute("SELECT evidence_json FROM metaapi_trade_executions WHERE id = ?", (exec_id,)).fetchone()
    prev_ev = {}
    if ev_row and ev_row[0]:
        try:
            prev_ev = json.loads(ev_row[0])
        except Exception:
            pass
    prev_ev["manual_closed_by_user"] = True
    prev_ev["manual_closed_at"] = now

    c.execute(
        """
        UPDATE metaapi_trade_executions
        SET origin = 'MANUAL_CLOSED_BY_USER', evidence_json = ?, last_verified_at = ?
        WHERE id = ?
        """,
        (json.dumps(prev_ev), now, exec_id)
    )
    logger.info(f"Execution {exec_id} tagged MANUAL_CLOSED_BY_USER and excluded from Hindsight induction.")


# ---------------------------------------------------------------------------
# Broker Circuit Breaker
# ---------------------------------------------------------------------------

def check_broker_circuit_breaker(server: str, db_cursor=None, now_ts: Optional[float] = None) -> Dict[str, Any]:
    """Check if broker server circuit breaker is OPEN (tripped due to >= 3 consecutive errors)."""
    now = float(now_ts if now_ts is not None else time.time())
    srv_key = server.replace(":", "_").replace("/", "_")
    kv_key = f"circuit_breaker:{srv_key}"

    raw = None
    if db_cursor is not None:
        row = db_cursor.execute("SELECT value FROM kv WHERE key = ?", (kv_key,)).fetchone()
        if row:
            raw = row["value"] if hasattr(row, "keys") else row[0]
    else:
        with tx() as c:
            raw = getkv(c, kv_key)

    if not raw:
        return {"tripped": False, "server": server, "consecutive_errors": 0}

    try:
        data = json.loads(raw)
        open_until = float(data.get("circuit_open_until") or 0.0)
        c_errs = int(data.get("consecutive_errors") or 0)
        if open_until > now:
            remaining = round(open_until - now, 1)
            return {
                "tripped": True,
                "server": server,
                "reason": data.get("reason", "Consecutive execution errors"),
                "remaining_seconds": remaining,
                "consecutive_errors": c_errs,
            }
        return {"tripped": False, "server": server, "consecutive_errors": c_errs}
    except Exception:
        pass

    return {"tripped": False, "server": server, "consecutive_errors": 0}


def record_broker_execution_error(
    server: str,
    error_type: str,
    db_cursor=None,
    now_ts: Optional[float] = None,
) -> Dict[str, Any]:
    """Record an execution error for broker server. If >= 3 consecutive errors, trip circuit breaker for 30m."""
    now = float(now_ts if now_ts is not None else time.time())
    srv_key = server.replace(":", "_").replace("/", "_")
    kv_key = f"circuit_breaker:{srv_key}"

    current = check_broker_circuit_breaker(server, db_cursor=db_cursor, now_ts=now)
    err_count = current.get("consecutive_errors", 0) + 1

    state = {
        "server": server,
        "consecutive_errors": err_count,
        "last_error": error_type,
        "last_error_at": now,
        "circuit_open_until": 0.0,
    }

    if err_count >= 3:
        state["circuit_open_until"] = now + 1800.0  # 30-minute isolation
        state["reason"] = f"Broker {server} triggered 30m Circuit Breaker after {err_count} consecutive execution errors ({error_type})."
        logger.critical(state["reason"])

    payload = json.dumps(state)
    if db_cursor is not None:
        db_cursor.execute("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (kv_key, payload))
    else:
        with tx() as c:
            setkv(c, kv_key, payload)

    return state


def reset_broker_circuit_breaker(server: str, db_cursor=None) -> None:
    """Reset broker circuit breaker upon successful execution."""
    srv_key = server.replace(":", "_").replace("/", "_")
    kv_key = f"circuit_breaker:{srv_key}"
    if db_cursor is not None:
        db_cursor.execute("DELETE FROM kv WHERE key = ?", (kv_key,))
    else:
        with tx() as c:
            setkv(c, kv_key, "")
