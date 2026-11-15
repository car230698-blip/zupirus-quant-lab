#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <path_to_backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[-] File not found: $BACKUP_FILE"
  exit 1
fi

echo "[*] Restoring PostgreSQL from $BACKUP_FILE..."
if [ -n "${DATABASE_URL:-}" ]; then
  gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL"
else
  gunzip -c "$BACKUP_FILE" | docker compose exec -T timescaledb psql -U zupirus -d zupirus
fi

echo "[+] Restore completed successfully."

