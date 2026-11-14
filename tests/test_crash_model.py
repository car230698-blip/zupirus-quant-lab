"""Executable simulator of the EA send protocol; real API + persistent broker/terminal journals."""
import sqlite3
from pathlib import Path
from test_system import enqueue

class Broker:
    def __init__(self,path):self.path=path;self.conn=sqlite3.connect(path);self.conn.execute('CREATE TABLE IF NOT EXISTS deals(id INTEGER PRIMARY KEY,dispatch INTEGER, ticket TEXT,deal TEXT)');self.conn.commit()
    def send(self,d):
        # Deliberately no broker-side uniqueness on dispatch: duplicate client sends would be visible.
        n=self.conn.execute('SELECT count(*) FROM deals').fetchone()[0]+1
        self.conn.execute('INSERT INTO deals(dispatch,ticket,deal) VALUES(?,?,?)',(d,str(7000+n),str(8000+n)));self.conn.commit()
    def lookup(self,d):return self.conn.execute('SELECT ticket,deal FROM deals WHERE dispatch=? ORDER BY id LIMIT 1',(d,)).fetchone()
    def count(self):return self.conn.execute('SELECT count(*) FROM deals').fetchone()[0]

class ClientModel:
    def __init__(self,demo,path,broker):self.demo=demo;self.path=path;self.broker=broker
    def step(self,crash=None):
        c,aid,i,h=self.demo
        fields=c.post('/api/ea/next',headers=h,json=i).text.split('|')
        if fields==['NONE']:return
        did=int(fields[0]);state=fields[1];file=self.path/str(did)
        if state!='queued':
            found=self.broker.lookup(did)
            if found:c.post('/api/ea/report',headers=h,json={**i,'dispatch':did,'nonce':fields[11],'state':'filled','ticket':found[0],'deal':found[1]})
            return
        if file.exists():return
        nonce='durable-client-nonce-123';file.write_text(nonce)
        if crash=='before_intent':return
        result=c.post('/api/ea/intent',headers=h,json={**i,'dispatch':did,'nonce':nonce,'risk_amount':20,'spread':.3})
        if crash=='lost_authorization':return
        if result.text!='SEND_ONCE':return
        self.broker.send(did)
        if crash=='lost_receipt':return
        found=self.broker.lookup(did)
        c.post('/api/ea/report',headers=h,json={**i,'dispatch':did,'nonce':nonce,'state':'filled','ticket':found[0],'deal':found[1]})

def test_crash_after_fill_reconciles_once(demo,tmp_path):
    did=enqueue(demo[1]);terminal=tmp_path/'terminal';terminal.mkdir();broker=Broker(tmp_path/'broker.sqlite')
    ClientModel(demo,terminal,broker).step('lost_receipt')
    assert broker.count()==1
    # Lost all terminal files: backend persisted intent + broker history still prevents resubmission.
    (terminal/str(did)).unlink()
    for _ in range(20):ClientModel(demo,terminal,Broker(tmp_path/'broker.sqlite')).step()
    assert broker.count()==1
    assert demo[0].get('/api/dashboard').json()['orders'][0]['state']=='filled'

def test_crash_before_send_fails_closed(demo,tmp_path):
    enqueue(demo[1]);broker=Broker(tmp_path/'broker.sqlite')
    ClientModel(demo,tmp_path,broker).step('lost_authorization')
    for _ in range(10):ClientModel(demo,tmp_path,broker).step()
    assert broker.count()==0
    assert demo[0].get('/api/dashboard').json()['orders'][0]['state']=='intent'

def test_crash_after_local_journal_no_send(demo,tmp_path):
    enqueue(demo[1]);broker=Broker(tmp_path/'broker.sqlite')
    ClientModel(demo,tmp_path,broker).step('before_intent')
    ClientModel(demo,tmp_path,broker).step()
    assert broker.count()==0
