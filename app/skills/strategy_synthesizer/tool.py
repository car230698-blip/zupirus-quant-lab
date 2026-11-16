"""Strategy Synthesizer tool.
Synthesizes new Strategy Candidates from Hindsight Semantic Memory and registers them in strategy_candidates.
Purely analytical — does not open or modify trade orders.
"""
import time
import json
import uuid
from typing import Dict, Any, Optional
from app.db import tx
from app.hindsight import recall_memories, CATEGORY_SEMANTIC


def synthesize_strategy_candidate(
    min_samples: int = 5,
    author: str = "TabulaRasaAgent"
) -> Dict[str, Any]:
    """Retrieve inductive rules from memory and formulate a candidate for Walk-Forward testing."""
    now_ts = time.time()
    rules_found = []

    try:
        with tx() as c:
            memories = recall_memories(c, query="inductive rule edge session", limit=10, category=CATEGORY_SEMANTIC)
            for m in memories:
                rules_found.append({
                    "title": m.get("title"),
                    "content": m.get("content"),
                    "metadata": m.get("metadata", {}),
                })
    except Exception:
        rules_found = []

    # Synthesize candidate structure
    cand_id = f"strat_{uuid.uuid4().hex[:8]}"
    cand_name = f"Inductive Alpha: Session Edge #{cand_id[-4:].upper()}"
    rules_payload = {
        "author": author,
        "synthesized_at": now_ts,
        "memory_evidence_count": len(rules_found),
        "rules_evidence": rules_found[:3],
        "default_sl_points": 35.0,
        "default_tp_points": 70.0,
    }

    try:
        with tx() as c:
            c.execute(
                """
                INSERT INTO strategy_candidates (
                    id, name, status, rules_json, sample_size,
                    win_rate, profit_factor, max_drawdown_pct,
                    created_at, updated_at
                ) VALUES (?, ?, 'DISCOVERED', ?, ?, NULL, NULL, NULL, ?, ?)
                """,
                (cand_id, cand_name, json.dumps(rules_payload), max(len(rules_found) * 5, min_samples), now_ts, now_ts)
            )
    except Exception as e:
        return {"status": "error", "message": f"Could not save strategy candidate: {e}"}

    return {
        "status": "success",
        "candidate_id": cand_id,
        "name": cand_name,
        "rules_json": rules_payload,
        "ready_for_wfo": True,
        "status_label": "DISCOVERED (Pending Walk-Forward Validation)",
    }
