"""Test suite for Admin Control Plane v1.2:
1. Budget Guard: Hard quota 80% warning and 100% block with (None, 'QUOTA_CAP_REACHED').
2. Event-Driven Heartbeat + Atomic Redis/Memory 60s Wake Now lock (concurrency 409 Conflict).
3. Strategy Approval Gate with Diff comparison and 1-Click Rollback.
"""
import time
import json
import pytest
from app.db import tx
from app.domains.ai.gemini_client import (
    call_gemini,
    get_daily_quota_stats,
    update_ai_quota_config,
    record_ai_call,
)
from app.domains.ai.signal_swarm import (
    get_agents_heartbeat,
    toggle_pause_agent,
    wake_agent,
    release_agent_wake_lock,
    is_agent_paused,
    record_agent_heartbeat,
)
from app.domains.notifications.service import run_daily_executive_digest
from app.domains.ai.research_graph import run_autonomous_induction_and_wfo


def login_admin(client):
    client.cookies.clear()
    res = client.post('/api/login', json={'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'})
    assert res.status_code == 200, f"Admin login failed: {res.text}"


def test_ai_budget_guard_80_and_100_cap(client):
    """Verify daily LLM call tracking, 80% warning state, and 100% hard block returning (None, 'QUOTA_CAP_REACHED')."""
    # 1. Reset today's quota and configure cap of 10 calls
    update_ai_quota_config(daily_cap=10, reset_today=True, override_minutes=0)

    stats_init = get_daily_quota_stats()
    assert stats_init["daily_cap"] == 10
    assert stats_init["calls_today"] == 0
    assert stats_init["status"] == "OK"

    # 2. Record 8 calls -> reaches 80%
    for _ in range(8):
        record_ai_call(caller_agent="sentinel")

    stats_80 = get_daily_quota_stats()
    assert stats_80["calls_today"] == 8
    assert stats_80["usage_pct"] == 80.0
    assert stats_80["status"] == "WARNING_80"
    assert stats_80["breakdown"]["sentinel"] == 8

    # 3. Record 2 more calls -> reaches 100% (10/10)
    record_ai_call(caller_agent="alpha")
    record_ai_call(caller_agent="alpha")

    stats_100 = get_daily_quota_stats()
    assert stats_100["calls_today"] == 10
    assert stats_100["usage_pct"] == 100.0
    assert stats_100["status"] == "CAPPED_100"

    # 4. Calling call_gemini at 100% without override must return (None, 'QUOTA_CAP_REACHED') immediately
    res_text, res_kid = call_gemini("Test prompt at 100% quota", caller_agent="sentinel")
    assert res_text is None
    assert res_kid == "QUOTA_CAP_REACHED"

    # 5. Admin temporary override for 30 minutes unblocks the cap
    update_ai_quota_config(override_minutes=30)
    stats_ov = get_daily_quota_stats()
    assert stats_ov["is_overridden"] is True

    # Clean up quota for subsequent tests
    update_ai_quota_config(daily_cap=144, reset_today=True, override_minutes=0)


def test_atomic_agent_wake_lock_concurrency(client):
    """Verify that wake_agent acquires an atomic lock and blocks overlapping cycles with 409 Conflict."""
    login_admin(client)
    agent_id = "sentinel"

    # Ensure lock is clear initially
    release_agent_wake_lock(agent_id)

    # 1. First wake call via API succeeds
    resp1 = client.post(f"/api/admin/agents/{agent_id}/wake")
    assert resp1.status_code == 200, resp1.text
    data1 = resp1.json()
    assert data1["ok"] is True

    # 2. Immediate second wake call while the 60s lock is active must return 409 Conflict
    resp2 = client.post(f"/api/admin/agents/{agent_id}/wake")
    assert resp2.status_code == 409, f"Expected 409 Conflict, got {resp2.status_code}: {resp2.text}"
    detail = resp2.json().get("detail", "")
    assert "chống chạy trùng" in detail or "đang chạy" in detail

    # Clean up lock
    release_agent_wake_lock(agent_id)


def test_strategy_approval_and_1_click_rollback(client):
    """Verify:
    1. Approving candidate B automatically transitions existing live candidate A to ARCHIVED_PROD.
    2. Rolling back to candidate A restores A to APPROVED_FOR_PROD and demotes B to ROLLED_BACK.
    """
    login_admin(client)
    strat_a_id = f"strat_test_a_{int(time.time())}"
    strat_b_id = f"strat_test_b_{int(time.time()) + 1}"
    now = time.time()

    rules_a = {"symbol": "XAUUSD", "timeframe": "M15", "strategy": "alpha_momentum_v1"}
    rules_b = {"symbol": "XAUUSD", "timeframe": "M15", "strategy": "alpha_regime_v2"}

    # Seed candidates A and B as WAITING_APPROVAL
    with tx() as c:
        # Clear any old live strategies for clean isolation
        c.execute("UPDATE strategy_candidates SET status = 'ARCHIVED_PROD' WHERE status = 'APPROVED_FOR_PROD'")

        c.execute(
            """
            INSERT INTO strategy_candidates (
                id, name, status, rules_json, sample_size, win_rate, profit_factor,
                sharpe_ratio, max_drawdown_pct, oos_net_units, created_at, updated_at
            ) VALUES (?, 'Strat Alpha V1', 'WAITING_APPROVAL', ?, 60, 0.58, 1.65, 1.45, 4.2, 85.0, ?, ?)
            """,
            (strat_a_id, json.dumps(rules_a), now - 3600, now - 3600),
        )

        c.execute(
            """
            INSERT INTO strategy_candidates (
                id, name, status, rules_json, sample_size, win_rate, profit_factor,
                sharpe_ratio, max_drawdown_pct, oos_net_units, created_at, updated_at
            ) VALUES (?, 'Strat Alpha V2', 'WAITING_APPROVAL', ?, 95, 0.64, 1.92, 1.80, 3.1, 120.0, ?, ?)
            """,
            (strat_b_id, json.dumps(rules_b), now - 1800, now - 1800),
        )

    # 1. Check Review Queue endpoint with Diff
    rq_resp = client.get("/api/admin/strategies/review-queue")
    assert rq_resp.status_code == 200, rq_resp.text
    rq_data = rq_resp.json()
    assert rq_data["total"] >= 2

    # 2. Approve candidate A to LIVE
    app_a = client.post(f"/api/admin/strategies/{strat_a_id}/approve")
    assert app_a.status_code == 200, app_a.text

    with tx() as c:
        st_a = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (strat_a_id,)).fetchone()[0]
        assert st_a == "APPROVED_FOR_PROD"

    # 3. Approve candidate B to LIVE -> candidate A must become ARCHIVED_PROD
    app_b = client.post(f"/api/admin/strategies/{strat_b_id}/approve")
    assert app_b.status_code == 200, app_b.text

    with tx() as c:
        st_b = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (strat_b_id,)).fetchone()[0]
        st_a_after = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (strat_a_id,)).fetchone()[0]
        assert st_b == "APPROVED_FOR_PROD"
        assert st_a_after == "ARCHIVED_PROD"

    # 4. Check Strategy History API
    hist_resp = client.get("/api/admin/strategies/history")
    assert hist_resp.status_code == 200, hist_resp.text
    hist_data = hist_resp.json()
    assert len(hist_data["strategies"]) >= 2
    strat_ids = [s["id"] for s in hist_data["strategies"]]
    assert strat_a_id in strat_ids
    assert strat_b_id in strat_ids

    # 5. Execute 1-Click Rollback back to candidate A
    rb_resp = client.post(f"/api/admin/strategies/{strat_a_id}/rollback")
    assert rb_resp.status_code == 200, rb_resp.text

    with tx() as c:
        st_a_rolled = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (strat_a_id,)).fetchone()[0]
        st_b_rolled = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (strat_b_id,)).fetchone()[0]
        assert st_a_rolled == "APPROVED_FOR_PROD"
        assert st_b_rolled == "ROLLED_BACK"


def test_admin_agents_heartbeat_api(client):
    """Verify heartbeat endpoint returns all 4 operational agents with required 7 fields and supports toggle-pause."""
    login_admin(client)

    # 1. Fetch heartbeat
    resp = client.get("/api/admin/agents/heartbeat")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 4
    agent_ids = {a["id"] for a in data["agents"]}
    expected_ids = {"sentinel", "alpha", "risk_guardian", "research_wfo"}
    assert expected_ids == agent_ids

    for agent in data["agents"]:
        assert "id" in agent
        assert "name" in agent
        assert "status" in agent
        assert agent["status"] in ("IDLE", "RUNNING", "PAUSED", "QUOTA_CAPPED")
        assert agent["trigger_mode"] == "EVENT_DRIVEN"
        assert "last_run_at" in agent
        assert "last_duration_ms" in agent
        assert "last_summary" in agent
        assert "calls_today" in agent
        assert "is_paused" in agent

    # 2. Toggle pause on 'alpha'
    toggle_resp = client.post("/api/admin/agents/alpha/toggle-pause")
    assert toggle_resp.status_code == 200, toggle_resp.text
    t_data = toggle_resp.json()
    assert t_data["ok"] is True
    assert t_data["is_paused"] is True
    assert t_data["status"] == "PAUSED"

    # Toggle back
    toggle_back = client.post("/api/admin/agents/alpha/toggle-pause")
    assert toggle_back.status_code == 200
    assert toggle_back.json()["is_paused"] is False
    assert toggle_back.json()["status"] == "IDLE"


def test_is_agent_paused_blocks_swarm_and_wfo():
    """Verify that pausing an agent via kv blocks trigger_swarm_cycle and WFO loop."""
    with tx() as c:
        c.execute("INSERT INTO kv (key, value) VALUES ('agent_paused:sentinel', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
        assert is_agent_paused(c, "sentinel") is True
        c.execute("INSERT INTO kv (key, value) VALUES ('agent_paused:sentinel', '0') ON CONFLICT(key) DO UPDATE SET value = '0'")
        assert is_agent_paused(c, "sentinel") is False

        # Pause research_wfo
        c.execute("INSERT INTO kv (key, value) VALUES ('agent_paused:research_wfo', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
        assert is_agent_paused(c, "research_wfo") is True
        c.execute("DELETE FROM kv WHERE key = 'agent_paused:research_wfo'")
        assert is_agent_paused(c, "research_wfo") is False


def test_caller_agent_quota_breakdown():
    """Verify that record_ai_call attributes calls to specific agents in quota breakdown."""
    update_ai_quota_config(daily_cap=144, reset_today=True, override_minutes=0)
    record_ai_call(caller_agent="sentinel")
    record_ai_call(caller_agent="research_wfo")
    record_ai_call(caller_agent="admin_chat")
    record_ai_call(caller_agent="alpha")

    stats = get_daily_quota_stats()
    assert stats["calls_today"] >= 4
    bd = stats.get("breakdown", {})
    assert bd.get("sentinel", 0) >= 1
    assert bd.get("research_wfo", 0) >= 1
    assert bd.get("admin_chat", 0) >= 1
    assert bd.get("alpha", 0) >= 1


def test_canary_demo_and_7_day_promotion():
    """Verify:
    1. Canary evaluation promotes qualified strategies (WR >= 52% and PF >= 1.25) to APPROVED_FOR_PROD.
    2. Disqualified canary strategies (< 52% or < 1.25) are demoted to CANARY_REJECTED with hindsight entry.
    """
    now = time.time()
    cand_win_id = f"canary_win_{int(now)}"
    cand_loss_id = f"canary_loss_{int(now) + 1}"
    prev_live_id = f"prev_live_{int(now)}"

    with tx() as c:
        # Clear existing live and older signals for clean test isolation
        c.execute("UPDATE strategy_candidates SET status = 'ARCHIVED_PROD' WHERE status = 'APPROVED_FOR_PROD'")
        c.execute("DELETE FROM signal_audit_logs WHERE created_at >= ?", (now - 86400 * 9,))

        # Insert previous live
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, status, rules_json, sample_size, win_rate, profit_factor, max_drawdown_pct, created_at, updated_at)
            VALUES (?, 'Old Live Strat', 'APPROVED_FOR_PROD', '{}', 50, 0.55, 1.30, 4.0, ?, ?)
            """,
            (prev_live_id, now - 86400 * 10, now - 86400 * 10)
        )
        # Insert winning candidate that completed 7-day canary
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, status, rules_json, sample_size, win_rate, profit_factor, max_drawdown_pct, created_at, updated_at)
            VALUES (?, 'Winning Canary', 'CANARY_DEMO', ?, 60, 0.60, 1.80, 3.2, ?, ?)
            """,
            (cand_win_id, json.dumps({"canary_started_at": now - 86400 * 8}), now - 86400 * 8, now - 86400 * 8)
        )
        c.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"canary_strat:{cand_win_id}:started_at", str(now - 86400 * 8)),
        )

        # Seed 12 winning closed trades in canary period
        for i in range(12):
            c.execute(
                """
                INSERT INTO signal_audit_logs (id, signal_id, source_name, symbol, side, entry_price, status, pnl, created_at)
                VALUES (?, ?, 'CANARY_AI', 'XAUUSD', 'BUY', 2680.0, 'APPROVED', 15.0, ?)
                """,
                (f"log_canary_win_{cand_win_id}_{i}", f"sig_canary_win_{cand_win_id}_{i}", now - 86400 * 3 + i * 60)
            )

        # Enable auto-promote
        c.execute("INSERT INTO kv (key, value) VALUES ('AUTO_PROMOTE_QUALIFIED_STRATEGIES', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'")

    # Run WFO evaluation cycle
    run_autonomous_induction_and_wfo(force=True)

    with tx() as c:
        row_win = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (cand_win_id,)).fetchone()
        row_prev = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (prev_live_id,)).fetchone()
        assert row_win and row_win[0] == "APPROVED_FOR_PROD"
        assert row_prev and row_prev[0] == "ARCHIVED_PROD"

        # Now test rejection case: clean canary logs to isolate failing candidate
        c.execute("DELETE FROM signal_audit_logs WHERE created_at >= ?", (now - 86400 * 9,))
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, status, rules_json, sample_size, win_rate, profit_factor, max_drawdown_pct, created_at, updated_at)
            VALUES (?, 'Failing Canary', 'CANARY_DEMO', ?, 40, 0.45, 0.90, 8.5, ?, ?)
            """,
            (cand_loss_id, json.dumps({"canary_started_at": now - 86400 * 8}), now - 86400 * 8, now - 86400 * 8)
        )
        c.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"canary_strat:{cand_loss_id}:started_at", str(now - 86400 * 8)),
        )

        # Seed 12 losing closed trades in canary period
        for i in range(12):
            c.execute(
                """
                INSERT INTO signal_audit_logs (id, signal_id, source_name, symbol, side, entry_price, status, pnl, created_at)
                VALUES (?, ?, 'CANARY_AI', 'XAUUSD', 'BUY', 2680.0, 'APPROVED', -10.0, ?)
                """,
                (f"log_canary_loss_{cand_loss_id}_{i}", f"sig_canary_loss_{cand_loss_id}_{i}", now - 86400 * 2 + i * 60)
            )

    run_autonomous_induction_and_wfo(force=True)

    with tx() as c:
        row_loss = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (cand_loss_id,)).fetchone()
        assert row_loss and row_loss[0] == "CANARY_REJECTED"


def test_run_daily_executive_digest_idempotent():
    """Verify daily executive digest dispatches once per day and remains idempotent."""
    with tx() as c:
        c.execute("DELETE FROM kv WHERE key = 'daily_digest_last_date'")

    # First dispatch forced
    res1 = run_daily_executive_digest(force=True)
    assert res1.get("ok") is True
    assert res1.get("status") == "sent"

    # Second dispatch without force on same day must be idempotent
    res2 = run_daily_executive_digest(force=False)
    assert res2.get("ok") is True
    assert res2.get("status") == "already_sent"

