import pytest
import time
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.domains.billing.crypto_direct import (
    validate_crypto_address,
    get_crypto_wallets_config,
    save_crypto_wallets_config,
    allocate_unique_usdt_amount,
    verify_trc20_transaction,
    verify_bep20_transaction,
    verify_and_fulfill_crypto_order,
    get_active_billing_methods,
)
from app.db import tx


@pytest.fixture(autouse=True)
def setup_db():
    from app.core.db import init
    init()


@pytest.fixture
def client():
    return TestClient(app)


def test_crypto_address_validation():
    # TRC20 addresses: Base58 starting with T, length 34
    assert validate_crypto_address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "TRC20") is True
    assert validate_crypto_address("TJAnbWq7gHjUeQkSvdTjZzGvX9oPqL3s8w", "TRC20") is True
    assert validate_crypto_address("0x55d398326f99059fF775485246999027B3197955", "TRC20") is False
    assert validate_crypto_address("T123", "TRC20") is False

    # BEP20 addresses: EVM starting with 0x, length 42 hex
    assert validate_crypto_address("0x55d398326f99059fF775485246999027B3197955", "BEP20") is True
    assert validate_crypto_address("0x71C8705e2A1044E006724c16E767D8251e50D0e4", "BEP20") is True
    assert validate_crypto_address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "BEP20") is False
    assert validate_crypto_address("0x123", "BEP20") is False


def test_crypto_wallets_config_crud():
    # Save valid config
    res = save_crypto_wallets_config(
        enabled=True,
        trc20_address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        bep20_address="0x55d398326f99059fF775485246999027B3197955",
        admin_id="adm-test"
    )
    assert res["enabled"] is True
    assert res["trc20_address"] == "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
    assert res["bep20_address"] == "0x55d398326f99059fF775485246999027B3197955"

    loaded = get_crypto_wallets_config()
    assert loaded["enabled"] is True
    assert loaded["trc20_address"] == "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
    assert loaded["bep20_address"] == "0x55d398326f99059fF775485246999027B3197955"

    # Validation rejection for invalid TRC20 address
    with pytest.raises(ValueError):
        save_crypto_wallets_config(
            enabled=True,
            trc20_address="invalid_tron_address",
            bep20_address=None,
            admin_id="adm-test"
        )


def test_allocate_unique_usdt_amount():
    now_ts = time.time()
    user_id = "test_alloc_user"
    with tx() as c:
        c.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM payment_transactions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM trading_accounts WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM orders WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        c.execute("INSERT INTO users (id, email, password, role) VALUES (?, 'alloc_user@example.com', 'pwd_hash_123', 'customer')", (user_id,))
        c.execute("""
            INSERT INTO orders (id, user_id, amount_usd, amount_vnd, locked_exchange_rate, plan_tier, cloud_slots_count, status, payment_gateway, created_at, expires_at, expected_amount_usdt)
            VALUES ('ord_alloc_1', ?, 25.0, 637500, 25500.0, 'starter', 1, 'PENDING', 'USDT_TRC20', ?, ?, 25.01)
        """, (user_id, now_ts, now_ts + 1800))

    # Next allocation should jump to 25.02 to avoid collision
    alloc = allocate_unique_usdt_amount(25.0, "USDT_TRC20")
    assert alloc == 25.02


def test_active_billing_methods():
    methods = get_active_billing_methods()
    assert "sepay" in methods
    assert "usdt_trc20" in methods
    assert "usdt_bep20" in methods


@pytest.mark.asyncio
async def test_crypto_order_fulfillment_and_double_spend():
    now_ts = time.time()
    order_id = f"ord_crypto_{int(now_ts)}"
    user_id = "test_crypto_user"

    with tx() as c:
        c.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM payment_transactions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM trading_accounts WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM orders WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        c.execute("INSERT INTO users (id, email, password, role) VALUES (?, 'crypto_user@example.com', 'pwd_hash_123', 'customer')", (user_id,))
        c.execute("""
            INSERT INTO orders (id, user_id, amount_usd, amount_vnd, locked_exchange_rate, plan_tier, cloud_slots_count, status, payment_gateway, created_at, expires_at, expected_amount_usdt)
            VALUES (?, ?, 25.0, 637500, 25500.0, 'starter', 1, 'PENDING', 'USDT_TRC20', ?, ?, 25.05)
        """, (order_id, user_id, now_ts, now_ts + 1800))

    # Mock verify_trc20_transaction to return success
    with patch("app.domains.billing.crypto_direct.verify_trc20_transaction") as mock_verify:
        mock_verify.return_value = (
            True,
            "Xác minh thành công",
            {"tx_hash": "mock_tx_hash_123", "amount": 25.05, "network": "TRC20"}
        )

        res = await verify_and_fulfill_crypto_order(order_id, "mock_tx_hash_123")
        assert res["ok"] is True
        assert res["status"] == "PAID"

        # Check DB state
        with tx() as c:
            row = c.execute("SELECT status, payment_status, entitlement_status, tx_hash FROM orders WHERE id = ?", (order_id,)).fetchone()
            assert row[0] == "PAID"
            assert row[1] == "PAID"
            assert row[2] == "GRANTED"
            assert row[3] == "mock_tx_hash_123"

        # Replay attempt with same tx_hash on another order must fail (double spending prevention)
        order_id_2 = f"ord_crypto_2_{int(now_ts)}"
        with tx() as c:
            c.execute("""
                INSERT INTO orders (id, user_id, amount_usd, amount_vnd, locked_exchange_rate, plan_tier, cloud_slots_count, status, payment_gateway, created_at, expires_at, expected_amount_usdt)
                VALUES (?, ?, 25.0, 637500, 25500.0, 'starter', 1, 'PENDING', 'USDT_TRC20', ?, ?, 25.05)
            """, (order_id_2, user_id, now_ts, now_ts + 1800))

        res2 = await verify_and_fulfill_crypto_order(order_id_2, "mock_tx_hash_123")
        assert res2["ok"] is False
        assert "đã được sử dụng" in res2["message"]

        # 3. Test polling GET /orders/{order_id} on USDT order doesn't throw 500 and returns saved wallet
        from app.routers.billing import get_order_status
        user_dict = {"id": user_id, "role": "customer", "email": "test@example.com"}
        with tx() as c:
            c.execute("INSERT INTO kv (key, value) VALUES (?, ?)", (f"order_wallet:{order_id_2}", "TSavedWallet1234567890123456789012"))
        
        polled_order = get_order_status(order_id_2, u=user_dict)
        assert polled_order.id == order_id_2
        assert polled_order.payment_content is not None
        assert polled_order.payment_content == f"USDT {order_id_2}"
        assert polled_order.wallet_address == "TSavedWallet1234567890123456789012"
        assert polled_order.crypto_network == "TRC20"


def test_allocate_unique_usdt_with_kv_hold():
    now_ts = time.time()
    with tx() as c:
        # Pre-set hold in kv (simulating concurrent in-flight allocation before order insert)
        c.execute("INSERT INTO kv (key, value) VALUES ('usdt_hold:USDT_TRC20:25.01', 'ord_inflight_1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        # Ensure order table is empty for 25.01
        c.execute("DELETE FROM orders WHERE expected_amount_usdt = 25.01")
        alloc = allocate_unique_usdt_amount(25.0, "USDT_TRC20", db_cursor=c)
        # Must detect the hold and skip 25.01 to 25.02
        assert alloc == 25.02
        c.execute("DELETE FROM kv WHERE key = 'usdt_hold:USDT_TRC20:25.01'")


def test_redis_quote_rejects_stale_under_require_broker_feed():
    from app.routers.telemetry import get_live_xauusd_quote
    from app.redis_client import get_redis_client
    now_ts = time.time()
    rc = get_redis_client()
    # Write a 150-second old quote to Redis
    stale_ts = now_ts - 150.0
    rc.set("quote:XAUUSD:live", f"2750.50:2750.70:{stale_ts}:METAAPI_STREAM", ex=180)

    # When require_broker_feed=True, stale quote (> 120s) must NOT be returned as valid live feed
    lq = get_live_xauusd_quote(require_broker_feed=True)
    # If returned from Redis, it must either be skipped or not marked live without mid
    assert lq.get("live") is not True or lq.get("stale") is True or lq.get("source") != "REDIS_STREAM_METAAPI_STREAM"

    # When fresh (10s old), must be accepted
    fresh_ts = now_ts - 10.0
    rc.set("quote:XAUUSD:live", f"2750.50:2750.70:{fresh_ts}:METAAPI_STREAM", ex=180)
    lq_fresh = get_live_xauusd_quote(require_broker_feed=True)
    assert lq_fresh.get("live") is True
    assert lq_fresh.get("stale") is False
    assert lq_fresh.get("mid") == 2750.60


def test_is_account_drawdown_halted_emergency_pending():
    from app.domains.execution.watcher import is_account_drawdown_halted
    with tx() as c:
        c.execute("INSERT INTO kv (key, value) VALUES ('emergency_close_pending:acc_test_halt', 'DRAWDOWN_LIMIT_5.00') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        assert is_account_drawdown_halted(c, "acc_test_halt") is True
        c.execute("DELETE FROM kv WHERE key = 'emergency_close_pending:acc_test_halt'")
        assert is_account_drawdown_halted(c, "acc_test_halt") is False

        # Also verify hwm_close_pending
        c.execute("INSERT INTO kv (key, value) VALUES ('hwm_close_pending:acc_test_halt', 'HWM_TRAILING_DD_8.00') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        assert is_account_drawdown_halted(c, "acc_test_halt") is True
        c.execute("DELETE FROM kv WHERE key = 'hwm_close_pending:acc_test_halt'")

