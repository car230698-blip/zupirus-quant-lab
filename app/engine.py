"""Deterministic execution. Integrated with Redis Streams, Pub/Sub and Distributed Locks."""
import time, hashlib, math, json
from .db import tx, init, audit, setkv, ROOT
from .redis_client import publish_signal_event, acquire_dispatch_lock, release_dispatch_lock

SL_DISTANCE = 6.0
TP_DISTANCE = 12.0

def strategy(prices, fast_n=5, slow_n=20):
    if len(prices) < slow_n + 1: return None
    fast = sum(prices[-fast_n:]) / fast_n
    slow = sum(prices[-slow_n:]) / slow_n
    prevfast = sum(prices[-fast_n-1:-1]) / fast_n
    prevslow = sum(prices[-slow_n-1:-1]) / slow_n
    if prevfast <= prevslow and fast > slow: return 'BUY'
    if prevfast >= prevslow and fast < slow: return 'SELL'
    return None

def news_blocked(c, now):
    return c.execute("SELECT 1 FROM news WHERE currency IN ('USD','ALL') AND impact='high' AND abs(ts-?)<900", (now,)).fetchone() is not None

def permitted(c, a, now):
    halted = c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()
    if halted and halted[0] == '1': return False
    if a['mode'] not in ('DEMO', 'REPLAY') or not a['enabled']: return False
    if a['equity'] <= 0 or (a['peak'] - a['equity']) / max(a['peak'], 1) * 100 >= a['max_dd']: return False
    if a['mode'] == 'DEMO' and (now - a['seen'] > 30 or news_blocked(c, now)): return False
    active = c.execute("SELECT count(*) FROM dispatches WHERE account_id=? AND state IN ('queued','intent','unknown')", (a['id'],)).fetchone()[0]
    return active + a['positions'] < a['max_positions']

def publish(c, source, side, price, key, now=None):
    now = now or time.time()
    sid = hashlib.sha256(f'{source}:{key}'.encode()).hexdigest()[:24]
    sign = 1 if side == 'BUY' else -1
    sl_price = price - sign * SL_DISTANCE
    tp_price = price + sign * TP_DISTANCE
    expires_at = now + 45

    c.execute(
        'INSERT OR IGNORE INTO signals VALUES(?,?,?,?,?,?,?,?)',
        (sid, source, side, price, sl_price, tp_price, now, expires_at)
    )

    # 1. Transactional Outbox: insert signal event atomically into outbox table
    signal_payload = {
        "id": sid,
        "source": source,
        "side": side,
        "price": price,
        "sl": sl_price,
        "tp": tp_price,
        "created": now,
        "expires": expires_at,
    }
    c.execute(
        "INSERT INTO outbox(event_type, payload, status, retry_count, created_at) VALUES(?,?,?,?,?)",
        ("signal_created", json.dumps(signal_payload), "pending", 0, now)
    )

    # Publish to Redis Streams & Pub/Sub immediately if connection available
    try:
        publish_signal_event(signal_payload)
        c.execute("UPDATE outbox SET status='published', published_at=? WHERE event_type='signal_created' AND status='pending' AND payload LIKE ?", (now, f'%{sid}%'))
    except Exception:
        pass

    # 2. Iterate accounts and apply Distributed Lock to prevent duplicate dispatches
    for a in c.execute('SELECT * FROM accounts WHERE mode=?', (source,)).fetchall():
        if permitted(c, a, now):
            # Distributed Lock pattern: lock:dispatch:{account_id}:{signal_id}
            lock_token = acquire_dispatch_lock(a['id'], sid, ttl_seconds=30)
            if lock_token is not None:
                try:
                    c.execute(
                        'INSERT OR IGNORE INTO dispatches(account_id,signal_id,created,updated) VALUES(?,?,?,?)',
                        (a['id'], sid, now, now)
                    )
                finally:
                    # Release lock after insertion so subsequent duplicate attempts in same window are bounded
                    release_dispatch_lock(a['id'], sid, lock_token)
            else:
                # Concurrent worker already holding lock for this signal + account
                pass

    return sid

def replay_step(c, index):
    data = json.loads((ROOT / 'data/replay.json').read_text())
    i = index % len(data)
    price = data[i]['close']
    now = time.time()
    # Synthetic contract assumption: 100 oz/lot, USD account, fixed spread $0.30.
    for p in c.execute('SELECT * FROM sim_positions').fetchall():
        sign = 1 if p['side'] == 'BUY' else -1
        hit = (price - p['sl']) * sign <= 0 or (price - p['tp']) * sign >= 0
        if hit or i == 0:
            pnl = (price - p['entry']) * sign * p['lots'] * 100 - p['lots'] * 7
            c.execute('UPDATE accounts SET balance=balance+?,positions=CASE WHEN positions > 0 THEN positions - 1 ELSE 0 END WHERE id=?', (pnl, p['account_id']))
            c.execute('DELETE FROM sim_positions WHERE dispatch_id=?', (p['dispatch_id'],))
            audit(c, 'replay', 'position_closed', {'dispatch': p['dispatch_id'], 'pnl': round(pnl, 2)})
    for a in c.execute("SELECT * FROM accounts WHERE mode='REPLAY'").fetchall():
        pnl = sum((price - p['entry']) * (1 if p['side'] == 'BUY' else -1) * p['lots'] * 100 for p in c.execute('SELECT * FROM sim_positions WHERE account_id=?', (a['id'],)))
        equity = a['balance'] + pnl
        c.execute('UPDATE accounts SET equity=?,peak=CASE WHEN peak > ? THEN peak ELSE ? END,seen=? WHERE id=?', (equity, equity, equity, now, a['id']))
        c.execute('INSERT INTO snapshots(account_id,ts,balance,equity) VALUES(?,?,?,?)', (a['id'], now, a['balance'], equity))
    side = strategy([x['close'] for x in data[max(0, i-25):i+1]])
    if side: publish(c, 'REPLAY', side, price, f'{index}', now)
    for d in c.execute("SELECT d.*,s.side,s.sl,s.tp FROM dispatches d JOIN signals s ON s.id=d.signal_id WHERE d.state='queued' AND s.source='REPLAY'").fetchall():
        a = c.execute('SELECT * FROM accounts WHERE id=?', (d['account_id'],)).fetchone()
        if not a['enabled']: continue
        lots = math.floor((a['equity'] * a['risk'] / 100) / (6 * 100) / .01) * .01
        if lots < .01:
            c.execute("UPDATE dispatches SET state='rejected',reason='below_min_lot' WHERE id=?", (d['id'],))
            continue
        entry = price + (.15 if d['side'] == 'BUY' else -.15)
        c.execute('INSERT OR IGNORE INTO sim_positions VALUES(?,?,?,?,?,?,?)', (d['id'], a['id'], d['side'], entry, d['sl'], d['tp'], lots))
        c.execute("UPDATE dispatches SET state='filled',ticket=?,deal=?,updated=? WHERE id=?", (f'SIM-{d["id"]}', f'SIM-{d["id"]}', now, d['id']))
        c.execute('UPDATE accounts SET positions=positions+1 WHERE id=?', (a['id'],))
    setkv(c, 'replay_index', index + 1)
    setkv(c, 'replay_price', price)

def demo_step(c):
    rows = c.execute("SELECT * FROM quotes WHERE source='DEMO' ORDER BY ts DESC LIMIT 26").fetchall()[::-1]
    if not rows or time.time() - rows[-1]['ts'] > 10: return
    previous = c.execute("SELECT value FROM kv WHERE key='demo_last'").fetchone()
    if previous and float(previous[0]) >= rows[-1]['ts']: return
    setkv(c, 'demo_last', rows[-1]['ts'])
    side = strategy([(r['bid'] + r['ask']) / 2 for r in rows])
    if side and rows[-1]['ask'] - rows[-1]['bid'] <= .8 and not news_blocked(c, time.time()):
        publish(c, 'DEMO', side, (rows[-1]['ask'] + rows[-1]['bid']) / 2, str(rows[-1]['ts']))

def flush_outbox(c):
    """Process pending outbox events and publish to Redis Streams with retry."""
    rows = c.execute("SELECT id, event_type, payload, retry_count FROM outbox WHERE status='pending' ORDER BY id LIMIT 20").fetchall()
    for row in rows:
        oid, etype, payload_raw, retries = row['id'], row['event_type'], row['payload'], row['retry_count']
        try:
            payload = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
            if etype == "signal_created":
                publish_signal_event(payload)
            c.execute("UPDATE outbox SET status='published', published_at=? WHERE id=?", (time.time(), oid))
        except Exception as e:
            c.execute("UPDATE outbox SET retry_count=retry_count+1, error=? WHERE id=?", (str(e), oid))


def tick():
    with tx() as c:
        now = time.time()
        flush_outbox(c)
        c.execute("UPDATE dispatches SET state='expired',updated=? WHERE state='queued' AND signal_id IN (SELECT id FROM signals WHERE expires<?)", (now, now))
        row = c.execute("SELECT value FROM kv WHERE key='replay_index'").fetchone()
        replay_step(c, int(row[0]) if row else 0)
        demo_step(c)
        setkv(c, 'execution_heartbeat', now)
        c.execute('DELETE FROM snapshots WHERE ts<?', (now - 86400 * 7,))
        c.execute('DELETE FROM quotes WHERE ts<?', (now - 86400 * 2,))

def main():
    init()
    while True:
        try: tick()
        except Exception as e:
            print('execution error', type(e).__name__, str(e), flush=True)
        time.sleep(2)

if __name__ == '__main__': main()
