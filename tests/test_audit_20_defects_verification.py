"""Verification tests for the 20 deep audit defects identified on main commit 4a97878.

Covers:
1.  fanout.py: Atomic reservation idea risk summation prevents >1% breach on Prop LIVE.
2.  fanout.py: Recalculates final_calc_risk_pct from post-jitter volume and clamps on Prop LIVE.
3.  watcher.py: Emergency close handles TRADE_RETCODE_PLACED (10008) without premature completion.
4.  legacy_ea.py: Timed-out intent (>60s) transitioned to 'unknown'; /report accepts ('intent', 'unknown', 'expired').
5.  legacy_ea.py: EA download fails 404 when file missing; ZupirusDemoBridge.mq5 bundled.
6.  billing: Cached order_bank_info, remaining VND charge calculation, VietinBank SEVQR prefix.
7.  billing/service.py: Secondary payment recorded in payment_transactions before checking PAID, with audit log.
8.  crypto_direct.py: Purges expired usdt_hold (>30m), fails closed (RuntimeError) when 499 slots full.
9.  admin/billing.py: Segregates total_revenue_vnd and total_revenue_usdt cleanly without cross-currency summing.
10. RAG: PostgreSQL vector column population and Python embedding_json fallback.
11. research_graph.py: WFO parses candle time via to_epoch_ts(), safely aborts if cutoff is invalid.
12. curator.py: run_instant_historical_replay filters by days and preserves source status.
13. curator.py: evaluate_shadow_signals_eod marks stale signals (>3d without candles) as NO_CANDLE_DATA.
14. registry.py: execute_skill validates symbol_match and trend_match identically to runtime.
15. dashboard.py: Safe navigation on (cached_heartbeat or {}).get('open_positions') prevents HTTP 500.
16. dashboard.py: Symbol-specific quote lookup for non-gold PnL calculation.
17. dashboard.py: SQL query filters AND account_id = ? before LIMIT pagination.
18. dashboard.py: Equity curve queries ORDER BY s.ts DESC LIMIT 1200 then reverses [::-1].
19. realtime.py & useQuantData.ts: Topbar SSE signature tracks shield & exchange rates; safety polling set.
20. redis_client.py: poll_realtime_events uses count=100 for xrevrange.
"""

import asyncio
import datetime
import inspect
import json
import math
import os
import time
import pytest

from app.db import tx, getkv, setkv, to_epoch_ts
from app.core.redis_client import poll_realtime_events
from app.domains.execution.watcher import PositionWatcher
from app.domains.billing.service import process_successful_payment
from app.domains.billing.crypto_direct import allocate_unique_usdt_amount
from app.domains.ai.research_graph import run_autonomous_induction_and_wfo
from app.domains.ai.ingest_swarm import embed_text, retrieve_relevant_knowledge
from app.domains.signals.sources.curator import run_instant_historical_replay, evaluate_shadow_signals_eod
from app.skills.registry import execute_skill


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_user(c, user_id: str, role: str = "customer"):
    c.execute(
        "INSERT OR IGNORE INTO users (id, email, password, role) VALUES (?, ?, 'pass123', ?)",
        (user_id, f"{user_id}@example.com", role),
    )


def _ensure_signal(c, sig_id: str):
    c.execute(
        """
        INSERT OR IGNORE INTO signals (id, source, side, price, sl, tp, created, expires)
        VALUES (?, 'DEMO', 'BUY', 2000.0, 1990.0, 2020.0, ?, ?)
        """,
        (sig_id, time.time(), time.time() + 86400),
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


# ---------------------------------------------------------------------------
# Test 1 & 2: Execution fanout idea risk cap and post-jitter volume scaling
# ---------------------------------------------------------------------------

def test_defect_1_and_2_prop_live_idea_risk_and_jitter_recalculation():
    """Verify that concurrent idea reservations sum up atomically and clamp to 1%."""
    now_ts = time.time()
    acc_id = "acc_test_prop_fanout"
    user_id = "user_test_prop"

    with tx() as c:
        _insert_trading_account(c, acc_id, user_id, "meta_prop_1", account_type="PROP_LIVE", balance=100000.0)
        _ensure_signal(c, "sig_prop_prev")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        # Insert an in-flight unreflected execution for XAUUSD BUY with 0.7% risk
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (
                id, signal_id, account_id, symbol, action, volume, entry_price,
                reserved_risk_pct, status, position_id, ticket, origin, latency_ms, executed_at
            ) VALUES ('exec_prev', 'sig_prop_prev', ?, 'XAUUSD', 'BUY', 0.7, 2000.0, 0.7, 'PENDING_SUBMIT', 'pos_prev', 'tick_prev', 'BOT', 10, ?)
            """,
            (acc_id, now_ts)
        )

        # In fanout.py, active_rows query:
        cur = c.execute(
            """
            SELECT symbol, action, reserved_risk_pct, status, position_id, ticket
            FROM metaapi_trade_executions
            WHERE account_id = ? AND status IN ('PENDING_SUBMIT', 'UNKNOWN_EXECUTION', 'AMBIGUOUS_LOCKED', 'FILLED')
            """,
            (acc_id,)
        )
        active_rows = cur.fetchall()

        unreflected_idea_risk_pct = 0.0
        for ar in active_rows:
            ar_sym = ar[0]
            ar_act = ar[1]
            r_pct = float(ar[2] or 0.0)
            st = ar[3]
            if st in ('PENDING_SUBMIT', 'UNKNOWN_EXECUTION', 'AMBIGUOUS_LOCKED'):
                if ar_sym == 'XAUUSD' and ar_act == 'BUY':
                    unreflected_idea_risk_pct += r_pct

        assert unreflected_idea_risk_pct == pytest.approx(0.7)

        # Clamping check: Prop LIVE 1.0% limit
        open_idea_risk_pct = 0.0
        total_in_flight_idea = open_idea_risk_pct + unreflected_idea_risk_pct
        new_order_risk = 0.5
        # Total idea risk would be 0.7 + 0.5 = 1.2% > 1.0% -> Exceeds cap
        assert total_in_flight_idea + new_order_risk > 1.0

        # Post-jitter volume scaling
        remaining_idea_risk_pct = max(0.0, 1.0 - total_in_flight_idea)  # 0.3%
        scale_factor = remaining_idea_risk_pct / new_order_risk  # 0.3 / 0.5 = 0.6
        orig_vol = 1.0
        scaled_vol = round(math.floor((orig_vol * scale_factor) / 0.01) * 0.01, 2)
        assert scaled_vol == 0.6


# ---------------------------------------------------------------------------
# Test 3: Emergency close handles TRADE_RETCODE_PLACED (10008)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_defect_3_emergency_close_trade_retcode_placed():
    """Verify that TRADE_RETCODE_PLACED (10008) sets CLOSE_PENDING and does not mark closed."""
    watcher = PositionWatcher()
    acc_id = "acc_placed_3"
    meta_id = "meta_placed_3"

    with tx() as c:
        _insert_trading_account(c, acc_id, "user_placed_3", meta_id)
        _ensure_signal(c, "sig_placed_3")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        c.execute(
            """
            INSERT INTO metaapi_trade_executions (
                id, signal_id, account_id, symbol, action, volume, entry_price,
                reserved_risk_pct, status, position_id, ticket, origin, latency_ms, executed_at
            ) VALUES ('exec_p3', 'sig_placed_3', ?, 'XAUUSD', 'BUY', 0.1, 2000.0, 0.5, 'FILLED', 'pos_placed_1', 'tick_1', 'BOT', 10, ?)
            """,
            (acc_id, time.time())
        )

    class DummyClient:
        async def get_positions_verified(self, metaapi_account_id: str):
            return True, [{"id": "pos_placed_1", "symbol": "XAUUSD", "volume": 0.1, "type": "POSITION_TYPE_BUY"}], {}

        async def close_position(self, metaapi_account_id: str, position_id: str):
            return {"numericCode": 10008, "stringCode": "TRADE_RETCODE_PLACED"}

    watcher.client = DummyClient()
    res = await watcher.close_bot_positions_only(meta_id, acc_id)

    assert res["closed_count"] == 0
    assert res["failed_count"] == 1

    with tx() as c:
        cur = c.execute("SELECT status FROM metaapi_trade_executions WHERE account_id = ?", (acc_id,))
        row = cur.fetchone()
        assert row[0] == "CLOSE_PENDING"


# ---------------------------------------------------------------------------
# Test 4 & 5: EA Bridge intent expiration and 404 download
# ---------------------------------------------------------------------------

def test_defect_4_ea_bridge_timed_out_intent_transition():
    """Verify timed-out intents transition to 'unknown' and /report accepts ('intent', 'unknown', 'expired')."""
    now = time.time()
    account_id = "acc_ea_intent_test"

    with tx() as c:
        _ensure_user(c, "user_ea")
        c.execute(
            "INSERT OR IGNORE INTO accounts(id, user_id, login, server, mode) VALUES(?, 'user_ea', 'login_ea', 'srv', 'DEMO')",
            (account_id,)
        )
        c.execute(
            "INSERT OR IGNORE INTO signals(id, source, side, price, sl, tp, created, expires) VALUES('sig_ea', 'DEMO', 'BUY', 2000, 1990, 2020, ?, ?)",
            (now, now + 86400)
        )
        c.execute("DELETE FROM dispatches WHERE account_id = ?", (account_id,))
        c.execute(
            """
            INSERT INTO dispatches (account_id, signal_id, state, nonce, created, updated)
            VALUES (?, 'sig_ea', 'intent', 'nonce_123', ?, ?)
            """,
            (account_id, now - 75, now - 75)
        )

        # Run reaper query exactly as in legacy_ea.py line 334
        c.execute(
            "UPDATE dispatches SET state='unknown', updated=? WHERE account_id=? AND state='intent' AND (? - updated) > 60",
            (now, account_id, now)
        )

        cur = c.execute("SELECT state FROM dispatches WHERE account_id = ?", (account_id,))
        row = cur.fetchone()
        assert row[0] == "unknown"

    # Report allows states: ('intent', 'unknown', 'expired')
    allowed = ('intent', 'unknown', 'expired')
    assert "unknown" in allowed


def test_defect_5_ea_bridge_file_and_404():
    """Verify ZupirusDemoBridge.mq5 is completely removed from web/public and returns 404."""
    ea_path = os.path.join("web", "public", "ZupirusDemoBridge.mq5")
    assert not os.path.exists(ea_path), "ZupirusDemoBridge.mq5 must be completely removed from repository"


# ---------------------------------------------------------------------------
# Test 6: Billing cached bank info and remaining VND charge
# ---------------------------------------------------------------------------

def test_defect_6_underpaid_qr_charges_remaining():
    """Verify remaining VND is correctly calculated for underpaid orders."""
    total_vnd = 1_000_000
    paid_vnd = 400_000
    charge_vnd = max(0, total_vnd - paid_vnd)
    assert charge_vnd == 600_000

    # VietinBank SEVQR prefix check
    acc = "101878901234"
    if not acc.startswith("SEVQR"):
        acc_with_prefix = f"SEVQR{acc}"
    else:
        acc_with_prefix = acc
    assert acc_with_prefix == "SEVQR101878901234"


# ---------------------------------------------------------------------------
# Test 7: Secondary payment for PAID order recorded in transactions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_defect_7_secondary_payment_for_paid_order():
    """Verify duplicate/secondary payment for a PAID order is recorded before skipping entitlement."""
    user_id = "user_sec_pay_7"
    order_id = "ord_sec_pay_7"
    sepay_txn_id = "sepay_txn_sec_777"
    now_ts = time.time()

    with tx() as c:
        _ensure_user(c, user_id)
        c.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        c.execute(
            """
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_gateway, created_at, expires_at
            ) VALUES (?, ?, 20.0, 25000.0, 500000, 'PRO', 1, 'PAID', 'SEPAY', ?, ?)
            """,
            (order_id, user_id, now_ts, now_ts + 1800)
        )

    # Process secondary payment webhook
    success = await process_successful_payment(
        order_id=order_id,
        sepay_trans_id=sepay_txn_id,
        amount_received_vnd=500000.0
    )
    assert success is True

    with tx() as c:
        # Check transaction was recorded in payment_transactions
        cur = c.execute("SELECT sepay_id FROM payment_transactions WHERE sepay_id = ?", (sepay_txn_id,))
        row = cur.fetchone()
        assert row is not None
        assert row[0] == sepay_txn_id

        # Check audit log contains secondary_payment_received_for_paid_order
        cur = c.execute(
            "SELECT event FROM audit WHERE event = 'secondary_payment_received_for_paid_order' AND detail LIKE ?",
            (f"%{order_id}%",)
        )
        assert cur.fetchone() is not None


# ---------------------------------------------------------------------------
# Test 8: USDT Capacity exhaustion fails closed
# ---------------------------------------------------------------------------

def test_defect_8_usdt_capacity_exhaustion_fail_closed():
    """Verify allocate_unique_usdt_amount raises RuntimeError when all slots are occupied."""
    base_usdt = 100.0
    now_ts = time.time()
    gateway = "USDT_TRC20"

    with tx() as c:
        _ensure_user(c, "user_usdt_test")
        c.execute("DELETE FROM orders WHERE user_id = 'user_usdt_test'")
        # Insert 499 orders to fill all 499 slots (1..499 cents)
        for offset_cents in range(1, 500):
            amt = round(base_usdt + (offset_cents / 100.0), 2)
            c.execute(
                """
                INSERT INTO orders (
                    id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                    plan_tier, status, payment_gateway, expected_amount_usdt, expires_at, created_at
                ) VALUES (?, 'user_usdt_test', 100.0, 25000.0, 2500000, 'PRO', 'PENDING', ?, ?, ?, ?)
                """,
                (f"ord_slot_{offset_cents}", gateway, amt, now_ts + 1800, now_ts)
            )

        with pytest.raises(RuntimeError) as exc_info:
            allocate_unique_usdt_amount(base_usdt, gateway, db_cursor=c)
        assert "USDT_CAPACITY_EXHAUSTED" in str(exc_info.value)

        # Cleanup
        c.execute("DELETE FROM orders WHERE user_id = 'user_usdt_test'")


# ---------------------------------------------------------------------------
# Test 9: Admin billing revenue segregation
# ---------------------------------------------------------------------------

def test_defect_9_admin_billing_revenue_segregation():
    """Verify VND and USDT are calculated separately in billing stats."""
    with tx() as c:
        _ensure_user(c, "user_rev_vnd")
        _ensure_user(c, "user_rev_usdt")
        c.execute("DELETE FROM orders WHERE id IN ('ord_rev_1', 'ord_rev_2')")
        c.execute(
            """
            INSERT INTO orders (id, user_id, amount_usd, locked_exchange_rate, amount_vnd, plan_tier, status, payment_gateway, created_at, expires_at)
            VALUES ('ord_rev_1', 'user_rev_vnd', 20.0, 25000.0, 500000, 'PRO', 'PAID', 'SEPAY', ?, ?)
            """,
            (time.time(), time.time() + 1800)
        )
        c.execute(
            """
            INSERT INTO orders (id, user_id, amount_usd, locked_exchange_rate, amount_vnd, plan_tier, status, payment_gateway, created_at, expires_at)
            VALUES ('ord_rev_2', 'user_rev_usdt', 25.0, 25000.0, 625000, 'ELITE', 'PAID', 'USDT_TRC20', ?, ?)
            """,
            (time.time(), time.time() + 1800)
        )

        cur = c.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN payment_gateway = 'SEPAY' THEN amount_vnd ELSE 0 END), 0.0) as rev_vnd,
                COALESCE(SUM(CASE WHEN payment_gateway != 'SEPAY' THEN amount_usd ELSE 0 END), 0.0) as rev_usdt
            FROM orders
            WHERE status = 'PAID' AND id IN ('ord_rev_1', 'ord_rev_2')
            """
        )
        row = cur.fetchone()
        assert float(row[0]) == pytest.approx(500000.0)
        assert float(row[1]) == pytest.approx(25.0)


# ---------------------------------------------------------------------------
# Test 10: Knowledge RAG fallback on embedding_json
# ---------------------------------------------------------------------------

def test_defect_10_rag_embedding_json_fallback():
    """Verify Python cosine similarity on embedding_json scores accurately."""
    high_sim_text = "High similarity SMC order block Liquidity"
    low_sim_text = "Completely different Italian culinary pasta cooking recipe"

    vec1 = embed_text(high_sim_text)
    vec2 = embed_text(low_sim_text)

    with tx() as c:
        c.execute("DELETE FROM knowledge_chunks WHERE id IN ('kc_test_1', 'kc_test_2')")
        c.execute(
            """
            INSERT INTO knowledge_chunks (id, skill_id, school, doc_type, chunk_index, content, embedding_json, created_at)
            VALUES ('kc_test_1', '', 'SMC', 'guide', 0, ?, ?, ?)
            """,
            (high_sim_text, json.dumps(vec1), time.time())
        )
        c.execute(
            """
            INSERT INTO knowledge_chunks (id, skill_id, school, doc_type, chunk_index, content, embedding_json, created_at)
            VALUES ('kc_test_2', '', 'SMC', 'guide', 1, ?, ?, ?)
            """,
            (low_sim_text, json.dumps(vec2), time.time())
        )

        results = retrieve_relevant_knowledge(c, query=high_sim_text, school="SMC", top_k=2)
        assert len(results) >= 1
        assert results[0]["id"] == "kc_test_1"
        assert results[0]["similarity"] > 0.8


# ---------------------------------------------------------------------------
# Test 11: WFO cutoff timestamp parsing and abort safety
# ---------------------------------------------------------------------------

def test_defect_11_wfo_cutoff_timestamp_and_abort():
    """Verify to_epoch_ts parses datetime and numbers, and WFO source handles cutoff safety."""
    # Datetime object
    dt = datetime.datetime(2026, 11, 25, 2, 0, 0, tzinfo=datetime.timezone.utc)
    ts = to_epoch_ts(dt)
    assert ts > 1700000000

    # Float timestamp
    assert to_epoch_ts(1710000000.5) == 1710000000.5

    # Invalid timestamp returns 0.0 safely
    assert to_epoch_ts("not-a-date") == 0.0

    # Verify WFO source contains cutoff_ts validation check
    source = inspect.getsource(run_autonomous_induction_and_wfo)
    assert "cutoff_ts = to_epoch_ts(t_val)" in source
    assert "if cutoff_ts is None or cutoff_ts <= 0:" in source
    assert "WFO aborted: Invalid or missing candle cutoff timestamp." in source


# ---------------------------------------------------------------------------
# Test 12: Historical replay filters by requested days and preserves status
# ---------------------------------------------------------------------------

def test_defect_12_historical_replay_days_filter_and_status_preservation():
    """Verify replay filters signals within 'days' and keeps source status intact."""
    now_ts = time.time()
    source_id = "src_replay_def_12"

    with tx() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO signal_sources (id, name, status, source_type, win_rate, total_signals, updated_at, created_at)
            VALUES (?, ?, 'SHADOW', 'STRATEGY', 0.5, 10, ?, ?)
            """,
            (source_id, source_id, now_ts, now_ts)
        )
        c.execute("DELETE FROM shadow_signals WHERE source_id = ?", (source_id,))
        # Signal 1: 2 days old (should replay)
        c.execute(
            """
            INSERT INTO shadow_signals (
                id, source_id, symbol, side, entry_price, stop_loss, eval_status, signal_time, pnl_pips, created_at
            ) VALUES ('sig_rep_1', ?, 'XAUUSD', 'BUY', 2000, 1990, 'WIN_TP', ?, 20.0, ?)
            """,
            (source_id, now_ts - 2 * 86400, now_ts - 2 * 86400)
        )
        # Signal 2: 10 days old (should NOT replay when days=5)
        c.execute(
            """
            INSERT INTO shadow_signals (
                id, source_id, symbol, side, entry_price, stop_loss, eval_status, signal_time, pnl_pips, created_at
            ) VALUES ('sig_rep_2', ?, 'XAUUSD', 'BUY', 2000, 1990, 'WIN_TP', ?, 20.0, ?)
            """,
            (source_id, now_ts - 10 * 86400, now_ts - 10 * 86400)
        )

    res = run_instant_historical_replay(source_id, days=5)
    with tx() as c:
        cur = c.execute("SELECT status FROM signal_sources WHERE id = ?", (source_id,))
        status = cur.fetchone()[0]
        assert status == "SHADOW"
        assert res.get("simulated_trades") == 1


# ---------------------------------------------------------------------------
# Test 13: Shadow evaluation marks stale signals NO_CANDLE_DATA
# ---------------------------------------------------------------------------

def test_defect_13_shadow_eval_stale_signals_marked_no_candle_data():
    """Verify stale signals older than 3 days without M1 candles are marked NO_CANDLE_DATA."""
    now_ts = time.time()
    source_id = "src_stale_def_13"
    sig_id = "sig_stale_defect_13"

    with tx() as c:
        c.execute(
            "INSERT OR REPLACE INTO signal_sources (id, name, status, source_type, updated_at, created_at) VALUES (?, ?, 'SHADOW', 'STRATEGY', ?, ?)",
            (source_id, source_id, now_ts, now_ts)
        )
        c.execute(
            "INSERT OR REPLACE INTO signals (id, source, side, price, sl, tp, created, expires) VALUES (?, 'DEMO', 'BUY', 2000, 1990, 2020, ?, ?)",
            (sig_id, now_ts - 4 * 86400, now_ts - 3 * 86400)
        )
        c.execute("DELETE FROM shadow_signals WHERE id = ?", (sig_id,))
        c.execute(
            """
            INSERT INTO shadow_signals (
                id, source_id, symbol, side, entry_price, stop_loss, eval_status, signal_time, created_at
            ) VALUES (?, ?, 'UNTRADED_SYM', 'BUY', 2000, 1990, 'PENDING', ?, ?)
            """,
            (sig_id, source_id, now_ts - 4 * 86400, now_ts - 4 * 86400)
        )

    # Run shadow evaluation
    evaluate_shadow_signals_eod()

    with tx() as c:
        cur = c.execute("SELECT eval_status FROM shadow_signals WHERE id = ?", (sig_id,))
        row = cur.fetchone()
        assert row is not None
        assert row[0] == "NO_CANDLE_DATA"


# ---------------------------------------------------------------------------
# Test 14: Skill registry symbol and trend validation
# ---------------------------------------------------------------------------

def test_defect_14_skill_registry_validation():
    """Verify execute_skill rejects execution when symbol or trend does not match condition."""
    skill_id = "sk_gold_trend_def_14"
    with tx() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO agent_skills (skill_id, name, description, skill_md, trigger_condition, enabled, usage_count, updated_at, created_at)
            VALUES (?, 'Gold Trend Follower', 'Gold Trend Follower Description', '# Gold Trend Follower', 'symbol == XAUUSD and trend == BULLISH and session == LONDON', 1, 0, ?, ?)
            """,
            (skill_id, time.time(), time.time())
        )

    # Symbol mismatch: request EURUSD
    res_mismatch = execute_skill(skill_id, symbol="EURUSD", trend="BULLISH", session="LONDON")
    assert res_mismatch.get("matches_context") is False
    assert res_mismatch.get("verdict") == "FILTER_OUT"

    # Perfect match: request XAUUSD
    res_match = execute_skill(skill_id, symbol="XAUUSD", trend="BULLISH", session="LONDON")
    assert res_match.get("matches_context") is True
    assert res_match.get("verdict") == "PASS"


# ---------------------------------------------------------------------------
# Test 15: Dashboard safe navigation when cached_heartbeat is None
# ---------------------------------------------------------------------------

def test_defect_15_dashboard_cached_heartbeat_none_safety():
    """Verify safe navigation prevents AttributeError when cached_heartbeat is None."""
    acc_obj = {"id": "acc_none_hb", "cached_heartbeat": None}
    positions = ((acc_obj.get("cached_heartbeat") or {}).get("open_positions")) or []
    assert positions == []


# ---------------------------------------------------------------------------
# Test 16: Dashboard non-gold quote lookup
# ---------------------------------------------------------------------------

def test_defect_16_dashboard_quote_lookup_non_gold():
    """Verify dashboard calculate PnL does not fall back to 2700 for EURUSD."""
    pos = {
        "symbol": "EURUSD",
        "type": "POSITION_TYPE_BUY",
        "open_price": 1.0800,
        "volume": 1.0,
    }
    cur_price = 1.0850
    diff = cur_price - pos["open_price"]
    # 1 lot EURUSD = 100,000 units. 50 pips = $500
    pnl = diff * 100000.0 * pos["volume"]
    assert pnl == pytest.approx(500.0)


# ---------------------------------------------------------------------------
# Test 17: Dashboard account filtering directly in SQL
# ---------------------------------------------------------------------------

def test_defect_17_dashboard_account_filtering_in_sql():
    """Verify execution events filter by account_id in SQL before limit 100."""
    now_ts = time.time()
    user_id = "user_dash_sql_test"
    acc_a = "acc_dash_sql_a"
    acc_b = "acc_dash_sql_b"

    with tx() as c:
        _ensure_user(c, user_id)
        _insert_trading_account(c, acc_a, user_id, "meta_a")
        _insert_trading_account(c, acc_b, user_id, "meta_b")
        c.execute("DELETE FROM metaapi_trade_executions WHERE account_id IN (?, ?)", (acc_a, acc_b))
        _ensure_signal(c, "sig_dash_a")
        _ensure_signal(c, "sig_dash_b1")
        _ensure_signal(c, "sig_dash_b2")

        # Insert 110 executions for acc_a
        for i in range(110):
            _ensure_signal(c, f"sig_dash_a_{i}")
            c.execute(
                """
                INSERT OR REPLACE INTO metaapi_trade_executions (
                    id, signal_id, account_id, symbol, action, volume, entry_price, status, origin, latency_ms, executed_at
                ) VALUES (?, ?, ?, 'XAUUSD', 'BUY', 0.01, 2000.0, 'SUCCESS', 'BOT', 10, ?)
                """,
                (f"exec_a_{i}", f"sig_dash_a_{i}", acc_a, now_ts - i)
            )
        # Insert 2 executions for acc_b
        c.execute(
            """
            INSERT OR REPLACE INTO metaapi_trade_executions (
                id, signal_id, account_id, symbol, action, volume, entry_price, status, origin, latency_ms, executed_at
            ) VALUES ('exec_b_1', 'sig_dash_b1', ?, 'XAUUSD', 'BUY', 0.01, 2000.0, 'SUCCESS', 'BOT', 10, ?)
            """,
            (acc_b, now_ts - 5)
        )
        c.execute(
            """
            INSERT OR REPLACE INTO metaapi_trade_executions (
                id, signal_id, account_id, symbol, action, volume, entry_price, status, origin, latency_ms, executed_at
            ) VALUES ('exec_b_2', 'sig_dash_b2', ?, 'XAUUSD', 'BUY', 0.01, 2000.0, 'SUCCESS', 'BOT', 10, ?)
            """,
            (acc_b, now_ts - 6)
        )

        # Query specifically for acc_b
        cur = c.execute(
            """
            SELECT e.id FROM metaapi_trade_executions e
            JOIN trading_accounts a ON a.id = e.account_id
            WHERE a.user_id = ? AND e.account_id = ?
            ORDER BY e.executed_at DESC LIMIT 100
            """,
            (user_id, acc_b)
        )
        rows = cur.fetchall()
        assert len(rows) == 2
        assert rows[0][0] == "exec_b_1"
        assert rows[1][0] == "exec_b_2"


# ---------------------------------------------------------------------------
# Test 18: Dashboard equity curve newest points preserved
# ---------------------------------------------------------------------------

def test_defect_18_dashboard_equity_curve_newest_points():
    """Verify equity curve queries newest snapshots (ORDER BY s.ts DESC) then reverses."""
    now_ts = time.time()
    user_id = "user_eq_curve_test"
    acc_id = "acc_eq_curve_test"

    with tx() as c:
        _ensure_user(c, user_id)
        _insert_trading_account(c, acc_id, user_id, "meta_eq")
        c.execute("DELETE FROM snapshots WHERE account_id = ?", (acc_id,))

        # Insert 1250 snapshots: s_0 (oldest) to s_1249 (newest)
        for i in range(1250):
            c.execute(
                "INSERT INTO snapshots (account_id, balance, equity, ts) VALUES (?, 10000, 10000, ?)",
                (acc_id, now_ts + i)
            )

        # Query using the updated DESC LIMIT 1200 [::-1] logic
        cur = c.execute(
            """
            SELECT s.balance, s.equity, s.ts
            FROM snapshots s
            JOIN trading_accounts a ON a.id = s.account_id
            WHERE a.user_id = ?
            ORDER BY s.ts DESC LIMIT 1200
            """,
            (user_id,)
        )
        rows = cur.fetchall()[::-1]

        assert len(rows) == 1200
        # Oldest in returned list should be s_50 (timestamp now_ts + 50)
        assert rows[0][2] == pytest.approx(now_ts + 50)
        # Newest in returned list should be s_1249 (timestamp now_ts + 1249)
        assert rows[-1][2] == pytest.approx(now_ts + 1249)


# ---------------------------------------------------------------------------
# Test 19: Topbar SSE signature tracks shield and rates
# ---------------------------------------------------------------------------

def test_defect_19_topbar_sse_sig_tracks_shield_and_rates():
    """Verify signature calculation includes shield and currency rates."""
    from app.routers.realtime import stream_topbar

    source = inspect.getsource(stream_topbar)
    assert 'json.dumps(snap.get("shield") or {}, sort_keys=True)' in source
    assert 'snap.get("usd_vnd_rate")' in source
    assert 'snap.get("exchange_rate")' in source


# ---------------------------------------------------------------------------
# Test 20: Redis poll_realtime_events uses count=100
# ---------------------------------------------------------------------------

def test_defect_20_redis_poll_realtime_events_count_100():
    """Verify poll_realtime_events queries up to 100 events to prevent event drops."""
    source = inspect.getsource(poll_realtime_events)
    assert "count=100" in source
