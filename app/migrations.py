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
            created DOUBLE PRECISION NOT NULL,
            updated DOUBLE PRECISION NOT NULL,
            UNIQUE(account_id, signal_id)
        );
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
        CREATE TABLE IF NOT EXISTS dispatches(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT REFERENCES accounts(id),signal_id TEXT REFERENCES signals(id),state TEXT NOT NULL DEFAULT 'queued',nonce TEXT,ticket TEXT,deal TEXT,reason TEXT,created REAL NOT NULL,updated REAL NOT NULL,UNIQUE(account_id,signal_id));
        CREATE UNIQUE INDEX IF NOT EXISTS unique_deal ON dispatches(account_id,deal) WHERE deal IS NOT NULL AND deal != '';
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts REAL NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,decision INTEGER,result TEXT,error TEXT,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,title TEXT NOT NULL,currency TEXT NOT NULL,impact TEXT NOT NULL,ts REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sim_positions(dispatch_id INTEGER PRIMARY KEY REFERENCES dispatches(id),account_id TEXT REFERENCES accounts(id),side TEXT NOT NULL,entry REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,lots REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,until REAL NOT NULL);
        """)


def apply_migration_002(c, is_pg: bool):
    """Migration 002: Partition-compatible quotes and candles schemas with TimescaleDB hypertables."""
    if is_pg:
        # Check if quotes table exists before attempting to alter constraints
        reg = c.execute("SELECT to_regclass('public.quotes')").fetchone()
        if reg and reg[0] is not None:
            try:
                c.execute("ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_source_ts_key;")
                c.execute("ALTER TABLE quotes DROP CONSTRAINT IF EXISTS uq_quotes_old;")
            except Exception:
                pass

        c.execute("""
        CREATE TABLE IF NOT EXISTS quotes (
            time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            source TEXT NOT NULL,
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            ts DOUBLE PRECISION NOT NULL,
            bid DOUBLE PRECISION NOT NULL,
            ask DOUBLE PRECISION NOT NULL,
            CONSTRAINT uq_quotes UNIQUE (time, source, ts)
        );
        CREATE TABLE IF NOT EXISTS candles (
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
            time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            account_id TEXT REFERENCES accounts(id),
            ts DOUBLE PRECISION NOT NULL,
            balance DOUBLE PRECISION NOT NULL,
            equity DOUBLE PRECISION NOT NULL
        );
        """)

        # Attempt to create TimescaleDB hypertables if extension is active
        for table, time_col in [("quotes", "time"), ("candles", "time"), ("snapshots", "time")]:
            try:
                c.execute(f"SELECT create_hypertable('{table}', '{time_col}', if_not_exists => TRUE);")
            except Exception as e:
                logger.debug(f"TimescaleDB create_hypertable skipped for {table}: {e}")
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


def run_all_migrations(c, is_pg: bool):
    """Run all pending migrations in order."""
    ensure_migration_table(c, is_pg)
    applied = set(get_applied_versions(c))

    handlers = {
        1: apply_migration_001,
        2: apply_migration_002,
        3: apply_migration_003,
        4: apply_migration_004,
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
