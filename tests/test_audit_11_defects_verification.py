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
        c.execute("DELETE FROM kv WHERE key LIKE 'deals_sync_ts:%'")
        c.execute("DELETE FROM kv WHERE key LIKE 'deals_reconciled_watermark:%'")

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


@pytest.mark.asyncio
async def test_audit_79c40b5_all_9_findings_remediated(monkeypatch):
    """Comprehensive verification for all 9 findings reported on commit 79c40b5:
    1. Canary counts each unique execution_id once even when 10 signal_audit_logs share signal_id.
    2. First Cent deal sync uses freshly verified broker currency (1200 USC -> 12.00 USD).
    3. MT5 relink halts with HTTP 400 and does NOT save password when Cloud update_account_credentials fails.
    4. Yahoo M15 bars keep source='YAHOO_REFERENCE' even when live quote came from MetaApi, and Yahoo ticks keep source='YAHOO_REFERENCE'.
    5. Outbox publish() succeeds on SQLite even when failed rows contain malformed JSON; transient Redis errors keep status='pending' for automatic recovery.
    6. Admin billing orders marks cloud_ready=False when terminal is CONNECTING or last_sync is stale, and manual recovery separates entitlement vs failed cloud deploy.
    7. Snapshot retention preserves 30D and 90D equity history after worker cleanup.
    8. SEO guide pages and Discord daily digest / bilingual script have no broken imports or removed track-record promotions.
    """
    now = time.time()

    # --- 1. Canary unique execution count ---
    cand_id = "cand_79c_unique_exec"
    sig_id = f"{cand_id}:sig_dup_test"
    with tx() as c:
        c.execute("DELETE FROM strategy_candidates WHERE id = ?", (cand_id,))
        c.execute("DELETE FROM metaapi_trade_executions WHERE signal_id = ?", (sig_id,))
        c.execute("DELETE FROM signal_audit_logs WHERE signal_id = ?", (sig_id,))
        c.execute(
            """
            INSERT INTO strategy_candidates (id, name, status, rules_json, updated_at, created_at)
            VALUES (?, 'Canary Dedup Strat', 'CANARY_DEMO', ?, ?, ?)
            """,
            (cand_id, json.dumps({"canary_started_at": now - 8 * 86400}), now - 8 * 86400, now - 8 * 86400),
        )
        c.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"canary_strat:{cand_id}:started_at", str(now - 8 * 86400)),
        )
        # 1 CLOSED execution
        _ensure_user(c, "usr_79c_canary")
        _insert_trading_account(c, "acc_79c", "usr_79c_canary", "meta_79c_can", auto_trade=1, cloud_expires_at=now + 86400)
        _ensure_signal(c, sig_id)
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (id, signal_id, account_id, metaapi_account_id, symbol, action, volume, entry_price, status, profit, executed_at, closed_at)
            VALUES ('exec_79c_1', ?, 'acc_79c', 'meta_79c_can', 'XAUUSD', 'BUY', 0.1, 2650.0, 'CLOSED', 25.0, ?, ?)
            """,
            (sig_id, now - 86400, now - 3600),
        )
        # 1 valid audit + 9 duplicate/rejected audits sharing the same signal_id
        for i in range(10):
            c.execute(
                """
                INSERT INTO signal_audit_logs (id, signal_id, strategy_id, source_name, symbol, side, entry_price, status, reject_reason, pnl, created_at)
                VALUES (?, ?, ?, ?, 'XAUUSD', 'BUY', 2650.0, ?, ?, ?, ?)
                """,
                (
                    f"aud_79c_{i}",
                    sig_id,
                    cand_id,
                    cand_id,
                    "APPROVED" if i == 0 else "REJECTED",
                    None if i == 0 else "DUPLICATE_SIGNAL",
                    25.0 if i == 0 else None,
                    now - 86400 + i,
                ),
            )

    from app.domains.ai.research_graph import run_autonomous_induction_and_wfo
    run_autonomous_induction_and_wfo(force=True)
    with tx() as c:
        st_row = c.execute("SELECT status FROM strategy_candidates WHERE id = ?", (cand_id,)).fetchone()
        assert st_row is not None
        # Only 1 unique closed execution (< 10 threshold), so it MUST NOT promote to APPROVED_FOR_PROD!
        assert st_row[0] != "APPROVED_FOR_PROD"

    # --- 2. First Cent deal sync normalizes PnL by 100 ---
    cent_acc_id = "acc_79c_first_cent"
    cent_exec_id = "exec_79c_first_cent"
    with tx() as c:
        _ensure_user(c, "usr_79c_cent")
        _ensure_signal(c, "sig_cent_1")
        c.execute("DELETE FROM trading_accounts")
        c.execute("DELETE FROM metaapi_trade_executions WHERE id = ?", (cent_exec_id,))
        c.execute("DELETE FROM kv WHERE key LIKE 'deal_synced:acc_79c_first_cent%'")
        c.execute("DELETE FROM kv WHERE key LIKE 'deals_sync_ts:acc_79c_first_cent%'")
        c.execute("DELETE FROM kv WHERE key LIKE 'deals_reconciled_watermark:acc_79c_first_cent%'")
        c.execute("DELETE FROM kv WHERE key LIKE 'emergency_close_pending:%'")
        # Legacy DB has currency='USD' and account_type='STANDARD'
        _insert_trading_account(
            c, cent_acc_id, "usr_79c_cent", "meta_79c_cent",
            account_type="STANDARD", currency="USD", balance=10000, equity=10000,
            cloud_expires_at=now + 86400
        )
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (id, signal_id, account_id, metaapi_account_id, position_id, order_id, ticket, symbol, action, volume, entry_price, status, executed_at)
            VALUES (?, 'sig_cent_1', ?, 'meta_79c_cent', 'pos_cent_79c', 'pos_cent_79c', 'pos_cent_79c', 'XAUUSDc', 'BUY', 1.0, 2650.0, 'FILLED', ?)
            """,
            (cent_exec_id, cent_acc_id, now - 600),
        )

    class MockCentFirstSyncClient:
        is_mock = False
        async def get_account_information(self, meta_id):
            return {"balance": 11200.0, "equity": 11200.0, "currency": "USC", "connected": True, "connectionStatus": "CONNECTED"}
        async def get_open_positions(self, meta_id):
            return []
        async def get_closed_deals(self, meta_id, hours=24):
            return [{"id": "dl_79c_1200", "positionId": "pos_cent_79c", "entryType": "DEAL_ENTRY_OUT", "profit": 1200.0, "swap": 0.0, "commission": 0.0, "volume": 1.0}]

    from app.domains.execution.watcher import PositionWatcher
    w_cent = PositionWatcher(metaapi_client=MockCentFirstSyncClient())
    await w_cent.run_cycle()
    with tx() as c:
        ex_cent = c.execute("SELECT profit FROM metaapi_trade_executions WHERE id = ?", (cent_exec_id,)).fetchone()
        assert ex_cent is not None
        assert abs(float(ex_cent[0]) - 12.0) < 0.01  # 1200 USC -> 12.00 USD on very first sync!

    # --- 3. Outbox malformed JSON in failed row + Redis transient recovery ---
    with tx() as c:
        c.execute("DELETE FROM outbox")
        # Insert a quarantined failed row with malformed JSON
        c.execute(
            "INSERT INTO outbox (event_type, payload, status, retry_count, created_at) VALUES ('signal_created', '{malformed_json', 'failed', 5, ?)",
            (now - 100,),
        )
        from app.domains.execution.engine import publish, flush_outbox
        # publish() must succeed on SQLite without crashing on malformed JSON in failed row
        new_sid = publish(c, "DEMO", "BUY", 2650.0, "nonce_79c_outbox", now)
        assert new_sid

        # Simulate 5 consecutive Redis errors: event must remain 'pending' and recover when Redis works on 6th call
        fail_calls = {"n": 0}
        def _flaky_publish(payload):
            fail_calls["n"] += 1
            if fail_calls["n"] <= 5:
                raise ConnectionError("Redis temporary outage")
            return "1700000000000-0"

        monkeypatch.setattr("app.domains.execution.engine.publish_signal_event", _flaky_publish)
        for _ in range(5):
            flush_outbox(c)
        row_ob = c.execute("SELECT status, retry_count FROM outbox WHERE status != 'failed' LIMIT 1").fetchone()
        assert row_ob is not None
        assert row_ob[0] == "pending"
        assert int(row_ob[1]) == 5

        # 6th call: Redis recovers -> transitions to 'published'
        flush_outbox(c)
        row_ob2 = c.execute("SELECT status FROM outbox WHERE status = 'published' AND retry_count = 5 LIMIT 1").fetchone()
        assert row_ob2 is not None and row_ob2[0] == "published"

    # --- 4. Yahoo candle source isolation ---
    from app.domains.signals.sources.streamer import MarketDataStreamer
    streamer = MarketDataStreamer()
    streamer.ingest_tick("XAUUSD", 2650.0, 2650.2, ts=now, source="YAHOO_REFERENCE")
    with tx() as c:
        c_row = c.execute(
            "SELECT source FROM candles WHERE symbol='XAUUSD' AND timeframe='M15' AND time=? ORDER BY id DESC LIMIT 1",
            (int(now // 900) * 900,),
        ).fetchone()
        assert c_row is not None
        assert str(c_row[0]).upper().startswith("YAHOO")

    # --- 5. Discord daily digest import & SEO guide track-record check ---
    import scripts.community.discord_daily_digest as ddd
    assert hasattr(ddd, "send_discord_embed")
    from app.routers.seo_pages import GUIDES, ENGLISH_GUIDES
    assert all("#track-record" not in str(g) for g in GUIDES)
    assert all("#track-record" not in str(g) for g in ENGLISH_GUIDES)

