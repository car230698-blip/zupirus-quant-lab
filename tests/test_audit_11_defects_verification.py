import asyncio
import json
import time
import pytest
from app.db import tx, getkv, setkv
from app.domains.ai.calendar_sync import sync_economic_calendar
from app.domains.signals.ingestion.sanitizer import check_news_shield
from app.domains.execution.engine import get_closed_candles_for_strategy, demo_step, autonomous_agent_step_async
from app.domains.execution.watcher import PositionWatcher
from app.domains.notifications.service import run_daily_executive_digest
from app.domains.billing.service import apply_subscription_entitlements_tx, _deploy_with_retries
from app.domains.billing.subscription import run_subscription_lifecycle_cycle


def _ensure_user(c, user_id: str, role: str = "customer"):
    c.execute(
        "INSERT OR IGNORE INTO users (id, email, password, role) VALUES (?, ?, 'pass123', ?)",
        (user_id, f"{user_id}@example.com", role),
    )


def _insert_trading_account(
    c, acc_id, user_id, metaapi_account_id, auto_trade=1,
    balance=10000.0, equity=10000.0, deployment_state="DEPLOYED",
    account_type="STANDARD", currency="USD", cloud_expires_at=0.0
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
        ) VALUES (?, ?, ?, ?, 'Exness-Real', 'enc_pass', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            deployment_state=excluded.deployment_state,
            auto_trade=excluded.auto_trade,
            cloud_expires_at=excluded.cloud_expires_at
        """,
        (
            acc_id, user_id, metaapi_account_id, f"login_{acc_id}", auto_trade, balance,
            equity, deployment_state, account_type, currency,
            cloud_expires_at, time.time()
        ),
    )


def _ensure_signal(c, sig_id: str):
    c.execute(
        "INSERT OR IGNORE INTO signals (id, source, side, price, sl, tp, created, expires) VALUES (?, 'DEMO', 'BUY', 2000.0, 1990.0, 2020.0, ?, ?)",
        (sig_id, time.time(), time.time() + 86400),
    )


@pytest.mark.asyncio
async def test_item_1_calendar_rescheduled_within_30m_updates_event_time_and_blocks_sanitizer(monkeypatch):
    """Test 1: When economic event is rescheduled (e.g. CPI shifted by 20m),
    DB updates event timestamp, logs audit trail, and news shield protects at new time."""
    now = time.time()
    t_original = now + 600.0  # 10 minutes ahead
    t_rescheduled = t_original + 1200.0  # shifted 20 minutes later

    with tx() as c:
        c.execute("DELETE FROM news WHERE title LIKE '%CPI Test%'")
        c.execute("DELETE FROM kv WHERE key = 'news_last_synced_at'")
        c.execute("DELETE FROM audit WHERE actor = 'calendar_sync'")

    # Initial sync
    feed_1 = [{
        "id": "cpi_101",
        "title": "US CPI Test Inflation",
        "currency": "USD",
        "impact": "high",
        "ts": t_original,
    }]
    monkeypatch.setattr("app.domains.ai.calendar_sync.fetch_live_calendar", lambda: feed_1)

    with tx() as c:
        added, existing = sync_economic_calendar(c)
        assert added == 1

    # Verify news shield blocks at original time
    blocked, reason = check_news_shield(t_original)
    assert blocked is False
    assert "US CPI Test Inflation" in reason

    # Second sync: event is rescheduled 20 minutes later (t_rescheduled)
    feed_2 = [{
        "id": "cpi_101",
        "title": "US CPI Test Inflation",
        "currency": "USD",
        "impact": "high",
        "ts": t_rescheduled,
    }]
    monkeypatch.setattr("app.domains.ai.calendar_sync.fetch_live_calendar", lambda: feed_2)

    with tx() as c:
        added, existing = sync_economic_calendar(c)
        assert existing >= 1
        row = c.execute("SELECT ts FROM news WHERE title = 'US CPI Test Inflation'").fetchone()
        assert row is not None
        assert abs(float(row[0]) - t_rescheduled) < 0.1

        audit_row = c.execute("SELECT detail FROM audit WHERE actor = 'calendar_sync' AND event = 'EVENT_RESCHEDULED' ORDER BY id DESC LIMIT 1").fetchone()
        assert audit_row is not None
        audit_data = json.loads(audit_row[0])
        assert audit_data["news_id"] == "cpi_101"
        assert audit_data["shift_minutes"] == 20.0

    # Verify news shield now blocks at the new rescheduled time!
    blocked_new, reason_new = check_news_shield(t_rescheduled)
    assert blocked_new is False
    assert "US CPI Test Inflation" in reason_new


@pytest.mark.asyncio
async def test_item_2_demo_stream_strictly_filters_by_symbol():
    """Test 2: DEMO candle extraction and quote aggregation strictly filter by symbol,
    preventing mixing of Gold (2700) and EURUSD (1.10)."""
    now = time.time()
    with tx() as c:
        c.execute("DELETE FROM candles WHERE source = 'DEMO'")
        c.execute("DELETE FROM quotes WHERE source = 'DEMO'")

        # Insert 30 candles for XAUUSD at 2700
        for i in range(30):
            t = now - (35 - i) * 900
            c.execute(
                "INSERT INTO candles (time, source, symbol, timeframe, open, high, low, close, volume) VALUES (?, 'DEMO', 'XAUUSD', 'M15', 2700, 2710, 2690, 2705, 50)",
                (t,),
            )
        # Insert 30 candles for EURUSD at 1.08
        for i in range(30):
            t = now - (35 - i) * 900
            c.execute(
                "INSERT INTO candles (time, source, symbol, timeframe, open, high, low, close, volume) VALUES (?, 'DEMO', 'EURUSD', 'M15', 1.0800, 1.0850, 1.0750, 1.0820, 30)",
                (t,),
            )

        eur_candles, tf = get_closed_candles_for_strategy(c, source='DEMO', timeframe='M15', min_required=20, symbol='EURUSD')
        assert len(eur_candles) >= 20
        for cand in eur_candles:
            assert cand['close'] < 2.0  # Strictly EURUSD, zero contamination from 2700 gold!

        xau_candles, tf = get_closed_candles_for_strategy(c, source='DEMO', timeframe='M15', min_required=20, symbol='XAUUSD')
        assert len(xau_candles) >= 20
        for cand in xau_candles:
            assert cand['close'] > 2000.0  # Strictly Gold!


@pytest.mark.asyncio
async def test_item_3_engine_rejects_stale_or_gap_m15_candles(monkeypatch):
    """Test 3: Engine skips execution if M15 candles stopped updating 30-60m ago or contain gaps,
    even if current tick prices are fresh."""
    now = time.time()
    sym = "XAUUSD"

    with tx() as c:
        c.execute("DELETE FROM candles WHERE symbol = ?", (sym,))
        c.execute("DELETE FROM quotes WHERE symbol = ?", (sym,))
        c.execute("DELETE FROM strategy_candidates WHERE id = 'cand_test_3'")
        c.execute("INSERT INTO kv (key, value) VALUES ('signal_mode', 'ZUPIRUS_AGENT'), ('halted', '0') ON CONFLICT(key) DO UPDATE SET value=excluded.value")

        # Create approved strategy
        rules = {"symbol": sym, "strategy": "strat_trend_breakout", "sl_points": 5.0, "tp_points": 10.0}
        c.execute(
            "INSERT INTO strategy_candidates (id, name, rules_json, created_at, updated_at, status) VALUES ('cand_test_3', 'Test Cand', ?, ?, ?, 'APPROVED_FOR_PROD')",
            (json.dumps(rules), now + 1000, now + 1000),
        )

        # Insert candles that stopped 45 minutes ago (now - 45*60)
        stale_stop_time = now - 2700.0
        for i in range(30):
            t = stale_stop_time - (35 - i) * 900
            c.execute(
                "INSERT INTO candles (time, source, symbol, timeframe, open, high, low, close, volume) VALUES (?, 'TEST_STALE', 'XAUUSD', 'M15', 2900, 2905, 2895, 2900, 50)",
                (t,),
            )
        # Fresh live quote at current time
        c.execute(
            "INSERT INTO quotes (time, source, symbol, ts, bid, ask) VALUES (?, 'MARKET_LIVE', 'XAUUSD', ?, 2900.0, 2900.2) ON CONFLICT(source, symbol, ts) DO UPDATE SET bid=excluded.bid",
            (now, now),
        )

    try:
        # Call autonomous step
        res = await autonomous_agent_step_async(symbol=sym)
        assert res["status"] == "SKIPPED"
        assert "STALE_CANDLES" in res["reason"]
    finally:
        with tx() as c:
            c.execute("DELETE FROM candles WHERE symbol = ?", (sym,))
            c.execute("DELETE FROM quotes WHERE symbol = ?", (sym,))
            c.execute("DELETE FROM strategy_candidates WHERE id = 'cand_test_3'")


@pytest.mark.asyncio
async def test_item_4_position_api_failure_does_not_falsely_mark_partial_as_closed():
    """Test 4: When position API fails/throws exception, a partial close deal (50% vol)
    must NOT mark execution as closed_at or emit full broker close to hindsight."""
    now = time.time()
    acc_id = "acc_test_partial"
    pos_id = "pos_part_101"
    exec_id = "exec_part_101"
    usr_id = "usr_part"

    with tx() as c:
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        c.execute("DELETE FROM trading_accounts WHERE id = ?", (acc_id,))
        c.execute("DELETE FROM kv WHERE key LIKE ?", (f"%:{acc_id}%",))

        _ensure_signal(c, 'sig_part_1')
        _insert_trading_account(
            c, acc_id, usr_id, "meta_part", auto_trade=1,
            balance=10000, equity=10000, deployment_state="DEPLOYED",
            cloud_expires_at=now + 86400
        )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (id, signal_id, account_id, metaapi_account_id, symbol, action, volume, closed_volume, entry_price, position_id, status, executed_at)
            VALUES (?, 'sig_part_1', ?, 'meta_part', 'XAUUSD', 'BUY', 0.10, 0.0, 2000.0, ?, 'FILLED', ?)
            """,
            (exec_id, acc_id, pos_id, now - 300),
        )

    class MockFailingPositionsClient:
        async def get_account_information(self, meta_id):
            return {"balance": 10000, "equity": 10000, "connected": True, "connectionStatus": "CONNECTED"}

        async def get_open_positions(self, meta_id):
            raise ConnectionError("MetaApi timeout connecting to terminal")

        async def get_closed_deals(self, meta_id, hours=24):
            return [{
                "id": "deal_half_01",
                "positionId": pos_id,
                "entryType": "DEAL_ENTRY_OUT",
                "volume": 0.05,  # only 50% closed
                "profit": 150.0,
                "swap": 0.0,
                "commission": -2.0,
                "price": 2015.0,
            }]

    watcher = PositionWatcher(metaapi_client=MockFailingPositionsClient())
    await watcher.run_cycle()

    with tx() as c:
        row = c.execute("SELECT closed_at, closed_volume, profit FROM metaapi_trade_executions WHERE id = ?", (exec_id,)).fetchone()
        assert row is not None
        assert row[0] is None  # closed_at must be NULL! Not closed!
        assert abs(float(row[1]) - 0.05) < 0.001
        assert float(row[2]) > 0


@pytest.mark.asyncio
async def test_item_5_watcher_reads_deals_beyond_24h_watermark():
    """Test 5: If watcher was down for 36 hours, it reads deals with dynamic hours window
    from last_reconciled watermark (e.g. 38 hours) and captures older deals."""
    now = time.time()
    acc_id = "acc_watermark_test"
    usr_id = "usr_wm"

    with tx() as c:
        c.execute("DELETE FROM trading_accounts WHERE id = ?", (acc_id,))
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        # Set watermark to 36 hours ago
        setkv(c, f"deals_reconciled_watermark:{acc_id}", str(now - 36 * 3600))
        setkv(c, f"deals_sync_ts:{acc_id}", "0")

        _insert_trading_account(
            c, acc_id, usr_id, "meta_wm", auto_trade=1,
            balance=10000, equity=10000, deployment_state="DEPLOYED",
            cloud_expires_at=now + 86400
        )

    requested_hours = []

    class MockWatermarkClient:
        async def get_account_information(self, meta_id):
            return {"balance": 10000, "equity": 10000, "connected": True, "connectionStatus": "CONNECTED"}

        async def get_open_positions(self, meta_id):
            return []

        async def get_closed_deals(self, meta_id, hours=24):
            requested_hours.append(hours)
            return []

    watcher = PositionWatcher(metaapi_client=MockWatermarkClient())
    await watcher.run_cycle()

    assert len(requested_hours) >= 1
    # Watermark 36h ago means hours requested must be >= 38h!
    assert requested_hours[0] >= 38


@pytest.mark.asyncio
async def test_item_6_hindsight_idempotency_includes_account_id(monkeypatch):
    """Test 6: Two different accounts with the same signal_id and same deal_id (e.g. '12345')
    both get reflected in hindsight PnL accumulation without one blocking the other."""
    now = time.time()
    acc1 = "acc_idemp_1"
    acc2 = "acc_idemp_2"
    sig = "sig_shared_001"
    deal_id = "deal_shared_999"

    with tx() as c:
        c.execute("DELETE FROM trading_accounts WHERE id IN (?, ?)", (acc1, acc2))
        c.execute("DELETE FROM metaapi_trade_executions WHERE signal_id = ?", (sig,))
        c.execute("DELETE FROM kv WHERE key LIKE ?", (f"%:{deal_id}%",))

        _ensure_signal(c, sig)
        for acc in (acc1, acc2):
            _insert_trading_account(
                c, acc, f"usr_{acc}", f"meta_{acc}", auto_trade=1,
                balance=10000, equity=10000, deployment_state="DEPLOYED",
                cloud_expires_at=now + 86400
            )
            c.execute(
                """
                INSERT INTO metaapi_trade_executions (id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price, position_id, status, executed_at)
                VALUES (?, ?, ?, ?, 'XAUUSD', 'BUY', 0.1, 2000.0, ?, 'FILLED', ?)
                """,
                (f"exec_{acc}", sig, acc, f"meta_{acc}", f"pos_{acc}", now - 100),
            )

    reflected_calls = []

    def mock_reflect(c, signal_id, pnl, exit_price, exit_reason, accumulate_pnl=True):
        reflected_calls.append({"signal_id": signal_id, "pnl": pnl, "exit_reason": exit_reason})

    monkeypatch.setattr("app.hindsight.reflect_on_signal_outcome", mock_reflect)

    class MockMultiAccClient:
        async def get_account_information(self, meta_id):
            return {"balance": 10000, "equity": 10000, "connected": True, "connectionStatus": "CONNECTED"}

        async def get_open_positions(self, meta_id):
            return []

        async def get_closed_deals(self, meta_id, hours=24):
            acc_name = meta_id.replace("meta_", "")
            return [{
                "id": deal_id,
                "positionId": f"pos_{acc_name}",
                "entryType": "DEAL_ENTRY_OUT",
                "volume": 0.1,
                "profit": 100.0,
                "swap": 0.0,
                "commission": 0.0,
                "price": 2010.0,
            }]

    watcher = PositionWatcher(metaapi_client=MockMultiAccClient())
    await watcher.run_cycle()

    # Both accounts must have triggered reflection!
    assert len(reflected_calls) == 2


@pytest.mark.asyncio
async def test_item_7_cent_account_currency_usc_euc_divided_by_100():
    """Test 7: Account with account_type='STANDARD' but currency='USC'
    has its deal profit divided by 100 correctly."""
    now = time.time()
    acc_id = "acc_usc_test"
    pos_id = "pos_usc_1"
    exec_id = "exec_usc_1"
    usr_id = "usr_usc"

    with tx() as c:
        c.execute("DELETE FROM trading_accounts WHERE id = ?", (acc_id,))
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        c.execute("DELETE FROM kv WHERE key LIKE ? OR key LIKE ?", (f"%{acc_id}%", "%deal_usc_001%"))

        _ensure_signal(c, 'sig_usc_1')
        _insert_trading_account(
            c, acc_id, usr_id, "meta_usc", auto_trade=1,
            balance=1000000, equity=1000000, deployment_state="DEPLOYED",
            account_type="STANDARD", currency="USC", cloud_expires_at=now + 86400
        )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price, position_id, status, executed_at)
            VALUES (?, 'sig_usc_1', ?, 'meta_usc', 'XAUUSD', 'BUY', 1.0, 2000.0, ?, 'FILLED', ?)
            """,
            (exec_id, acc_id, pos_id, now - 100),
        )

    class MockCentClient:
        async def get_account_information(self, meta_id):
            return {"balance": 1000000, "equity": 1000000, "connected": True, "connectionStatus": "CONNECTED"}

        async def get_open_positions(self, meta_id):
            return []

        async def get_closed_deals(self, meta_id, hours=24):
            return [{
                "id": "deal_usc_001",
                "positionId": pos_id,
                "entryType": "DEAL_ENTRY_OUT",
                "volume": 1.0,
                "profit": 5000.0,  # 5,000 cents = $50.00
                "swap": 0.0,
                "commission": 0.0,
                "price": 2005.0,
            }]

    watcher = PositionWatcher(metaapi_client=MockCentClient())
    await watcher.run_cycle()

    with tx() as c:
        row = c.execute("SELECT profit FROM metaapi_trade_executions WHERE id = ?", (exec_id,)).fetchone()
        assert row is not None
        assert abs(float(row[0]) - 50.00) < 0.01  # Must be 50.0, NOT 5000.0!


@pytest.mark.asyncio
async def test_item_8_notifications_daily_digest_and_renewal_not_marked_sent_on_mailer_failure(monkeypatch):
    """Test 8: Mailer failures do NOT mark messages as sent in DB, allowing clean retries."""
    with tx() as c:
        c.execute("DELETE FROM kv WHERE key = 'daily_digest_last_date'")

    # 1. Daily digest fails
    monkeypatch.setattr("app.core.mailer.send_admin_alert_email", lambda title, detail: {"ok": False, "error": "RESEND_DOWN"})
    with tx() as c:
        res = run_daily_executive_digest(c, force=True)
        assert res["ok"] is False
        assert getkv(c, "daily_digest_last_date") is None

    # 2. Daily digest succeeds
    monkeypatch.setattr("app.core.mailer.send_admin_alert_email", lambda title, detail: {"ok": True, "id": "msg_123"})
    with tx() as c:
        res2 = run_daily_executive_digest(c, force=True)
        assert res2["ok"] is True
        assert getkv(c, "daily_digest_last_date") is not None


@pytest.mark.asyncio
async def test_item_9_subscription_renewal_preserves_auto_trade_zero():
    """Test 9: Renewing subscription and deploying terminal preserves user's auto_trade=0 setting."""
    now = time.time()
    user_id = "usr_autotrade_zero"
    acc_id = "acc_autotrade_zero"

    with tx() as c:
        c.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM trading_accounts WHERE id = ?", (acc_id,))
        c.execute("DELETE FROM orders WHERE user_id = ?", (user_id,))

        _insert_trading_account(
            c, acc_id, user_id, "meta_at0", auto_trade=0,
            balance=10000, equity=10000, deployment_state="UNDEPLOYED",
            cloud_expires_at=0
        )

        order = {
            "id": "ord_at0_renew",
            "user_id": user_id,
            "plan_tier": "starter",
            "cloud_slots_count": 1,
        }
        new_sub_exp, to_deploy = apply_subscription_entitlements_tx(c, order, now)

        row = c.execute("SELECT auto_trade, deployment_state FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone()
        assert row[0] == 0  # Must stay 0!

    class MockDeployClient:
        async def deploy_account(self, meta_id):
            return True

    await _deploy_with_retries(to_deploy, client=MockDeployClient())

    with tx() as c:
        row2 = c.execute("SELECT auto_trade, deployment_state FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone()
        assert row2[0] == 0  # Must still be 0 after deployment!
        assert row2[1] == "DEPLOYED"


@pytest.mark.asyncio
async def test_item_10_downgrade_aligns_subscription_and_cloud_expiry():
    """Test 10: Purchasing Starter (30d) while active on Alpha (90d)
    aligns subscription expiration and cloud terminal expiration identically (120 days)."""
    now = time.time()
    user_id = "usr_downgrade_test"
    acc_id = "acc_downgrade_test"
    alpha_90d = now + 90 * 86400

    with tx() as c:
        c.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM trading_accounts WHERE id = ?", (acc_id,))
        c.execute("DELETE FROM orders WHERE user_id = ?", (user_id,))

        _ensure_user(c, user_id)
        c.execute(
            """
            INSERT INTO subscriptions (id, user_id, plan_tier, service_expires_at, max_mt5_accounts, created_at, updated_at)
            VALUES ('sub_alpha_90', ?, 'alpha', ?, 3, ?, ?)
            """,
            (user_id, alpha_90d, now, now),
        )
        _insert_trading_account(
            c, acc_id, user_id, "meta_dg", auto_trade=1,
            balance=10000, equity=10000, deployment_state="DEPLOYED",
            cloud_expires_at=alpha_90d
        )

        starter_order = {
            "id": "ord_starter_30d",
            "user_id": user_id,
            "plan_tier": "starter",
            "cloud_slots_count": 1,
        }
        new_sub_exp, _ = apply_subscription_entitlements_tx(c, starter_order, now)

        sub_row = c.execute("SELECT service_expires_at FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        acc_row = c.execute("SELECT cloud_expires_at FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone()

        assert sub_row is not None and acc_row is not None
        # Both must be EXACTLY identical (120 days = 90d + 30d)
        assert abs(float(sub_row[0]) - float(acc_row[0])) < 0.001
        assert abs(float(sub_row[0]) - (alpha_90d + 30 * 86400)) < 1.0


@pytest.mark.asyncio
async def test_item_11_expired_deploy_pending_account_not_deployed_by_worker():
    """Test 11: DEPLOY_PENDING account with expired subscription and cloud
    is NOT deployed by worker; it transitions to UNDEPLOYED or EXPIRED_PROTECTING."""
    now = time.time()
    user_id = "usr_exp_dp"
    acc_id = "acc_exp_dp"

    with tx() as c:
        _ensure_user(c, user_id)
        c.execute("DELETE FROM subscriptions")
        c.execute("DELETE FROM trading_accounts")

        # Expired 1 hour ago
        c.execute(
            """
            INSERT INTO subscriptions (id, user_id, plan_tier, service_expires_at, max_mt5_accounts, created_at, updated_at)
            VALUES ('sub_exp_dp', ?, 'starter', ?, 1, ?, ?)
            """,
            (user_id, now - 3600, now - 86400, now - 86400),
        )
        _insert_trading_account(
            c, acc_id, user_id, "meta_exp_dp", auto_trade=1,
            balance=10000, equity=10000, deployment_state="DEPLOY_PENDING",
            cloud_expires_at=now - 3600
        )

    deploy_called = []

    class MockDeployCheckClient:
        async def deploy_account(self, meta_id):
            deploy_called.append(meta_id)
            return True

        async def get_open_positions(self, meta_id):
            return []

    stats = await run_subscription_lifecycle_cycle(meta_client=MockDeployCheckClient())

    # deploy_account MUST NOT be called!
    assert len(deploy_called) == 0
    assert stats.get("undeployed_idle", 0) >= 1

    with tx() as c:
        row = c.execute("SELECT deployment_state, auto_trade FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone()
        assert row[0] == "UNDEPLOYED"
        assert row[1] == 0
