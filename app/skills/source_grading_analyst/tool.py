"""Source Grading Analyst tool.
Executes EOD M1 Candle Grader for SHADOW_ONLY signal sources and updates Trust Scores.
Purely analytical — does not open or modify trade orders.
"""
from typing import Dict, Any, Optional
from app.services.sources.curator import (
    evaluate_shadow_signals_eod,
    get_source_leaderboard,
    list_sources,
)


def grade_signal_sources(
    source_id: Optional[str] = None
) -> Dict[str, Any]:
    """Grade pending shadow signals against M1 candles and update leaderboard."""
    eval_result = evaluate_shadow_signals_eod(source_id=source_id)
    leaderboard = get_source_leaderboard()
    sources = list_sources()

    top_source = leaderboard[0] if leaderboard else None

    return {
        "status": "success",
        "evaluated_count": eval_result.get("evaluated_count", 0),
        "total_sources_tracked": len(sources),
        "active_live_count": sum(1 for s in sources if s.get("status") == "ACTIVE_LIVE"),
        "top_source": top_source,
        "leaderboard_sample": leaderboard[:3],
        "eval_details": eval_result,
    }
