import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ.pop('DATABASE_URL', None)
os.environ.setdefault('ADMIN_PASSWORD','test-only-admin-password-123')
os.environ['COOKIE_SECURE']='false'
os.environ['ALLOWED_ORIGINS']='http://testserver,http://localhost:8080'
os.environ['FEED_TOKEN']='f'*40
os.environ['ENABLE_LEGACY_EA_BRIDGE']='true'
import pytest
from fastapi.testclient import TestClient
from app import db, main, research

@pytest.fixture
def client(tmp_path,monkeypatch):
    from app.core import db as core_db
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.setattr(db,'DATABASE_URL','')
    monkeypatch.setattr(db,'_pg_pool',None)
    monkeypatch.setattr(db,'DB',tmp_path/'lab.sqlite3')
    monkeypatch.setattr(db,'DATA',tmp_path)
    monkeypatch.setattr(core_db,'DATABASE_URL','')
    monkeypatch.setattr(core_db,'_pg_pool',None)
    monkeypatch.setattr(core_db,'DB',tmp_path/'lab.sqlite3')
    monkeypatch.setattr(core_db,'DATA',tmp_path)
    monkeypatch.setattr(research,'DATA',tmp_path)
    with TestClient(main.app) as c:
        c.headers.update({'X-Zupirus':'1'})
        yield c

@pytest.fixture
def customer(client):
    p={'email':'alice@example.com','password':'customer-password-123'}
    assert client.post('/api/register',json=p).status_code==200
    assert client.post('/api/login',json=p).status_code==200
    return client

@pytest.fixture
def demo(customer):
    c=customer
    aid=c.post('/api/accounts',json={'login':'12345','server':'Broker-Demo','mode':'DEMO'}).json()['id']
    c.put(f'/api/accounts/{aid}/risk',json={'enabled':True,'risk':.25,'max_spread':.8,'max_positions':1,'max_dd':10})
    code=c.post(f'/api/accounts/{aid}/pair').json()['code']
    identity={'login':'12345','server':'Broker-Demo','mode':'DEMO'}
    r=c.post('/api/ea/pair',json={**identity,'code':code});assert r.status_code==200
    headers={'Authorization':'Bearer '+r.text}
    assert c.post('/api/ea/heartbeat',headers=headers,json={**identity,'balance':10000,'equity':10000,'positions':0}).status_code==200
    return c,aid,identity,headers
