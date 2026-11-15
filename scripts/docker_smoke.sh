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
db_info = ready.get('database', {})
assert db_info.get('connected') is True, f'database not connected: {ready}'
assert db_info.get('engine') == 'postgresql' or db_info.get('details', {}).get('is_postgres') is True, f'database must be PostgreSQL, not SQLite: {ready}'
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
assert hb.get('heartbeat_active') is True or hb.get('active') is True, f'Execution worker heartbeat inactive: {hb}'
print('PASS: Worker heartbeats active and verified')
"

echo "=== 6. Verifying Quote Ingestion & Candle Queries ==="
smoke_ts=$(docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import time
from app.db import insert_timescale_quote, query_timescale_candles
test_ts = round(time.time() - 120.0, 2)
insert_timescale_quote('DEMO', test_ts, 2655.10, 2655.40, symbol='XAUUSD')
candles = query_timescale_candles(symbol='XAUUSD', timeframe='M15', source='DEMO', limit=10)
assert isinstance(candles, list), 'Candles query must return a list'
print(test_ts)
")
echo "PASS: Quote ingestion and candle query verified at ts=$smoke_ts"

echo "=== 7. Verifying Persistence Across Service Restart ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml restart research execution api
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml up -d --wait api execution research
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json
from app.db import get_db_connection
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
assert ready.get('status') == 'ready', 'System must recover to ready status after restart'

test_ts = float('$smoke_ts')
with get_db_connection() as conn:
    row = conn.execute('SELECT bid, ask FROM quotes WHERE source = ? AND ts = ?', ('DEMO', test_ts)).fetchone()
    assert row is not None, f'Persisted quote record at {test_ts} was lost after service restart!'
    assert float(row[0]) == 2655.10 and float(row[1]) == 2655.40, f'Persisted quote corrupted: {row}'
print('PASS: Services and persisted database records verified intact across restart')
"

echo "=== 7b. Verifying Migrations on Fresh and Legacy Database Schemas ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
from app.migrations import run_postgres_migration_test
run_postgres_migration_test()
print('PASS: PostgreSQL and TimescaleDB fresh and legacy migration verified')
"

echo "=== 8. Verifying Fail-Closed Readiness on Disconnection (TimescaleDB and Redis Separately) ==="
# 8a. Pause Redis: /readyz must return HTTP 503 and report Redis failure
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml pause redis
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, urllib.error, json
try:
    urllib.request.urlopen('http://localhost:8000/readyz', timeout=8)
    raise AssertionError('Expected HTTP 503 when Redis is paused, but got 200 OK')
except urllib.error.HTTPError as e:
    assert e.code == 503, f'Expected HTTP 503, got {e.code}'
    data = json.loads(e.read().decode())
    assert data.get('status') == 'not_ready', f'Expected not_ready: {data}'
    assert data.get('redis', {}).get('connected') is False, f'Redis should report disconnected: {data}'
print('PASS: Redis disconnect strictly returns HTTP 503 and reports redis failure')
"
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml unpause redis

# Wait for Redis reconnection
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json, time
time.sleep(2)
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
assert ready.get('redis', {}).get('connected') is True, f'Redis did not recover: {ready}'
assert ready.get('status') == 'ready', f'System should be ready: {ready}'
print('PASS: Redis recovery verified')
"

# 8b. Pause TimescaleDB: /readyz must return HTTP 503 and report database failure
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml pause timescaledb
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, urllib.error, json
try:
    urllib.request.urlopen('http://localhost:8000/readyz', timeout=8)
    raise AssertionError('Expected HTTP 503 when TimescaleDB is paused, but got 200 OK')
except urllib.error.HTTPError as e:
    assert e.code == 503, f'Expected HTTP 503, got {e.code}'
    data = json.loads(e.read().decode())
    assert data.get('status') == 'not_ready', f'Expected not_ready: {data}'
    assert data.get('database', {}).get('connected') is False, f'Database should report disconnected: {data}'
print('PASS: TimescaleDB disconnect strictly returns HTTP 503 and reports database failure')
"
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml unpause timescaledb

# Wait for TimescaleDB reconnection
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request, json, time
time.sleep(3)
ready = json.loads(urllib.request.urlopen('http://localhost:8000/readyz').read().decode())
assert ready.get('database', {}).get('connected') is True, f'TimescaleDB did not recover: {ready}'
assert ready.get('status') == 'ready', f'System should be ready: {ready}'
print('PASS: TimescaleDB recovery verified')
"

echo "=== 9. Verifying React Production Bundle on Docker ==="
docker compose -p "$project" -f compose.yaml -f compose.smoke.yaml exec -T api python -c "
import urllib.request
html = urllib.request.urlopen('http://localhost:8000/').read().decode('utf-8')
assert 'id=\"root\"' in html, 'Production bundle must contain #root div'
assert '/assets/' in html, 'Production bundle must reference Vite compiled assets'
print('PASS: React production bundle verified in Docker image')
"

printf 'PASS: compose startup, TimescaleDB, Redis, health, tests, persistence, fail-closed, react-bundle\n'
