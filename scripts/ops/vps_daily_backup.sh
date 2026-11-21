#!/usr/bin/env bash
# Automated daily TimescaleDB / PostgreSQL backup with gzip verification & 14-day retention.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/zupirus-quant-lab}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/zupirus}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-zupirus-prod}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/zupirus_pg_${TIMESTAMP}.sql.gz"
TMP_FILE="${OUT_FILE}.tmp"

docker compose \
  -p "$COMPOSE_PROJECT" \
  -f "$PROJECT_DIR/compose.yaml" \
  -f "$PROJECT_DIR/compose.prod.yaml" \
  exec -T timescaledb \
  sh -c 'pg_dump -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus}" --no-owner --no-acl' \
  | gzip -9 > "$TMP_FILE"

# Verify archive integrity and non-empty payload before promoting
gzip -t "$TMP_FILE"
BYTES="$(wc -c < "$TMP_FILE")"
if [ "$BYTES" -lt 1024 ]; then
  rm -f "$TMP_FILE"
  echo "[BACKUP ERROR] Backup archive too small (${BYTES} bytes), aborting." >&2
  exit 1
fi

mv "$TMP_FILE" "$OUT_FILE"

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -type f -name 'zupirus_pg_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[BACKUP OK] $OUT_FILE (${BYTES} bytes, retention=${RETENTION_DAYS}d)"
