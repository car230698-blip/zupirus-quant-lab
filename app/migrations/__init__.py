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
    },
    {
        "version": 16,
        "name": "016_architecture_isolation_locks_and_billing_states",
        "description": "Isolate Hindsight memories by user_id/scope, add signal_dispatch_locks, add orders UNDERPAID/entitlement/cloud states, and remove master feed source"
    },
    {
        "version": 17,
        "name": "017_prop_stage_classification",
        "description": "Add prop_stage (CHALLENGE vs LIVE) to trading_accounts for Prop Firm Live risk caps"
    },
    {
        "version": 18,
        "name": "018_dispatches_volume_and_closed_at",
        "description": "Add volume, closed_at, and profit columns to dispatches table for soft-closing and accurate lot display"
    },
    {
        "version": 19,
        "name": "019_knowledge_chunks_rag",
        "description": "Semantic RAG knowledge_chunks table with pgvector support and hybrid fallback"
    },
    {
        "version": 20,
        "name": "020_notifications_system",
        "description": "In-App notification storage with user, role, severity, and read tracking"
    },
    {
        "version": 21,
        "name": "021_trading_accounts_allowed_strategies",
        "description": "Multi-strategy allocation column for Growth & Alpha tiers"
    }
]


from .core import (
    ensure_migration_table, get_applied_versions,
    apply_migration_001, apply_migration_002, apply_migration_003,
    apply_migration_004, apply_migration_005, apply_migration_006, apply_migration_007,
)
from .evolution import (
    apply_migration_008, apply_migration_009, apply_migration_010,
    apply_migration_011, apply_migration_012,
)
from .seed_and_fixes import (
    apply_migration_013, apply_migration_014, apply_migration_015,
    apply_migration_016, apply_migration_017, apply_migration_018,
    apply_migration_019, apply_migration_020, apply_migration_021,
)

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
        16: apply_migration_016,
        17: apply_migration_017,
        18: apply_migration_018,
        19: apply_migration_019,
        20: apply_migration_020,
        21: apply_migration_021,
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
        assert fresh_versions == list(range(1, 18)), f"Expected all migrations 1..17, got {fresh_versions}"

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
        assert legacy_versions == list(range(1, 18)), f"Expected 1..17, got {legacy_versions}"

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

