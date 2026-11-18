import time,json,sqlite3,secrets
from concurrent.futures import ThreadPoolExecutor
import pytest
from app import db,engine,research

RISK={'enabled':True,'risk':.25,'max_spread':.8,'max_positions':1,'max_dd':10}

def enqueue(aid,source='DEMO',key=None):
    with db.tx() as c:
        engine.publish(c,source,'BUY',2650,key or secrets.token_hex(8))
        d=c.execute('SELECT id FROM dispatches WHERE account_id=? ORDER BY id DESC',(aid,)).fetchone()
        return d[0] if d else None

def grant(demo,did,nonce='client-intent-123456'):
    c,aid,i,h=demo
    return c.post('/api/ea/intent',headers=h,json={**i,'dispatch':did,'nonce':nonce,'risk_amount':20,'spread':.3})

def receipt(demo,did,**extra):
    c,aid,i,h=demo
    p={**i,'dispatch':did,'nonce':'client-intent-123456','state':'filled','ticket':'7001','deal':'8001',**extra}
    return c.post('/api/ea/report',headers=h,json=p)

def login_admin(c):
    c.cookies.clear()
    assert c.post('/api/login',json={'email':'admin@zupirus.local','password':'test-only-admin-password-123'}).status_code==200


def test_health_and_static(client):
    assert client.get('/healthz').json()['real_trading'] is False
    r=client.get('/');assert r.status_code==200 and 'ZUPIRUS' in r.text
    assert "frame-ancestors 'none'" in r.headers['content-security-policy']
    assert client.get('/assets/tsconfig.json').status_code == 404

def test_no_anonymous_access(client):
    assert client.get('/api/dashboard').status_code==401
    assert client.get('/api/admin/monitor').status_code==401

def test_registration_cannot_escalate(client):
    assert client.post('/api/register',json={'email':'a@b.com','password':'password-long-123','role':'admin'}).status_code==422

def test_customer_not_admin(customer):
    assert customer.post('/api/admin/research').status_code==403
    assert customer.get('/api/admin/monitor').status_code==403

def test_passwords_and_tokens_hashed(customer):
    with db.tx() as c:
        u=c.execute("SELECT * FROM users WHERE email='alice@example.com'").fetchone()
        assert u['password']!='customer-password-123' and ':' in u['password']
        s=c.execute('SELECT token FROM sessions WHERE user_id=?',(u['id'],)).fetchone()[0]
        assert s!=customer.cookies.get('session') and len(s)==64

def test_cookie_flags(customer):
    r=customer.post('/api/login',json={'email':'alice@example.com','password':'customer-password-123'})
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=strict' in r.headers['set-cookie']

def test_csrf_and_foreign_origin(customer):
    assert customer.post('/api/replay',headers={'Origin':'https://evil.example'}).status_code==403
    del customer.headers['X-Zupirus']
    assert customer.post('/api/replay').status_code==403

def test_logout_revokes_session(customer):
    cookie=customer.cookies.get('session');assert customer.post('/api/logout').status_code==200
    customer.cookies.set('session',cookie)
    assert customer.get('/api/me').status_code==401

def test_login_rate_limit(client):
    payload={'email':'unknown@example.com','password':'bad-password-123'}
    for _ in range(10): assert client.post('/api/login',json=payload).status_code==401
    assert client.post('/api/login',json=payload).status_code==429

def test_cross_tenant_isolation(customer):
    aid=customer.post('/api/replay').json()['id']
    p={'email':'bob@example.com','password':'bob-password-123'}
    customer.post('/api/register',json=p);customer.post('/api/login',json=p)
    assert customer.get('/api/dashboard').json()['accounts']==[]
    for path in ('pair','revoke'): assert customer.post(f'/api/accounts/{aid}/{path}').status_code==404
    assert customer.put(f'/api/accounts/{aid}/risk',json=RISK).status_code==404
    assert '0 tài khoản' in customer.post('/api/assistant',json={'question':'Show Alice accounts'}).json()['text']

@pytest.mark.parametrize('mode',['REAL','CONTEST','real',''])
def test_real_account_schema_rejected(customer,mode):
    assert customer.post('/api/accounts',json={'login':'999','server':'Broker','mode':mode}).status_code==422

def test_real_database_constraint(customer):
    with db.tx() as c:
        uid=c.execute("SELECT id FROM users WHERE role='customer'").fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError): c.execute('INSERT INTO accounts(id,user_id,login,server,mode) VALUES(?,?,?,?,?)',('r',uid,'9','R','REAL'))

def test_metaapi_cloud_endpoints_and_telemetry(customer):
    # Verify cloud accounts list endpoint
    r = customer.get('/api/metaapi/accounts')
    assert r.status_code == 200
    assert 'accounts' in r.json()

    # Verify cloud telemetry endpoint requires admin
    assert customer.get('/api/metaapi/telemetry').status_code == 403
    login_admin(customer)
    t = customer.get('/api/metaapi/telemetry')
    assert t.status_code == 200
    d = t.json()
    assert d['direct_to_user_enabled'] is True
    assert 'total_connected_accounts' in d

def test_replay_trades_and_equity_without_ai(customer,monkeypatch):
    monkeypatch.delenv('AI_API_KEY',raising=False)
    aid=customer.post('/api/replay').json()['id'];customer.put(f'/api/accounts/{aid}/risk',json=RISK)
    with db.tx() as c:
        for n in range(240):engine.replay_step(c,n)
    d=customer.get('/api/dashboard').json()
    assert len(d['orders'])>=2
    assert all(o['source']=='REPLAY' and o['ticket'].startswith('SIM-') for o in d['orders'])
    assert len({x['equity'] for x in d['series']})>1

def test_langgraph_interrupt_restart_resume(client):
    login_admin(client);jid=client.post('/api/admin/research').json()['id']
    research.process_once()
    with db.tx() as c:
        j=dict(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
        assert j['state']=='waiting_approval'
        assert json.loads(j['result'])['report']['production_qualified'] is False
    # Separate saver/graph construction imitates process restart; checkpoint remains.
    assert client.post(f'/api/admin/research/{jid}/decision',json={'approved':True}).status_code==200
    research.process_once()
    with db.tx() as c:
        j=dict(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
        assert j['state']=='completed'
        assert json.loads(j['result'])['disposition']=='approved_for_demo_review'
    assert client.post(f'/api/admin/research/{jid}/decision',json={'approved':False}).status_code==409

def test_langgraph_rejection(client):
    login_admin(client);jid=client.post('/api/admin/research').json()['id'];research.process_once()
    client.post(f'/api/admin/research/{jid}/decision',json={'approved':False});research.process_once()
    with db.tx() as c:assert json.loads(c.execute('SELECT result FROM jobs WHERE id=?',(jid,)).fetchone()[0])['disposition']=='rejected'

def test_walkforward_no_overlap_and_future_leakage():
    prices=[r['close'] for r in json.loads((db.ROOT/'data/replay.json').read_text())]
    r=research.walk_forward(prices)
    assert len(r['folds'])==13
    for f in r['folds']: assert f['train'][1]<f['test'][0]
    for a,b in zip(r['folds'],r['folds'][1:]):assert a['test'][1]<b['test'][0]
    changed=prices[:180]+[p+10000 for p in prices[180:]]
    assert research.walk_forward(changed)['folds'][0]==r['folds'][0]

def test_ai_missing_and_provider_failure(client, monkeypatch):
    monkeypatch.delenv('AI_API_KEY',raising=False)
    monkeypatch.delenv('GEMINI_API_KEY',raising=False)
    assert research.ai_text('test')['available'] is False
    monkeypatch.setenv('AI_API_KEY','invalid')
    def fail(*a,**kw):raise RuntimeError('offline')
    monkeypatch.setattr(research.httpx,'post',fail)
    monkeypatch.setattr(research, 'call_gemini', lambda *a, **k: (None, None))
    assert research.ai_text('test')['available'] is False

def test_research_crash_does_not_stop_execution(customer,monkeypatch):
    monkeypatch.setattr(research,'process_once',lambda: (_ for _ in ()).throw(RuntimeError('AI dead')))
    engine.tick()
    with db.tx() as c: assert time.time()-float(c.execute("SELECT value FROM kv WHERE key='execution_heartbeat'").fetchone()[0])<5

def test_ea_eliminated_and_direct_cloud_active():
    assert not (db.ROOT / 'ea/Zupirus_Copy_EA.mq5').exists()
    assert not (db.ROOT / 'ea/Zupirus_Copy_EA.ex5').exists()
    assert not (db.ROOT / 'ea').exists()
