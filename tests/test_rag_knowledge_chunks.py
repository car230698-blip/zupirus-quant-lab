import time
import json
import pytest
from app.db import init, tx, DATA
from app.domains.ai.ingest_swarm import (
    chunk_text,
    embed_text,
    retrieve_relevant_knowledge,
    execute_4agent_ingest_pipeline,
)


def test_chunk_text_boundaries_and_overlap():
    sample_text = (
        "# 1. SMC Strategy Overview\n\n"
        + "The Smart Money Concept focuses on identifying institutional order blocks and liquidity pools. " * 15
        + "\n\n## 2. Risk Rules\n\n"
        + "Always enforce hard stop-loss. Never trade before high-impact economic news releases. " * 15
    )
    chunks = chunk_text(sample_text, chunk_size=400, overlap=50)
    assert len(chunks) >= 3
    for chk in chunks:
        assert len(chk) > 0
        assert len(chk) <= 450  # allows small boundary tolerance


def test_embed_text_deterministic_unit_vector():
    vec1 = embed_text("XAUUSD gold breakout strategy")
    vec2 = embed_text("XAUUSD gold breakout strategy")
    vec_diff = embed_text("Federal Reserve interest rate hike FOMC")

    assert len(vec1) == 768
    assert len(vec2) == 768
    assert len(vec_diff) == 768
    assert vec1 == vec2  # deterministic

    # Cosine similarity of vec1 with itself should be ~1.0
    dot_self = sum(a * b for a, b in zip(vec1, vec1))
    assert abs(dot_self - 1.0) < 1e-3


def test_rag_ingest_and_retrieval(tmp_path):
    init()
    content = (
        "# Federal Reserve Monetary Policy Guide\n\n"
        "The Federal Reserve sets interest rate policy to control inflation and employment. "
        "When inflation exceeds the 2% target, the FOMC increases the federal funds rate. "
        "A hawkish Fed strengthens the US dollar (DXY) and exerts downward pressure on gold prices.\n\n"
        "## Trading Execution Rules\n\n"
        "Always enforce fail-closed Stop-Loss rules on gold positions before FOMC announcements."
    )

    packaged = execute_4agent_ingest_pipeline(
        filename="fed_macro_policy.txt",
        content_bytes=content.encode("utf-8"),
        title="Fed Macro Policy & Gold",
    )

    assert packaged["school"] == "MACRO_FED"
    assert "chunks" in packaged
    assert len(packaged["chunks"]) >= 1

    # Persist to database
    skill_id = packaged["id"]
    now = time.time()
    with tx() as c:
        c.execute("DELETE FROM knowledge_chunks WHERE skill_id = ?", (skill_id,))
        c.execute(
            """
            INSERT INTO agent_skills (id, skill_id, name, description, trigger_condition, skill_md, is_builtin, usage_count, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'on_demand', '', 1, 0, 1, ?, ?)
            ON CONFLICT(skill_id) DO UPDATE SET enabled = 1
            """,
            (f"rec_{skill_id}", skill_id, "Fed Macro Policy", "Document skill for fed policy", now, now),
        )
        for chk in packaged["chunks"]:
            c.execute(
                """
                INSERT INTO knowledge_chunks (id, skill_id, school, doc_type, chunk_index, content, embedding_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chk["id"],
                    skill_id,
                    packaged["school"],
                    packaged["doc_type"],
                    chk["chunk_index"],
                    chk["content"],
                    json.dumps(chk["embedding"]),
                    now,
                ),
            )

        # Query via retrieve_relevant_knowledge
        results = retrieve_relevant_knowledge(c, query="FOMC federal reserve interest rate inflation", top_k=2)
        assert len(results) > 0
        assert results[0]["skill_id"] == skill_id
        assert results[0]["school"] == "MACRO_FED"
        assert results[0]["similarity"] > 0.0
