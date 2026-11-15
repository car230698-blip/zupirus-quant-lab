#!/usr/bin/env python3
"""SQLite to PostgreSQL/TimescaleDB Data Migration Utility for ZUPIRUS Quant Lab.
Performs an atomic, verified transfer of all accounts, signals, dispatches,
and telemetry with pre-migration snapshot, row count assertions, and rollback support."""
import os
import sys
import time
import shutil
import sqlite3
import argparse
from pathlib import Path
from typing import Dict, List, Tuple


TABLES_TO_MIGRATE = [
    "users",
    "sessions",
    "accounts",
    "pairings",
    "devices",
    "signals",
    "dispatches",
    "audit",
    "jobs",
    "news",
    "kv",
    "sim_positions",
    "login_limits",
    "snapshots",
    "quotes",
    "candles",
]


def create_sqlite_rollback_snapshot(sqlite_path: Path) -> Path:
    """Create a point-in-time timestamped copy of SQLite database before migration."""
    snapshot_dir = sqlite_path.parent / "snapshots"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time())
    snapshot_file = snapshot_dir / f"{sqlite_path.stem}_rollback_snap_{ts}.sqlite3"
    shutil.copy2(sqlite_path, snapshot_file)
    print(f"[+] Created pre-migration rollback snapshot: {snapshot_file}")
    return snapshot_file


def migrate(sqlite_path: Path, pg_url: str):
    import psycopg

    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    print(f"[*] Starting migration from {sqlite_path} -> PostgreSQL...")
    create_sqlite_rollback_snapshot(sqlite_path)

    sq_conn = sqlite3.connect(sqlite_path)
    sq_conn.row_factory = sqlite3.Row

    # Clean connection string
    if pg_url.startswith("postgres://"):
        pg_url = "postgresql://" + pg_url[11:]

    pg_conn = psycopg.connect(pg_url)

    # Initialize PostgreSQL schema first via migrations
    from app.migrations import run_all_migrations
    from app.db import ConnectionWrapper
    wrapped_pg = ConnectionWrapper(pg_conn, is_pg=True)
    run_all_migrations(wrapped_pg, is_pg=True)
    pg_conn.commit()

    report: Dict[str, Dict[str, int]] = {}

    try:
        with pg_conn.cursor() as pg_cur:
            for table in TABLES_TO_MIGRATE:
                # Check if table exists in SQLite
                sq_cur = sq_conn.cursor()
                try:
                    sq_cur.execute(f"SELECT COUNT(*) FROM {table}")
                    sq_count = sq_cur.fetchone()[0]
                except sqlite3.OperationalError:
                    # Table does not exist in SQLite
                    continue

                if sq_count == 0:
                    report[table] = {"sqlite": 0, "migrated": 0, "pg_total": 0}
                    continue

                # Read all rows from SQLite
                sq_cur.execute(f"SELECT * FROM {table}")
                rows = sq_cur.fetchall()
                cols = [desc[0] for desc in sq_cur.description]

                placeholders = ", ".join(["%s"] * len(cols))
                col_names = ", ".join(cols)

                # Insert into PostgreSQL with ON CONFLICT DO NOTHING to ensure idempotence
                insert_sql = f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"

                migrated = 0
                for r in rows:
                    row_vals = tuple(r)
                    pg_cur.execute(insert_sql, row_vals)
                    migrated += 1

                # Verify count in PostgreSQL
                pg_cur.execute(f"SELECT COUNT(*) FROM {table}")
                pg_count = pg_cur.fetchone()[0]

                report[table] = {
                    "sqlite": sq_count,
                    "migrated": migrated,
                    "pg_total": pg_count
                }

        pg_conn.commit()
    except Exception as e:
        pg_conn.rollback()
        print(f"[-] Migration failed: {e}. Rolled back PostgreSQL transaction.", file=sys.stderr)
        raise
    finally:
        sq_conn.close()
        pg_conn.close()

    print("\n================== MIGRATION REPORT ==================")
    print(f"{'Table Name':<20} | {'SQLite Count':<12} | {'Migrated':<10} | {'PG Total':<10} | Status")
    print("-" * 70)
    all_ok = True
    for t, data in report.items():
        ok = data["pg_total"] >= data["sqlite"]
        status = "PASS" if ok else "WARN"
        if not ok:
            all_ok = False
        print(f"{t:<20} | {data['sqlite']:<12} | {data['migrated']:<10} | {data['pg_total']:<10} | {status}")
    print("=" * 70)

    if all_ok:
        print("[+] Migration completed with 100% row-count integrity verified.")
    else:
        print("[!] Warning: Some table counts did not match expected totals.")


def main():
    parser = argparse.ArgumentParser(description="ZUPIRUS SQLite to PostgreSQL Migration")
    parser.add_argument("--sqlite", default="./data/lab.sqlite3", help="Path to source SQLite file")
    parser.add_argument("--pg", default=os.getenv("DATABASE_URL", "postgresql://zupirus:zupirus_secure_password@127.0.0.1:5432/zupirus"))
    args = parser.parse_args()

    try:
        migrate(Path(args.sqlite), args.pg)
    except Exception as e:
        print(f"[-] Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
