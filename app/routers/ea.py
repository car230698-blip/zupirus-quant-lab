import os, time, secrets, sqlite3, logging
from typing import Literal, List, Dict, Any, Optional
from fastapi import APIRouter, Request, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from app.db import tx, audit, insert_timescale_quote, DatabaseUnavailableError
from app.security import digest, token
from app.engine import news_blocked
from app.redis_client import cache_heartbeat, get_cached_heartbeat, acquire_dispatch_lock
from app.routers.deps import Model, fail, get_current_user, owned, device

logger = logging.getLogger("zupirus.api")
router = APIRouter()

class AccountCreate(Model):
    login: str = Field(min_length=1, max_length=24, pattern=r'^\d+$')
    server: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_. -]+$')
    mode: Literal['DEMO', 'REPLAY'] = 'DEMO'

@router.post('/api/accounts')
def create_account(p: AccountCreate, u=Depends(get_current_user)):
    aid = secrets.token_hex(12)
    with tx() as c:
        try:
            c.execute('INSERT INTO accounts(id,user_id,login,server,mode) VALUES(?,?,?,?,?)', (aid, u['id'], p.login, p.server, p.mode))
        except (sqlite3.IntegrityError, Exception):
            fail(409, 'Account/server already linked')
        audit(c, u['id'], 'account_created', {'id': aid, 'mode': p.mode})
    return {'id': aid}

@router.post('/api/replay')
def create_replay(u=Depends(get_current_user)):
    return create_account(AccountCreate(login=str(secrets.randbelow(10**12)), server='ZUPIRUS-SYNTHETIC', mode='REPLAY'), u)

class Risk(Model):
    enabled: bool
    risk: float = Field(ge=.01, le=1)
    max_spread: float = Field(gt=0, le=2)
    max_positions: int = Field(ge=1, le=3)
    max_dd: float = Field(ge=1, le=20)

@router.put('/api/accounts/{aid}/risk')
def risk(aid: str, p: Risk, u=Depends(get_current_user)):
    with tx() as c:
        owned(c, aid, u)
        c.execute('UPDATE accounts SET enabled=?,risk=?,max_spread=?,max_positions=?,max_dd=? WHERE id=?', (int(p.enabled), p.risk, p.max_spread, p.max_positions, p.max_dd, aid))
        if not p.enabled:
            c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE account_id=? AND state='queued'", (time.time(), aid))
        audit(c, u['id'], 'risk_changed', {'account': aid, **p.model_dump()})
    return {'ok': True}

def _ensure_ea_tables(c):
    c.execute(
        "CREATE TABLE IF NOT EXISTS pairings ("
        "code TEXT PRIMARY KEY, "
        "account_id TEXT REFERENCES accounts(id), "
        "expires DOUBLE PRECISION NOT NULL, "
        "used INTEGER NOT NULL DEFAULT 0)"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS devices ("
        "token TEXT PRIMARY KEY, "
        "account_id TEXT UNIQUE REFERENCES accounts(id))"
    )


@router.post('/api/accounts/{aid}/pair')
def pair_code(aid: str, u=Depends(get_current_user)):
    code = token()
    with tx() as c:
        _ensure_ea_tables(c)
        a = owned(c, aid, u)
        if a['mode'] not in ('DEMO', 'REAL'): fail(400, 'Only DEMO or REAL accounts pair with MT5')
        if a['mode'] == 'REAL':
            disc = c.execute("SELECT id FROM legal_disclaimers WHERE user_id=? AND status='active'", (u['id'],)).fetchone()
            if not disc:
                fail(403, "Yêu cầu ký xác nhận Điều khoản Miễn trừ trách nhiệm pháp lý trước khi ghép nối MT5 Real.")
        if c.execute('SELECT 1 FROM devices WHERE account_id=?', (aid,)).fetchone(): fail(409, 'Revoke old device first')
        c.execute('DELETE FROM pairings WHERE account_id=?', (aid,))
        c.execute('INSERT INTO pairings VALUES(?,?,?,0)', (digest(code), aid, time.time() + 300))
    return {'code': code, 'expires_in': 300}

@router.post('/api/accounts/{aid}/revoke')
def revoke(aid: str, u=Depends(get_current_user)):
    with tx() as c:
        _ensure_ea_tables(c)
        owned(c, aid, u)
        c.execute('DELETE FROM devices WHERE account_id=?', (aid,))
        c.execute('DELETE FROM pairings WHERE account_id=?', (aid,))
        c.execute('UPDATE accounts SET enabled=0 WHERE id=?', (aid,))
        c.execute("UPDATE dispatches SET state='cancelled' WHERE account_id=? AND state='queued'", (aid,))
        audit(c, u['id'], 'device_revoked', {'account': aid})
    return {'ok': True}

class Identity(Model):
    login: str
    server: str
    mode: Literal['DEMO']

class Pair(Identity):
    code: str = Field(max_length=100)

@router.get('/api/ea/download', response_class=PlainTextResponse)
def download_ea_bridge():
    """Serve the ready-to-compile ZupirusDemoBridge.mq5 Expert Advisor for MetaTrader 5 Desktop."""
    from pathlib import Path
    from fastapi.responses import Response
    mq5_path = Path(__file__).resolve().parents[2] / "public" / "ZupirusDemoBridge.mq5"
    content = mq5_path.read_text(encoding="utf-8") if mq5_path.exists() else "// ZupirusDemoBridge.mq5 not found"
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ZupirusDemoBridge.mq5"'},
    )


@router.post('/api/ea/pair', response_class=PlainTextResponse)
def pair(p: Pair):
    with tx() as c:
        _ensure_ea_tables(c)
        row = c.execute('SELECT p.*,a.login,a.server,a.mode FROM pairings p JOIN accounts a ON a.id=p.account_id WHERE code=?', (digest(p.code),)).fetchone()
        master_code = os.getenv('EA_DEMO_MASTER_CODE', 'ZUPIRUS-DEMO-2026').strip()
        if (not row or row['used'] or row['expires'] < time.time()) and p.mode == 'DEMO' and master_code and p.code.strip() == master_code:
            # Check if this login was explicitly deleted by the user from Web UI recently
            from app.db import getkv
            deleted_ts = getkv(c, f"ea_deleted:{p.login}")
            if deleted_ts and (time.time() - float(deleted_ts)) < 300:
                fail(403, 'Account was deleted from Web Portal. Remove and re-attach EA after 5 minutes to re-pair.')
            admin_u = c.execute("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
            if admin_u:
                uid = admin_u['id']
                acc = c.execute('SELECT id FROM accounts WHERE login=? AND server=?', (p.login, p.server)).fetchone()
                now_ts = time.time()
                if acc:
                    aid = acc['id']
                    c.execute(
                        "UPDATE accounts SET user_id=?, mode='DEMO', enabled=1, risk=0.5, max_spread=5.0, max_positions=10, max_dd=50.0 WHERE id=?",
                        (uid, aid),
                    )
                else:
                    aid = f"ea_demo_{secrets.token_hex(6)}"
                    c.execute(
                        """
                        INSERT INTO accounts(id, user_id, login, server, mode, enabled, risk, max_spread, max_positions, max_dd, balance, equity, peak, positions, seen)
                        VALUES(?, ?, ?, ?, 'DEMO', 1, 0.5, 5.0, 10, 50.0, 0.0, 0.0, 0.0, 0, 0)
                        """,
                        (aid, uid, p.login, p.server),
                    )
                c.execute('DELETE FROM devices WHERE account_id=?', (aid,))
                t = token()
                c.execute('INSERT INTO devices VALUES(?,?)', (digest(t), aid))
                audit(c, aid, 'device_paired_auto_demo', {'login': p.login, 'server': p.server})
                return t
        if not row or row['used'] or row['expires'] < time.time(): fail(401, 'Pairing expired or used')
        if (p.login, p.server, p.mode) != (row['login'], row['server'], row['mode']): fail(403, 'MT5 identity mismatch')
        t = token()
        c.execute('DELETE FROM devices WHERE account_id=?', (row['account_id'],))
        c.execute('INSERT INTO devices VALUES(?,?)', (digest(t), row['account_id']))
        c.execute('UPDATE pairings SET used=1 WHERE code=?', (digest(p.code),))
        audit(c, row['account_id'], 'device_paired', {})
    return t

def device(c, request: Request, p):
    bearer = request.headers.get('authorization', '')
    if not bearer.startswith('Bearer '): fail(401, 'Device credential required')
    a = c.execute('SELECT a.* FROM accounts a JOIN devices d ON d.account_id=a.id WHERE d.token=?', (digest(bearer[7:]),)).fetchone()
    if not a: fail(401, 'Invalid device')
    if (a['login'], a['server'], a['mode']) != (p.login, p.server, p.mode) or p.mode != 'DEMO': fail(403, 'Demo identity required')
    return a

class Heartbeat(Identity):
    balance: float = Field(ge=0, le=1e12)
    equity: float = Field(ge=0, le=1e12)
    positions: int = Field(ge=0, le=10000)

@router.post('/api/ea/heartbeat', response_class=PlainTextResponse)
def heartbeat(p: Heartbeat, request: Request):
    with tx() as c:
        a = device(c, request, p)
        now = time.time()
        c.execute(
            'UPDATE accounts SET balance=?,equity=?,peak=CASE WHEN seen=0 THEN ? WHEN peak > ? THEN peak ELSE ? END,positions=?,seen=? WHERE id=?',
            (p.balance, p.equity, p.equity, p.equity, p.equity, p.positions, now, a['id'])
        )
        c.execute('INSERT INTO snapshots(account_id,ts,balance,equity) VALUES(?,?,?,?)', (a['id'], now, p.balance, p.equity))
        # Cache heartbeat in Redis with 60s TTL
        cache_heartbeat(a['id'], {
            'login': a['login'],
            'server': a['server'],
            'balance': p.balance,
            'equity': p.equity,
            'positions': p.positions,
            'last_seen': now
        }, ttl=60)
        return 'OK'

@router.post('/api/ea/next', response_class=PlainTextResponse)
def next_dispatch(p: Identity, request: Request):
    with tx() as c:
        a = device(c, request, p)
        d = c.execute(
            "SELECT d.*,s.side,s.price,s.sl,s.tp,s.expires FROM dispatches d JOIN signals s ON s.id=d.signal_id WHERE d.account_id=? AND s.source='DEMO' AND (d.state IN ('intent','unknown') OR (d.state='queued' AND s.expires>?)) ORDER BY CASE WHEN d.state='queued' THEN 1 ELSE 0 END,d.id LIMIT 1",
            (a['id'], time.time())
        ).fetchone()
        if not d: return 'NONE'
        if d['state'] == 'queued' and not a['enabled']: return 'NONE'
        return '|'.join(map(str, [
            d['id'], d['state'], d['side'], d['price'], d['sl'], d['tp'],
            int(d['expires']), a['risk'], a['max_spread'], a['max_positions'],
            a['max_dd'], d['nonce'] or '-', a['peak']
        ]))

class Intent(Identity):
    dispatch: int = Field(gt=0)
    nonce: str = Field(min_length=16, max_length=100)
    spread: float = Field(ge=0, le=100)
    risk_amount: float = Field(gt=0, le=1e9)

@router.post('/api/ea/intent', response_class=PlainTextResponse)
def intent(p: Intent, request: Request):
    try:
        with tx() as c:
            a = device(c, request, p)
            d = c.execute('SELECT d.*,s.expires,s.source,s.id AS sig_id FROM dispatches d JOIN signals s ON s.id=d.signal_id WHERE d.id=? AND d.account_id=?', (p.dispatch, a['id'])).fetchone()
            if not d: fail(404, 'Dispatch not found')
            if d['state'] != 'queued': return 'RECONCILE'
            now = time.time()
            active = c.execute("SELECT count(*) FROM dispatches WHERE account_id=? AND state IN ('intent','unknown')", (a['id'],)).fetchone()[0]
            halted = c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()
            blocked = (
                bool(halted and halted[0] == '1')
                or not a['enabled']
                or a['mode'] != 'DEMO'
                or d['source'] != 'DEMO'
                or d['expires'] < now
                or now - a['seen'] > 30
                or p.spread > a['max_spread']
                or p.risk_amount > a['equity'] * a['risk'] / 100
                or a['positions'] + active >= a['max_positions']
                or a['equity'] <= 0
                or (a['peak'] > 0 and (a['peak'] - a['equity']) / a['peak'] * 100 >= a['max_dd'])
                or news_blocked(c, now)
            )
            if blocked: fail(409, 'Risk gate denied')

            # Check and acquire Redis Distributed Lock on signal_id + account_id
            lock_token = acquire_dispatch_lock(a['id'], d['sig_id'], ttl_seconds=15)
            if not lock_token:
                # Concurrent worker or intent already locked
                fail(409, 'Concurrent dispatch locked')

            c.execute("UPDATE dispatches SET state='intent',nonce=?,updated=? WHERE id=?", (p.nonce, now, p.dispatch))
            audit(c, a['id'], 'send_authorized', {'dispatch': p.dispatch})
            return 'SEND_ONCE'
    except DatabaseUnavailableError as e:
        fail(503, f'Primary database unavailable: {e}')

class Receipt(Identity):
    dispatch: int = Field(gt=0)
    nonce: str = Field(min_length=16, max_length=100)
    state: Literal['filled', 'unknown', 'rejected']
    ticket: str = Field(default='', max_length=30, pattern=r'^\d*$')
    deal: str = Field(default='', max_length=30, pattern=r'^\d*$')
    reason: str = Field(default='', max_length=200)
    price: Optional[float] = None

@router.post('/api/ea/report', response_class=PlainTextResponse)
def report(p: Receipt, request: Request):
    with tx() as c:
        a = device(c, request, p)
        d = c.execute('SELECT * FROM dispatches WHERE id=? AND account_id=?', (p.dispatch, a['id'])).fetchone()
        if not d or d['nonce'] != p.nonce: fail(409, 'Intent mismatch')
        if p.state == 'filled' and (not p.ticket or not p.deal or int(p.ticket) == 0 or int(p.deal) == 0):
            fail(422, 'Broker order and deal required')
        if d['state'] == 'filled':
            if p.state == 'filled' and (d['ticket'], d['deal']) == (p.ticket, p.deal): return 'OK'
            fail(409, 'Final receipt immutable')
        if d['state'] not in ('intent', 'unknown'): fail(409, 'Invalid transition')
        try:
            if p.price is not None:
                c.execute('UPDATE dispatches SET state=?,ticket=?,deal=?,reason=?,updated=?,fill_price=? WHERE id=?', (p.state, p.ticket or None, p.deal or None, p.reason, time.time(), p.price, p.dispatch))
            else:
                c.execute('UPDATE dispatches SET state=?,ticket=?,deal=?,reason=?,updated=? WHERE id=?', (p.state, p.ticket or None, p.deal or None, p.reason, time.time(), p.dispatch))
        except (sqlite3.IntegrityError, Exception):
            fail(409, 'Deal already assigned')
        audit(c, a['id'], 'execution_receipt', p.model_dump(exclude={'nonce'}))
    return 'OK'

class Quote(Model):
    source: Literal['DEMO']
    ts: float
    bid: float = Field(gt=0, le=1e6)
    ask: float = Field(gt=0, le=1e6)

@router.post('/api/feed')
def feed(p: Quote, request: Request):
    expected = os.getenv('FEED_TOKEN', '')
    if len(expected) < 32 or not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + expected):
        fail(403, 'Feed service only')
    if abs(time.time() - p.ts) > 10 or p.ask < p.bid:
        fail(422, 'Stale or invalid quote')
    # Record to TimescaleDB hypertable
    insert_timescale_quote(p.source, p.ts, p.bid, p.ask, symbol='XAUUSD')
    return {'ok': True}

@router.get('/api/dashboard')
def dashboard(u=Depends(get_current_user), account_id: Optional[str] = None, state: Optional[str] = None, days: int = 30):
    now_ts = time.time()
    cutoff_ts = now_ts - max(1, min(days, 365)) * 86400
    with tx() as c:
        is_pg = bool(getattr(c, "_is_pg", False))
        accounts = []
        if is_pg:
            c.execute("SAVEPOINT sp_ea_cloud_exec")
        try:
            cloud_accs = [dict(r) for r in c.execute('SELECT * FROM trading_accounts WHERE user_id=?', (u['id'],))]
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_ea_cloud_exec")
            for ca in cloud_accs:
                ca.pop('encrypted_master_password', None)
                ca.pop('password', None)
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
                    c.execute("ROLLBACK TO SAVEPOINT sp_ea_cloud_exec")
                except Exception:
                    pass

        if is_pg:
            c.execute("SAVEPOINT sp_ea_cloud_exec")
        try:
            real_accs = [dict(r) for r in c.execute('SELECT * FROM real_accounts WHERE user_id=?', (u['id'],))]
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_ea_cloud_exec")
            for ra in real_accs:
                ra['mode'] = 'REAL'
                ra['is_real'] = True
            accounts.extend(real_accs)
        except Exception:
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_ea_cloud_exec")
                except Exception:
                    pass

        if is_pg:
            c.execute("SAVEPOINT sp_ea_cloud_exec")
        try:
            legacy_accs = [dict(r) for r in c.execute('SELECT * FROM accounts WHERE user_id=?', (u['id'],))]
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_ea_cloud_exec")
            accounts.extend(legacy_accs)
        except Exception:
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_ea_cloud_exec")
                except Exception:
                    pass

        # Deduplicate accounts so each (login, server) appears only once
        seen_keys = set()
        deduped = []
        for a in accounts:
            key = (str(a.get('login')), str(a.get('server', '')).lower())
            if key not in seen_keys:
                seen_keys.add(key)
                deduped.append(a)
        accounts = deduped

        # Enrich accounts with cached heartbeat from Redis if available
        for a in accounts:
            hb = get_cached_heartbeat(a.get('id', ''))
            if hb:
                a['cached_heartbeat'] = hb
        
        query = '''
            SELECT d.*, s.side, s.price, s.sl, s.tp, s.source,
                   a.login AS account_login, a.server AS account_server
            FROM dispatches d
            JOIN signals s ON s.id=d.signal_id
            JOIN accounts a ON a.id=d.account_id
            WHERE a.user_id=?
        '''
        params: List[Any] = [u['id']]
        if account_id:
            if not any(a['id'] == account_id for a in accounts):
                fail(404, 'Account not found')
            query += ' AND d.account_id=?'
            params.append(account_id)
        if state:
            query += ' AND d.state=?'
            params.append(state)

        query += ' ORDER BY d.id DESC LIMIT 100'
        orders = [dict(r) for r in c.execute(query, tuple(params))]
        import re as _re
        from app.routers.telemetry import get_live_xauusd_quote
        live_q = get_live_xauusd_quote()
        live_mid = float(live_q.get('mid') or 0.0)
        for d in orders:
            d.pop('nonce', None)
            d['symbol'] = d.get('symbol') or 'XAUUSD'
            # Extract real lot size from execution receipt reason (e.g. "Executed 0.01 lot XAUUSD")
            if not d.get('volume'):
                m_lot = _re.search(r'([0-9]+\.[0-9]+)\s*lot', str(d.get('reason') or ''), _re.IGNORECASE)
                d['volume'] = float(m_lot.group(1)) if m_lot else 0.01
            fp = float(d.get('fill_price') or d.get('price') or 0.0)
            d['fill_price'] = fp
            # Compute live floating PnL for filled EA Bridge orders against real-time XAU/USD feed
            if d.get('state') == 'filled' and fp > 0 and live_mid > 0 and d.get('pnl') is None:
                vol = float(d.get('volume') or 0.01)
                side_u = str(d.get('side') or 'BUY').upper()
                diff = (live_mid - fp) if side_u == 'BUY' else (fp - live_mid)
                d['pnl'] = round(diff * vol * 100.0, 2)
                d['profit'] = d['pnl']
                d['live_price'] = live_mid
        is_pg = bool(getattr(c, "_is_pg", False))
        if is_pg:
            c.execute("SAVEPOINT sp_ea_cloud_exec")
        try:
            cloud_exec_rows = c.execute(
                """
                SELECT e.*, ta.mt5_login AS account_login, ta.broker_server AS account_server
                FROM metaapi_trade_executions e
                JOIN trading_accounts ta ON e.account_id = ta.id
                WHERE ta.user_id = ?
                ORDER BY e.executed_at DESC LIMIT 100
                """,
                (u['id'],)
            ).fetchall()
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_ea_cloud_exec")
            for r in cloud_exec_rows:
                rd = dict(r)
                raw_st = str(rd.get('status', '')).upper()
                if raw_st in {'FILLED', 'CLOSED', 'EXECUTED', 'COMPLETED', 'OPEN'}:
                    mapped_state = 'filled'
                elif raw_st in {'PENDING', 'QUEUED', 'DISPATCHING', 'INTENT'}:
                    mapped_state = 'queued'
                else:
                    mapped_state = 'rejected'
                if account_id and rd.get('account_id') != account_id:
                    continue
                if state and mapped_state != state:
                    continue
                orders.append({
                    'id': rd.get('id'),
                    'signal_id': rd.get('signal_id'),
                    'account_id': rd.get('account_id'),
                    'account_login': rd.get('account_login'),
                    'account_server': rd.get('account_server'),
                    'symbol': rd.get('symbol') or 'XAUUSD',
                    'side': rd.get('action') or 'BUY',
                    'volume': rd.get('volume') or 0.01,
                    'price': rd.get('entry_price') or 0.0,
                    'fill_price': rd.get('entry_price') or 0.0,
                    'sl': rd.get('sl') or rd.get('stop_loss'),
                    'tp': rd.get('tp') or rd.get('take_profit'),
                    'ticket': rd.get('ticket') or rd.get('position_id') or '',
                    'deal': rd.get('order_id') or '',
                    'state': mapped_state,
                    'status': rd.get('status') or 'FILLED',
                    'pnl': rd.get('profit'),
                    'profit': rd.get('profit'),
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
                    c.execute("ROLLBACK TO SAVEPOINT sp_ea_cloud_exec")
                except Exception:
                    pass

        if account_id:
            raw_series = [
                dict(r) for r in c.execute(
                    """
                    SELECT s.* FROM snapshots s
                    WHERE s.account_id = ? AND s.ts >= ?
                      AND (EXISTS (SELECT 1 FROM accounts a WHERE a.id = s.account_id AND a.user_id = ?)
                           OR EXISTS (SELECT 1 FROM trading_accounts ta WHERE ta.id = s.account_id AND ta.user_id = ?))
                    ORDER BY s.ts DESC LIMIT 400
                    """,
                    (account_id, cutoff_ts, u['id'], u['id'])
                )
            ][::-1]
            series = raw_series
        else:
            raw_series = [
                dict(r) for r in c.execute(
                    """
                    SELECT s.* FROM snapshots s
                    WHERE s.ts >= ?
                      AND (EXISTS (SELECT 1 FROM accounts a WHERE a.id = s.account_id AND a.user_id = ?)
                           OR EXISTS (SELECT 1 FROM trading_accounts ta WHERE ta.id = s.account_id AND ta.user_id = ?))
                    ORDER BY s.ts ASC LIMIT 1200
                    """,
                    (cutoff_ts, u['id'], u['id'])
                )
            ]
            distinct_acc_ids = {str(pt.get('account_id') or 'default') for pt in raw_series}
            if len(distinct_acc_ids) <= 1:
                series = raw_series[-400:]
            else:
                # Aggregate multi-account snapshots by 60-second time buckets so the portfolio curve is monotonic in time
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

        health = dict(c.execute("SELECT key,value FROM kv WHERE key IN ('execution_heartbeat','research_heartbeat','replay_price','strategy_last_decision','halted')").fetchall())
        return {'accounts': accounts, 'orders': orders, 'series': series, 'health': health, 'real_trading': False}

class RealAccountPayload(BaseModel):
    login: str = Field(min_length=1, max_length=24, pattern=r'^\d+$')
    server: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_. -]+$')
    risk: float = Field(default=0.01, ge=0.005, le=0.05)
    max_spread: float = Field(default=0.8, gt=0, le=2.0)
    max_dd: float = Field(default=5.0, ge=1.0, le=10.0)

@router.post('/api/accounts/real')
def create_real_account(p: RealAccountPayload, u=Depends(get_current_user)):
    """Creates an isolated Real MT5 account entry, strictly requiring signed risk disclaimer."""
    with tx() as c:
        disc = c.execute("SELECT id FROM legal_disclaimers WHERE user_id=? AND status='active'", (u['id'],)).fetchone()
        if not disc:
            fail(403, "Yêu cầu đọc và ký Điều khoản Miễn trừ trách nhiệm pháp lý trước khi mở kết nối tài khoản MT5 Real.")

        aid = f"real_{secrets.token_hex(8)}"
        now_ts = time.time()
        try:
            c.execute("""
                INSERT INTO real_accounts(id, user_id, login, server, disclaimer_id, mode, enabled, risk, max_spread, max_positions, max_dd, balance, equity, peak, seen, created_at)
                VALUES(?,?,?,?,?,?,0,?,?,1,?,0.0,0.0,0.0,?,?)
            """, (aid, u['id'], p.login, p.server, disc['id'], 'REAL', p.risk, p.max_spread, p.max_dd, now_ts, now_ts))
        except (sqlite3.IntegrityError, Exception):
            fail(409, "Tài khoản MT5 Real này đã được liên kết trong hệ thống.")

        audit(c, u['id'], 'real_account_created', {
            'id': aid,
            'login': p.login,
            'server': p.server,
            'disclaimer_id': disc['id']
        })

    return {
        "id": aid,
        "mode": "REAL",
        "message": "Đã tạo tài khoản MT5 Real thành công kèm chứng chỉ miễn trừ trách nhiệm pháp lý."
    }
