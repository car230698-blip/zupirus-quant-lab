"""Signal dispatch, testing, and full lifecycle tracing for zupirus-cli."""
import time
import json
import secrets
from typing import Optional

from app.db import tx, init, getkv
from app.redis_client import publish_signal_event, acquire_dispatch_lock, release_dispatch_lock
from cli.formatters import emit_json, emit_error, format_table


def cmd_signal_send_test(
    account_login: str,
    side: str,
    lot: float = 0.01,
    price: Optional[float] = None,
    force: bool = False,
    as_json: bool = False
):
    """Bắn tín hiệu thử nghiệm tới đúng một tài khoản MT5 Demo qua luồng xử lý thật."""
    init()
    now = time.time()
    clean_side = (side or "").strip().upper()
    if clean_side not in ("BUY", "SELL"):
        emit_error(f"Invalid side '{side}'. Must be BUY or SELL.", as_json=as_json)

    clean_login = (account_login or "").strip()
    if not clean_login:
        emit_error("Missing required --account login parameter.", as_json=as_json)

    with tx() as c:
        account = c.execute("SELECT * FROM accounts WHERE login=?", (clean_login,)).fetchone()
        if not account:
            emit_error(f"Account with login '{clean_login}' not found.", as_json=as_json)

        aid = account["id"]
        if not account["enabled"] and not force:
            emit_error(f"Account '{clean_login}' is currently disabled. Use --force or enable it first.", as_json=as_json)

        # Determine reference price
        ref_price = price
        if ref_price is None:
            # Check latest quote
            q = c.execute("SELECT bid, ask FROM quotes ORDER BY ts DESC LIMIT 1").fetchone()
            if q:
                ref_price = (float(q["bid"]) + float(q["ask"])) / 2.0
            else:
                rep = getkv(c, "replay_price")
                ref_price = float(rep) if rep else 2725.50

        ref_price = round(float(ref_price), 2)
        sign = 1 if clean_side == "BUY" else -1
        sl_price = round(ref_price - sign * 6.0, 2)
        tp_price = round(ref_price + sign * 12.0, 2)
        expires_at = round(now + 45.0, 1)

        sid = f"test_{secrets.token_hex(10)}"

        # 1. Insert into signals table
        c.execute(
            "INSERT INTO signals(id, source, side, price, sl, tp, created, expires) VALUES(?,?,?,?,?,?,?,?)",
            (sid, account["mode"], clean_side, ref_price, sl_price, tp_price, now, expires_at)
        )

        # 2. Insert into transactional outbox
        signal_payload = {
            "id": sid,
            "source": account["mode"],
            "side": clean_side,
            "price": ref_price,
            "sl": sl_price,
            "tp": tp_price,
            "lot": lot,
            "target_account_id": aid,
            "created": now,
            "expires": expires_at,
            "is_test": True
        }
        c.execute(
            "INSERT INTO outbox(event_type, payload, status, retry_count, created_at) VALUES(?,?,?,?,?)",
            ("signal_created", json.dumps(signal_payload), "pending", 0, now)
        )

        # 3. Publish to Redis Streams & PubSub
        redis_published = False
        try:
            publish_signal_event(signal_payload)
            c.execute(
                "UPDATE outbox SET status='published', published_at=? WHERE event_type='signal_created' AND status='pending' AND CAST(payload AS TEXT) LIKE ?",
                (now, f'%{sid}%')
            )
            redis_published = True
        except Exception:
            redis_published = False

        # 4. Create dispatch under distributed lock (signal_id + account_id)
        lock_token = acquire_dispatch_lock(aid, sid, ttl_seconds=30)
        try:
            c.execute(
                "INSERT INTO dispatches(account_id, signal_id, state, created, updated) VALUES(?,?,?,?,?)",
                (aid, sid, "queued", now, now)
            )
            dispatch_id = c.execute("SELECT id FROM dispatches WHERE account_id=? AND signal_id=?", (aid, sid)).fetchone()[0]
        finally:
            if lock_token:
                release_dispatch_lock(aid, sid, lock_token)

        c.execute(
            "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
            (now, "zupirus-cli", "test_signal_dispatched", json.dumps({"signal_id": sid, "account": clean_login, "side": clean_side}))
        )

    result = {
        "success": True,
        "signal_id": sid,
        "account_id": aid,
        "login": clean_login,
        "server": account["server"],
        "side": clean_side,
        "lot": lot,
        "price": ref_price,
        "sl": sl_price,
        "tp": tp_price,
        "created_at": round(now, 3),
        "expires_at": expires_at,
        "valid_duration_seconds": 45,
        "dispatch": {
            "id": dispatch_id,
            "state": "queued"
        },
        "redis_published": redis_published
    }

    if as_json:
        emit_json(result)

    print("\n[TEST SIGNAL DISPATCHED]")
    print(f"Signal ID    : {sid}")
    print(f"Target Login : {clean_login} ({account['server']})")
    print(f"Order Side   : {clean_side} {lot} Lot @ {ref_price}")
    print(f"SL / TP      : {sl_price} / {tp_price}")
    print(f"Dispatch ID  : #{dispatch_id} (State: queued)")
    print(f"Redis Stream : {'PUBLISHED' if redis_published else 'QUEUED IN OUTBOX'}")
    print(f"Expires in   : 45s (at {time.strftime('%H:%M:%S', time.localtime(expires_at))})")


def cmd_signal_trace(signal_id: str, as_json: bool = False):
    """Truy vết toàn trình vòng đời tín hiệu từ Database -> Redis -> EA -> Deal Ticket."""
    init()
    clean_sid = (signal_id or "").strip()
    if not clean_sid:
        emit_error("Missing required signal_id parameter.", as_json=as_json)

    now = time.time()

    with tx() as c:
        sig = c.execute("SELECT * FROM signals WHERE id=?", (clean_sid,)).fetchone()
        if not sig:
            emit_error(f"Signal '{clean_sid}' not found in signals registry.", as_json=as_json)

        outbox_rows = c.execute(
            "SELECT * FROM outbox WHERE CAST(payload AS TEXT) LIKE ? ORDER BY id DESC",
            (f'%{clean_sid}%',)
        ).fetchall()

        dispatch_rows = c.execute("""
            SELECT d.*, a.login, a.server, a.mode
            FROM dispatches d
            JOIN accounts a ON a.id = d.account_id
            WHERE d.signal_id = ?
            ORDER BY d.id ASC
        """, (clean_sid,)).fetchall()

    is_expired = (now > float(sig["expires"]))

    # Step 1: Signal details
    signal_info = {
        "id": sig["id"],
        "source": sig["source"],
        "side": sig["side"],
        "price": float(sig["price"]),
        "sl": float(sig["sl"]),
        "tp": float(sig["tp"]),
        "created_at": float(sig["created"]),
        "expires_at": float(sig["expires"]),
        "is_expired": is_expired,
        "seconds_remaining": max(0.0, round(float(sig["expires"]) - now, 1))
    }

    # Step 2: Outbox entries
    outbox_entries = []
    for o in outbox_rows:
        outbox_entries.append({
            "id": o["id"],
            "event_type": o["event_type"],
            "status": o["status"],
            "retry_count": int(o["retry_count"] or 0),
            "created_at": str(o["created_at"]),
            "published_at": str(o["published_at"]) if "published_at" in o.keys() and o["published_at"] else None
        })

    # Step 3: Dispatches and Deal anti-duplicate audit
    dispatches = []
    seen_deals = set()
    duplicate_detected = False

    for d in dispatch_rows:
        deal_num = d["deal"]
        ticket_num = d["ticket"]
        if deal_num:
            if deal_num in seen_deals:
                duplicate_detected = True
            seen_deals.add(deal_num)

        dispatches.append({
            "dispatch_id": d["id"],
            "account_id": d["account_id"],
            "login": d["login"],
            "server": d["server"],
            "mode": d["mode"],
            "state": d["state"],
            "nonce": d["nonce"],
            "ticket": ticket_num,
            "deal": deal_num,
            "reason": d["reason"],
            "created_at": float(d["created"]),
            "updated_at": float(d["updated"])
        })

    anti_duplicate_audit = {
        "passed": not duplicate_detected,
        "status": "PASS: No duplicate deals or concurrent double executions detected" if not duplicate_detected else "FAIL: Duplicate deal detected!",
        "unique_deals_count": len(seen_deals),
        "constraint_enforced": "UNIQUE(account_id, signal_id) + distributed lock"
    }

    trace_result = {
        "success": True,
        "signal": signal_info,
        "outbox": {
            "count": len(outbox_entries),
            "records": outbox_entries
        },
        "dispatches": {
            "count": len(dispatches),
            "records": dispatches
        },
        "anti_duplicate_audit": anti_duplicate_audit
    }

    if as_json:
        emit_json(trace_result)

    # Human readable trace view
    print("=" * 70)
    print(f"  SIGNAL LIFECYCLE TRACE: {clean_sid}")
    print("=" * 70)
    print(f"[1. Signal Engine]     : {sig['side']} @ {sig['price']} (SL: {sig['sl']}, TP: {sig['tp']})")
    print(f"                       Created: {time.strftime('%H:%M:%S', time.localtime(sig['created']))} | Expired: {is_expired}")

    outbox_status = outbox_entries[0]["status"] if outbox_entries else "NOT_FOUND"
    print(f"[2. Outbox & Redis]    : Event: signal_created | Status: {outbox_status}")

    print(f"\n[3. Account Dispatches ({len(dispatches)})]:")
    headers = ["Dispatch#", "Login", "Server", "State", "Ticket", "Deal", "Reason"]
    rows = [
        [d["dispatch_id"], d["login"], d["server"], d["state"], d["ticket"] or "-", d["deal"] or "-", d["reason"] or "-"]
        for d in dispatches
    ]
    print(format_table(headers, rows))

    print(f"\n[4. Anti-Duplicate]    : {anti_duplicate_audit['status']}")
    print("=" * 70)


def cmd_signal_test_ingest(
    action: str,
    price: float,
    sl: Optional[float] = None,
    tp: Optional[float] = None,
    strategy_tier: str = "STANDARD",
    symbol: str = "XAUUSD",
    as_json: bool = False
):
    """Test ingest an external signal through all 4 ZUPIRUS Safety Guards."""
    from app.schemas.signals import TradingViewWebhookPayload
    from app.services.signal_ingestion.normalizer import normalize_tradingview_signal
    from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal

    init()
    clean_action = (action or "").strip().upper()
    if clean_action not in ("BUY", "SELL"):
        emit_error(f"Invalid action '{action}'. Must be BUY or SELL.", as_json=as_json)

    payload = TradingViewWebhookPayload(
        action=clean_action,
        ticker=symbol.upper(),
        price=price,
        sl=sl,
        tp=tp,
        strategy_tier=strategy_tier.upper(),
        signal_id=f"test_cli_{secrets.token_hex(4)}"
    )

    sig = normalize_tradingview_signal(payload)
    approved, reject_reason, sanitized = sanitize_and_audit_signal(sig)

    result = {
        "status": "APPROVED" if approved else "REJECTED",
        "signal_id": sanitized.id,
        "symbol": sanitized.symbol,
        "action": sanitized.action,
        "entry_price": sanitized.entry_price,
        "stop_loss": sanitized.stop_loss,
        "take_profit": sanitized.take_profit,
        "strategy_tier": sanitized.strategy_tier,
        "reject_reason": reject_reason,
        "auto_sl_attached": sl is None and sanitized.stop_loss is not None,
    }

    if as_json:
        emit_json(result)
        return

    print("=== Signal Ingestion & 4 Safety Guards Test ===")
    print(f"Status:        {'[APPROVED]' if approved else '[REJECTED]'}")
    print(f"Signal ID:     {sanitized.id}")
    print(f"Order:         {sanitized.action} {sanitized.symbol} @ {sanitized.entry_price}")
    print(f"Stop Loss:     {sanitized.stop_loss} {'(Auto-attached by ATR Guard 1)' if result['auto_sl_attached'] else ''}")
    print(f"Take Profit:   {sanitized.take_profit or 'Open'}")
    if reject_reason:
        print(f"Reject Reason: {reject_reason}")


def cmd_signal_list_audit(limit: int = 20, as_json: bool = False):
    """List recent signal audit logs recorded by the safety guard pipeline."""
    init()
    with tx() as c:
        rows = c.execute(
            """
            SELECT id, signal_id, source_name, strategy_tier, symbol, side,
                   entry_price, stop_loss, take_profit, status, reject_reason, created_at
            FROM signal_audit_logs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()

    logs = [dict(r) for r in rows]

    if as_json:
        emit_json({"audit_logs": logs, "total": len(logs)})
        return

    if not logs:
        print("No signal audit logs found.")
        return

    headers = ["ID", "Signal", "Source", "Tier", "Side", "Entry", "SL", "Status", "Reason"]
    table_rows = []
    for l in logs:
        table_rows.append([
            l["id"][:12],
            l["signal_id"][:10],
            l["source_name"],
            l["strategy_tier"],
            l["side"],
            f"{float(l['entry_price']):.2f}" if l.get("entry_price") is not None else "-",
            f"{l['stop_loss']:.2f}" if l["stop_loss"] else "-",
            l["status"],
            l["reject_reason"] or "Passed All Guards",
        ])

    print(format_table(headers, table_rows))

