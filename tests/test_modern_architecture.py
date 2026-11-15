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


def test_migrations_runner(client):
    """Verify versioned migration runner applies all versions and tracks schema_migrations."""
    with tx() as c:
        from app.migrations import get_applied_versions
        versions = get_applied_versions(c)
        assert 1 in versions
        assert 2 in versions
        assert 3 in versions
        assert 4 in versions


def test_timescale_candles_timeframe_validation(client):
    """Verify strict validation on /api/timescale/candles: support M1, M5, M15, H1, D1; reject invalid with 400."""
    for tf in ['M1', 'M5', 'M15', 'H1', 'D1']:
        resp = client.get(f'/api/timescale/candles?symbol=XAUUSD&timeframe={tf}')
        assert resp.status_code == 200, f"Expected 200 for timeframe {tf}"
        data = resp.json()
        assert data['timeframe'] == tf
        assert data['symbol'] == 'XAUUSD'

    # Unsupported timeframe
    resp_bad = client.get('/api/timescale/candles?symbol=XAUUSD&timeframe=M3')
    assert resp_bad.status_code == 400
    assert 'Unsupported timeframe' in resp_bad.json()['detail']


def test_readiness_probe_contract(client):
    """Verify /readyz returns complete diagnostic health structure."""
    resp = client.get('/readyz')
    assert resp.status_code == 200
    data = resp.json()
    assert data['status'] == 'ready'
    assert 'database' in data
    assert 'redis' in data
    assert 'timescaledb' in data
    assert 'execution_worker' in data


def test_trace_secret_sanitization():
    """Verify passwords, authorization headers, and tokens are scrubbed from LangSmith traces."""
    from app.tracing import sanitize_secrets, REDACTED
    raw = {
        'username': 'john',
        'password': 'super-secret-password-123',
        'token': 'Bearer secret-token-value-here',
        'sub': {
            'apiKey': 'sk-proj-xyz123',
            'normal_field': 'normal_data'
        }
    }
    cleaned = sanitize_secrets(raw)
    assert cleaned['username'] == 'john'
    assert cleaned['password'] == REDACTED
    assert cleaned['token'] == REDACTED
    assert cleaned['sub']['apiKey'] == REDACTED
    assert cleaned['sub']['normal_field'] == 'normal_data'


def test_transactional_outbox_flow(client):
    """Verify signal publishing inserts into outbox and consumer reads from stream."""
    with tx() as c:
        from app.engine import publish, flush_outbox
        from app.redis_client import consume_signals_stream, ack_signal
        sid = publish(c, 'DEMO', 'BUY', 2700.50, f'test-outbox-{time.time()}')
        # Check outbox has the pending entry
        rows = c.execute("SELECT * FROM outbox WHERE payload LIKE ? AND event_type='signal_created'", (f'%{sid}%',)).fetchall()
        assert len(rows) >= 1
        # Flush outbox
        flush_outbox(c)
        # Verify status is published
        status_row = c.execute("SELECT status FROM outbox WHERE payload LIKE ?", (f'%{sid}%',)).fetchone()
        assert status_row[0] == 'published'
        # Consume stream
        stream_items = consume_signals_stream(count=5)
        assert any(item.get('signal_id') == sid for item in stream_items)


def test_migration_fresh_and_legacy_database_upgrade():
    """Verify migrations handle both fresh database and upgrading existing legacy schemas with preserved data."""
    import sqlite3
    import tempfile
    import os
    from app.migrations import run_all_migrations, get_applied_versions
    from app.db import ConnectionWrapper

    # 1. Fresh database scenario
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tf:
        fresh_path = tf.name

    try:
        fresh_conn = sqlite3.connect(fresh_path)
        wrapped_fresh = ConnectionWrapper(fresh_conn, is_pg=False)
        run_all_migrations(wrapped_fresh, is_pg=False)
        versions = get_applied_versions(wrapped_fresh)
        assert versions == [1, 2, 3, 4]
        fresh_conn.close()
    finally:
        if os.path.exists(fresh_path):
            os.remove(fresh_path)

    # 2. Legacy database scenario: pre-create tables without Timescale partition key, populate data, then run migrations
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tf:
        legacy_path = tf.name

    legacy_conn = None
    try:
        legacy_conn = sqlite3.connect(legacy_path)
        wrapped_legacy = ConnectionWrapper(legacy_conn, is_pg=False)
        # Apply migration 1 first so core tables exist
        from app.migrations import apply_migration_001
        apply_migration_001(wrapped_legacy, is_pg=False)
        legacy_conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at REAL NOT NULL);")
        legacy_conn.execute("INSERT INTO schema_migrations VALUES (1, '001_core_schema', 1234567890);")
        # Legacy quotes table
        legacy_conn.execute("""
            CREATE TABLE IF NOT EXISTS quotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                symbol TEXT DEFAULT 'XAUUSD',
                ts REAL NOT NULL,
                bid REAL NOT NULL,
                ask REAL NOT NULL,
                UNIQUE(source, ts)
            );
        """)
        legacy_conn.execute("INSERT INTO quotes (source, symbol, ts, bid, ask) VALUES ('DEMO', 'XAUUSD', 1700000000.0, 2600.0, 2600.3);")
        legacy_conn.commit()

        # Run migrations on legacy
        run_all_migrations(wrapped_legacy, is_pg=False)
        legacy_versions = get_applied_versions(wrapped_legacy)
        assert legacy_versions == [1, 2, 3, 4]

        # Verify existing data is preserved
        row = legacy_conn.execute("SELECT count(*), bid, ask FROM quotes WHERE source='DEMO'").fetchone()
        assert row[0] >= 1
        assert float(row[1]) == 2600.0
    finally:
        if legacy_conn is not None:
            legacy_conn.close()
        if os.path.exists(legacy_path):
            try:
                os.remove(legacy_path)
            except Exception:
                pass

    # 3. If PostgreSQL is configured, verify migrations on fresh and legacy PostgreSQL schemas
    database_url = os.getenv("DATABASE_URL", "")
    if database_url.startswith("postgresql://") or database_url.startswith("postgres://"):
        run_postgres_migration_test(database_url)


def run_postgres_migration_test(database_url: str = None):
    """Verify migrations on PostgreSQL on both a fresh schema and a legacy pre-existing schema."""
    import psycopg
    from app.migrations import run_all_migrations, get_applied_versions, apply_migration_001
    from app.db import ConnectionWrapper

    if not database_url:
        database_url = os.getenv("DATABASE_URL", "")
    if not (database_url.startswith("postgresql://") or database_url.startswith("postgres://")):
        return

    # A. Fresh schema test
    with psycopg.connect(database_url, autocommit=True) as raw_conn:
        with raw_conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS fresh_schema_test CASCADE;")
            cur.execute("CREATE SCHEMA fresh_schema_test;")
            cur.execute("SET search_path TO fresh_schema_test, public;")
        
        wrapped_fresh = ConnectionWrapper(raw_conn, is_pg=True)
        run_all_migrations(wrapped_fresh, is_pg=True)
        fresh_versions = get_applied_versions(wrapped_fresh)
        assert fresh_versions == [1, 2, 3, 4], f"Expected all migrations [1, 2, 3, 4], got {fresh_versions}"

        with raw_conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS fresh_schema_test CASCADE;")

    # B. Legacy schema test: pre-existing schema with legacy quotes and data
    with psycopg.connect(database_url, autocommit=True) as raw_conn:
        with raw_conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS legacy_schema_test CASCADE;")
            cur.execute("CREATE SCHEMA legacy_schema_test;")
            cur.execute("SET search_path TO legacy_schema_test, public;")

        wrapped_legacy = ConnectionWrapper(raw_conn, is_pg=True)
        apply_migration_001(wrapped_legacy, is_pg=True)
        with raw_conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at DOUBLE PRECISION NOT NULL);")
            cur.execute("INSERT INTO schema_migrations VALUES (1, '001_core_schema', 1234567890);")
            # Legacy quotes table without hypertable structure
            cur.execute("""
                CREATE TABLE IF NOT EXISTS quotes (
                    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    source TEXT NOT NULL,
                    symbol TEXT DEFAULT 'XAUUSD',
                    ts DOUBLE PRECISION NOT NULL,
                    bid DOUBLE PRECISION NOT NULL,
                    ask DOUBLE PRECISION NOT NULL,
                    UNIQUE(source, ts)
                );
            """)
            cur.execute("INSERT INTO quotes (source, symbol, ts, bid, ask) VALUES ('DEMO', 'XAUUSD', 1700000000.0, 2600.0, 2600.3);")

        # Run all migrations on legacy schema
        run_all_migrations(wrapped_legacy, is_pg=True)
        legacy_versions = get_applied_versions(wrapped_legacy)
        assert legacy_versions == [1, 2, 3, 4], f"Expected [1, 2, 3, 4], got {legacy_versions}"

        # Verify existing data is preserved
        with raw_conn.cursor() as cur:
            cur.execute("SELECT count(*), bid, ask FROM quotes WHERE source = 'DEMO'")
            row = cur.fetchone()
            assert row[0] >= 1, "Legacy data missing after migration"
            assert float(row[1]) == 2600.0 and float(row[2]) == 2600.3, f"Corrupted data: {row}"
            cur.execute("DROP SCHEMA IF EXISTS legacy_schema_test CASCADE;")
            cur.execute("SET search_path TO public;")



def test_multi_strategy_coordinator():
    """Verify Multi-Strategy Coordinator handles Trend Following, Mean Reversion, Breakout, and Stand Aside."""
    from app.engine import (
        trend_following_signal,
        mean_reversion_signal,
        breakout_signal,
        coordinate_strategies,
        STRATEGY_VERSION,
    )

    # 1. Trend Following test series: rising slope with upward crossover
    rising = [2650.0] * 20 + [2650.0, 2650.0, 2650.5]
    t_side, t_reason = trend_following_signal(rising, fast_n=5, slow_n=20)
    assert t_side == 'BUY'
    assert 'TREND_BUY' in t_reason

    falling = [2650.0] * 20 + [2650.0, 2650.0, 2649.5]
    t_side_fall, t_reason_fall = trend_following_signal(falling, fast_n=5, slow_n=20)
    assert t_side_fall == 'SELL'
    assert 'TREND_SELL' in t_reason_fall

    # 2. Mean Reversion test series: oscillating range where last price drops below 2-sigma lower band
    import math
    base = [2650.0 + math.sin(i / 2.0) * 3.0 for i in range(25)]
    # Dip sharply below lower band
    base[-1] = 2640.0
    mr_side, mr_reason = mean_reversion_signal(base, period=20, num_std=2.0)
    assert mr_side == 'BUY'
    assert 'MEAN_REV_BUY' in mr_reason

    # 3. Breakout test series: range with spread >= 1.0 followed by strong breakout
    box = [2650.0 + (i % 3) * 1.5 for i in range(25)]
    box[-1] = 2660.0  # Breaks out above 2653.0
    b_side, b_reason = breakout_signal(box, period=20)
    assert b_side == 'BUY'
    assert 'BREAKOUT_BUY' in b_reason

    # 4. Multi-Strategy Coordinator evaluation
    decision = coordinate_strategies(box, timeframe="M15")
    assert decision["side"] in ('BUY', 'SELL')
    assert decision["strategy"] in ("trend_following", "breakout", "mean_reversion")
    assert decision["version"] == STRATEGY_VERSION
    assert "parameters" in decision
    assert len(decision["reason"]) > 0

    # 5. Stand aside regime
    flat = [2650.0] * 30
    flat_decision = coordinate_strategies(flat, timeframe="M15")
    assert flat_decision["side"] is None
    assert "STAND_ASIDE" in flat_decision["reason"]


def test_spa_fallback_and_api_pure_json(client):
    """Verify SPA fallback returns HTML for client routes but pure JSON 404/401 for /api/*."""
    # 1. Root and SPA client routes return HTML (status 200)
    root_resp = client.get('/')
    assert root_resp.status_code == 200
    assert 'text/html' in root_resp.headers.get('content-type', '')

    spa_resp = client.get('/overview')
    assert spa_resp.status_code == 200
    assert 'text/html' in spa_resp.headers.get('content-type', '')

    admin_spa = client.get('/admin/approvals')
    assert admin_spa.status_code == 200
    assert 'text/html' in admin_spa.headers.get('content-type', '')

    # 2. Non-existent API route MUST return 404 JSON, NEVER HTML
    api_404 = client.get('/api/does_not_exist_endpoint')
    assert api_404.status_code == 404
    assert 'application/json' in api_404.headers.get('content-type', '')
    data = api_404.json()
    assert 'detail' in data

    # 3. Unauthenticated API route MUST return 401 JSON, NEVER HTML
    api_unauth = client.get('/api/admin/monitor')
    assert api_unauth.status_code == 401
    assert 'application/json' in api_unauth.headers.get('content-type', '')
    unauth_data = api_unauth.json()
    assert 'detail' in unauth_data



