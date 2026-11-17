"""Comprehensive tests for Hybrid Signal Ingestion Pipeline (4 Safety Guards),
Real-Time USD->VND FX Rate Conversion, Order Locking, and SePay Fulfillment.
"""
import time
import secrets
import pytest
from app.db import tx
from app.services.fx_rate import get_usd_vnd_rate, convert_usd_to_vnd, FALLBACK_USD_VND_RATE
from app.services.billing_service import (
    calculate_order_totals,
    create_checkout_order,
    process_successful_payment,
    get_user_subscription
)
from app.services.signal_ingestion.normalizer import (
    normalize_tradingview_signal,
    normalize_metaapi_demo_signal
)
from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal
from app.schemas.signals import TradingViewWebhookPayload


def test_fx_rate_conversion_and_rounding():
    """Test FX rate service, fallback rate, and 1,000 VND ceiling rounding."""
    rate, source, is_cached = get_usd_vnd_rate(force_refresh=False)
    assert rate > 20000.0

    # Test ceiling rounding to nearest 1,000 VND
    # 30 USD * 25,500 = 765,000 VND (exact multiple of 1,000)
    vnd_1 = convert_usd_to_vnd(30.0, rate=25500.0)
    assert vnd_1 == 765000

    # 30.01 USD * 25,500 = 765,255 VND -> ceil to 766,000 VND
    vnd_2 = convert_usd_to_vnd(30.01, rate=25500.0)
    assert vnd_2 == 766000
    assert vnd_2 % 1000 == 0


def test_order_totals_calculation():
    """Test all-inclusive package pricing (1st cloud slot included) + extra cloud slots ($10/slot)."""
    # Starter: $25 (includes 1st cloud slot)
    tot_starter = calculate_order_totals("starter", cloud_slots_count=1)
    assert tot_starter["copy_trade_usd"] == 25.0
    assert tot_starter["cloud_bridge_usd"] == 0.0
    assert tot_starter["total_usd"] == 25.0

    # Growth: $39 (includes 1st cloud slot)
    tot_growth = calculate_order_totals("growth", cloud_slots_count=1)
    assert tot_growth["copy_trade_usd"] == 39.0
    assert tot_growth["cloud_bridge_usd"] == 0.0
    assert tot_growth["total_usd"] == 39.0

    # Prop Firm Alpha: $59 + 1 extra cloud slot ($10) = $69 for 2 slots
    tot_alpha = calculate_order_totals("alpha", cloud_slots_count=2)
    assert tot_alpha["copy_trade_usd"] == 59.0
    assert tot_alpha["cloud_bridge_usd"] == 10.0
    assert tot_alpha["total_usd"] == 69.0


@pytest.mark.asyncio
async def test_create_checkout_order_and_sepay_fulfillment():
    """Test end-to-end checkout order creation with locked FX rate and SePay payment fulfillment."""
    from app.db import init
    init()
    user_id = f"user_test_{secrets.token_hex(4)}"
    with tx() as c:
        c.execute(
            "INSERT INTO users(id, email, password, role) VALUES(?, ?, 'pwd12345678', 'customer')",
            (user_id, f"{user_id}@example.com")
        )

    # 1. Create checkout order for Growth tier ($39 all-inclusive)
    order = create_checkout_order(
        user_id=user_id,
        plan_tier="growth",
        cloud_slots_count=1
    )
    assert order["status"] == "PENDING"
    assert order["amount_usd"] == 39.0
    assert order["amount_vnd"] > 900000
    assert order["amount_vnd"] % 1000 == 0
    assert order["qr_url"].startswith("https://qr.sepay.vn/")

    order_id = order["order_id"]
    order_suffix = order_id[-6:].lower()

    # 2. Simulate SePay webhook matching this order
    sepay_tx_id = f"sepay_{secrets.token_hex(6)}"
    success = await process_successful_payment(order_suffix, sepay_trans_id=sepay_tx_id)
    assert success is True

    # 3. Verify order marked PAID
    with tx() as c:
        ord_row = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        assert ord_row["status"] in ("PAID", "COMPLETED")
        assert ord_row["sepay_transaction_id"] == sepay_tx_id
        assert ord_row["paid_at"] is not None

    # 4. Verify subscription upgraded with tier features
    sub = get_user_subscription(user_id)
    assert sub["plan_tier"] == "growth"
    assert sub["service_expires_at"] > time.time() + 25 * 86400
    assert sub["allow_custom_multiplier"] == 1
    assert sub["allow_compounding"] == 1


def test_tradingview_webhook_normalization():
    """Test normalization of various TradingView webhook payloads."""
    payload_1 = TradingViewWebhookPayload(
        action="buy",
        ticker="XAUUSD",
        price=2685.50,
        sl=2680.00,
        tp=2695.00,
        strategy_tier="STANDARD"
    )
    sig_1 = normalize_tradingview_signal(payload_1)
    assert sig_1.action == "BUY"
    assert sig_1.symbol == "XAUUSD"
    assert sig_1.entry_price == 2685.50
    assert sig_1.stop_loss == 2680.00
    assert sig_1.take_profit == 2695.00


@pytest.mark.asyncio
async def test_four_mandatory_safety_guards():
    """Test all 4 mandatory guards: Mandatory SL, News Shield, Slippage, and Deduplication."""
    from app.db import init
    init()
    # Guard 1: Auto-attach ATR(14) Stop Loss if missing
    p_no_sl = TradingViewWebhookPayload(
        action="BUY",
        ticker="XAUUSD",
        price=2650.00,
        sl=None,
        tp=2665.00
    )
    sig_no_sl = normalize_tradingview_signal(p_no_sl)
    ok_1, reason_1, sanitized_1 = sanitize_and_audit_signal(sig_no_sl)
    assert ok_1 is True
    assert sanitized_1.stop_loss is not None and 2635.0 <= sanitized_1.stop_loss < 2650.00

    # Guard 2: News Shield (Reject if USD High Impact news within ±15 minutes)
    now_ts = time.time()
    with tx() as c:
        c.execute(
            "INSERT INTO news(id, title, currency, impact, ts) VALUES(?, 'Fed Rate Decision', 'USD', 'HIGH', ?)",
            (f"news_{secrets.token_hex(4)}", now_ts + 300) # 5 minutes in future
        )

    p_news = TradingViewWebhookPayload(action="SELL", ticker="XAUUSD", price=2650.00, sl=2655.00)
    sig_news = normalize_tradingview_signal(p_news)
    ok_news, reason_news, _ = sanitize_and_audit_signal(sig_news, current_time=now_ts)
    assert ok_news is False
    assert "REJECTED_NEWS_SHIELD" in reason_news

    # Remove news to test next guards
    with tx() as c:
        c.execute("DELETE FROM news WHERE title='Fed Rate Decision'")

    # Guard 3: Entry Slippage Guard (Reject if market price drifted > 20 pips / $2.00)
    p_slip = TradingViewWebhookPayload(action="BUY", ticker="XAUUSD", price=2600.00, sl=2595.00)
    sig_slip = normalize_tradingview_signal(p_slip)
    # Provide current market price at 2605.00 ($5 drift > $2 allowed)
    ok_slip, reason_slip, _ = sanitize_and_audit_signal(sig_slip, live_price=2605.00)
    assert ok_slip is False
    assert "REJECTED_SLIPPAGE_EXCEEDED" in reason_slip

    # Guard 4: Redis Deduplication (Reject identical signal within 60s window)
    sig_id_dup = f"test_sig_{secrets.token_hex(4)}"
    p_dup = TradingViewWebhookPayload(action="BUY", ticker="XAUUSD", price=2660.00, sl=2655.00, signal_id=sig_id_dup)
    sig_dup = normalize_tradingview_signal(p_dup)
    
    # First time -> Passes
    ok_first, _, _ = sanitize_and_audit_signal(sig_dup)
    assert ok_first is True

    # Second time with same signal_id or identical payload -> Rejected by Idempotency
    ok_second, reason_second, _ = sanitize_and_audit_signal(sig_dup)
    assert ok_second is False
    assert "REJECTED_DUPLICATE_SIGNAL" in reason_second
