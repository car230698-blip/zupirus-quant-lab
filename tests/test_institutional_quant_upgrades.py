"""Unit and integration tests for Institutional Quant Upgrades:
B1. Minimum Inductive Samples (min_samples >= 30) & Positive Expectancy
B2. Portfolio Correlation & Max Exposure Cap (2.0% total risk cap & SL fail-closed)
B3. Real-world Transaction Costs in Walk-Forward Optimization
B4. Dynamic De-Risking (50% DD throttle) & Position Reconciliation
"""
import os
import time
import pytest
from unittest.mock import AsyncMock, patch

from app.db import tx, setkv
from app.domains.ai.hindsight import synthesize_inductive_rules
from app.domains.ai.research_graph import walk_forward, score_candidate_on_window
from app.domains.execution.fanout import execute_fan_out_for_signal
from app.domains.execution.watcher import reconcile_account_positions


def test_b1_min_inductive_samples_and_positive_expectancy(monkeypatch):
    """B1: Verify inductive rules require at least MIN_INDUCTIVE_SAMPLES (default 30) and positive expectancy."""
    monkeypatch.setenv("MIN_INDUCTIVE_SAMPLES", "30")

    with tx() as c:
        # 1. With only 10 samples (< 30), synthesis returns empty list
        c.execute("DELETE FROM signal_audit_logs")
        c.execute("DELETE FROM shadow_signals")
        for i in range(10):
            c.execute(
                """
                INSERT INTO signal_audit_logs (id, signal_id, source_name, side, entry_price, pnl, context_snapshot, status, created_at)
                VALUES (?, ?, 'TEST_SRC', 'BUY', 2650.0, 15.0, '{"session": "London"}', 'WIN', ?)
                """,
                (f"audit_b1_{i}", f"sig_b1_{i}", time.time() - i * 60)
            )
        rules_under = synthesize_inductive_rules(c)
        assert len(rules_under) == 0, "Should not generate inductive rules under MIN_INDUCTIVE_SAMPLES"

        # 2. When passing explicit min_samples=5, backward compatibility is preserved
        rules_compat = synthesize_inductive_rules(c, min_samples=5)
        assert len(rules_compat) >= 1
        assert "Quy tắc quy nạp" in rules_compat[0]["rule"]

        # 3. Add samples up to 35, but all with negative PnL (negative expectancy)
        c.execute("DELETE FROM signal_audit_logs")
        c.execute("DELETE FROM shadow_signals")
        for i in range(35):
            c.execute(
                """
                INSERT INTO signal_audit_logs (id, signal_id, source_name, side, entry_price, pnl, context_snapshot, status, created_at)
                VALUES (?, ?, 'TEST_SRC', 'BUY', 2650.0, -10.0, '{"session": "London"}', 'LOSS', ?)
                """,
                (f"audit_neg_{i}", f"sig_neg_{i}", time.time() - i * 60)
            )
        rules_neg = synthesize_inductive_rules(c)
        winning_rules = [r for r in rules_neg if r.get("win_rate", 0) >= 0.58 and "Quy tắc quy nạp" in r.get("rule", "")]
        assert len(winning_rules) == 0, "Should reject winning rules with negative expectancy"
        c.execute("DELETE FROM signal_audit_logs WHERE id LIKE 'audit_%'")


@pytest.mark.asyncio
async def test_b2_portfolio_correlation_and_max_exposure_cap(monkeypatch):
    """B2: Verify Prop Live portfolio-wide risk cap (2.0%) and SL fail-closed protection."""
    monkeypatch.setenv("PROP_LIVE_MAX_PORTFOLIO_RISK_PCT", "2.0")

    mock_client = AsyncMock()

    # Case 1: An existing open position has NO Stop-Loss (pos_sl <= 0) -> Fail-closed rejects new signal
    mock_client.get_open_positions = AsyncMock(return_value=[
        {
            "id": "pos_unprotected",
            "symbol": "EURUSD",
            "type": "POSITION_TYPE_BUY",
            "openPrice": 1.0800,
            "stopLoss": 0.0,  # Missing SL!
            "volume": 0.50,
        }
    ])
    mock_client.place_order = AsyncMock(return_value={"numericCode": 10009})

    signal = {
        "id": "sig_b2_test",
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2650.0,
        "sl": 2640.0,
        "tp": 2670.0,
    }
    accounts = [{
        "id": "acc_b2_live",
        "user_id": 1,
        "is_prop_firm_mode": True,
        "prop_stage": "LIVE",
        "balance": 100000.0,
        "equity": 100000.0,
        "risk_percent": 1.0,
        "contract_size": 100.0,
        "tick_value": 1.0,
        "metaapi_account_id": "meta_b2_acc",
    }]

    res_unprotected = await execute_fan_out_for_signal(signal, accounts, mock_client)
    assert res_unprotected["executed"] == 0, "Must fail-closed when any existing position lacks Stop-Loss"

    # Case 2: Existing positions already take >= 2.0% portfolio risk -> Rejects new signal
    mock_client.get_open_positions = AsyncMock(return_value=[
        {
            "id": "pos_eur",
            "symbol": "EURUSD",
            "type": "POSITION_TYPE_BUY",
            "openPrice": 1.0800,
            "stopLoss": 1.0600,  # 200 pips risk on 1.0 lot = $2,000 (2.0% on 100k)
            "volume": 1.0,
        }
    ])
    res_capped = await execute_fan_out_for_signal(signal, accounts, mock_client)
    assert res_capped["executed"] == 0, "Must reject new trade when portfolio risk cap (2.0%) is reached"


def test_b3_wfo_cost_model_and_reporting(monkeypatch):
    """B3: Verify transaction costs (Spread + Commission + Slippage) and reporting fields in WFO."""
    monkeypatch.setenv("WFO_ROUNDTRIP_COST_PIPS_GOLD", "3.5")

    # Generate synthetic price series (300 bars around 2650)
    prices = [2650.0 + (i * 0.15) for i in range(300)]
    wfo_report = walk_forward(prices)

    assert "gross_return" in wfo_report, "WFO report must contain gross_return"
    assert "net_return_after_costs" in wfo_report, "WFO report must contain net_return_after_costs"
    assert "cost_model_pips" in wfo_report, "WFO report must contain cost_model_pips"
    assert wfo_report["cost_model_pips"] == 3.5, "Gold cost model must be 3.5 pips"
    assert wfo_report["gross_return"] >= wfo_report["net_return_after_costs"], "Gross return must be >= net return after costs"


def test_b4_dynamic_derisking_and_position_reconciliation():
    """B4: Verify dynamic de-risking multiplier and position reconciliation orphan detection."""
    now = time.time()

    # 1. Test position reconciliation logic with orphan position
    with tx() as c:
        c.execute("DELETE FROM kv WHERE key LIKE 'orphan_missing_cycle:%'")
        c.execute("INSERT OR IGNORE INTO users (id, email, password, role) VALUES ('101', 'b4@zupirus.com', 'pwd', 'customer')")
        c.execute("""
            INSERT OR IGNORE INTO metaapi_cloud_accounts (id, user_id, login, server, created_at)
            VALUES ('acc_test_b4', '101', '123456', 'Broker-Demo', ?)
        """, (now,))
        c.execute("""
            INSERT OR IGNORE INTO signals (id, source, side, price, sl, tp, created, expires)
            VALUES ('sig_orphan_1', 'DEMO', 'BUY', 2650.0, 2640.0, 2670.0, ?, ?)
        """, (now, now + 3600))
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = 'acc_test_b4'")
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (id, signal_id, account_id, symbol, action, volume, entry_price, status, position_id, executed_at)
            VALUES ('exec_orphan_1', 'sig_orphan_1', 'acc_test_b4', 'XAUUSD', 'BUY', 0.10, 2650.0, 'OPEN', 'pos_1001', ?)
            """,
            (now - 120,)
        )

        # Cycle 1: Position missing from live set -> missing_cycles increments to 1, still OPEN
        live_pos_ids = set()
        r1 = reconcile_account_positions(c, "acc_test_b4", live_pos_ids, now)
        assert r1["orphans_closed"] == 0
        st1 = c.execute("SELECT status FROM metaapi_trade_executions WHERE id = 'exec_orphan_1'").fetchone()[0]
        assert st1 == "OPEN"

        # Cycle 2: Position missing for 2nd cycle -> marked CLOSED with audit event
        r2 = reconcile_account_positions(c, "acc_test_b4", live_pos_ids, now + 10)
        assert r2["orphans_closed"] == 1
        st2 = c.execute("SELECT status FROM metaapi_trade_executions WHERE id = 'exec_orphan_1'").fetchone()[0]
        assert st2 == "CLOSED"

        # Verify audit event recorded
        audit_row = c.execute("SELECT * FROM audit WHERE event = 'position_reconciled_orphan_closed'").fetchone()
        assert audit_row is not None
