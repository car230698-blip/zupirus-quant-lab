import time,sqlite3
from test_system import enqueue,grant,receipt,RISK
from app import db

def test_pause_cancels_unclaimed_dispatch(demo):
    c,aid,i,h=demo;did=enqueue(aid)
    c.put(f'/api/accounts/{aid}/risk',json={**RISK,'enabled':False})
    assert c.post('/api/ea/next',headers=h,json=i).text=='NONE'
    assert grant(demo,did).text=='RECONCILE'
    assert c.get('/api/dashboard').json()['orders'][0]['state']=='cancelled'

def test_risk_out_of_range(customer):
    aid=customer.post('/api/replay').json()['id']
    assert customer.put(f'/api/accounts/{aid}/risk',json={**RISK,'risk':100}).status_code==422
    assert customer.put(f'/api/accounts/{aid}/risk',json={**RISK,'max_positions':0}).status_code==422

def test_session_expiration(customer):
    with db.tx() as c:c.execute('UPDATE sessions SET expires=0')
    assert customer.get('/api/dashboard').status_code==401

def test_device_cannot_use_web_role(demo):
    c,aid,i,h=demo;c.cookies.clear()
    assert c.get('/api/dashboard',headers=h).status_code==401
    assert c.post('/api/admin/research',headers=h).status_code==401

def test_deal_cannot_be_assigned_twice(demo):
    c,aid,i,h=demo;first=enqueue(aid);grant(demo,first);assert receipt(demo,first).status_code==200
    second=enqueue(aid);grant(demo,second)
    assert receipt(demo,second).status_code==409

def test_broker_account_binding_unique(customer):
    p={'login':'8888','server':'Unique-Demo','mode':'DEMO'}
    assert customer.post('/api/accounts',json=p).status_code==200
    assert customer.post('/api/accounts',json=p).status_code==409

def test_replay_pairing_forbidden(customer):
    aid=customer.post('/api/replay').json()['id']
    assert customer.post(f'/api/accounts/{aid}/pair').status_code==400

def test_pair_code_rotated_invalidates_old(customer):
    aid=customer.post('/api/accounts',json={'login':'88','server':'Demo','mode':'DEMO'}).json()['id']
    first=customer.post(f'/api/accounts/{aid}/pair').json()['code']
    second=customer.post(f'/api/accounts/{aid}/pair').json()['code']
    identity={'login':'88','server':'Demo','mode':'DEMO'}
    assert customer.post('/api/ea/pair',json={**identity,'code':first}).status_code==401
    assert customer.post('/api/ea/pair',json={**identity,'code':second}).status_code==200
    assert customer.post('/api/ea/pair',json={**identity,'code':second}).status_code==401

def test_backend_money_risk_limit(demo):
    c,aid,i,h=demo;did=enqueue(aid)
    p={**i,'dispatch':did,'nonce':'money-risk-nonce-123','spread':.3,'risk_amount':26}
    assert c.post('/api/ea/intent',headers=h,json=p).status_code==409
    p['risk_amount']=22
    assert c.post('/api/ea/intent',headers=h,json=p).text=='SEND_ONCE'

def test_admin_halt_blocks_and_keeps_reconciliation(demo):
    from test_system import login_admin
    c,aid,i,h=demo;did=enqueue(aid);grant(demo,did)
    assert c.post('/api/admin/safety',json={'halted':True}).status_code==403
    login_admin(c)
    assert c.post('/api/admin/safety',json={'halted':True}).status_code==200
    assert c.post('/api/ea/next',headers=h,json=i).text.split('|')[1]=='intent'
    assert receipt(demo,did).status_code==200
    with db.tx() as con:assert con.execute('SELECT enabled FROM accounts WHERE id=?',(aid,)).fetchone()[0]==0
    assert c.post('/api/admin/safety',json={'halted':False}).status_code==200
