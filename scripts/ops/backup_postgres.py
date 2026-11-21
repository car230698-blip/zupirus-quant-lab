#!/usr/bin/env python3
"""Create a checked PostgreSQL archive without publishing partial dumps."""
import argparse
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from postgres_tools import run


def backup(database_url: str | None, output_dir: Path, database: str | None = None):
    output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%fZ")
    archive = output_dir / f"zupirus_pg_backup_{timestamp}.dump"
    with tempfile.NamedTemporaryFile(dir=output_dir, prefix=".backup-", delete=False) as output:
        temporary = Path(output.name)
        try:
            run("pg_dump", "--format=custom", "--no-owner", "--no-acl",
                database_url=database_url, database=database, stdout=output)
            output.flush()
            with temporary.open("rb") as contents:
                run("pg_restore", "--list", database_url=database_url, database=database,
                    stdin=contents, stdout=subprocess.DEVNULL)
            os.replace(temporary, archive)
        finally:
            temporary.unlink(missing_ok=True)
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--database", help="Database name inside the Compose service")
    parser.add_argument("--out", "--output", dest="out", default="./backups")
    args = parser.parse_args()
    try:
        print(backup(args.url, Path(args.out), args.database))
    except Exception as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
