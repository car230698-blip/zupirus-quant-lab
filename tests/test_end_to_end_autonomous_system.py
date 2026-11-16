"""Comprehensive End-to-End Integration Test for 100% Autonomous ZUPIRUS Quant Lab:
Axis 1 (Zero-Touch Customer Lifecycle):
  Register (with OTP verification) -> Login -> SePay Checkout -> SePay Webhook ->
  Auto Subscription + Email Receipt -> Link MT5 (Auto-type, Default BE/Prop, Auto-Deploy w/ Retry) ->
  4-Layer Guard + Fan-Out -> PositionWatcher BE 1R & 50% TP1 ->
  Subscription Lifecycle Worker (3d/1d Reminders, Expiry auto_trade=0 + EXPIRED_PROTECTING while open ->
  Undeploy when closed) -> Renewal auto-redeploy & auto_trade=1.

Axis 2 (3-Stage Autonomous AI Evolution):
  Live M1/M15 Candles + Calendar Sync -> EOD M1 Grader -> Hindsight ->
  Research Graph WFO Strategy Candidate -> Auto-Promote -> ZUPIRUS_AGENT M15 Swarm Dispatch.
"""
import json
import secrets
import time
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import tx
from app.calendar_sync import sync_economic_calendar
from app.services.sources.streamer import MarketDataStreamer
from app.services.sources.curator import create_source, record_shadow_signal, evaluate_shadow_signals_eod
from app.services.signal_ingestion.normalizer import normalize_tradingview_signal
from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal
from app.schemas.signals import TradingViewWebhookPayload
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
from app.services.execution.watcher import PositionWatcher
from app.services.billing_service import create_checkout_order, process_successful_payment
from app.services.subscription_lifecycle import run_subscription_lifecycle_cycle
from app.research import run_autonomous_induction_and_wfo
from app.engine import autonomous_agent_step_async


@pytest.mark.asyncio
async def test_end_to_end_autonomous_customer_and_ai_lifecycle(monkeypatch):
    now_ts = time.time()
    client = TestClient(app)
    email = f"zero_touch_{secrets.token_hex(4)}@example.com"
    password = "StrongQuantPass!2026"
    otp_code = "482910"

    # -------------------------------------------------------------------------
    # AXIS 1.1: Register with OTP (independent wrong-attempt counter) & Login
    # -------------------------------------------------------------------------
    with tx() as c:
        c.execute(
            "INSERT INTO otp_codes (email, code, expires_at, attempts) VALUES (?, ?, ?, 0) "
            "ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0",
            (email, otp_code, now_ts + 600),
        )

    # Wrong OTP increments attempts without rollback
    r_bad = client.post("/api/register", json={"email": email, "password": password, "otp_code": "000000"})
    assert r_bad.status_code == 400
    with tx() as c:
        att = c.execute("SELECT attempts FROM otp_codes WHERE email = ?", (email,)).fetchone()[0]
        assert att == 1

    # Valid OTP completes registration
    r_reg = client.post("/api/register", json={"email": email, "password": password, "otp_code": otp_code})
    assert r_reg.status_code == 200 and r_reg.json()["ok"] is True

    r_login = client.post("/api/login", json={"email": email, "password": password})
    assert r_login.status_code == 200
    with tx() as c:
        uid = c.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()[0]

    # -------------------------------------------------------------------------
    # AXIS 1.2: SePay Checkout -> Webhook Fulfillment + Payment Receipt Email
    # -------------------------------------------------------------------------
    order = create_checkout_order(user_id=uid, plan_tier="alpha", cloud_slots=2)
    assert order["status"] == "PENDING"

    with patch("app.mailer.send_payment_receipt_email", return_value={"ok": True}) as mock_receipt:
        ok_paid = await process_successful_payment(
            order_id=order["id"],
            sepay_trans_id=f"sp_e2e_{secrets.token_hex(4)}",
            amount_received_vnd=order["amount_vnd"],
            raw_payload={"gateway": "VietinBank", "transferAmount": order["amount_vnd"]},
        )
        assert ok_paid is True
        assert mock_receipt.called

    with tx() as c:
        sub_row = dict(c.execute("SELECT * FROM subscriptions WHERE user_id = ?", (uid,)).fetchone())
        assert sub_row["plan_tier"] == "alpha"
        assert sub_row["allow_partial_tp_be"] == 1
        assert sub_row["allow_prop_firm_mode"] == 1
        assert float(sub_row["service_expires_at"]) > now_ts + 25 * 86400

    # -------------------------------------------------------------------------
    # AXIS 1.3: Zero-Touch MT5 Linking (Auto Type, Default BE/Prop, Auto-Deploy w/ Retry)
    # -------------------------------------------------------------------------
    deploy_calls = {"count": 0}

    async def fake_deploy_with_transient_error(self, meta_id):
        deploy_calls["count"] += 1
        if deploy_calls["count"] == 1:
            raise RuntimeError("Transient MetaApi 503 timeout")
        return True

    monkeypatch.setattr(MetaApiClient, "provision_account", AsyncMock(return_value={"id": f"meta_{secrets.token_hex(4)}", "state": "DEPLOY_PENDING"}))
    monkeypatch.setattr(MetaApiClient, "deploy_account", fake_deploy_with_transient_error)
    monkeypatch.setattr(MetaApiClient, "get_account_information", AsyncMock(return_value={"balance": 100000.0, "equity": 100000.0, "currency": "USD"}))

    r_link = client.post(
        "/api/v1/accounts",
        json={
            "account_name": "FTMO $100k Challenge",
            "login": f"77{secrets.randbelow(900000) + 100000}",
            "password": "Mt5PassWord!99",
            "server": "FTMO-Server3",
            "platform": "mt5",
            "disclaimer_accepted": True,
            "is_prop_firm_mode": False,  # Even if omitted, Alpha + PROP server auto-enables!
        },
        headers={"X-Zupirus": "1"},
    )
    assert r_link.status_code == 200, r_link.text
    acc_id = r_link.json()["id"]
    assert deploy_calls["count"] == 2  # Retried transient error once, succeeded on 2nd attempt!

    with tx() as c:
        acc_db = dict(c.execute("SELECT * FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone())
        assert acc_db["account_type"] in ("PROP", "PROP_FIRM")
        assert acc_db["auto_be_partial_tp"] == 1
        assert acc_db["is_prop_firm_mode"] == 1
        assert acc_db["deployment_state"] == "DEPLOYED"
        assert acc_db["auto_trade"] == 1

    # -------------------------------------------------------------------------
    # AXIS 1.4 & 2.1: Live Market Quotes/Candles + Stage 1 Fan-Out + Watcher BE/TP1
    # -------------------------------------------------------------------------
    streamer = MarketDataStreamer()
    base_price = 2900.00
    with tx() as c:
        for i in range(200):
            bar_t = int(now_ts) - (200 - i) * 900
            px = round(base_price + (i * 0.25), 2)
            c.execute("DELETE FROM candles WHERE symbol='XAUUSD' AND timeframe='M15' AND time=?", (bar_t,))
            c.execute(
                "INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES ('XAUUSD', 'M15', ?, ?, ?, ?, ?, 10)",
                (bar_t, px - 0.5, px + 1.0, px - 1.0, px),
            )
        sync_economic_calendar(c)
        c.execute("DELETE FROM news WHERE ts >= ? AND ts <= ?", (now_ts - 1000, now_ts + 1000))

    latest_mid = 2950.00
    streamer.ingest_tick("XAUUSD", bid=latest_mid - 0.14, ask=latest_mid + 0.14, ts=now_ts, source="MARKET_LIVE")

    create_source(name="E2E Trusted Source", source_type="WEBHOOK", status="ACTIVE_LIVE", source_id="src_e2e_trusted")
    tv_payload = TradingViewWebhookPayload(
        symbol="XAUUSD",
        action="BUY",
        price=latest_mid,
        sl=latest_mid - 5.0,
        tp=latest_mid + 10.0,
        source="src_e2e_trusted",
    )
    norm = normalize_tradingview_signal(tv_payload)
    ok_sig, reason, sanitized = sanitize_and_audit_signal(norm, live_price=latest_mid, current_time=now_ts)
    assert ok_sig, f"Signal unexpectedly blocked: {reason}"

    meta_client = MetaApiClient()
    meta_client.place_order = AsyncMock(return_value={"numericCode": 10009, "orderId": f"ord_{secrets.token_hex(4)}"})
    fanout_rep = await execute_fan_out_for_signal(
        signal={
            "id": sanitized.id,
            "symbol": sanitized.symbol,
            "action": sanitized.action,
            "entry_price": sanitized.entry_price,
            "sl": sanitized.stop_loss,
            "tp": sanitized.take_profit,
        },
        accounts=[acc_db],
        metaapi_client=meta_client,
    )
    assert fanout_rep["executed"] >= 1

    # PositionWatcher protects position (BE 1R + 50% TP1)
    watcher = PositionWatcher()
    watcher.client.get_account_information = AsyncMock(return_value={"balance": 100000.0, "equity": 101500.0})
    watcher.client.get_open_positions = AsyncMock(
        return_value=[{
            "id": f"pos_e2e_{secrets.token_hex(4)}",
            "symbol": "XAUUSD",
            "type": "POSITION_TYPE_BUY",
            "volume": 0.20,
            "openPrice": latest_mid,
            "currentPrice": latest_mid + 6.0,
            "stopLoss": latest_mid - 5.0,
            "comment": "ZP-E2E",
        }]
    )
    watcher.client.modify_position_sl = AsyncMock(return_value={"numericCode": 10009})
    watcher.client.close_partial_position = AsyncMock(return_value={"numericCode": 10009})
    w_res = await watcher.run_cycle()
    assert w_res["be_sl_moved"] >= 1
    assert w_res["partial_tp_executed"] >= 1

    # -------------------------------------------------------------------------
    # AXIS 1.5: Subscription Lifecycle Worker (Reminders -> Expiry Protection -> Undeploy -> Renewal)
    # -------------------------------------------------------------------------
    with patch("app.services.subscription_lifecycle.send_subscription_expiry_reminder", return_value={"ok": True}) as mock_rem:
        # 2 days left -> 3-day reminder
        r3 = await run_subscription_lifecycle_cycle(now_ts=float(sub_row["service_expires_at"]) - 2 * 86400)
        assert r3["reminded_3d"] >= 1
        # 12 hours left -> 1-day reminder
        r1 = await run_subscription_lifecycle_cycle(now_ts=float(sub_row["service_expires_at"]) - 43200)
        assert r1["reminded_1d"] >= 1
        assert mock_rem.call_count >= 2

    # Expired while 1 open position exists -> auto_trade=0, EXPIRED_PROTECTING (NOT undeployed!)
    lifecycle_client = MetaApiClient()
    lifecycle_client.get_open_positions = AsyncMock(return_value=[{"id": "pos_still_open", "symbol": "XAUUSD"}])
    lifecycle_client.undeploy_account = AsyncMock(return_value=True)
    rexp_open = await run_subscription_lifecycle_cycle(
        now_ts=float(sub_row["service_expires_at"]) + 60,
        client=lifecycle_client,
    )
    assert rexp_open["protecting_open"] >= 1
    assert lifecycle_client.undeploy_account.call_count == 0
    with tx() as c:
        st_open = dict(c.execute("SELECT auto_trade, deployment_state FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone())
        assert st_open["auto_trade"] == 0
        assert st_open["deployment_state"] == "EXPIRED_PROTECTING"

    # Once open positions are closed -> undeploy_account() runs & state becomes UNDEPLOYED
    lifecycle_client.get_open_positions = AsyncMock(return_value=[])
    rexp_closed = await run_subscription_lifecycle_cycle(
        now_ts=float(sub_row["service_expires_at"]) + 120,
        client=lifecycle_client,
    )
    assert rexp_closed["undeployed_idle"] >= 1
    assert lifecycle_client.undeploy_account.call_count >= 1
    with tx() as c:
        st_closed = dict(c.execute("SELECT deployment_state FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone())
        assert st_closed["deployment_state"] == "UNDEPLOYED"

    # Renewal payment -> auto re-deploys & re-enables auto_trade=1
    renew_order = create_checkout_order(user_id=uid, plan_tier="alpha", cloud_slots=2)
    with patch("app.mailer.send_payment_receipt_email", return_value={"ok": True}):
        await process_successful_payment(
            order_id=renew_order["id"],
            sepay_trans_id=f"sp_ren_{secrets.token_hex(4)}",
            amount_received_vnd=renew_order["amount_vnd"],
        )
    with tx() as c:
        st_renewed = dict(c.execute("SELECT auto_trade, deployment_state FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone())
        assert st_renewed["auto_trade"] == 1
        assert st_renewed["deployment_state"] == "DEPLOYED"

    # -------------------------------------------------------------------------
    # AXIS 2.2 & 2.3: Shadow EOD -> Hindsight -> Research Graph WFO -> ZUPIRUS_AGENT M15 Dispatch
    # -------------------------------------------------------------------------
    shadow_sid = f"src_sh_{secrets.token_hex(4)}"
    create_source(name="E2E Shadow AI Seed", source_type="TELEGRAM", status="SHADOW_ONLY", source_id=shadow_sid)
    with tx() as c:
        sig_time = now_ts - 180
        c.execute("DELETE FROM candles WHERE symbol='XAUUSD' AND timeframe='M1' AND time >= ?", (int(sig_time),))
        c.execute(
            "INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES ('XAUUSD', 'M1', ?, ?, ?, ?, ?, 15)",
            (int(sig_time) + 60, latest_mid, latest_mid + 12.0, latest_mid - 1.0, latest_mid + 11.0),
        )
        record_shadow_signal(
            source_id=shadow_sid,
            symbol="XAUUSD",
            side="BUY",
            entry_price=latest_mid,
            stop_loss=latest_mid - 5.0,
            take_profit=latest_mid + 10.0,
            signal_time=sig_time,
            db_cursor=c,
        )
        for i in range(6):
            c.execute(
                """
                INSERT INTO signal_audit_logs (
                    id, signal_id, source_name, strategy_tier, symbol, side,
                    entry_price, stop_loss, status, pnl, context_snapshot, created_at
                ) VALUES (?, ?, 'E2E_SEED_SOURCE', 'STANDARD', 'XAUUSD', 'BUY', ?, ?, 'APPROVED', 150.0, ?, ?)
                """,
                (
                    f"aud_z_{i}_{int(now_ts)}",
                    f"sig_z_{i}_{int(now_ts)}",
                    latest_mid,
                    latest_mid - 5.0,
                    json.dumps({"session": "London", "atr_14": 4.2, "news_distance_mins": 120.0}),
                    now_ts,
                ),
            )

    eod = evaluate_shadow_signals_eod(source_id=shadow_sid)
    assert eod["evaluated"] >= 1
    run_autonomous_induction_and_wfo(force=True)
    with tx() as c:
        cand = c.execute("SELECT id FROM strategy_candidates ORDER BY created_at DESC LIMIT 1").fetchone()
        assert cand is not None
        c.execute("UPDATE strategy_candidates SET status = 'APPROVED_FOR_PROD' WHERE id = ?", (cand["id"],))
        c.execute("INSERT INTO kv (key, value) VALUES ('signal_mode', 'ZUPIRUS_AGENT') ON CONFLICT(key) DO UPDATE SET value = 'ZUPIRUS_AGENT'")
        c.execute("DELETE FROM kv WHERE key = 'agent_last_candle_ts'")

    ag_res = await autonomous_agent_step_async(force_side="BUY")
    assert ag_res["status"] == "DISPATCHED", f"Expected DISPATCHED, got {ag_res}"
    assert ag_res["report"]["executed"] >= 1
