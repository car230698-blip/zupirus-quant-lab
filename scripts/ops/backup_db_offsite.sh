#!/usr/bin/env bash
# ZUPIRUS Quant Lab v2.0 - Off-Site Database Backup Script
# Performs pg_dump, verifies gzip integrity, maintains 14-day local retention,
# and synchronizes to off-site storage (Rclone / AWS S3) if configured.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/zupirus-quant-lab}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/zupirus}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-zupirus-prod}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/zupirus_pg_${TIMESTAMP}.sql.gz"
TMP_FILE="${OUT_FILE}.tmp"

echo "[BACKUP START] Dumping TimescaleDB / PostgreSQL database..."

docker compose \
  -p "$COMPOSE_PROJECT" \
  -f "$PROJECT_DIR/compose.yaml" \
  -f "$PROJECT_DIR/compose.prod.yaml" \
  exec -T timescaledb \
  sh -c 'pg_dump -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus}" --no-owner --no-acl' \
  | gzip -9 > "$TMP_FILE"

# 1. Verify archive integrity
gzip -t "$TMP_FILE"
BYTES="$(wc -c < "$TMP_FILE")"
if [ "$BYTES" -lt 1024 ]; then
  rm -f "$TMP_FILE"
  echo "[BACKUP ERROR] Backup archive too small (${BYTES} bytes), aborting." >&2
  exit 1
fi

mv "$TMP_FILE" "$OUT_FILE"
echo "[BACKUP OK] Local snapshot saved: $OUT_FILE (${BYTES} bytes)"

# 2. Prune local backups older than RETENTION_DAYS
find "$BACKUP_DIR" -type f -name 'zupirus_pg_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
echo "[BACKUP PRUNE] Cleaned archives older than ${RETENTION_DAYS} days."

# 3. Off-site Synchronization (Rclone / S3)
if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "[OFFSITE] Syncing to Rclone remote: ${RCLONE_REMOTE}..."
  rclone copy "$OUT_FILE" "${RCLONE_REMOTE}/zupirus_backups/" --fast-list --retries 3
  echo "[OFFSITE OK] Rclone sync complete."
elif [ -n "${AWS_S3_BUCKET:-}" ]; then
  echo "[OFFSITE] Uploading to AWS S3: s3://${AWS_S3_BUCKET}/zupirus_backups/..."
  aws s3 cp "$OUT_FILE" "s3://${AWS_S3_BUCKET}/zupirus_backups/$(basename "$OUT_FILE")"
  echo "[OFFSITE OK] S3 upload complete."
else
  echo "[OFFSITE INFO] No RCLONE_REMOTE or AWS_S3_BUCKET configured. Archive is safely stored in local $BACKUP_DIR."
fi
