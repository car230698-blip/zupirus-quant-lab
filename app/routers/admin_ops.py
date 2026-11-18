import time, secrets, re, logging
from typing import Literal, List, Any, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.db import tx, audit, getkv, setkv
from app.security import password_hash
from app.tracing import get_trace_summary
from app.routers.deps import Model, fail, get_current_admin

logger = logging.getLogger("zupirus.api")
router = APIRouter()

@router.get('/api/admin/orders')
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

@router.get('/api/admin/monitor')
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
@router.post('/api/admin/safety')
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

@router.post('/api/admin/research')
def start_research(u=Depends(get_current_admin)):
    jid = secrets.token_hex(16)
    with tx() as c:
        c.execute('INSERT INTO jobs(id,state,created) VALUES(?,?,?)', (jid, 'queued', time.time()))
        audit(c, u['id'], 'research_requested', {'job': jid})
    return {'id': jid}

class Decision(Model): approved: bool
@router.post('/api/admin/research/{jid}/decision')
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

@router.post('/api/admin/news')
def add_news(p: News, u=Depends(get_current_admin)):
    with tx() as c:
        nid = secrets.token_hex(12)
        c.execute('INSERT INTO news VALUES(?,?,?,?,?)', (nid, p.title, p.currency, p.impact, p.ts))
        audit(c, u['id'], 'calendar_added', {'id': nid, **p.model_dump()})
    return {'ok': True, 'id': nid}

@router.put('/api/admin/news/{nid}')
def update_news(nid: str, p: News, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM news WHERE id=?', (nid,)).fetchone()
        if not row: fail(404, 'News event not found')
        c.execute('UPDATE news SET title=?, currency=?, impact=?, ts=? WHERE id=?', (p.title, p.currency, p.impact, p.ts, nid))
        audit(c, u['id'], 'calendar_updated', {'id': nid, **p.model_dump()})
    return {'ok': True}

@router.delete('/api/admin/news/{nid}')
def delete_news(nid: str, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT * FROM news WHERE id=?', (nid,)).fetchone()
        if not row: fail(404, 'News event not found')
        c.execute('DELETE FROM news WHERE id=?', (nid,))
        audit(c, u['id'], 'calendar_deleted', {'id': nid, 'title': row['title'], 'ts': row['ts']})
    return {'ok': True}

@router.post('/api/admin/news/sync')
def sync_news(u=Depends(get_current_admin)):
    """Automatically synchronizes high impact economic events from financial calendar feeds."""
    from app.calendar_sync import sync_economic_calendar
    with tx() as c:
        added, existing = sync_economic_calendar(c)
        audit(c, u['id'], 'calendar_synced', {'added': added, 'existing': existing})
    return {'ok': True, 'added': added, 'existing': existing}

class CreateUser(Model):
    email: str = Field(min_length=3, max_length=150)
    password: str = Field(min_length=8, max_length=128)
    role: Literal['customer', 'admin', 'user'] = 'customer'
    name: Optional[str] = None

class UpdateUserRole(Model):
    role: Literal['customer', 'admin', 'user']

class UpdateUserPassword(Model):
    password: str = Field(min_length=8, max_length=128)

@router.get('/api/admin/users')
def list_admin_users(u=Depends(get_current_admin)):
    with tx() as c:
        rows = c.execute("""
            SELECT u.id, u.email, u.role,
                   ((SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) +
                    (SELECT COUNT(*) FROM trading_accounts ta WHERE ta.user_id = u.id)) as accounts_count,
                   (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires > ?) as active_sessions
            FROM users u
            ORDER BY u.email ASC
        """, (time.time(),)).fetchall()
        users_list = []
        for r in rows:
            users_list.append({
                'id': r[0],
                'email': r[1],
                'role': r[2],
                'accounts_count': r[3],
                'active_sessions': r[4],
            })
    return {'users': users_list, 'total': len(users_list)}

@router.post('/api/admin/users')
def create_admin_user(p: CreateUser, u=Depends(get_current_admin)):
    email = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        fail(422, 'Email không hợp lệ')
    db_role = 'admin' if p.role == 'admin' else 'customer'
    with tx() as c:
        if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            fail(409, 'Email đã tồn tại')
        uid = f"usr_{secrets.token_hex(8)}"
        c.execute('INSERT INTO users VALUES(?,?,?,?)', (uid, email, password_hash(p.password), db_role))
        audit(c, u['id'], 'user_created', {'target_user_id': uid, 'email': email, 'role': db_role})
    return {'ok': True, 'id': uid, 'email': email, 'role': db_role}

@router.put('/api/admin/users/{target_uid}/role')
def update_user_role(target_uid: str, p: UpdateUserRole, u=Depends(get_current_admin)):
    db_role = 'admin' if p.role == 'admin' else 'customer'
    if target_uid == u['id'] and db_role != 'admin':
        fail(400, 'Không thể tự hạ quyền quản trị của chính mình')
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET role=? WHERE id=?', (db_role, target_uid))
        audit(c, u['id'], 'user_role_changed', {'target_user_id': target_uid, 'email': row[1], 'new_role': db_role})
    return {'ok': True}

@router.put('/api/admin/users/{target_uid}/password')
def reset_user_password(target_uid: str, p: UpdateUserPassword, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT id, email FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET password=? WHERE id=?', (password_hash(p.password), target_uid))
        c.execute('DELETE FROM sessions WHERE user_id=?', (target_uid,))
        audit(c, u['id'], 'user_password_reset', {'target_user_id': target_uid, 'email': row[1]})
    return {'ok': True}

@router.delete('/api/admin/users/{target_uid}')
async def delete_admin_user(target_uid: str, u=Depends(get_current_admin)):
    if target_uid == u['id']:
        fail(400, 'Không thể xóa tài khoản của chính mình')
    meta_ids_to_cleanup = set()
    user_email = ""
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        user_email = row[1]

        try:
            for r in c.execute('SELECT metaapi_account_id FROM trading_accounts WHERE user_id=?', (target_uid,)).fetchall():
                if r and r[0]:
                    meta_ids_to_cleanup.add(str(r[0]))
        except Exception:
            pass
        try:
            for r in c.execute('SELECT metaapi_account_id FROM metaapi_cloud_accounts WHERE user_id=?', (target_uid,)).fetchall():
                if r and r[0]:
                    meta_ids_to_cleanup.add(str(r[0]))
        except Exception:
            pass

    if meta_ids_to_cleanup:
        from app.metaapi import MetaApiClient
        client = MetaApiClient()
        for mid in meta_ids_to_cleanup:
            try:
                await client.undeploy_account(mid)
            except Exception as e:
                logger.warning(f"Failed to undeploy MetaApi account {mid} during user deletion: {e}")
            try:
                await client.delete_account(mid)
            except Exception as e:
                logger.warning(f"Failed to delete MetaApi account {mid} during user deletion: {e}")

    with tx() as c:
        # 1. Accounts belonging to user & their foreign key children
        acc_ids = [r[0] for r in c.execute('SELECT id FROM accounts WHERE user_id=?', (target_uid,)).fetchall()]
        for aid in acc_ids:
            for dep_t in ('snapshots', 'sim_positions', 'dispatches', 'metaapi_trade_executions', 'account_symbol_map'):
                try:
                    c.execute(f'DELETE FROM {dep_t} WHERE account_id=?', (aid,))
                except Exception:
                    pass
            c.execute('DELETE FROM accounts WHERE id=? AND user_id=?', (aid, target_uid))

        # 2. Cloud trading accounts & executions
        for dep_t in ('metaapi_trade_executions', 'account_symbol_map', 'signal_dispatch_locks'):
            try:
                c.execute(f'DELETE FROM {dep_t} WHERE account_id IN (SELECT id FROM trading_accounts WHERE user_id=?)', (target_uid,))
            except Exception:
                pass
        try:
            c.execute('DELETE FROM trading_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass
        try:
            c.execute('DELETE FROM metaapi_cloud_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass

        # 3. Real accounts
        try:
            c.execute('DELETE FROM real_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass

        # 4. User level records (orders, subscriptions, transactions, disclaimers, sessions, memories)
        for usr_t in ('orders', 'subscriptions', 'payment_transactions', 'legal_disclaimers', 'sessions', 'hindsight_memories'):
            try:
                c.execute(f'DELETE FROM {usr_t} WHERE user_id=?', (target_uid,))
            except Exception:
                pass

        # 5. Delete user record
        c.execute('DELETE FROM users WHERE id=?', (target_uid,))
        audit(c, u['id'], 'user_deleted', {'target_user_id': target_uid, 'email': user_email, 'cleaned_metaapi_ids': list(meta_ids_to_cleanup)})
    return {'ok': True, 'message': f'Đã xoá người dùng {user_email} thành công.'}

class AddGeminiKey(Model):
    key: str = Field(min_length=20, max_length=150)

class TestGeminiPrompt(Model):
    prompt: str = Field(min_length=1, max_length=1000)

@router.get('/api/admin/gemini/keys')
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

@router.post('/api/admin/gemini/keys')
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

@router.put('/api/admin/gemini/keys/{kid}/toggle')
def toggle_gemini_key(kid: str, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT id, is_active, key_masked FROM gemini_keys WHERE id=?', (kid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy API Key')
        next_active = 0 if row[1] == 1 else 1
        c.execute('UPDATE gemini_keys SET is_active=? WHERE id=?', (next_active, kid))
        audit(c, u['id'], 'gemini_key_toggled', {'id': kid, 'masked': row[2], 'is_active': bool(next_active)})
    return {'ok': True, 'is_active': bool(next_active)}

@router.delete('/api/admin/gemini/keys/{kid}')
def delete_gemini_key(kid: str, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute('SELECT id, key_masked FROM gemini_keys WHERE id=?', (kid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy API Key')
        c.execute('DELETE FROM gemini_keys WHERE id=?', (kid,))
        audit(c, u['id'], 'gemini_key_deleted', {'id': kid, 'masked': row[1]})
    return {'ok': True}

@router.post('/api/admin/gemini/test')
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

@router.get('/api/admin/memory')
def get_hindsight_memories(category: Optional[str] = None, q: Optional[str] = None, limit: int = 50, u=Depends(get_current_admin)):
    from app.hindsight import recall_memories
    with tx() as c:
        items = recall_memories(c, query=q, category=category, limit=min(limit, 100))
    return {'memories': items, 'total': len(items)}

@router.post('/api/admin/memory')
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

@router.delete('/api/admin/memory/{mid}')
def delete_hindsight_memory(mid: str, u=Depends(get_current_admin)):
    with tx() as c:
        c.execute('DELETE FROM hindsight_memories WHERE id=?', (mid,))
        audit(c, u['id'], 'memory_deleted', {'id': mid})
    return {'ok': True}

@router.get('/api/admin/tracing')
def tracing_telemetry(u=Depends(get_current_admin)):
    """Return LangSmith tracing summary and recent trace events."""
    return get_trace_summary()

@router.get('/api/admin/swarm/status')
def swarm_status(u=Depends(get_current_admin)):
    """Returns real-time status of the 3 Autonomous Agents (Sentinel, Alpha, Risk Guardian)
    and their shared communication stream."""
    from app.swarm import get_swarm_status
    return get_swarm_status()

@router.post('/api/admin/swarm/cycle')
def swarm_trigger_cycle(u=Depends(get_current_admin)):
    """Triggers an autonomous coordination sweep across all 3 agents."""
    from app.swarm import trigger_swarm_cycle
    return trigger_swarm_cycle()

class MailerTestPayload(BaseModel):
    to: str = Field(min_length=5, max_length=120)

@router.get('/api/admin/mailer/status')
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

@router.post('/api/admin/mailer/test')
def mailer_test_send(p: MailerTestPayload, u=Depends(get_current_admin)):
    """Sends a verified test email to the requested recipient."""
    from datetime import datetime, timezone
    from app.mailer import send_resend_email
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    html = f"""
    <div style="font-family:sans-serif;background:#0d1527;color:#f8fafc;padding:28px;border-radius:12px;border:1px solid #1e293b;max-width:540px;">
      <h2 style="color:#38bdf8;margin:0 0 12px;">ZUPIRUS Quant Lab</h2>
      <p style="color:#cbd5e1;font-size:14px;margin:0 0 16px;">Xin chào <strong>{p.to}</strong>,</p>
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

@router.get('/api/admin/payments')
def list_payments(u=Depends(get_current_admin)):
    """Returns recent SePay banking transactions and total revenue summary."""
    with tx() as c:
        rows = c.execute("""
            SELECT p.*, u.email as user_email
            FROM payment_transactions p
            LEFT JOIN users u ON u.id = p.user_id
            ORDER BY p.created_at DESC LIMIT 50
        """).fetchall()

        total_row = c.execute("SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE status IN ('completed', 'manual_approved')").fetchone()
        total_vnd = total_row[0] if total_row else 0.0

    return {
        "total_revenue_vnd": float(total_vnd),
        "total_transactions": len(rows),
        "transactions": [dict(r) for r in rows]
    }

class ManualPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)
    amount_vnd: float = Field(gt=0)
    gateway: str = Field(default='MANUAL_BANK', max_length=50)
    reference_code: str = Field(min_length=1, max_length=100)
    note: Optional[str] = Field(default='Duyệt thanh toán thủ công bởi Admin', max_length=255)

@router.post('/api/admin/payments/manual-approve')
def admin_manual_approve_payment(p: ManualPaymentPayload, u=Depends(get_current_admin)):
    """Manually approves and records a payment transaction, crediting the customer and sending an official email receipt."""
    from app.sepay import build_payment_success_email
    from app.mailer import send_resend_email
    email_clean = p.user_email.strip().lower()
    tx_id = f"manual_{secrets.token_hex(8)}"
    now_ts = time.time()

    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        user_id = user_row['id'] if user_row else None

        c.execute("""
            INSERT INTO payment_transactions(id, sepay_id, user_id, amount, currency, gateway, content, reference_code, status, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
        """, (
            tx_id,
            f"MANUAL-{int(now_ts)}-{secrets.randbelow(10000)}",
            user_id,
            p.amount_vnd,
            'VND',
            p.gateway,
            f"DUYỆT THỦ CÔNG: {p.note}",
            p.reference_code,
            'manual_approved',
            now_ts
        ))
        audit(c, u['id'], 'manual_payment_approved', {
            'tx_id': tx_id,
            'user_email': email_clean,
            'user_id': user_id,
            'amount': p.amount_vnd,
            'ref': p.reference_code
        })

    # Dispatch cybernetic receipt email
    try:
        email_html = build_payment_success_email(
            user_email=email_clean,
            amount_vnd=p.amount_vnd,
            gateway=p.gateway,
            ref_code=p.reference_code,
            content=f"DUYỆT THỦ CÔNG: {p.note}"
        )
        send_resend_email(to=email_clean, subject="🎉 Xác nhận nạp tiền thành công (Duyệt thủ công) - ZUPIRUS Quant Lab", html=email_html)
    except Exception as e:
        logger.error("Failed to send manual receipt email: %s", e)

    return {
        "ok": True,
        "transaction_id": tx_id,
        "amount": p.amount_vnd,
        "user_email": email_clean,
        "message": f"Đã duyệt nạp thành công {p.amount_vnd:,.0f} VND cho tài khoản {email_clean}"
    }

class LinkPaymentPayload(BaseModel):
    user_email: str = Field(min_length=5, max_length=120)

@router.post('/api/admin/payments/{tx_id}/link-user')
def admin_link_payment_user(tx_id: str, p: LinkPaymentPayload, u=Depends(get_current_admin)):
    """Links an unmatched incoming payment transaction to a specific customer account."""
    email_clean = p.user_email.strip().lower()
    with tx() as c:
        user_row = c.execute("SELECT id, email FROM users WHERE email=?", (email_clean,)).fetchone()
        if not user_row:
            fail(404, "Không tìm thấy người dùng với email này")
        tx_row = c.execute("SELECT * FROM payment_transactions WHERE id=?", (tx_id,)).fetchone()
        if not tx_row:
            fail(404, "Không tìm thấy giao dịch thanh toán")
        c.execute("UPDATE payment_transactions SET user_id=? WHERE id=?", (user_row['id'], tx_id))
        audit(c, u['id'], 'payment_linked_user', {'tx_id': tx_id, 'user_id': user_row['id'], 'user_email': email_clean})

    return {"ok": True, "message": f"Đã liên kết giao dịch {tx_id} với tài khoản {email_clean}"}
