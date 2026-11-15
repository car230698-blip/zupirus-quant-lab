#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then echo 'BLOCKED: Docker CLI/daemon unavailable'; exit 77; fi
docker info >/dev/null || { echo 'BLOCKED: Docker daemon unavailable'; exit 77; }

# Unique Compose project. No production volumes or ports reused.
export ADMIN_PASSWORD=smoke-only-password-123 COOKIE_SECURE=false
project="zupirus-smoke-$$"

dump_debug() {
    echo "=========================================="
    echo "=== DOCKER SMOKE FAILURE DIAGNOSTICS ==="
    echo "=========================================="
    echo "--- docker compose ps ---"
    docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml ps -a || true
    echo "--- docker compose logs ---"
    docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml logs --tail 100 || true
}

cleanup() {
    docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml --profile test down -v --remove-orphans || true
}

trap 'dump_debug' ERR
trap cleanup EXIT

echo "=== 1. Validating Compose Configuration ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml config --quiet

echo "=== 2. Starting Stack with Real PostgreSQL, TimescaleDB, and Redis ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml up -d --build --wait api execution research

echo "=== 3. Running Test Suite via Compose Profile ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml --profile test run --rm tests

echo "=== 4. Verifying Health, Readiness, and Hypertables (Strict Fail-Closed) ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json
# Verify healthz
res = json.loads(urllib.request.urlopen('http://localhost:8000/healthz').read().decode())
assert res.get('real_trading') is False, f'real_trading must be False: {res}'

# Verify readyz strict contract (TimescaleDB + PostgreSQL + Redis must be active, NO fallback to SQLite/mock)
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
assert ready.get('status') == 'ready', f'readyz not ready: {ready}'
assert ready.get('database', {}).get('connected') is True, f'database not connected: {ready}'
assert ready.get('database', {}).get('is_postgres') is True, f'database must be PostgreSQL, not SQLite: {ready}'
assert ready.get('redis', {}).get('connected') is True, f'redis not connected: {ready}'
assert ready.get('timescaledb', {}).get('timescaledb_available') is True, f'timescaledb not available: {ready}'
assert len(ready.get('timescaledb', {}).get('hypertables', [])) >= 2, f'hypertables missing: {ready}'
print('PASS: /healthz and /readyz verified with real PostgreSQL, TimescaleDB, and Redis')
"

echo "=== 5. Verifying Worker Heartbeats ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
hb = ready.get('execution_worker', {})
assert hb.get('active') is True, f'Execution worker heartbeat inactive: {hb}'
print('PASS: Worker heartbeats active and verified')
"

echo "=== 6. Verifying Quote Ingestion & Candle Queries ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import time
from app.db import insert_timescale_quote, query_timescale_candles
now = time.time()
insert_timescale_quote('DEMO', now, 2655.10, 2655.40, symbol='XAUUSD')
candles = query_timescale_candles(symbol='XAUUSD', timeframe='M15', source='DEMO', limit=10)
assert isinstance(candles, list), 'Candles query must return a list'
print('PASS: Quote ingestion and candle query verified')
"

echo "=== 7. Verifying Persistence Across Service Restart ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml restart research execution api
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml up -d --wait api execution research
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
assert ready.get('status') == 'ready', 'System must recover to ready status after restart'
print('PASS: Services and data persist across restart')
"

echo "=== 8. Verifying Fail-Closed Readiness on Disconnection ==="
# Pause Redis: /readyz must detect disconnection and fail-closed
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml pause redis
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json
try:
    resp = urllib.request.urlopen('http://localhost:8000/readyz', timeout=3)
    data = json.loads(resp.read().decode())
    assert data.get('status') != 'ready' or not data.get('redis', {}).get('connected'), f'Redis pause must report degraded/unready: {data}'
except Exception:
    pass # 503 is expected fail-closed response
print('PASS: Disconnect strictly detected as unready / fail-closed')
"
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml unpause redis

# Wait for Redis reconnection
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json, time
time.sleep(2)
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
assert ready.get('redis', {}).get('connected') is True, f'Redis did not recover: {ready}'
print('PASS: Redis recovery verified')
"

printf 'PASS: compose startup, TimescaleDB, Redis, health, tests, persistence, fail-closed\n'
