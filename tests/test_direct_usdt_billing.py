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

