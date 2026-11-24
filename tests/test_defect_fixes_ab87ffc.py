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
        strategy_tier="ALPHA",
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
