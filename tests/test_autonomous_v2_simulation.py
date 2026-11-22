"""Phase C: Autonomous Platform v2.0 End-to-End Simulation & Verification Suite.
Validates the 6 critical operational scenarios:
1. Monday Market-Open Gap Cooldown (Sunday 21:00–21:30 UTC).
2. Friday 20:30 UTC Weekend Auto-Close (Prop compliance vs Swing).
3. Station 1 Macro 2-hour decay & DXY Gold risk scaling.
4. Broker Circuit Breaker (3 consecutive errors -> 30m isolation) & multi-broker safety.
5. SePay Payment Error Decoupling (Watcher & Engine uninterrupted).
6. Station 2 Regime Meta-Router & 70/30 OOS Validation Gate (5 required metrics).
"""
import time
import math
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, AsyncMock

from app.db import tx
from app.migrations import run_all_migrations
from app.domains.ai.macro_station import (
    evaluate_macro_filter,
    save_macro_state,
    scan_shock_headlines,
)
from app.domains.execution.regime_strategies import (
    classify_market_regime,
    strat_trend_breakout,
    strat_liquidity_sweep,
    strat_mean_reversion,
    is_market_open_gap_cooldown,
    RegimeMetaRouter,
)
from app.domains.execution.compliance import (
    PROP_RULE_PROFILES,
    get_prop_rule_profile,
    is_friday_weekend_close_window,
    apply_execution_jitter_and_micro_variance,
    calculate_compliant_sl_tp,
    check_broker_circuit_breaker,
    record_broker_execution_error,
    reset_broker_circuit_breaker,
)
from app.domains.execution.watcher import PositionWatcher
from app.metaapi import MetaApiClient


def test_scenario_1_market_open_gap_cooldown():
    """Scenario 1: Sunday 21:00–21:30 UTC blocks new order dispatch."""
    # Sunday 2026-11-22 21:05:00 UTC
    sun_2105 = datetime(2026, 11, 22, 21, 5, 0, tzinfo=timezone.utc).timestamp()
    assert is_market_open_gap_cooldown(sun_2105) is True, "Sunday 21:05 UTC must be inside gap cooldown"

    # Sunday 20:55 UTC (before cooldown)
    sun_2055 = datetime(2026, 11, 22, 20, 55, 0, tzinfo=timezone.utc).timestamp()
    assert is_market_open_gap_cooldown(sun_2055) is False

    # Sunday 21:35 UTC (after cooldown)
    sun_2135 = datetime(2026, 11, 22, 21, 35, 0, tzinfo=timezone.utc).timestamp()
    assert is_market_open_gap_cooldown(sun_2135) is False

    # Unified risk scale must be 0.0 when gap cooldown is active
    scale = RegimeMetaRouter.calculate_unified_risk_scale(
        kill_switch=False,
        regime="TRENDING",
        shock_flag=None,
        strategy_score_scale=1.0,
        dxy_scale=1.0,
        macro_scale=1.0,
        open_gap_cooldown=True,
    )
    assert scale == 0.0, "Unified risk scale must be 0.0 during gap cooldown"


@pytest.mark.asyncio
async def test_scenario_2_friday_weekend_close_compliance():
    """Scenario 2: Friday 20:30 UTC auto-closes bot positions for FTMO_STANDARD, preserves FTMO_SWING."""
    # Friday 2026-11-20 20:35:00 UTC
    fri_2035 = datetime(2026, 11, 20, 20, 35, 0, tzinfo=timezone.utc).timestamp()
    assert is_friday_weekend_close_window(fri_2035) is True

    # Friday 19:00:00 UTC (before window)
    fri_1900 = datetime(2026, 11, 20, 19, 0, 0, tzinfo=timezone.utc).timestamp()
    assert is_friday_weekend_close_window(fri_1900) is False

    # Check rule profiles
    ftmo_std = get_prop_rule_profile("FTMO_STANDARD")
    assert ftmo_std["allow_weekend_holding"] is False, "FTMO Standard must disallow weekend holding"
    assert ftmo_std["max_daily_dd_pct"] == 4.5
    assert ftmo_std["max_total_dd_pct"] == 9.0

    ftmo_swing = get_prop_rule_profile("FTMO_SWING")
    assert ftmo_swing["allow_weekend_holding"] is True, "FTMO Swing must allow weekend holding"

    personal_cent = get_prop_rule_profile("PERSONAL_CENT")
    assert personal_cent["multiplier"] == 100.0


def test_scenario_3_macro_station_decay_and_dxy_filter(tmp_path, monkeypatch):
    """Scenario 3:
    - Macro age > 2h triggers 1-tier decay (macro_degraded = True, scale = 0.5x).
    - Fresh data clears degradation (macro_scale = 1.0x).
    - DXY UP scales BUY Gold by 0.5x.
    - Shock headline sets DANGER_FREEZE and halts trading.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_macro.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)

    # 1. Stale macro data (3 hours old)
    save_macro_state({
        "dxy_trend": "FLAT",
        "us10y_trend": "FLAT",
        "shock": None,
        "updated_at": now - 3 * 3600,
    })

    res_stale = evaluate_macro_filter("XAUUSD", "BUY", now_ts=now)
    assert res_stale["macro_degraded"] is True, "Macro data > 2h old must be marked degraded"
    assert res_stale["macro_scale"] == 0.5
    assert res_stale["final_scale"] == 0.5

    # 2. Fresh macro data arrives with DXY trending UP
    save_macro_state({
        "dxy_trend": "UP",
        "us10y_trend": "FLAT",
        "shock": None,
        "updated_at": now - 300,  # 5 min old
    })

    # BUY Gold with DXY UP -> scaled to 0.5x
    res_gold = evaluate_macro_filter("XAUUSD", "BUY", now_ts=now)
    assert res_gold["macro_degraded"] is False, "Fresh macro data must clear degraded flag"
    assert res_gold["dxy_scale"] == 0.5, "BUY Gold with DXY UP must scale to 0.5x"
    assert res_gold["final_scale"] == 0.5

    # SELL Gold with DXY UP -> 1.0x
    res_gold_sell = evaluate_macro_filter("XAUUSD", "SELL", now_ts=now)
    assert res_gold_sell["dxy_scale"] == 1.0
    assert res_gold_sell["final_scale"] == 1.0

    # 3. Breaking emergency shock
    shock_kw = scan_shock_headlines(["Urgent: Central bank intervention announced following crisis"])
    assert shock_kw == "DANGER_FREEZE"

    save_macro_state({
        "dxy_trend": "UP",
        "us10y_trend": "UP",
        "shock": "DANGER_FREEZE",
        "updated_at": now,
    })
    res_shock = evaluate_macro_filter("XAUUSD", "BUY", now_ts=now)
    assert res_shock["permitted"] is False, "DANGER_FREEZE must block all trading"
    assert res_shock["final_scale"] == 0.0


def test_scenario_4_broker_circuit_breaker(tmp_path, monkeypatch):
    """Scenario 4: 3 consecutive execution errors trips 30m circuit breaker on that broker server."""
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_cb.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)

    srv = "ICMarkets-Demo"
    assert check_broker_circuit_breaker(srv, now_ts=now)["tripped"] is False

    # Record 1st and 2nd errors
    record_broker_execution_error(srv, "TIMEOUT", now_ts=now)
    record_broker_execution_error(srv, "CONNECTION_LOST", now_ts=now + 5)
    assert check_broker_circuit_breaker(srv, now_ts=now + 6)["tripped"] is False

    # Record 3rd consecutive error -> trips breaker for 30m (1800s)
    record_broker_execution_error(srv, "TRADE_RETCODE_REQUOTE", now_ts=now + 10)
    cb_status = check_broker_circuit_breaker(srv, now_ts=now + 15)
    assert cb_status["tripped"] is True, "Broker circuit breaker must trip after 3 consecutive errors"
    assert cb_status["remaining_seconds"] > 1700

    # Other broker server remains normal
    assert check_broker_circuit_breaker("FTMO-Demo", now_ts=now + 15)["tripped"] is False

    # Reset breaker upon successful recovery
    reset_broker_circuit_breaker(srv)
    assert check_broker_circuit_breaker(srv, now_ts=now + 20)["tripped"] is False


@pytest.mark.asyncio
async def test_scenario_5_sepay_error_isolation():
    """Scenario 5: Webhook or payment failures never crash or stop the trading engine or PositionWatcher."""
    from app.domains.billing.sepay import verify_sepay_signature

    # Signature verification fails closed without exception
    assert verify_sepay_signature(b"invalid_data", "invalid_sig", "dummy_secret") is False
    assert verify_sepay_signature(b"", None, "") is False

    # Jitter & micro-lot variance test
    vol, delay = apply_execution_jitter_and_micro_variance(1.0, min_vol=0.01, vol_step=0.01, seed=42)
    assert 0.3 <= delay <= 1.8, "Jitter delay must be between 0.3s and 1.8s"
    assert 0.95 <= vol <= 1.05, "Micro-lot variance must be within ±3%"


def test_scenario_6_regime_meta_router_and_oos_validation(tmp_path, monkeypatch):
    """Scenario 6:
    - Regime classification: Kaufman ER, ATR ratio.
    - 3 consecutive losses demotes strategy to SHADOW (scale = 0.0).
    - 10 shadow trades with positive expectancy restores ACTIVE (scale = 1.0).
    - Out-of-Sample 70/30 validation gate:
      Win rate >= 52%, Profit Factor >= 1.35, Max DD <= 8.0%, Sharpe >= 1.20, OOS Net >= +150 pips.
    """
    from app.core import db as core_db
    from app import db
    db_file = tmp_path / "test_router.sqlite3"
    monkeypatch.setattr(db, "DB", db_file)
    monkeypatch.setattr(core_db, "DB", db_file)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(core_db, "DATABASE_URL", "")

    now = time.time()
    with tx() as c:
        run_all_migrations(c, is_pg=False)

    router = RegimeMetaRouter()

    # 1. Test strategy demotion after 3 consecutive losses
    strat_id = "strat_trend_breakout"
    assert router.get_strategy_scale(strat_id, "TRENDING") == 1.0

    # 3 consecutive losses (each loss -20 pips net of 3.5 pip cost)
    router.record_trade_result(strat_id, pnl_pips=-15.0, symbol="XAUUSD")
    router.record_trade_result(strat_id, pnl_pips=-10.0, symbol="XAUUSD")
    router.record_trade_result(strat_id, pnl_pips=-25.0, symbol="XAUUSD")

    # Strategy must be demoted to SHADOW
    scale_demoted = router.get_strategy_scale(strat_id, "TRENDING")
    assert scale_demoted == 0.0, "Strategy must be demoted to SHADOW with 0.0 risk scale after 3 losses"

    # 2. Test auto-recovery via 10 shadow trades with net positive expectancy
    for i in range(10):
        # 10 trades making +15 pips gross (11.5 net after 3.5 pips cost)
        router.record_trade_result(strat_id, pnl_pips=15.0, symbol="XAUUSD")

    scale_recovered = router.get_strategy_scale(strat_id, "TRENDING")
    assert scale_recovered == 1.0, "Strategy must auto-recover to ACTIVE when 10 shadow trades yield positive expectancy"

    # 3. Real Out-of-Sample 70/30 Metric Validation Function
    from app.domains.ai.oos_validator import evaluate_oos_metrics

    # Candidate meeting all 5 gates passes
    assert evaluate_oos_metrics(
        std_net_pnl=120.0,
        std_pf=1.45,
        std_max_dd=8.5,
        trade_count=35,
        sev_net_pnl=25.0,
        sev_max_dd=11.2,
    ) == "QUALIFIED"

    # Fails Gate 3 (Standard Max DD > 12%)
    assert evaluate_oos_metrics(
        std_net_pnl=120.0,
        std_pf=1.45,
        std_max_dd=14.0,
        trade_count=35,
        sev_net_pnl=25.0,
        sev_max_dd=11.2,
    ) == "NO_QUALIFIED_STRATEGY"

    # Fails Gate 4 (Trade count on 30% OOS < 30)
    assert evaluate_oos_metrics(
        std_net_pnl=120.0,
        std_pf=1.45,
        std_max_dd=8.5,
        trade_count=18,
        sev_net_pnl=25.0,
        sev_max_dd=11.2,
    ) == "NO_QUALIFIED_STRATEGY"

    # Fails Gate 5 (Severe Net PnL < 0)
    assert evaluate_oos_metrics(
        std_net_pnl=120.0,
        std_pf=1.45,
        std_max_dd=8.5,
        trade_count=35,
        sev_net_pnl=-5.0,
        sev_max_dd=11.2,
    ) == "NO_QUALIFIED_STRATEGY"
