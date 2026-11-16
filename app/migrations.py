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
    },
    {
        "version": 7,
        "name": "007_sepay_payment_transactions",
        "description": "SePay banking payment transactions log and subscription activation records"
    },
    {
        "version": 8,
        "name": "008_legal_disclaimers_and_real_accounts",
        "description": "High-risk trading terms of service disclaimers and gated real MT5 accounts isolation"
    },
    {
        "version": 9,
        "name": "009_metaapi_cloud_execution",
        "description": "Direct-to-User cloud execution engine without EAs, encrypted credentials and fan-out trade logging"
    },
    {
        "version": 10,
        "name": "010_standardize_trading_accounts_and_cloud_metaapi",
        "description": "Standardize trading_accounts model for 100% MetaApi Cloud Execution and drop legacy EA pairing tables"
    },
    {
        "version": 11,
        "name": "011_subscriptions_orders_and_signal_audit_logs",
        "description": "Subscriptions, SePay orders with locked FX rate, signal audit logs, and cloud slots management"
    },
    {
        "version": 12,
        "name": "012_tabula_rasa_learning_snapshots",
        "description": "Add market context snapshot and MAE/MFE to signal_audit_logs, create strategy_candidates table"
    },
    {
        "version": 13,
        "name": "013_multi_source_curator_and_broker_mapping",
        "description": "Signal sources curator funnel, shadow signals ledger, broker symbol auto-discovery, and cent/ecn account classification"
    },
    {
        "version": 14,
        "name": "014_dynamic_agent_skill_registry",
        "description": "Dynamic agent skill registry, core analytical skills, and self-learned skills persistence"
    },
    {
        "version": 15,
        "name": "015_add_ticket_to_executions",
        "description": "Ensure ticket column exists in metaapi_trade_executions"
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


def apply_migration_007(c, is_pg: bool):
    """Create payment_transactions table for SePay webhook logs."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS payment_transactions (
            id TEXT PRIMARY KEY,
            sepay_id TEXT UNIQUE,
            user_id TEXT,
            amount DOUBLE PRECISION NOT NULL,
            currency TEXT NOT NULL DEFAULT 'VND',
            gateway TEXT,
            content TEXT,
            reference_code TEXT,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_transactions(user_id);
        CREATE INDEX IF NOT EXISTS idx_payment_created ON payment_transactions(created_at DESC);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS payment_transactions (
            id TEXT PRIMARY KEY,
            sepay_id TEXT UNIQUE,
            user_id TEXT,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'VND',
            gateway TEXT,
            content TEXT,
            reference_code TEXT,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_transactions(user_id);
        CREATE INDEX IF NOT EXISTS idx_payment_created ON payment_transactions(created_at DESC);
        """)


def apply_migration_008(c, is_pg: bool):
    """Create legal_disclaimers and real_accounts tables for terms compliance and real MT5 accounts."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS legal_disclaimers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            terms_version TEXT NOT NULL,
            accepted_at DOUBLE PRECISION NOT NULL,
            ip_address TEXT,
            signature_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE INDEX IF NOT EXISTS idx_disclaimer_user ON legal_disclaimers(user_id);

        CREATE TABLE IF NOT EXISTS real_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            mode TEXT NOT NULL DEFAULT 'REAL',
            enabled INTEGER NOT NULL DEFAULT 0,
            risk DOUBLE PRECISION NOT NULL DEFAULT 0.01,
            max_spread DOUBLE PRECISION NOT NULL DEFAULT 0.8,
            max_positions INTEGER NOT NULL DEFAULT 1,
            max_dd DOUBLE PRECISION NOT NULL DEFAULT 5.0,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            equity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            peak DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            seen DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_real_acc_user ON real_accounts(user_id);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS legal_disclaimers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            terms_version TEXT NOT NULL,
            accepted_at REAL NOT NULL,
            ip_address TEXT,
            signature_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE INDEX IF NOT EXISTS idx_disclaimer_user ON legal_disclaimers(user_id);

        CREATE TABLE IF NOT EXISTS real_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            mode TEXT NOT NULL DEFAULT 'REAL',
            enabled INTEGER NOT NULL DEFAULT 0,
            risk REAL NOT NULL DEFAULT 0.01,
            max_spread REAL NOT NULL DEFAULT 0.8,
            max_positions INTEGER NOT NULL DEFAULT 1,
            max_dd REAL NOT NULL DEFAULT 5.0,
            balance REAL NOT NULL DEFAULT 0.0,
            equity REAL NOT NULL DEFAULT 0.0,
            peak REAL NOT NULL DEFAULT 0.0,
            seen REAL NOT NULL DEFAULT 0.0,
            created_at REAL NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_real_acc_user ON real_accounts(user_id);
        """)


def apply_migration_009(c, is_pg: bool):
    """Create metaapi_cloud_accounts and metaapi_trade_executions tables for Direct-to-User cloud execution."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS metaapi_cloud_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'mt5',
            account_name TEXT,
            metaapi_account_id TEXT,
            metaapi_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            risk_percent DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            max_lot DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            equity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            currency TEXT NOT NULL DEFAULT 'USD',
            encrypted_password TEXT,
            last_sync DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_acc_user ON metaapi_cloud_accounts(user_id);

        CREATE TABLE IF NOT EXISTS metaapi_trade_executions (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            account_id TEXT REFERENCES metaapi_cloud_accounts(id),
            metaapi_account_id TEXT,
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            action TEXT NOT NULL,
            volume DOUBLE PRECISION NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            sl DOUBLE PRECISION,
            tp DOUBLE PRECISION,
            position_id TEXT,
            order_id TEXT,
            status TEXT NOT NULL,
            latency_ms INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            executed_at DOUBLE PRECISION NOT NULL,
            closed_at DOUBLE PRECISION,
            profit DOUBLE PRECISION,
            UNIQUE(signal_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_sig ON metaapi_trade_executions(signal_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_acc ON metaapi_trade_executions(account_id);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS metaapi_cloud_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'mt5',
            account_name TEXT,
            metaapi_account_id TEXT,
            metaapi_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            risk_percent REAL NOT NULL DEFAULT 1.0,
            max_lot REAL NOT NULL DEFAULT 1.0,
            multiplier REAL NOT NULL DEFAULT 1.0,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance REAL NOT NULL DEFAULT 0.0,
            equity REAL NOT NULL DEFAULT 0.0,
            currency TEXT NOT NULL DEFAULT 'USD',
            encrypted_password TEXT,
            last_sync REAL NOT NULL DEFAULT 0.0,
            created_at REAL NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_acc_user ON metaapi_cloud_accounts(user_id);

        CREATE TABLE IF NOT EXISTS metaapi_trade_executions (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            account_id TEXT REFERENCES metaapi_cloud_accounts(id),
            metaapi_account_id TEXT,
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            action TEXT NOT NULL,
            volume REAL NOT NULL,
            entry_price REAL NOT NULL,
            sl REAL,
            tp REAL,
            position_id TEXT,
            order_id TEXT,
            status TEXT NOT NULL,
            latency_ms INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            executed_at REAL NOT NULL,
            closed_at REAL,
            profit REAL,
            UNIQUE(signal_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_sig ON metaapi_trade_executions(signal_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_acc ON metaapi_trade_executions(account_id);
        """)


def apply_migration_010(c, is_pg: bool):
    """Migration 010: Standardize trading_accounts table for MetaApi Cloud and remove obsolete EA pairing tables."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS trading_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            mt5_login TEXT NOT NULL,
            encrypted_master_password TEXT NOT NULL,
            broker_server TEXT NOT NULL,
            metaapi_account_id TEXT,
            deployment_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            risk_config TEXT NOT NULL DEFAULT '{"risk_percent": 1.0, "max_lot": 1.0, "multiplier": 1.0}',
            subscription_expires_at DOUBLE PRECISION,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            equity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            last_sync DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            UNIQUE(mt5_login, broker_server)
        );
        CREATE INDEX IF NOT EXISTS idx_trading_acc_user ON trading_accounts(user_id);
        DROP TABLE IF EXISTS pairings;
        DROP TABLE IF EXISTS devices;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS trading_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            mt5_login TEXT NOT NULL,
            encrypted_master_password TEXT NOT NULL,
            broker_server TEXT NOT NULL,
            metaapi_account_id TEXT,
            deployment_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            risk_config TEXT NOT NULL DEFAULT '{"risk_percent": 1.0, "max_lot": 1.0, "multiplier": 1.0}',
            subscription_expires_at REAL,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance REAL NOT NULL DEFAULT 0.0,
            equity REAL NOT NULL DEFAULT 0.0,
            created_at REAL NOT NULL,
            last_sync REAL NOT NULL DEFAULT 0.0,
            UNIQUE(mt5_login, broker_server)
        );
        CREATE INDEX IF NOT EXISTS idx_trading_acc_user ON trading_accounts(user_id);
        DROP TABLE IF EXISTS pairings;
        DROP TABLE IF EXISTS devices;
        """)


def apply_migration_011(c, is_pg: bool):
    """Migration 011: Add subscriptions, orders with locked FX rate, signal audit logs, and cloud slot columns."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) UNIQUE,
            plan_tier TEXT NOT NULL DEFAULT 'starter',
            service_expires_at DOUBLE PRECISION,
            max_mt5_accounts INTEGER NOT NULL DEFAULT 1,
            allow_custom_multiplier INTEGER NOT NULL DEFAULT 0,
            allow_compounding INTEGER NOT NULL DEFAULT 0,
            allow_partial_tp_be INTEGER NOT NULL DEFAULT 0,
            allow_prop_firm_mode INTEGER NOT NULL DEFAULT 0,
            allow_alpha_strategies INTEGER NOT NULL DEFAULT 0,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            amount_usd DOUBLE PRECISION NOT NULL,
            locked_exchange_rate DOUBLE PRECISION NOT NULL,
            amount_vnd BIGINT NOT NULL,
            plan_tier TEXT NOT NULL,
            cloud_slots_count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'PENDING',
            payment_gateway TEXT NOT NULL DEFAULT 'SEPAY',
            sepay_transaction_id TEXT,
            created_at DOUBLE PRECISION NOT NULL,
            expires_at DOUBLE PRECISION NOT NULL,
            paid_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

        CREATE TABLE IF NOT EXISTS signal_audit_logs (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            strategy_tier TEXT NOT NULL DEFAULT 'STANDARD',
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            side TEXT NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            stop_loss DOUBLE PRECISION,
            take_profit DOUBLE PRECISION,
            raw_payload TEXT,
            status TEXT NOT NULL,
            reject_reason TEXT,
            pnl DOUBLE PRECISION,
            created_at DOUBLE PRECISION NOT NULL,
            processed_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_sig_audit_created ON signal_audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sig_audit_status ON signal_audit_logs(status);

        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS cloud_expires_at DOUBLE PRECISION;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS risk_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS is_compounding INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS is_prop_firm_mode INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS prop_daily_dd_limit_pct DOUBLE PRECISION NOT NULL DEFAULT 4.5;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS prop_profit_target_pct DOUBLE PRECISION NOT NULL DEFAULT 8.0;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS ticket TEXT;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) UNIQUE,
            plan_tier TEXT NOT NULL DEFAULT 'starter',
            service_expires_at REAL,
            max_mt5_accounts INTEGER NOT NULL DEFAULT 1,
            allow_custom_multiplier INTEGER NOT NULL DEFAULT 0,
            allow_compounding INTEGER NOT NULL DEFAULT 0,
            allow_partial_tp_be INTEGER NOT NULL DEFAULT 0,
            allow_prop_firm_mode INTEGER NOT NULL DEFAULT 0,
            allow_alpha_strategies INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            amount_usd REAL NOT NULL,
            locked_exchange_rate REAL NOT NULL,
            amount_vnd INTEGER NOT NULL,
            plan_tier TEXT NOT NULL,
            cloud_slots_count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'PENDING',
            payment_gateway TEXT NOT NULL DEFAULT 'SEPAY',
            sepay_transaction_id TEXT,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            paid_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

        CREATE TABLE IF NOT EXISTS signal_audit_logs (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            strategy_tier TEXT NOT NULL DEFAULT 'STANDARD',
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            side TEXT NOT NULL,
            entry_price REAL NOT NULL,
            stop_loss REAL,
            take_profit REAL,
            raw_payload TEXT,
            status TEXT NOT NULL,
            reject_reason TEXT,
            pnl REAL,
            created_at REAL NOT NULL,
            processed_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_sig_audit_created ON signal_audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sig_audit_status ON signal_audit_logs(status);
        """)
        for col, col_def in [
            ("cloud_expires_at", "REAL"),
            ("risk_multiplier", "REAL NOT NULL DEFAULT 1.0"),
            ("is_compounding", "INTEGER NOT NULL DEFAULT 0"),
            ("is_prop_firm_mode", "INTEGER NOT NULL DEFAULT 0"),
            ("prop_daily_dd_limit_pct", "REAL NOT NULL DEFAULT 4.5"),
            ("prop_profit_target_pct", "REAL NOT NULL DEFAULT 8.0"),
            ("ticket", "TEXT")
        ]:
            try:
                c.execute(f"ALTER TABLE trading_accounts ADD COLUMN {col} {col_def}")
            except Exception:
                pass
        try:
            c.execute("ALTER TABLE metaapi_trade_executions ADD COLUMN ticket TEXT")
        except Exception:
            pass


def apply_migration_012(c, is_pg: bool):
    """Add context_snapshot and MAE/MFE to signal_audit_logs, create strategy_candidates table."""
    if is_pg:
        c.execute("""
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS context_snapshot TEXT;
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS mae DOUBLE PRECISION;
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS mfe DOUBLE PRECISION;

        CREATE TABLE IF NOT EXISTS strategy_candidates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'DISCOVERED',
            rules_json TEXT NOT NULL,
            sample_size INTEGER NOT NULL DEFAULT 0,
            win_rate DOUBLE PRECISION,
            profit_factor DOUBLE PRECISION,
            sharpe_ratio DOUBLE PRECISION,
            max_drawdown_pct DOUBLE PRECISION,
            oos_net_units DOUBLE PRECISION,
            shadow_trades_count INTEGER NOT NULL DEFAULT 0,
            shadow_pnl DOUBLE PRECISION DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_strat_candidates_status ON strategy_candidates(status);
        """)
    else:
        for col, col_def in [
            ("context_snapshot", "TEXT"),
            ("mae", "REAL"),
            ("mfe", "REAL")
        ]:
            try:
                c.execute(f"ALTER TABLE signal_audit_logs ADD COLUMN {col} {col_def}")
            except Exception:
                pass

        c.executescript("""
        CREATE TABLE IF NOT EXISTS strategy_candidates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'DISCOVERED',
            rules_json TEXT NOT NULL,
            sample_size INTEGER NOT NULL DEFAULT 0,
            win_rate REAL,
            profit_factor REAL,
            sharpe_ratio REAL,
            max_drawdown_pct REAL,
            oos_net_units REAL,
            shadow_trades_count INTEGER NOT NULL DEFAULT 0,
            shadow_pnl REAL DEFAULT 0.0,
            created_at REAL NOT NULL,
            updated_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_strat_candidates_status ON strategy_candidates(status);
        """)


def apply_migration_013(c, is_pg: bool):
    """Multi-source curator funnel, shadow signals ledger, and broker symbol auto-discovery."""
    now_ts = time.time()
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS signal_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'SHADOW_ONLY',
            symbol_universe TEXT NOT NULL DEFAULT 'XAUUSD,EURUSD,GBPUSD,USDJPY',
            trust_score DOUBLE PRECISION NOT NULL DEFAULT 50.0,
            profit_factor DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            win_rate DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            max_drawdown_pips DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            total_signals INTEGER NOT NULL DEFAULT 0,
            evaluated_signals INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sig_sources_status ON signal_sources(status);

        CREATE TABLE IF NOT EXISTS shadow_signals (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES signal_sources(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            stop_loss DOUBLE PRECISION NOT NULL,
            take_profit DOUBLE PRECISION,
            signal_time DOUBLE PRECISION NOT NULL,
            eval_status TEXT NOT NULL DEFAULT 'PENDING',
            mae DOUBLE PRECISION,
            mfe DOUBLE PRECISION,
            exit_price DOUBLE PRECISION,
            exit_time DOUBLE PRECISION,
            exit_reason TEXT,
            pnl_pips DOUBLE PRECISION,
            context_snapshot TEXT,
            created_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_source ON shadow_signals(source_id);
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_eval ON shadow_signals(eval_status);

        CREATE TABLE IF NOT EXISTS account_symbol_map (
            account_id TEXT NOT NULL,
            standard_symbol TEXT NOT NULL,
            broker_symbol TEXT NOT NULL,
            contract_size DOUBLE PRECISION NOT NULL DEFAULT 100.0,
            tick_value DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            is_supported INTEGER NOT NULL DEFAULT 1,
            updated_at DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (account_id, standard_symbol)
        );

        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'STANDARD';
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS contract_size DOUBLE PRECISION DEFAULT 100.0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS tick_value DOUBLE PRECISION DEFAULT 1.0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS auto_be_partial_tp INTEGER DEFAULT 0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS latency_ms INTEGER DEFAULT 35;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS signal_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'SHADOW_ONLY',
            symbol_universe TEXT NOT NULL DEFAULT 'XAUUSD,EURUSD,GBPUSD,USDJPY',
            trust_score REAL NOT NULL DEFAULT 50.0,
            profit_factor REAL NOT NULL DEFAULT 1.0,
            win_rate REAL NOT NULL DEFAULT 0.5,
            max_drawdown_pips REAL NOT NULL DEFAULT 0.0,
            total_signals INTEGER NOT NULL DEFAULT 0,
            evaluated_signals INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sig_sources_status ON signal_sources(status);

        CREATE TABLE IF NOT EXISTS shadow_signals (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES signal_sources(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_price REAL NOT NULL,
            stop_loss REAL NOT NULL,
            take_profit REAL,
            signal_time REAL NOT NULL,
            eval_status TEXT NOT NULL DEFAULT 'PENDING',
            mae REAL,
            mfe REAL,
            exit_price REAL,
            exit_time REAL,
            exit_reason TEXT,
            pnl_pips REAL,
            context_snapshot TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_source ON shadow_signals(source_id);
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_eval ON shadow_signals(eval_status);

        CREATE TABLE IF NOT EXISTS account_symbol_map (
            account_id TEXT NOT NULL,
            standard_symbol TEXT NOT NULL,
            broker_symbol TEXT NOT NULL,
            contract_size REAL NOT NULL DEFAULT 100.0,
            tick_value REAL NOT NULL DEFAULT 1.0,
            is_supported INTEGER NOT NULL DEFAULT 1,
            updated_at REAL NOT NULL,
            PRIMARY KEY (account_id, standard_symbol)
        );
        """)

        for col, col_def in [
            ("account_type", "TEXT DEFAULT 'STANDARD'"),
            ("currency", "TEXT DEFAULT 'USD'"),
            ("contract_size", "REAL DEFAULT 100.0"),
            ("tick_value", "REAL DEFAULT 1.0"),
            ("auto_be_partial_tp", "INTEGER DEFAULT 0"),
            ("latency_ms", "INTEGER DEFAULT 35"),
            ("account_name", "TEXT")
        ]:
            try:
                c.execute(f"ALTER TABLE trading_accounts ADD COLUMN {col} {col_def}")
            except Exception:
                pass

    # Seed initial seed sources for Cold-Start Bootstrapping
    initial_sources = [
        ("src_tv_primary", "TradingView Webhook Primary", "tradingview_webhook", "ACTIVE_LIVE", "XAUUSD,EURUSD,GBPUSD,USDJPY", 86.5, 1.82, 0.64, 45.0, 120, 120),
        ("src_metaapi_feed", "MetaApi Demo Signal Feed", "metaapi_feed", "ACTIVE_LIVE", "XAUUSD,EURUSD", 82.0, 1.65, 0.58, 55.0, 95, 95),
        ("src_gold_momentum", "PineScript XAUUSD Trend Seeker", "pinescript_scraper", "SHADOW_ONLY", "XAUUSD", 74.0, 1.48, 0.53, 72.0, 48, 48),
        ("src_fx_breakout", "London FX Squeeze Alpha", "external_feed", "SHADOW_ONLY", "EURUSD,GBPUSD", 71.5, 1.42, 0.51, 80.0, 36, 36),
    ]

    for sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev in initial_sources:
        try:
            c.execute("""
            INSERT INTO signal_sources (
                id, name, source_type, status, symbol_universe,
                trust_score, profit_factor, win_rate, max_drawdown_pips,
                total_signals, evaluated_signals, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
            ON CONFLICT (id) DO NOTHING
            """, (sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev, now_ts, now_ts))
        except Exception:
            # SQLite pre-3.24 fallback
            try:
                c.execute("""
                INSERT OR IGNORE INTO signal_sources (
                    id, name, source_type, status, symbol_universe,
                    trust_score, profit_factor, win_rate, max_drawdown_pips,
                    total_signals, evaluated_signals, config_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
                """, (sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev, now_ts, now_ts))
            except Exception:
                pass


def apply_migration_014(c, is_pg: bool):
    """Dynamic Agent Skill Registry: creates agent_skills table and seeds 5 core analytical skills."""
    now_ts = time.time()
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS agent_skills (
            id TEXT PRIMARY KEY,
            skill_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            trigger_condition TEXT NOT NULL,
            skill_md TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled ON agent_skills(enabled);
        CREATE INDEX IF NOT EXISTS idx_agent_skills_builtin ON agent_skills(is_builtin);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS agent_skills (
            id TEXT PRIMARY KEY,
            skill_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            trigger_condition TEXT NOT NULL,
            skill_md TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled ON agent_skills(enabled);
        CREATE INDEX IF NOT EXISTS idx_agent_skills_builtin ON agent_skills(is_builtin);
        """)

    # Seed 5 core analytical skills
    core_skills = [
        (
            "sk_market_regime_scanner",
            "market_regime_scanner",
            "Market Regime Scanner (ATR & Session)",
            "Đo lường biên độ ATR(14), cấu trúc biến động và xác định phiên giao dịch (Á/Âu/Mỹ) từ nến M1/M15/H1.",
            "Khi tiếp nhận tín hiệu mới hoặc cần xác định trạng thái biến động thị trường.",
            "# Market Regime Scanner\nĐo lường ATR(14) và xác định phiên giao dịch thực tế."
        ),
        (
            "sk_liquidity_spread_auditor",
            "liquidity_spread_auditor",
            "Liquidity & Spread Auditor",
            "Đối chiếu dữ liệu tick/nến M1 và nhật ký spread để phân biệt lệnh chạm SL do sai xu hướng vs giãn spread giao phiên hoặc quét thanh khoản.",
            "Khi có lệnh chạm Stop Loss hoặc kiểm toán hiệu suất sau đóng vị thế.",
            "# Liquidity & Spread Auditor\nKiểm toán nguyên nhân lệnh chạm Stop Loss (SL): TREND_FAIL, SPREAD_SPIKE_ROLLOVER, LIQUIDITY_SWEEP."
        ),
        (
            "sk_macro_news_interpreter",
            "macro_news_interpreter",
            "Macro News Interpreter",
            "Đối chiếu lịch kinh tế USD (CPI, NFP, FOMC) quanh thời điểm mở/đóng lệnh, gắn nhãn bối cảnh vĩ mô và độ nhạy tin tức.",
            "Trước khi mở vị thế hoặc phân tích độ nhạy tin tức của nguồn tín hiệu.",
            "# Macro News Interpreter\nPhân tích khoảng cách tới sự kiện kinh tế vĩ mô USD và kích hoạt News Shield khi <=30m."
        ),
        (
            "sk_source_grading_analyst",
            "source_grading_analyst",
            "Source Grading & Trust Analyst",
            "Chấm điểm EOD M1 Candle Grader cho kho SHADOW_ONLY (quy tắc bảo thủ SL ưu tiên), tính Profit Factor, Max Drawdown, MAE/MFE và Trust Score (0-100).",
            "Cuối ngày giao dịch (EOD) hoặc khi Admin yêu cầu xếp hạng lại các nguồn tín hiệu.",
            "# Source Grading Analyst\nChấm điểm nến M1 và cập nhật bảng xếp hạng tín nhiệm Trust Score."
        ),
        (
            "sk_strategy_synthesizer",
            "strategy_synthesizer",
            "Strategy Synthesizer & Walk-Forward Validator",
            "Truy xuất các quy tắc lặp lại từ Hindsight Semantic Memory, tổng hợp Ứng viên Chiến lược và chạy kiểm định Out-of-Sample trên TimescaleDB trước khi gửi Admin phê duyệt.",
            "Khi tích lũy đủ cụm lệnh thắng/thua hoặc định kỳ tổng hợp chiến lược mới.",
            "# Strategy Synthesizer\nĐóng gói cụm quy tắc từ Hindsight Memory thành Ứng viên Chiến lược mới."
        ),
    ]

    for sid, skid, sname, sdesc, strig, smd in core_skills:
        try:
            c.execute("""
            INSERT INTO agent_skills (
                id, skill_id, name, description, trigger_condition,
                skill_md, is_builtin, usage_count, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
            ON CONFLICT (skill_id) DO NOTHING
            """, (sid, skid, sname, sdesc, strig, smd, now_ts, now_ts))
        except Exception:
            try:
                c.execute("""
                INSERT OR IGNORE INTO agent_skills (
                    id, skill_id, name, description, trigger_condition,
                    skill_md, is_builtin, usage_count, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
                """, (sid, skid, sname, sdesc, strig, smd, now_ts, now_ts))
            except Exception:
                pass


def apply_migration_015(c, is_pg: bool):
    """Migration 015: Ensure ticket column exists in metaapi_trade_executions."""
    if is_pg:
        c.execute("ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS ticket TEXT;")
    else:
        try:
            c.execute("ALTER TABLE metaapi_trade_executions ADD COLUMN ticket TEXT")
        except Exception:
            pass


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
        7: apply_migration_007,
        8: apply_migration_008,
        9: apply_migration_009,
        10: apply_migration_010,
        11: apply_migration_011,
        12: apply_migration_012,
        13: apply_migration_013,
        14: apply_migration_014,
        15: apply_migration_015,
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
        assert fresh_versions == list(range(1, 14)), f"Expected all migrations 1..13, got {fresh_versions}"

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
        assert legacy_versions == list(range(1, 14)), f"Expected 1..13, got {legacy_versions}"

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

