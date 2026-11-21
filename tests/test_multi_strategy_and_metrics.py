import time
import pytest
from fastapi.testclient import TestClient
from app.db import init, tx
from app.main import app
from app.security import digest
from app.domains.execution.fanout import execute_fan_out_for_signal


def test_prometheus_metrics_endpoint():
    init()
    client = TestClient(app)
    admin_token = "qa_admin_secret_token_metrics"

    with tx() as c:
        c.execute(
            """
            INSERT INTO users (id, email, password, role)
            VALUES ('usr_admin_metrics', 'admin_metrics@zupirus.com', 'dummy_hash', 'admin')
            ON CONFLICT(id) DO NOTHING
            """
        )
        c.execute(
            """
            INSERT INTO sessions (token, user_id, expires)
            VALUES (?, 'usr_admin_metrics', ?)
            ON CONFLICT(token) DO UPDATE SET expires = excluded.expires
            """,
            (digest(admin_token), time.time() + 3600),
        )

    res = client.get(
        "/api/admin/metrics",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200
    assert "text/plain" in res.headers.get("content-type", "")
    content = res.text
    assert "zupirus_fanout_executions_total" in content
    assert "zupirus_fanout_latency_ms" in content
    assert "zupirus_accounts_active" in content
    assert "zupirus_active_drawdown_halts" in content


@pytest.mark.asyncio
async def test_multi_strategy_fanout_filter():
    init()
    # Test account subscribed only to 'smc'
    account_smc = {
        "id": "acc_qa_strat_smc",
        "user_id": "usr_qa_strat",
        "metaapi_account_id": "meta_qa_smc",
        "balance": 10000.0,
        "equity": 10000.0,
        "auto_trade": 1,
        "risk_percent": 1.0,
        "allowed_strategy_ids": "smc",
    }
    # Signal with strategy 'price_action'
    signal_pa = {
        "id": "sig_qa_pa_123",
        "symbol": "XAUUSD",
        "action": "BUY",
        "price": 2700.0,
        "sl": 2690.0,
        "tp": 2720.0,
        "strategy": "price_action",
    }

    res = await execute_fan_out_for_signal(signal_pa, [account_smc], metaapi_client=None)
    # The account should be skipped
    assert res["executed"] == 0
    assert res["skipped"] >= 1
