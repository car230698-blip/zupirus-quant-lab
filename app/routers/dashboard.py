"""Dashboard Router — Single Source of Truth for trader portfolio and performance telemetry."""
import time
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from app.db import tx
from app.routers.deps import get_current_user
from app.redis_client import get_cached_heartbeat
from app.routers.telemetry import get_live_xauusd_quote

router = APIRouter(tags=["dashboard"])


@router.get('/api/dashboard')
def dashboard(
    u=Depends(get_current_user),
    account_id: Optional[str] = None,
    state: Optional[str] = None,
    days: int = 30,
):
    """Retrieve full dashboard data for the authenticated trader.
    Reads strictly from trading_accounts as the single source of truth.
    """
    now_ts = time.time()
    cutoff_ts = now_ts - max(1, min(days, 365)) * 86400

    with tx() as c:
        is_pg = bool(getattr(c, "_is_pg", False))
        accounts: List[Dict[str, Any]] = []

        if is_pg:
            c.execute("SAVEPOINT sp_dashboard_accounts")
        try:
            cloud_accs = [
                dict(r)
                for r in c.execute(
                    """
                    SELECT id, user_id, account_name, mt5_login, broker_server, platform,
                           account_type, currency, leverage, balance, equity, risk_percent,
                           max_lot, risk_multiplier, auto_trade, prop_stage,
                           prop_daily_dd_limit_pct, prop_max_dd_limit_pct, metaapi_state,
                           last_sync, created_at
                    FROM trading_accounts
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    """,
                    (u['id'],),
                )
            ]
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_dashboard_accounts")
            for ca in cloud_accs:
                ca['login'] = ca.get('mt5_login', ca.get('login'))
                ca['server'] = ca.get('broker_server', ca.get('server'))
                ca['mode'] = 'REAL'
                ca['is_real'] = True
                ca['enabled'] = bool(ca.get('auto_trade', 1))
                ca['is_active'] = bool(ca.get('auto_trade', 1))
            accounts.extend(cloud_accs)
        except Exception:
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_dashboard_accounts")
                except Exception:
                    pass

        # Legacy EA/Replay accounts if present
        try:
            legacy_accs = [
                dict(r) for r in c.execute(
                    "SELECT id, user_id, login, server, mode, enabled, balance, equity, peak, positions, seen, created_at FROM accounts WHERE user_id = ?",
                    (u['id'],)
                )
            ]
            for la in legacy_accs:
                la['is_real'] = (la.get('mode') == 'REAL')
                la['is_active'] = bool(la.get('enabled', 1))
            accounts.extend(legacy_accs)
        except Exception:
            pass

        # Enrich accounts with cached heartbeat from Redis if available
        for a in accounts:
            hb = get_cached_heartbeat(a.get('id', ''))
            if hb:
                a['cached_heartbeat'] = hb

        all_orders: List[Dict[str, Any]] = []

        # Load cloud MetaApi executions
        if is_pg:
            c.execute("SAVEPOINT sp_dashboard_exec")
        try:
            cloud_exec_rows = c.execute(
                """
                SELECT e.*, ta.mt5_login AS account_login, ta.broker_server AS account_server
                FROM metaapi_trade_executions e
                JOIN trading_accounts ta ON e.account_id = ta.id
                WHERE ta.user_id = ?
                ORDER BY e.executed_at DESC LIMIT 100
                """,
                (u['id'],),
            ).fetchall()
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_dashboard_exec")
            for r in cloud_exec_rows:
                rd = dict(r)
                raw_st = str(rd.get('status', '')).upper()
                if raw_st in {'FILLED', 'OPEN'}:
                    mapped_state = 'filled'
                elif raw_st in {'CLOSED', 'COMPLETED'}:
                    mapped_state = 'closed'
                elif raw_st in {'PENDING', 'QUEUED', 'DISPATCHING', 'INTENT'}:
                    mapped_state = 'queued'
                else:
                    mapped_state = 'rejected'

                if account_id and rd.get('account_id') != account_id:
                    continue
                if state and mapped_state != state:
                    continue

                vol_c = float(rd.get('volume') or 0.01)
                fp_c = float(rd.get('entry_price') or 0.0)
                all_orders.append({
                    'id': rd.get('id'),
                    'signal_id': rd.get('signal_id'),
                    'account_id': rd.get('account_id'),
                    'account_login': rd.get('account_login'),
                    'account_server': rd.get('account_server'),
                    'symbol': rd.get('symbol') or 'XAUUSD',
                    'side': rd.get('action') or 'BUY',
                    'volume': vol_c,
                    'price': fp_c,
                    'fill_price': fp_c,
                    'sl': rd.get('sl') or rd.get('stop_loss'),
                    'tp': rd.get('tp') or rd.get('take_profit'),
                    'ticket': rd.get('ticket') or rd.get('position_id') or '',
                    'deal': rd.get('order_id') or '',
                    'state': mapped_state,
                    'status': rd.get('status') or 'FILLED',
                    'pnl': rd.get('profit'),
                    'profit': rd.get('profit'),
                    'mt5_exact_pnl': True,
                    'latency_ms': rd.get('latency_ms'),
                    'source': 'CLOUD_MT5',
                    'created': rd.get('executed_at'),
                    'created_at': rd.get('executed_at'),
                    'closed_at': rd.get('closed_at'),
                    'updated': rd.get('closed_at') or rd.get('executed_at'),
                })
        except Exception:
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_dashboard_exec")
                except Exception:
                    pass

        # Legacy dispatches / Replay orders if present
        try:
            legacy_orders = [
                dict(r) for r in c.execute(
                    """
                    SELECT d.*, a.login AS account_login, a.server AS account_server, a.mode AS account_mode, a.mode AS mode
                    FROM dispatches d
                    JOIN accounts a ON d.account_id = a.id
                    WHERE a.user_id = ?
                    ORDER BY d.created DESC LIMIT 100
                    """,
                    (u['id'],)
                )
            ]
            for lod in legacy_orders:
                if account_id and lod.get('account_id') != account_id:
                    continue
                if state and lod.get('state') != state:
                    continue
                lod['source'] = 'REPLAY' if (lod.get('mode') == 'REPLAY' or lod.get('account_mode') == 'REPLAY') else 'EA_BRIDGE'
                all_orders.append(lod)
        except Exception:
            pass

        # Live quote for unrealized PnL calculation
        live_q = get_live_xauusd_quote()
        live_mid = float(live_q.get('mid') or 0.0)
        acc_by_id = {str(a.get('id')): a for a in accounts}
        filled_per_acc: Dict[str, List[dict]] = {}
        for d in all_orders:
            if d.get('state') == 'filled' and not d.get('closed_at'):
                filled_per_acc.setdefault(str(d.get('account_id')), []).append(d)

        for d in all_orders:
            fp = float(d.get('fill_price') or 0.0)
            vol = float(d.get('volume') or 0.01)
            side_u = str(d.get('side') or 'BUY').upper()
            acc_obj = acc_by_id.get(str(d.get('account_id')))
            is_open = d.get('state') == 'filled' and not d.get('closed_at')

            if is_open and fp > 0:
                hb_positions = (acc_obj or {}).get('cached_heartbeat', {}).get('open_positions') if acc_obj else None
                matched_hb_pos = None
                if isinstance(hb_positions, list):
                    for hp in hb_positions:
                        t_match = str(hp.get('ticket') or '')
                        if t_match and (t_match == str(d.get('ticket')) or t_match == str(d.get('position_id'))):
                            matched_hb_pos = hp
                            break
                if matched_hb_pos is not None:
                    d['pnl'] = round(float(matched_hb_pos.get('profit') or 0.0), 2)
                    d['profit'] = d['pnl']
                    d['live_price'] = round(float(matched_hb_pos.get('current_price') or live_mid), 3)
                    d['mt5_exact_pnl'] = True
                elif (
                    acc_obj
                    and int(acc_obj.get('positions') or 0) > 0
                    and len(filled_per_acc.get(str(d.get('account_id')), [])) == 1
                    and float(acc_obj.get('balance') or 0.0) > 0
                ):
                    exact_pnl = round(float(acc_obj.get('equity') or 0.0) - float(acc_obj.get('balance') or 0.0), 2)
                    d['pnl'] = exact_pnl
                    d['profit'] = exact_pnl
                    contract_sz = float((acc_obj or {}).get('contract_size') or 100.0)
                    price_delta = exact_pnl / (vol * contract_sz) if vol > 0 else 0.0
                    implied_live = (fp + price_delta) if side_u == 'BUY' else (fp - price_delta)
                    d['live_price'] = round(implied_live, 3)
                    d['mt5_exact_pnl'] = True
                elif live_mid > 0:
                    diff = (live_mid - fp) if side_u == 'BUY' else (fp - live_mid)
                    contract_sz = float((acc_obj or {}).get('contract_size') or 100.0)
                    d['pnl'] = round(diff * vol * contract_sz, 2)
                    d['profit'] = d['pnl']
                    d['live_price'] = live_mid

        orders = sorted(
            all_orders,
            key=lambda x: float(x.get('created') or x.get('created_at') or x.get('executed_at') or 0.0),
            reverse=True,
        )[:100]

        # Snapshots equity curve
        if account_id:
            raw_series = [
                dict(r)
                for r in c.execute(
                    """
                    SELECT s.* FROM snapshots s
                    WHERE s.account_id = ? AND s.ts >= ?
                      AND (EXISTS (SELECT 1 FROM trading_accounts ta WHERE ta.id = s.account_id AND ta.user_id = ?)
                           OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = s.account_id AND a.user_id = ?))
                    ORDER BY s.ts DESC LIMIT 400
                    """,
                    (account_id, cutoff_ts, u['id'], u['id']),
                )
            ][::-1]
            series = raw_series
        else:
            raw_series = [
                dict(r)
                for r in c.execute(
                    """
                    SELECT s.* FROM snapshots s
                    WHERE s.ts >= ?
                      AND (EXISTS (SELECT 1 FROM trading_accounts ta WHERE ta.id = s.account_id AND ta.user_id = ?)
                           OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = s.account_id AND a.user_id = ?))
                    ORDER BY s.ts ASC LIMIT 1200
                    """,
                    (cutoff_ts, u['id'], u['id']),
                )
            ]
            distinct_acc_ids = {str(pt.get('account_id') or 'default') for pt in raw_series}
            if len(distinct_acc_ids) <= 1:
                series = raw_series[-400:]
            else:
                buckets: Dict[int, Dict[str, Dict[str, float]]] = {}
                for pt in raw_series:
                    b_ts = int(float(pt.get('ts') or 0) // 60) * 60
                    acc_key = str(pt.get('account_id') or 'default')
                    if b_ts not in buckets:
                        buckets[b_ts] = {}
                    buckets[b_ts][acc_key] = {
                        'balance': float(pt.get('balance') or 0.0),
                        'equity': float(pt.get('equity') or 0.0),
                    }
                series = []
                last_known: Dict[str, Dict[str, float]] = {}
                for b_ts in sorted(buckets.keys()):
                    last_known.update(buckets[b_ts])
                    tot_bal = round(sum(v['balance'] for v in last_known.values()), 2)
                    tot_eq = round(sum(v['equity'] for v in last_known.values()), 2)
                    series.append({'ts': b_ts, 'balance': tot_bal, 'equity': tot_eq})
                series = series[-400:]

        health = dict(
            c.execute(
                "SELECT key,value FROM kv WHERE key IN ('execution_heartbeat','research_heartbeat','replay_price','strategy_last_decision','halted')"
            ).fetchall()
        )
        return {
            'accounts': accounts,
            'orders': orders,
            'series': series,
            'health': health,
            'real_trading': False,
        }
