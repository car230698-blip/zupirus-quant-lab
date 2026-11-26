#!/usr/bin/env python3
"""Restore a PostgreSQL archive into an empty TimescaleDB database."""
import argparse
import gzip
import os
import shutil
import subprocess
import tempfile
import sys
from pathlib import Path

from postgres_tools import run


def restore(database_url: str | None, backup_file: Path, database: str | None = None, clean: bool = False):
    legacy_sql = backup_file.name.endswith(".sql.gz")
    with backup_file.open("rb") as contents:
        if legacy_sql:
            if contents.read(2) != b"\x1f\x8b":
                raise ValueError("Expected a gzip-compressed PostgreSQL SQL dump.")
        else:
            run("pg_restore", "--list", stdin=contents, stdout=subprocess.DEVNULL,
                **dict(database_url=database_url, database=database or "postgres"))

    # When clean rollback is requested on a Compose database, use a safe staging database
    # to guarantee the serving database and its schema are never dropped if restore fails.
    if clean and database and not database_url:
        staging_db = f"{database}_staging_restore"
        admin_target = dict(database_url=None, database="postgres")

        def admin_query(sql):
            return run("psql", "--no-psqlrc", "--no-align", "--tuples-only",
                       "--set=ON_ERROR_STOP=1", "--command", sql,
                       stdout=subprocess.PIPE, text=True, **admin_target).stdout.strip()

        print(f"Creating isolated staging database {staging_db} for verified rollback restore...")
        admin_query(f"""
            SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{staging_db}' AND pid <> pg_backend_pid();
            DROP DATABASE IF EXISTS {staging_db};
            CREATE DATABASE {staging_db};
        """)

        staging_target = dict(database_url=None, database=staging_db)

        def staging_query(sql):
            return run("psql", "--no-psqlrc", "--no-align", "--tuples-only",
                       "--set=ON_ERROR_STOP=1", "--command", sql,
                       stdout=subprocess.PIPE, text=True, **staging_target).stdout.strip()

        staging_query("CREATE EXTENSION IF NOT EXISTS timescaledb")
        staging_query("SELECT timescaledb_pre_restore()")
        try:
            if legacy_sql:
                with gzip.open(backup_file, "rb") as compressed, tempfile.TemporaryFile() as plain:
                    shutil.copyfileobj(compressed, plain)
                    plain.seek(0)
                    run("psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--single-transaction",
                        "--file=-", stdin=plain, **staging_target)
            else:
                with backup_file.open("rb") as contents:
                    run("pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
                        stdin=contents, **staging_target)
        except Exception:
            print(f"Restore into staging database {staging_db} failed! Preserving active database {database} untouched.", file=sys.stderr)
            try:
                admin_query(f"DROP DATABASE IF EXISTS {staging_db};")
            except Exception:
                pass
            raise
        finally:
            try:
                staging_query("SELECT timescaledb_post_restore()")
            except Exception:
                pass

        # Verify restored schema integrity in staging before promoting
        table_count = int(staging_query("SELECT count(*) FROM pg_tables WHERE schemaname = 'public';") or "0")
        if table_count == 0:
            admin_query(f"DROP DATABASE IF EXISTS {staging_db};")
            raise RuntimeError(f"Restored staging database {staging_db} contains 0 public tables! Aborting swap.")

        print(f"Staging database verified with {table_count} public tables. Executing atomic swap to {database}...")
        admin_query(f"""
            SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{database}' AND pid <> pg_backend_pid();
            DROP DATABASE IF EXISTS {database}_old_failed;
            ALTER DATABASE {database} RENAME TO {database}_old_failed;
            ALTER DATABASE {staging_db} RENAME TO {database};
            DROP DATABASE IF EXISTS {database}_old_failed;
        """)
        return

    # Direct database restore path (for fresh databases or custom URL)
    target = dict(database_url=database_url, database=database)

    def query(sql):
        return run("psql", "--no-psqlrc", "--no-align", "--tuples-only",
                   "--set=ON_ERROR_STOP=1", "--command", sql,
                   stdout=subprocess.PIPE, text=True, **target).stdout.strip()

    if clean:
        query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;")

    occupied = query("""
        SELECT EXISTS (
            SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
              AND n.nspname !~ '^_timescaledb_' AND n.nspname <> 'timescaledb_information'
              AND c.relkind IN ('r', 'p', 'm', 'S')
              AND NOT EXISTS (
                  SELECT FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
              )
        )
    """)
    if occupied != "f":
        raise RuntimeError("Restore target already contains data structures. Use a fresh database or pass --clean.")

    query("CREATE EXTENSION IF NOT EXISTS timescaledb")
    query("SELECT timescaledb_pre_restore()")
    try:
        if legacy_sql:
            with gzip.open(backup_file, "rb") as compressed, tempfile.TemporaryFile() as plain:
                shutil.copyfileobj(compressed, plain)
                plain.seek(0)
                run("psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--single-transaction",
                    "--file=-", stdin=plain, **target)
        else:
            with backup_file.open("rb") as contents:
                run("pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
                    stdin=contents, **target)
    finally:
        query("SELECT timescaledb_post_restore()")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--database", help="Empty target database inside the Compose service")
    parser.add_argument("--backup", "--file", dest="backup", required=True)
    parser.add_argument("--clean", action="store_true", help="Drop existing public schema before restore to allow in-place rollbacks")
    args = parser.parse_args()
    if not (args.url or args.database):
        parser.error("Set --database for the empty Compose target, or select it with --url.")
    try:
        restore(args.url, Path(args.backup), args.database, clean=args.clean)
    except Exception as exc:
        print(f"Restore failed: {exc}", file=sys.stderr)
        return 1
    print("Restore completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
