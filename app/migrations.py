"""Versioned database migrations runner for PostgreSQL, TimescaleDB, and SQLite.
Supports both fresh database initialization and upgrading existing pre-Timescale schemas."""
import time
import logging
from typing import Any, Dict, List

logger = logging.getLogger("zupirus.migrations")

MIGRATIONS = [
    {
        "version": 1,
        "name": "001_core_schema",
        "description": "Core authentication, accounts, signals, dispatches, and audit tables"
    },
    {
        "version": 2,
        "name": "002_timescale_hypertables",
        "description": "Partition-compatible quotes and candles schemas with TimescaleDB hypertables"
    },
    {
        "version": 3,
        "name": "003_transactional_outbox",
        "description": "Outbox table for atomic signal creation and resilient Redis stream publishing"
    },
    {
        "version": 4,
        "name": "004_dispatch_concurrency_indexes",
        "description": "Guaranteed dispatch ordering and deduplication indexes"
    },
    {
        "version": 5,
        "name": "005_hindsight_memory_and_gemini_keys",
        "description": "Hindsight agent memory tables (vectorize-io/hindsight) and Gemini API key management pool"
    },
    {
        "version": 6,
        "name": "006_otp_codes_table",
        "description": "OTP codes storage for Resend email verification and password resets"
    }
]


def ensure_migration_table(c, is_pg: bool):
    """Ensure the schema_migrations tracking table exists."""
    if is_pg:
        c.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
    else:
        c.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at REAL NOT NULL
            );
        """)


def get_applied_versions(c) -> List[int]:
    """Retrieve list of already applied migration versions."""
    rows = c.execute("SELECT version FROM schema_migrations ORDER BY version ASC").fetchall()
    return [r[0] for r in rows]


def apply_migration_001(c, is_pg: bool):
    """Migration 001: Core tables."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('customer', 'admin'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            expires DOUBLE PRECISION NOT NULL
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('DEMO', 'REPLAY')),
            enabled INTEGER NOT NULL DEFAULT 0,
            risk DOUBLE PRECISION NOT NULL DEFAULT 0.25,
            max_spread DOUBLE PRECISION NOT NULL DEFAULT 0.8,
            max_positions INTEGER NOT NULL DEFAULT 1,
            max_dd DOUBLE PRECISION NOT NULL DEFAULT 10,
            balance DOUBLE PRECISION NOT NULL DEFAULT 10000,
            equity DOUBLE PRECISION NOT NULL DEFAULT 10000,
            peak DOUBLE PRECISION NOT NULL DEFAULT 10000,
            seen DOUBLE PRECISION NOT NULL DEFAULT 0,
            positions INTEGER NOT NULL DEFAULT 0,
            UNIQUE(login, server)
        );
        CREATE TABLE IF NOT EXISTS pairings (
            code TEXT PRIMARY KEY,
            account_id TEXT REFERENCES accounts(id),
            expires DOUBLE PRECISION NOT NULL,
            used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS devices (
            token TEXT PRIMARY KEY,
            account_id TEXT UNIQUE REFERENCES accounts(id)
        );
        CREATE TABLE IF NOT EXISTS signals (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL CHECK(source IN ('DEMO', 'REPLAY')),
            side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
            price DOUBLE PRECISION NOT NULL,
            sl DOUBLE PRECISION NOT NULL,
            tp DOUBLE PRECISION NOT NULL,
            created DOUBLE PRECISION NOT NULL,
            expires DOUBLE PRECISION NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dispatches (
            id BIGSERIAL PRIMARY KEY,
            account_id TEXT REFERENCES accounts(id),
            signal_id TEXT REFERENCES signals(id),
            state TEXT NOT NULL DEFAULT 'queued',
            nonce TEXT,
            ticket TEXT,
            deal TEXT,
            reason TEXT,
            fill_price DOUBLE PRECISION,
            created DOUBLE PRECISION NOT NULL,
            updated DOUBLE PRECISION NOT NULL,
            UNIQUE(account_id, signal_id)
        );
        ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS fill_price DOUBLE PRECISION;
        CREATE UNIQUE INDEX IF NOT EXISTS unique_deal ON dispatches(account_id, deal) WHERE deal IS NOT NULL AND deal != '';
        CREATE TABLE IF NOT EXISTS audit (
            id BIGSERIAL PRIMARY KEY,
            ts DOUBLE PRECISION NOT NULL,
            actor TEXT NOT NULL,
            event TEXT NOT NULL,
            detail TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            decision INTEGER,
            result TEXT,
            error TEXT,
            created DOUBLE PRECISION NOT NULL
        );
        CREATE TABLE IF NOT EXISTS news (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            currency TEXT NOT NULL,
            impact TEXT NOT NULL,
            ts DOUBLE PRECISION NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sim_positions (
            dispatch_id BIGINT PRIMARY KEY REFERENCES dispatches(id),
            account_id TEXT REFERENCES accounts(id),
            side TEXT NOT NULL,
            entry DOUBLE PRECISION NOT NULL,
            sl DOUBLE PRECISION NOT NULL,
            tp DOUBLE PRECISION NOT NULL,
            lots DOUBLE PRECISION NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_limits (
            key TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL,
            until DOUBLE PRECISION NOT NULL
        );
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin')));
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),login TEXT NOT NULL,server TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('DEMO','REPLAY')),enabled INTEGER NOT NULL DEFAULT 0,risk REAL NOT NULL DEFAULT 0.25,max_spread REAL NOT NULL DEFAULT 0.8,max_positions INTEGER NOT NULL DEFAULT 1,max_dd REAL NOT NULL DEFAULT 10,balance REAL NOT NULL DEFAULT 10000,equity REAL NOT NULL DEFAULT 10000,peak REAL NOT NULL DEFAULT 10000,seen REAL NOT NULL DEFAULT 0,positions INTEGER NOT NULL DEFAULT 0,UNIQUE(login,server));
        CREATE TABLE IF NOT EXISTS pairings(code TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS devices(token TEXT PRIMARY KEY,account_id TEXT UNIQUE REFERENCES accounts(id));
        CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,source TEXT NOT NULL CHECK(source IN ('DEMO','REPLAY')),side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),price REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,created REAL NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS dispatches(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT REFERENCES accounts(id),signal_id TEXT REFERENCES signals(id),state TEXT NOT NULL DEFAULT 'queued',nonce TEXT,ticket TEXT,deal TEXT,reason TEXT,fill_price REAL,created REAL NOT NULL,updated REAL NOT NULL,UNIQUE(account_id,signal_id));
        CREATE UNIQUE INDEX IF NOT EXISTS unique_deal ON dispatches(account_id,deal) WHERE deal IS NOT NULL AND deal != '';
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts REAL NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,decision INTEGER,result TEXT,error TEXT,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,title TEXT NOT NULL,currency TEXT NOT NULL,impact TEXT NOT NULL,ts REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sim_positions(dispatch_id INTEGER PRIMARY KEY REFERENCES dispatches(id),account_id TEXT REFERENCES accounts(id),side TEXT NOT NULL,entry REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,lots REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,until REAL NOT NULL);
        """)
        try:
            c.execute("ALTER TABLE dispatches ADD COLUMN fill_price REAL;")
        except Exception:
            pass


def apply_migration_002(c, is_pg: bool):
    """Migration 002: Partition-compatible quotes and candles schemas with TimescaleDB hypertables.
    Safe for both brand new databases and existing legacy databases."""
    if is_pg:
        # 1. Create tables with partition-compatible constraints FIRST
        c.execute("""
        CREATE TABLE IF NOT EXISTS quotes (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            source TEXT NOT NULL,
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            ts DOUBLE PRECISION NOT NULL,
            bid DOUBLE PRECISION NOT NULL,
            ask DOUBLE PRECISION NOT NULL,
            CONSTRAINT uq_quotes UNIQUE (time, source, ts)
        );
        CREATE TABLE IF NOT EXISTS candles (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            source TEXT NOT NULL DEFAULT 'DEMO',
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            timeframe TEXT NOT NULL DEFAULT 'M15',
            open DOUBLE PRECISION NOT NULL,
            high DOUBLE PRECISION NOT NULL,
            low DOUBLE PRECISION NOT NULL,
            close DOUBLE PRECISION NOT NULL,
            volume DOUBLE PRECISION NOT NULL DEFAULT 0,
            CONSTRAINT uq_candles UNIQUE (time, source, symbol, timeframe)
        );
        CREATE TABLE IF NOT EXISTS snapshots (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            account_id TEXT REFERENCES accounts(id),
            ts DOUBLE PRECISION NOT NULL,
            balance DOUBLE PRECISION NOT NULL,
            equity DOUBLE PRECISION NOT NULL
        );

        -- Add missing partition and identity columns for pre-existing legacy tables
        ALTER TABLE quotes ADD COLUMN IF NOT EXISTS time TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE candles ADD COLUMN IF NOT EXISTS time TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS time TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE quotes ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY;
        ALTER TABLE candles ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY;
        ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY;
        """)

        # 2. Schema upgrade for legacy databases: drop constraints incompatible with TimescaleDB partitioning
        c.execute("""
        DO $$
        BEGIN
            -- Ensure quotes constraint includes partitioning column 'time'
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'quotes_source_ts_key' AND conrelid = 'quotes'::regclass
            ) THEN
                ALTER TABLE quotes DROP CONSTRAINT quotes_source_ts_key;
            END IF;
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'quotes_pkey' AND conrelid = 'quotes'::regclass
            ) THEN
                ALTER TABLE quotes DROP CONSTRAINT quotes_pkey;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_quotes' AND conrelid = 'quotes'::regclass
            ) THEN
                ALTER TABLE quotes ADD CONSTRAINT uq_quotes UNIQUE (time, source, ts);
            END IF;

            -- Ensure candles constraint includes partitioning column 'time'
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'candles_source_symbol_timeframe_key' AND conrelid = 'candles'::regclass
            ) THEN
                ALTER TABLE candles DROP CONSTRAINT candles_source_symbol_timeframe_key;
            END IF;
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'candles_pkey' AND conrelid = 'candles'::regclass
            ) THEN
                ALTER TABLE candles DROP CONSTRAINT candles_pkey;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_candles' AND conrelid = 'candles'::regclass
            ) THEN
                ALTER TABLE candles ADD CONSTRAINT uq_candles UNIQUE (time, source, symbol, timeframe);
            END IF;
        END $$;
        """)

        # 3. Create TimescaleDB hypertables if extension is active
        has_timescale = c.execute("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'").fetchone()
        if has_timescale:
            for table, time_col in [("quotes", "time"), ("candles", "time"), ("snapshots", "time")]:
                c.execute(f"SELECT create_hypertable('{table}', '{time_col}', if_not_exists => TRUE, migrate_data => TRUE);")
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT REFERENCES accounts(id), ts REAL NOT NULL, balance REAL NOT NULL, equity REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY AUTOINCREMENT, time REAL DEFAULT 0, source TEXT NOT NULL, symbol TEXT DEFAULT 'XAUUSD', ts REAL NOT NULL, bid REAL NOT NULL, ask REAL NOT NULL, UNIQUE(source, ts));
        CREATE TABLE IF NOT EXISTS candles(id INTEGER PRIMARY KEY AUTOINCREMENT, time REAL NOT NULL, source TEXT NOT NULL DEFAULT 'DEMO', symbol TEXT NOT NULL DEFAULT 'XAUUSD', timeframe TEXT NOT NULL DEFAULT 'M15', open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL DEFAULT 0, UNIQUE(time, source, symbol, timeframe));
        """)


def apply_migration_003(c, is_pg: bool):
    """Migration 003: Transactional Outbox pattern table."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS outbox (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            created_at DOUBLE PRECISION NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
            published_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(id) WHERE status = 'pending';
        """)
        # If created_at was TIMESTAMPTZ from older migration run, safely alter to DOUBLE PRECISION
        try:
            c.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'outbox' AND column_name = 'created_at' AND data_type LIKE '%timestamp%'
                ) THEN
                    ALTER TABLE outbox ALTER COLUMN created_at DROP DEFAULT;
                    ALTER TABLE outbox ALTER COLUMN created_at TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM created_at);
                    ALTER TABLE outbox ALTER COLUMN created_at SET DEFAULT EXTRACT(EPOCH FROM NOW());
                    ALTER TABLE outbox ALTER COLUMN published_at TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM published_at);
                END IF;
            END $$;
            """)
        except Exception:
            pass
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            created_at REAL NOT NULL,
            published_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(id, status);
        """)


def apply_migration_004(c, is_pg: bool):
    """Migration 004: Performance & deduplication indexes."""
    if is_pg:
        c.execute("""
        CREATE INDEX IF NOT EXISTS idx_dispatches_acc_state ON dispatches(account_id, state);
        CREATE INDEX IF NOT EXISTS idx_signals_source_expires ON signals(source, expires);
        CREATE INDEX IF NOT EXISTS idx_snapshots_account_time ON snapshots(account_id, time DESC);
        CREATE INDEX IF NOT EXISTS idx_quotes_symbol_source_time ON quotes(symbol, source, time DESC);
        """)
    else:
        c.executescript("""
        CREATE INDEX IF NOT EXISTS idx_dispatches_acc_state ON dispatches(account_id, state);
        CREATE INDEX IF NOT EXISTS idx_signals_source_expires ON signals(source, expires);
        CREATE INDEX IF NOT EXISTS idx_snapshots_account_ts ON snapshots(account_id, ts DESC);
        """)


def apply_migration_005(c, is_pg: bool):
    """Migration 005: Hindsight long-term agent memory and Gemini API key management pool."""
    from .gemini_client import seed_default_keys
    from .hindsight import store_memory, CATEGORY_SEMANTIC, CATEGORY_REFLECTIVE

    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS hindsight_memories (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            entity_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            relevance_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            created DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hindsight_category ON hindsight_memories(category);
        CREATE INDEX IF NOT EXISTS idx_hindsight_entity ON hindsight_memories(entity_id);
        CREATE INDEX IF NOT EXISTS idx_hindsight_created ON hindsight_memories(created DESC);

        CREATE TABLE IF NOT EXISTS gemini_keys (
            id TEXT PRIMARY KEY,
            key_hash TEXT UNIQUE NOT NULL,
            key_masked TEXT NOT NULL,
            key_cipher TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            calls_count INTEGER NOT NULL DEFAULT 0,
            last_used DOUBLE PRECISION,
            status TEXT NOT NULL DEFAULT 'active',
            created DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gemini_active ON gemini_keys(is_active, status);

        CREATE TABLE IF NOT EXISTS otp_codes (
            email TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            expires_at DOUBLE PRECISION NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0
        );
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS hindsight_memories (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            entity_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            relevance_score REAL NOT NULL DEFAULT 1.0,
            created REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hindsight_category ON hindsight_memories(category);
        CREATE INDEX IF NOT EXISTS idx_hindsight_entity ON hindsight_memories(entity_id);
        CREATE INDEX IF NOT EXISTS idx_hindsight_created ON hindsight_memories(created DESC);

        CREATE TABLE IF NOT EXISTS gemini_keys (
            id TEXT PRIMARY KEY,
            key_hash TEXT UNIQUE NOT NULL,
            key_masked TEXT NOT NULL,
            key_cipher TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            calls_count INTEGER NOT NULL DEFAULT 0,
            last_used REAL,
            status TEXT NOT NULL DEFAULT 'active',
            created REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gemini_active ON gemini_keys(is_active, status);

        CREATE TABLE IF NOT EXISTS otp_codes (
            email TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            expires_at REAL NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0
        );
        """)

    # Seed Gemini Keys Pool
    seed_default_keys(c)

    # Seed initial Hindsight long-term memories
    store_memory(
        c,
        category=CATEGORY_SEMANTIC,
        title="Quy tắc định lượng XAUUSD M15 cốt lõi",
        content="Chiến lược chỉ kích hoạt khi nến M15 đã đóng hoàn toàn; không vào lệnh giữa nến để tránh repaint. Khóa phân tán Redis lock:dispatch bảo vệ chống double-dispatch.",
        tags=["core_rules", "xauusd", "closed_candles"],
    )
    store_memory(
        c,
        category=CATEGORY_REFLECTIVE,
        title="Chính sách bảo vệ an toàn tin tức",
        content="Toàn bộ lệnh mở mới phải bị chặn trong cửa sổ ±15 phút trước và sau khi công bố tin tức USD High Impact (CPI, Non-Farm, FOMC). Các vị thế hiện hữu giữ nguyên SL/TP broker.",
        tags=["risk_policy", "news_blackout", "fail_closed"],
    )


def apply_migration_006(c, is_pg: bool):
    """Create otp_codes table for Resend email verification."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS otp_codes (
            email TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            expires_at DOUBLE PRECISION NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0
        );
        """)
    else:
        c.execute("""
        CREATE TABLE IF NOT EXISTS otp_codes (
            email TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            expires_at REAL NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0
        );
        """)


def run_all_migrations(c, is_pg: bool):
    """Run all pending migrations in order."""
    ensure_migration_table(c, is_pg)
    applied = set(get_applied_versions(c))

    handlers = {
        1: apply_migration_001,
        2: apply_migration_002,
        3: apply_migration_003,
        4: apply_migration_004,
        5: apply_migration_005,
        6: apply_migration_006,
    }

    for m in MIGRATIONS:
        v = m["version"]
        if v not in applied:
            logger.info(f"Applying migration {v}: {m['name']}...")
            handler = handlers[v]
            handler(c, is_pg)
            if is_pg:
                c.execute("INSERT INTO schema_migrations(version, name) VALUES (%s, %s)", (v, m["name"]))
                c.commit()
            else:
                c.execute("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)", (v, m["name"], time.time()))
                c.commit()
            logger.info(f"Migration {v} ({m['name']}) applied successfully.")


def verify_timescaledb_metadata(c, is_pg: bool) -> Dict[str, Any]:
    """Inspect TimescaleDB metadata if available."""
    if not is_pg:
        return {"timescaledb_available": False, "mode": "sqlite"}

    result: Dict[str, Any] = {
        "timescaledb_available": False,
        "extension_version": None,
        "hypertables": []
    }

    try:
        # Check if extension is installed
        ext_row = c.execute("SELECT default_version, installed_version FROM pg_available_extensions WHERE name='timescaledb'").fetchone()
        if ext_row and ext_row[1]:
            result["timescaledb_available"] = True
            result["extension_version"] = ext_row[1]

            # Query TimescaleDB information schema for hypertables
            ht_rows = c.execute("""
                SELECT 
                    hypertable_schema, 
                    hypertable_name, 
                    num_dimensions, 
                    num_chunks, 
                    compression_enabled 
                FROM timescaledb_information.hypertables
                ORDER BY hypertable_name
            """).fetchall()

            for r in ht_rows:
                result["hypertables"].append({
                    "schema": r[0],
                    "table": r[1],
                    "num_dimensions": r[2],
                    "num_chunks": r[3],
                    "compression_enabled": bool(r[4])
                })
    except Exception as e:
        logger.warning(f"Error querying TimescaleDB metadata: {e}")
        result["error"] = str(e)

    return result


def run_postgres_migration_test(database_url: str = None):
    """Verify migrations on PostgreSQL on both a fresh schema and a legacy pre-existing schema."""
    import os
    import psycopg
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
        assert fresh_versions == [1, 2, 3, 4, 5], f"Expected all migrations [1, 2, 3, 4, 5], got {fresh_versions}"

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
            cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());")
            cur.execute("INSERT INTO schema_migrations (version, name) VALUES (1, '001_core_schema');")
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
        assert legacy_versions == [1, 2, 3, 4, 5], f"Expected [1, 2, 3, 4, 5], got {legacy_versions}"

        # Verify existing data is preserved
        with raw_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM quotes WHERE source = 'DEMO';")
            cnt = cur.fetchone()[0]
            assert cnt >= 1, "Legacy data missing after migration"
            cur.execute("SELECT bid, ask FROM quotes WHERE source = 'DEMO' LIMIT 1;")
            row = cur.fetchone()
            assert float(row[0]) == 2600.0 and float(row[1]) == 2600.3, f"Corrupted data: {row}"
            cur.execute("DROP SCHEMA IF EXISTS legacy_schema_test CASCADE;")
            cur.execute("SET search_path TO public;")

