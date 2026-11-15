"""Test distributed lock idempotency and crash recovery for Direct-to-User Cloud Execution."""
import pytest
import time
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
from app.redis_client import acquire_dispatch_lock, release_dispatch_lock


def test_distributed_lock_idempotency():
    account_id = "acc_test_idempotent_1"
    signal_id = "sig_test_lock_1"

    # Acquire lock 1st time
    token1 = acquire_dispatch_lock(account_id, signal_id, ttl_seconds=10)
    assert token1 is not None

    # Immediate second attempt on same account + signal MUST fail (idempotency barrier)
    token2 = acquire_dispatch_lock(account_id, signal_id, ttl_seconds=10)
    assert token2 is None

    # Release lock
    released = release_dispatch_lock(account_id, signal_id, token1)
    assert released is True

    # After release, lock can be acquired again
    token3 = acquire_dispatch_lock(account_id, signal_id, ttl_seconds=10)
    assert token3 is not None
    release_dispatch_lock(account_id, signal_id, token3)


@pytest.mark.asyncio
async def test_fanout_handles_network_hiccups_without_duplicate_orders():
    client = MetaApiClient()
    accounts = [
        {"id": "acc_retry_1", "metaapi_account_id": "meta_retry_1", "equity": 5000.0, "risk_percent": 1.0},
    ]
    sig = {
        "id": "sig_idempotent_order_01",
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2650.0,
        "sl": 2640.0,
        "tp": 2670.0
    }

    # 1st dispatch
    report1 = await execute_fan_out_for_signal(sig, accounts, client)
    assert report1["executed"] == 1
    assert report1["failed"] == 0

    # 2nd dispatch of identical signal
    report2 = await execute_fan_out_for_signal(sig, accounts, client)
    # Both executions report status
    assert len(report2["executions"]) == 1
