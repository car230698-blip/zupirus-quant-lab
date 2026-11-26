from __future__ import annotations

import time
from typing import Any, Dict, List
import pytest
from app.domains.ai.autonomous_gate import evaluate_institutional_gate
from app.domains.ai.autonomous_pipeline import get_autonomous_pipeline_status
from app.domains.quant.studies import run_studies


def _synthetic_candles(n: int = 150) -> List[Dict[str, Any]]:
    import math
    out = []
    base = 2000.0
    for i in range(n):
        t = 1700000000 + i * 900
        shift = math.sin(i / 10.0) * 15.0 + (i * 0.2)
        c_open = base + shift
        c_high = c_open + 5.0
        c_low = c_open - 3.0
        c_close = c_open + 2.0
        out.append({
            "time": t,
            "open": c_open,
            "high": c_high,
            "low": c_low,
            "close": c_close,
            "volume": 100.0,
        })
    return out


def test_autonomous_gate_evaluation():
    candles = _synthetic_candles(120)
    bundle = run_studies(candles, symbol="XAUUSD", timeframe="M15", strategy_name="breakout_retest")
    res = evaluate_institutional_gate(bundle)
    assert res is not None
    assert isinstance(res.passed, bool)
    assert isinstance(res.score, float)
    assert res.status in ("PASS", "REJECT")
    assert isinstance(res.passed_checks, list)
    assert isinstance(res.failed_checks, list)
    assert len(res.summary_vi) > 20


def test_autonomous_pipeline_status():
    status = get_autonomous_pipeline_status()
    assert status["is_active"] is True
    assert status["ai_writer_model"] == "gemini-4-hydrogen"
    assert "last_run_timestamp" in status
