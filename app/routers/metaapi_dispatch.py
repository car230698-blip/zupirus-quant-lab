import time, secrets, json, logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from app.db import tx, audit
from app.redis_client import get_redis_client
from app.routers.deps import get_current_user, get_current_admin

logger = logging.getLogger("zupirus.api")
router = APIRouter()

class DispatchSignalPayload(BaseModel):
    symbol: str = Field(default="XAUUSD", max_length=16)
    action: str = Field(pattern="^(BUY|SELL|buy|sell)$")
    entry_price: float = Field(gt=0)
    sl: Optional[float] = None
    tp: Optional[float] = None
    rationale: Optional[str] = None

@router.post('/api/metaapi/dispatch-signal')
async def dispatch_direct_signal(p: DispatchSignalPayload, u=Depends(get_current_admin)):
    """Fan-Out Execution Engine: Dispatches market order directly to all connected MT5 Cloud accounts.
    Strictly protected: Admin-only, respects Kill-Switch, and enforces Mandatory Stop Loss.
    """
    import hashlib
    now_ts = time.time()
    act_upper = p.action.upper()
    sym_upper = p.symbol.upper()
    # Deterministic 10-second idempotency fingerprint so double-clicks cannot dispatch duplicate orders
    fp_raw = f"admin_direct:{sym_upper}:{act_upper}:{round(float(p.entry_price), 4)}:{round(float(p.sl or 0), 4)}:{int(now_ts // 10)}"
    signal_id = f"sig_{hashlib.sha256(fp_raw.encode()).hexdigest()[:12]}"

    with tx() as c:
        # 1. Enforce System Kill-Switch
        halted_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        is_halted = (halted_row and str(halted_row[0]).lower() in ('1', 'true'))
        if is_halted:
            logger.warning(f"Admin signal dispatch rejected: System kill-switch is active (halted=1)")
            raise HTTPException(status_code=403, detail="System kill-switch is active. Signal dispatch is halted.")

        # 2. Enforce Mandatory Stop Loss & Directional Geometry
        if p.sl is None or float(p.sl) <= 0:
            logger.warning(f"Admin signal dispatch rejected: Missing mandatory Stop Loss")
            raise HTTPException(status_code=422, detail="Mandatory Stop Loss missing. Direct dispatch requires valid SL.")
        if act_upper == "BUY" and float(p.sl) >= float(p.entry_price):
            raise HTTPException(status_code=422, detail="Invalid BUY Stop Loss: SL must be strictly below entry_price.")
        if act_upper == "SELL" and float(p.sl) <= float(p.entry_price):
            raise HTTPException(status_code=422, detail="Invalid SELL Stop Loss: SL must be strictly above entry_price.")

        # 3. Scan active cloud accounts with accepted disclaimers and active subscriptions
        now_ts = time.time()
        rows = c.execute("""
            SELECT a.id, a.user_id, a.metaapi_account_id, a.balance, a.equity,
                   a.max_lot,
                   a.risk_multiplier as multiplier,
                   a.is_prop_firm_mode, a.prop_stage, a.account_type, a.contract_size,
                   a.tick_value, a.currency,
                   a.is_compounding, a.prop_daily_dd_limit_pct, a.prop_profit_target_pct, a.risk_config
            FROM trading_accounts a
            LEFT JOIN subscriptions s ON s.user_id = a.user_id
            WHERE a.auto_trade=1 AND a.deployment_state='DEPLOYED' AND a.metaapi_account_id IS NOT NULL
              AND (
                  (s.service_expires_at IS NOT NULL AND s.service_expires_at > ?)
                  OR (a.cloud_expires_at IS NOT NULL AND a.cloud_expires_at > ?)
                  OR a.user_id IN (SELECT id FROM users WHERE role = 'admin')
              )
        """, (now_ts, now_ts)).fetchall()
        accounts = []
        seen_acc_ids = set()
        for r in rows:
            d = dict(r)
            if d["id"] in seen_acc_ids:
                continue
            seen_acc_ids.add(d["id"])
            rc = {}
            try:
                rc = json.loads(d.get("risk_config") or "{}") if isinstance(d.get("risk_config"), str) else (d.get("risk_config") or {})
            except Exception:
                rc = {}
            d["risk_percent"] = float(rc.get("risk_percent", rc.get("risk", 1.0)) or 1.0)
            d_max = d.get("max_lot")
            if d_max is not None and float(d_max) > 0:
                d["max_lot"] = float(d_max)
            else:
                d["max_lot"] = float(rc.get("max_lot", 5.0) or 5.0)
            accounts.append(d)
        seen_meta_ids = {a.get("metaapi_account_id") for a in accounts if a.get("metaapi_account_id")}

        try:
            legacy_rows = c.execute("""
                SELECT m.id, m.user_id, m.metaapi_account_id, m.balance, m.equity, m.risk_percent, m.max_lot, m.multiplier
                FROM metaapi_cloud_accounts m
                LEFT JOIN subscriptions s ON s.user_id = m.user_id
                WHERE m.auto_trade=1 AND m.disclaimer_id IS NOT NULL
                  AND (s.id IS NULL OR s.service_expires_at > ?)
            """, (now_ts,)).fetchall()
            for r in legacy_rows:
                d = dict(r)
                if d.get("metaapi_account_id") not in seen_meta_ids:
                    accounts.append(d)
        except Exception:
            pass

        audit(c, u.get("email") if isinstance(u, dict) else getattr(u, "email", "admin"), "admin_dispatch_signal", f"Signal {signal_id} {p.action} {p.symbol} @ {p.entry_price} SL={p.sl} TP={p.tp}")

    # 4. Also enqueue into Direct MT5 EA Bridge (dispatches) for any connected & enabled DEMO EA terminals
    ea_queued = 0
    try:
        from app.routers.ea import _ensure_ea_tables
        with tx() as c_ea:
            _ensure_ea_tables(c_ea)
            ea_rows = c_ea.execute(
                """
                SELECT a.id FROM accounts a
                JOIN devices d ON d.account_id = a.id
                WHERE a.enabled = 1 AND a.mode = 'DEMO'
                """
            ).fetchall()
            if ea_rows:
                tp_val = float(p.tp) if p.tp and float(p.tp) > 0 else (
                    round(float(p.entry_price) + abs(float(p.entry_price) - float(p.sl)) * 2.0, 2)
                    if act_upper == "BUY"
                    else round(float(p.entry_price) - abs(float(p.entry_price) - float(p.sl)) * 2.0, 2)
                )
                c_ea.execute(
                    """
                    INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
                    VALUES(?, 'DEMO', ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO NOTHING
                    """,
                    (signal_id, act_upper, float(p.entry_price), float(p.sl), tp_val, now_ts, now_ts + 300),
                )
                for er in ea_rows:
                    c_ea.execute(
                        """
                        INSERT INTO dispatches(signal_id, account_id, state, volume, created, updated)
                        VALUES(?, ?, 'queued', 0.01, ?, ?)
                        ON CONFLICT(account_id, signal_id) DO UPDATE SET updated=excluded.updated
                        """,
                        (signal_id, er["id"], now_ts, now_ts),
                    )
                    ea_queued += 1
    except Exception as ea_err:
        logger.warning(f"EA Bridge dispatch enqueue skipped: {ea_err}")

    if not accounts:
        return {
            "signal_id": signal_id,
            "message": (
                f"Đã đẩy tín hiệu xuống {ea_queued} trạm MT5 EA Bridge."
                if ea_queued > 0
                else "Không có tài khoản Cloud MT5 nào đang hoạt động."
            ),
            "total_accounts": ea_queued,
            "executed": ea_queued,
            "ea_bridge_queued": ea_queued,
            "fanout_elapsed_ms": 0
        }

    # 4-Layer Safety Sanitizer (Deduplication, Mandatory SL, News Shield, Entry Slippage)
    from app.domains.signals.ingestion.sanitizer import sanitize_and_audit_signal
    from app.schemas.signals import NormalizedSignalSchema
    norm_sig = NormalizedSignalSchema(
        id=signal_id,
        source="ADMIN_MANUAL",
        symbol=p.symbol.upper(),
        action=p.action.upper(),
        entry_price=p.entry_price,
        stop_loss=p.sl,
        take_profit=p.tp,
        strategy_tier="STANDARD",
        created_at=now_ts,
    )
    ok_san, reason_san, validated_sig = sanitize_and_audit_signal(norm_sig, live_price=p.entry_price, current_time=now_ts)
    if not ok_san:
        raise HTTPException(
            status_code=400,
            detail=f"Tín hiệu bị từ chối bởi 4 Lớp Giáp Bảo Vệ: {reason_san}"
        )
    if validated_sig.stop_loss and not p.sl:
        p.sl = validated_sig.stop_loss

    from app.metaapi import MetaApiClient, execute_fan_out_for_signal
    client = MetaApiClient()

    redis_cli = None
    try:
        redis_cli = get_redis_client()
    except Exception:
        pass

    signal_dict = {
        "id": signal_id,
        "symbol": p.symbol.upper(),
        "action": p.action.upper(),
        "entry_price": p.entry_price,
        "sl": p.sl,
        "tp": p.tp,
        "rationale": p.rationale
    }

    report = await execute_fan_out_for_signal(
        signal=signal_dict,
        accounts=accounts,
        metaapi_client=client,
        redis_client=redis_cli
    )

    # Persist execution records into database (if not already persisted by execute_fan_out_for_signal)
    with tx() as c:
        for ex in report.get("executions", []):
            if ex.get("persisted"):
                continue
            exec_id = f"exec_{secrets.token_hex(8)}"
            try:
                c.execute("""
                    INSERT INTO metaapi_trade_executions(
                        id, signal_id, account_id, metaapi_account_id, symbol,
                        action, volume, entry_price, sl, tp, position_id,
                        order_id, status, latency_ms, error_message, executed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    exec_id, signal_id, ex["account_id"], ex.get("metaapi_account_id"),
                    p.symbol.upper(), p.action.upper(), ex["volume"], p.entry_price,
                    p.sl, p.tp, ex.get("position_id"), ex.get("order_id"),
                    ex["status"], ex.get("latency_ms", 0), ex.get("error") or ex.get("message"), now_ts
                ))
            except Exception as e:
                logger.error(f"Error persisting trade execution {exec_id}: {e}")

        audit(c, u['id'], 'metaapi_fanout_dispatched', {
            'signal_id': signal_id,
            'symbol': p.symbol.upper(),
            'action': p.action.upper(),
            'executed': report.get('executed', 0),
            'failed': report.get('failed', 0),
            'avg_latency_ms': report.get('avg_latency_ms')
        })

    return report

@router.get('/api/metaapi/executions')
def list_metaapi_executions(limit: int = 50, u=Depends(get_current_user)):
    """List recent direct cloud executions."""
    limit = max(1, min(int(limit or 50), 200))
    with tx() as c:
        if u['role'] == 'admin':
            rows = c.execute("""
                SELECT e.*, a.mt5_login AS login, a.broker_server AS server, a.account_name
                FROM metaapi_trade_executions e
                LEFT JOIN trading_accounts a ON e.account_id = a.id
                ORDER BY e.executed_at DESC LIMIT ?
            """, (limit,)).fetchall()
        else:
            rows = c.execute("""
                SELECT e.*, a.mt5_login AS login, a.broker_server AS server, a.account_name
                FROM metaapi_trade_executions e
                JOIN trading_accounts a ON e.account_id = a.id
                WHERE a.user_id = ?
                ORDER BY e.executed_at DESC LIMIT ?
            """, (u['id'], limit)).fetchall()
        return {"executions": [dict(r) for r in rows]}

@router.get('/api/metaapi/telemetry')
def get_metaapi_telemetry(u=Depends(get_current_admin)):
    """Return cloud execution latency metrics and system health."""
    with tx() as c:
        total_accounts = c.execute("SELECT count(*) FROM trading_accounts").fetchone()[0]
        active_accounts = c.execute("SELECT count(*) FROM trading_accounts WHERE auto_trade=1").fetchone()[0]
        exec_stats = c.execute("""
            SELECT count(*), coalesce(avg(latency_ms), 0), coalesce(sum(case when status='FILLED' then 1 else 0 end), 0)
            FROM metaapi_trade_executions
        """).fetchone()

        from app.metaapi import MetaApiClient
        client = MetaApiClient()

        return {
            "cloud_engine": "MetaApi Cloud MT5",
            "mode": "Simulated Cloud" if client.is_mock else "Production MetaApi Gateway",
            "total_connected_accounts": total_accounts,
            "active_auto_trading_accounts": active_accounts,
            "total_orders_executed": exec_stats[0],
            "average_latency_ms": round(float(exec_stats[1]), 1),
            "fill_rate_percent": round((exec_stats[2] / exec_stats[0] * 100.0), 1) if exec_stats[0] > 0 else 100.0,
            "direct_to_user_enabled": True
        }
