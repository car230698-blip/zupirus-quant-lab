import time, secrets, logging
from typing import Literal, List, Any, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.db import tx, audit, getkv, setkv
from app.tracing import get_trace_summary
from app.routers.deps import Model, fail, get_current_admin

logger = logging.getLogger("zupirus.api")
router = APIRouter()

@router.get('/api/admin/orders', tags=["admin-core"])
def admin_orders(
    u=Depends(get_current_admin),
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

@router.get('/api/admin/monitor', tags=["admin-core"])
def monitor(u=Depends(get_current_admin)):
    with tx() as c:
        accs = []
        try:
            cloud_accs = [dict(r) for r in c.execute('SELECT t.*, u.email FROM trading_accounts t JOIN users u ON u.id=t.user_id')]
            for ca in cloud_accs:
                ca.pop('encrypted_master_password', None)
                ca.pop('password', None)
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
@router.post('/api/admin/safety', tags=["admin-core"])
def safety(p: Safety, u=Depends(get_current_admin)):
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

@router.post('/api/admin/research', tags=["admin-override"])
def start_research(u=Depends(get_current_admin)):
    jid = secrets.token_hex(16)
    with tx() as c:
        c.execute('INSERT INTO jobs(id,state,created) VALUES(?,?,?)', (jid, 'queued', time.time()))
        audit(c, u['id'], 'research_requested', {'job': jid})
    return {'id': jid}

class Decision(Model): approved: bool
@router.post('/api/admin/research/{jid}/decision', tags=["admin-core"])
def decision(jid: str, p: Decision, u=Depends(get_current_admin)):
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

@router.post('/api/admin/news', tags=["admin-override"])
def add_news(p: News, u=Depends(get_current_admin)):
    with tx() as c:
        nid = secrets.token_hex(12)
        c.execute('INSERT INTO news VALUES(?,?,?,?,?)', (nid, p.title, p.currency, p.impact, p.ts))
        audit(c, u['id'], 'calendar_added', {'id': nid, **p.model_dump()})
    return {'ok': True, 'id': nid}

@router.put('/api/admin/news/{nid}', tags=["admin-override"])
def update_news(nid: str, p: News, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM news WHERE id=?', (nid,)).fetchone()
        if not row: fail(404, 'News event not found')
        c.execute('UPDATE news SET title=?, currency=?, impact=?, ts=? WHERE id=?', (p.title, p.currency, p.impact, p.ts, nid))
        audit(c, u['id'], 'calendar_updated', {'id': nid, **p.model_dump()})
    return {'ok': True}

@router.delete('/api/admin/news/{nid}', tags=["admin-override"])
def delete_news(nid: str, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM news WHERE id=?', (nid,)).fetchone()
        if not row: fail(404, 'News event not found')
        c.execute('DELETE FROM news WHERE id=?', (nid,))
        audit(c, u['id'], 'calendar_deleted', {'id': nid, 'title': row['title'], 'ts': row['ts']})
    return {'ok': True}

@router.post('/api/admin/news/sync', tags=["admin-override"])
def sync_news(u=Depends(get_current_admin)):
    """Automatically synchronizes high impact economic events from financial calendar feeds."""
    from app.calendar_sync import sync_economic_calendar
    with tx() as c:
        added, existing = sync_economic_calendar(c)
        audit(c, u['id'], 'calendar_synced', {'added': added, 'existing': existing})
    return {'ok': True, 'added': added, 'existing': existing}


class AddGeminiKey(Model):
    key: str = Field(min_length=20, max_length=150)

class TestGeminiPrompt(Model):
    prompt: str = Field(min_length=1, max_length=1000)

@router.get('/api/admin/gemini/keys', tags=["admin-core"])
def list_gemini_keys(u=Depends(get_current_admin)):
    from app.gemini_client import seed_default_keys
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

@router.post('/api/admin/gemini/keys', tags=["admin-core"])
def add_gemini_key(p: AddGeminiKey, u=Depends(get_current_admin)):
    from app.gemini_client import hash_key, mask_key
    from app.security import encrypt_secret
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

@router.put('/api/admin/gemini/keys/{kid}/toggle', tags=["admin-core"])
def toggle_gemini_key(kid: str, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT id, is_active, key_masked FROM gemini_keys WHERE id=?', (kid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy API Key')
        next_active = 0 if row[1] == 1 else 1
        c.execute('UPDATE gemini_keys SET is_active=? WHERE id=?', (next_active, kid))
        audit(c, u['id'], 'gemini_key_toggled', {'id': kid, 'masked': row[2], 'is_active': bool(next_active)})
    return {'ok': True, 'is_active': bool(next_active)}

@router.delete('/api/admin/gemini/keys/{kid}', tags=["admin-core"])
def delete_gemini_key(kid: str, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT id, key_masked FROM gemini_keys WHERE id=?', (kid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy API Key')
        c.execute('DELETE FROM gemini_keys WHERE id=?', (kid,))
        audit(c, u['id'], 'gemini_key_deleted', {'id': kid, 'masked': row[1]})
    return {'ok': True}

@router.post('/api/admin/gemini/keys/ping-all', tags=["admin-override"])
def ping_all_gemini_keys(u=Depends(get_current_admin)):
    """Pings every Gemini API key in the pool individually to verify health, latency and quota."""
    from app.gemini_client import ping_single_key
    with tx() as c:
        rows = c.execute("SELECT id, key_masked, key_cipher, is_active FROM gemini_keys ORDER BY created ASC").fetchall()
    
    results = []
    active_count = 0
    now = time.time()
    for r in rows:
        kid = r[0]
        masked = r[1]
        cipher = r[2]
        is_active = bool(r[3])
        if not is_active:
            results.append({
                "id": kid,
                "key_masked": masked,
                "is_active": False,
                "status": "disabled",
                "message": "Đang tạm tắt",
                "latency_ms": 0,
            })
            continue

        res = ping_single_key(cipher)
        st = res.get("status", "error")
        if res.get("ok"):
            active_count += 1

        with tx() as c:
            c.execute(
                "UPDATE gemini_keys SET status = ?, last_used = ? WHERE id = ?",
                (st, now, kid)
            )

        results.append({
            "id": kid,
            "key_masked": masked,
            "is_active": True,
            "status": st,
            "message": res.get("message", "N/A"),
            "latency_ms": res.get("latency_ms", 0),
            "ok": bool(res.get("ok")),
        })

    return {
        "ok": True,
        "total": len(rows),
        "active_healthy": active_count,
        "keys": results,
        "message": f"Đã kiểm tra {len(rows)} Gemini API Key ({active_count} key hoạt động tốt).",
    }


@router.post('/api/admin/gemini/keys/{kid}/ping', tags=["admin-override"])
def ping_single_gemini_key_endpoint(kid: str, u=Depends(get_current_admin)):
    """Pings a specific Gemini key to verify its current live connectivity."""
    from app.gemini_client import ping_single_key
    with tx() as c:
        row = c.execute("SELECT id, key_masked, key_cipher, is_active FROM gemini_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        fail(404, "Không tìm thấy API Key")

    res = ping_single_key(row[2])
    st = res.get("status", "error")
    now = time.time()
    with tx() as c:
        c.execute("UPDATE gemini_keys SET status = ?, last_used = ? WHERE id = ?", (st, now, kid))

    return {
        "ok": bool(res.get("ok")),
        "id": kid,
        "key_masked": row[1],
        "status": st,
        "message": res.get("message"),
        "latency_ms": res.get("latency_ms", 0),
    }


@router.post('/api/admin/gemini/test', tags=["admin-override"])
def test_gemini(p: TestGeminiPrompt, u=Depends(get_current_admin)):
    from app.gemini_client import call_gemini
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

@router.get('/api/admin/memory', tags=["admin-override"])
def get_hindsight_memories(category: Optional[str] = None, q: Optional[str] = None, limit: int = 50, u=Depends(get_current_admin)):
    from app.hindsight import recall_memories
    with tx() as c:
        items = recall_memories(c, query=q, category=category, limit=min(limit, 100))
    return {'memories': items, 'total': len(items)}

@router.post('/api/admin/memory', tags=["admin-override"])
def add_hindsight_memory(p: CreateMemory, u=Depends(get_current_admin)):
    from app.hindsight import store_memory
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

@router.delete('/api/admin/memory/{mid}', tags=["admin-override"])
def delete_hindsight_memory(mid: str, u=Depends(get_current_admin)):
    with tx() as c:
        c.execute('DELETE FROM hindsight_memories WHERE id=?', (mid,))
        audit(c, u['id'], 'memory_deleted', {'id': mid})
    return {'ok': True}

@router.get('/api/admin/tracing', tags=["admin-core"])
def tracing_telemetry(u=Depends(get_current_admin)):
    """Return LangSmith tracing summary and recent trace events."""
    return get_trace_summary()

@router.get('/api/admin/swarm/status', tags=["admin-core"])
def swarm_status(u=Depends(get_current_admin)):
    """Returns real-time status of the 3 Autonomous Agents (Sentinel, Alpha, Risk Guardian)
    and their shared communication stream."""
    from app.swarm import get_swarm_status
    return get_swarm_status()

@router.post('/api/admin/swarm/cycle', tags=["admin-override"])
def swarm_trigger_cycle(u=Depends(get_current_admin)):
    """Triggers an autonomous coordination sweep across all 3 agents."""
    from app.swarm import trigger_swarm_cycle
    return trigger_swarm_cycle()

class MailerTestPayload(BaseModel):
    to: str = Field(min_length=5, max_length=120)

@router.get('/api/admin/mailer/status', tags=["admin-core"])
def mailer_status(u=Depends(get_current_admin)):
    """Returns Resend connection status, sender identity, and verified domain."""
    from app.mailer import get_resend_api_key, get_email_from
    key = get_resend_api_key()
    return {
        'configured': bool(key),
        'key_masked': f"{key[:7]}...{key[-4:]}" if len(key) > 12 else None,
        'sender': get_email_from(),
        'verified_domain': 'zupirus.com',
        'provider': 'Resend (Tokyo ap-northeast-1)',
    }

@router.post('/api/admin/mailer/test', tags=["admin-override"])
def mailer_test_send(p: MailerTestPayload, u=Depends(get_current_admin)):
    """Sends a verified test email to the requested recipient."""
    from datetime import datetime, timezone
    import html as html_mod
    from app.mailer import send_resend_email
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    safe_to = html_mod.escape(str(p.to))
    html = f"""
    <div style="font-family:sans-serif;background:#0d1527;color:#f8fafc;padding:28px;border-radius:12px;border:1px solid #1e293b;max-width:540px;">
      <h2 style="color:#38bdf8;margin:0 0 12px;">ZUPIRUS Quant Lab</h2>
      <p style="color:#cbd5e1;font-size:14px;margin:0 0 16px;">Xin chào <strong>{safe_to}</strong>,</p>
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


@router.get('/api/admin/metrics', tags=["admin-core"])
def get_prometheus_metrics(_admin=Depends(get_current_admin)):
    """Exposes Prometheus plain-text metrics for external monitoring systems (Grafana / Prometheus)."""
    from fastapi.responses import PlainTextResponse
    with tx() as c:
        exec_count = c.execute("SELECT COUNT(*) FROM metaapi_trade_executions").fetchone()[0] or 0
        avg_lat = c.execute("SELECT AVG(latency_ms) FROM metaapi_trade_executions WHERE latency_ms > 0").fetchone()[0] or 24.0
        active_accs = c.execute("SELECT COUNT(*) FROM trading_accounts WHERE auto_trade = 1").fetchone()[0] or 0
        dd_halts = c.execute("SELECT COUNT(*) FROM kv WHERE key LIKE 'drawdown_locked:%'").fetchone()[0] or 0

    lines = [
        "# HELP zupirus_fanout_executions_total Total count of trade executions dispatched via cloud fanout",
        "# TYPE zupirus_fanout_executions_total counter",
        f"zupirus_fanout_executions_total {int(exec_count)}",
        "# HELP zupirus_fanout_latency_ms Average execution latency in milliseconds",
        "# TYPE zupirus_fanout_latency_ms gauge",
        f"zupirus_fanout_latency_ms {round(float(avg_lat), 2)}",
        "# HELP zupirus_accounts_active Number of active cloud trading accounts",
        "# TYPE zupirus_accounts_active gauge",
        f"zupirus_accounts_active {int(active_accs)}",
        "# HELP zupirus_active_drawdown_halts Number of accounts currently locked by drawdown guard",
        "# TYPE zupirus_active_drawdown_halts gauge",
        f"zupirus_active_drawdown_halts {int(dd_halts)}",
    ]
    return PlainTextResponse(content="\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")


