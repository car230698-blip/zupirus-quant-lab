import json
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
    assert methods["sepay"] is False
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
    try:
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
    finally:
        rc.delete("quote:XAUUSD:live")


def test_trc20_base58_and_hex_matching():
    """Verify that TronGrid returning EVM Hex (0x...) or 41-prefixed Hex matches Base58Check expected_to."""
    from app.domains.billing.crypto_direct import normalize_tron_address, tron_base58_to_hex
    base58_addr = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
    evm_hex = tron_base58_to_hex(base58_addr)
    assert evm_hex == "0xa614f803b6fd780986a42c78ec9c7f77e6ded13c"

    # Verify normalize_tron_address equates all representations
    assert normalize_tron_address(base58_addr) == evm_hex
    assert normalize_tron_address(evm_hex) == evm_hex
    assert normalize_tron_address("41a614f803b6fd780986a42c78ec9c7f77e6ded13c") == evm_hex

    # Mock TronGrid events returning 0x... EVM hex format for result.to
    mock_events_response = {
        "success": True,
        "data": [
            {
                "event_name": "Transfer",
                "contract_address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
                "result": {
                    "to": evm_hex,  # TronGrid Hex return
                    "value": "25010000",  # 25.01 USDT
                }
            }
        ]
    }
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(mock_events_response).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        ok, msg, data = verify_trc20_transaction(
            tx_hash="a" * 64,
            expected_to=base58_addr,  # Admin Base58 input
            expected_amount=25.01
        )
        assert ok is True
        assert data["amount"] == 25.01


def test_bep20_confirmations_check():
    """Verify BEP20 requires >= 3 confirmations."""
    admin_wallet = "0x55d398326f99059fF775485246999027B3197955"
    admin_unpadded = admin_wallet.lower().replace("0x", "")
    exact_topic_2 = "0x" + admin_unpadded.zfill(64)

    mock_receipt = {
        "status": "0x1",
        "blockNumber": "0x64",  # Block 100
        "logs": [
            {
                "address": "0x55d398326f99059ff775485246999027b3197955",
                "topics": [
                    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                    "0x" + "1" * 64,
                    exact_topic_2,
                ],
                "data": hex(int(25.01 * 10**18)),
            }
        ]
    }

    # 1. When latest block is 101 -> confirmations = 101 - 100 + 1 = 2 (< 3) -> should reject
    with patch("app.domains.billing.crypto_direct._call_bsc_rpc") as mock_rpc:
        def rpc_side_effect(method, params):
            if method == "eth_getTransactionReceipt":
                return mock_receipt
            if method == "eth_blockNumber":
                return "0x65"  # Block 101 -> 2 confirmations
            return None
        mock_rpc.side_effect = rpc_side_effect

        ok, msg, data = verify_bep20_transaction("0x" + "b" * 64, admin_wallet, 25.01)
        assert ok is False
        assert "xác nhận khối" in msg

    # 2. When latest block is 104 -> confirmations = 104 - 100 + 1 = 5 (>= 3) -> should accept
    with patch("app.domains.billing.crypto_direct._call_bsc_rpc") as mock_rpc:
        def rpc_side_effect(method, params):
            if method == "eth_getTransactionReceipt":
                return mock_receipt
            if method == "eth_blockNumber":
                return "0x68"  # Block 104 -> 5 confirmations
            return None
        mock_rpc.side_effect = rpc_side_effect

        ok, msg, data = verify_bep20_transaction("0x" + "b" * 64, admin_wallet, 25.01)
        assert ok is True
        assert data["amount"] == 25.01

    # 3. Fail-Closed: When latest block is None (RPC failure) -> MUST reject and NOT approve
    with patch("app.domains.billing.crypto_direct._call_bsc_rpc") as mock_rpc:
        def rpc_side_effect(method, params):
            if method == "eth_getTransactionReceipt":
                return mock_receipt
            if method == "eth_blockNumber":
                return None  # RPC failure
            return None
        mock_rpc.side_effect = rpc_side_effect

        ok, msg, data = verify_bep20_transaction("0x" + "b" * 64, admin_wallet, 25.01)
        assert ok is False
        assert "xác nhận" in msg
        assert data.get("retry_later") is True


@pytest.mark.asyncio
async def test_scan_and_reconcile_pending_crypto_orders():
    """Verify background worker auto-fulfills pending orders when on-chain transfer is detected."""
    from app.domains.billing.crypto_direct import scan_and_reconcile_pending_crypto_orders
    now_ts = time.time()
    user_id = "test_scan_user"
    order_id = f"ord_scan_{int(now_ts)}"

    with tx() as c:
        c.execute("DELETE FROM orders WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        c.execute("INSERT INTO users (id, email, password, role) VALUES (?, 'scan_user@example.com', 'pwd_hash_123', 'customer')", (user_id,))
        c.execute("""
            INSERT INTO orders (id, user_id, amount_usd, amount_vnd, locked_exchange_rate, plan_tier, cloud_slots_count, status, payment_gateway, created_at, expires_at, expected_amount_usdt)
            VALUES (?, ?, 25.0, 637500, 25500.0, 'starter', 1, 'PENDING', 'USDT_TRC20', ?, ?, 25.42)
        """, (order_id, user_id, now_ts, now_ts + 1800))
        c.execute("INSERT INTO kv (key, value) VALUES (?, ?)", (f"order_wallet:{order_id}", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"))

    # Mock TronGrid account transactions response containing 25.42 USDT transfer
    mock_acc_transfers = {
        "success": True,
        "data": [
            {
                "transaction_id": "tx_auto_scan_1234567890abcdef",
                "value": "25420000",  # 25.42 USDT
                "to": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            }
        ]
    }

    with patch("urllib.request.urlopen") as mock_urlopen, \
         patch("app.domains.billing.crypto_direct.verify_and_fulfill_crypto_order") as mock_fulfill:
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(mock_acc_transfers).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp
        mock_fulfill.return_value = {"ok": True, "status": "PAID"}

        stats = await scan_and_reconcile_pending_crypto_orders()
        assert stats["scanned"] >= 1
        assert stats["fulfilled"] >= 1
        assert order_id in stats["orders"]
        mock_fulfill.assert_called_once_with(order_id, "tx_auto_scan_1234567890abcdef")


def test_sqlite_nested_tx_and_usdt_order_polling(client):
    """Verify that nested tx() calls reuse thread connection via SAVEPOINT and don't deadlock, and SePay is rejected."""
    from app.db import tx
    with tx() as c1:
        c1.execute("INSERT INTO kv (key, value) VALUES ('nested_k1', 'v1') ON CONFLICT(key) DO UPDATE SET value = 'v1'")
        # Nested tx() within the same thread
        with tx() as c2:
            c2.execute("INSERT INTO kv (key, value) VALUES ('nested_k2', 'v2') ON CONFLICT(key) DO UPDATE SET value = 'v2'")
            row2 = c2.execute("SELECT value FROM kv WHERE key = 'nested_k2'").fetchone()
            assert row2[0] == 'v2'
        row1 = c1.execute("SELECT value FROM kv WHERE key = 'nested_k1'").fetchone()
        assert row1[0] == 'v1'

    # Verify SePay order creation is strictly rejected with 400
    from fastapi import HTTPException
    from app.domains.billing.service import create_checkout_order
    user_id = "test_sepay_deadlock_user"
    with tx() as c:
        c.execute("INSERT INTO users (id, email, password, role) VALUES (?, 'deadlock_u@example.com', 'pwd_hash', 'customer') ON CONFLICT(id) DO NOTHING", (user_id,))
    with pytest.raises(HTTPException) as exc_info:
        create_checkout_order(user_id=user_id, plan_tier="starter", payment_method="SEPAY")
    assert exc_info.value.status_code == 400
    assert "SePay / VietQR đã ngừng hoạt động" in str(exc_info.value.detail)

    # Verify USDT order creation and polling
    order = create_checkout_order(user_id=user_id, plan_tier="starter", payment_method="USDT")
    ord_id = order["order_id"]

    # Poll order as admin
    client.post('/api/login', json={'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'})
    resp = client.get(f"/api/v1/billing/orders/{ord_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == ord_id
    assert data["payment_gateway"] in ("USDT", "USDT_BEP20", "USDT_TRC20")


