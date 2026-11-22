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
)


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
