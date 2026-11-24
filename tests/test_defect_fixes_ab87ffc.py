import pytest
import time
import json
from unittest.mock import patch, MagicMock

from app.db import tx, init
from app.skills.registry import evaluate_active_learned_skills, reject_learned_skill, register_learned_skill
from app.domains.signals.sources.curator import score_external_signal_hybrid
from app.domains.ai.ingest_swarm import retrieve_relevant_knowledge, embed_text
from app.domains.signals.ingestion.context import get_microstructure_features
from app.domains.ai.research_graph import score_candidate_on_window
from app.domains.signals.ingestion.sanitizer import sanitize_and_audit_signal
from app.schemas.signals import NormalizedSignalSchema


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    test_db = tmp_path / "test_fixes_ab87ffc.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{test_db}")
    monkeypatch.setattr("app.core.db.DB", test_db)
    monkeypatch.setattr("app.db.DB", test_db)
    init()
    yield


def test_issue1_h1_unknown_and_contextual_matching():
    """Issue 1: Insufficient bars return UNKNOWN, contextual rules require valid context."""
    now_ts = 1700000000.0

    # 1. get_microstructure_features returns UNKNOWN when < 16 candles
    with tx() as c:
        c.execute("DELETE FROM candles")
        # Insert only 5 candles
        for i in range(5):
            c.execute(
                "INSERT INTO candles (symbol, timeframe, time, open, high, low, close) VALUES ('XAUUSD', 'M15', ?, 2650, 2655, 2645, 2650)",
                (now_ts - i * 900,)
            )
        feat = get_microstructure_features(c, symbol="XAUUSD")
        assert feat["h1_trend"] == "UNKNOWN"

    # 2. Contextual rule evaluation in evaluate_active_learned_skills
    with tx() as c:
        c.execute("DELETE FROM agent_skills")
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES 
                ('sk_1', 'learned_asia_sell_neutral_filter', 'Asia Sell Neutral', 'Desc', 'Trigger', 0, 1, 'md', ?, ?),
                ('sk_2', 'learned_asia_sell_neutral_swept_filter', 'Asia Sell Neutral Swept', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts, now_ts, now_ts)
        )

    with patch("app.services.signal_ingestion.context.get_trading_session", return_value="Asia"):
        # Case A: Empty context snapshot -> CANNOT match contextual rules
        res_empty = evaluate_active_learned_skills(current_time=now_ts, context_snapshot={})
        assert "SELL" not in res_empty["allowed_sides"]
        assert len(res_empty["matched_skills"]) == 0

        # Case B: Context with UNKNOWN trend -> CANNOT match
        res_unk = evaluate_active_learned_skills(current_time=now_ts, context_snapshot={"h1_trend": "UNKNOWN"})
        assert "SELL" not in res_unk["allowed_sides"]

        # Case C: Context with NEUTRAL trend but swept_liquidity=False
        res_neutral = evaluate_active_learned_skills(
            current_time=now_ts,
            context_snapshot={"h1_trend": "NEUTRAL", "swept_liquidity": False}
        )
        assert "learned_asia_sell_neutral_filter" in res_neutral["matched_skills"]
        # neutral_swept MUST NOT match because swept is False
        assert "learned_asia_sell_neutral_swept_filter" not in res_neutral["matched_skills"]

        # Case D: Context with NEUTRAL trend AND swept_liquidity=True
        res_swept = evaluate_active_learned_skills(
            current_time=now_ts,
            context_snapshot={"h1_trend": "NEUTRAL", "swept_liquidity": True}
        )
        assert "learned_asia_sell_neutral_filter" in res_swept["matched_skills"]
        assert "learned_asia_sell_neutral_swept_filter" in res_swept["matched_skills"]
        assert "SELL" in res_swept["allowed_sides"]


def test_issue2_hindsight_symbol_grouping_and_hazard_scoping():
    """Issue 2: Hindsight scopes Hazard Guard to symbol + context and preserves approved baseline."""
    from app.domains.ai.hindsight import synthesize_inductive_rules

    now_ts = 1700000000.0
    with tx() as c:
        c.execute("DELETE FROM signal_audit_logs")
        c.execute("DELETE FROM shadow_signals")
        c.execute("DELETE FROM agent_skills")
        c.execute("DELETE FROM signal_sources WHERE id = 'src_shadow'")
        c.execute(
            """
            INSERT INTO signal_sources (id, name, source_type, trust_score, win_rate, total_signals, created_at, updated_at)
            VALUES ('src_shadow', 'Shadow Source', 'TELEGRAM', 50.0, 0.5, 0, ?, ?)
            """,
            (now_ts, now_ts)
        )

        # Insert 35 losing EURUSD Asia SELL signals with H1 BEARISH and SWEPT
        for i in range(35):
            c.execute(
                """
                INSERT INTO signal_audit_logs (
                    id, signal_id, source_name, symbol, side, entry_price, pnl, context_snapshot, created_at, status
                ) VALUES (?, ?, 'src_test', 'EURUSD', 'SELL', 1.0850, -15.0, ?, ?, 'EXECUTED')
                """,
                (
                    f"log_{i}", f"sig_{i}",
                    json.dumps({"session": "Asia", "h1_trend": "BEARISH", "swept_liquidity": True}),
                    now_ts - i * 60
                )
            )

        rules = synthesize_inductive_rules(c, min_samples=30)
        # Hazard rule should be created
        guard_row = c.execute("SELECT skill_id, name, skill_md FROM agent_skills WHERE skill_id LIKE '%avoid%'").fetchone()
        assert guard_row is not None
        guard_id = guard_row[0]
        # Must be scoped to eurusd and include bearish_swept context, NOT blocking all Asia SELL
        assert "eurusd" in guard_id
        assert "bearish_swept" in guard_id

        # Test preserving approved baseline when re-registering
        c.execute("UPDATE agent_skills SET enabled = 1 WHERE skill_id = ?", (guard_id,))
        register_learned_skill(
            skill_id=guard_id,
            name="Updated Guard",
            description="New description",
            trigger_condition="New trigger",
            skill_md="New MD content",
            db_cursor=c,
            auto_approve=False
        )
        upd_row = c.execute("SELECT skill_md FROM agent_skills WHERE skill_id = ?", (guard_id,)).fetchone()
        assert "Approved Baseline" in upd_row[0]


def test_issue3_walk_forward_session_awareness():
    """Issue 3: score_candidate_on_window respects preferred_session constraint on bar time."""
    from app.services.signal_ingestion.context import get_trading_session
    from app.db import to_epoch_ts

    # Create synthetic M15 bars starting at 08:00 UTC (start of London session)
    london_base = 1716364800.0  # 08:00 UTC
    prices_london = []
    for i in range(20):
        # Trending up
        p = 2600.0 + i * 2.0
        prices_london.append({
            "time": london_base + i * 900,
            "open": p - 0.5,
            "high": p + 1.0,
            "low": p - 1.0,
            "close": p,
        })

    # Evaluate with preferred_session="London" -> takes trades
    pnl_london, rets_london = score_candidate_on_window(
        prices_london,
        {"action": "BUY", "min_slope": 0.1, "sl_points": 10.0, "tp_points": 20.0, "preferred_session": "London"}
    )
    assert len(rets_london) > 0

    # Evaluate the exact same bars with preferred_session="New York" -> MUST NOT take trades!
    pnl_ny, rets_ny = score_candidate_on_window(
        prices_london,
        {"action": "BUY", "min_slope": 0.1, "sl_points": 10.0, "tp_points": 20.0, "preferred_session": "New York"}
    )
    assert len(rets_ny) == 0
    assert pnl_ny == 0.0


def test_issue4_canary_demo_execution_pipeline():
    """Issue 4: CANARY_DEMO candidate is picked up, executed on demo account, and audit log stores strategy_id."""
    now_ts = time.time()
    with tx() as c:
        c.execute("DELETE FROM strategy_candidates")
        c.execute("DELETE FROM signal_audit_logs")
        cand_id = "cand_canary_001"
        c.execute(
            """
            INSERT INTO strategy_candidates (
                id, name, status, rules_json, sample_size, win_rate, created_at, updated_at
            ) VALUES (?, 'Canary Strategy', 'CANARY_DEMO', ?, 50, 0.65, ?, ?)
            """,
            (cand_id, json.dumps({"symbol": "XAUUSD", "action": "BUY", "min_slope": 0.1}), now_ts, now_ts)
        )

    # Test sanitizer persisting strategy_id for CANARY signal
    sig = NormalizedSignalSchema(
        id="sig_canary_123",
        source="src_zupirus_agent",
        strategy_tier="CANARY",
        symbol="XAUUSD",
        action="BUY",
        entry_price=2650.0,
        stop_loss=2640.0,
        take_profit=2670.0,
        raw_payload={"candidate_id": cand_id, "strategy_id": cand_id},
        created_at=now_ts,
    )

    with tx() as c:
        approved, reason, sanitized = sanitize_and_audit_signal(sig, live_price=2650.0, current_time=now_ts)
        assert approved is True
        # Check strategy_id in signal_audit_logs
        row = c.execute("SELECT strategy_id FROM signal_audit_logs WHERE signal_id = 'sig_canary_123'").fetchone()
        assert row is not None
        assert row[0] == cand_id


def test_issue5_hybrid_scorer_baseline_trust_and_symbol_isolation():
    """Issue 5: Untrusted source (< 50) is rejected even with Edge, and symbol scoping is strictly enforced."""
    now_ts = time.time()
    with tx() as c:
        c.execute("DELETE FROM signal_sources")
        c.execute("DELETE FROM agent_skills")
        # Source 1: Low trust (40.0)
        c.execute(
            """
            INSERT INTO signal_sources (id, name, source_type, trust_score, win_rate, total_signals, created_at, updated_at)
            VALUES ('src_untrusted', 'Untrusted', 'WEBHOOK', 40.0, 0.45, 50, ?, ?)
            """,
            (now_ts, now_ts)
        )
        # Source 2: Trusted (60.0)
        c.execute(
            """
            INSERT INTO signal_sources (id, name, source_type, trust_score, win_rate, total_signals, created_at, updated_at)
            VALUES ('src_trusted', 'Trusted', 'WEBHOOK', 60.0, 0.65, 100, ?, ?)
            """,
            (now_ts, now_ts)
        )
        # Edge filter scoped to XAUUSD
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES ('sk_xau_edge', 'learned_xauusd_asia_sell_neutral_filter', 'XAU Edge', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts)
        )

    with patch("app.services.signal_ingestion.context.get_trading_session", return_value="Asia"):
        with tx() as c:
            # 1. Untrusted source (40.0) sending XAUUSD SELL in Asia -> MUST BE REJECTED despite Edge!
            appr, score, rsn = score_external_signal_hybrid(
                c,
                {"source": "src_untrusted", "action": "SELL", "symbol": "XAUUSD"},
                context_snapshot={"h1_trend": "neutral", "captured_at": now_ts}
            )
            assert appr is False
            assert "HYBRID_LOW_TRUST_SCORE" in rsn

            # 2. Trusted source (60.0) sending XAUUSD SELL in Asia -> APPROVED WITH BOOST (60.0 -> 75.0)
            appr2, score2, rsn2 = score_external_signal_hybrid(
                c,
                {"source": "src_trusted", "action": "SELL", "symbol": "XAUUSD"},
                context_snapshot={"h1_trend": "neutral", "captured_at": now_ts}
            )
            assert appr2 is True
            assert score2 == 75.0
            assert rsn2 == "HYBRID_SCORER_APPROVED_WITH_EDGE_BOOST"

            # 3. Trusted source sending EURUSD SELL in Asia -> XAUUSD edge DOES NOT APPLY! (Score remains 60.0)
            appr3, score3, rsn3 = score_external_signal_hybrid(
                c,
                {"source": "src_trusted", "action": "SELL", "symbol": "EURUSD"},
                context_snapshot={"h1_trend": "neutral", "captured_at": now_ts}
            )
            assert appr3 is True
            assert score3 == 60.0
            assert rsn3 == "HYBRID_SCORER_APPROVED"


def test_issue6_cascade_delete_and_rag_exclusion():
    """Issue 6: Deleting a skill cascades to knowledge_chunks, and RAG excludes deleted chunks."""
    now_ts = time.time()
    dummy_vec = embed_text("market liquidity sweep")

    with tx() as c:
        c.execute("DELETE FROM agent_skills")
        c.execute("DELETE FROM knowledge_chunks")

        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES ('sk_del', 'doc_to_delete', 'To Delete', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts)
        )
        c.execute(
            """
            INSERT INTO knowledge_chunks (id, skill_id, school, doc_type, chunk_index, content, embedding_json, created_at)
            VALUES ('chk_del', 'doc_to_delete', 'ICT', 'PDF', 0, 'Deleted Content', ?, ?)
            """,
            (json.dumps(dummy_vec), now_ts)
        )

    # 1. Cascade delete via reject_learned_skill
    reject_learned_skill("doc_to_delete")

    with tx() as c:
        chk_count = c.execute("SELECT count(*) FROM knowledge_chunks WHERE skill_id = 'doc_to_delete'").fetchone()[0]
        assert chk_count == 0

        # 2. Even if an orphan chunk exists without an entry in agent_skills, RAG MUST NOT retrieve it!
        c.execute(
            """
            INSERT INTO knowledge_chunks (id, skill_id, school, doc_type, chunk_index, content, embedding_json, created_at)
            VALUES ('chk_orphan', 'doc_deleted_orphan', 'ICT', 'PDF', 0, 'Orphan Content', ?, ?)
            """,
            (json.dumps(dummy_vec), now_ts)
        )
        chunks = retrieve_relevant_knowledge(c, query="market liquidity sweep", top_k=5)
        retrieved_ids = [chk["id"] for chk in chunks]
        assert "chk_orphan" not in retrieved_ids


def test_issue7_multi_token_sessions_and_symbol_isolation():
    """Issue 7: multi-token sessions (New York, London/NY overlap) parse correctly, and symbol isolation is strictly enforced."""
    now_ts = 1700000000.0
    with tx() as c:
        c.execute("DELETE FROM agent_skills")
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES 
                ('sk_ny', 'learned_xauusd_new_york_buy_filter', 'NY Buy Filter', 'Desc', 'Trigger', 0, 1, 'md', ?, ?),
                ('sk_overlap', 'learned_xauusd_london_new_york_overlap_sell_filter', 'Overlap Sell Filter', 'Desc', 'Trigger', 0, 1, 'md', ?, ?),
                ('sk_legacy', 'learned_new_york_buy_filter', 'Legacy NY Buy', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts, now_ts, now_ts, now_ts, now_ts)
        )

    # 1. In New York session for XAUUSD -> learned_xauusd_new_york_buy_filter matches
    with patch("app.services.signal_ingestion.context.get_trading_session", return_value="New York"):
        res = evaluate_active_learned_skills(current_time=now_ts, symbol="XAUUSD")
        assert "learned_xauusd_new_york_buy_filter" in res["matched_skills"]
        assert "learned_new_york_buy_filter" in res["matched_skills"]
        assert "BUY" in res["allowed_sides"]

        # Rule with symbol prefix FAILS to match when symbol is omitted
        res_nosym = evaluate_active_learned_skills(current_time=now_ts, symbol=None)
        assert "learned_xauusd_new_york_buy_filter" not in res_nosym["matched_skills"]

        # Legacy rule without symbol FAILS cross-symbol application to non-Gold (EURUSD)
        res_eur = evaluate_active_learned_skills(current_time=now_ts, symbol="EURUSD")
        assert "learned_new_york_buy_filter" not in res_eur["matched_skills"]
        assert "learned_xauusd_new_york_buy_filter" not in res_eur["matched_skills"]

    # 2. In London/New York Overlap session for XAUUSD -> overlap filter matches
    with patch("app.services.signal_ingestion.context.get_trading_session", return_value="London / New York Overlap"):
        res_ov = evaluate_active_learned_skills(current_time=now_ts, symbol="XAUUSD")
        assert "learned_xauusd_london_new_york_overlap_sell_filter" in res_ov["matched_skills"]
        assert "SELL" in res_ov["allowed_sides"]


@pytest.mark.asyncio
async def test_issue8_canary_and_prod_parallel_execution(monkeypatch):
    """Issue 8: Engine evaluates and executes both APPROVED_FOR_PROD and CANARY_DEMO candidates in parallel."""
    from app.domains.execution.engine import autonomous_agent_step_async
    now_ts = 1716364800.0 + 3600.0 * 20  # A valid closed candle time
    with tx() as c:
        c.execute("DELETE FROM strategy_candidates")
        c.execute("DELETE FROM candles")
        c.execute("DELETE FROM trading_accounts")
        c.execute("DELETE FROM kv WHERE key LIKE 'agent_last_candle_ts%'")
        c.execute("INSERT INTO kv (key, value) VALUES ('signal_mode', 'ZUPIRUS_AGENT') ON CONFLICT(key) DO UPDATE SET value = 'ZUPIRUS_AGENT'")

        # Candidate 1: Production (APPROVED_FOR_PROD)
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, status, rules_json, sample_size, win_rate, created_at, updated_at)
            VALUES ('cand_prod_01', 'Prod Strategy', 'APPROVED_FOR_PROD', ?, 100, 0.70, ?, ?)
            """,
            (json.dumps({"symbol": "XAUUSD", "action": "BUY", "min_slope": 0.01}), now_ts - 3600, now_ts - 3600)
        )
        # Candidate 2: Canary (CANARY_DEMO)
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, status, rules_json, sample_size, win_rate, created_at, updated_at)
            VALUES ('cand_canary_01', 'Canary Strategy', 'CANARY_DEMO', ?, 50, 0.60, ?, ?)
            """,
            (json.dumps({"symbol": "XAUUSD", "action": "BUY", "min_slope": 0.01}), now_ts, now_ts)
        )

        # Insert admin user first for FK
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('usr_admin', 'admin@example.com', 'hash', 'admin') ON CONFLICT(id) DO NOTHING")
        c.execute(
            """
            INSERT INTO subscriptions (id, user_id, plan_tier, allow_alpha_strategies, service_expires_at, created_at, updated_at)
            VALUES ('sub_admin', 'usr_admin', 'institutional', 1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET allow_alpha_strategies = 1
            """,
            (now_ts + 86400.0, now_ts, now_ts)
        )

        # Accounts: One Live account, One Demo account
        c.execute(
            """
            INSERT INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, balance, equity, auto_trade, deployment_state, account_type, cloud_expires_at, created_at)
            VALUES 
                ('acc_live', 'usr_admin', 'meta_live', '1001', 'enc_pass', 'ICMarkets-Demo', 10000, 10000, 1, 'DEPLOYED', 'REAL', ?, ?),
                ('acc_demo', 'usr_admin', 'meta_demo', '1002', 'enc_pass', 'ICMarkets-Demo', 10000, 10000, 1, 'DEPLOYED', 'DEMO', ?, ?)
            """,
            (now_ts + 86400, now_ts, now_ts + 86400, now_ts)
        )

        # Insert 30 closed M15 candles trending up
        for i in range(30):
            t = now_ts - (30 - i) * 900
            p = 2600.0 + i * 2.0
            c.execute(
                "INSERT INTO candles (symbol, timeframe, time, open, high, low, close) VALUES ('XAUUSD', 'M15', ?, ?, ?, ?, ?)",
                (t, p - 0.5, p + 1.0, p - 1.0, p)
            )

    dispatched_signals = []

    async def mock_fan_out(signal, accounts, metaapi_client=None, redis_client=None):
        dispatched_signals.append((signal, accounts))
        return {"executed": len(accounts), "details": []}

    monkeypatch.setattr("app.metaapi.execute_fan_out_for_signal", mock_fan_out)
    monkeypatch.setattr("app.domains.signals.ingestion.context.get_fresh_live_price", lambda *args, **kwargs: 2660.0)

    res = await autonomous_agent_step_async(force_side="BUY", symbol="XAUUSD")
    assert res["status"] == "DISPATCHED"

    # Verify both signals were generated and dispatched!
    assert len(dispatched_signals) == 2

    prod_sig, prod_accs = next((s, accs) for s, accs in dispatched_signals if s["strategy_tier"] == "ALPHA")
    canary_sig, canary_accs = next((s, accs) for s, accs in dispatched_signals if s["strategy_tier"] == "CANARY")

    assert "ag_xauusd_" in prod_sig["id"]
    assert "ag_canary_xauusd_" in canary_sig["id"]
    assert canary_sig["strategy_id"] == "cand_canary_01"

    # Canary signal executed strictly on DEMO account
    canary_acc_types = [a["account_type"] for a in canary_accs]
    assert all(at in ("DEMO", "DEMO_PRO", "CENT_DEMO") for at in canary_acc_types)
    assert any(a["id"] == "acc_demo" for a in canary_accs)
    assert not any(a["id"] == "acc_live" for a in canary_accs)


def test_issue9_coordinate_strategies_preferred_session():
    """Issue 9: coordinate_strategies stands aside if candle session != preferred_session."""
    from app.domains.execution.engine import coordinate_strategies
    with tx() as c:
        c.execute("INSERT INTO kv (key, value) VALUES ('signal_mode', 'ZUPIRUS_AGENT') ON CONFLICT(key) DO UPDATE SET value = 'ZUPIRUS_AGENT'")

    # 08:00 UTC = London
    london_base = 1716364800.0
    prices = []
    for i in range(20):
        p = 2600.0 + i * 2.0
        prices.append({
            "time": london_base + i * 900,
            "open": p - 0.5,
            "high": p + 1.0,
            "low": p - 1.0,
            "close": p,
        })

    # Strategy preferring London in London session -> Generates BUY
    cand_london = {
        "id": "cand_ldn",
        "name": "London Strat",
        "rules_json": json.dumps({"symbol": "XAUUSD", "action": "BUY", "min_slope": 0.1, "preferred_session": "London"})
    }
    dec_ldn = coordinate_strategies(prices, candidate=cand_london)
    assert dec_ldn.get("side") == "BUY"

    # Strategy preferring New York evaluated in London session -> STAND_ASIDE
    cand_ny = {
        "id": "cand_ny",
        "name": "NY Strat",
        "rules_json": json.dumps({"symbol": "XAUUSD", "action": "BUY", "min_slope": 0.1, "preferred_session": "New York"})
    }
    dec_ny = coordinate_strategies(prices, candidate=cand_ny)
    assert dec_ny.get("side") is None
    assert "STAND_ASIDE" in dec_ny.get("reason", "")
    assert "không khớp với phiên ưu tiên" in dec_ny.get("reason", "")


def test_issue10_hindsight_unknown_h1_and_live_stats():
    """Issue 10: Shadow signals without H1 trend don't pollute H1 NEUTRAL cluster, and live stats govern when >= min_samples."""
    from app.domains.ai.hindsight import synthesize_inductive_rules
    now_ts = 1700000000.0
    with tx() as c:
        c.execute("DELETE FROM signal_audit_logs")
        c.execute("DELETE FROM shadow_signals")
        c.execute("DELETE FROM agent_skills")
        c.execute("DELETE FROM signal_sources WHERE id = 'src_shadow'")
        c.execute(
            """
            INSERT INTO signal_sources (id, name, source_type, trust_score, win_rate, total_signals, created_at, updated_at)
            VALUES ('src_shadow', 'Shadow Source', 'TELEGRAM', 50.0, 0.5, 0, ?, ?)
            """,
            (now_ts, now_ts)
        )

        # 30 Live winning trades with NEUTRAL H1 trend (100% win rate)
        for i in range(30):
            c.execute(
                """
                INSERT INTO signal_audit_logs (
                    id, signal_id, source_name, symbol, side, entry_price, pnl, context_snapshot, created_at, status
                ) VALUES (?, ?, 'src_live', 'XAUUSD', 'BUY', 2650.0, 50.0, ?, ?, 'EXECUTED')
                """,
                (f"live_{i}", f"sig_live_{i}", json.dumps({"session": "London", "h1_trend": "NEUTRAL"}), now_ts - i * 60)
            )

        # 50 Shadow losing trades WITHOUT h1_trend in context_snapshot
        for i in range(50):
            c.execute(
                """
                INSERT INTO shadow_signals (
                    id, source_id, symbol, side, entry_price, stop_loss, pnl_pips, eval_status, signal_time, created_at
                ) VALUES (?, 'src_shadow', 'XAUUSD', 'BUY', 2650.0, 2640.0, -20.0, 'LOSS_SL', ?, ?)
                """,
                (f"sh_{i}", now_ts - i * 60, now_ts - i * 60)
            )

        rules = synthesize_inductive_rules(c, min_samples=30)
        # Check rule created for XAUUSD London BUY NEUTRAL
        neutral_rule = next((r for r in rules if "neutral" in r.get("skill_id", "")), None)
        assert neutral_rule is not None
        # Win rate must be 1.0 (from live trades) because live_cnt >= min_samples, not diluted by 50 shadow losses
        assert neutral_rule["win_rate"] == 1.0
        assert neutral_rule["samples"] == 30


def test_issue11_relearn_approved_skill_preserves_full_markdown():
    """Issue 11: Re-registering an approved skill preserves previous markdown inside baseline code block."""
    now_ts = time.time()
    skill_id = "learned_xauusd_asia_buy_filter"
    original_md = "# Original Approved Skill MD\nProven strategy evidence with 75% winrate."

    with tx() as c:
        c.execute("DELETE FROM agent_skills WHERE skill_id = ?", (skill_id,))
        register_learned_skill(
            skill_id=skill_id,
            name="Original Approved Name",
            description="Original Approved Description",
            trigger_condition="Trigger on Asia BUY",
            skill_md=original_md,
            db_cursor=c,
            auto_approve=True,
        )
        c.execute("UPDATE agent_skills SET enabled = 1 WHERE skill_id = ?", (skill_id,))

        # Re-register with new markdown
        new_md = "# Re-learned Skill MD\nUpdated evidence with new bars."
        register_learned_skill(
            skill_id=skill_id,
            name="New Name Should Not Overwrite",
            description="New Description Should Not Overwrite",
            trigger_condition="Trigger on Asia BUY",
            skill_md=new_md,
            db_cursor=c,
            auto_approve=False,
        )

        row = c.execute("SELECT name, description, skill_md FROM agent_skills WHERE skill_id = ?", (skill_id,)).fetchone()
        assert row["name"] == "Original Approved Name"
        assert row["description"] == "Original Approved Description"
        saved_md = row["skill_md"]
        assert "## Phiên Bản Bằng Chứng Được Duyệt (Approved Baseline)" in saved_md
        assert original_md in saved_md
