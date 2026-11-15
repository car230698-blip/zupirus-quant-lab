#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +"%Y%m%d_%H%M%SZ")
BACKUP_FILE="$BACKUP_DIR/zupirus_pg_backup_${TS}.sql.gz"

echo "[*] Running pg_dump to $BACKUP_FILE..."
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_FILE"
else
  docker compose exec -T timescaledb pg_dump -U zupirus zupirus --no-owner --no-acl | gzip > "$BACKUP_FILE"
fi

echo "[+] PostgreSQL backup completed: $BACKUP_FILE"

