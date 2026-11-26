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
    """System-wide quantitative report orders and purchases."""
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with tx() as c:
        query = '''
            SELECT o.*, u.email AS user_email, r.title AS report_title, r.slug AS report_slug
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            LEFT JOIN research_reports r ON r.id = o.report_id
            WHERE 1=1
        '''
        params: List[Any] = []
        if state:
            query += ' AND UPPER(o.status) = ?'
            params.append(state.upper())
        if search and search.strip():
            s_val = f"%{search.strip()}%"
            query += " AND (CAST(o.id AS TEXT) LIKE ? OR u.email LIKE ? OR o.payment_gateway LIKE ? OR r.title LIKE ?)"
            params.extend([s_val, s_val, s_val, s_val])

        query += ' ORDER BY o.created_at DESC LIMIT 200'
        rows = [dict(r) for r in c.execute(query, tuple(params))]
        for r in rows:
            r['state'] = (r.get('status') or 'PENDING').lower()
            r['created'] = r.get('created_at')
            r['updated'] = r.get('created_at')

        total = len(rows)
        paged = rows[offset:offset + limit]
        return {'total': total, 'orders': paged, 'limit': limit, 'offset': offset}

@router.get('/api/admin/monitor', tags=["admin-core"])
def monitor(u=Depends(get_current_admin)):
    with tx() as c:
        return {
            'accounts': [],
            'reports_count': c.execute('SELECT COUNT(*) FROM research_reports').fetchone()[0] or 0,
            'entitlements_count': c.execute('SELECT COUNT(*) FROM report_entitlements').fetchone()[0] or 0,
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
            try:
                c.execute('UPDATE accounts SET enabled=0')
            except Exception:
                pass
            try:
                c.execute('UPDATE trading_accounts SET auto_trade=0')
            except Exception:
                pass
            try:
                c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE state='queued'", (time.time(),))
            except Exception:
                pass
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
    now = time.time()
    with tx() as c:
        row = c.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
        if row:
            if row['state'] != 'waiting_approval':
                fail(409, 'Job not waiting for approval')
            c.execute("UPDATE jobs SET state='resume',decision=? WHERE id=?", (int(p.approved), jid))

        # Check if jid matches a strategy candidate
        cand = c.execute("SELECT id, name FROM strategy_candidates WHERE id=?", (jid,)).fetchone()
        if cand:
            if p.approved:
                c.execute("UPDATE strategy_candidates SET status = 'ARCHIVED_PROD', updated_at = ? WHERE status = 'APPROVED_FOR_PROD'", (now,))
                c.execute("UPDATE strategy_candidates SET status = 'APPROVED_FOR_PROD', updated_at = ? WHERE id = ?", (now, jid))
            else:
                c.execute("UPDATE strategy_candidates SET status = 'REJECTED', updated_at = ? WHERE id = ?", (now, jid))
        elif not row:
            fail(404, 'Job or strategy not found')

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
            c=c,
            caller_agent="admin_chat",
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
        rep_count = c.execute("SELECT COUNT(*) FROM research_reports").fetchone()[0] or 0
        ent_count = c.execute("SELECT COUNT(*) FROM report_entitlements").fetchone()[0] or 0
        ord_count = c.execute("SELECT COUNT(*) FROM orders").fetchone()[0] or 0
        user_count = c.execute("SELECT COUNT(*) FROM users").fetchone()[0] or 0

    lines = [
        "# HELP zupirus_research_reports_total Total count of quantitative research reports",
        "# TYPE zupirus_research_reports_total gauge",
        f"zupirus_research_reports_total {int(rep_count)}",
        "# HELP zupirus_report_entitlements_total Total granted report entitlements",
        "# TYPE zupirus_report_entitlements_total counter",
        f"zupirus_report_entitlements_total {int(ent_count)}",
        "# HELP zupirus_orders_total Total customer purchase orders",
        "# TYPE zupirus_orders_total counter",
        f"zupirus_orders_total {int(ord_count)}",
        "# HELP zupirus_users_total Total registered users",
        "# TYPE zupirus_users_total gauge",
        f"zupirus_users_total {int(user_count)}",
    ]
    return PlainTextResponse(content="\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")


# ---------------------------------------------------------------------------
# Admin Control Plane v1.2 — AI Quota, 4-Agent Heartbeat & Strategy Gate
# ---------------------------------------------------------------------------

class AiQuotaUpdatePayload(BaseModel):
    daily_cap: Optional[int] = None
    reset_today: Optional[bool] = False
    override_minutes: Optional[int] = None


@router.get('/api/admin/ai/quota', tags=["admin-ai"])
def get_ai_quota_api(_admin=Depends(get_current_admin)):
    """Returns AI cluster daily call metrics, daily cap, usage status and caller breakdown."""
    from app.domains.ai.gemini_client import get_daily_quota_stats
    return get_daily_quota_stats()


@router.put('/api/admin/ai/quota', tags=["admin-ai"])
def update_ai_quota_api(p: AiQuotaUpdatePayload, u=Depends(get_current_admin)):
    """Updates AI daily cap, resets daily usage, or activates manual override."""
    from app.domains.ai.gemini_client import update_ai_quota_config
    with tx() as c:
        res = update_ai_quota_config(
            daily_cap=p.daily_cap,
            reset_today=bool(p.reset_today),
            override_minutes=p.override_minutes,
            c=c,
        )
        audit(c, u['id'], 'ai_quota_updated', {
            'daily_cap': p.daily_cap,
            'reset_today': p.reset_today,
            'override_minutes': p.override_minutes,
        })
    return res


@router.get('/api/admin/agents/heartbeat', tags=["admin-swarm"])
def get_agents_heartbeat_api(_admin=Depends(get_current_admin)):
    """Returns standardized heartbeat status for all 4 operational agents."""
    from app.domains.ai.signal_swarm import get_agents_heartbeat
    with tx() as c:
        agents = get_agents_heartbeat(c=c)
    return {"total": len(agents), "agents": agents}


@router.post('/api/admin/agents/{agent_id}/toggle-pause', tags=["admin-swarm"])
def toggle_pause_agent_api(agent_id: str, u=Depends(get_current_admin)):
    """Toggles pause/resume state for a specific operational agent."""
    from app.domains.ai.signal_swarm import toggle_pause_agent
    with tx() as c:
        res = toggle_pause_agent(agent_id=agent_id, c=c)
        if not res.get("ok"):
            fail(400, res.get("message", "Thao tác không thành công"))
        audit(c, u['id'], 'agent_pause_toggled', {'agent_id': agent_id, 'is_paused': res.get('is_paused')})
    return res


@router.post('/api/admin/agents/{agent_id}/wake', tags=["admin-swarm"])
def wake_agent_api(agent_id: str, u=Depends(get_current_admin)):
    """Immediately triggers an operational cycle for the agent with 60s Atomic Redis Lock.
    Returns 409 Conflict if an active cycle is currently holding the lock."""
    from app.domains.ai.signal_swarm import wake_agent
    ok, msg, data = wake_agent(agent_id=agent_id)
    if not ok:
        if "chống chạy trùng" in msg or "đang chạy" in msg:
            fail(409, msg)
        fail(400, msg)
    with tx() as c:
        audit(c, u['id'], 'agent_woken', {'agent_id': agent_id, 'result': data})
    return {"ok": True, "message": msg, "data": data}


@router.get('/api/admin/strategies/review-queue', tags=["admin-strategy"])
def get_strategy_review_queue(_admin=Depends(get_current_admin)):
    """Returns all WAITING_APPROVAL candidates with side-by-side diff comparison against current LIVE strategy."""
    import json
    with tx() as c:
        waiting_rows = c.execute(
            """
            SELECT id, name, status, rules_json, sample_size, win_rate, profit_factor,
                   sharpe_ratio, max_drawdown_pct, oos_net_units, created_at, updated_at
            FROM strategy_candidates
            WHERE status = 'WAITING_APPROVAL'
            ORDER BY updated_at DESC LIMIT 20
            """
        ).fetchall()

        live_row = c.execute(
            """
            SELECT id, name, status, rules_json, sample_size, win_rate, profit_factor,
                   sharpe_ratio, max_drawdown_pct, oos_net_units, created_at, updated_at
            FROM strategy_candidates
            WHERE status = 'APPROVED_FOR_PROD'
            ORDER BY updated_at DESC LIMIT 1
            """
        ).fetchone()

        current_live = None
        if live_row:
            ld = dict(live_row) if hasattr(live_row, "keys") else {
                "id": live_row[0], "name": live_row[1], "status": live_row[2], "rules_json": live_row[3],
                "sample_size": live_row[4], "win_rate": live_row[5], "profit_factor": live_row[6],
                "sharpe_ratio": live_row[7], "max_drawdown_pct": live_row[8], "oos_net_units": live_row[9],
                "created_at": live_row[10], "updated_at": live_row[11]
            }
            try:
                lr_rules = json.loads(ld.get("rules_json") or "{}")
            except Exception:
                lr_rules = {}
            l_wr = float(ld.get("win_rate") or 0.0)
            current_live = {
                "id": ld.get("id"),
                "name": ld.get("name"),
                "win_rate": round(l_wr * 100.0 if l_wr <= 1.0 else l_wr, 1),
                "profit_factor": round(float(ld.get("profit_factor") or 0.0), 2),
                "max_drawdown_pct": round(float(ld.get("max_drawdown_pct") or 0.0), 2),
                "sample_size": int(ld.get("sample_size") or 0),
                "rules": lr_rules,
            }

        queue = []
        for wr in waiting_rows:
            cd = dict(wr) if hasattr(wr, "keys") else {
                "id": wr[0], "name": wr[1], "status": wr[2], "rules_json": wr[3],
                "sample_size": wr[4], "win_rate": wr[5], "profit_factor": wr[6],
                "sharpe_ratio": wr[7], "max_drawdown_pct": wr[8], "oos_net_units": wr[9],
                "created_at": wr[10], "updated_at": wr[11]
            }
            try:
                c_rules = json.loads(cd.get("rules_json") or "{}")
            except Exception:
                c_rules = {}
            c_wr = float(cd.get("win_rate") or 0.0)
            c_wr_pct = round(c_wr * 100.0 if c_wr <= 1.0 else c_wr, 1)
            c_pf = round(float(cd.get("profit_factor") or 0.0), 2)
            c_dd = round(float(cd.get("max_drawdown_pct") or 0.0), 2)

            cand_obj = {
                "id": cd.get("id"),
                "name": cd.get("name"),
                "win_rate": c_wr_pct,
                "profit_factor": c_pf,
                "max_drawdown_pct": c_dd,
                "sample_size": int(cd.get("sample_size") or 0),
                "rules": c_rules,
            }

            if current_live:
                delta = {
                    "win_rate_diff": round(c_wr_pct - current_live["win_rate"], 1),
                    "pf_diff": round(c_pf - current_live["profit_factor"], 2),
                    "dd_diff": round(c_dd - current_live["max_drawdown_pct"], 2),
                }
            else:
                delta = {
                    "win_rate_diff": 0.0,
                    "pf_diff": 0.0,
                    "dd_diff": 0.0,
                }

            queue.append({
                "candidate": cand_obj,
                "current_live": current_live,
                "delta": delta,
            })

    return {"total": len(queue), "queue": queue}


@router.post('/api/admin/strategies/{candidate_id}/approve', tags=["admin-strategy"])
def approve_strategy_candidate(candidate_id: str, u=Depends(get_current_admin)):
    """Approves a strategy candidate to APPROVED_FOR_PROD, archiving any previous live strategy."""
    now = time.time()
    with tx() as c:
        cand = c.execute("SELECT id, name FROM strategy_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not cand:
            fail(404, f"Không tìm thấy chiến lược: {candidate_id}")
        cand_name = cand["name"] if hasattr(cand, "keys") else cand[1]

        # 1. Archive previous APPROVED_FOR_PROD
        c.execute("UPDATE strategy_candidates SET status = 'ARCHIVED_PROD', updated_at = ? WHERE status = 'APPROVED_FOR_PROD'", (now,))

        # 2. Promote candidate to APPROVED_FOR_PROD
        c.execute("UPDATE strategy_candidates SET status = 'APPROVED_FOR_PROD', updated_at = ? WHERE id = ?", (now, candidate_id))

        audit(c, u['id'], 'strategy_approved', {'candidate_id': candidate_id, 'name': cand_name})
        try:
            from app.domains.notifications.service import emit_notification
            emit_notification(
                c,
                role="admin",
                severity="INFO",
                title="Chiến Lược AI Đã Được Duyệt Chạy LIVE",
                body=f"Chiến lược {cand_name} (#{candidate_id[:8]}) đã được thăng hạng lên APPROVED_FOR_PROD.",
            )
        except Exception:
            pass

    return {"ok": True, "message": f"Chiến lược {cand_name} đã được duyệt chạy LIVE."}


@router.post('/api/admin/strategies/{candidate_id}/reject', tags=["admin-strategy"])
def reject_strategy_candidate(candidate_id: str, u=Depends(get_current_admin)):
    """Rejects a strategy candidate."""
    now = time.time()
    with tx() as c:
        cand = c.execute("SELECT id, name FROM strategy_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not cand:
            fail(404, f"Không tìm thấy chiến lược: {candidate_id}")
        cand_name = cand["name"] if hasattr(cand, "keys") else cand[1]

        c.execute("UPDATE strategy_candidates SET status = 'REJECTED', updated_at = ? WHERE id = ?", (now, candidate_id))
        audit(c, u['id'], 'strategy_rejected', {'candidate_id': candidate_id, 'name': cand_name})

    return {"ok": True, "message": f"Đã từ chối chiến lược {cand_name}."}


@router.get('/api/admin/strategies/history', tags=["admin-strategy"])
def get_strategy_history(_admin=Depends(get_current_admin)):
    """Returns the last 10 strategy versions (APPROVED_FOR_PROD, ARCHIVED_PROD, PAUSED_DRAWDOWN_GUARD, ROLLED_BACK)."""
    import json
    with tx() as c:
        rows = c.execute(
            """
            SELECT id, name, status, rules_json, sample_size, win_rate, profit_factor,
                   sharpe_ratio, max_drawdown_pct, oos_net_units, created_at, updated_at
            FROM strategy_candidates
            WHERE status IN ('APPROVED_FOR_PROD', 'ARCHIVED_PROD', 'PAUSED_DRAWDOWN_GUARD', 'ROLLED_BACK')
            ORDER BY updated_at DESC LIMIT 10
            """
        ).fetchall()

        strategies = []
        for r in rows:
            rd = dict(r) if hasattr(r, "keys") else {
                "id": r[0], "name": r[1], "status": r[2], "rules_json": r[3],
                "sample_size": r[4], "win_rate": r[5], "profit_factor": r[6],
                "sharpe_ratio": r[7], "max_drawdown_pct": r[8], "oos_net_units": r[9],
                "created_at": r[10], "updated_at": r[11]
            }
            try:
                rules = json.loads(rd.get("rules_json") or "{}")
            except Exception:
                rules = {}
            w_rate = float(rd.get("win_rate") or 0.0)
            strategies.append({
                "id": rd.get("id"),
                "name": rd.get("name"),
                "status": rd.get("status"),
                "win_rate_pct": round(w_rate * 100.0 if w_rate <= 1.0 else w_rate, 1),
                "profit_factor": round(float(rd.get("profit_factor") or 0.0), 2),
                "sharpe_ratio": round(float(rd.get("sharpe_ratio") or 0.0), 2),
                "max_drawdown_pct": round(float(rd.get("max_drawdown_pct") or 0.0), 2),
                "sample_size": int(rd.get("sample_size") or 0),
                "rules": rules,
                "created_at": rd.get("created_at"),
                "updated_at": rd.get("updated_at"),
            })

    return {"total": len(strategies), "strategies": strategies}


@router.post('/api/admin/strategies/{candidate_id}/rollback', tags=["admin-strategy"])
def rollback_strategy(candidate_id: str, u=Depends(get_current_admin)):
    """1-Click Rollback: demotes current live strategy to ROLLED_BACK and restores target version to APPROVED_FOR_PROD."""
    now = time.time()
    with tx() as c:
        target = c.execute("SELECT id, name, status FROM strategy_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not target:
            fail(404, f"Không tìm thấy phiên bản chiến lược mục tiêu: {candidate_id}")
        target_name = target["name"] if hasattr(target, "keys") else target[1]

        curr = c.execute("SELECT id, name FROM strategy_candidates WHERE status = 'APPROVED_FOR_PROD'").fetchone()
        prev_id = None
        if curr:
            prev_id = curr["id"] if hasattr(curr, "keys") else curr[0]
            c.execute("UPDATE strategy_candidates SET status = 'ROLLED_BACK', updated_at = ? WHERE id = ?", (now, prev_id))

        c.execute("UPDATE strategy_candidates SET status = 'APPROVED_FOR_PROD', updated_at = ? WHERE id = ?", (now, candidate_id))

        audit(c, u['id'], 'strategy_rolled_back', {
            'target_id': candidate_id,
            'target_name': target_name,
            'previous_active_id': prev_id,
        })

        try:
            from app.domains.notifications.service import emit_notification
            emit_notification(
                c,
                role="admin",
                severity="WARNING",
                title="Khôi Phục Chiến Lược Thành Công (Rollback)",
                body=f"Đã khôi phục chiến lược {target_name} (#{candidate_id[:8]}) lên LIVE.",
            )
        except Exception:
            pass

    return {"ok": True, "message": f"Chiến lược #{candidate_id[:8]} ({target_name}) đã được khôi phục lên LIVE."}



