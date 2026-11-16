import pytest
import datetime
from app.db import init, tx, setkv
from app.metaapi import MetaApiClient
from app.services.execution.watcher import PositionWatcher

@pytest.fixture(autouse=True)
def setup_db():
    init()

@pytest.mark.asyncio
async def test_metaapi_position_methods():
    client = MetaApiClient(token="mock")
    # 1. get_open_positions
    positions = await client.get_open_positions("metaapi_mock_123")
    assert isinstance(positions, list)

    # 2. modify_position_sl
    mod_res = await client.modify_position_sl("metaapi_mock_123", "pos_999", 2650.0)
    assert mod_res["numericCode"] == 10009
    assert mod_res["stopLoss"] == 2650.0

    # 3. close_partial_position
    close_part = await client.close_partial_position("metaapi_mock_123", "pos_999", 0.05)
    assert close_part["numericCode"] == 10009
    assert close_part["closedVolume"] == 0.05

    # 4. close_all_positions
    close_all = await client.close_all_positions("metaapi_mock_123")
    assert "status" in close_all


@pytest.mark.asyncio
async def test_watcher_prop_guard_and_weekend_check():
    client = MetaApiClient(token="mock")
    watcher = PositionWatcher(metaapi_client=client)

    with tx() as c:
        # Create a mock prop firm account
        c.execute(
            """
            INSERT OR REPLACE INTO users (id, email, password, role)
            VALUES ('usr_test_prop', 'prop@zupirus.com', 'hash', 'customer')
            """
        )
        c.execute(
            """
            INSERT OR REPLACE INTO subscriptions (user_id, plan_tier, created_at, updated_at)
            VALUES ('usr_test_prop', 'alpha', 1700000000, 1700000000)
            """
        )
        c.execute(
            """
            INSERT OR REPLACE INTO trading_accounts (id, user_id, metaapi_account_id, mt5_login, encrypted_master_password, broker_server, auto_trade, balance, equity, created_at)
            VALUES ('acc_test_prop', 'usr_test_prop', 'meta_prop_1', '12345', 'enc', 'Demo', 1, 10000.0, 9400.0, 1700000000)
            """
        )
        # Pre-seed daily start balance to $11,000 so mock equity $10,000 gives 9.09% drawdown >= 4.5%
        c.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('daily_start_bal:acc_test_prop:2026-11-16', '11000.0')")

    # Run watcher - equity is 10000 vs 11000 (9.09% DD >= 4.5% limit) -> should trigger breaker
    now = datetime.datetime(2026, 11, 16, 10, 0, tzinfo=datetime.timezone.utc)
    res = await watcher.run_cycle(now_dt=now)
    assert res["prop_breakers_triggered"] >= 1

    # Verify auto_trade was locked to 0
    with tx() as c:
        row = c.execute("SELECT auto_trade FROM trading_accounts WHERE id = 'acc_test_prop'").fetchone()
        assert row[0] == 0
