import os, time, secrets, sqlite3, logging
from typing import Literal, List, Dict, Any, Optional, Union
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
    root = Path(__file__).resolve().parents[2]
    mq5_path = root / "web" / "public" / "ZupirusDemoBridge.mq5"
    if not mq5_path.exists():
        mq5_path = root / "public" / "ZupirusDemoBridge.mq5"
    if not mq5_path.exists():
        mq5_path = root / "dist" / "ZupirusDemoBridge.mq5"
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
            # Multi-tenant attribution: if this MT5 login was registered by a customer in trading_accounts, attribute to that customer!
            matched_user = c.execute(
                "SELECT user_id FROM trading_accounts WHERE mt5_login = ? ORDER BY created_at DESC LIMIT 1",
                (p.login,)
            ).fetchone()
            if not matched_user:
                matched_user = c.execute(
                    "SELECT user_id FROM accounts WHERE login = ? AND user_id IS NOT NULL ORDER BY id DESC LIMIT 1",
                    (p.login,)
                ).fetchone()
            uid = matched_user[0] if (matched_user and matched_user[0]) else None
            if not uid:
                admin_u = c.execute("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
                if admin_u:
                    uid = admin_u['id']
            if uid:
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
                audit(c, aid, 'device_paired_auto_demo', {'login': p.login, 'server': p.server, 'user_id': uid})
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

class OpenPositionItem(Model):
    ticket: Union[str, int]
    symbol: str = 'XAUUSD'
    side: Literal['BUY', 'SELL'] = 'BUY'
    volume: float = Field(gt=0, le=1000)
    open_price: float = Field(gt=0, le=1e6)
    sl: float = Field(default=0.0, ge=0, le=1e6)
    tp: float = Field(default=0.0, ge=0, le=1e6)
    current_price: float = Field(default=0.0, ge=0, le=1e6)
    profit: float = Field(default=0.0)


class Heartbeat(Identity):
    balance: float = Field(ge=0, le=1e12)
    equity: float = Field(ge=0, le=1e12)
    positions: int = Field(ge=0, le=10000)
    bid: Optional[float] = Field(default=None, ge=0, le=1e6)
    ask: Optional[float] = Field(default=None, ge=0, le=1e6)
    open_positions: Optional[List[OpenPositionItem]] = None


@router.post('/api/ea/heartbeat', response_class=PlainTextResponse)
def heartbeat(p: Heartbeat, request: Request):
    with tx() as c:
        a = device(c, request, p)
        now = time.time()
        c.execute(
            'UPDATE accounts SET balance=?,equity=?,peak=CASE WHEN seen=0 THEN ? WHEN peak > ? THEN peak ELSE ? END,positions=?,seen=? WHERE id=?',
            (p.balance, p.equity, p.equity, p.equity, p.equity, p.positions, now, a['id'])
        )

        # Deadband snapshot throttling (avoid DB bloat while keeping accuracy)
        last_snap = c.execute(
            'SELECT ts, balance, equity FROM snapshots WHERE account_id=? ORDER BY ts DESC LIMIT 1',
            (a['id'],)
        ).fetchone()
        should_snap = True
        if last_snap:
            l_ts = float(last_snap['ts'] if isinstance(last_snap, dict) else last_snap[0])
            l_bal = float(last_snap['balance'] if isinstance(last_snap, dict) else last_snap[1])
            l_eq = float(last_snap['equity'] if isinstance(last_snap, dict) else last_snap[2])
            if (now - l_ts < 60) and abs(p.balance - l_bal) < 0.01 and abs(p.equity - l_eq) < 0.01:
                should_snap = False
        if should_snap:
            c.execute('INSERT INTO snapshots(account_id,ts,balance,equity) VALUES(?,?,?,?)', (a['id'], now, p.balance, p.equity))

        # If the EA sent open_positions, synchronize dispatches table so manual/open MT5 trades match 100%
        if p.open_positions is not None:
            live_tickets = set()
            for pos in p.open_positions:
                live_tickets.add(str(pos.ticket))
                existing_d = c.execute(
                    "SELECT id, signal_id FROM dispatches WHERE account_id=? AND ticket=?",
                    (a['id'], str(pos.ticket)),
                ).fetchone()
                reason_str = f"MT5 Live Demo Executed {pos.volume:.2f} lot {pos.symbol}"
                if existing_d:
                    c.execute(
                        "UPDATE dispatches SET state='filled', fill_price=?, volume=?, profit=?, reason=?, updated=? WHERE id=?",
                        (pos.open_price, pos.volume, pos.profit, reason_str, now, existing_d['id']),
                    )
                    c.execute(
                        "UPDATE signals SET side=?, price=?, sl=?, tp=? WHERE id=?",
                        (pos.side, pos.open_price, pos.sl, pos.tp, existing_d['signal_id']),
                    )
                else:
                    sig_id = f"sig_mt5_{pos.ticket}"
                    c.execute(
                        """
                        INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
                        VALUES(?, 'DEMO', ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET side=excluded.side, price=excluded.price, sl=excluded.sl, tp=excluded.tp
                        """,
                        (sig_id, pos.side, pos.open_price, pos.sl, pos.tp, now, now + 86400),
                    )
                    c.execute(
                        """
                        INSERT INTO dispatches(signal_id, account_id, state, ticket, deal, fill_price, volume, profit, reason, created, updated)
                        VALUES(?, ?, 'filled', ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(account_id, signal_id) DO UPDATE SET state='filled', ticket=excluded.ticket, fill_price=excluded.fill_price, volume=excluded.volume, profit=excluded.profit, reason=excluded.reason, updated=excluded.updated
                        """,
                        (sig_id, a['id'], str(pos.ticket), str(pos.ticket), pos.open_price, pos.volume, pos.profit, reason_str, now, now),
                    )
            # Soft-close filled dispatches whose tickets are no longer open on MT5 (NEVER HARD DELETE)
            if live_tickets:
                placeholders = ",".join(["?"] * len(live_tickets))
                closing_rows = c.execute(
                    f"SELECT id, signal_id, profit, fill_price, volume FROM dispatches WHERE account_id=? AND state='filled' AND ticket IS NOT NULL AND ticket NOT IN ({placeholders})",
                    tuple([a['id'], *live_tickets]),
                ).fetchall()
                c.execute(
                    f"UPDATE dispatches SET state='closed', updated=?, closed_at=COALESCE(closed_at, ?) WHERE account_id=? AND state='filled' AND ticket IS NOT NULL AND ticket NOT IN ({placeholders})",
                    tuple([now, now, a['id'], *live_tickets]),
                )
                for cr in closing_rows:
                    sig_id = cr['signal_id'] if hasattr(cr, 'keys') else cr[1]
                    pnl_val = float((cr['profit'] if hasattr(cr, 'keys') else cr[2]) or 0.0)
                    fill_p = float((cr['fill_price'] if hasattr(cr, 'keys') else cr[3]) or 0.0)
                    if sig_id:
                        try:
                            from app.hindsight import reflect_on_signal_outcome
                            reflect_on_signal_outcome(c, sig_id, pnl=pnl_val, exit_reason="MT5_DEAL_CLOSED", exit_price=fill_p)
                        except Exception as ref_err:
                            logger.debug(f"EA trade reflection error: {ref_err}")
            elif p.positions == 0:
                closing_rows = c.execute(
                    "SELECT id, signal_id, profit, fill_price, volume FROM dispatches WHERE account_id=? AND state='filled'",
                    (a['id'],),
                ).fetchall()
                c.execute("UPDATE dispatches SET state='closed', updated=?, closed_at=COALESCE(closed_at, ?) WHERE account_id=? AND state='filled'", (now, now, a['id']))
                for cr in closing_rows:
                    sig_id = cr['signal_id'] if hasattr(cr, 'keys') else cr[1]
                    pnl_val = float((cr['profit'] if hasattr(cr, 'keys') else cr[2]) or 0.0)
                    fill_p = float((cr['fill_price'] if hasattr(cr, 'keys') else cr[3]) or 0.0)
                    if sig_id:
                        try:
                            from app.hindsight import reflect_on_signal_outcome
                            reflect_on_signal_outcome(c, sig_id, pnl=pnl_val, exit_reason="MT5_ALL_CLOSED", exit_price=fill_p)
                        except Exception as ref_err:
                            logger.debug(f"EA trade reflection error: {ref_err}")

        # Cache heartbeat in Redis with 60s TTL
        cache_heartbeat(a['id'], {
            'login': a['login'],
            'server': a['server'],
            'balance': p.balance,
            'equity': p.equity,
            'positions': p.positions,
            'bid': p.bid,
            'ask': p.ask,
            'open_positions': [pos.model_dump() for pos in p.open_positions] if p.open_positions else None,
            'last_seen': now
        }, ttl=60)
        return 'OK'

@router.post('/api/ea/next', response_class=PlainTextResponse)
def next_dispatch(p: Identity, request: Request):
    with tx() as c:
        a = device(c, request, p)
        now_ts = time.time()
        # Intent Auto-Reaper: Expire abandoned intents older than 60s so they never deadlock the dispatch queue
        c.execute(
            "UPDATE dispatches SET state='expired', updated=? WHERE account_id=? AND state='intent' AND (? - updated) > 60",
            (now_ts, a['id'], now_ts)
        )
        d = c.execute(
            """
            SELECT d.*, s.side, s.price, s.sl, s.tp, s.expires
            FROM dispatches d
            JOIN signals s ON s.id=d.signal_id
            WHERE d.account_id=? AND s.source='DEMO'
              AND (
                (d.state='intent' AND (? - d.updated) <= 30)
                OR (d.state='queued' AND s.expires > ?)
              )
            ORDER BY CASE WHEN d.state='intent' THEN 0 ELSE 1 END, d.id LIMIT 1
            """,
            (a['id'], now_ts, now_ts)
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
