"""End-to-End Integration Test for the 100% Autonomous 3-Stage ZUPIRUS Lifecycle:
1. Live XAU/USD quotes & M1/M15 candles ingestion + automatic USD economic calendar sync.
2. Stage 1 (EXTERNAL_FEED): Active source -> 4-Layer Guard -> Per-account dynamic lot sizing (Standard/Cent/Prop) -> MetaApi Fan-Out -> PositionWatcher BE 1R + Partial TP1.
3. Stage 2 (SHADOW_ONLY -> Hindsight -> Research Graph WFO): EOD M1 grader -> Trust Score -> Hindsight memory -> Strategy Candidate + Auto-Promote option.
4. Stage 3 (ZUPIRUS_AGENT): M15 candle close -> AI Swarm -> 4-Layer Guard -> Direct Fan-Out to customer MT5 accounts.
"""
import json
import secrets
import time
from unittest.mock import AsyncMock
import pytest

from app import db, research
from app.db import tx
from app.calendar_sync import sync_economic_calendar
from app.services.sources.streamer import MarketDataStreamer
from app.services.sources.curator import create_source, record_shadow_signal, evaluate_shadow_signals_eod
from app.services.signal_ingestion.normalizer import normalize_tradingview_signal
from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal
from app.schemas.signals import TradingViewWebhookPayload
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
from app.services.execution.watcher import PositionWatcher
from app.research import run_autonomous_induction_and_wfo
from app.engine import autonomous_agent_step_async


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(db, "DATABASE_URL", "")
    monkeypatch.setattr(db, "_pg_pool", None)
    monkeypatch.setattr(db, "DB", tmp_path / "lab.sqlite3")
    monkeypatch.setattr(db, "DATA", tmp_path)
    monkeypatch.setattr(research, "DATA", tmp_path)
    db.init()


@pytest.mark.asyncio
async def test_full_autonomous_lifecycle_end_to_end():
    now_ts = time.time()

    # -------------------------------------------------------------------------
    # STEP 1: Live Quotes, M1 & M15 Candles Ingestion + Economic Calendar Sync
    # -------------------------------------------------------------------------
    streamer = MarketDataStreamer()
    base_price = 2900.00
    # Ingest 200 M15 candles + recent M1 candles so WFO (180+ bars) & EOD Grader have full real OHLC data
    with tx() as c:
        for i in range(200):
            bar_t = int(now_ts) - (200 - i) * 900
            px = round(base_price + (i * 0.25), 2)
            c.execute("DELETE FROM candles WHERE symbol='XAUUSD' AND timeframe='M15' AND time=?", (bar_t,))
            c.execute(
                "INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES ('XAUUSD', 'M15', ?, ?, ?, ?, ?, 10)",
                (bar_t, px - 0.5, px + 1.0, px - 1.0, px),
            )
        # Ensure news table sync works automatically
        added, existing = sync_economic_calendar(c)
        assert (added + existing) >= 1

    # Streamer ingests live ticks and creates both M1 and M15 candles
    latest_mid = round(base_price + 200 * 0.25, 2)  # 2950.00
    streamer.ingest_tick("XAUUSD", bid=latest_mid - 0.14, ask=latest_mid + 0.14, ts=now_ts, source="MARKET_LIVE")
    with tx() as c:
        m1_cnt = c.execute("SELECT count(*) FROM candles WHERE symbol='XAUUSD' AND timeframe='M1'").fetchone()[0]
        m15_cnt = c.execute("SELECT count(*) FROM candles WHERE symbol='XAUUSD' AND timeframe='M15'").fetchone()[0]
        q_cnt = c.execute("SELECT count(*) FROM quotes WHERE source='MARKET_LIVE'").fetchone()[0]
        assert m1_cnt >= 1
        assert m15_cnt >= 200
        assert q_cnt >= 1

    # -------------------------------------------------------------------------
    # STEP 2: Stage 1 (EXTERNAL_FEED) -> 4-Layer Guard -> Multi-Account Lot Sizing -> Watcher BE/TP1
    # -------------------------------------------------------------------------
    uid = f"usr_e2e_{secrets.token_hex(4)}"
    acc_std_id = f"acc_std_{secrets.token_hex(4)}"
    acc_cent_id = f"acc_cent_{secrets.token_hex(4)}"
    acc_prop_id = f"acc_prop_{secrets.token_hex(4)}"

    with tx() as c:
        c.execute("INSERT INTO users(id, email, password, role) VALUES(?,?,?,?)", (uid, f"{uid}@example.com", "pw", "customer"))
        c.execute(
            """
            INSERT INTO subscriptions(id, user_id, plan_tier, service_expires_at, max_mt5_accounts,
                allow_custom_multiplier, allow_compounding, allow_partial_tp_be, allow_prop_firm_mode, allow_alpha_strategies, created_at, updated_at)
            VALUES(?, ?, 'alpha', ?, 5, 1, 1, 1, 1, 1, ?, ?)
            """,
            (f"sub_{uid}", uid, now_ts + 86400 * 30, now_ts, now_ts),
        )
        # Clear any news within ±15m so Stage 1 signal is not news-blocked during this test
        c.execute("DELETE FROM news WHERE ts >= ? AND ts <= ?", (now_ts - 1000, now_ts + 1000))

        # Standard, Cent, and Prop accounts
        for aid, acc_type, c_size, bal, is_prop in [
            (acc_std_id, "STANDARD", 100.0, 10000.0, 0),
            (acc_cent_id, "CENT", 1.0, 50000.0, 0),
            (acc_prop_id, "PROP", 100.0, 100000.0, 1),
        ]:
            c.execute(
                """
                INSERT INTO trading_accounts(
                    id, user_id, mt5_login, encrypted_master_password, broker_server,
                    metaapi_account_id, deployment_state, auto_trade, balance, equity,
                    account_type, contract_size, auto_be_partial_tp, is_prop_firm_mode,
                    prop_daily_dd_limit_pct, cloud_expires_at, created_at
                ) VALUES(?, ?, ?, 'enc', 'Exness-MT5Real', ?, 'DEPLOYED', 1, ?, ?, ?, ?, 1, ?, 4.5, ?, ?)
                """,
                (aid, uid, str(secrets.randbelow(80000000) + 10000000), f"meta_{aid}", bal, bal, acc_type, c_size, is_prop, now_ts + 86400 * 30, now_ts),
            )

    tv_payload = TradingViewWebhookPayload(
        symbol="XAUUSD",
        action="BUY",
        price=latest_mid,
        sl=round(latest_mid - 5.0, 2),
        tp=round(latest_mid + 10.0, 2),
        strategy="E2E_SEED_SOURCE",
    )
    norm_sig = normalize_tradingview_signal(tv_payload)
    approved, reject_reason, sanitized = sanitize_and_audit_signal(norm_sig, live_price=latest_mid, current_time=now_ts)
    assert approved is True, f"Expected Stage 1 signal approved, got {reject_reason}"

    with tx() as c:
        eligible = [dict(r) for r in c.execute("SELECT * FROM trading_accounts WHERE user_id = ?", (uid,)).fetchall()]

    fanout_rep = await execute_fan_out_for_signal(
        signal={
            "id": sanitized.id,
            "symbol": sanitized.symbol,
            "action": sanitized.action,
            "entry_price": sanitized.entry_price,
            "sl": sanitized.stop_loss,
            "tp": sanitized.take_profit,
        },
        accounts=eligible,
        metaapi_client=MetaApiClient(token=""),
    )
    assert fanout_rep["executed"] == 3

    # Link position to executions so PositionWatcher verifies ownership as BOT
    pos_id = f"pos_e2e_{secrets.token_hex(4)}"
    with tx() as c:
        for ex in fanout_rep.get("executions", []):
            c.execute(
                """
                UPDATE metaapi_trade_executions
                SET position_id = ?, ticket = ?, origin = 'BOT', status = 'FILLED', volume = 0.10
                WHERE id = ?
                """,
                (pos_id, pos_id, ex["exec_id"])
            )

    # Verify PositionWatcher moves SL to Break-Even FIRST and closes 50% TP1 at >= 1R profit
    watcher = PositionWatcher()
    watcher.client.get_account_information = AsyncMock(return_value={"balance": 10000.0, "equity": 10500.0})
    watcher.client.get_open_positions = AsyncMock(
        return_value=[{
            "id": pos_id,
            "symbol": "XAUUSD",
            "type": "POSITION_TYPE_BUY",
            "volume": 0.10,
            "openPrice": latest_mid,
            "currentPrice": latest_mid + 6.0,  # +1.2R >= 1.0R
            "stopLoss": latest_mid - 5.0,
            "comment": "ZP-E2E",
        }]
    )
    watcher.client.modify_position_sl = AsyncMock(return_value={"numericCode": 10009, "stringCode": "TRADE_RETCODE_DONE"})
    watcher.client.close_partial_position = AsyncMock(return_value={"numericCode": 10009, "stringCode": "TRADE_RETCODE_DONE"})

    w_stats = await watcher.run_cycle()
    assert w_stats["be_sl_moved"] >= 1
    assert w_stats["partial_tp_executed"] >= 1

    # -------------------------------------------------------------------------
    # STEP 3: Stage 2 (SHADOW_ONLY -> EOD M1 Grader -> Hindsight -> Research WFO -> Auto-Promote)
    # -------------------------------------------------------------------------
    shadow_src = create_source(name="E2E_Shadow_Alpha", source_type="TRADINGVIEW", status="SHADOW_ONLY")
    shadow_sid = shadow_src["id"]
    sig_time = now_ts - 3600
    with tx() as c:
        # Insert M1 candles after sig_time that hit TP
        for m_i in range(1, 10):
            t_m1 = int(sig_time) + m_i * 60
            c.execute("DELETE FROM candles WHERE symbol='XAUUSD' AND timeframe='M1' AND time=?", (t_m1,))
            c.execute(
                "INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES ('XAUUSD', 'M1', ?, ?, ?, ?, ?, 5)",
                (t_m1, latest_mid, latest_mid + 12.0, latest_mid - 1.0, latest_mid + 10.0),
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
        # Seed 6 closed audit logs so discover_candidate_from_observations & synthesize_inductive_rules activate
        for i in range(6):
            c.execute(
                """
                INSERT INTO signal_audit_logs (
                    id, signal_id, source_name, strategy_tier, symbol, side,
                    entry_price, stop_loss, status, pnl, context_snapshot, created_at
                ) VALUES (?, ?, 'E2E_SEED_SOURCE', 'STANDARD', 'XAUUSD', 'BUY', ?, ?, 'APPROVED', 150.0, ?, ?)
                """,
                (
                    f"aud_e2e_{i}_{int(now_ts)}",
                    f"sig_e2e_{i}_{int(now_ts)}",
                    latest_mid,
                    latest_mid - 5.0,
                    json.dumps({"session": "London", "atr_14": 4.2, "news_distance_mins": 120.0}),
                    now_ts,
                ),
            )

    eod_res = evaluate_shadow_signals_eod(source_id=shadow_sid)
    assert eod_res["evaluated"] >= 1

    run_autonomous_induction_and_wfo(force=True)
    with tx() as c:
        cands = c.execute("SELECT id, status FROM strategy_candidates ORDER BY created_at DESC LIMIT 1").fetchall()
        assert len(cands) >= 1
        # Approve candidate and switch to Stage 3 (ZUPIRUS_AGENT)
        c.execute("UPDATE strategy_candidates SET status = 'APPROVED_FOR_PROD' WHERE id = ?", (cands[0]["id"],))
        c.execute("INSERT INTO kv (key, value) VALUES ('signal_mode', 'ZUPIRUS_AGENT') ON CONFLICT(key) DO UPDATE SET value = 'ZUPIRUS_AGENT'")
        c.execute("DELETE FROM kv WHERE key = 'agent_last_candle_ts'")

    # -------------------------------------------------------------------------
    # STEP 4: Stage 3 (ZUPIRUS_AGENT) -> M15 Close -> AI Swarm -> Sanitizer -> Customer Fan-Out
    # -------------------------------------------------------------------------
    ag_res = await autonomous_agent_step_async(force_side="SELL")
    assert ag_res["status"] == "DISPATCHED", f"Expected DISPATCHED in Stage 3, got {ag_res}"
    assert ag_res["report"]["executed"] >= 3
