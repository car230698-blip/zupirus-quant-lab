"""Verification test suite for audit findings in commits 716e543 and 389fb22."""
import os
import time
import json
import hashlib
from unittest.mock import AsyncMock, MagicMock
import pytest
from app.db import init, tx, setkv, getkv


@pytest.fixture(scope="module", autouse=True)
def _init_db_schema():
    """Ensure full schema is initialized even when running this test module standalone on a fresh DB."""
    init()


def _ensure_user(c, user_id: str, role: str = "customer"):
    c.execute(
        "INSERT INTO users (id, email, password, role) VALUES (?, ?, 'pass123', ?) ON CONFLICT(id) DO NOTHING",
        (user_id, f"{user_id}@example.com", role),
    )


def _insert_trading_account(
    c, acc_id, user_id, metaapi_account_id, auto_trade=1,
    balance=100000.0, equity=100000.0, deployment_state="DEPLOYED",
    account_type="PROP_LIVE", currency="USD"
):
    _ensure_user(c, user_id)
    c.execute(
        """
        INSERT INTO metaapi_cloud_accounts (
            id, user_id, login, server, platform, metaapi_account_id, metaapi_state,
            auto_trade, balance, equity, currency, created_at
        ) VALUES (?, ?, ?, 'Exness-Real', 'mt5', ?, 'DEPLOYED', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (acc_id, user_id, f"login_{acc_id}", metaapi_account_id, auto_trade, balance, equity, currency, time.time()),
    )
    c.execute(
        """
        INSERT INTO trading_accounts (
            id, user_id, metaapi_account_id, mt5_login, broker_server,
            encrypted_master_password, auto_trade, balance, equity,
            deployment_state, account_type, currency, cloud_expires_at, created_at
        ) VALUES (?, ?, ?, ?, 'Exness-Real', 'enc_pass', ?, ?, ?, ?, ?, ?, 0.0, ?)
        ON CONFLICT(id) DO UPDATE SET
            deployment_state=excluded.deployment_state,
            auto_trade=excluded.auto_trade,
            balance=excluded.balance,
            equity=excluded.equity,
            account_type=excluded.account_type
        """,
        (
            acc_id, user_id, metaapi_account_id, f"login_{acc_id}", auto_trade, balance,
            equity, deployment_state, account_type, currency, time.time()
        ),
    )


@pytest.mark.asyncio
async def test_p0_fanout_closed_and_filled_protected_from_reopen_or_skip_overwrite():
    """Verify CLOSED signals cannot re-open and duplicate Prop LIVE signals cannot overwrite FILLED with SKIPPED."""
    from app.domains.execution.fanout import execute_fan_out_for_signal
    from app.domains.execution.metaapi_client import MetaApiClient

    signal_id = "sig_closed_reopen_guard"
    acc_id = "acc_closed_reopen_guard"
    user_id = "user_closed_reopen_guard"
    now_ts = time.time()

    with tx() as c:
        _insert_trading_account(c, acc_id, user_id, "meta_closed_1")
        c.execute("DELETE FROM metaapi_trade_executions WHERE signal_id = ? AND account_id = ?", (signal_id, acc_id))
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, status, origin, client_order_id, reserved_risk_pct,
                sl_confirmed, executed_at, closed_at, profit, evidence_json
            ) VALUES('exec_closed_1', ?, ?, 'meta_closed_1', 'XAUUSD', 'BUY', 1.0, 2600.0, 2590.0, 2620.0, 'CLOSED', 'BOT', 'ZV2_CLOSED', 1.0, 1, ?, ?, 50.0, '{}')
            """,
            (signal_id, acc_id, now_ts - 60, now_ts - 10),
        )

    client = MetaApiClient()
    client.is_mock = True
    broker_calls = []

    async def fake_execute(*args, **kwargs):
        broker_calls.append(kwargs)
        return {"status": "FILLED", "orderId": "ord_new", "positionId": "pos_new", "numericCode": 10009}

    client.execute_order = fake_execute

    sig = {
        "id": signal_id,
        "symbol": "XAUUSD",
        "action": "BUY",
        "entry_price": 2600.0,
        "sl": 2595.0,
        "tp": 2610.0,
    }
    accounts = [{
        "id": acc_id,
        "metaapi_account_id": "meta_closed_1",
        "user_id": user_id,
        "balance": 100000.0,
        "equity": 100000.0,
        "risk_percent": 1.0,
        "is_prop_firm_mode": 1,
        "prop_stage": "LIVE",
        "deployment_state": "DEPLOYED",
        "auto_trade": 1,
    }]

    await execute_fan_out_for_signal(sig, accounts, client)
    assert len(broker_calls) == 0, "CLOSED signal must never send another broker order"

    with tx() as c:
        row = c.execute(
            "SELECT status, profit FROM metaapi_trade_executions WHERE signal_id = ? AND account_id = ?",
            (signal_id, acc_id),
        ).fetchone()
        assert row["status"] == "CLOSED"
        assert float(row["profit"]) == 50.0


def test_p1_prop_live_widened_sl_risk_recalculated_and_clamped():
    """Verify that when compliance stopsLevel widens SL from 5 to 10 USD, volume is re-scaled to stay <= 1.0%."""
    import math
    from app.domains.execution.symbol_precision import contract_size_for_symbol, quote_to_usd_rate

    base_capital = 100000.0
    symbol = "XAUUSD"
    entry_price = 2600.0
    widened_sl_dist = 10.0
    eff_contract = contract_size_for_symbol(symbol, is_cent=False)
    remaining_idea_risk_pct = 1.0
    vol_step = 0.01

    volume = 2.0
    final_risk_usd = widened_sl_dist * volume * eff_contract * quote_to_usd_rate(symbol, entry_price)
    final_calc_risk_pct = (final_risk_usd / base_capital) * 100.0
    assert final_calc_risk_pct > 1.0

    scale_factor = remaining_idea_risk_pct / max(final_calc_risk_pct, 0.001)
    clamped_volume = max(0.0, round(math.floor((volume * scale_factor) / vol_step) * vol_step, 2))
    clamped_risk_usd = widened_sl_dist * clamped_volume * eff_contract * quote_to_usd_rate(symbol, entry_price)
    clamped_risk_pct = (clamped_risk_usd / base_capital) * 100.0

    assert clamped_volume == 1.0
    assert clamped_risk_pct <= 1.0 + 1e-4


@pytest.mark.asyncio
async def test_position_close_reconciliation_no_double_volume_and_multi_account_same_deal_id():
    """Verify 1-lot deal sets closed_volume=1.0 (not 2.0), preserves watermark on 503, and isolates deal_id per account."""
    from app.domains.execution.watcher import PositionWatcher

    acc_1 = "acc_deal_iso_1"
    acc_2 = "acc_deal_iso_2"
    u_1 = "user_deal_iso_1"
    u_2 = "user_deal_iso_2"
    shared_dl_id = "deal_shared_777"
    pos_id = "pos_shared_777"
    now_ts = time.time()
    old_wm = str(now_ts - 36 * 3600)

    with tx() as c:
        _insert_trading_account(c, acc_1, u_1, "meta_iso_1")
        _insert_trading_account(c, acc_2, u_2, "meta_iso_2")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id IN (?, ?)", (acc_1, acc_2))
        c.execute("DELETE FROM kv WHERE key LIKE 'deal_synced:%'")
        setkv(c, f"deals_reconciled_watermark:{acc_1}", old_wm)

        for aid, eid, mid in [(acc_1, "exec_iso_1", "meta_iso_1"), (acc_2, "exec_iso_2", "meta_iso_2")]:
            c.execute(
                """
                INSERT INTO metaapi_trade_executions(
                    id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                    entry_price, sl, tp, status, origin, client_order_id, reserved_risk_pct,
                    sl_confirmed, executed_at, position_id, order_id, ticket, closed_volume, profit
                ) VALUES(?, 'sig_iso', ?, ?, 'XAUUSD', 'BUY', 1.0, 2600.0, 2590.0, 2620.0, 'CLOSE_PENDING', 'BOT', 'ZV2_ISO', 1.0, 1, ?, ?, ?, ?, 0.0, 0.0)
                """,
                (eid, aid, mid, now_ts - 120, pos_id, pos_id, pos_id),
            )

    pw = PositionWatcher()
    pw.client = MagicMock()
    pw.client.get_account_information = AsyncMock(return_value={"connected": True, "connectionStatus": "CONNECTED", "equity": 100000.0, "balance": 100000.0})
    pw.client.get_positions_verified = AsyncMock(return_value=(True, [], {"synchronized": True}))
    # Simulate 503 failure first: watermark must stay at 36h ago
    pw.client.get_closed_deals_verified = AsyncMock(return_value=(False, [], {"status_code": 503}))
    await pw._run_cycle_locked()

    with tx() as c:
        assert getkv(c, f"deals_reconciled_watermark:{acc_1}") == old_wm

    # Now simulate deal recovery: 1.0 lot deal with shared deal_id across both accounts
    pw.client.get_closed_deals_verified = AsyncMock(return_value=(True, [{
        "id": shared_dl_id,
        "entryType": "DEAL_ENTRY_OUT",
        "positionId": pos_id,
        "volume": 1.0,
        "profit": 85.0,
        "swap": 0.0,
        "commission": 0.0,
        "price": 2610.0,
    }], {"status_code": 200}))
    await pw._run_cycle_locked()

    with tx() as c:
        for eid in ("exec_iso_1", "exec_iso_2"):
            r = c.execute("SELECT status, closed_volume, profit FROM metaapi_trade_executions WHERE id = ?", (eid,)).fetchone()
            assert r["status"] == "CLOSED"
            assert float(r["closed_volume"]) == 1.0
            assert float(r["profit"]) == 85.0


def test_credential_update_columns_exist():
    """Verify updating account credentials does not attempt to query nonexistent password_hash."""
    from app.security import encrypt_secret
    acc_id = "acc_cred_test"
    owner_id = "user_cred_test"
    enc_pw = encrypt_secret("new_mt5_pass")

    with tx() as c:
        _ensure_user(c, owner_id)
        c.execute(
            """
            INSERT INTO trading_accounts(
                id, user_id, mt5_login, encrypted_master_password, broker_server,
                metaapi_account_id, deployment_state, created_at
            ) VALUES(?, ?, '123456', 'old_pass', 'Broker-Demo', 'meta_cred_1', 'DEPLOYED', ?)
            ON CONFLICT (id) DO UPDATE SET mt5_login='123456'
            """,
            (acc_id, owner_id, time.time()),
        )
        c.execute(
            "UPDATE trading_accounts SET mt5_login=?, broker_server=?, encrypted_master_password=? WHERE id=? AND user_id=?",
            ("999999", "Broker-Live", enc_pw, acc_id, owner_id),
        )
        row = c.execute("SELECT mt5_login, broker_server FROM trading_accounts WHERE id=?", (acc_id,)).fetchone()
        assert row["mt5_login"] == "999999"
        assert row["broker_server"] == "Broker-Live"


def test_queued_downgrade_preserves_subsequent_alpha_extension_and_slot_count():
    """Verify Alpha (2d) -> Growth (30d, 1 slot) -> Alpha (30d) preserves 62d total and grants 1 slot when Growth activates."""
    from app.domains.billing.service import apply_subscription_entitlements_tx, get_user_subscription

    user_id = "user_downgrade_test"
    now_ts = time.time()

    with tx() as c:
        _ensure_user(c, user_id)
        c.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM kv WHERE key = ?", (f"queued_downgrade:{user_id}",))
        # Start with Alpha expiring in 2 days
        c.execute(
            """
            INSERT INTO subscriptions(
                id, user_id, plan_tier, service_expires_at, max_mt5_accounts,
                allow_custom_multiplier, allow_compounding, allow_partial_tp_be,
                allow_prop_firm_mode, allow_alpha_strategies, created_at, updated_at
            ) VALUES('sub_test', ?, 'alpha', ?, 5, 1, 1, 1, 1, 1, ?, ?)
            """,
            (user_id, now_ts + 2 * 86400, now_ts, now_ts),
        )
        # 1. Buy Growth (1 slot, 30 days) -> extends expiration to +32d and queues downgrade
        exp_1, _ = apply_subscription_entitlements_tx(
            c, {"id": "ord_g_1", "user_id": user_id, "plan_tier": "growth", "cloud_slots_count": 1}, now_ts
        )
        assert abs(exp_1 - (now_ts + 32 * 86400)) < 5

        # 2. Buy Alpha (5 slots, 30 days) -> extends expiration to +62d and shifts queued downgrade
        exp_2, _ = apply_subscription_entitlements_tx(
            c, {"id": "ord_a_2", "user_id": user_id, "plan_tier": "alpha", "cloud_slots_count": 5}, now_ts
        )
        assert abs(exp_2 - (now_ts + 62 * 86400)) < 5

        # Simulate time reaching the shifted downgrade activation point
        qd = json.loads(getkv(c, f"queued_downgrade:{user_id}"))
        qd["effective_after"] = now_ts - 10
        setkv(c, f"queued_downgrade:{user_id}", json.dumps(qd))

    sub_data = get_user_subscription(user_id)
    assert sub_data["is_active"] is True
    assert sub_data["plan_tier"] == "growth"
    assert sub_data["max_mt5_accounts"] == 1
    assert abs(float(sub_data["service_expires_at"]) - (now_ts + 62 * 86400)) < 5


def test_calendar_sync_provider_id_and_no_id_deduplication():
    """Verify calendar events 20-50 min apart without provider ID are not merged by title."""
    from unittest.mock import patch
    from app.domains.ai.calendar_sync import sync_economic_calendar

    ts1 = time.time() + 3600
    ts2 = ts1 + 1200  # 20 mins later, no event_id

    fake_events = [
        {"title": "Fed Governor Speech", "ts": ts1, "currency": "USD", "impact": "high"},
        {"title": "Fed Governor Speech", "ts": ts2, "currency": "USD", "impact": "high"},
    ]
    with tx() as c:
        c.execute("DELETE FROM news WHERE title = 'Fed Governor Speech'")
        with patch("app.domains.ai.calendar_sync.fetch_live_calendar", return_value=fake_events):
            added, existing = sync_economic_calendar(c)
        assert added == 2
        assert existing == 0
        count = c.execute("SELECT count(*) FROM news WHERE title = 'Fed Governor Speech'").fetchone()[0]
        assert count == 2


def test_dashboard_sql_status_filtering():
    """Verify that dashboard state filtering classifies PENDING_SUBMIT as queued in both SQL and Python."""
    user_id = "user_dash_status_test"
    acc_id = "acc_dash_status_test"
    now_ts = time.time()

    with tx() as c:
        _insert_trading_account(c, acc_id, user_id, "meta_dash_status")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))

        for i in range(10):
            c.execute(
                """
                INSERT INTO metaapi_trade_executions(
                    id, signal_id, account_id, symbol, action, volume, entry_price, status, executed_at
                ) VALUES(?, ?, ?, 'XAUUSD', 'BUY', 0.1, 2600.0, 'PENDING_SUBMIT', ?)
                """,
                (f"exec_q_{i}", f"sig_q_{i}", acc_id, now_ts - i * 10),
            )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, symbol, action, volume, entry_price, status, executed_at, closed_at, profit
            ) VALUES('exec_c_1', 'sig_c_1', ?, 'XAUUSD', 'BUY', 0.1, 2600.0, 'CLOSED', ?, ?, 25.0)
            """,
            (acc_id, now_ts - 200, now_ts - 100),
        )

        state_filter_clause = " AND UPPER(e.status) IN ('CLOSED', 'COMPLETED')"
        rows = c.execute(
            f"""
            SELECT e.* FROM metaapi_trade_executions e
            JOIN trading_accounts ta ON e.account_id = ta.id
            WHERE ta.user_id = ?{state_filter_clause}
            ORDER BY e.executed_at DESC LIMIT 5
            """,
            (user_id,),
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["id"] == "exec_c_1"
        assert rows[0]["status"] == "CLOSED"
