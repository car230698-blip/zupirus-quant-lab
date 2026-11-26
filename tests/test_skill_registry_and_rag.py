import pytest
import time
import json
from unittest.mock import MagicMock

from app.db import tx, init
from app.skills.registry import evaluate_active_learned_skills
from app.domains.signals.sources.curator import score_external_signal_hybrid
from app.domains.ai.ingest_swarm import retrieve_relevant_knowledge, embed_text


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    """Isolate this module on a private SQLite file.

    Clearing module DATABASE_URL / pool is required so CI Postgres is not wiped
    by DELETE FROM signal_sources in these unit tests.
    """
    test_db = tmp_path / "test_skills_rag.db"
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr("app.core.db.DATABASE_URL", "")
    monkeypatch.setattr("app.core.db._pg_pool", None)
    monkeypatch.setattr("app.core.db.DB", test_db)
    monkeypatch.setattr("app.db.DATABASE_URL", "")
    monkeypatch.setattr("app.db._pg_pool", None)
    monkeypatch.setattr("app.db.DB", test_db)
    init()
    yield


def test_evaluate_active_learned_skills_matches_contextual_edge_filters():
    """Verify that evaluate_active_learned_skills recognizes _neutral_filter and contextual qualifiers."""
    now_ts = 1700000000.0  # arbitrary timestamp

    # Mock get_trading_session to return 'Asia'
    from unittest.mock import patch

    with tx() as c:
        c.execute("DELETE FROM agent_skills")
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES 
                ('sk_1', 'learned_asia_sell_neutral_filter', 'Asia Sell Neutral Filter', 'Desc', 'Trigger', 0, 1, 'md', ?, ?),
                ('sk_2', 'learned_new_york_sell_neutral_filter', 'NY Sell Filter', 'Desc', 'Trigger', 0, 1, 'md', ?, ?),
                ('sk_3', 'learned_asia_buy_avoid', 'Asia Buy Avoid', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts, now_ts, now_ts, now_ts, now_ts)
        )

    with patch("app.services.signal_ingestion.context.get_trading_session", return_value="Asia"):
        # Case 1: without context trend specified -> contextual neutral filter does not match, but unconstrained avoid rule matches
        res = evaluate_active_learned_skills(current_time=now_ts)
        assert res["session"] == "Asia"
        assert "SELL" not in res["allowed_sides"]
        assert "BUY" in res["blocked_sides"]
        assert "learned_asia_buy_avoid" in res["matched_skills"]
        assert "learned_asia_sell_neutral_filter" not in res["matched_skills"]

        # Case 2: with matching context trend ('neutral')
        res_matching = evaluate_active_learned_skills(current_time=now_ts, context_snapshot={"h1_trend": "neutral"})
        assert "SELL" in res_matching["allowed_sides"]
        assert "learned_asia_sell_neutral_filter" in res_matching["matched_skills"]

        # Case 3: with conflicting context trend ('bullish' != 'neutral')
        res_conflicting = evaluate_active_learned_skills(current_time=now_ts, context_snapshot={"h1_trend": "bullish"})
        assert "SELL" not in res_conflicting["allowed_sides"]
        assert "learned_asia_sell_neutral_filter" not in res_conflicting["matched_skills"]
        # avoid guard still applies because it has no conflicting context
        assert "BUY" in res_conflicting["blocked_sides"]


def test_score_external_signal_hybrid_edge_boost():
    """Verify that score_external_signal_hybrid boosts trust score when signal aligns with active edge filter."""
    now_ts = time.time()
    from unittest.mock import patch

    with tx() as c:
        c.execute("DELETE FROM signal_sources")
        c.execute("DELETE FROM agent_skills")
        c.execute(
            """
            INSERT INTO signal_sources (id, name, source_type, trust_score, win_rate, total_signals, created_at, updated_at)
            VALUES ('src_test', 'Test Source', 'WEBHOOK', 60.0, 0.65, 100, ?, ?)
            """,
            (now_ts, now_ts)
        )
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES ('sk_edge', 'learned_asia_sell_neutral_filter', 'Edge Filter', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts)
        )

    signal_sell = {"source": "src_test", "action": "SELL", "symbol": "XAUUSD"}
    signal_buy = {"source": "src_test", "action": "BUY", "symbol": "XAUUSD"}

    with patch("app.services.signal_ingestion.context.get_trading_session", return_value="Asia"):
        with tx() as c:
            # SELL matches edge filter -> boosted by 15.0 (60.0 -> 75.0)
            approved_sell, score_sell, reason_sell = score_external_signal_hybrid(
                c, signal_sell, context_snapshot={"h1_trend": "neutral", "captured_at": now_ts}
            )
            assert approved_sell is True
            assert score_sell == 75.0
            assert reason_sell == "HYBRID_SCORER_APPROVED_WITH_EDGE_BOOST"

            # BUY does not match edge filter -> standard trust score 60.0
            approved_buy, score_buy, reason_buy = score_external_signal_hybrid(
                c, signal_buy, context_snapshot={"h1_trend": "neutral", "captured_at": now_ts}
            )
            assert approved_buy is True
            assert score_buy == 60.0
            assert reason_buy == "HYBRID_SCORER_APPROVED"


def test_retrieve_relevant_knowledge_respects_enabled_flag():
    """Verify that retrieve_relevant_knowledge excludes chunks from disabled agent_skills."""
    now_ts = time.time()
    dummy_vec = embed_text("gold breakout order block")

    with tx() as c:
        c.execute("DELETE FROM agent_skills")
        c.execute("DELETE FROM knowledge_chunks")

        # 1. Enabled skill
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES ('sk_en', 'doc_smc_active', 'SMC Active', 'Desc', 'Trigger', 0, 1, 'md', ?, ?)
            """,
            (now_ts, now_ts)
        )
        # 2. Disabled skill
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, is_builtin, enabled, skill_md, created_at, updated_at)
            VALUES ('sk_dis', 'doc_macro_disabled', 'Macro Disabled', 'Desc', 'Trigger', 0, 0, 'md', ?, ?)
            """,
            (now_ts, now_ts)
        )

        # Knowledge chunks for both skills
        c.execute(
            """
            INSERT INTO knowledge_chunks (id, skill_id, school, doc_type, chunk_index, content, embedding_json, created_at)
            VALUES 
                ('chk_1', 'doc_smc_active', 'SMC', 'PDF', 0, 'SMC Order Block Content', ?, ?),
                ('chk_2', 'doc_macro_disabled', 'MACRO', 'PDF', 0, 'Macro Policy Content', ?, ?)
            """,
            (json.dumps(dummy_vec), now_ts, json.dumps(dummy_vec), now_ts)
        )

        chunks = retrieve_relevant_knowledge(c, query="gold breakout order block", top_k=10)
        retrieved_skill_ids = [chk["skill_id"] for chk in chunks]

        # Only doc_smc_active should be present; doc_macro_disabled MUST be filtered out
        assert "doc_smc_active" in retrieved_skill_ids
        assert "doc_macro_disabled" not in retrieved_skill_ids
