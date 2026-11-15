"""Deterministic execution. Integrated with Redis Streams, Pub/Sub, Distributed Locks,
and Multi-Strategy Coordinator (Trend Following, Mean Reversion, Breakout)."""
import time, hashlib, math, json, logging
from typing import Dict, Any, Optional, Tuple, Literal
from .db import tx, init, audit, setkv, ROOT
from .redis_client import publish_signal_event, acquire_dispatch_lock, release_dispatch_lock

logger = logging.getLogger("zupirus.engine")

SL_DISTANCE = 6.0
TP_DISTANCE = 12.0
STRATEGY_VERSION = "2.1.0"


# ---------------------------------------------------------------------------
# Individual Technical Strategies & Multi-Strategy Coordinator
# ---------------------------------------------------------------------------

def trend_following_signal(prices, fast_n=5, slow_n=20) -> Tuple[Optional[Literal['BUY', 'SELL']], str]:
    """Trend Following: Fast/Slow SMA crossover with momentum confirmation."""
    if len(prices) < slow_n + 1:
        return None, "Dữ liệu chưa đủ chu kỳ slow_n=20"
    fast = sum(prices[-fast_n:]) / fast_n
    slow = sum(prices[-slow_n:]) / slow_n
    prevfast = sum(prices[-fast_n-1:-1]) / fast_n
    prevslow = sum(prices[-slow_n-1:-1]) / slow_n
    if prevfast <= prevslow and fast > slow:
        return 'BUY', f"TREND_BUY: Fast SMA({fast_n})={fast:.2f} cắt lên Slow SMA({slow_n})={slow:.2f}"
    if prevfast >= prevslow and fast < slow:
        return 'SELL', f"TREND_SELL: Fast SMA({fast_n})={fast:.2f} cắt xuống Slow SMA({slow_n})={slow:.2f}"
    return None, f"TREND_NEUTRAL: Fast SMA({fast:.2f}) song song Slow SMA({slow:.2f})"


def mean_reversion_signal(prices, period=20, num_std=2.0) -> Tuple[Optional[Literal['BUY', 'SELL']], str]:
    """Mean Reversion: Bollinger Band 2-sigma deviation against mean."""
    if len(prices) < period:
        return None, "Dữ liệu chưa đủ chu kỳ period=20"
    window = prices[-period:]
    mean = sum(window) / period
    variance = sum((p - mean) ** 2 for p in window) / period
    std_dev = math.sqrt(variance)
    last_price = prices[-1]
    upper = mean + num_std * std_dev
    lower = mean - num_std * std_dev

    if std_dev < 0.5:
        return None, "MEAN_REV_LOW_VOL: Độ lệch chuẩn biến động quá thấp (<0.5)"

    if last_price <= lower:
        return 'BUY', f"MEAN_REV_BUY: Giá={last_price:.2f} chạm cận dưới Bollinger Band({lower:.2f}) [mean={mean:.2f}]"
    if last_price >= upper:
        return 'SELL', f"MEAN_REV_SELL: Giá={last_price:.2f} chạm cận trên Bollinger Band({upper:.2f}) [mean={mean:.2f}]"
    return None, f"MEAN_REV_NEUTRAL: Giá={last_price:.2f} nằm trong dải Bollinger [{lower:.2f} - {upper:.2f}]"


def breakout_signal(prices, period=20) -> Tuple[Optional[Literal['BUY', 'SELL']], str]:
    """Breakout: 20-bar Donchian channel breakout with volatility expansion."""
    if len(prices) < period + 1:
        return None, "Dữ liệu chưa đủ chu kỳ period=20"
    prior = prices[-period-1:-1]
    high = max(prior)
    low = min(prior)
    last_price = prices[-1]
    spread = high - low
    if spread < 1.0:
        return None, "BREAKOUT_COMPRESSED: Biên độ Donchian quá hẹp (<1.0)"

    if last_price > high:
        return 'BUY', f"BREAKOUT_BUY: Giá={last_price:.2f} phá vỡ đỉnh 20 nến ({high:.2f})"
    if last_price < low:
        return 'SELL', f"BREAKOUT_SELL: Giá={last_price:.2f} phá vỡ đáy 20 nến ({low:.2f})"
    return None, f"BREAKOUT_NEUTRAL: Giá={last_price:.2f} nằm trong hộp Donchian [{low:.2f} - {high:.2f}]"


def coordinate_strategies(prices, timeframe: str = "M15") -> Dict[str, Any]:
    """Multi-Strategy Coordinator:
    Evaluates market regime across Trend Following, Mean Reversion, and Breakout.
    Selects the optimal strategy and records full audit rationale."""
    if len(prices) < 25:
        return {
            "side": None,
            "strategy": "none",
            "timeframe": timeframe,
            "parameters": {},
            "version": STRATEGY_VERSION,
            "reason": "Dữ liệu lịch sử chưa đủ 25 nến để đánh giá đa chiến lược"
        }

    recent = prices[-20:]
    mean = sum(recent) / 20
    std_dev = math.sqrt(sum((p - mean) ** 2 for p in recent) / 20)
    slope = (prices[-1] - prices[-10]) / 10.0

    # 1. High Trend Momentum: prefer Trend Following
    if abs(slope) >= 0.35:
        side, reason = trend_following_signal(prices, fast_n=5, slow_n=20)
        if side:
            return {
                "side": side,
                "strategy": "trend_following",
                "timeframe": timeframe,
                "parameters": {"fast_n": 5, "slow_n": 20, "sl": SL_DISTANCE, "tp": TP_DISTANCE},
                "version": STRATEGY_VERSION,
                "reason": reason
            }

    # 2. Volatility Compression / Squeeze Breakout
    b_side, b_reason = breakout_signal(prices, period=20)
    if b_side:
        return {
            "side": b_side,
            "strategy": "breakout",
            "timeframe": timeframe,
            "parameters": {"period": 20, "sl": SL_DISTANCE, "tp": TP_DISTANCE},
            "version": STRATEGY_VERSION,
            "reason": b_reason
        }

    # 3. Range-Bound / Ranging: Mean Reversion
    if std_dev >= 1.2:
        mr_side, mr_reason = mean_reversion_signal(prices, period=20, num_std=2.0)
        if mr_side:
            return {
                "side": mr_side,
                "strategy": "mean_reversion",
                "timeframe": timeframe,
                "parameters": {"period": 20, "num_std": 2.0, "sl": SL_DISTANCE, "tp": TP_DISTANCE},
                "version": STRATEGY_VERSION,
                "reason": mr_reason
            }

    # 4. Fallback to basic Trend Following or Stand Aside
    t_side, t_reason = trend_following_signal(prices, fast_n=5, slow_n=20)
    if t_side:
        return {
            "side": t_side,
            "strategy": "trend_following",
            "timeframe": timeframe,
            "parameters": {"fast_n": 5, "slow_n": 20, "sl": SL_DISTANCE, "tp": TP_DISTANCE},
            "version": STRATEGY_VERSION,
            "reason": t_reason
        }

    return {
        "side": None,
        "strategy": "none",
        "timeframe": timeframe,
        "parameters": {"fast_n": 5, "slow_n": 20},
        "version": STRATEGY_VERSION,
        "reason": f"STAND_ASIDE: Thị trường dao động trong vùng nhiễu (std={std_dev:.2f}, slope={slope:.2f})"
    }


def strategy(prices, fast_n=5, slow_n=20):
    """Legacy backward-compatible entry point calling trend_following."""
    side, _ = trend_following_signal(prices, fast_n, slow_n)
    return side

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

def publish(c, source, side, price, key, now=None, strategy_meta: Optional[Dict[str, Any]] = None):
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
    meta = strategy_meta or {
        "strategy": "trend_following",
        "timeframe": "M15",
        "version": STRATEGY_VERSION,
        "reason": f"{side} signal generated by quant coordinator"
    }

    signal_payload = {
        "id": sid,
        "source": source,
        "side": side,
        "price": price,
        "sl": sl_price,
        "tp": tp_price,
        "created": now,
        "expires": expires_at,
        "meta": meta
    }
    c.execute(
        "INSERT INTO outbox(event_type, payload, status, retry_count, created_at) VALUES(?,?,?,?,?)",
        ("signal_created", json.dumps(signal_payload), "pending", 0, now)
    )

    # Publish to Redis Streams & Pub/Sub immediately if connection available
    try:
        publish_signal_event(signal_payload)
        c.execute("UPDATE outbox SET status='published', published_at=? WHERE event_type='signal_created' AND status='pending' AND CAST(payload AS TEXT) LIKE ?", (now, f'%{sid}%'))
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
    
    # Coordinate multi-strategy signal
    decision = coordinate_strategies([x['close'] for x in data[max(0, i-25):i+1]], timeframe="M15")
    side = decision.get("side")
    if side:
        publish(c, 'REPLAY', side, price, f'{index}', now, strategy_meta=decision)
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
    
    prices = [(r['bid'] + r['ask']) / 2 for r in rows]
    decision = coordinate_strategies(prices, timeframe="M15")
    side = decision.get("side")
    if side and rows[-1]['ask'] - rows[-1]['bid'] <= .8 and not news_blocked(c, time.time()):
        publish(c, 'DEMO', side, (rows[-1]['ask'] + rows[-1]['bid']) / 2, str(rows[-1]['ts']), strategy_meta=decision)

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
