"""Tests for Dynamic Agent Skill Registry, Progressive Disclosure, and Analytical Tools."""
import time
import json
import pytest
from starlette.testclient import TestClient

from app.db import tx
from app.skills.registry import (
    get_skill_index,
    load_skill_spec,
    execute_skill,
    list_skills,
    toggle_skill,
    register_learned_skill,
    CORE_SKILL_IDS,
)
from app.hindsight import synthesize_inductive_rules


def test_dynamic_skill_registry_core_and_progressive_disclosure():
    """Verify Skill Index returns lightweight summary and load_skill_spec on-demand loads full SKILL.md."""
    # 1. Progressive Disclosure: Index is lightweight (name, 1-line description, trigger)
    skills = get_skill_index(enabled_only=True)
    assert len(skills) >= 5
    ids = [s["skill_id"] for s in skills]
    for core_id in CORE_SKILL_IDS:
        assert core_id in ids

    # 2. On-demand Loading of SKILL.md
    scanner_md = load_skill_spec("market_regime_scanner")
    assert scanner_md is not None
    assert "Market Regime Scanner" in scanner_md
    assert "ATR" in scanner_md

    auditor_md = load_skill_spec("liquidity_spread_auditor")
    assert auditor_md is not None
    assert "Liquidity & Spread Auditor" in auditor_md
    assert "Stop Loss" in auditor_md


def test_core_analytical_tools_execution():
    """Verify all 5 core tools execute cleanly and return structured analytical outputs."""
    # Tool 1: market_regime_scanner
    res_scanner = execute_skill("market_regime_scanner", symbol="XAUUSD")
    assert res_scanner["symbol"] == "XAUUSD"
    assert "atr_14" in res_scanner
    assert "session" in res_scanner
    assert "volatility_regime" in res_scanner

    # Tool 2: liquidity_spread_auditor
    res_auditor = execute_skill(
        "liquidity_spread_auditor",
        symbol="XAUUSD",
        stop_loss=2680.0,
        exit_price=2679.8,
        entry_price=2685.0,
        side="BUY"
    )
    assert res_auditor["symbol"] == "XAUUSD"
    assert res_auditor["loss_category"] in ("LIQUIDITY_SWEEP", "TREND_FAIL", "SPREAD_SPIKE_ROLLOVER")
    assert "distance_to_sl_pips" in res_auditor

    # Tool 3: macro_news_interpreter
    res_macro = execute_skill("macro_news_interpreter", currency="USD")
    assert res_macro["currency"] == "USD"
    assert "distance_minutes" in res_macro
    assert res_macro["risk_status"] in ("CLEAR_MACRO_WINDOW", "PRE_NEWS_VOLATILITY", "BLACKOUT_HIGH_RISK")

    # Tool 4: source_grading_analyst
    res_grader = execute_skill("source_grading_analyst")
    assert res_grader["status"] == "success"
    assert "total_sources_tracked" in res_grader

    # Tool 5: strategy_synthesizer
    res_synth = execute_skill("strategy_synthesizer", min_samples=3)
    assert res_synth["status"] == "success"
    assert "candidate_id" in res_synth
    assert "rules_json" in res_synth


def test_self_learned_skill_persistence(client):
    """Verify that inductive rules discovered by Hindsight are persisted as dynamic self-learned skills."""
    # Seed 6 winning trades in London session to trigger rule discovery
    now_ts = time.time()
    with tx() as c:
        for i in range(6):
            c.execute(
                """
                INSERT INTO signal_audit_logs (
                    id, signal_id, source_name, strategy_tier, symbol, side,
                    entry_price, stop_loss, status, pnl, context_snapshot, created_at
                ) VALUES (?, ?, 'tv_test', 'STANDARD', 'XAUUSD', 'BUY', 2650.0, 2645.0, 'APPROVED', 120.0, ?, ?)
                """,
                (
                    f"aud_test_{i}_{int(now_ts)}",
                    f"sig_test_{i}_{int(now_ts)}",
                    json.dumps({"session": "London", "atr_14": 4.10, "news_distance_mins": 80.0}),
                    now_ts
                )
            )

        # Synthesize rules
        discovered = synthesize_inductive_rules(c, min_samples=5)
        assert len(discovered) >= 1
        disc = discovered[0]
        assert disc["session"] == "London"
        assert disc["side"] == "BUY"
        assert disc["win_rate"] >= 0.60

    # Verify self-learned skill appears in Registry
    all_skills = list_skills(enabled_only=False)
    learned = [s for s in all_skills if s.get("is_builtin") == 0]
    assert len(learned) >= 1
    target = learned[0]
    assert "learned_" in target["skill_id"]
    assert "London" in target["name"] or "London" in target["description"]


def test_admin_skills_api_endpoints(client: TestClient):
    """Verify admin endpoints: listing skills, viewing spec, toggling, and test execution."""
    login_res = client.post("/api/login", json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"})
    assert login_res.status_code == 200
    csrf = {"x-zupirus": "1"}

    # 1. List skills
    r_list = client.get("/api/admin/skills", headers=csrf)
    assert r_list.status_code == 200
    d_list = r_list.json()
    assert d_list["total_skills"] >= 5
    assert d_list["builtin_count"] >= 5

    # 2. View SKILL.md spec
    r_spec = client.get("/api/admin/skills/market_regime_scanner/spec", headers=csrf)
    assert r_spec.status_code == 200
    assert "Market Regime Scanner" in r_spec.json()["skill_md"]

    # 3. Toggle skill state
    r_toggle = client.patch(
        "/api/admin/skills/market_regime_scanner",
        json={"enabled": False},
        headers=csrf
    )
    assert r_toggle.status_code == 200
    assert r_toggle.json()["enabled"] is False

    # Re-enable
    r_reenable = client.patch(
        "/api/admin/skills/market_regime_scanner",
        json={"enabled": True},
        headers=csrf
    )
    assert r_reenable.status_code == 200
    assert r_reenable.json()["enabled"] is True

    # 4. Test run tool
    r_test = client.post(
        "/api/admin/skills/market_regime_scanner/test",
        json={"parameters": {"symbol": "XAUUSD"}},
        headers=csrf
    )
    assert r_test.status_code == 200
    res_obj = r_test.json()["result"]
    assert res_obj["symbol"] == "XAUUSD"
    assert "atr_14" in res_obj
