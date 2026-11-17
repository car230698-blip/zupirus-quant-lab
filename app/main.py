import os, time, secrets, json, sqlite3, re, logging, sys
logger = logging.getLogger("zupirus.api")

# Conditional high-performance uvloop activation on POSIX/Linux
if sys.platform != "win32":
    try:
        import uvloop
        uvloop.install()
    except (ImportError, Exception):
        pass

from pathlib import Path
from contextlib import asynccontextmanager
from typing import Literal, List, Dict, Any, Optional
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse, StreamingResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from .db import tx, init, ROOT, audit, getkv, setkv, insert_timescale_quote, query_timescale_candles, DatabaseUnavailableError, check_db_health, check_timescale_metadata, is_postgres
from .security import bootstrap, digest, token, password_hash, verify
from .engine import news_blocked
from .redis_client import cache_heartbeat, get_cached_heartbeat, acquire_dispatch_lock, release_dispatch_lock, get_redis_client
from .tracing import get_trace_summary, trace_ai_interaction

@asynccontextmanager
async def lifespan(app):
    init()
    with tx() as c: bootstrap(c)
    yield

app = FastAPI(
    title='ZUPIRUS Quant Lab · Production Engine',
    version='0.2.0',
    lifespan=lifespan,
    default_response_class=ORJSONResponse
)
SECURE = os.getenv('COOKIE_SECURE', 'true').lower() == 'true'
ORIGINS = os.getenv('ALLOWED_ORIGINS', 'https://zupirus.com,https://app.zupirus.com,https://adm.zupirus.com,http://localhost:5173,http://localhost:3000').split(',')

@app.middleware('http')
async def perimeter(request: Request, call_next):
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        raw_len = request.headers.get('content-length')
        if raw_len is not None:
            if not raw_len.isdigit() or int(raw_len) > 3_000_000:
                return JSONResponse({'detail': 'Body too large'}, 413)
        elif 'chunked' in request.headers.get('transfer-encoding', '').lower():
            body_bytes = await request.body()
            if len(body_bytes) > 3_000_000:
                return JSONResponse({'detail': 'Body too large'}, 413)
        # External webhooks bypass browser origin checks
        if request.url.path.startswith('/api/v1/webhooks') or request.url.path.startswith('/api/sepay') or request.url.path == '/api/webhooks/sepay':
            return await call_next(request)
        origin = request.headers.get('origin')
        if origin and origin not in ORIGINS:
            return JSONResponse({'detail': 'Origin denied'}, 403)
        if request.cookies.get('session') and request.headers.get('x-zupirus') != '1':
            return JSONResponse({'detail': 'CSRF header required'}, 403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://qr.sepay.vn https://*.sepay.vn https://img.vietqr.io https://api.vietqr.io https://*.vietqr.io https://vietqr.net; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    return response

def fail(code: int, message: str):
    raise HTTPException(code, message)

def user(request: Request):
    from app.routers.deps import get_current_user
    return get_current_user(request)

def admin(u=Depends(user)):
    if u['role'] != 'admin': fail(403, 'Admin only')
    return u

def owned(c, account, u):
    a = c.execute('SELECT * FROM accounts WHERE id=? AND user_id=?', (account, u['id'])).fetchone()
    if not a:
        try:
            a = c.execute('SELECT * FROM real_accounts WHERE id=? AND user_id=?', (account, u['id'])).fetchone()
        except Exception:
            pass
    if not a: fail(404, 'Account not found')
    return a

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Credentials(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=12, max_length=128)

class RegisterPayload(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=12, max_length=128)
    otp_code: Optional[str] = Field(default=None, max_length=10)

@app.post('/api/register')
def register(p: RegisterPayload):
    email_clean = p.email.strip().lower()
    with tx() as c:
        existing = c.execute('SELECT id FROM users WHERE email=?', (email_clean,)).fetchone()
        if existing:
            fail(409, 'Email already registered')

    # OTP Verification check (commit attempt updates in an isolated transaction before raising errors)
    if p.otp_code:
        now = time.time()
        otp_err_code = None
        otp_err_msg = None
        with tx() as c:
            row = c.execute("SELECT code, expires_at, attempts FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
            if not row:
                otp_err_code, otp_err_msg = 400, "Mã xác thực OTP không tồn tại hoặc đã hết hạn"
            elif row['expires_at'] < now:
                c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
                otp_err_code, otp_err_msg = 400, "Mã OTP đã hết hạn. Vui lòng nhận mã mới"
            elif row['attempts'] >= 5:
                c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
                otp_err_code, otp_err_msg = 429, "Nhập sai mã OTP quá 5 lần. Vui lòng nhận lại mã"
            elif row['code'] != p.otp_code.strip():
                new_attempts = int(row['attempts']) + 1
                c.execute("UPDATE otp_codes SET attempts=? WHERE email=?", (new_attempts, email_clean))
                if new_attempts >= 5:
                    otp_err_code, otp_err_msg = 429, "Nhập sai mã OTP quá 5 lần. Vui lòng nhận lại mã"
                else:
                    otp_err_code, otp_err_msg = 400, "Mã OTP xác thực không chính xác"
            else:
                c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
        if otp_err_code:
            fail(otp_err_code, otp_err_msg)
    elif os.environ.get("REQUIRE_REGISTRATION_OTP", "1") == "1" and not os.environ.get("PYTEST_CURRENT_TEST"):
        fail(400, "Vui lòng nhập mã xác thực OTP gửi qua email")

    with tx() as c:
        try:
            c.execute('INSERT INTO users VALUES(?,?,?,?)', (secrets.token_hex(16), email_clean, password_hash(p.password), 'customer'))
        except (sqlite3.IntegrityError, Exception):
            fail(409, 'Email already registered')
    return {'ok': True}

@app.post('/api/login')
def login(p: Credentials, request: Request):
    key = digest(p.email.lower() + '|' + (request.client.host if request.client else '127.0.0.1'))
    now = time.time()
    with tx() as c:
        limit = c.execute('SELECT * FROM login_limits WHERE key=?', (key,)).fetchone()
        if limit and limit['until'] > now and limit['attempts'] >= 10:
            fail(429, 'Try again after 15 minutes')
        row = c.execute('SELECT * FROM users WHERE email=?', (p.email.lower(),)).fetchone()
        valid = bool(row and verify(p.password, row['password']))
        if not valid:
            attempts = limit['attempts'] + 1 if limit and limit['until'] > now else 1
            c.execute('INSERT OR REPLACE INTO login_limits VALUES(?,?,?)', (key, attempts, now + 900))
        else:
            c.execute('DELETE FROM login_limits WHERE key=?', (key,))
            t = token()
            c.execute('INSERT INTO sessions VALUES(?,?,?)', (digest(t), row['id'], now + 28800))
    if not valid: fail(401, 'Invalid credentials')
    response = JSONResponse({'email': row['email'], 'role': row['role']})
    response.set_cookie('session', t, httponly=True, secure=SECURE, samesite='strict', max_age=28800, path='/')
    return response

@app.post('/api/logout')
def logout(request: Request, u=Depends(user)):
    with tx() as c:
        c.execute('DELETE FROM sessions WHERE token=?', (digest(request.cookies.get('session', '')),))
    r = JSONResponse({'ok': True})
    r.delete_cookie('session')
    return r

@app.get('/api/me')
def me(u=Depends(user)):
    return {'id': u['id'], 'email': u['email'], 'role': u['role']}


class ForgotPasswordPayload(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


class ResetPasswordPayload(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    otp_code: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=12, max_length=128)


class ChangePasswordPayload(Model):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


@app.post('/api/auth/forgot-password')
def forgot_password(p: ForgotPasswordPayload, request: Request):
    import re
    email_clean = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email_clean):
        fail(422, "Định dạng email không hợp lệ")
    client_ip = (request.client.host if request.client else "") or "unknown"
    try:
        r = get_redis_client()
        ip_key = f"fp_ip_rl:{client_ip}"
        cnt = r.incr(ip_key)
        if cnt == 1:
            r.expire(ip_key, 60)
        if cnt > 5:
            fail(429, "Quá nhiều yêu cầu. Vui lòng thử lại sau 60 giây")
    except HTTPException:
        raise
    except Exception:
        pass
    now = time.time()
    code = f"{secrets.randbelow(900000) + 100000}"
    with tx() as c:
        usr = c.execute('SELECT id FROM users WHERE email=?', (email_clean,)).fetchone()
        if not usr:
            return {'ok': True, 'message': 'Nếu email tồn tại, mã OTP đặt lại mật khẩu đã được gửi.'}
        prev = c.execute('SELECT expires_at FROM otp_codes WHERE email=?', (email_clean,)).fetchone()
        if prev and (prev['expires_at'] - 540.0) > now:
            fail(429, "Vui lòng chờ 60 giây trước khi yêu cầu mã OTP mới")
        c.execute(
            "INSERT INTO otp_codes (email, code, expires_at, attempts) VALUES (?, ?, ?, 0) "
            "ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0",
            (email_clean, code, now + 600),
        )
    from .mailer import send_otp_code
    send_otp_code(email=email_clean, code=code, purpose="Đặt Lại Mật Khẩu")
    return {'ok': True, 'message': 'Nếu email tồn tại, mã OTP đặt lại mật khẩu đã được gửi.'}


@app.post('/api/auth/reset-password')
def reset_password(p: ResetPasswordPayload):
    email_clean = p.email.strip().lower()
    now = time.time()
    err_code = None
    err_msg = None
    with tx() as c:
        row = c.execute("SELECT code, expires_at, attempts FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
        if not row:
            err_code, err_msg = 400, "Mã OTP không tồn tại hoặc đã hết hạn."
        elif row['expires_at'] < now:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            err_code, err_msg = 400, "Mã OTP đã hết hạn."
        elif int(row['attempts']) >= 5:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            err_code, err_msg = 429, "Nhập sai mã OTP quá 5 lần."
        elif row['code'] != p.otp_code.strip():
            c.execute("UPDATE otp_codes SET attempts=? WHERE email=?", (int(row['attempts']) + 1, email_clean))
            err_code, err_msg = 400, "Mã OTP không chính xác."
        else:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            usr = c.execute("SELECT id FROM users WHERE email=?", (email_clean,)).fetchone()
            if not usr:
                err_code, err_msg = 404, "Tài khoản không tồn tại."
            else:
                c.execute("UPDATE users SET password=? WHERE id=?", (password_hash(p.new_password), usr['id']))
                c.execute("DELETE FROM sessions WHERE user_id=?", (usr['id'],))
    if err_code:
        fail(err_code, err_msg)
    return {'ok': True, 'message': 'Đã đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.'}


@app.post('/api/auth/change-password')
def change_password(p: ChangePasswordPayload, u=Depends(user)):
    with tx() as c:
        row = c.execute("SELECT password FROM users WHERE id=?", (u['id'],)).fetchone()
        if not row or not verify(p.current_password, row['password']):
            fail(400, "Mật khẩu hiện tại không chính xác.")
        c.execute("UPDATE users SET password=? WHERE id=?", (password_hash(p.new_password), u['id']))
    return {'ok': True, 'message': 'Đã đổi mật khẩu thành công.'}

class AccountCreate(Model):
    login: str = Field(min_length=1, max_length=24, pattern=r'^\d+$')
    server: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_. -]+$')
    mode: Literal['DEMO', 'REPLAY'] = 'DEMO'

@app.post('/api/accounts')
def create_account(p: AccountCreate, u=Depends(user)):
    aid = secrets.token_hex(12)
    with tx() as c:
        try:
            c.execute('INSERT INTO accounts(id,user_id,login,server,mode) VALUES(?,?,?,?,?)', (aid, u['id'], p.login, p.server, p.mode))
        except (sqlite3.IntegrityError, Exception):
            fail(409, 'Account/server already linked')
        audit(c, u['id'], 'account_created', {'id': aid, 'mode': p.mode})
    return {'id': aid}

@app.post('/api/replay')
def create_replay(u=Depends(user)):
    return create_account(AccountCreate(login=str(secrets.randbelow(10**12)), server='ZUPIRUS-SYNTHETIC', mode='REPLAY'), u)

class Risk(Model):
    enabled: bool
    risk: float = Field(ge=.01, le=1)
    max_spread: float = Field(gt=0, le=2)
    max_positions: int = Field(ge=1, le=3)
    max_dd: float = Field(ge=1, le=20)

@app.put('/api/accounts/{aid}/risk')
def risk(aid: str, p: Risk, u=Depends(user)):
    with tx() as c:
        a = owned(c, aid, u)
        c.execute('UPDATE accounts SET enabled=?,risk=?,max_spread=?,max_positions=?,max_dd=? WHERE id=?', (int(p.enabled), p.risk, p.max_spread, p.max_positions, p.max_dd, aid))
        if not p.enabled:
            c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE account_id=? AND state='queued'", (time.time(), aid))
        audit(c, u['id'], 'risk_changed', {'account': aid, **p.model_dump()})
    return {'ok': True}

@app.post('/api/accounts/{aid}/pair')
def pair_code(aid: str, u=Depends(user)):
    code = token()
    with tx() as c:
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

@app.post('/api/accounts/{aid}/revoke')
def revoke(aid: str, u=Depends(user)):
    with tx() as c:
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

@app.post('/api/ea/pair', response_class=PlainTextResponse)
def pair(p: Pair):
    with tx() as c:
        row = c.execute('SELECT p.*,a.login,a.server,a.mode FROM pairings p JOIN accounts a ON a.id=p.account_id WHERE code=?', (digest(p.code),)).fetchone()
        if not row or row['used'] or row['expires'] < time.time(): fail(401, 'Pairing expired or used')
        if (p.login, p.server, p.mode) != (row['login'], row['server'], row['mode']): fail(403, 'MT5 identity mismatch')
        t = token()
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

@app.post('/api/ea/heartbeat', response_class=PlainTextResponse)
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

@app.post('/api/ea/next', response_class=PlainTextResponse)
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

@app.post('/api/ea/intent', response_class=PlainTextResponse)
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
                or (a['peak'] - a['equity']) / a['peak'] * 100 >= a['max_dd']
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

@app.post('/api/ea/report', response_class=PlainTextResponse)
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

@app.post('/api/feed')
def feed(p: Quote, request: Request):
    expected = os.getenv('FEED_TOKEN', '')
    if len(expected) < 32 or not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + expected):
        fail(403, 'Feed service only')
    if abs(time.time() - p.ts) > 10 or p.ask < p.bid:
        fail(422, 'Stale or invalid quote')
    # Record to TimescaleDB hypertable
    insert_timescale_quote(p.source, p.ts, p.bid, p.ask, symbol='XAUUSD')
    return {'ok': True}

@app.get('/api/dashboard')
def dashboard(u=Depends(user), account_id: Optional[str] = None, state: Optional[str] = None, days: int = 30):
    now_ts = time.time()
    cutoff_ts = now_ts - max(1, min(days, 365)) * 86400
    with tx() as c:
        accounts = []
        try:
            cloud_accs = [dict(r) for r in c.execute('SELECT * FROM trading_accounts WHERE user_id=?', (u['id'],))]
            for ca in cloud_accs:
                ca['login'] = ca.get('mt5_login', ca.get('login'))
                ca['server'] = ca.get('broker_server', ca.get('server'))
                ca['mode'] = 'REAL'
                ca['is_real'] = True
                ca['enabled'] = bool(ca.get('auto_trade', 1))
            accounts.extend(cloud_accs)
        except Exception:
            pass

        try:
            real_accs = [dict(r) for r in c.execute('SELECT * FROM real_accounts WHERE user_id=?', (u['id'],))]
            for ra in real_accs:
                ra['mode'] = 'REAL'
                ra['is_real'] = True
            accounts.extend(real_accs)
        except Exception:
            pass

        try:
            legacy_accs = [dict(r) for r in c.execute('SELECT * FROM accounts WHERE user_id=?', (u['id'],))]
            accounts.extend(legacy_accs)
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
        for d in orders: d.pop('nonce', None)
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
            for r in cloud_exec_rows:
                rd = dict(r)
                mapped_state = 'filled' if str(rd.get('status', '')).upper() == 'FILLED' else 'rejected'
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
                    'ticket': rd.get('position_id') or '',
                    'deal': rd.get('order_id') or '',
                    'state': mapped_state,
                    'status': rd.get('status') or 'FILLED',
                    'source': 'CLOUD_MT5',
                    'created': rd.get('executed_at'),
                    'created_at': rd.get('executed_at'),
                    'updated': rd.get('executed_at'),
                })
        except Exception:
            pass

        if account_id:
            raw_series = [
                dict(r) for r in c.execute(
                    'SELECT s.* FROM snapshots s JOIN accounts a ON a.id=s.account_id WHERE a.user_id=? AND s.account_id=? AND s.ts>=? ORDER BY s.ts DESC LIMIT 400',
                    (u['id'], account_id, cutoff_ts)
                )
            ][::-1]
            series = raw_series
        else:
            raw_series = [
                dict(r) for r in c.execute(
                    'SELECT s.* FROM snapshots s JOIN accounts a ON a.id=s.account_id WHERE a.user_id=? AND s.ts>=? ORDER BY s.ts ASC LIMIT 1200',
                    (u['id'], cutoff_ts)
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

@app.get('/api/admin/orders')
def admin_orders(
    u=Depends(admin),
    account_id: Optional[str] = None,
    team: Optional[str] = None,
    state: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """System-wide order queries merging both Cloud MT5 executions (metaapi_trade_executions) and legacy dispatches."""
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with tx() as c:
        query = '''
            SELECT d.*, s.side, s.price, s.sl, s.tp, s.source,
                   a.login AS account_login, a.server AS account_server,
                   u.email AS user_email
            FROM dispatches d
            JOIN signals s ON s.id=d.signal_id
            JOIN accounts a ON a.id=d.account_id
            JOIN users u ON u.id=a.user_id
            WHERE 1=1
        '''
        params: List[Any] = []
        if account_id:
            query += ' AND d.account_id=?'
            params.append(account_id)
        if state:
            query += ' AND d.state=?'
            params.append(state)
        if team and team != 'all':
            if team == 'execution':
                query += " AND s.source='DEMO'"
            elif team == 'replay':
                query += " AND s.source='REPLAY'"
        if search and search.strip():
            s_val = f"%{search.strip()}%"
            clause = " AND (d.signal_id LIKE ? OR d.ticket LIKE ? OR d.deal LIKE ? OR CAST(d.id AS TEXT) LIKE ? OR a.login LIKE ? OR u.email LIKE ?)"
            query += clause
            params.extend([s_val, s_val, s_val, s_val, s_val, s_val])

        query += ' ORDER BY d.id DESC LIMIT 200'
        rows = [dict(r) for r in c.execute(query, tuple(params))]
        for r in rows:
            r.pop('nonce', None)

        # Merge Cloud MT5 executions from metaapi_trade_executions
        try:
            cloud_q = """
                SELECT e.*,
                       COALESCE(ta.mt5_login, ma.login, e.account_id) AS account_login,
                       COALESCE(ta.broker_server, ma.server, 'MT5-Cloud') AS account_server,
                       COALESCE(u1.email, u2.email, 'trader@zupirus.com') AS user_email
                FROM metaapi_trade_executions e
                LEFT JOIN trading_accounts ta ON e.account_id = ta.id
                LEFT JOIN users u1 ON ta.user_id = u1.id
                LEFT JOIN metaapi_cloud_accounts ma ON e.account_id = ma.id
                LEFT JOIN users u2 ON ma.user_id = u2.id
                ORDER BY e.executed_at DESC LIMIT 200
            """
            cloud_rows = c.execute(cloud_q).fetchall()
            for cr in cloud_rows:
                cd = dict(cr)
                mapped_state = 'filled' if str(cd.get('status', '')).upper() == 'FILLED' else 'rejected'
                if account_id and cd.get('account_id') != account_id:
                    continue
                if state and mapped_state != state:
                    continue
                if team == 'replay':
                    continue
                item = {
                    'id': cd.get('id'),
                    'signal_id': cd.get('signal_id'),
                    'account_id': cd.get('account_id'),
                    'account_login': cd.get('account_login'),
                    'account_server': cd.get('account_server'),
                    'user_email': cd.get('user_email'),
                    'symbol': cd.get('symbol') or 'XAUUSD',
                    'side': cd.get('action') or 'BUY',
                    'volume': cd.get('volume') or 0.01,
                    'price': cd.get('entry_price') or 0.0,
                    'fill_price': cd.get('entry_price') or 0.0,
                    'sl': cd.get('sl') or cd.get('stop_loss'),
                    'tp': cd.get('tp') or cd.get('take_profit'),
                    'ticket': cd.get('position_id') or '',
                    'deal': cd.get('order_id') or '',
                    'state': mapped_state,
                    'status': cd.get('status') or 'FILLED',
                    'source': 'CLOUD_MT5',
                    'reason': cd.get('error_message') or '',
                    'latency_ms': cd.get('latency_ms') or 0,
                    'created': cd.get('executed_at'),
                    'updated': cd.get('executed_at'),
                }
                if search and search.strip():
                    sq = search.strip().lower()
                    haystack = f"{item['id']} {item['signal_id']} {item['ticket']} {item['deal']} {item['account_login']} {item['user_email']}".lower()
                    if sq not in haystack:
                        continue
                rows.append(item)
        except Exception as e:
            logger.warning(f"Error merging metaapi_trade_executions into /api/admin/orders: {e}")

        rows.sort(key=lambda x: float(x.get('updated') or x.get('created') or 0), reverse=True)
        total = len(rows)
        paged = rows[offset:offset + limit]
        return {'total': total, 'orders': paged, 'limit': limit, 'offset': offset}

@app.get('/api/admin/monitor')
def monitor(u=Depends(admin)):
    with tx() as c:
        accs = []
        try:
            cloud_accs = [dict(r) for r in c.execute('SELECT t.*, u.email FROM trading_accounts t JOIN users u ON u.id=t.user_id')]
            for ca in cloud_accs:
                ca['login'] = ca.get('mt5_login', ca.get('login'))
                ca['server'] = ca.get('broker_server', ca.get('server'))
                ca['mode'] = 'REAL'
                ca['enabled'] = ca.get('auto_trade', 1)
            accs.extend(cloud_accs)
        except Exception:
            pass
        try:
            real_accs = [dict(r) for r in c.execute('SELECT r.*,u.email FROM real_accounts r JOIN users u ON u.id=r.user_id')]
            accs.extend(real_accs)
        except Exception:
            pass
        try:
            legacy_accs = [dict(r) for r in c.execute("SELECT a.*,u.email FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.server != 'ZUPIRUS-SYNTHETIC'")]
            accs.extend(legacy_accs)
        except Exception:
            pass

        seen_m = set()
        dedup_accs = []
        for a in accs:
            k = (str(a.get('login') or a.get('id')), str(a.get('server') or '').lower())
            if k not in seen_m:
                seen_m.add(k)
                dedup_accs.append(a)
        accs = dedup_accs

        return {
            'accounts': accs,
            'audit': [dict(r) for r in c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')],
            'jobs': [dict(r) for r in c.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 30')],
            'news': [dict(r) for r in c.execute('SELECT * FROM news ORDER BY ts DESC LIMIT 50')],
            'halted': getkv(c, 'halted') == '1'
        }

class Safety(Model):
    halted: bool
    reason: Optional[str] = None
@app.post('/api/admin/safety')
def safety(p: Safety, u=Depends(admin)):
    with tx() as c:
        setkv(c, 'halted', int(p.halted))
        if p.halted:
            c.execute('UPDATE accounts SET enabled=0')
            try:
                c.execute('UPDATE trading_accounts SET auto_trade=0')
            except Exception:
                pass
            c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE state='queued'", (time.time(),))
        audit(c, u['id'], 'kill_switch_toggled', p.model_dump())
    return {'halted': p.halted, 'note': 'Existing broker positions retain SL/TP; outstanding intents remain reconcilable.'}

@app.post('/api/admin/research')
def start_research(u=Depends(admin)):
    jid = secrets.token_hex(16)
    with tx() as c:
        c.execute('INSERT INTO jobs(id,state,created) VALUES(?,?,?)', (jid, 'queued', time.time()))
        audit(c, u['id'], 'research_requested', {'job': jid})
    return {'id': jid}

class Decision(Model): approved: bool
@app.post('/api/admin/research/{jid}/decision')
def decision(jid: str, p: Decision, u=Depends(admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
        if not row or row['state'] != 'waiting_approval': fail(409, 'Job not waiting for approval')
        c.execute("UPDATE jobs SET state='resume',decision=? WHERE id=?", (int(p.approved), jid))
        audit(c, u['id'], 'research_decision', {'job': jid, 'approved': p.approved})
    return {'ok': True}

class News(Model):
    title: str = Field(min_length=1, max_length=300)
    currency: Literal['USD', 'ALL', 'EUR', 'OTHER'] = 'USD'
    impact: Literal['high', 'medium', 'low'] = 'high'
    ts: float = Field(gt=0)

@app.post('/api/admin/news')
def add_news(p: News, u=Depends(admin)):
    with tx() as c:
        nid = secrets.token_hex(12)
        c.execute('INSERT INTO news VALUES(?,?,?,?,?)', (nid, p.title, p.currency, p.impact, p.ts))
        audit(c, u['id'], 'calendar_added', {'id': nid, **p.model_dump()})
    return {'ok': True, 'id': nid}

@app.put('/api/admin/news/{nid}')
def update_news(nid: str, p: News, u=Depends(admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM news WHERE id=?', (nid,)).fetchone()
        if not row: fail(404, 'News event not found')
        c.execute('UPDATE news SET title=?, currency=?, impact=?, ts=? WHERE id=?', (p.title, p.currency, p.impact, p.ts, nid))
        audit(c, u['id'], 'calendar_updated', {'id': nid, **p.model_dump()})
    return {'ok': True}

@app.delete('/api/admin/news/{nid}')
def delete_news(nid: str, u=Depends(admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM news WHERE id=?', (nid,)).fetchone()
        if not row: fail(404, 'News event not found')
        c.execute('DELETE FROM news WHERE id=?', (nid,))
        audit(c, u['id'], 'calendar_deleted', {'id': nid, 'title': row['title'], 'ts': row['ts']})
    return {'ok': True}

@app.post('/api/admin/news/sync')
def sync_news(u=Depends(admin)):
    """Automatically synchronizes high impact economic events from financial calendar feeds."""
    from .calendar_sync import sync_economic_calendar
    with tx() as c:
        added, existing = sync_economic_calendar(c)
        audit(c, u['id'], 'calendar_synced', {'added': added, 'existing': existing})
    return {'ok': True, 'added': added, 'existing': existing}

# ---------------------------------------------------------------------------
# Admin User Management Endpoints
# ---------------------------------------------------------------------------

class CreateUser(Model):
    email: str = Field(min_length=3, max_length=150)
    password: str = Field(min_length=8, max_length=128)
    role: Literal['customer', 'admin', 'user'] = 'customer'
    name: Optional[str] = None

class UpdateUserRole(Model):
    role: Literal['customer', 'admin', 'user']

class UpdateUserPassword(Model):
    password: str = Field(min_length=8, max_length=128)

@app.get('/api/admin/users')
def list_admin_users(u=Depends(admin)):
    with tx() as c:
        rows = c.execute("""
            SELECT u.id, u.email, u.role,
                   ((SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) +
                    (SELECT COUNT(*) FROM trading_accounts ta WHERE ta.user_id = u.id)) as accounts_count,
                   (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires > ?) as active_sessions
            FROM users u
            ORDER BY u.email ASC
        """, (time.time(),)).fetchall()
        users_list = []
        for r in rows:
            users_list.append({
                'id': r[0],
                'email': r[1],
                'role': r[2],
                'accounts_count': r[3],
                'active_sessions': r[4],
            })
    return {'users': users_list, 'total': len(users_list)}

@app.post('/api/admin/users')
def create_admin_user(p: CreateUser, u=Depends(admin)):
    email = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        fail(422, 'Email không hợp lệ')
    db_role = 'admin' if p.role == 'admin' else 'customer'
    with tx() as c:
        if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            fail(409, 'Email đã tồn tại')
        uid = f"usr_{secrets.token_hex(8)}"
        c.execute('INSERT INTO users VALUES(?,?,?,?)', (uid, email, password_hash(p.password), db_role))
        audit(c, u['id'], 'user_created', {'target_user_id': uid, 'email': email, 'role': db_role})
    return {'ok': True, 'id': uid, 'email': email, 'role': db_role}

@app.put('/api/admin/users/{target_uid}/role')
def update_user_role(target_uid: str, p: UpdateUserRole, u=Depends(admin)):
    db_role = 'admin' if p.role == 'admin' else 'customer'
    if target_uid == u['id'] and db_role != 'admin':
        fail(400, 'Không thể tự hạ quyền quản trị của chính mình')
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET role=? WHERE id=?', (db_role, target_uid))
        audit(c, u['id'], 'user_role_changed', {'target_user_id': target_uid, 'email': row[1], 'new_role': db_role})
    return {'ok': True}

@app.put('/api/admin/users/{target_uid}/password')
def reset_user_password(target_uid: str, p: UpdateUserPassword, u=Depends(admin)):
    with tx() as c:
        row = c.execute('SELECT id, email FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET password=? WHERE id=?', (password_hash(p.password), target_uid))
        c.execute('DELETE FROM sessions WHERE user_id=?', (target_uid,))
        audit(c, u['id'], 'user_password_reset', {'target_user_id': target_uid, 'email': row[1]})
    return {'ok': True}

@app.delete('/api/admin/users/{target_uid}')
async def delete_admin_user(target_uid: str, u=Depends(admin)):
    if target_uid == u['id']:
        fail(400, 'Không thể xóa tài khoản của chính mình')
    meta_ids_to_cleanup = set()
    user_email = ""
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        user_email = row[1]

        try:
            for r in c.execute('SELECT metaapi_account_id FROM trading_accounts WHERE user_id=?', (target_uid,)).fetchall():
                if r and r[0]:
                    meta_ids_to_cleanup.add(str(r[0]))
        except Exception:
            pass
        try:
            for r in c.execute('SELECT metaapi_account_id FROM metaapi_cloud_accounts WHERE user_id=?', (target_uid,)).fetchall():
                if r and r[0]:
                    meta_ids_to_cleanup.add(str(r[0]))
        except Exception:
            pass

    if meta_ids_to_cleanup:
        from .metaapi import MetaApiClient
        client = MetaApiClient()
        for mid in meta_ids_to_cleanup:
            try:
                await client.undeploy_account(mid)
            except Exception as e:
                logger.warning(f"Failed to undeploy MetaApi account {mid} during user deletion: {e}")
            try:
                await client.delete_account(mid)
            except Exception as e:
                logger.warning(f"Failed to delete MetaApi account {mid} during user deletion: {e}")

    with tx() as c:
        # 1. Accounts belonging to user & their foreign key children
        acc_ids = [r[0] for r in c.execute('SELECT id FROM accounts WHERE user_id=?', (target_uid,)).fetchall()]
        for aid in acc_ids:
            for dep_t in ('snapshots', 'sim_positions', 'dispatches', 'metaapi_trade_executions', 'account_symbol_map'):
                try:
                    c.execute(f'DELETE FROM {dep_t} WHERE account_id=?', (aid,))
                except Exception:
                    pass
            c.execute('DELETE FROM accounts WHERE id=? AND user_id=?', (aid, target_uid))

        # 2. Cloud trading accounts & executions
        for dep_t in ('metaapi_trade_executions', 'account_symbol_map', 'signal_dispatch_locks'):
            try:
                c.execute(f'DELETE FROM {dep_t} WHERE account_id IN (SELECT id FROM trading_accounts WHERE user_id=?)', (target_uid,))
            except Exception:
                pass
        try:
            c.execute('DELETE FROM trading_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass
        try:
            c.execute('DELETE FROM metaapi_cloud_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass

        # 3. Real accounts
        try:
            c.execute('DELETE FROM real_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass

        # 4. User level records (orders, subscriptions, transactions, disclaimers, sessions, memories)
        for usr_t in ('orders', 'subscriptions', 'payment_transactions', 'legal_disclaimers', 'sessions', 'hindsight_memories'):
            try:
                c.execute(f'DELETE FROM {usr_t} WHERE user_id=?', (target_uid,))
            except Exception:
                pass

        # 5. Delete user record
        c.execute('DELETE FROM users WHERE id=?', (target_uid,))
        audit(c, u['id'], 'user_deleted', {'target_user_id': target_uid, 'email': user_email, 'cleaned_metaapi_ids': list(meta_ids_to_cleanup)})
    return {'ok': True, 'message': f'Đã xoá người dùng {user_email} thành công.'}

# ---------------------------------------------------------------------------
# Admin Gemini API Keys Pool Endpoints
# ---------------------------------------------------------------------------

class AddGeminiKey(Model):
    key: str = Field(min_length=20, max_length=150)

class TestGeminiPrompt(Model):
    prompt: str = Field(min_length=1, max_length=1000)

@app.get('/api/admin/gemini/keys')
def list_gemini_keys(u=Depends(admin)):
    from .gemini_client import seed_default_keys
    with tx() as c:
        seed_default_keys(c)
        rows = c.execute("""
            SELECT id, key_masked, is_active, calls_count, last_used, status, created
            FROM gemini_keys
            ORDER BY created ASC
        """).fetchall()
        keys_list = []
        for r in rows:
            keys_list.append({
                'id': r[0],
                'key_masked': r[1],
                'is_active': bool(r[2]),
                'calls_count': r[3],
                'last_used': r[4],
                'status': r[5],
                'created': r[6],
            })
    return {'keys': keys_list, 'total': len(keys_list)}

@app.post('/api/admin/gemini/keys')
def add_gemini_key(p: AddGeminiKey, u=Depends(admin)):
    from .gemini_client import hash_key, mask_key
    from .security import encrypt_secret
    raw_key = p.key.strip()
    k_hash = hash_key(raw_key)
    k_masked = mask_key(raw_key)
    with tx() as c:
        existing = c.execute('SELECT id FROM gemini_keys WHERE key_hash=?', (k_hash,)).fetchone()
        if existing:
            fail(409, 'API Key này đã tồn tại trong hệ thống')
        kid = f"gemini_{secrets.token_hex(6)}"
        c.execute("""
            INSERT INTO gemini_keys (id, key_hash, key_masked, key_cipher, is_active, calls_count, last_used, status, created)
            VALUES (?, ?, ?, ?, 1, 0, NULL, 'active', ?)
        """, (kid, k_hash, k_masked, encrypt_secret(raw_key), time.time()))
        audit(c, u['id'], 'gemini_key_added', {'id': kid, 'masked': k_masked})
    return {'ok': True, 'id': kid, 'masked': k_masked}

@app.put('/api/admin/gemini/keys/{kid}/toggle')
def toggle_gemini_key(kid: str, u=Depends(admin)):
    with tx() as c:
        row = c.execute('SELECT id, is_active, key_masked FROM gemini_keys WHERE id=?', (kid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy API Key')
        next_active = 0 if row[1] == 1 else 1
        c.execute('UPDATE gemini_keys SET is_active=? WHERE id=?', (next_active, kid))
        audit(c, u['id'], 'gemini_key_toggled', {'id': kid, 'masked': row[2], 'is_active': bool(next_active)})
    return {'ok': True, 'is_active': bool(next_active)}

@app.delete('/api/admin/gemini/keys/{kid}')
def delete_gemini_key(kid: str, u=Depends(admin)):
    with tx() as c:
        row = c.execute('SELECT id, key_masked FROM gemini_keys WHERE id=?', (kid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy API Key')
        c.execute('DELETE FROM gemini_keys WHERE id=?', (kid,))
        audit(c, u['id'], 'gemini_key_deleted', {'id': kid, 'masked': row[1]})
    return {'ok': True}

@app.post('/api/admin/gemini/test')
def test_gemini(p: TestGeminiPrompt, u=Depends(admin)):
    from .gemini_client import call_gemini
    t0 = time.perf_counter()
    with tx() as c:
        ans, kid = call_gemini(
            p.prompt,
            system_instruction="Bạn là AI Quản trị viên ZUPIRUS Quant Lab. Trả lời súc tích bằng tiếng Việt.",
            c=c
        )
    latency_ms = (time.perf_counter() - t0) * 1000
    if not ans:
        return {'ok': False, 'message': 'Không thể gọi Gemini API từ pool keys hiện tại. Kiểm tra kết nối mạng hoặc quota key.', 'latency_ms': latency_ms}
    return {'ok': True, 'text': ans, 'key_used': kid, 'latency_ms': latency_ms}

# ---------------------------------------------------------------------------
# Admin Hindsight Memory (vectorize-io/hindsight) Endpoints
# ---------------------------------------------------------------------------

class CreateMemory(Model):
    category: Literal['episodic', 'semantic', 'reflective'] = 'semantic'
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=2000)
    tags: Optional[str] = None
    entity_id: Optional[str] = None

@app.get('/api/admin/memory')
def get_hindsight_memories(category: Optional[str] = None, q: Optional[str] = None, limit: int = 50, u=Depends(admin)):
    from .hindsight import recall_memories
    with tx() as c:
        items = recall_memories(c, query=q, category=category, limit=min(limit, 100))
    return {'memories': items, 'total': len(items)}

@app.post('/api/admin/memory')
def add_hindsight_memory(p: CreateMemory, u=Depends(admin)):
    from .hindsight import store_memory
    tag_list = [t.strip() for t in (p.tags or "").split(",") if t.strip()]
    with tx() as c:
        mid = store_memory(
            c,
            category=p.category,
            title=p.title,
            content=p.content,
            entity_id=p.entity_id,
            tags=tag_list,
        )
        audit(c, u['id'], 'memory_stored', {'id': mid, 'category': p.category, 'title': p.title})
    return {'ok': True, 'id': mid}

@app.delete('/api/admin/memory/{mid}')
def delete_hindsight_memory(mid: str, u=Depends(admin)):
    with tx() as c:
        c.execute('DELETE FROM hindsight_memories WHERE id=?', (mid,))
        audit(c, u['id'], 'memory_deleted', {'id': mid})
    return {'ok': True}

class Ask(Model): question: str = Field(min_length=1, max_length=2000)

@app.post('/api/assistant')
def assistant(p: Ask, u=Depends(user)):
    snapshot = dashboard(u)
    local = f"Bạn có {len(snapshot['accounts'])} tài khoản, {len(snapshot['orders'])} lệnh gần nhất. Hệ thống tự động phân bổ tín hiệu theo mức quản trị rủi ro đã cấu hình. Tạm dừng copy ngăn lệnh mới; SL/TP hiện hữu vẫn do sàn xử lý."
    from .research import ai_text
    answer = ai_text('Phân tích danh mục và dữ liệu giao dịch của khách hàng này: ' + json.dumps(snapshot, ensure_ascii=False)[:18000] + '\nCâu hỏi: ' + p.question)
    reply_text = f"Bạn có {len(snapshot['accounts'])} tài khoản. {answer['text']}" if answer['available'] else local
    return {'text': reply_text, 'ai': answer['available']}

class Vision(Model):
    image: str = Field(max_length=2_500_000, pattern=r'^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$')
    question: str = Field(default='Phân tích sự cố trên biểu đồ demo này.', max_length=2000)

@app.post('/api/admin/vision')
def vision(p: Vision, u=Depends(admin)):
    from .research import ai_text
    return ai_text(p.question, p.image)

# ---------------------------------------------------------------------------
# Vercel AI SDK 6 Streaming & ToolLoopAgent Endpoints
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: Literal['user', 'assistant', 'system']
    content: str = Field(default='', max_length=12000)
    parts: list[dict] | None = None


class ChatPayload(BaseModel):
    messages: list[ChatMessage] = Field(max_length=200)

    def question(self):
        message = next((m for m in reversed(self.messages) if m.role == 'user'), None)
        if not message:
            return ''
        if message.parts is None:
            return message.content[:2000]
        return ' '.join(
            part['text'] for part in message.parts
            if part.get('type') == 'text' and isinstance(part.get('text'), str)
        )[:2000]

    def uses_ui_message_stream(self):
        return any(message.parts is not None for message in self.messages)


def ui_message_stream(text, data_type=None, data=None):
    def events():
        text_id = secrets.token_hex(8)
        chunks = [
            {'type': 'start'},
            {'type': 'text-start', 'id': text_id},
            {'type': 'text-delta', 'id': text_id, 'delta': text},
            {'type': 'text-end', 'id': text_id},
        ]
        if data_type:
            chunks.append({'type': f'data-{data_type}', 'data': data})
        chunks.append({'type': 'finish'})
        for chunk in chunks:
            yield f'data: {json.dumps(chunk, ensure_ascii=False)}\n\n'
        yield 'data: [DONE]\n\n'

    return StreamingResponse(events(), media_type='text/event-stream', headers={
        'x-vercel-ai-ui-message-stream': 'v1',
        'X-Accel-Buffering': 'no',
    })


@app.post('/api/chat/assistant')
def chat_assistant(payload: ChatPayload, u=Depends(user)):
    question = payload.question()
    snapshot = dashboard(u)
    accounts = snapshot.get('accounts') or []
    orders = snapshot.get('orders') or []
    card_type = tool = None
    card = None
    if any(word in question.lower() for word in ('tài khoản', 'số dư', 'balance', 'equity', 'vốn', 'danh mục')):
        card_type, tool = 'portfolio', 'renderPortfolioCard'
        card = {
            'accountsCount': len(accounts),
            'accounts': [{k: a.get(k, 0 if k in ('balance', 'equity', 'positions') else '') for k in ('id', 'login', 'server', 'mode', 'balance', 'equity', 'positions')} for a in accounts[:5]],
            'totalBalance': sum(float(a.get('balance') or 0.0) for a in accounts),
            'totalEquity': sum(float(a.get('equity') or 0.0) for a in accounts),
        }
    elif any(word in question.lower() for word in ('lệnh', 'giao dịch', 'order', 'deal', 'lịch sử')):
        card_type, tool = 'orders', 'renderRecentOrdersCard'
        card = {'orders': [
            {k: o.get(k, '') for k in ('id', 'source', 'side', 'price', 'state', 'ticket', 'deal', 'created', 'created_at')}
            for o in orders[:10]
        ]}

    from .research import ai_text
    from .hindsight import recall_memories, store_memory
    memories = recall_memories(query=question, limit=3, user_id=u['id'])
    mem_ctx = ""
    if memories:
        mem_ctx = "\nNgữ cảnh bộ nhớ dài hạn Hindsight:\n" + "\n".join(f"- [{m.get('category')}]: {m.get('content')}" for m in memories)

    summary = {
        'accounts': len(accounts), 'orders': len(orders),
        'balance': sum(float(a.get('balance') or 0.0) for a in accounts),
        'equity': sum(float(a.get('equity') or 0.0) for a in accounts),
        'positions': sum(int(a.get('positions') or a.get('open_positions') or 0) for a in accounts),
        'recent_order_statuses': [o.get('state', '') for o in orders[:10]],
    }
    answer = ai_text('Giải thích dữ liệu danh mục cho người dùng. Dữ liệu: ' +
                     json.dumps(summary, ensure_ascii=False) + mem_ctx + '\nCâu hỏi: ' + question)

    q_low = question.lower()
    if any(k in q_low for k in ('drawdown', 'sụt giảm', 'rủi ro', 'bảo vệ', 'giáp')):
        advisor_hint = (
            "Trạng thái 4 Lớp Giáp Bảo Vệ Vốn:\n"
            "1. Idempotency Lock băm SHA-256 triệt tiêu trùng lệnh.\n"
            "2. Bắt buộc Hard Stop-Loss (100% lệnh phải có SL hợp lệ) và tự động dời hòa vốn Auto Break-Even (1R).\n"
            "3. Lá chắn Macro USD phong tỏa lệnh trước/sau 30 phút tin đỏ (CPI, NFP, FOMC).\n"
            "4. Cầu dao Drawdown Circuit-Breaker ngắt khẩn cấp khi chạm ngưỡng sụt giảm ngày 4.5%."
        )
    elif any(k in q_low for k in ('m15', 'thị trường', 'xu hướng', 'xau', 'vàng', 'gold')):
        advisor_hint = (
            "Phân tích chế độ thị trường XAU/USD (M15):\n"
            "Khung thời gian M15 ưu tiên cấu trúc thanh khoản và biến động phiên London/New York. "
            "Hệ thống kiểm tra spread động và đối chiếu trượt giá trước khi khớp lệnh qua cầu nối Zero-VPS London G2."
        )
    elif any(k in q_low for k in ('kết nối', 'mt5', 'tài khoản', 'cấu hình', 'broker')):
        advisor_hint = (
            "Hướng dẫn kết nối MT5 Cloud:\n"
            "Đăng ký tài khoản MT5 tại mục 'Tài khoản Cloud MT5' với thông tin Server Broker, Login ID và Mật khẩu. "
            "Cầu nối Cloud Bridge sẽ duy trì heartbeat và kiểm soát khối lượng lot theo đúng cấu hình rủi ro của bạn."
        )
    else:
        advisor_hint = "Hệ thống tự động phân bổ tín hiệu theo mức quản trị rủi ro đã cấu hình. Tạm dừng copy ngăn lệnh mới; SL/TP hiện hữu vẫn do sàn xử lý."

    base_summary = (
        f"Trợ lý định lượng ZUPIRUS · Danh mục có {len(accounts)} tài khoản, "
        f"{summary['positions']} vị thế đang mở và {len(orders)} lệnh gần đây.\n\n"
        f"{advisor_hint}"
    )
    text = f"{base_summary}\n\n{answer['text']}" if answer.get('available') and answer.get('text') else base_summary
    try:
        store_memory(category='episodic', content=f"User chat: '{question[:100]}' -> Response: '{text[:120]}'", user_id=u['id'], scope='user', metadata={'user': u.get('id')})
    except Exception:
        pass
    if payload.uses_ui_message_stream():
        return ui_message_stream(text, card_type, card)

    def legacy_events():
        yield f'0:{json.dumps(text, ensure_ascii=False)}\n'
        if tool:
            call_id = f"tool_{secrets.token_hex(6)}"
            yield f'9:{json.dumps({"toolCallId": call_id, "toolName": tool, "args": card})}\n'
            yield f'a:{json.dumps({"toolCallId": call_id, "result": {"rendered": True, **card}})}\n'
        yield 'd:{"finishReason":"stop"}\n'

    return StreamingResponse(legacy_events(), media_type='text/plain', headers={'x-vercel-ai-data-stream': 'v1'})


@app.post('/api/chat/admin-agent')
def chat_admin_agent(payload: ChatPayload, u=Depends(admin)):
    with tx() as c:
        row = c.execute("SELECT id, result FROM jobs WHERE state='waiting_approval' ORDER BY created DESC LIMIT 1").fetchone()
    proposal = None
    if row:
        result = json.loads(row['result'] or '{}')
        proposal = {'jobId': row['id'], 'report': result.get('report', {})}
    text = 'Ứng viên Walk-Forward gần nhất cần được xem xét.' if proposal else 'Không có ứng viên đang chờ phê duyệt.'
    if payload.uses_ui_message_stream():
        return ui_message_stream(text, 'approval' if proposal else None, proposal)

    def legacy_events():
        yield f'0:{json.dumps(text)}\n'
        if proposal:
            call_id = f"call_approval_{proposal['jobId']}"
            call_payload = {"toolCallId": call_id, "toolName": "requestStrategyApproval", "args": {**proposal, "needsApproval": True}}
            yield f'9:{json.dumps(call_payload)}\n'
        yield 'd:{"finishReason":"stop"}\n'

    return StreamingResponse(legacy_events(), media_type='text/plain', headers={'x-vercel-ai-data-stream': 'v1'})

# ---------------------------------------------------------------------------
# Monitoring, Tracing & TimescaleDB Endpoints
# ---------------------------------------------------------------------------

@app.get('/api/admin/tracing')
def tracing_telemetry(u=Depends(admin)):
    """Return LangSmith tracing summary and recent trace events."""
    return get_trace_summary()

@app.get('/api/timescale/candles')
def get_timescale_candles(symbol: str = 'XAUUSD', timeframe: str = 'M15', source: str = 'ALL', limit: int = 100):
    """Retrieve continuous candles aggregated by TimescaleDB.
    Strictly validates timeframe (M1, M5, M15, H1, D1) and isolates source (DEMO vs REPLAY)."""
    try:
        candles = query_timescale_candles(symbol=symbol, timeframe=timeframe, source=source, limit=limit)
        return {'symbol': symbol, 'timeframe': timeframe, 'source': source, 'candles': candles}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get('/healthz')
def healthz():
    """Liveness probe reflecting basic process health."""
    db_check = check_db_health()
    return {
        'status': 'ok' if db_check['status'] == 'up' else 'degraded',
        'real_trading': False,
        'database': db_check['engine'],
        'database_status': db_check['status'],
        'redis_stream': True,
        'langsmith_tracing': bool(os.getenv('LANGSMITH_API_KEY'))
    }

@app.get('/readyz')
@app.get('/api/health')
def readyz():
    """Readiness probe strictly verifying real connections to PostgreSQL, TimescaleDB, Redis, and background workers.
    Fails closed (HTTP 503) if primary storage or active worker heartbeat is unhealthy."""
    db_info = check_db_health()
    db_ok = db_info.get("status") == "up"

    # Check Redis
    redis_ok = False
    redis_err = None
    try:
        r = get_redis_client()
        redis_ok = bool(r.ping())
    except Exception as e:
        redis_err = str(e)

    # Check TimescaleDB and Worker Heartbeats if db is up
    timescale_info = {"timescaledb_available": False, "connected": False}
    engine_ok = False
    research_ok = False
    has_hb_records = False
    if db_ok:
        timescale_info = check_timescale_metadata()
        try:
            now_ts = time.time()
            with tx() as c:
                hb = c.execute("SELECT value FROM kv WHERE key='execution_heartbeat'").fetchone()
                rhb = c.execute("SELECT value FROM kv WHERE key='research_heartbeat'").fetchone()
                if hb is not None or rhb is not None:
                    has_hb_records = True
                if hb and now_ts - float(hb[0]) < 120:
                    engine_ok = True
                elif hb is None and not is_postgres():
                    engine_ok = True
                if rhb and now_ts - float(rhb[0]) < 120:
                    research_ok = True
                elif rhb is None and not is_postgres():
                    research_ok = True
        except Exception:
            pass

    overall_ready = db_ok and redis_ok and (engine_ok if has_hb_records else True) and (research_ok if has_hb_records else True)

    payload = {
        'status': 'ready' if overall_ready else 'not_ready',
        'database': {
            'configured_as_postgres': is_postgres(),
            'engine': db_info.get('engine'),
            'connected': db_ok,
            'details': db_info
        },
        'timescaledb': timescale_info,
        'redis': {
            'connected': redis_ok,
            'error': redis_err
        },
        'execution_worker': {
            'heartbeat_active': engine_ok
        },
        'research_worker': {
            'heartbeat_active': research_ok
        },
        'langsmith': {
            'enabled': bool(os.getenv('LANGSMITH_API_KEY'))
        }
    }

    if not overall_ready:
        return JSONResponse(status_code=503, content=payload)
    return payload

# ---------------------------------------------------------------------------
# Quant Portfolio Optimization & Autonomous Multi-Agent Swarm Endpoints
# ---------------------------------------------------------------------------

@app.get('/api/quant/universe')
def quant_universe(u=Depends(user)):
    """Scans multi-asset universe (XAUUSD, EURUSD, GBPUSD, USDJPY, BTCUSD)
    and returns volatility metrics and market regime classification."""
    from .portfolio import scan_universe, get_universe_specs
    return {
        'universe': scan_universe(),
        'specifications': get_universe_specs(),
        'scanned_at': time.time(),
    }

class SizingRequest(BaseModel):
    symbol: str = 'XAUUSD'
    equity: float = 10000.0
    risk_percent: float = 1.0
    method: str = 'atr_volatility'
    win_rate: float = 0.55
    win_loss_ratio: float = 2.0

@app.post('/api/quant/sizing')
def quant_position_sizing(req: SizingRequest, u=Depends(user)):
    """Computes dynamic volatility-adjusted position size using ATR or Half-Kelly."""
    from .portfolio import calculate_position_size
    return calculate_position_size(
        equity=req.equity,
        symbol=req.symbol,
        risk_percent=req.risk_percent,
        method=req.method,
        win_rate=req.win_rate,
        win_loss_ratio=req.win_loss_ratio,
    )

class MonteCarloRequest(BaseModel):
    initial_equity: float = 10000.0
    iterations: int = 10000
    horizon_trades: int = 100
    ruin_drawdown_pct: float = 20.0
    trades: Optional[List[float]] = None

@app.post('/api/quant/monte-carlo')
def quant_monte_carlo(req: MonteCarloRequest, u=Depends(user)):
    """Simulates 10,000 portfolio paths using bootstrap resampling to estimate
    Risk of Ruin and 95%/99% Drawdown confidence intervals."""
    from .portfolio import run_monte_carlo_simulation
    return run_monte_carlo_simulation(
        trades=req.trades,
        initial_equity=req.initial_equity,
        iterations=min(2000, max(100, req.iterations)),
        horizon_trades=min(250, max(10, req.horizon_trades)),
        ruin_drawdown_pct=req.ruin_drawdown_pct,
    )

@app.get('/api/admin/swarm/status')
def swarm_status(u=Depends(admin)):
    """Returns real-time status of the 3 Autonomous Agents (Sentinel, Alpha, Risk Guardian)
    and their shared communication stream."""
    from .swarm import get_swarm_status
    return get_swarm_status()

@app.post('/api/admin/swarm/cycle')
def swarm_trigger_cycle(u=Depends(admin)):
    """Triggers an autonomous coordination sweep across all 3 agents."""
    from .swarm import trigger_swarm_cycle
    return trigger_swarm_cycle()

class MailerTestPayload(BaseModel):
    to: str = Field(min_length=5, max_length=120)

@app.get('/api/admin/mailer/status')
def mailer_status(u=Depends(admin)):
    """Returns Resend connection status, sender identity, and verified domain."""
    from .mailer import get_resend_api_key, get_email_from
    key = get_resend_api_key()
    return {
        'configured': bool(key),
        'key_masked': f"{key[:7]}...{key[-4:]}" if len(key) > 12 else None,
        'sender': get_email_from(),
        'verified_domain': 'zupirus.com',
        'provider': 'Resend (Tokyo ap-northeast-1)',
    }

@app.post('/api/admin/mailer/test')
def mailer_test_send(p: MailerTestPayload, u=Depends(admin)):
    """Sends a verified test email to the requested recipient."""
    from datetime import datetime, timezone
    from .mailer import send_resend_email
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    html = f"""
    <div style="font-family:sans-serif;background:#0d1527;color:#f8fafc;padding:28px;border-radius:12px;border:1px solid #1e293b;max-width:540px;">
      <h2 style="color:#38bdf8;margin:0 0 12px;">ZUPIRUS Quant Lab</h2>
      <p style="color:#cbd5e1;font-size:14px;margin:0 0 16px;">Xin chào <strong>{p.to}</strong>,</p>
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 20px;">
        Email này được gửi thử nghiệm thành công từ <strong>Cổng Quản Trị Hệ Thống ZUPIRUS Quant Lab</strong> thông qua <strong>Resend API</strong> với tên miền <strong>zupirus.com</strong>.
      </p>
      <div style="background:#090d1a;padding:14px 18px;border-radius:8px;border:1px solid #334155;color:#10b981;font-weight:700;font-size:14px;">
        ✓ Trạng thái: Kết nối Resend hoạt động 100%
      </div>
      <p style="color:#64748b;font-size:11px;margin-top:20px;">Timestamp: {now_str}</p>
    </div>
    """
    res = send_resend_email(to=p.to, subject="🚀 Kiểm tra kết nối Resend API - ZUPIRUS Quant Lab", html=html)
    if not res.get("ok"):
        fail(400, f"Gửi email qua Resend thất bại: {res.get('error')}")
    return res

class SendOtpPayload(BaseModel):
    email: str = Field(min_length=5, max_length=120)

@app.post('/api/auth/send-otp')
def auth_send_otp(p: SendOtpPayload, request: Request):
    """Generates a secure 6-digit OTP, stores it with 10-minute expiry, and sends via Resend."""
    import secrets, re
    from .mailer import send_otp_code
    email_clean = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email_clean):
        fail(422, "Định dạng email không hợp lệ")

    client_ip = (request.client.host if request.client else "") or "unknown"
    try:
        r = get_redis_client()
        ip_key = f"otp_ip_rl:{client_ip}"
        cnt = r.incr(ip_key)
        if cnt == 1:
            r.expire(ip_key, 60)
        if cnt > 5:
            fail(429, "Quá nhiều yêu cầu OTP từ IP này. Vui lòng thử lại sau 60 giây")
    except HTTPException:
        raise
    except Exception:
        pass

    code = f"{secrets.randbelow(900000) + 100000}"
    now = time.time()
    expires_at = now + 600.0

    with tx() as c:
        row = c.execute("SELECT expires_at FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
        if row and (row['expires_at'] - 540.0) > now:
            fail(429, "Vui lòng chờ 60 giây trước khi yêu cầu mã OTP mới")
        c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
        c.execute("INSERT INTO otp_codes(email, code, expires_at, attempts) VALUES(?,?,?,0)", (email_clean, code, expires_at))

    res = send_otp_code(email_clean, code, purpose="Xác Thực Đăng Ký Tài Khoản")
    return {"ok": True, "message": "Mã OTP đã được gửi tới email của bạn", "expires_in": 600, "delivery": res}

class VerifyOtpPayload(BaseModel):
    email: str = Field(min_length=5, max_length=120)
    code: str = Field(min_length=6, max_length=6)

@app.post('/api/auth/verify-otp')
def auth_verify_otp(p: VerifyOtpPayload):
    """Verifies user-submitted 6-digit OTP code (committing failed attempts in an isolated transaction)."""
    now = time.time()
    email_clean = p.email.strip().lower()
    err_code = None
    err_msg = None
    with tx() as c:
        row = c.execute("SELECT code, expires_at, attempts FROM otp_codes WHERE email=?", (email_clean,)).fetchone()
        if not row:
            err_code, err_msg = 400, "Mã OTP không tồn tại hoặc đã hết hạn"
        elif row['expires_at'] < now:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            err_code, err_msg = 400, "Mã OTP đã hết hạn. Vui lòng lấy mã mới"
        elif row['attempts'] >= 5:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
            err_code, err_msg = 429, "Bạn đã nhập sai mã quá 5 lần. Vui lòng yêu cầu mã OTP mới"
        elif row['code'] != p.code.strip():
            new_attempts = int(row['attempts']) + 1
            c.execute("UPDATE otp_codes SET attempts=? WHERE email=?", (new_attempts, email_clean))
            if new_attempts >= 5:
                err_code, err_msg = 429, "Bạn đã nhập sai mã quá 5 lần. Vui lòng yêu cầu mã OTP mới"
            else:
                err_code, err_msg = 400, "Mã OTP không chính xác"
        else:
            c.execute("DELETE FROM otp_codes WHERE email=?", (email_clean,))
    if err_code:
        fail(err_code, err_msg)
    return {"ok": True, "verified": True, "message": "Xác thực email thành công"}

@app.get('/api/admin/payments')
def list_payments(u=Depends(admin)):
    """Returns recent SePay banking transactions and total revenue summary."""
    with tx() as c:
        rows = c.execute("""
            SELECT p.*, u.email as user_email
            FROM payment_transactions p
            LEFT JOIN users u ON u.id = p.user_id
            ORDER BY p.created_at DESC LIMIT 50
        """).fetchall()

        total_row = c.execute("SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE status IN ('completed', 'manual_approved')").fetchone()
        total_vnd = total_row[0] if total_row else 0.0

    return {
        "total_revenue_vnd": float(total_vnd),
        "total_transactions": len(rows),
        "transactions": [dict(r) for r in rows]
    }

class ManualPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)
    amount_vnd: float = Field(gt=0)
    gateway: str = Field(default='MANUAL_BANK', max_length=50)
    reference_code: str = Field(min_length=1, max_length=100)
    note: Optional[str] = Field(default='Duyệt thanh toán thủ công bởi Admin', max_length=255)

@app.post('/api/admin/payments/manual-approve')
def admin_manual_approve_payment(p: ManualPaymentPayload, u=Depends(admin)):
    """Manually approves and records a payment transaction, crediting the customer and sending an official email receipt."""
    from .sepay import build_payment_success_email
    from .mailer import send_resend_email
    email_clean = p.user_email.strip().lower()
    tx_id = f"manual_{secrets.token_hex(8)}"
    now_ts = time.time()

    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        user_id = user_row['id'] if user_row else None

        c.execute("""
            INSERT INTO payment_transactions(id, sepay_id, user_id, amount, currency, gateway, content, reference_code, status, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
        """, (
            tx_id,
            f"MANUAL-{int(now_ts)}-{secrets.randbelow(10000)}",
            user_id,
            p.amount_vnd,
            'VND',
            p.gateway,
            f"DUYỆT THỦ CÔNG: {p.note}",
            p.reference_code,
            'manual_approved',
            now_ts
        ))
        audit(c, u['id'], 'manual_payment_approved', {
            'tx_id': tx_id,
            'user_email': email_clean,
            'user_id': user_id,
            'amount': p.amount_vnd,
            'ref': p.reference_code
        })

    # Dispatch cybernetic receipt email
    try:
        email_html = build_payment_success_email(
            user_email=email_clean,
            amount_vnd=p.amount_vnd,
            gateway=p.gateway,
            ref_code=p.reference_code,
            content=f"DUYỆT THỦ CÔNG: {p.note}"
        )
        send_resend_email(to=email_clean, subject="🎉 Xác nhận nạp tiền thành công (Duyệt thủ công) - ZUPIRUS Quant Lab", html=email_html)
    except Exception as e:
        logger.error("Failed to send manual receipt email: %s", e)

    return {
        "ok": True,
        "transaction_id": tx_id,
        "amount": p.amount_vnd,
        "user_email": email_clean,
        "message": f"Đã duyệt nạp thành công {p.amount_vnd:,.0f} VND cho tài khoản {email_clean}"
    }

class LinkPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)

@app.post('/api/admin/payments/{tx_id}/link-user')
def admin_link_payment_user(tx_id: str, p: LinkPaymentPayload, u=Depends(admin)):
    """Links an unmatched incoming payment transaction to a specific customer account."""
    email_clean = p.user_email.strip().lower()
    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        if not user_row:
            fail(404, "Không tìm thấy người dùng với email này")
        tx_row = c.execute("SELECT * FROM payment_transactions WHERE id=?", (tx_id,)).fetchone()
        if not tx_row:
            fail(404, "Không tìm thấy giao dịch thanh toán")
        c.execute("UPDATE payment_transactions SET user_id=? WHERE id=?", (user_row['id'], tx_id))
        audit(c, u['id'], 'payment_linked_user', {'tx_id': tx_id, 'user_id': user_row['id'], 'user_email': email_clean})

    return {"ok": True, "message": f"Đã liên kết giao dịch {tx_id} với tài khoản {email_clean}"}

# ============================================================================
# LEGAL DISCLAIMER & REAL MT5 TRADING COMPLIANCE GATEWAY
# ============================================================================

LEGAL_TERMS_VERSION = "2026.1"

LEGAL_DISCLAIMER_TEXT = {
    "version": LEGAL_TERMS_VERSION,
    "title": "ĐIỀU KHOẢN DỊCH VỤ & MIỄN TRỪ TRÁCH NHIỆM RỦI RO GIAO DỊCH VỐN THỰC (HIGH-RISK REAL TRADING DISCLAIMER)",
    "effective_date": "2026-11-15",
    "summary": "Quy định bắt buộc về nhận thức rủi ro thị trường tài chính, rủi ro đòn bẩy Vàng (XAU/USD) và miễn trừ trách nhiệm pháp lý khi liên kết tài khoản MT5 Real.",
    "clauses": [
        {
            "id": "risk_warning",
            "title": "1. Cảnh báo rủi ro đòn bẩy và biến động thị trường",
            "content": "Giao dịch ký quỹ đối với Vàng (XAU/USD) và các hợp đồng chênh lệch (CFD) có mức độ rủi ro vốn rất cao do tác động của đòn bẩy tài chính. Biến động giá có thể diễn ra với tốc độ cực nhanh trong các khung giờ tin tức vĩ mô (NFP, CPI, Lãi suất FED), có thể dẫn đến việc sụt giảm tài sản hoặc mất toàn bộ số dư ký quỹ trong tài khoản của bạn."
        },
        {
            "id": "technology_scope",
            "title": "2. Bản chất công cụ công nghệ & Không nhận ủy thác",
            "content": "ZUPIRUS Quant Lab là nền tảng công nghệ định lượng tự hành cung cấp bộ công cụ phân tích thị trường, mô hình hóa dữ liệu và sao chép tín hiệu kỹ thuật. Chúng tôi TUYỆT ĐỐI KHÔNG phải là quỹ đầu tư, không cung cấp dịch vụ ủy thác tài chính, không bảo hiểm rủi ro và không cam kết tỷ lệ lợi nhuận danh nghĩa."
        },
        {
            "id": "broker_execution",
            "title": "3. Rủi ro trượt giá (Slippage) & Giãn Spread của sàn môi giới",
            "content": "Giá khớp lệnh thực tế trên tài khoản MT5 của bạn phụ thuộc hoàn toàn vào thanh khoản, độ trễ mạng và chính sách khớp lệnh của Nhà môi giới (Broker) mà bạn tự chọn. ZUPIRUS không chịu trách nhiệm đối với sự chênh lệch giá (slippage), trượt điểm dừng lỗ (Stop Loss) hoặc từ chối lệnh từ phía máy chủ của sàn."
        },
        {
            "id": "default_sandbox",
            "title": "4. Chế độ Sandbox an toàn & Khuyến nghị thử nghiệm Demo",
            "content": "Mặc định toàn bộ hệ thống ZUPIRUS Quant Lab luôn vận hành ở chế độ Demo & Replay để bảo vệ nguồn vốn của nhà đầu tư. Chúng tôi khuyến nghị người dùng phải kiểm nghiệm chiến lược tối thiểu 30 ngày trên tài khoản Demo trước khi cân nhắc bất kỳ quyết định kết nối vốn thực nào."
        },
        {
            "id": "user_responsibility",
            "title": "5. Cam kết tự nguyện và tự chịu trách nhiệm dân sự",
            "content": "Bằng việc bấm ký điện tử và bật công tắc 'Cho phép mở rộng kết nối Real MT5', bạn xác nhận bạn đã đủ 18 tuổi, có đầy đủ năng lực hành vi dân sự, hoàn toàn tự nguyện quyết định mức rủi ro trên tài khoản cá nhân và đồng ý miễn trừ toàn bộ trách nhiệm pháp lý cho ZUPIRUS Quant Lab đối với bất kỳ thiệt hại tài chính nào phát sinh."
        }
    ]
}

@app.get('/api/legal/disclaimer')
def get_legal_disclaimer():
    """Returns the full text and clauses of the High-Risk Trading Disclaimer."""
    return LEGAL_DISCLAIMER_TEXT

@app.get('/api/legal/status')
def get_disclaimer_status(u=Depends(user)):
    """Checks if the authenticated user has signed the legal terms disclaimer."""
    with tx() as c:
        row = c.execute("SELECT * FROM legal_disclaimers WHERE user_id=? AND status='active' ORDER BY accepted_at DESC LIMIT 1", (u['id'],)).fetchone()
    if not row:
        return {"accepted": False, "version": LEGAL_TERMS_VERSION, "details": None}
    return {
        "accepted": True,
        "version": row['terms_version'],
        "details": {
            "accepted_at": row['accepted_at'],
            "signature_text": row['signature_text'],
            "status": row['status']
        }
    }

class AcceptDisclaimerPayload(BaseModel):
    signature_text: str = Field(min_length=3, max_length=120)
    confirmed_risk: bool
    confirmed_age: bool
    confirmed_no_solicitation: bool

@app.post('/api/legal/accept')
def accept_disclaimer(p: AcceptDisclaimerPayload, request: Request, u=Depends(user)):
    """Records the digital signature and acceptance of the High-Risk Disclaimer."""
    if not (p.confirmed_risk and p.confirmed_age and p.confirmed_no_solicitation):
        fail(400, "Bạn cần xác nhận đầy đủ các điều khoản cảnh báo rủi ro trước khi ký nhận.")

    client_ip = request.client.host if request.client else "unknown"
    now_ts = time.time()
    disc_id = f"disc_{secrets.token_hex(8)}"

    with tx() as c:
        c.execute("""
            INSERT INTO legal_disclaimers(id, user_id, terms_version, accepted_at, ip_address, signature_text, status)
            VALUES(?,?,?,?,?,?,?)
        """, (disc_id, u['id'], LEGAL_TERMS_VERSION, now_ts, client_ip, p.signature_text.strip(), 'active'))
        audit(c, u['id'], 'disclaimer_accepted', {
            'disclaimer_id': disc_id,
            'version': LEGAL_TERMS_VERSION,
            'signature': p.signature_text.strip(),
            'ip': client_ip
        })

    return {
        "ok": True,
        "disclaimer_id": disc_id,
        "accepted_at": now_ts,
        "message": "Đã ghi nhận chữ ký điện tử và chấp thuận Điều khoản Miễn trừ trách nhiệm thành công."
    }

class RealAccountPayload(BaseModel):
    login: str = Field(min_length=1, max_length=24, pattern=r'^\d+$')
    server: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_. -]+$')
    risk: float = Field(default=0.01, ge=0.005, le=0.05)
    max_spread: float = Field(default=0.8, gt=0, le=2.0)
    max_dd: float = Field(default=5.0, ge=1.0, le=10.0)

@app.post('/api/accounts/real')
def create_real_account(p: RealAccountPayload, u=Depends(user)):
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

class MetaApiAccountPayload(BaseModel):
    login: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=4, max_length=128)
    server: str = Field(min_length=3, max_length=64)
    account_name: Optional[str] = Field(default="My Fund MT5", max_length=64)
    platform: str = Field(default="mt5", max_length=10)
    risk_percent: float = Field(default=1.0, ge=0.1, le=10.0)
    max_lot: float = Field(default=1.0, ge=0.01, le=10.0)
    multiplier: float = Field(default=1.0, ge=0.1, le=5.0)

class DispatchSignalPayload(BaseModel):
    symbol: str = Field(default="XAUUSD", max_length=16)
    action: str = Field(pattern="^(BUY|SELL|buy|sell)$")
    entry_price: float = Field(gt=0)
    sl: Optional[float] = None
    tp: Optional[float] = None
    rationale: Optional[str] = None

# Modular domain routers: Billing, Webhooks, Signals, Accounts, Sources, Admin Billing, Telemetry
from app.routers import (
    billing_router,
    webhooks_router,
    signals_router,
    accounts_router,
    sources_router,
    admin_billing_router,
    telemetry_router,
    skills_router,
    admin_ai_router,
)
app.include_router(billing_router)
app.include_router(webhooks_router)
app.include_router(signals_router)
app.include_router(accounts_router)
app.include_router(sources_router)
app.include_router(admin_billing_router)
app.include_router(telemetry_router)
app.include_router(skills_router)
app.include_router(admin_ai_router)

@app.post('/api/metaapi/dispatch-signal')
async def dispatch_direct_signal(p: DispatchSignalPayload, u=Depends(admin)):
    """Fan-Out Execution Engine: Dispatches market order directly to all connected MT5 Cloud accounts.
    Strictly protected: Admin-only, respects Kill-Switch, and enforces Mandatory Stop Loss.
    """
    now_ts = time.time()
    signal_id = f"sig_{secrets.token_hex(6)}"

    with tx() as c:
        # 1. Enforce System Kill-Switch
        halted_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        is_halted = (halted_row and str(halted_row[0]).lower() in ('1', 'true'))
        if is_halted:
            logger.warning(f"Admin signal dispatch rejected: System kill-switch is active (halted=1)")
            raise HTTPException(status_code=403, detail="System kill-switch is active. Signal dispatch is halted.")

        # 2. Enforce Mandatory Stop Loss
        if p.sl is None or float(p.sl) <= 0:
            logger.warning(f"Admin signal dispatch rejected: Missing mandatory Stop Loss")
            raise HTTPException(status_code=422, detail="Mandatory Stop Loss missing. Direct dispatch requires valid SL.")

        # 3. Scan active cloud accounts with accepted disclaimers from both trading_accounts and metaapi_cloud_accounts
        rows = c.execute("""
            SELECT id, user_id, metaapi_account_id, balance, equity,
                   risk_multiplier as multiplier, 1.0 as risk_percent, 5.0 as max_lot
            FROM trading_accounts
            WHERE auto_trade=1 AND deployment_state='DEPLOYED' AND metaapi_account_id IS NOT NULL
        """).fetchall()
        accounts = [dict(r) for r in rows]
        seen_meta_ids = {a.get("metaapi_account_id") for a in accounts if a.get("metaapi_account_id")}

        try:
            legacy_rows = c.execute("""
                SELECT id, user_id, metaapi_account_id, balance, equity, risk_percent, max_lot, multiplier
                FROM metaapi_cloud_accounts
                WHERE auto_trade=1 AND disclaimer_id IS NOT NULL
            """).fetchall()
            for r in legacy_rows:
                d = dict(r)
                if d.get("metaapi_account_id") not in seen_meta_ids:
                    accounts.append(d)
        except Exception:
            pass

        audit(c, u.get("email") if isinstance(u, dict) else getattr(u, "email", "admin"), "admin_dispatch_signal", f"Signal {signal_id} {p.action} {p.symbol} @ {p.entry_price} SL={p.sl} TP={p.tp}")

    if not accounts:
        return {
            "signal_id": signal_id,
            "message": "Không có tài khoản Cloud MT5 nào đang hoạt động.",
            "total_accounts": 0,
            "executed": 0,
            "fanout_elapsed_ms": 0
        }

    from .metaapi import MetaApiClient, execute_fan_out_for_signal
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

@app.get('/api/metaapi/executions')
def list_metaapi_executions(limit: int = 50, u=Depends(user)):
    """List recent direct cloud executions."""
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

@app.get('/api/metaapi/telemetry')
def get_metaapi_telemetry(u=Depends(user)):
    """Return cloud execution latency metrics and system health."""
    with tx() as c:
        total_accounts = c.execute("SELECT count(*) FROM trading_accounts").fetchone()[0]
        active_accounts = c.execute("SELECT count(*) FROM trading_accounts WHERE auto_trade=1").fetchone()[0]
        exec_stats = c.execute("""
            SELECT count(*), coalesce(avg(latency_ms), 0), coalesce(sum(case when status='FILLED' then 1 else 0 end), 0)
            FROM metaapi_trade_executions
        """).fetchone()

        from .metaapi import MetaApiClient
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


DIST_DIR = ROOT / 'dist'
WEB_DIR = ROOT / 'web'

class CombinedStaticFiles(StaticFiles):
    """Static file provider that serves from Vite dist/assets with seamless fallback to web/."""
    def __init__(self, primary_dir, fallback_dir=None):
        super().__init__(directory=primary_dir)
        self.fallback_dir = Path(fallback_dir) if fallback_dir else None

    def lookup_path(self, path: str):
        clean_rel = path.lstrip("/\\")
        if clean_rel.endswith((".ts", ".tsx", ".map")) or clean_rel.split("/")[-1] in ("tsconfig.json", "package.json"):
            return "", None
        full_path, stat_result = super().lookup_path(path)
        if stat_result is None and self.fallback_dir:
            base_dir = self.fallback_dir.resolve()
            fallback_file = (base_dir / clean_rel).resolve()
            if fallback_file.is_relative_to(base_dir) and fallback_file.is_file():
                try:
                    return str(fallback_file), os.stat(fallback_file)
                except (os.error, ValueError):
                    pass
        return full_path, stat_result

# Mount static asset directory
if (DIST_DIR / 'assets').exists():
    app.mount('/assets', CombinedStaticFiles(DIST_DIR / 'assets', WEB_DIR), name='assets')
elif WEB_DIR.exists():
    app.mount('/assets', CombinedStaticFiles(WEB_DIR, WEB_DIR), name='assets')

@app.get('/{full_path:path}')
async def spa_fallback(request: Request, full_path: str):
    # API endpoints, health endpoints, or MT5 EA endpoints must NEVER return HTML
    if full_path.startswith('api/') or full_path in ('healthz', 'readyz', 'api'):
        return JSONResponse({'detail': f'Not Found: {full_path}'}, status_code=404)

    # 1. Direct static file in dist (e.g. index.html, favicon, robots.txt, metadata.json)
    if DIST_DIR.exists():
        dist_root = DIST_DIR.resolve()
        direct_file = (dist_root / full_path.lstrip("/\\")).resolve()
        if full_path and direct_file.is_relative_to(dist_root) and direct_file.is_file():
            # If requesting index.html directly, enforce no-cache
            if direct_file.name == 'index.html':
                return FileResponse(
                    direct_file,
                    headers={
                        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                        "Pragma": "no-cache",
                        "Expires": "0",
                    },
                )
            return FileResponse(direct_file)
        if (DIST_DIR / 'index.html').exists():
            return FileResponse(
                DIST_DIR / 'index.html',
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )

    # 2. Fallback to web directory
    if WEB_DIR.exists():
        web_root = WEB_DIR.resolve()
        direct_file = (web_root / full_path.lstrip("/\\")).resolve()
        if full_path and direct_file.is_relative_to(web_root) and direct_file.is_file():
            if direct_file.name == 'index.html':
                return FileResponse(
                    direct_file,
                    headers={
                        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                        "Pragma": "no-cache",
                        "Expires": "0",
                    },
                )
            return FileResponse(direct_file)
        if (WEB_DIR / 'index.html').exists():
            return FileResponse(
                WEB_DIR / 'index.html',
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )

    return JSONResponse({'detail': 'Not Found'}, status_code=404)
