import pytest
import time
import json
import sqlite3
from unittest.mock import MagicMock, AsyncMock, patch

from app.db import tx, init, setkv, getkv
from app.domains.execution.watcher import reconcile_account_positions, PositionWatcher
from app.migrations.seed_and_fixes import apply_migration_026


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    test_db = tmp_path / "test_defects_411.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{test_db}")
    monkeypatch.setattr("app.core.db.DB", test_db)
    monkeypatch.setattr("app.db.DB", test_db)
    init()
    yield


def _seed_account(acc_id="acc_test", meta_id="meta_test"):
    now = time.time()
    uid = f"usr_{acc_id}"
    login_val = f"log_{acc_id}"
    with tx() as c:
        c.execute("INSERT OR REPLACE INTO users (id, email, password, role) VALUES (?, ?, 'hash', 'customer')", (uid, f"{uid}@test.com"))
        c.execute(
            """
            INSERT OR REPLACE INTO metaapi_cloud_accounts (id, user_id, login, server, created_at)
            VALUES (?, ?, ?, 'Demo', ?)
            """,
            (acc_id, uid, login_val, now)
        )
        c.execute(
            """
            INSERT OR REPLACE INTO trading_accounts (
                id, user_id, metaapi_account_id, mt5_login, encrypted_master_password,
                broker_server, auto_trade, deployment_state, balance, equity, created_at
            ) VALUES (?, ?, ?, ?, 'enc', 'Demo', 1, 'DEPLOYED', 10000.0, 10000.0, ?)
            """,
            (acc_id, uid, meta_id, login_val, now)
        )


def test_watcher_matched_deals_deduplication_when_position_missing():
    """Verify that when position is missing from live positions, duplicate closing deals do not inflate total_out_vol and cause false CLOSED transition."""
    acc_id = "acc_dedup_deals"
    meta_id = "meta_dedup_deals"
    _seed_account(acc_id, meta_id)

    now_ts = time.time()
    exec_id = "exec_timeout_test"
    ucid = "cid_timeout_100"

    with tx() as c:
        c.execute(
            """
            INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
            VALUES ('sig_timeout_1', 'DEMO', 'BUY', 2000.0, 1990.0, 2020.0, ?, ?)
            """,
            (now_ts, now_ts + 3600)
        )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, position_id, order_id, status, latency_ms,
                executed_at, profit, ticket, origin, reserved_risk_pct, client_order_id
            )
            VALUES (?, 'sig_timeout_1', ?, ?, 'XAUUSD', 'BUY', 1.0, 2000.0, 1990.0, 2020.0,
                    NULL, NULL, 'UNKNOWN_EXECUTION', 10, ?, 0.0, NULL, 'AGENT', 1.0, ?)
            """,
            (exec_id, acc_id, meta_id, now_ts, ucid)
        )

    # Simulated broker deals: 1 opening deal of 1.0 lot, and DUPLICATED closing deal of 0.5 lot
    deals = [
        {"id": "deal_in_1", "clientId": ucid, "entryType": "DEAL_ENTRY_IN", "volume": 1.0, "positionId": "pos_1"},
        {"id": "deal_out_1", "clientId": ucid, "entryType": "DEAL_ENTRY_OUT", "volume": 0.5, "positionId": "pos_1"},
        {"id": "deal_out_1", "clientId": ucid, "entryType": "DEAL_ENTRY_OUT", "volume": 0.5, "positionId": "pos_1"},  # duplicate
    ]

    with tx() as c:
        # Live positions is empty (position missing from snapshot)
        reconcile_account_positions(c, acc_id, meta_id, ok=True, live_positions=[], deals=deals, now_ts=now_ts)

    with tx() as c:
        row = c.execute("SELECT status, closed_volume FROM metaapi_trade_executions WHERE id = ?", (exec_id,)).fetchone()
        status = row[0]
        closed_vol = row[1]
        # Should NOT be CLOSED with 1.0 lot. Total unique out volume is 0.5, which is < orig_vol 1.0, so it must be AMBIGUOUS_LOCKED
        assert status == "AMBIGUOUS_LOCKED"
        assert closed_vol == 0.5


def test_watcher_pending_submit_reconciliation_by_order_id():
    """Verify that a PENDING_SUBMIT order is reconciled when live position or deals match by order_id even without client_order_id/comment."""
    acc_id = "acc_placed_match"
    meta_id = "meta_placed_match"
    _seed_account(acc_id, meta_id)

    now_ts = time.time()
    exec_id = "exec_placed_1"
    ord_id = "ord_mt5_98765"

    with tx() as c:
        c.execute(
            """
            INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
            VALUES ('sig_placed_1', 'DEMO', 'BUY', 2000.0, 1990.0, 2020.0, ?, ?)
            """,
            (now_ts, now_ts + 3600)
        )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, position_id, order_id, status, latency_ms,
                executed_at, profit, ticket, origin, reserved_risk_pct, client_order_id
            )
            VALUES (?, 'sig_placed_1', ?, ?, 'XAUUSD', 'BUY', 0.1, 2000.0, 1990.0, 2020.0,
                    NULL, ?, 'PENDING_SUBMIT', 10, ?, 0.0, ?, 'AGENT', 1.0, 'cid_orig_123')
            """,
            (exec_id, acc_id, meta_id, ord_id, now_ts, ord_id)
        )

    # Broker position has orderId = ord_id, but empty comment and clientId
    live_positions = [
        {
            "id": "pos_real_555",
            "orderId": ord_id,
            "clientId": "",
            "comment": "",
            "symbol": "XAUUSD",
            "type": "POSITION_TYPE_BUY",
            "volume": 0.1,
            "openPrice": 2000.0,
            "stopLoss": 1990.0,
        }
    ]

    with tx() as c:
        reconcile_account_positions(c, acc_id, meta_id, ok=True, live_positions=live_positions, deals=[], now_ts=now_ts)

    with tx() as c:
        row = c.execute("SELECT status, position_id, ticket FROM metaapi_trade_executions WHERE id = ?", (exec_id,)).fetchone()
        assert row[0] == "FILLED"
        assert row[1] == "pos_real_555"
        assert row[2] == "pos_real_555"


def test_watcher_pnl_sync_backward_compatibility():
    """Verify that deals already synced with the legacy global key deal_synced:<dl_id> are not credited again after upgrading."""
    acc_id = "acc_legacy_pnl"
    meta_id = "meta_legacy_pnl"
    _seed_account(acc_id, meta_id)

    now_ts = time.time()
    exec_id = "exec_pnl_legacy"
    pos_id = "pos_legacy_10"
    dl_id = "dl_legacy_50"

    with tx() as c:
        c.execute(
            """
            INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
            VALUES ('sig_pnl_legacy', 'DEMO', 'BUY', 2000.0, 1990.0, 2020.0, ?, ?)
            """,
            (now_ts, now_ts + 3600)
        )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions(
                id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                entry_price, sl, tp, position_id, order_id, status, latency_ms,
                executed_at, profit, ticket, origin, reserved_risk_pct
            )
            VALUES (?, 'sig_pnl_legacy', ?, ?, 'XAUUSD', 'BUY', 0.1, 2000.0, 1990.0, 2020.0,
                    ?, ?, 'CLOSED', 10, ?, 50.0, ?, 'AGENT', 1.0)
            """,
            (exec_id, acc_id, meta_id, pos_id, pos_id, now_ts, pos_id)
        )
        # Seed legacy key format
        setkv(c, f"deal_synced:{dl_id}", "1")

    # Mock PositionWatcher client to return this deal
    pw = PositionWatcher()
    pw.client = MagicMock()
    pw.client.get_account_information = AsyncMock(return_value={"connected": True, "equity": 10000.0, "balance": 10000.0})
    pw.client.get_positions_verified = AsyncMock(return_value=(True, [], {}))
    pw.client.get_open_positions = AsyncMock(return_value=[])
    pw.client.get_closed_deals = AsyncMock(return_value=[
        {
            "id": dl_id,
            "entryType": "DEAL_ENTRY_OUT",
            "positionId": pos_id,
            "profit": 50.0,
            "swap": 0.0,
            "commission": 0.0,
            "price": 2010.0,
        }
    ])

    import asyncio
    asyncio.run(pw._run_cycle_locked())

    with tx() as c:
        row = c.execute("SELECT profit FROM metaapi_trade_executions WHERE id = ?", (exec_id,)).fetchone()
        # Profit should still be 50.0, NOT 100.0
        assert row[0] == 50.0
        # New key should now be populated
        assert getkv(c, f"deal_synced:{acc_id}:{dl_id}") is not None


def test_migration_026_sqlite_upgrades_snapshots_and_signals(tmp_path):
    """Verify that apply_migration_026 on SQLite removes FK on snapshots and expands signals.source check constraint."""
    db_file = tmp_path / "legacy_sqlite.db"
    conn = sqlite3.connect(str(db_file))
    cur = conn.cursor()

    # Create legacy schema as in commit b753128
    cur.execute("PRAGMA foreign_keys = ON;")
    cur.execute("CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);")
    cur.execute("""
        CREATE TABLE snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT REFERENCES accounts(id),
            ts REAL NOT NULL,
            balance REAL NOT NULL,
            equity REAL NOT NULL
        );
    """)
    cur.execute("""
        CREATE TABLE signals (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL CHECK(source IN ('DEMO', 'REPLAY')),
            side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
            price REAL NOT NULL,
            sl REAL NOT NULL,
            tp REAL NOT NULL,
            created REAL NOT NULL,
            expires REAL NOT NULL
        );
    """)
    conn.commit()

    # Pre-migration: inserting snapshot with non-existent account_id must fail
    with pytest.raises(sqlite3.IntegrityError):
        cur.execute("INSERT INTO snapshots(account_id, ts, balance, equity) VALUES ('trading_acc_99', 1.0, 100.0, 100.0)")
        conn.commit()

    # Pre-migration: inserting signal with CLOUD_MT5 must fail
    with pytest.raises(sqlite3.IntegrityError):
        cur.execute("INSERT INTO signals VALUES ('sig_c1', 'CLOUD_MT5', 'BUY', 10.0, 9.0, 11.0, 1.0, 2.0)")
        conn.commit()

    # Run migration 026 on this legacy SQLite database
    apply_migration_026(cur, is_pg=False)
    conn.commit()

    # Post-migration: inserting snapshot with trading_acc_99 should succeed (no FK to accounts)
    cur.execute("INSERT INTO snapshots(account_id, ts, balance, equity) VALUES ('trading_acc_99', 1.0, 100.0, 100.0)")
    conn.commit()
    snap_count = cur.execute("SELECT count(*) FROM snapshots WHERE account_id = 'trading_acc_99'").fetchone()[0]
    assert snap_count == 1

    # Post-migration: inserting signal with CLOUD_MT5 should succeed
    cur.execute("INSERT INTO signals VALUES ('sig_c1', 'CLOUD_MT5', 'BUY', 10.0, 9.0, 11.0, 1.0, 2.0)")
    conn.commit()
    sig_count = cur.execute("SELECT count(*) FROM signals WHERE id = 'sig_c1'").fetchone()[0]
    assert sig_count == 1

    conn.close()


def test_manual_cloud_sync_ticket_collision_multiple_accounts():
    """Verify that when two accounts have the same MT5 ticket (e.g. 101), manual sync does not crash with UNIQUE constraint."""
    acc_1 = "acc_mt5_alpha"
    meta_1 = "meta_mt5_alpha"
    acc_2 = "acc_mt5_beta"
    meta_2 = "meta_mt5_beta"

    _seed_account(acc_1, meta_1)
    _seed_account(acc_2, meta_2)

    pw = PositionWatcher()
    pw.client = MagicMock()
    pw.client.get_account_information = AsyncMock(return_value={"connected": True, "equity": 10000.0, "balance": 10000.0})
    pw.client.get_closed_deals = AsyncMock(return_value=[])

    # Both accounts return ticket '101'
    positions_payload = [
        {
            "id": "101",
            "symbol": "XAUUSD",
            "type": "POSITION_TYPE_BUY",
            "volume": 0.05,
            "openPrice": 2650.0,
            "stopLoss": 2640.0,
            "takeProfit": 2670.0,
            "unrealizedProfit": 15.0,
        }
    ]
    pw.client.get_positions_verified = AsyncMock(return_value=(True, positions_payload, {}))
    pw.client.get_open_positions = AsyncMock(return_value=positions_payload)

    import asyncio
    asyncio.run(pw._run_cycle_locked())

    with tx() as c:
        execs = c.execute("SELECT id, account_id, ticket FROM metaapi_trade_executions WHERE ticket = '101' ORDER BY account_id").fetchall()
        assert len(execs) == 2
        assert execs[0][0] == f"exec_cloud_{acc_1}_101"
        assert execs[0][1] == acc_1
        assert execs[1][0] == f"exec_cloud_{acc_2}_101"
        assert execs[1][1] == acc_2
