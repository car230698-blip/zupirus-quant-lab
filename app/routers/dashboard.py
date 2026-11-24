"""Dashboard Router — Single Source of Truth for trader portfolio and performance telemetry."""
import os
import time
import re
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from app.db import tx
from app.routers.deps import get_current_user
from app.redis_client import get_cached_heartbeat
from app.core.redis_client import check_rate_limit
from app.routers.telemetry import get_live_xauusd_quote
from app.routers.accounts import _row_to_account_response

logger = logging.getLogger("zupirus.dashboard")
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
            cloud_rows = [
                dict(r)
                for r in c.execute(
                    """
                    SELECT a.*, u.email AS email, s.plan_tier, s.service_expires_at, s.allow_compounding, s.allow_prop_firm_mode
                    FROM trading_accounts a
                    LEFT JOIN users u ON u.id = a.user_id
                    LEFT JOIN subscriptions s ON s.user_id = a.user_id
                    WHERE a.user_id = ?
                    ORDER BY a.created_at DESC
                    """,
                    (u['id'],),
                )
            ]
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_dashboard_accounts")
            for cr in cloud_rows:
                acc_dict = _row_to_account_response(cr)
                acc_dict['mode'] = 'REAL'
                acc_dict['is_real'] = True
                acc_dict['is_active'] = bool(acc_dict.get('auto_trade', 1))
                accounts.append(acc_dict)
        except Exception as e:
            logger.warning("Failed to load trading_accounts in dashboard: %s", e)
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_dashboard_accounts")
                except Exception:
                    pass

        # Real MT5 accounts if present
        if is_pg:
            c.execute("SAVEPOINT sp_dashboard_real")
        try:
            real_accs = [
                dict(r) for r in c.execute(
                    "SELECT id, user_id, login, server, mode, enabled, balance, equity, peak, max_positions AS positions, seen FROM real_accounts WHERE user_id = ?",
                    (u['id'],)
                )
            ]
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_dashboard_real")
            for ra in real_accs:
                ra['is_real'] = True
                ra['is_active'] = bool(ra.get('enabled', 1))
            accounts.extend(real_accs)
        except Exception:
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_dashboard_real")
                except Exception:
                    pass

        # Legacy EA/Replay accounts if present (controlled via ENABLE_LEGACY_EA_BRIDGE, defaults to enabled in test/dev)
        if os.getenv("ENABLE_LEGACY_EA_BRIDGE", "true").strip().lower() == "true":
            if is_pg:
                c.execute("SAVEPOINT sp_dashboard_legacy")
            try:
                legacy_accs = [
                    dict(r) for r in c.execute(
                        "SELECT id, user_id, login, server, mode, enabled, balance, equity, peak, positions, seen FROM accounts WHERE user_id = ?",
                        (u['id'],)
                    )
                ]
                if is_pg:
                    c.execute("RELEASE SAVEPOINT sp_dashboard_legacy")
                for la in legacy_accs:
                    la['is_real'] = (la.get('mode') == 'REAL')
                    la['is_active'] = bool(la.get('enabled', 1))
                accounts.extend(legacy_accs)
            except Exception:
                if is_pg:
                    try:
                        c.execute("ROLLBACK TO SAVEPOINT sp_dashboard_legacy")
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
            # Issue 17 Fix: Filter by account_id in SQL before pagination
            acc_filter_clause = " AND e.account_id = ?" if account_id else ""
            exec_params = [u['id'], account_id] if account_id else [u['id']]
            cloud_exec_rows = c.execute(
                f"""
                SELECT e.*, ta.mt5_login AS account_login, ta.broker_server AS account_server
                FROM metaapi_trade_executions e
                JOIN trading_accounts ta ON e.account_id = ta.id
                WHERE ta.user_id = ?{acc_filter_clause}
                ORDER BY e.executed_at DESC LIMIT 100
                """,
                tuple(exec_params),
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
                elif raw_st in {'SKIPPED'}:
                    mapped_state = 'skipped'
                else:
                    mapped_state = 'rejected'

                if account_id and rd.get('account_id') != account_id:
                    continue
                if state and mapped_state != state:
                    continue

                vol_c = float(rd.get('volume') or 0.01)
                fp_c = float(rd.get('entry_price') or 0.0)
                reason_val = rd.get('error_message') or ''
                if not reason_val and rd.get('evidence_json'):
                    try:
                        ev_d = json.loads(rd.get('evidence_json'))
                        reason_val = ev_d.get('reason') or ev_d.get('skip_rationale') or ''
                    except Exception:
                        pass
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
                    'reason': reason_val,
                    'error_message': rd.get('error_message'),
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
            leg_filter_clause = " AND d.account_id = ?" if account_id else ""
            leg_params = [u['id'], account_id] if account_id else [u['id']]
            legacy_orders = [
                dict(r) for r in c.execute(
                    f"""
                    SELECT d.*, s.side, s.price, s.sl, s.tp, s.source AS signal_source,
                           a.login AS account_login, a.server AS account_server, a.mode AS account_mode, a.mode AS mode
                    FROM dispatches d
                    JOIN accounts a ON d.account_id = a.id
                    LEFT JOIN signals s ON d.signal_id = s.id
                    WHERE a.user_id = ?{leg_filter_clause}
                    ORDER BY d.created DESC LIMIT 100
                    """,
                    tuple(leg_params)
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
        live_q = get_live_xauusd_quote(db_cursor=c)
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
                # Issue 15 Fix: Handle expired / None cached_heartbeat gracefully without raising AttributeError
                hb_positions = ((acc_obj or {}).get('cached_heartbeat') or {}).get('open_positions') if acc_obj else None
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
                else:
                    # Issue 16 Fix: Use symbol-specific live quote rather than assuming gold (2700) for EUR/USD
                    d_sym = str(d.get('symbol') or 'XAUUSD').upper()
                    target_live_px = live_mid if 'XAU' in d_sym else None
                    if not target_live_px:
                        from app.domains.signals.ingestion.context import get_fresh_live_price
                        target_live_px = get_fresh_live_price(c, d_sym, max_age_sec=300.0)
                    if target_live_px and target_live_px > 0:
                        diff = (target_live_px - fp) if side_u == 'BUY' else (fp - target_live_px)
                        from app.services.symbol_precision import contract_size_for_symbol, quote_to_usd_rate
                        contract_sz = contract_size_for_symbol(d_sym, account_contract_size=float((acc_obj or {}).get('contract_size') or 100.0))
                        conv = quote_to_usd_rate(d_sym, target_live_px)
                        d['pnl'] = round(diff * vol * contract_sz * conv, 2)
                        d['profit'] = d['pnl']
                        d['live_price'] = target_live_px
                        d['mt5_exact_pnl'] = False

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
                    ORDER BY s.ts DESC LIMIT 1200
                    """,
                    (cutoff_ts, u['id'], u['id']),
                )
            ][::-1]
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


def _csv_safe(val: Any) -> Any:
    """Neutralize potential CSV formula injection (CWE-1236) by prepending a single quote."""
    if val is None:
        return ""
    s = str(val)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s


@router.get('/api/v1/orders/export')
def export_orders_csv(
    u=Depends(get_current_user),
    account_id: Optional[str] = None,
    days: int = 30,
):
    """Export trade execution statement as CSV with UTF-8 BOM (utf-8-sig)
    ensuring clean Vietnamese character display in Excel.
    Safely normalizes Cent accounts and defends against CSV Formula Injection.
    """
    import io
    import csv
    from fastapi.responses import Response

    if not check_rate_limit(f"orders_export:{u['id']}", limit=10, window_sec=60):
        raise HTTPException(
            status_code=429,
            detail="Quá nhiều yêu cầu xuất CSV. Giới hạn tối đa 10 lần/phút.",
        )

    now_ts = time.time()
    cutoff_ts = now_ts - max(1, min(days, 365)) * 86400

    with tx() as c:
        query = """
            SELECT e.executed_at, e.symbol, e.action, e.volume, e.entry_price,
                   e.profit, e.status, e.ticket, ta.account_name, ta.mt5_login, ta.broker_server,
                   ta.account_type, ta.currency
            FROM metaapi_trade_executions e
            JOIN trading_accounts ta ON e.account_id = ta.id
            WHERE ta.user_id = ? AND e.executed_at >= ?
        """
        params: List[Any] = [u["id"], cutoff_ts]
        if account_id:
            query += " AND ta.id = ?"
            params.append(account_id)
        query += " ORDER BY e.executed_at DESC"
        rows = c.execute(query, tuple(params)).fetchall()

    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 with BOM
    writer = csv.writer(buf)
    writer.writerow([
        "Thời Gian",
        "Tài Khoản MT5",
        "Máy Chủ",
        "Mã Giao Dịch",
        "Lệnh",
        "Khối Lượng (Lot)",
        "Giá Khớp",
        "Lợi Nhuận (Đơn vị gốc)",
        "Lợi Nhuận Quy Đổi (USD)",
        "Trạng Thái",
        "Ticket ID",
    ])

    for r in rows:
        d = dict(r) if hasattr(r, "keys") else {}
        ts = d.get("executed_at")
        date_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else ""

        acc_type = str(d.get("account_type") or "").upper()
        curr = str(d.get("currency") or "").upper()
        is_cent = acc_type == "CENT" or curr in ("USC", "EUC")
        raw_profit = float(d.get("profit") or 0.0)

        if is_cent:
            orig_unit = curr if curr else "USC"
            profit_orig_str = f"{raw_profit:.2f} {orig_unit}"
            profit_usd = round(raw_profit / 100.0, 2)
        else:
            orig_unit = curr if curr else "USD"
            profit_orig_str = f"{raw_profit:.2f} {orig_unit}"
            profit_usd = round(raw_profit, 2)

        acc_name = d.get("account_name", "")
        mt5_login = d.get("mt5_login", "")
        acc_label = f"{acc_name} (#{mt5_login})"

        writer.writerow([
            date_str,
            _csv_safe(acc_label),
            _csv_safe(d.get("broker_server", "")),
            _csv_safe(d.get("symbol", "XAUUSD")),
            _csv_safe(d.get("action", "")),
            d.get("volume", 0.0),
            d.get("entry_price", 0.0),
            _csv_safe(profit_orig_str),
            profit_usd,
            _csv_safe(d.get("status", "")),
            _csv_safe(d.get("ticket", "")),
        ])

    csv_bytes = buf.getvalue().encode("utf-8")
    filename = f"zupirus_sao_ke_lenh_{int(time.time())}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
