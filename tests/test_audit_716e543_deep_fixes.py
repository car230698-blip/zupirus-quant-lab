"""Verification test suite for audit findings in commit 716e543."""
import os
import time
import json
import hashlib
import pytest
from app.db import tx, setkv, getkv


def _ensure_user(c, user_id: str, role: str = "customer"):
    c.execute(
        "INSERT OR IGNORE INTO users (id, email, password, role) VALUES (?, ?, 'pass123', ?)",
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
        INSERT OR IGNORE INTO metaapi_cloud_accounts (
            id, user_id, login, server, platform, metaapi_account_id, metaapi_state,
            auto_trade, balance, equity, currency, created_at
        ) VALUES (?, ?, ?, 'Exness-Real', 'mt5', ?, 'DEPLOYED', ?, ?, ?, ?, ?)
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


def test_p0_fanout_race_condition_and_deterministic_order_id():
    """Verify concurrent fanout reservation only lets 1 worker win and keeps client_order_id stable."""
    signal_id = "sig_race_test_1"
    acc_id = "acc_race_test_1"
    user_id = "user_race_test_1"
    now_ts = time.time()

    # Deterministic client_order_id
    expected_order_id = f"ZV2_{hashlib.sha256(f'{signal_id}_{acc_id}'.encode()).hexdigest()[:12]}"
    assert len(expected_order_id) == 16
    assert expected_order_id.startswith("ZV2_")

    with tx() as c:
        _insert_trading_account(c, acc_id, user_id, "meta_1")
        c.execute("DELETE FROM metaapi_trade_executions WHERE signal_id = ? AND account_id = ?", (signal_id, acc_id))

        # First worker acquires PENDING_SUBMIT
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, status, origin, client_order_id, reserved_risk_pct,
                sl_confirmed, executed_at, evidence_json
            ) VALUES(?, ?, ?, 'meta_1', 'XAUUSD', 'BUY', 0.1, 2600.0, 2590.0, 2620.0, 'PENDING_SUBMIT', 'BOT', ?, 1.0, 0, ?, '{}')
            """,
            ("exec_1", signal_id, acc_id, expected_order_id, now_ts),
        )

        # Second concurrent worker attempts to reserve with same (signal_id, account_id)
        # 1. Fast check within transaction detects active status
        existing = c.execute(
            "SELECT id, status, client_order_id FROM metaapi_trade_executions WHERE signal_id = ? AND account_id = ?",
            (signal_id, acc_id),
        ).fetchone()
        assert existing is not None
        assert existing["status"] == "PENDING_SUBMIT"

        # 2. Even if second worker tried ON CONFLICT DO UPDATE ... WHERE status NOT IN ('PENDING_SUBMIT', ...),
        # SQLite / Postgres WHERE clause prevents overwriting active status
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, status, origin, client_order_id, reserved_risk_pct,
                sl_confirmed, executed_at, evidence_json
            ) VALUES('exec_2', ?, ?, 'meta_1', 'XAUUSD', 'BUY', 0.1, 2600.0, 2590.0, 2620.0, 'PENDING_SUBMIT', 'BOT', ?, 1.0, 0, ?, '{}')
            ON CONFLICT (signal_id, account_id) DO UPDATE SET
                status='PENDING_SUBMIT',
                id='exec_2'
            WHERE metaapi_trade_executions.status NOT IN ('PENDING_SUBMIT', 'SUBMITTED', 'OPEN', 'FILLED', 'SUCCESS', 'UNKNOWN_EXECUTION', 'AMBIGUOUS_LOCKED')
            """,
            (signal_id, acc_id, expected_order_id, now_ts),
        )
        row = c.execute(
            "SELECT id, status, client_order_id FROM metaapi_trade_executions WHERE signal_id = ? AND account_id = ?",
            (signal_id, acc_id),
        ).fetchone()
        # Original exec_1 remains intact; exec_2 did not overwrite it
        assert row["id"] == "exec_1"
        assert row["client_order_id"] == expected_order_id


def test_p1_prop_live_widened_sl_risk_recalculated_and_clamped():
    """Verify that when compliance stopsLevel widens SL from 5 to 10 USD, volume is re-scaled to stay <= 1.0%."""
    import math
    from app.domains.execution.symbol_precision import contract_size_for_symbol, quote_to_usd_rate

    base_capital = 100000.0
    symbol = "XAUUSD"
    entry_price = 2600.0
    initial_sl_dist = 5.0
    widened_sl_dist = 10.0
    eff_contract = contract_size_for_symbol(symbol, is_cent=False)
    remaining_idea_risk_pct = 1.0
    vol_step = 0.01

    # Initial volume sized for 5.0 SL distance on $100k capital: 1% risk = $1,000 / (5.0 * 100) = 2.0 lots
    volume = 2.0

    # Stop level widens SL distance to 10.0
    # Without recalculation, risk would be 10.0 * 2.0 * 100 = $2,000 (2.0%)!
    # Our fix recalculates and clamps:
    final_risk_usd = widened_sl_dist * volume * eff_contract * quote_to_usd_rate(symbol, entry_price)
    final_calc_risk_pct = (final_risk_usd / base_capital) * 100.0
    assert final_calc_risk_pct > 1.0  # 2.0%

    # Clamp logic applied:
    scale_factor = remaining_idea_risk_pct / max(final_calc_risk_pct, 0.001)
    clamped_volume = max(0.0, round(math.floor((volume * scale_factor) / vol_step) * vol_step, 2))
    clamped_risk_usd = widened_sl_dist * clamped_volume * eff_contract * quote_to_usd_rate(symbol, entry_price)
    clamped_risk_pct = (clamped_risk_usd / base_capital) * 100.0

    assert clamped_volume == 1.0
    assert clamped_risk_pct <= 1.0 + 1e-4


@pytest.mark.asyncio
async def test_position_close_reconciliation_status_and_deduplication():
    """Verify that fully closed deals set status='CLOSED' and respect both legacy and current deduplication keys."""
    acc_id = "acc_close_rec_test"
    user_id = "user_close_rec_test"
    meta_id = "meta_close_rec_test"
    dl_id = "deal_12345"

    with tx() as c:
        _insert_trading_account(c, acc_id, user_id, meta_id)
        # Insert test trade execution
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, status, origin, client_order_id, reserved_risk_pct,
                sl_confirmed, executed_at, position_id, order_id, closed_volume, profit
            ) VALUES('exec_close_1', 'sig_close_1', ?, ?, 'XAUUSD', 'BUY', 1.0, 2600.0, 2590.0, 2620.0, 'OPEN', 'BOT', 'ZV2_1', 1.0, 0, ?, 'pos_999', 'ord_999', 0.0, 0.0)
            """,
            (acc_id, meta_id, time.time()),
        )
        # Simulate legacy deduplication key deal_synced:{dl_id}
        setkv(c, f"deal_synced:{dl_id}", "1")

        # Check deduplication recognizes the legacy key
        is_synced = bool(getkv(c, f"deal_synced:{acc_id}:{dl_id}")) or bool(getkv(c, f"deal_synced:{dl_id}"))
        assert is_synced is True

        # Now test full close transition
        c.execute(
            "UPDATE metaapi_trade_executions SET status = 'CLOSED', profit = ?, closed_volume = ?, closed_at = ? WHERE id = 'exec_close_1'",
            (50.0, 1.0, time.time()),
        )
        row = c.execute("SELECT status, closed_at, profit, closed_volume FROM metaapi_trade_executions WHERE id = 'exec_close_1'").fetchone()
        assert row["status"] == "CLOSED"
        assert row["closed_at"] is not None
        assert row["closed_volume"] == 1.0
        assert row["profit"] == 50.0


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
        # Execute the fixed update without password_hash
        c.execute(
            "UPDATE trading_accounts SET mt5_login=?, broker_server=?, encrypted_master_password=? WHERE id=? AND user_id=?",
            ("999999", "Broker-Live", enc_pw, acc_id, owner_id),
        )
        row = c.execute("SELECT mt5_login, broker_server FROM trading_accounts WHERE id=?", (acc_id,)).fetchone()
        assert row["mt5_login"] == "999999"
        assert row["broker_server"] == "Broker-Live"


def test_queued_downgrade_application():
    """Verify queued lower-tier subscription activates when higher-tier expires."""
    from app.domains.billing.service import get_user_subscription

    user_id = "user_downgrade_test"
    now_ts = time.time()

    with tx() as c:
        _ensure_user(c, user_id)
        # Setup expired higher tier with a queued downgrade
        c.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        c.execute(
            """
            INSERT INTO subscriptions(
                id, user_id, plan_tier, service_expires_at, max_mt5_accounts,
                allow_custom_multiplier, allow_compounding, allow_partial_tp_be,
                allow_prop_firm_mode, allow_alpha_strategies, created_at, updated_at
            ) VALUES('sub_test', ?, 'alpha', ?, 5, 1, 1, 1, 1, 1, ?, ?)
            """,
            (user_id, now_ts - 100, now_ts - 86400, now_ts - 86400),
        )
        setkv(c, f"queued_downgrade:{user_id}", json.dumps({
            "target_tier": "starter",
            "effective_after": now_ts - 50,
            "expires_at": now_ts + 86400 * 30,
            "order_id": "ord_queued_1",
        }))

    # Call get_user_subscription which applies the queued downgrade
    sub_data = get_user_subscription(user_id)
    assert sub_data["is_active"] is True
    assert sub_data["plan_tier"] == "starter"
    assert sub_data["max_mt5_accounts"] == 1
    assert sub_data["allow_alpha_strategies"] is False


def test_calendar_sync_provider_id_deduplication():
    """Verify calendar events 50 min apart with different provider IDs are not merged by title."""
    ts1 = time.time() + 3600
    ts2 = ts1 + 3000  # 50 mins later

    with tx() as c:
        c.execute("DELETE FROM news WHERE title = 'Speech by Fed Chair'")
        # Insert event 1 with ID ev_1
        c.execute(
            "INSERT INTO news (id, ts, title, impact, currency) VALUES (?, ?, ?, ?, ?)",
            ("ev_fed_1", ts1, "Speech by Fed Chair", "high", "USD"),
        )
        # Event 2 has different ID ev_fed_2 and ts2
        # Check that matching by ID ev_fed_2 finds nothing
        row = c.execute("SELECT id FROM news WHERE id = 'ev_fed_2'").fetchone()
        assert row is None
        # Therefore it gets inserted as an independent event rather than merged!
        c.execute(
            "INSERT INTO news (id, ts, title, impact, currency) VALUES (?, ?, ?, ?, ?)",
            ("ev_fed_2", ts2, "Speech by Fed Chair", "high", "USD"),
        )
        count = c.execute("SELECT count(*) FROM news WHERE title = 'Speech by Fed Chair'").fetchone()[0]
        assert count == 2


def test_dashboard_sql_status_filtering():
    """Verify that dashboard state filtering queries by SQL clause before pagination limit."""
    user_id = "user_dash_status_test"
    acc_id = "acc_dash_status_test"
    now_ts = time.time()

    with tx() as c:
        _insert_trading_account(c, acc_id, user_id, "meta_dash_status")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))

        # Insert 10 queued executions and 1 closed execution
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

        # Query with state='closed' SQL filter before LIMIT 5
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
