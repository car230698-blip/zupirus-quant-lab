# Deploy ZUPIRUS Quant Lab (PDF library) on the VPS

Copy and paste these commands on the production VPS as `root`.  
Project directory: **`/root/zupirus-quant-lab`**.  
Compose project name: **`zupirus-prod`**.  
Files used every time: **`compose.yaml` + `compose.prod.yaml`**.  
The API listens on `127.0.0.1:8080`. Nginx Proxy Manager (network `npm_default`) or Caddy is the public entry.

Migration 028 does **not** drop historical trading tables. Migration 029 adds study/methodology tables and seeds the first EURUSD guide as a **DRAFT**. You publish it with one admin click after you review the PDF.

---

## 0. Go to the project and check `.env`

```bash
cd /root/zupirus-quant-lab
test -f .env || { echo "Missing .env — stop."; exit 1; }
```

`.env` must set at least:

```bash
POSTGRES_USER=zupirus
POSTGRES_PASSWORD=REPLACE_ME_STRONG
POSTGRES_DB=zupirus_quant
REDIS_PASSWORD=REPLACE_ME_STRONG
ENCRYPTION_KEY=REPLACE_ME_32PLUS_CHARS
ADMIN_PASSWORD=REPLACE_ME_STRONG
REPORT_DOWNLOAD_SECRET=REPLACE_ME_OPTIONAL_BUT_RECOMMENDED
COMMERCIAL_REPORTS_SALE_ENABLED=false
ENABLE_LEGACY_CUSTOMER_EXECUTION=false
ENABLE_LEGACY_RESEARCH_LOOP=false
ENABLE_LEGACY_EA_BRIDGE=false
# Optional env fallbacks (admin UI wallets override these when saved):
# USDT_BEP20_ADDRESS=
# USDT_TRC20_ADDRESS=
```

**Password note:** PostgreSQL keeps the password from the first time the `timescaledb` volume was created. Changing `POSTGRES_PASSWORD` in `.env` later does **not** change the database password. Use the same password the volume already has, or you will break the API login to Postgres while the container still looks “healthy”.

To change the password on purpose: update Postgres first, then `.env`, then recreate API/research:

```bash
# Replace NEW_PASSWORD with the value you will put in .env
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  psql -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus_quant}" \
  -c "ALTER USER \"${POSTGRES_USER:-zupirus}\" WITH PASSWORD 'NEW_PASSWORD';"
# Then set POSTGRES_PASSWORD=NEW_PASSWORD in .env and reload it before recreate:
set -a; source .env; set +a
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --force-recreate api research
```

Create the PDF data volume once if it does not exist:

```bash
docker volume create zupirus_quant_lab_data
```

---

## 1. Back up the database first

```bash
cd /root/zupirus-quant-lab
set -a; source .env; set +a
mkdir -p "$HOME/zupirus-backups"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  pg_dump -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus_quant}" -Fc \
  > "$HOME/zupirus-backups/zupirus_quant_${STAMP}.dump"

ls -lh "$HOME/zupirus-backups/zupirus_quant_${STAMP}.dump"
# If that file is empty or tiny, STOP. Do not continue.
```

Also back up PDF files on the data volume:

```bash
docker run --rm \
  -v zupirus_quant_lab_data:/data:ro \
  -v "$HOME/zupirus-backups":/backup \
  alpine tar czf "/backup/lab_data_${STAMP}.tgz" -C /data .
```

---

## 2. Pull this release

```bash
cd /root/zupirus-quant-lab
git fetch origin
git checkout main
git pull origin main
# If you are shipping a PR branch instead of main, use that branch name instead.
```

---

## 3. Build the new image, then migrate

Always **build first**, then run the one-shot migrator. That way migration 028 from this release (non-destructive) is what runs — not an older image that may still contain a dropping migration.

```bash
cd /root/zupirus-quant-lab
set -a; source .env; set +a

docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d timescaledb redis

# --build ensures this release's migration code runs (not an older cached image).
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml run --rm --no-deps --build \
  -e APP_ENV=production \
  api python -c "from app.db import init; init(); print('migrations ok')"
```

Check tables and version 29:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  psql -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus_quant}" \
  -c "\dt quant_studies" -c "\dt methodologies" \
  -c "SELECT id, status, price_usd, title FROM research_reports WHERE id = 'rep_eurusd_h1_asia_london_v1';" \
  -c "SELECT version, name FROM schema_migrations ORDER BY version;"
```

You should see version **29** and the launch guide row with status **`DRAFT`** and price **`19`**.

---

## 4. Rebuild and restart the stack

```bash
cd /root/zupirus-quant-lab
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml ps
curl -fsS http://127.0.0.1:8080/healthz
# /readyz returns 503 until the research container heartbeats (~45s). That is normal.
curl -fsS http://127.0.0.1:8080/readyz || true
```

There is no execution / order-routing container. Do not run `python -m app.engine` on the host.

If you use the compose Caddy profile and changed `Caddyfile`:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml --profile public exec proxy \
  caddy reload --config /etc/caddy/Caddyfile
```

If you use Nginx Proxy Manager on the `npm_default` Docker network, point each proxy host upstream to **`zupirus-api:8000`** (Compose network alias + container port). Use `127.0.0.1:8080` only for health checks from the VPS host itself — that address is the published host port, not what another container should call.

---

## 5. Configure USDT wallets (admin UI)

1. Open `https://adm.zupirus.com` and sign in with the admin email / `ADMIN_PASSWORD`.
2. Open **Billing** settings.
3. Enter the **receiving** addresses only (public addresses):
   - **BEP20** USDT wallet
   - **TRC20** USDT wallet  
   Never paste a private key.
4. Save. The values are stored in the database (`billing:crypto_wallets`). Env vars `USDT_BEP20_ADDRESS` / `USDT_TRC20_ADDRESS` are only fallbacks if the admin UI has never saved wallets.

Checkout refuses to create an order if no receiving wallet is configured.

---

## 6. Review and publish the first guide

On first deploy the store already has this draft (not public yet):

| Field | Value |
|-------|--------|
| Report id | `rep_eurusd_h1_asia_london_v1` |
| Title (VI) | EURUSD H1: phiên Á và xác suất phá biên London — thống kê mẫu Yahoo 2024–2026 |
| Price | **19 USDT** |
| Status | **DRAFT** until you publish |

**Publish toggle (one action):** Admin → Reports publisher → open the EURUSD draft → **Publish**.  
Or:

```bash
# After you are logged in via the browser cookie, or use your usual admin API client:
# POST https://adm.zupirus.com/api/v1/admin/reports/rep_eurusd_h1_asia_london_v1/publish
# body: {"version":"v1.0","changelog":"Launch guide v1.0"}
```

Until you publish, the public catalog at `/api/v1/reports` does **not** list it.

Preview PDF (committed for review): `artifacts/launch-guide/eurusd-h1-asia-london-preview.pdf`  
Full PDF: `artifacts/launch-guide/eurusd-h1-asia-london-full.pdf`

---

## 7. Turn on commercial sales

Only after wallets are saved and the guide is published:

```bash
cd /root/zupirus-quant-lab
# Edit .env and set:
# COMMERCIAL_REPORTS_SALE_ENABLED=true

grep COMMERCIAL_REPORTS_SALE_ENABLED .env
set -a; source .env; set +a
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d api
```

`COMMERCIAL_REPORTS_SALE_ENABLED` is **env-only** (no admin toggle). Recreate the API container after changing it.

Then buy the guide with a small USDT transfer from a test wallet and confirm the library download adds the buyer email page when watermarking is on.

---

## 8. Rollback (application only)

If the new API fails health checks:

```bash
cd /root/zupirus-quant-lab
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml stop api research
git checkout <previous-good-sha>
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build
```

Migration 029 only adds tables and defaulted columns. The previous app can boot with those objects still present. You do **not** need to drop them.

---

## 9. Restore a database dump (into a NEW database — never onto live first)

Create a separate restore database, validate it, then switch only after checks pass.

```bash
cd /root/zupirus-quant-lab
set -a; source .env; set +a
STAMP=YYYYMMDDTHHMMSSZ   # the stamp from your backup filename (keep original case in the filename)
# Lowercase the DB name so CREATE DATABASE and pg_restore/-d stay in sync
# (PostgreSQL folds unquoted identifiers to lowercase).
RESTORE_DB=$(echo "zupirus_quant_restore_${STAMP}" | tr '[:upper:]' '[:lower:]')

# 1) Create an empty restore database (production DB stays untouched)
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  psql -U "${POSTGRES_USER:-zupirus}" -d postgres \
  -c "CREATE DATABASE ${RESTORE_DB};"

# 2) Restore the dump into THAT database only
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  pg_restore -U "${POSTGRES_USER:-zupirus}" -d "${RESTORE_DB}" --clean --if-exists \
  < "$HOME/zupirus-backups/zupirus_quant_${STAMP}.dump"

# 3) Validate counts on the restore DB (not production)
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  psql -U "${POSTGRES_USER:-zupirus}" -d "${RESTORE_DB}" \
  -c "SELECT count(*) AS users FROM users;" \
  -c "SELECT count(*) AS orders FROM orders;"
```

Do **not** run `pg_restore --clean` against `zupirus_quant` while it is the live production database.

After validation, switch the stack by changing **`POSTGRES_DB`** (Compose builds `DATABASE_URL` from `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — a bare `DATABASE_URL=` line in `.env` is ignored by `compose.prod.yaml`):

```bash
# Edit .env: set POSTGRES_DB=${RESTORE_DB}
set -a; source .env; set +a
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --force-recreate api research
```

Restore PDF files if the volume was replaced:

```bash
docker run --rm \
  -v zupirus_quant_lab_data:/data \
  -v "$HOME/zupirus-backups":/backup \
  alpine tar xzf "/backup/lab_data_${STAMP}.tgz" -C /data
```
