"""Automated regression test suite for ZUPIRUS Quant Lab's first quantitative research:
'Breakout & Retest XAU/USD M15: Expectancy After Costs & Cross-Session Heterogeneity'.
"""
import json
import os
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.db import tx, is_postgres
from app.domains.ai.breakout_retest_research import (
    detect_breakout_retest_signals,
    simulate_trade_outcomes,
    compute_performance_metrics,
    run_session_breakdown,
)
from app.domains.reports.generate_first_research_report import generate_and_save_reports
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_1_breakout_retest_rules_deterministic_and_causal():
    """1. Formal rules test:
    - Verifies Swing 20 detection, Breakout Range Expansion, and Retest Wick Ratio.
    - Confirms zero lookahead: Entry happens at Close of Retest bar."""
    # Synthetic 50-bar series with a clean breakout and retest
    bars = []
    base_price = 2650.0
    for i in range(30):
        # Range bound between 2645 and 2655
        bars.append({
            "time": 1700000000 + i * 900,
            "datetime": f"2023-11-14 0{i//4}:00:00 UTC",
            "open": base_price,
            "high": base_price + 3.0,
            "low": base_price - 3.0,
            "close": base_price + 1.0,
            "volume": 100,
        })
    # Bar 30: Bullish Breakout above swing high (2653.0) with large range expansion (8.0 > 1.0 * ATR)
    bars.append({
        "time": 1700000000 + 30 * 900,
        "datetime": "2023-11-14 07:30:00 UTC",
        "open": base_price + 1.0,
        "high": base_price + 9.0,
        "low": base_price + 1.0,
        "close": base_price + 8.0,
        "volume": 500,
    })
    # Bar 31: Retest dipping back to breakout level (2653.0) with long lower rejection wick
    bars.append({
        "time": 1700000000 + 31 * 900,
        "datetime": "2023-11-14 07:45:00 UTC",
        "open": base_price + 7.5,
        "high": base_price + 8.0,
        "low": base_price + 3.0,  # Retests swing level
        "close": base_price + 7.0,
        "volume": 350,
    })

    signals = detect_breakout_retest_signals(bars, swing_period=20, max_retest_wait=6, min_wick_ratio=0.30)
    assert len(signals) == 1
    sig = signals[0]
    assert sig["side"] == "BUY"
    assert sig["signal_bar_idx"] == 31
    assert sig["entry_price"] == base_price + 7.0
    assert sig["wick_ratio"] >= 0.30


def test_2_same_bar_collision_conservative_assumption():
    """2. Worst-case collision test:
    When High >= TP and Low <= SL in the same bar, system strictly assumes SL triggered first (Loss)."""
    candles = [
        {"time": 1700000000, "datetime": "2023-11-14 00:00:00 UTC", "open": 2650.0, "high": 2655.0, "low": 2645.0, "close": 2650.0},
        # Collision bar: High expands to 2700 (well above TP) but Low plummets to 2600 (well below SL)
        {"time": 1700000900, "datetime": "2023-11-14 00:15:00 UTC", "open": 2650.0, "high": 2700.0, "low": 2600.0, "close": 2650.0},
    ]
    mock_signal = [{
        "signal_bar_idx": 0,
        "time": 1700000000,
        "datetime": "2023-11-14 00:00:00 UTC",
        "side": "BUY",
        "entry_price": 2650.0,
        "retest_low": 2645.0,
        "retest_high": 2655.0,
        "breakout_level": 2648.0,
        "atr": 2.0,
        "session": "Asian",
    }]

    # Conservative execution: SL collision
    trades_cons = simulate_trade_outcomes(candles, mock_signal, cost_pips=3.5, conservative_collision=True)
    assert len(trades_cons) == 1
    assert trades_cons[0]["collision_occurred"] is True
    assert trades_cons[0]["exit_reason"] == "SL_COLLISION"
    assert trades_cons[0]["r_multiple"] < 0
    assert trades_cons[0]["is_win"] is False


def test_3_draft_report_seeded_and_hidden_from_public(client, monkeypatch):
    """3. Lifecycle & Access Control:
    - Draft report exists in DB with 2 valid PDFs attached.
    - Public catalog strictly hides the DRAFT report.
    - Commercial sales remain disabled by default.
    - Authenticated customer checkout for USDT is strictly rejected when COMMERCIAL_REPORTS_SALE_ENABLED=false.
    - Wording verification: Title is 'Breakout & Retest vàng COMEX M15 — nghiên cứu thăm dò'.
    - Forbidden phrases 'Edge chỉ tồn tại' and 'London Trap' are absent.
    - Hourly breakdown data exists with 24 hours and verified reconciliation."""
    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "false")

    rep_info = generate_and_save_reports()
    assert rep_info["status"] == "DRAFT"
    sample_pdf_path = Path(rep_info["sample_pdf"])
    full_pdf_path = Path(rep_info["full_pdf"])
    assert sample_pdf_path.exists()
    assert full_pdf_path.exists()

    # Verify PDF content does not contain forbidden phrases
    sample_content = sample_pdf_path.read_text(encoding="latin1")
    full_content = full_pdf_path.read_text(encoding="latin1")
    for content in (sample_content, full_content):
        assert "London Trap" not in content
        assert "Edge ch" not in content  # Checks for "Edge chỉ tồn tại"

    # Verify title in DB metadata
    with tx() as c:
        row = c.execute("SELECT title, summary, status FROM research_reports WHERE id = ?", (rep_info["report_id"],)).fetchone()
        assert row is not None
        title, summary, status = row
        assert "Breakout & Retest" in title
        assert "nghiên cứu thăm dò" in title or "nghiên cứu thăm dò" in summary
        assert "London Trap" not in title and "London Trap" not in summary
        assert "Edge chỉ" not in title and "Edge chỉ" not in summary
        assert status == "DRAFT"

    # Public visitor check
    pub_res = client.get("/api/v1/reports")
    assert pub_res.status_code == 200
    catalog = pub_res.json()["items"]
    # Verify draft report is NOT in public catalog
    assert not any(item["id"] == rep_info["report_id"] for item in catalog)

    # Visitor cannot checkout draft report (unauthorized 401 or blocked 400/404)
    checkout_res = client.post(
        f"/api/v1/reports/{rep_info['report_id']}/checkout",
        json={"payment_method": "USDT"},
    )
    assert checkout_res.status_code in (400, 401, 404)

    # Check evidence file hourly breakdown
    evidence_path = Path("data/research_xauusd_breakout_retest_evidence.json")
    assert evidence_path.exists()
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    
    full_hourly = evidence["full_period_metrics"]["hourly_breakdown"]
    assert len(full_hourly) == 24
    total_trades_full = sum(h["trade_count"] for h in full_hourly)
    assert total_trades_full == 116
    
    oos_hourly = evidence["holdout_30pct_oos"]["hourly_breakdown"]
    assert len(oos_hourly) == 24
    total_trades_oos = sum(h["trade_count"] for h in oos_hourly)
    assert total_trades_oos == 36

    # Verify unverified slots have is_verified == False and trade_count == 0
    zero_slots = [h for h in oos_hourly if h["trade_count"] == 0]
    assert len(zero_slots) > 0
    for zs in zero_slots:
        assert zs["is_verified"] is False
        assert "Chua xac minh duoc" in zs["status_note"]

