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


def restore(database_url: str | None, backup_file: Path, database: str | None = None):
    target = dict(database_url=database_url, database=database)

    def query(sql):
        return run("psql", "--no-psqlrc", "--no-align", "--tuples-only",
                   "--set=ON_ERROR_STOP=1", "--command", sql,
                   stdout=subprocess.PIPE, text=True, **target).stdout.strip()

    legacy_sql = backup_file.name.endswith(".sql.gz")
    with backup_file.open("rb") as contents:
        if legacy_sql:
            if contents.read(2) != b"\x1f\x8b":
                raise ValueError("Expected a gzip-compressed PostgreSQL SQL dump.")
        else:
            run("pg_restore", "--list", stdin=contents, stdout=subprocess.DEVNULL, **target)

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
        raise RuntimeError("Restore target already contains data structures. Use a fresh database.")

    query("CREATE EXTENSION IF NOT EXISTS timescaledb")
    query("SELECT timescaledb_pre_restore()")
    try:
        if legacy_sql:
            # Decompress in Python before passing bytes to psql. A gzip error must fail the restore.
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
    args = parser.parse_args()
    if not (args.url or args.database):
        parser.error("Set --database for the empty Compose target, or select it with --url.")
    try:
        restore(args.url, Path(args.backup), args.database)
    except Exception as exc:
        print(f"Restore failed: {exc}", file=sys.stderr)
        return 1
    print("Restore completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
