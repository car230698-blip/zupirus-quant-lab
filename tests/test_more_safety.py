import time
import sqlite3
from app import db

RISK = {'enabled': True, 'risk': 0.25, 'max_spread': 0.8, 'max_positions': 1, 'max_dd': 10}


def test_risk_out_of_range(customer):
    aid = customer.post('/api/replay').json()['id']
    assert customer.put(f'/api/accounts/{aid}/risk', json={**RISK, 'risk': 100}).status_code == 422
    assert customer.put(f'/api/accounts/{aid}/risk', json={**RISK, 'max_positions': 0}).status_code == 422


def test_session_expiration(customer):
    with db.tx() as c:
        c.execute('UPDATE sessions SET expires=0')
    assert customer.get('/api/dashboard').status_code == 401


def test_broker_account_binding_unique(customer):
    p = {'login': '8888', 'server': 'Unique-Demo', 'mode': 'DEMO'}
    assert customer.post('/api/accounts', json=p).status_code == 200
    assert customer.post('/api/accounts', json=p).status_code == 409


def test_admin_kill_switch_safety_controls(client):
    from test_system import login_admin
    assert client.post('/api/admin/safety', json={'halted': True}).status_code == 401
    login_admin(client)
    # Engage kill switch
    assert client.post('/api/admin/safety', json={'halted': True}).status_code == 200
    with db.tx() as c:
        assert c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()[0] == '1'
    # Disengage kill switch
    assert client.post('/api/admin/safety', json={'halted': False}).status_code == 200
    with db.tx() as c:
        assert c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()[0] == '0'
