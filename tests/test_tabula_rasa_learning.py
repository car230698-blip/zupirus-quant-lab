"""Unit & integration tests for Tabula Rasa Agent Learning & Inductive Strategy Discovery."""
import time
import json
import pytest
from app.db import init, tx
from app.schemas.signals import NormalizedSignalSchema
from app.services.signal_ingestion.sanitizer import (
    sanitize_and_audit_signal,
    check_redis_deduplication,
    check_mandatory_sl,
    check_news_shield,
    check_entry_slippage,
)
from app.services.signal_ingestion.context import (
    get_trading_session,
    get_market_atr14,
    get_nearest_news_info,
    get_live_spread,
    capture_market_context_snapshot,
)
from app.hindsight import (
    store_memory,
    recall_memories,
    reflect_on_signal_outcome,
    synthesize_inductive_rules,
)
from app.research import (
    discover_candidate_from_observations,
    walk_forward,
    graph,
)


@pytest.fixture(autouse=True)
def setup_db():
    init()


def test_market_context_snapshot_capture():
    """Verify market context snapshots accurately extract session, ATR, news, and spread."""
    now_ts = 1794750000.0  # arbitrary timestamp
    session = get_trading_session(now_ts)
    assert session in ("Asia", "London", "London/New York Overlap", "New York", "Late NY / Pre-Asia")

    with tx() as c:
        # Seed test news
        c.execute(
            "INSERT INTO news (id, title, currency, impact, ts) VALUES ('news_test_1', 'US CPI MoM', 'USD', 'high', ?)",
            (now_ts + 3600,)  # 60m future
        )
        dist, title = get_nearest_news_info(c, now_ts)
        assert abs(dist - 60.0) <= 1.0
        assert title == 'US CPI MoM'

        atr = get_market_atr14(c, "XAUUSD", "M15")
        assert atr > 0.0

        spread = get_live_spread(c, "XAUUSD")
        assert spread > 0.0
        c.execute("DELETE FROM news WHERE id = 'news_test_1'")


def test_four_guards_priority_and_snapshot_logging():
    """Verify 4 mandatory guards enforce priority order and snapshot market state."""
    # Ensure no conflicting news event within ±15m for the normal trade test
    now_ts = time.time()
    with tx() as c:
        c.execute("DELETE FROM news WHERE abs(ts - ?) <= 1800", (now_ts,))
        c.execute("DELETE FROM signal_audit_logs WHERE signal_id IN ('sig_test_tabula_1', 'sig_test_tabula_dup')")

    sig = NormalizedSignalSchema(
        id="sig_test_tabula_1",
        source="TRADINGVIEW",
        symbol="XAUUSD",
        action="BUY",
        entry_price=2680.00,
        stop_loss=None,  # Missing SL to test Guard 2 auto-attach
        take_profit=2700.00,
        strategy_tier="STANDARD",
        created_at=time.time(),
        raw_payload={"alert": "Test Alert"}
    )

    now_ts = time.time()
    approved, reject_reason, sanitized = sanitize_and_audit_signal(
        signal=sig,
        live_price=2680.50,
        current_time=now_ts
    )

    assert approved is True
    assert reject_reason is None
    # Auto attached ATR SL
    assert sanitized.stop_loss is not None
    assert sanitized.stop_loss < 2680.00

    # Verify context_snapshot was logged in signal_audit_logs
    with tx() as c:
        row = c.execute("SELECT context_snapshot, status FROM signal_audit_logs WHERE signal_id = ?", ("sig_test_tabula_1",)).fetchone()
        assert row is not None
        assert row["status"] == "APPROVED"
        assert row["context_snapshot"] is not None
        ctx = json.loads(row["context_snapshot"])
        assert "session" in ctx
        assert "atr_14" in ctx
        assert "spread_pips" in ctx

    # Test Guard 1: Duplicate within 60s rejected immediately
    dup_sig = NormalizedSignalSchema(
        id="sig_test_tabula_dup",
        source="TRADINGVIEW",
        symbol="XAUUSD",
        action="BUY",
        entry_price=2680.00,
        stop_loss=2670.00,
        take_profit=2700.00,
        strategy_tier="STANDARD",
        created_at=time.time()
    )
    dup_approved, dup_reason, _ = sanitize_and_audit_signal(dup_sig, live_price=2680.00, current_time=now_ts)
    assert dup_approved is False
    assert "REJECTED_DUPLICATE_SIGNAL" in dup_reason


def test_guard_3_news_shield_and_guard_4_slippage():
    """Verify News Shield rejects within ±15m and Slippage guard rejects drift > 20 pips."""
    now_ts = time.time()
    try:
        with tx() as c:
            c.execute(
                "INSERT INTO news (id, title, currency, impact, ts) VALUES ('news_test_red', 'Federal Reserve Rate Decision', 'USD', 'high', ?)",
                (now_ts + 300,)  # 5 minutes ahead (within ±15m)
            )

        sig = NormalizedSignalSchema(
            id="sig_test_news_reject",
            source="TRADINGVIEW",
            symbol="XAUUSD",
            action="SELL",
            entry_price=2690.00,
            stop_loss=2700.00,
            take_profit=2670.00,
            strategy_tier="STANDARD",
            created_at=now_ts
        )
        news_ok, news_reason = check_news_shield(now_ts)
        assert news_ok is False
        assert "REJECTED_NEWS_SHIELD" in news_reason
    finally:
        with tx() as c:
            c.execute("DELETE FROM news WHERE id IN ('news_test_red', 'news_test_1')")

    # Test Guard 4: Slippage > 20 pips (>$2.00 on Gold)
    sig_slip = NormalizedSignalSchema(
        id="sig_test_slippage",
        source="TRADINGVIEW",
        symbol="XAUUSD",
        action="BUY",
        entry_price=2650.00,
        stop_loss=2640.00,
        take_profit=2670.00,
        strategy_tier="STANDARD",
        created_at=now_ts
    )
    slip_ok, slip_reason = check_entry_slippage(sig_slip, live_price=2653.00)  # $3.00 drift = 30 pips > 20 pips
    assert slip_ok is False
    assert "REJECTED_SLIPPAGE_EXCEEDED" in slip_reason


def test_post_trade_reflection_and_inductive_rule_synthesis():
    """Verify post-trade reflection records PnL, MAE, MFE and synthesizes high-winrate rules."""
    import uuid
    sig_id = f"sig_learn_{uuid.uuid4().hex[:8]}"
    now_ts = time.time()

    with tx() as c:
        c.execute("DELETE FROM signal_audit_logs")
        c.execute(
            """
            INSERT INTO signal_audit_logs(
                id, signal_id, source_name, strategy_tier, symbol, side,
                entry_price, stop_loss, take_profit, raw_payload,
                status, context_snapshot, created_at, processed_at
            ) VALUES (?, ?, 'TRADINGVIEW', 'STANDARD', 'XAUUSD', 'BUY', 2650.0, 2645.0, 2660.0, '{}', 'APPROVED', '{"session":"London","atr_14":3.5}', ?, ?)
            """,
            (f"log_{sig_id}", sig_id, now_ts, now_ts)
        )

        # Reflect on trade outcome
        mem_id = reflect_on_signal_outcome(
            c,
            signal_id=sig_id,
            pnl=125.0,
            mae=1.5,
            mfe=10.0,
            exit_price=2660.0,
            exit_reason="TP"
        )
        assert mem_id.startswith("mem_")

        # Check DB update
        row = c.execute("SELECT pnl, mae, mfe FROM signal_audit_logs WHERE signal_id = ?", (sig_id,)).fetchone()
        assert row["pnl"] == 125.0
        assert row["mae"] == 1.5
        assert row["mfe"] == 10.0

        # Seed 5 winning London BUY signals to test inductive synthesis
        for _ in range(5):
            seed_id = uuid.uuid4().hex[:8]
            c.execute(
                f"""
                INSERT INTO signal_audit_logs(
                    id, signal_id, source_name, strategy_tier, symbol, side,
                    entry_price, stop_loss, take_profit, raw_payload,
                    status, context_snapshot, pnl, created_at, processed_at
                ) VALUES ('log_seed_{seed_id}', 'sig_seed_{seed_id}', 'TRADINGVIEW', 'STANDARD', 'XAUUSD', 'BUY', 2650.0, 2645.0, 2660.0, '{{}}', 'APPROVED', '{{"session":"London"}}', 50.0, ?, ?)
                """,
                (now_ts, now_ts)
            )

        discovered = synthesize_inductive_rules(c, min_samples=5)
        assert len(discovered) >= 1
        assert any(d["session"] == "London" and d["side"] == "BUY" for d in discovered)
