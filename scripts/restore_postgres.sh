#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: $0 <backup-file> [empty-compose-database]" >&2
    exit 2
fi
args=(--backup "$1")
if [[ $# -eq 2 ]]; then
    args+=(--database "$2")
fi
exec python3 "$(dirname "$0")/restore_postgres.py" "${args[@]}"
