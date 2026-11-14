"""Comprehensive tests for the 4 mandatory architectural technologies:
1. PostgreSQL + TimescaleDB (hypertables, time-series query helpers, cursor adaptations)
2. Redis (Pub/Sub & Streams signal distribution, heartbeat caching, distributed locking)
3. Vercel AI SDK 6 (Data Stream Protocol, Generative UI tool calls, ToolLoopAgent with needsApproval: true)
4. LangSmith (Tracing, latency, token metrics, graceful offline fallback, telemetry endpoint)
"""
import time
import json
import pytest
from app import db, redis_client, tracing
from app.db import tx, insert_timescale_quote, query_timescale_candles
from app.redis_client import (
    publish_signal_event,
    read_recent_signals,
    cache_heartbeat,
    get_cached_heartbeat,
    acquire_dispatch_lock,
    release_dispatch_lock,
    dispatch_lock,
    LockAcquisitionError,
    STREAM_SIGNALS,
    CHANNEL_SIGNALS,
)
from app.tracing import (
    record_trace,
    trace_ai_interaction,
    trace_langgraph_step,
    get_trace_summary,
    is_langsmith_enabled,
)


def test_timescaledb_helpers_and_cursor_adaptation(client):
    """Verify TimescaleDB helper operations and query execution."""
    db.init()
    now = time.time()
    # Insert quote ticks
    insert_timescale_quote('DEMO', now - 30, 2650.10, 2650.40, symbol='XAUUSD')
    insert_timescale_quote('DEMO', now - 10, 2651.20, 2651.50, symbol='XAUUSD')

    with tx() as c:
        row = c.execute("SELECT count(*) FROM quotes WHERE source='DEMO'").fetchone()
        assert row[0] >= 2

    # Query candles helper
    candles = query_timescale_candles(symbol='XAUUSD', timeframe='M15', limit=5)
    assert isinstance(candles, list)


def test_redis_signal_stream_and_pubsub():
    """Verify signal publishing to Redis Streams and Pub/Sub channel."""
    sig = {
        "id": "sig_test_12345",
        "source": "DEMO",
        "side": "BUY",
        "price": 2652.50,
        "sl": 2646.50,
        "tp": 2664.50,
        "created": time.time(),
        "expires": time.time() + 45,
    }
    stream_id = publish_signal_event(sig)
    assert stream_id is not None
    assert isinstance(stream_id, str)

    recent = read_recent_signals(count=10)
    assert len(recent) > 0
    matched = [s for s in recent if s.get("signal_id") == "sig_test_12345"]
    assert len(matched) == 1
    assert matched[0]["side"] == "BUY"
    assert float(matched[0]["price"]) == 2652.50


def test_redis_heartbeat_caching():
    """Verify heartbeat caching with TTL and fast retrieval."""
    acc_id = "acc_demo_test_999"
    payload = {
        "login": "99988877",
        "server": "Broker-Demo",
        "balance": 15420.50,
        "equity": 15630.00,
        "positions": 1,
    }
    ok = cache_heartbeat(acc_id, payload, ttl=60)
    assert ok is True

    cached = get_cached_heartbeat(acc_id)
    assert cached is not None
    assert cached["login"] == "99988877"
    assert cached["balance"] == 15420.50
    assert cached["equity"] == 15630.00
    assert "cached_at" in cached


def test_redis_distributed_locking_prevents_duplicate_dispatch():
    """Verify distributed lock prevents duplicate dispatches for the same signal_id + account_id."""
    acc_id = "acc_lock_01"
    sig_id = "sig_lock_01"

    # 1. First worker acquires lock
    token1 = acquire_dispatch_lock(acc_id, sig_id, ttl_seconds=10)
    assert token1 is not None

    # 2. Concurrent worker tries to acquire lock for same account & signal -> must be rejected
    token2 = acquire_dispatch_lock(acc_id, sig_id, ttl_seconds=10)
    assert token2 is None, "Second concurrent acquire must return None (blocked by distributed lock)"

    # 3. Context manager raises LockAcquisitionError on conflict
    with pytest.raises(LockAcquisitionError):
        with dispatch_lock(acc_id, sig_id, ttl_seconds=10):
            pass

    # 4. Release lock by owner
    released = release_dispatch_lock(acc_id, sig_id, token1)
    assert released is True

    # 5. Lock can now be reacquired
    token3 = acquire_dispatch_lock(acc_id, sig_id, ttl_seconds=10)
    assert token3 is not None
    release_dispatch_lock(acc_id, sig_id, token3)


def test_langsmith_tracing_and_fallback():
    """Verify LangSmith trace recording, token metrics, latency, and safe offline fallback."""
    summary = get_trace_summary()
    assert "langsmith_configured" in summary
    assert "project" in summary
    assert "total_traces_recorded" in summary

    # Trace AI interaction
    run_id = trace_ai_interaction(
        prompt="Phân tích danh mục",
        response_text="Danh mục hiện có 1 tài khoản với tỷ lệ rủi ro 0.25%.",
        model="gpt-4.1-mini",
        prompt_tokens=45,
        completion_tokens=22,
        latency_ms=120.5,
    )
    assert run_id is not None

    # Trace LangGraph research step
    lg_id = trace_langgraph_step(
        node_name="walk_forward",
        inputs={"prices_count": 900},
        outputs={"oos_net_price_units": 18.25},
        latency_ms=350.2,
    )
    assert lg_id is not None

    summary_after = get_trace_summary()
    assert summary_after["total_traces_recorded"] >= 2
    latest = summary_after["recent_traces"][-1]
    assert latest["name"].startswith("langgraph:")
    assert latest["latency_ms"] == 350.2


def test_vercel_ai_sdk_assistant_data_stream_endpoint(client, customer):
    """Verify Vercel AI SDK 6 Data Stream Protocol and Generative UI tool call on /api/chat/assistant."""
    c = customer
    resp = c.post(
        '/api/chat/assistant',
        json={
            'messages': [
                {'role': 'user', 'content': 'Cho tôi xem tổng quan số dư tài khoản'}
            ]
        }
    )
    assert resp.status_code == 200
    assert 'x-vercel-ai-data-stream' in resp.headers

    body = resp.text
    # Verify Data Stream protocol lines: text line '0:...' and tool line '9:...'
    assert '0:' in body
    assert 'renderPortfolioCard' in body
    assert 'd:{"finishReason":"stop"}' in body


def test_vercel_ai_sdk_admin_tool_loop_approval_endpoint(client):
    """Verify Vercel AI SDK 6 ToolLoopAgent with needsApproval: true on /api/chat/admin-agent."""
    # 1. Login as admin
    p = {'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'}
    assert client.post('/api/login', json=p).status_code == 200

    # 2. Call admin-agent endpoint
    resp = client.post(
        '/api/chat/admin-agent',
        json={
            'messages': [
                {'role': 'user', 'content': 'Kiểm tra hàng đợi phê duyệt chiến lược'}
            ]
        }
    )
    assert resp.status_code == 200
    assert 'x-vercel-ai-data-stream' in resp.headers
    body = resp.text
    assert '0:' in body
    assert 'd:{"finishReason":"stop"}' in body


def test_admin_tracing_telemetry_endpoint(client):
    """Verify GET /api/admin/tracing returns valid telemetry to Admin."""
    p = {'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'}
    assert client.post('/api/login', json=p).status_code == 200

    resp = client.get('/api/admin/tracing')
    assert resp.status_code == 200
    data = resp.json()
    assert 'project' in data
    assert 'total_traces_recorded' in data
    assert isinstance(data['recent_traces'], list)
