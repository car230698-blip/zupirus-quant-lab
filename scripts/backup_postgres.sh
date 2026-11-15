#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "$0")/backup_postgres.py" --out "${1:-./backups}"
