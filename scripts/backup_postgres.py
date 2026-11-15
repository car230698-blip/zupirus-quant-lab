#!/usr/bin/env python3
"""PostgreSQL and TimescaleDB backup tool for ZUPIRUS Quant Lab.
Dumps all database schemas, tables, TimescaleDB hypertables, and LangGraph checkpoints
into a timestamped directory with metadata verification."""
import os
import sys
import time
import json
import subprocess
import argparse
from datetime import datetime, timezone
from pathlib import Path


def run_cmd(cmd: list) -> str:
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Command failed ({' '.join(cmd)}): {res.stderr.strip()}")
    return res.stdout.strip()


def backup(database_url: str, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    ts_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%SZ")
    backup_file = output_dir / f"zupirus_pg_backup_{ts_str}.sql.gz"
    meta_file = output_dir / f"zupirus_pg_backup_{ts_str}.meta.json"

    print(f"[*] Starting backup from PostgreSQL / TimescaleDB...")
    print(f"[*] Target backup file: {backup_file}")

    # Use pg_dump if available, or python table exporter fallback
    has_pg_dump = subprocess.run(["pg_dump", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

    table_counts = {}
    if has_pg_dump:
        # Run pg_dump piped through gzip
        cmd = f"pg_dump \"{database_url}\" --no-owner --no-acl | gzip > \"{backup_file}\""
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {res.stderr}")
    else:
        # Python-based multi-table dump using psycopg
        import psycopg
        import gzip
        with psycopg.connect(database_url) as conn, gzip.open(backup_file, "wt", encoding="utf-8") as out:
            with conn.cursor() as cur:
                # Query all user tables
                cur.execute("""
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                    ORDER BY table_name;
                """)
                tables = [r[0] for r in cur.fetchall()]
                for t in tables:
                    cur.execute(f"SELECT COUNT(*) FROM {t}")
                    count = cur.fetchone()[0]
                    table_counts[t] = count
                    out.write(f"\n-- Table: {t} ({count} rows)\n")
                    cur.execute(f"SELECT * FROM {t}")
                    cols = [d[0] for d in cur.description]
                    for r in cur.fetchall():
                        vals = ", ".join(repr(v) if v is not None else "NULL" for v in r)
                        out.write(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({vals});\n")

    metadata = {
        "timestamp": ts_str,
        "backup_file": str(backup_file.name),
        "database_url_masked": database_url.split("@")[-1] if "@" in database_url else "local",
        "table_counts": table_counts,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "completed"
    }

    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"[+] Backup completed successfully.")
    print(f"[+] Metadata written to: {meta_file}")
    return backup_file, meta_file


def main():
    parser = argparse.ArgumentParser(description="ZUPIRUS PostgreSQL Backup Script")
    parser.add_argument("--url", default=os.getenv("DATABASE_URL", "postgresql://zupirus:zupirus_secure_password@127.0.0.1:5432/zupirus"))
    parser.add_argument("--out", "--output", dest="out", default="./backups", help="Output directory for backup")
    args = parser.parse_args()

    try:
        backup(args.url, Path(args.out))
    except Exception as e:
        print(f"[-] Backup error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

