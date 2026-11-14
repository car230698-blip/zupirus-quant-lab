import os, time, secrets, json, sqlite3, re
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from .db import tx, init, ROOT, audit, setkv
from .security import bootstrap, digest, token, password_hash, verify
from .engine import news_blocked

@asynccontextmanager
async def lifespan(app):
    init()
    with tx() as c: bootstrap(c)
    yield

app=FastAPI(title='ZUPIRUS Quant Lab · Demo-only',version='0.1.0',lifespan=lifespan)
SECURE=os.getenv('COOKIE_SECURE','true').lower()=='true'
ORIGINS=os.getenv('ALLOWED_ORIGINS','https://zupirus.com,https://adm.zupirus.com').split(',')

@app.middleware('http')
async def perimeter(request,call_next):
    if request.method in ('POST','PUT','PATCH','DELETE'):
        origin=request.headers.get('origin')
        if origin and origin not in ORIGINS: return JSONResponse({'detail':'Origin denied'},403)
        length=request.headers.get('content-length','0')
        if not length.isdigit() or int(length)>3_000_000: return JSONResponse({'detail':'Body too large'},413)
        if request.cookies.get('session') and not request.headers.get('authorization') and request.headers.get('x-zupirus')!='1':
            return JSONResponse({'detail':'CSRF header required'},403)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['Cache-Control']='no-store'
    return response

def fail(code,message): raise HTTPException(code,message)
def user(request:Request):
    with tx() as c:
        row=c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',(digest(request.cookies.get('session','')),time.time())).fetchone()
        if not row: fail(401,'Đăng nhập để tiếp tục')
        return dict(row)
def admin(u=Depends(user)):
    if u['role']!='admin': fail(403,'Admin only')
    return u

def owned(c,account,u):
    a=c.execute('SELECT * FROM accounts WHERE id=? AND user_id=?',(account,u['id'])).fetchone()
    if not a: fail(404,'Account not found')
    return a

class Model(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
class Credentials(Model):
    email:str=Field(min_length=5,max_length=254,pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password:str=Field(min_length=12,max_length=128)

@app.post('/api/register')
def register(p:Credentials):
    with tx() as c:
        try: c.execute('INSERT INTO users VALUES(?,?,?,?)',(secrets.token_hex(16),p.email.lower(),password_hash(p.password),'customer'))
        except sqlite3.IntegrityError: fail(409,'Email already registered')
    return {'ok':True}

@app.post('/api/login')
def login(p:Credentials,request:Request):
    key=digest(p.email.lower()+'|'+request.client.host); now=time.time()
    with tx() as c:
        limit=c.execute('SELECT * FROM login_limits WHERE key=?',(key,)).fetchone()
        if limit and limit['until']>now and limit['attempts']>=10: fail(429,'Try again after 15 minutes')
        row=c.execute('SELECT * FROM users WHERE email=?',(p.email.lower(),)).fetchone()
        valid=bool(row and verify(p.password,row['password']))
        if not valid:
            attempts=limit['attempts']+1 if limit and limit['until']>now else 1
            c.execute('INSERT OR REPLACE INTO login_limits VALUES(?,?,?)',(key,attempts,now+900))
        else:
            c.execute('DELETE FROM login_limits WHERE key=?',(key,)); t=token()
            c.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(t),row['id'],now+28800))
    if not valid: fail(401,'Invalid credentials')
    response=JSONResponse({'email':row['email'],'role':row['role']})
    response.set_cookie('session',t,httponly=True,secure=SECURE,samesite='strict',max_age=28800,path='/')
    return response

@app.post('/api/logout')
def logout(request:Request,u=Depends(user)):
    with tx() as c: c.execute('DELETE FROM sessions WHERE token=?',(digest(request.cookies.get('session','')),))
    r=JSONResponse({'ok':True}); r.delete_cookie('session'); return r
@app.get('/api/me')
def me(u=Depends(user)): return {'email':u['email'],'role':u['role']}

class AccountCreate(Model):
    login:str=Field(min_length=1,max_length=24,pattern=r'^\d+$')
    server:str=Field(min_length=1,max_length=100,pattern=r'^[A-Za-z0-9_. -]+$')
    mode:Literal['DEMO','REPLAY']='DEMO'
@app.post('/api/accounts')
def create_account(p:AccountCreate,u=Depends(user)):
    aid=secrets.token_hex(12)
    with tx() as c:
        try: c.execute('INSERT INTO accounts(id,user_id,login,server,mode) VALUES(?,?,?,?,?)',(aid,u['id'],p.login,p.server,p.mode))
        except sqlite3.IntegrityError: fail(409,'Account/server already linked')
        audit(c,u['id'],'account_created',{'id':aid,'mode':p.mode})
    return {'id':aid}
@app.post('/api/replay')
def create_replay(u=Depends(user)):
    return create_account(AccountCreate(login=str(secrets.randbelow(10**12)),server='ZUPIRUS-SYNTHETIC',mode='REPLAY'),u)

class Risk(Model):
    enabled:bool
    risk:float=Field(ge=.01,le=1)
    max_spread:float=Field(gt=0,le=2)
    max_positions:int=Field(ge=1,le=3)
    max_dd:float=Field(ge=1,le=20)
@app.put('/api/accounts/{aid}/risk')
def risk(aid:str,p:Risk,u=Depends(user)):
    with tx() as c:
        a=owned(c,aid,u)
        c.execute('UPDATE accounts SET enabled=?,risk=?,max_spread=?,max_positions=?,max_dd=? WHERE id=?',(p.enabled,p.risk,p.max_spread,p.max_positions,p.max_dd,aid))
        if not p.enabled: c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE account_id=? AND state='queued'",(time.time(),aid))
        audit(c,u['id'],'risk_changed',{'account':aid,**p.model_dump()})
    return {'ok':True}
@app.post('/api/accounts/{aid}/pair')
def pair_code(aid:str,u=Depends(user)):
    code=token()
    with tx() as c:
        a=owned(c,aid,u)
        if a['mode']!='DEMO': fail(400,'Only DEMO accounts pair with MT5')
        if c.execute('SELECT 1 FROM devices WHERE account_id=?',(aid,)).fetchone(): fail(409,'Revoke old device first')
        c.execute('DELETE FROM pairings WHERE account_id=?',(aid,))
        c.execute('INSERT INTO pairings VALUES(?,?,?,0)',(digest(code),aid,time.time()+300))
    return {'code':code,'expires_in':300}
@app.post('/api/accounts/{aid}/revoke')
def revoke(aid:str,u=Depends(user)):
    with tx() as c:
        owned(c,aid,u)
        c.execute('DELETE FROM devices WHERE account_id=?',(aid,)); c.execute('DELETE FROM pairings WHERE account_id=?',(aid,))
        c.execute('UPDATE accounts SET enabled=0 WHERE id=?',(aid,))
        c.execute("UPDATE dispatches SET state='cancelled' WHERE account_id=? AND state='queued'",(aid,))
        audit(c,u['id'],'device_revoked',{'account':aid})
    return {'ok':True}

class Identity(Model):
    login:str
    server:str
    mode:Literal['DEMO']
class Pair(Identity):
    code:str=Field(max_length=100)
@app.post('/api/ea/pair',response_class=PlainTextResponse)
def pair(p:Pair):
    with tx() as c:
        row=c.execute('SELECT p.*,a.login,a.server,a.mode FROM pairings p JOIN accounts a ON a.id=p.account_id WHERE code=?',(digest(p.code),)).fetchone()
        if not row or row['used'] or row['expires']<time.time(): fail(401,'Pairing expired or used')
        if (p.login,p.server,p.mode)!=(row['login'],row['server'],row['mode']): fail(403,'MT5 identity mismatch')
        t=token(); c.execute('INSERT INTO devices VALUES(?,?)',(digest(t),row['account_id']))
        c.execute('UPDATE pairings SET used=1 WHERE code=?',(digest(p.code),))
        audit(c,row['account_id'],'device_paired',{})
    return t

def device(c,request,p):
    bearer=request.headers.get('authorization','')
    if not bearer.startswith('Bearer '): fail(401,'Device credential required')
    a=c.execute('SELECT a.* FROM accounts a JOIN devices d ON d.account_id=a.id WHERE d.token=?',(digest(bearer[7:]),)).fetchone()
    if not a: fail(401,'Invalid device')
    if (a['login'],a['server'],a['mode'])!=(p.login,p.server,p.mode) or p.mode!='DEMO': fail(403,'Demo identity required')
    return a

class Heartbeat(Identity):
    balance:float=Field(ge=0,le=1e12)
    equity:float=Field(ge=0,le=1e12)
    positions:int=Field(ge=0,le=10000)
@app.post('/api/ea/heartbeat',response_class=PlainTextResponse)
def heartbeat(p:Heartbeat,request:Request):
    with tx() as c:
        a=device(c,request,p); now=time.time()
        c.execute('UPDATE accounts SET balance=?,equity=?,peak=CASE WHEN seen=0 THEN ? ELSE max(peak,?) END,positions=?,seen=? WHERE id=?',(p.balance,p.equity,p.equity,p.equity,p.positions,now,a['id']))
        c.execute('INSERT INTO snapshots(account_id,ts,balance,equity) VALUES(?,?,?,?)',(a['id'],now,p.balance,p.equity))
        return 'OK'

@app.post('/api/ea/next',response_class=PlainTextResponse)
def next_dispatch(p:Identity,request:Request):
    with tx() as c:
        a=device(c,request,p)
        # Outstanding intent is always returned for reconciliation, including while paused/expired.
        d=c.execute("SELECT d.*,s.side,s.price,s.sl,s.tp,s.expires FROM dispatches d JOIN signals s ON s.id=d.signal_id WHERE d.account_id=? AND s.source='DEMO' AND (d.state IN ('intent','unknown') OR (d.state='queued' AND s.expires>?)) ORDER BY CASE WHEN d.state='queued' THEN 1 ELSE 0 END,d.id LIMIT 1",(a['id'],time.time())).fetchone()
        if not d: return 'NONE'
        if d['state']=='queued' and not a['enabled']: return 'NONE'
        return '|'.join(map(str,[d['id'],d['state'],d['side'],d['price'],d['sl'],d['tp'],int(d['expires']),a['risk'],a['max_spread'],a['max_positions'],a['max_dd'],d['nonce'] or '-',a['peak']]))

class Intent(Identity):
    dispatch:int=Field(gt=0)
    nonce:str=Field(min_length=16,max_length=100)
    spread:float=Field(ge=0,le=100)
    risk_amount:float=Field(gt=0,le=1e9)
@app.post('/api/ea/intent',response_class=PlainTextResponse)
def intent(p:Intent,request:Request):
    with tx() as c:
        a=device(c,request,p)
        d=c.execute('SELECT d.*,s.expires,s.source FROM dispatches d JOIN signals s ON s.id=d.signal_id WHERE d.id=? AND d.account_id=?',(p.dispatch,a['id'])).fetchone()
        if not d: fail(404,'Dispatch not found')
        if d['state']!='queued': return 'RECONCILE' # Never grant a second send, even with same nonce.
        now=time.time()
        active=c.execute("SELECT count(*) FROM dispatches WHERE account_id=? AND state IN ('intent','unknown')",(a['id'],)).fetchone()[0]
        halted=c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()
        blocked=bool(halted and halted[0]=='1') or not a['enabled'] or a['mode']!='DEMO' or d['source']!='DEMO' or d['expires']<now or now-a['seen']>30 or p.spread>a['max_spread'] or p.risk_amount>a['equity']*a['risk']/100 or a['positions']+active>=a['max_positions'] or a['equity']<=0 or (a['peak']-a['equity'])/a['peak']*100>=a['max_dd'] or news_blocked(c,now)
        if blocked: fail(409,'Risk gate denied')
        c.execute("UPDATE dispatches SET state='intent',nonce=?,updated=? WHERE id=?",(p.nonce,now,p.dispatch))
        audit(c,a['id'],'send_authorized',{'dispatch':p.dispatch})
        return 'SEND_ONCE'

class Receipt(Identity):
    dispatch:int=Field(gt=0)
    nonce:str=Field(min_length=16,max_length=100)
    state:Literal['filled','unknown','rejected']
    ticket:str=Field(default='',max_length=30,pattern=r'^\d*$')
    deal:str=Field(default='',max_length=30,pattern=r'^\d*$')
    reason:str=Field(default='',max_length=200)
@app.post('/api/ea/report',response_class=PlainTextResponse)
def report(p:Receipt,request:Request):
    with tx() as c:
        a=device(c,request,p)
        d=c.execute('SELECT * FROM dispatches WHERE id=? AND account_id=?',(p.dispatch,a['id'])).fetchone()
        if not d or d['nonce']!=p.nonce: fail(409,'Intent mismatch')
        if p.state=='filled' and (not p.ticket or not p.deal or int(p.ticket)==0 or int(p.deal)==0): fail(422,'Broker order and deal required')
        if d['state']=='filled':
            if p.state=='filled' and (d['ticket'],d['deal'])==(p.ticket,p.deal): return 'OK'
            fail(409,'Final receipt immutable')
        if d['state'] not in ('intent','unknown'): fail(409,'Invalid transition')
        try: c.execute('UPDATE dispatches SET state=?,ticket=?,deal=?,reason=?,updated=? WHERE id=?',(p.state,p.ticket or None,p.deal or None,p.reason,time.time(),p.dispatch))
        except sqlite3.IntegrityError: fail(409,'Deal already assigned')
        audit(c,a['id'],'execution_receipt',p.model_dump(exclude={'nonce'}))
    return 'OK'

class Quote(Model):
    source:Literal['DEMO']
    ts:float
    bid:float=Field(gt=0,le=1e6)
    ask:float=Field(gt=0,le=1e6)
@app.post('/api/feed')
def feed(p:Quote,request:Request):
    expected=os.getenv('FEED_TOKEN','')
    if len(expected)<32 or not secrets.compare_digest(request.headers.get('authorization',''),'Bearer '+expected): fail(403,'Feed service only')
    if abs(time.time()-p.ts)>10 or p.ask<p.bid: fail(422,'Stale or invalid quote')
    with tx() as c: c.execute('INSERT OR IGNORE INTO quotes(source,ts,bid,ask) VALUES(?,?,?,?)',(p.source,p.ts,p.bid,p.ask))
    return {'ok':True}

@app.get('/api/dashboard')
def dashboard(u=Depends(user)):
    with tx() as c:
        accounts=[dict(r) for r in c.execute('SELECT * FROM accounts WHERE user_id=?',(u['id'],))]
        orders=[dict(r) for r in c.execute('SELECT d.*,s.side,s.price,s.source FROM dispatches d JOIN signals s ON s.id=d.signal_id JOIN accounts a ON a.id=d.account_id WHERE a.user_id=? ORDER BY d.id DESC LIMIT 100',(u['id'],))]
        for d in orders: d.pop('nonce',None)
        series=[dict(r) for r in c.execute('SELECT s.* FROM snapshots s JOIN accounts a ON a.id=s.account_id WHERE a.user_id=? ORDER BY s.id DESC LIMIT 400',(u['id'],))][::-1]
        health=dict(c.execute("SELECT key,value FROM kv WHERE key IN ('execution_heartbeat','research_heartbeat','replay_price')").fetchall())
        return {'accounts':accounts,'orders':orders,'series':series,'health':health,'real_trading':False}

@app.get('/api/admin/monitor')
def monitor(u=Depends(admin)):
    with tx() as c:
        return {'accounts':[dict(r) for r in c.execute('SELECT a.*,u.email FROM accounts a JOIN users u ON u.id=a.user_id')], 'audit':[dict(r) for r in c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')], 'jobs':[dict(r) for r in c.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 30')], 'news':[dict(r) for r in c.execute('SELECT * FROM news ORDER BY ts DESC LIMIT 50')]}
class Safety(Model): halted:bool
@app.post('/api/admin/safety')
def safety(p:Safety,u=Depends(admin)):
    with tx() as c:
        setkv(c,'halted',int(p.halted))
        if p.halted:
            c.execute('UPDATE accounts SET enabled=0')
            c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE state='queued'",(time.time(),))
        audit(c,u['id'],'system_halt',p.model_dump())
    return {'halted':p.halted,'note':'Existing broker positions retain SL/TP; outstanding intents remain reconcilable.'}

@app.post('/api/admin/research')
def start_research(u=Depends(admin)):
    jid=secrets.token_hex(16)
    with tx() as c:
        c.execute('INSERT INTO jobs(id,state,created) VALUES(?,?,?)',(jid,'queued',time.time())); audit(c,u['id'],'research_requested',{'job':jid})
    return {'id':jid}
class Decision(Model): approved:bool
@app.post('/api/admin/research/{jid}/decision')
def decision(jid:str,p:Decision,u=Depends(admin)):
    with tx() as c:
        row=c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
        if not row or row['state']!='waiting_approval': fail(409,'Job not waiting for approval')
        c.execute("UPDATE jobs SET state='resume',decision=? WHERE id=?",(p.approved,jid)); audit(c,u['id'],'research_decision',{'job':jid,'approved':p.approved})
    return {'ok':True}
class News(Model):
    title:str=Field(min_length=1,max_length=300)
    currency:Literal['USD','ALL','EUR','OTHER']='USD'
    impact:Literal['high','medium','low']='high'
    ts:float
@app.post('/api/admin/news')
def add_news(p:News,u=Depends(admin)):
    with tx() as c:
        c.execute('INSERT INTO news VALUES(?,?,?,?,?)',(secrets.token_hex(12),p.title,p.currency,p.impact,p.ts)); audit(c,u['id'],'calendar_added',p.model_dump())
    return {'ok':True}
class Ask(Model): question:str=Field(min_length=1,max_length=2000)
@app.post('/api/assistant')
def assistant(p:Ask,u=Depends(user)):
    # Isolated data scope; no SQL/tool access exposed to AI.
    snapshot=dashboard(u)
    local=f"Bạn có {len(snapshot['accounts'])} tài khoản, {len(snapshot['orders'])} lệnh gần nhất. Real luôn bị khóa. Tạm dừng copy ngăn lệnh mới; SL/TP hiện hữu vẫn do broker xử lý."
    from .research import ai_text
    answer=ai_text('Chỉ giải thích dữ liệu demo của khách này: '+json.dumps(snapshot,ensure_ascii=False)[:18000]+'\nCâu hỏi: '+p.question)
    return {'text':answer['text'] if answer['available'] else local,'ai':answer['available']}
class Vision(Model):
    image:str=Field(max_length=2_500_000,pattern=r'^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$')
    question:str=Field(default='Phân tích sự cố trên biểu đồ demo này.',max_length=2000)
@app.post('/api/admin/vision')
def vision(p:Vision,u=Depends(admin)):
    from .research import ai_text
    return ai_text(p.question,p.image)

@app.get('/healthz')
def health():
    with tx() as c: c.execute('SELECT 1').fetchone()
    return {'status':'ok','real_trading':False}
app.mount('/assets',StaticFiles(directory=ROOT/'web'),name='assets')
@app.get('/')
def index(): return FileResponse(ROOT/'web/index.html')
