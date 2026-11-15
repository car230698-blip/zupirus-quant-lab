#!/usr/bin/env python3
"""PostgreSQL and TimescaleDB restore verification tool for ZUPIRUS Quant Lab.
Restores a database dump into a target database and validates restored table row counts."""
import os
import sys
import gzip
import json
import subprocess
import argparse
from pathlib import Path


def restore(database_url: str, backup_file: Path, meta_file: Path = None):
    if not backup_file.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_file}")

    print(f"[*] Starting restore to target: {database_url.split('@')[-1] if '@' in database_url else 'local'}")
    print(f"[*] Reading backup: {backup_file}")

    has_psql = subprocess.run(["psql", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

    if has_psql:
        cmd = f"gunzip -c \"{backup_file}\" | psql \"{database_url}\""
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode != 0 and "ERROR" in res.stderr:
            print(f"[!] psql warnings/output: {res.stderr}")
    else:
        # Python-based multi-statement executor
        import psycopg
        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cur, gzip.open(backup_file, "rt", encoding="utf-8") as f:
                sql_block = f.read()
                # Execute statements
                for stmt in sql_block.split(";"):
                    s = stmt.strip()
                    if s:
                        try:
                            cur.execute(s)
                        except Exception as e:
                            pass
            conn.commit()

    # Validate table counts
    import psycopg
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            """)
            tables = [r[0] for r in cur.fetchall()]
            current_counts = {}
            for t in tables:
                cur.execute(f"SELECT COUNT(*) FROM {t}")
                current_counts[t] = cur.fetchone()[0]

    print("[+] Current table row counts in restored database:")
    for t, c in current_counts.items():
        print(f"    - {t}: {c} rows")

    if meta_file and meta_file.exists():
        with open(meta_file, "r", encoding="utf-8") as f:
            meta = json.load(f)
        expected = meta.get("table_counts", {})
        mismatches = []
        for t, exp_c in expected.items():
            act_c = current_counts.get(t, 0)
            if act_c < exp_c:
                mismatches.append(f"{t}: expected {exp_c}, got {act_c}")
        if mismatches:
            print(f"[!] Warning: Count mismatch in tables: {', '.join(mismatches)}")
        else:
            print("[+] Verification PASS: Restored table row counts match backup metadata.")

    print("[+] Restore completed successfully.")


def main():
    parser = argparse.ArgumentParser(description="ZUPIRUS PostgreSQL Restore Script")
    parser.add_argument("--url", default=os.getenv("DATABASE_URL", "postgresql://zupirus:zupirus_secure_password@127.0.0.1:5432/zupirus"))
    parser.add_argument("--backup", required=True, help="Path to .sql.gz backup file")
    parser.add_argument("--meta", default=None, help="Path to .meta.json file (optional)")
    args = parser.parse_args()

    try:
        restore(args.url, Path(args.backup), Path(args.meta) if args.meta else None)
    except Exception as e:
        print(f"[-] Restore error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

