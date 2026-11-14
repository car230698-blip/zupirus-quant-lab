#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null; then echo 'BLOCKED: Docker CLI/daemon unavailable'; exit 77; fi
docker info >/dev/null || { echo 'BLOCKED: Docker daemon unavailable'; exit 77; }
# Unique Compose project. No production volumes or ports reused.
export ADMIN_PASSWORD=smoke-only-password-123 COOKIE_SECURE=false
project="zupirus-smoke-$$"
cleanup() { docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml --profile test down -v --remove-orphans; }
trap cleanup EXIT
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml config --quiet
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml up -d --build --wait api execution research
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml --profile test run --rm tests
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "import urllib.request; assert b'false' in urllib.request.urlopen('http://localhost:8000/healthz').read()"
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml restart research execution
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml up -d --wait api execution research
printf 'PASS: compose startup, health, tests, worker restart\n'
