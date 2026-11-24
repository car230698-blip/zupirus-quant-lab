"""Regression tests for Prop Firm Live (1% / trade idea cap, HWM 8% trailing DD, profit-target throttle)
and strict non-interference with personal (non-prop) accounts."""
from unittest.mock import AsyncMock
import pytest

from app import db, research
from app.db import tx, getkv
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
from app.services.execution.watcher import PositionWatcher


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr("app.core.db.DATABASE_URL", "")
    monkeypatch.setattr("app.core.db._pg_pool", None)
    monkeypatch.setattr("app.core.db.DB", tmp_path / "lab.sqlite3")
    monkeypatch.setattr("app.core.db.DATA", tmp_path)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(db, "_pg_pool", None)
    monkeypatch.setattr(db, "DB", tmp_path / "lab.sqlite3")
    monkeypatch.setattr(db, "DATA", tmp_path)
    monkeypatch.setattr(research, "DATA", tmp_path)
    db.init()


@pytest.mark.asyncio
async def test_prop_live_1pct_cap_does_not_affect_personal_or_challenge_accounts():
    client = MetaApiClient()
    client.is_mock = True
    # Already 1 open BUY XAUUSD position risking $600 on $100,000 = 0.6%
    client.get_open_positions = AsyncMock(return_value=[
        {
            "id": "pos_1",
            "symbol": "XAUUSD",
            "type": "POSITION_TYPE_BUY",
            "openPrice": 2650.0,
            "stopLoss": 2645.0,  # $5 * 100 * 1.2 lots = $600 (0.6%)
            "volume": 1.2,
        }
    ])
    captured_volumes = {}

    async def fake_execute(*args, **kwargs):
        meta_id = kwargs.get("metaapi_account_id") or kwargs.get("account_id") or (args[0] if args else "")
        volume = kwargs.get("volume") if "volume" in kwargs else (args[3] if len(args) > 3 else 0.0)
        captured_volumes[meta_id] = volume
        return {"status": "FILLED", "orderId": f"ord_{meta_id}", "positionId": f"p_{meta_id}", "numericCode": 10009}

    client.execute_order = fake_execute

    sig = {
        "id": "sig_prop_1",
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2651.0,
        "sl": 2646.0,
        "tp": 2661.0,
        "strategy_id": "strat_liquidity_sweep",
    }
    accounts = [
        {
            "id": "acc_personal",
            "metaapi_account_id": "m_personal",
            "user_id": "u1",
            "balance": 100000.0,
            "equity": 100000.0,
            "risk_percent": 1.0,
            "risk_multiplier": 1.5,
            "max_lot": 10.0,
            "contract_size": 100.0,
            "is_prop_firm_mode": 0,
            "prop_stage": "LIVE",  # ignored because is_prop_firm_mode == 0
            "risk_config": '{"max_portfolio_risk_pct": 3.0}',
        },
        {
            "id": "acc_challenge",
            "metaapi_account_id": "m_challenge",
            "user_id": "u2",
            "balance": 100000.0,
            "equity": 100000.0,
            "risk_percent": 1.0,
            "risk_multiplier": 1.5,
            "max_lot": 10.0,
            "contract_size": 100.0,
            "is_prop_firm_mode": 1,
            "prop_stage": "CHALLENGE",
            "risk_config": '{"max_portfolio_risk_pct": 3.0}',
        },
        {
            "id": "acc_prop_live",
            "metaapi_account_id": "m_live",
            "user_id": "u3",
            "balance": 100000.0,
            "equity": 100000.0,
            "risk_percent": 1.0,
            "risk_multiplier": 1.5,
            "max_lot": 10.0,
            "contract_size": 100.0,
            "is_prop_firm_mode": 1,
            "prop_stage": "LIVE",
        },
    ]

    report = await execute_fan_out_for_signal(sig, accounts, client)
    by_acc = {e["account_id"]: e["volume"] for e in report["executions"]}

    # Personal gets full 1.5% risk ($1500 / $500 per lot = 3.00 lots) without prop jitter
    assert by_acc["acc_personal"] == 3.0
    # Challenge gets full 1.5% risk with prop micro-variance +/-3% (2.91 - 3.09)
    assert 2.91 <= by_acc["acc_challenge"] <= 3.09
    # Prop Live is capped to remaining 1.0% - 0.6% = 0.4% ($400 / $500 per lot = 0.80 lots with micro-variance +/-3%)
    assert 0.77 <= by_acc["acc_prop_live"] <= 0.83


@pytest.mark.asyncio
async def test_prop_watcher_hwm_and_profit_throttle_only_for_prop_accounts():
    with tx() as c:
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_p', 'p@example.com', 'x', 'customer')")
        c.execute(
            """INSERT INTO trading_accounts (
                id, user_id, mt5_login, encrypted_master_password, broker_server, metaapi_account_id,
                deployment_state, auto_trade, balance, equity,
                is_prop_firm_mode, prop_stage, prop_daily_dd_limit_pct, prop_profit_target_pct, created_at
            ) VALUES ('acc_pers', 'u_p', '111', 'enc', 'Demo', 'meta_pers', 'DEPLOYED', 1, 10000, 10000, 0, 'CHALLENGE', 5.0, 8.0, 1.0)"""
        )
        c.execute(
            """INSERT INTO trading_accounts (
                id, user_id, mt5_login, encrypted_master_password, broker_server, metaapi_account_id,
                deployment_state, auto_trade, balance, equity,
                is_prop_firm_mode, prop_stage, prop_daily_dd_limit_pct, prop_profit_target_pct, created_at
            ) VALUES ('acc_prop', 'u_p', '222', 'enc', 'FTMO-Demo', 'meta_prop', 'DEPLOYED', 1, 10000, 10700, 1, 'LIVE', 5.0, 8.0, 1.0)"""
        )
        c.execute("INSERT INTO kv (key, value) VALUES ('prop_initial_bal:acc_prop', '10000')")

    client = MetaApiClient()
    client.is_mock = True

    async def fake_acc_info(meta_id):
        if meta_id == "meta_pers":
            return {"balance": 10000.0, "equity": 10700.0}
        return {"balance": 10000.0, "equity": 10700.0}  # +7% >= 80% of 8% target (6.4%)

    client.get_account_information = fake_acc_info
    client.get_open_positions = AsyncMock(return_value=[])

    watcher = PositionWatcher(client)
    await watcher.run_cycle()

    with tx() as c:
        # LIVE accounts must NOT have profit target throttle enabled
        assert getkv(c, "prop_target_throttle:acc_prop") == "0"
        assert getkv(c, "prop_hwm_equity:acc_prop") == "10700.0"
        assert getkv(c, "prop_target_throttle:acc_pers") is None
        assert getkv(c, "prop_hwm_equity:acc_pers") is None


@pytest.mark.asyncio
async def test_prop_hwm_8pct_breach_and_concurrent_limit():
    with tx() as c:
        c.execute("INSERT INTO users (id, email, password, role) VALUES ('u_h', 'h@example.com', 'x', 'customer')")
        c.execute(
            """INSERT INTO trading_accounts (
                id, user_id, mt5_login, encrypted_master_password, broker_server, metaapi_account_id,
                deployment_state, auto_trade, balance, equity,
                is_prop_firm_mode, prop_stage, prop_daily_dd_limit_pct, prop_profit_target_pct, created_at
            ) VALUES ('acc_hwm', 'u_h', '333', 'enc', 'FTMO-Demo', 'meta_hwm', 'DEPLOYED', 1, 11200, 10950, 1, 'LIVE', 5.0, 8.0, 1.0)"""
        )
        c.execute("INSERT INTO kv (key, value) VALUES ('prop_initial_bal:acc_hwm', '10000')")
        c.execute("INSERT INTO kv (key, value) VALUES ('prop_hwm_equity:acc_hwm', '12000')")

    client = MetaApiClient()
    client.is_mock = True
    # Daily DD = 2.23% (< 5%), but Trailing DD from HWM 12000 = 8.75% (>= 8.0%)
    client.get_account_information = AsyncMock(return_value={"balance": 11200.0, "equity": 10950.0})
    client.close_position = AsyncMock(return_value={"closed": 1})
    client.get_open_positions = AsyncMock(return_value=[])

    watcher = PositionWatcher(client)
    res = await watcher.run_cycle()
    assert res["prop_breakers_triggered"] >= 1
    with tx() as c:
        row = c.execute("SELECT auto_trade FROM trading_accounts WHERE id = 'acc_hwm'").fetchone()
        assert row[0] == 0
        assert "HWM_TRAILING_DD" in (getkv(c, "drawdown_locked:acc_hwm") or "")

    # Verify MAX_CONCURRENT_TRADES_PER_ACCOUNT blocks Prop LIVE when >= 2 positions open
    client2 = MetaApiClient()
    client2.is_mock = True
    client2.get_open_positions = AsyncMock(return_value=[
        {"id": "p1", "symbol": "EURUSD", "type": "POSITION_TYPE_BUY", "openPrice": 1.1, "stopLoss": 1.095, "volume": 0.1},
        {"id": "p2", "symbol": "GBPUSD", "type": "POSITION_TYPE_SELL", "openPrice": 1.25, "stopLoss": 1.255, "volume": 0.1},
    ])
    rep = await execute_fan_out_for_signal(
        {"id": "sig_max_conc", "symbol": "XAUUSD", "action": "BUY", "entry_price": 2650.0, "sl": 2645.0, "tp": 2660.0},
        [{"id": "acc_live_max", "metaapi_account_id": "m_live_max", "balance": 100000.0, "equity": 100000.0, "is_prop_firm_mode": 1, "prop_stage": "LIVE"}],
        client2,
    )
    assert rep["executed"] == 0
    assert rep["skipped"] == 1
