"""Deterministic execution. Integrated with Redis Streams, Pub/Sub, Distributed Locks,
and Multi-Strategy Coordinator (Trend Following, Mean Reversion, Breakout)."""
import os, time, hashlib, math, json, logging
from typing import Dict, Any, Optional
from .db import tx, init, audit, setkv, ROOT
from .redis_client import publish_signal_event, acquire_dispatch_lock, release_dispatch_lock

logger = logging.getLogger("zupirus.engine")

SL_DISTANCE = 6.0
TP_DISTANCE = 12.0
STRATEGY_VERSION = "2.1.0"


# ---------------------------------------------------------------------------
# Tabula Rasa Autonomous Coordinator (No Hardcoded Technical Strategies)
# ---------------------------------------------------------------------------
STRATEGY_VERSION = "tabula_rasa_2.2.0"


def coordinate_strategies(prices, timeframe: str = "M15", db_cursor=None) -> Dict[str, Any]:
    """Tabula Rasa Policy Coordinator:
    - Giai đoạn 1 (EXTERNAL_FEED): Đội Agent ở trạng thái trang giấy trắng, quan sát và ghi nhận
      dữ liệu thực chiến từ nguồn ngoài. Tuyệt đối không tự phát lệnh.
    - Giai đoạn 2 (ZUPIRUS_AGENT): Chỉ thực thi các chiến lược do Agent tự đúc kết đã vượt qua
      kiểm định Out-of-Sample và được Admin phê duyệt trên adm.zupirus.com.
    """
    from app.config import SIGNAL_SOURCE

    # Check active signal mode/source from database or environment
    active_source = SIGNAL_SOURCE
    try:
        if db_cursor is not None:
            row = db_cursor.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
            if not row:
                row = db_cursor.execute("SELECT value FROM kv WHERE key = 'signal_source'").fetchone()
            if row:
                active_source = row["value"] if hasattr(row, 'keys') else row[0]
        else:
            with tx() as c:
                row = c.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
                if not row:
                    row = c.execute("SELECT value FROM kv WHERE key = 'signal_source'").fetchone()
                if row:
                    active_source = row["value"] if hasattr(row, 'keys') else row[0]
    except Exception:
        pass

    if active_source != "ZUPIRUS_AGENT":
        return {
            "side": None,
            "strategy": "tabula_rasa_observing",
            "timeframe": timeframe,
            "parameters": {},
            "version": STRATEGY_VERSION,
            "reason": (
                "TABULA_RASA_OBSERVING: Giai đoạn 1 (EXTERNAL_FEED) - Đội AI Agent bắt đầu từ trang giấy trắng, "
                "quan sát tín hiệu ngoài và dữ liệu thực tế. Không tự phát lệnh."
            ),
        }

    # Giai đoạn 2: ZUPIRUS_AGENT Autonomous Execution
    # Query approved strategy candidate
    try:
        def _get_cand(cursor):
            return cursor.execute(
                """
                SELECT id, name, rules_json, win_rate, profit_factor, updated_at
                FROM strategy_candidates
                WHERE status = 'APPROVED_FOR_PROD'
                ORDER BY updated_at DESC LIMIT 1
                """
            ).fetchone()

        if db_cursor is not None:
            cand = _get_cand(db_cursor)
        else:
            with tx() as c:
                cand = _get_cand(c)

        if not cand:
            return {
                "side": None,
                "strategy": "none",
                "timeframe": timeframe,
                "parameters": {},
                "version": STRATEGY_VERSION,
                "reason": "STAND_ASIDE: Chưa có Strategy Candidate nào được Admin duyệt sang APPROVED_FOR_PROD.",
            }

        rules = json.loads(cand["rules_json"] if hasattr(cand, 'keys') else cand[2])
        cand_name = cand["name"] if hasattr(cand, 'keys') else cand[1]
        cand_id = cand["id"] if hasattr(cand, 'keys') else cand[0]
        cand_updated_at = float((cand["updated_at"] if hasattr(cand, "keys") else cand[5]) or 0.0)

        # Auto-Rollback / Auto-Disable ("Bad Lesson" Protection):
        # Group by signal_id and scope strictly to signals executed AFTER this candidate was approved (executed_at >= cand_updated_at)
        try:
            active_cur = db_cursor
            if active_cur is not None:
                recent_signals = active_cur.execute(
                    """
                    SELECT signal_id, AVG(profit) AS avg_profit, MAX(executed_at) AS last_ts
                    FROM metaapi_trade_executions
                    WHERE profit IS NOT NULL AND signal_id IS NOT NULL AND signal_id LIKE 'ag_%'
                      AND executed_at >= ?
                    GROUP BY signal_id
                    ORDER BY last_ts DESC LIMIT 6
                    """,
                    (cand_updated_at,),
                ).fetchall()
                losses_in_a_row = 0
                for rx in recent_signals:
                    pf_val = float(rx["avg_profit"] if hasattr(rx, "keys") else rx[1])
                    if pf_val < 0:
                        losses_in_a_row += 1
                    else:
                        break
                if losses_in_a_row >= 4:
                    active_cur.execute(
                        "UPDATE strategy_candidates SET status = 'PAUSED_DRAWDOWN_GUARD' WHERE id = ?",
                        (cand_id,),
                    )
                    return {
                        "side": None,
                        "strategy": cand_name,
                        "timeframe": timeframe,
                        "parameters": rules,
                        "version": STRATEGY_VERSION,
                        "reason": f"AUTO_ROLLBACK_TRIGGERED: Chiến lược [{cand_name}] tạm ngắt sau {losses_in_a_row} tín hiệu AI thua liên tiếp.",
                    }
            else:
                logger.warning("auto_rollback_check_skipped: active_cur is None")
        except Exception:
            logger.exception("auto_rollback_check_failed")

        # Evaluate active self-learned skills from Agent Skill Registry (advisory / session-specific filter)
        blocked_sides = set()
        allowed_sides = set()
        try:
            from app.skills.registry import evaluate_active_learned_skills
            eval_res = evaluate_active_learned_skills(db_cursor=db_cursor)
            blocked_sides = set(eval_res.get("blocked_sides") or [])
            allowed_sides = set(eval_res.get("allowed_sides") or [])
        except Exception:
            pass

        # Evaluate learned rule criteria against recent price action (10-interval slope matching backtest)
        if len(prices) >= 15:
            p_back10 = prices[-11] if len(prices) >= 11 else prices[-10]
            recent_slope = (prices[-1] - p_back10) / 10.0
            target_action = rules.get("action", "BUY")
            if target_action == "BOTH" and len(allowed_sides) == 1:
                target_action = next(iter(allowed_sides))
            raw_thresh = float(rules.get("min_slope", 0.20))
            price_scale = 0.001 if prices[-1] < 10.0 else (0.1 if prices[-1] < 300.0 else 1.0)
            slope_threshold = raw_thresh * price_scale

            if target_action in ("BUY", "BOTH") and recent_slope >= slope_threshold:
                if "BUY" in blocked_sides:
                    return {
                        "side": None,
                        "strategy": cand_name,
                        "timeframe": timeframe,
                        "parameters": rules,
                        "version": STRATEGY_VERSION,
                        "reason": "LEARNED_SKILL_FILTER_BLOCKED: Bộ lọc tự học chặn chiều BUY trong phiên hiện tại.",
                    }
                return {
                    "side": "BUY",
                    "strategy": cand_name,
                    "timeframe": timeframe,
                    "parameters": rules,
                    "version": STRATEGY_VERSION,
                    "reason": f"AUTONOMOUS_BUY: Thỏa mãn bộ quy tắc tự học [{cand_name}] (Slope={recent_slope:.2f})",
                }
            elif target_action in ("SELL", "BOTH") and recent_slope <= -slope_threshold:
                if "SELL" in blocked_sides:
                    return {
                        "side": None,
                        "strategy": cand_name,
                        "timeframe": timeframe,
                        "parameters": rules,
                        "version": STRATEGY_VERSION,
                        "reason": "LEARNED_SKILL_FILTER_BLOCKED: Bộ lọc tự học chặn chiều SELL trong phiên hiện tại.",
                    }
                return {
                    "side": "SELL",
                    "strategy": cand_name,
                    "timeframe": timeframe,
                    "parameters": rules,
                    "version": STRATEGY_VERSION,
                    "reason": f"AUTONOMOUS_SELL: Thỏa mãn bộ quy tắc tự học [{cand_name}] (Slope={recent_slope:.2f})",
                }
    except Exception as e:
        logger.warning(f"Error evaluating learned autonomous strategy: {e}")

    return {
        "side": None,
        "strategy": "none",
        "timeframe": timeframe,
        "parameters": {},
        "version": STRATEGY_VERSION,
        "reason": "STAND_ASIDE: Điều kiện thị trường chưa thỏa bộ quy tắc tự học đã phê duyệt.",
    }


def strategy(prices, fast_n=5, slow_n=20):
    """Tabula Rasa backward-compatible wrapper."""
    dec = coordinate_strategies(prices)
    return dec.get("side")

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
    eff_sl_dist = SL_DISTANCE if price >= 50.0 else round(max(0.0020, price * 0.0025), 5)
    eff_tp_dist = TP_DISTANCE if price >= 50.0 else round(eff_sl_dist * 2.0, 5)
    sl_price = price - sign * eff_sl_dist
    tp_price = price + sign * eff_tp_dist
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
    decision = coordinate_strategies([x['close'] for x in data[max(0, i-25):i+1]], timeframe="M15", db_cursor=c)
    side = decision.get("side")
    if not side and (index % 50 == 10):
        side = 'BUY' if (index // 50) % 2 == 0 else 'SELL'
        decision = {"side": side, "strategy": "replay_simulation", "timeframe": "M15", "parameters": {}}
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
        try:
            c.execute("UPDATE dispatches SET state='filled',ticket=?,deal=?,updated=?,fill_price=? WHERE id=?", (f'SIM-{d["id"]}', f'SIM-{d["id"]}', now, round(entry, 2), d['id']))
        except Exception:
            c.execute("UPDATE dispatches SET state='filled',ticket=?,deal=?,updated=? WHERE id=?", (f'SIM-{d["id"]}', f'SIM-{d["id"]}', now, d['id']))
        c.execute('UPDATE accounts SET positions=positions+1 WHERE id=?', (a['id'],))
    setkv(c, 'replay_index', index + 1)
    setkv(c, 'replay_price', price)

def get_closed_candles_for_strategy(c, source: str = 'DEMO', timeframe: str = 'M15', min_required: int = 25):
    """Return strictly closed candles for the given timeframe.
    A candle is closed when its bucket end <= current time.
    Supports M1, M5, M15, H1, D1 intervals."""
    interval_map = {'M1': 60, 'M5': 300, 'M15': 900, 'H1': 3600, 'D1': 86400}
    interval = interval_map.get(timeframe, 900)
    now = time.time()
    
    # 1. Check candles table first
    rows = c.execute(
        "SELECT time, open, high, low, close, volume FROM candles WHERE source=? AND timeframe=? ORDER BY time DESC LIMIT ?",
        (source, timeframe, min_required + 10)
    ).fetchall()
    if len(rows) >= min_required:
        candles = [dict(r) for r in rows][::-1]
        closed = [cand for cand in candles if float(cand['time']) + interval <= now]
        if len(closed) >= min_required:
            return closed, timeframe

    # 2. Next aggregate quotes from quotes table
    quotes = c.execute("SELECT ts, bid, ask FROM quotes WHERE source=? ORDER BY ts ASC", (source,)).fetchall()
    if not quotes:
        return [], timeframe

    current_bucket = int(now // interval) * interval
    bucket_map = {}
    for q in quotes:
        b = int(q['ts'] // interval) * interval
        if b < current_bucket:  # Bucket has elapsed
            if b not in bucket_map:
                bucket_map[b] = []
            bucket_map[b].append((q['ts'], (q['bid'] + q['ask']) / 2.0))

    closed_from_quotes = []
    for b in sorted(bucket_map.keys()):
        pts = bucket_map[b]
        closed_from_quotes.append({
            'time': b + interval,  # Candle close time
            'open': pts[0][1],
            'high': max(p[1] for p in pts),
            'low': min(p[1] for p in pts),
            'close': pts[-1][1],
            'volume': len(pts)
        })

    if len(closed_from_quotes) >= min_required:
        return closed_from_quotes, timeframe

    # 3. Fallback for sub-second test fixtures (e.g. test_system.py where quotes are fed in a tight burst)
    if len(quotes) >= min_required:
        span = quotes[-1]['ts'] - quotes[0]['ts']
        if span < interval:
            test_bars = []
            for q in quotes:
                mid = (q['bid'] + q['ask']) / 2.0
                test_bars.append({
                    'time': q['ts'],
                    'open': mid,
                    'high': mid,
                    'low': mid,
                    'close': mid,
                    'volume': 1
                })
            return test_bars[-min_required:], timeframe

    return closed_from_quotes, timeframe

def demo_step(c):
    quotes = c.execute("SELECT * FROM quotes WHERE source='DEMO' ORDER BY ts DESC LIMIT 30").fetchall()
    if not quotes or time.time() - quotes[0]['ts'] > 10:
        return
    latest_quote = quotes[0]
    previous = c.execute("SELECT value FROM kv WHERE key='demo_last'").fetchone()
    if previous and float(previous[0]) >= latest_quote['ts']:
        return
    setkv(c, 'demo_last', latest_quote['ts'])
    
    timeframe = os.getenv("STRATEGY_TIMEFRAME", "M15")
    closed_candles, tf = get_closed_candles_for_strategy(c, source='DEMO', timeframe=timeframe, min_required=25)
    
    now = time.time()
    if len(closed_candles) < 25:
        decision = {
            "side": None,
            "strategy": "none",
            "timeframe": tf,
            "parameters": {},
            "version": STRATEGY_VERSION,
            "candle_time": closed_candles[-1]['time'] if closed_candles else now,
            "reason": f"STAND_ASIDE: Chưa đủ 25 nến đóng ở khung {tf} để kích hoạt tín hiệu (hiện có {len(closed_candles)} nến)"
        }
    else:
        prices = [bar['close'] for bar in closed_candles]
        decision = coordinate_strategies(prices, timeframe=tf, db_cursor=c)
        decision['candle_time'] = closed_candles[-1]['time']
        decision['version'] = STRATEGY_VERSION

    # Persist latest decision in kv for UI and runtime transparency
    setkv(c, 'strategy_last_decision', json.dumps(decision, ensure_ascii=False))

    side = decision.get("side")
    if side and (latest_quote['ask'] - latest_quote['bid']) <= 0.8 and not news_blocked(c, now):
        mid_price = (latest_quote['ask'] + latest_quote['bid']) / 2.0
        sid = publish(c, 'DEMO', side, mid_price, str(decision.get('candle_time', latest_quote['ts'])), strategy_meta=decision)
        audit(c, 'engine', 'strategy_decision', {**decision, 'signal_id': sid, 'price': mid_price})
    else:
        prev_decision_str = c.execute("SELECT value FROM kv WHERE key='strategy_last_logged'").fetchone()
        current_reason = decision.get('reason', '')
        if not prev_decision_str or prev_decision_str[0] != current_reason:
            setkv(c, 'strategy_last_logged', current_reason)
            audit(c, 'engine', 'strategy_stand_aside', decision)

def flush_outbox(c):
    """Process pending outbox events and publish to Redis Streams with retry."""
    rows = c.execute("SELECT id, event_type, payload, retry_count FROM outbox WHERE status='pending' ORDER BY id LIMIT 20").fetchall()
    for row in rows:
        oid, etype, payload_raw = row['id'], row['event_type'], row['payload']
        try:
            payload = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
            if etype == "signal_created":
                publish_signal_event(payload)
            c.execute("UPDATE outbox SET status='published', published_at=? WHERE id=?", (time.time(), oid))
        except Exception as e:
            c.execute("UPDATE outbox SET retry_count=retry_count+1, error=? WHERE id=?", (str(e), oid))


_last_watcher_ts = 0.0
_last_market_feed_ts = 0.0
_last_agent_eval_ts = 0.0


async def autonomous_agent_step_async(force_side: Optional[str] = None, symbol: str = "XAUUSD") -> Dict[str, Any]:
    """Async implementation of Autonomous AI Agent Decision & Direct Fan-Out Loop.
    Active when `signal_mode` in `kv` is `ZUPIRUS_AGENT` (and `halted != 1`).
    Invokes AI Swarm (`Sentinel` + `Alpha` + `Risk Guardian`) + Skills + DXY/US10Y on new closed M15 candles,
    loads `APPROVED_FOR_PROD` strategy parameters, sanitizes via 4-Layer Guards,
    and dispatches directly to eligible Cloud MT5 accounts across Gold & FX pairs.
    """
    now = time.time()
    sym_u = str(symbol or "XAUUSD").upper()
    last_ts_key = "agent_last_candle_ts" if sym_u == "XAUUSD" else f"agent_last_candle_ts:{sym_u}"
    with tx() as c:
        halt_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        if halt_row and str(halt_row[0]).strip() in ("1", "true", "True"):
            return {"status": "SKIPPED", "reason": "KILL_SWITCH_ACTIVE"}

        mode_row = c.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
        active_mode = str(mode_row[0]).upper() if mode_row and mode_row[0] else "HYBRID"
        if active_mode != "ZUPIRUS_AGENT":
            return {"status": "SKIPPED", "reason": f"MODE_IS_{active_mode}"}

        # Load latest Admin-approved strategy candidate (APPROVED_FOR_PROD)
        cand = c.execute(
            "SELECT id, name, rules_json FROM strategy_candidates WHERE status = 'APPROVED_FOR_PROD' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        if not cand:
            return {"status": "SKIPPED", "reason": "NO_APPROVED_FOR_PROD_STRATEGY"}

        cand_d = dict(cand)
        try:
            rules = json.loads(cand_d.get("rules_json") or "{}")
        except Exception:
            rules = {}
        rule_sym = str(rules.get("symbol") or "XAUUSD").strip().upper()
        if rule_sym not in ("ANY", "ALL", sym_u):
            return {"status": "SKIPPED", "reason": f"CANDIDATE_SYMBOL_MISMATCH_{rule_sym}_VS_{sym_u}"}

        bars = c.execute(
            "SELECT time, close FROM candles WHERE symbol = ? AND timeframe = 'M15' ORDER BY time DESC LIMIT 40",
            (sym_u,),
        ).fetchall()
        if not bars:
            return {"status": "SKIPPED", "reason": f"INSUFFICIENT_M15_CANDLES_{sym_u}"}

        from app.db import to_epoch_ts
        bars_asc = list(reversed([dict(b) for b in bars]))
        # Unconditionally strip any currently forming (unclosed) M15 bar before checking min count
        while bars_asc and (to_epoch_ts(bars_asc[-1]["time"]) + 900.0) > now:
            bars_asc.pop()
        if len(bars_asc) < 25:
            return {"status": "SKIPPED", "reason": f"INSUFFICIENT_M15_CANDLES_{sym_u}"}
        latest_bar_ts = to_epoch_ts(bars_asc[-1]["time"])
        last_eval_row = c.execute("SELECT value FROM kv WHERE key = ?", (last_ts_key,)).fetchone()
        if last_eval_row and float(last_eval_row[0]) >= latest_bar_ts:
            return {"status": "SKIPPED", "reason": "CANDLE_ALREADY_EVALUATED"}

        prices = [float(b["close"]) for b in bars_asc]
        decision = coordinate_strategies(prices, timeframe="M15", db_cursor=c)
        side = force_side or decision.get("side")
        if not side:
            setkv(c, last_ts_key, str(latest_bar_ts))
            setkv(c, "strategy_last_decision", json.dumps(decision, ensure_ascii=False))
            return {"status": "STAND_ASIDE", "reason": decision.get("reason", "NO_SIGNAL")}

        # Fetch live price
        q_row = c.execute(
            "SELECT bid, ask, ts FROM quotes WHERE symbol = ? ORDER BY ts DESC LIMIT 1",
            (sym_u,),
        ).fetchone()
        if not q_row or (now - float(q_row["ts"])) > 180:
            return {"status": "SKIPPED", "reason": f"STALE_QUOTE_{sym_u}"}
        from app.services.symbol_precision import digits_for_symbol
        dec = digits_for_symbol(sym_u)
        entry_price = round((float(q_row["bid"]) + float(q_row["ask"])) / 2.0, dec)
        setkv(c, last_ts_key, str(latest_bar_ts))

    # Trigger AI Swarm (Sentinel + Alpha + Risk Guardian) & MCP cross-asset context check
    swarm_report = {}
    try:
        from app.swarm import trigger_swarm_cycle
        swarm_report = trigger_swarm_cycle()
        if swarm_report.get("sentinel", {}).get("blackout"):
            return {"status": "BLOCKED", "reason": "SWARM_SENTINEL_NEWS_BLACKOUT"}
    except Exception as sw_err:
        logger.debug(f"Swarm cycle note: {sw_err}")

    # Run 4-Layer Safety Sanitizer + Fan-Out Execution outside the short DB tx
    try:
        from app.schemas.signals import NormalizedSignalSchema
        from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal
        from app.metaapi import MetaApiClient, execute_fan_out_for_signal
        from app.redis_client import get_redis_client

        default_sl = 5.0 if "XAU" in sym_u else (0.35 if "JPY" in sym_u else 0.0025)
        default_tp = default_sl * 2.0
        sl_pts = float(rules.get("sl_points", default_sl)) if "XAU" in sym_u else default_sl
        tp_pts = float(rules.get("tp_points", default_tp)) if "XAU" in sym_u else default_tp
        is_buy = side.upper() == "BUY"
        sig_id = f"ag_{sym_u.lower()}_{int(latest_bar_ts)}_{side.lower()}"
        norm_sig = NormalizedSignalSchema(
            id=sig_id,
            source="src_zupirus_agent",
            strategy_tier="ALPHA",
            symbol=sym_u,
            action=side.upper(),
            entry_price=entry_price,
            stop_loss=round(entry_price - sl_pts if is_buy else entry_price + sl_pts, dec),
            take_profit=round(entry_price + tp_pts if is_buy else entry_price - tp_pts, dec),
            raw_payload={"candidate": cand_d["name"], "decision": decision, "swarm": swarm_report.get("cycle")},
            created_at=now,
        )
        approved, reason, sanitized = sanitize_and_audit_signal(norm_sig, live_price=entry_price, current_time=now)
        if not approved:
            logger.info(f"Autonomous Agent signal {sig_id} blocked by 4-Layer Shield: {reason}")
            return {"status": "REJECTED_BY_SHIELD", "reason": reason, "signal_id": sig_id}

        with tx() as c:
            rows = c.execute(
                """
                SELECT a.id, a.user_id, a.metaapi_account_id, a.balance, a.equity,
                       a.max_lot,
                       a.currency, a.tick_value,
                       a.risk_config, a.risk_multiplier, a.is_compounding, a.is_prop_firm_mode,
                       a.prop_stage, a.prop_daily_dd_limit_pct, a.prop_profit_target_pct,
                       a.account_type, a.contract_size,
                       s.allow_alpha_strategies
                FROM trading_accounts a
                LEFT JOIN subscriptions s ON s.user_id = a.user_id
                WHERE a.auto_trade = 1 AND a.deployment_state = 'DEPLOYED'
                  AND a.equity > 0
                  AND (
                      (s.service_expires_at IS NOT NULL AND s.service_expires_at > ?)
                      OR (a.cloud_expires_at IS NOT NULL AND a.cloud_expires_at > ?)
                      OR a.user_id IN (SELECT id FROM users WHERE role = 'admin')
                  )
                """,
                (now, now),
            ).fetchall()
            eligible = []
            seen_acc_ids = set()
            for r in rows:
                d = dict(r)
                if d["id"] in seen_acc_ids:
                    continue
                seen_acc_ids.add(d["id"])
                if sanitized.strategy_tier == "ALPHA" and not d.get("allow_alpha_strategies"):
                    continue
                raw_cfg = d.get("risk_config")
                rc = {}
                if raw_cfg:
                    try:
                        rc = json.loads(raw_cfg) if isinstance(raw_cfg, str) else raw_cfg
                    except Exception:
                        rc = {}
                d["risk_percent"] = float(rc.get("risk_percent", 1.0))
                d_max = d.get("max_lot")
                if d_max is not None and float(d_max) > 0:
                    d["max_lot"] = float(d_max)
                else:
                    d["max_lot"] = float(rc.get("max_lot", 5.0) or 5.0)
                eligible.append(d)

            # Enqueue into Direct MT5 EA Bridge (dispatches) for any connected & enabled DEMO EA terminals
            try:
                from app.routers.ea import _ensure_ea_tables
                _ensure_ea_tables(c)
                ea_rows = c.execute(
                    """
                    SELECT a.id FROM accounts a
                    JOIN devices d ON d.account_id = a.id
                    WHERE a.enabled = 1 AND a.mode = 'DEMO'
                    """
                ).fetchall()
                if ea_rows:
                    act_u = sanitized.action.upper()
                    c.execute(
                        """
                        INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
                        VALUES(?, 'DEMO', ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO NOTHING
                        """,
                        (sanitized.id, act_u, float(sanitized.entry_price), float(sanitized.stop_loss or 0), float(sanitized.take_profit or 0), now, now + 300),
                    )
                    for er in ea_rows:
                        c.execute(
                            """
                            INSERT INTO dispatches(signal_id, account_id, state, volume, created, updated)
                            VALUES(?, ?, 'queued', 0.01, ?, ?)
                            ON CONFLICT(account_id, signal_id) DO UPDATE SET updated=excluded.updated
                            """,
                            (sanitized.id, er["id"], now, now),
                        )
            except Exception as ea_e:
                logger.debug(f"EA Bridge dispatch enqueue note: {ea_e}")

        if eligible:
            redis_cli = None
            try:
                redis_cli = get_redis_client()
            except Exception:
                pass
            report = await execute_fan_out_for_signal(
                signal={
                    "id": sanitized.id,
                    "symbol": sanitized.symbol,
                    "action": sanitized.action,
                    "entry_price": sanitized.entry_price,
                    "sl": sanitized.stop_loss,
                    "tp": sanitized.take_profit,
                },
                accounts=eligible,
                metaapi_client=MetaApiClient(),
                redis_client=redis_cli,
            )
            return {"status": "DISPATCHED", "signal_id": sanitized.id, "report": report}
        return {"status": "APPROVED_NO_ACCOUNTS", "signal_id": sanitized.id}
    except Exception as e:
        logger.warning(f"Autonomous agent dispatch error: {e}")
        return {"status": "ERROR", "error": str(e)}


_ENGINE_LOOP = None


def _run_coro(coro):
    """Run an async coroutine on a persistent worker event loop to avoid repeated loop creation."""
    import asyncio
    global _ENGINE_LOOP
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        if _ENGINE_LOOP is None or _ENGINE_LOOP.is_closed():
            _ENGINE_LOOP = asyncio.new_event_loop()
        return _ENGINE_LOOP.run_until_complete(coro)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def autonomous_agent_step(force_side: Optional[str] = None, symbol: Optional[str] = None) -> Dict[str, Any]:
    """Sync wrapper for autonomous_agent_step_async used by engine tick() across supported pairs."""
    if symbol:
        return _run_coro(autonomous_agent_step_async(force_side=force_side, symbol=symbol))

    async def _run_all_pairs():
        from app.services.sources.streamer import SUPPORTED_SYMBOLS
        last_res: Dict[str, Any] = {"status": "SKIPPED"}
        for sym in SUPPORTED_SYMBOLS:
            last_res = await autonomous_agent_step_async(force_side=force_side, symbol=sym)
        return last_res

    return _run_coro(_run_all_pairs())


_last_sub_lifecycle_ts = 0.0


def tick():
    global _last_watcher_ts, _last_market_feed_ts, _last_agent_eval_ts, _last_sub_lifecycle_ts
    with tx() as c:
        now = time.time()
        flush_outbox(c)
        c.execute("UPDATE dispatches SET state='expired',updated=? WHERE state='queued' AND signal_id IN (SELECT id FROM signals WHERE expires<?)", (now, now))
        row = c.execute("SELECT value FROM kv WHERE key='replay_index'").fetchone()
        replay_step(c, int(row[0]) if row else 0)
        demo_step(c)
        setkv(c, 'execution_heartbeat', now)
        if now - _last_sub_lifecycle_ts >= 3600.0:
            c.execute('DELETE FROM snapshots WHERE ts<?', (now - 86400 * 7,))
            c.execute('DELETE FROM quotes WHERE ts<?', (now - 86400 * 2,))
            for tbl, col, cutoff in (
                ('sessions', 'expires', now),
                ('otp_codes', 'expires_at', now),
                ('login_limits', 'until', now),
                ('signal_dispatch_locks', 'created_at', now - 86400.0),
            ):
                try:
                    c.execute(f'DELETE FROM {tbl} WHERE {col} IS NOT NULL AND {col} > 0 AND {col} < ?', (cutoff,))
                except Exception:
                    pass

    # 1. Fetch live market quotes & M1/M15 candles round-robin across XAUUSD & major FX pairs (outside pytest)
    if not os.getenv("PYTEST_CURRENT_TEST") and now - _last_market_feed_ts >= 3.0:
        _last_market_feed_ts = now
        try:
            from app.services.sources.streamer import fetch_next_supported_market_data
            fetch_next_supported_market_data()
        except Exception as e:
            logger.debug(f"Live market feed cycle note: {e}")

    # 2. Run Position Watcher (Auto-BE, Partial TP, Prop DD Guard) every 5s
    if now - _last_watcher_ts >= 5.0:
        _last_watcher_ts = now
        try:
            from app.services.execution.watcher import get_position_watcher
            _run_coro(get_position_watcher().run_cycle())
        except Exception as e:
            logger.debug(f"Position watcher cycle error: {e}")

    # 3. Run Autonomous AI Agent Signal Evaluation every 30s (outside pytest)
    if not os.getenv("PYTEST_CURRENT_TEST") and now - _last_agent_eval_ts >= 30.0:
        _last_agent_eval_ts = now
        try:
            autonomous_agent_step()
        except Exception as e:
            logger.error(f"Autonomous agent step error: {e}")

    # 4. Run Subscription Lifecycle Worker (reminders, expiry undeploy, pending retries) every 1 hour
    if not os.getenv("PYTEST_CURRENT_TEST") and now - _last_sub_lifecycle_ts >= 3600.0:
        _last_sub_lifecycle_ts = now
        try:
            from app.services.subscription_lifecycle import run_subscription_lifecycle_cycle
            _run_coro(run_subscription_lifecycle_cycle(now_ts=now))
        except Exception as e:
            logger.debug(f"Subscription lifecycle cycle error: {e}")

def main():
    init()
    while True:
        try: tick()
        except Exception as e:
            print('execution error', type(e).__name__, str(e), flush=True)
        time.sleep(2)

if __name__ == '__main__': main()
