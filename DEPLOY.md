# Deploy the quant library on the VPS

These are the commands the owner runs on the single production VPS. Do not run them from a laptop against production. The app listens on `127.0.0.1:8080`. Caddy (or the existing Nginx Proxy Manager network `npm_default`) is the only public entry.

The compose project name used below is `zupirus-prod`. The production database name is `zupirus_quant`. Migration 028 does **not** drop historical trading tables. Migration 029 only adds study and methodology tables and a watermark flag.

## 0. Before you pull

1. SSH to the VPS and `cd` to the checkout that already runs production.
2. Confirm `.env` exists and is not committed. It must set at least:

   - `POSTGRES_PASSWORD`
   - `REDIS_PASSWORD`
   - `ENCRYPTION_KEY`
   - `ADMIN_PASSWORD`
   - `POSTGRES_DB=zupirus_quant`
   - `REPORT_DOWNLOAD_SECRET` (or rely on `ENCRYPTION_KEY`)
   - `USDT_BEP20_ADDRESS` and `USDT_TRC20_ADDRESS` only when you are ready to receive payment
   - `COMMERCIAL_REPORTS_SALE_ENABLED=false` until the first real PDF is reviewed

3. Leave these off:

   - `ENABLE_LEGACY_CUSTOMER_EXECUTION=false`
   - `ENABLE_LEGACY_RESEARCH_LOOP=false`
   - `ENABLE_LEGACY_EA_BRIDGE=false`

## 1. Back up the database first

```bash
mkdir -p "$HOME/zupirus-backups"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  pg_dump -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus_quant}" -Fc \
  > "$HOME/zupirus-backups/zupirus_quant_${STAMP}.dump"
ls -lh "$HOME/zupirus-backups/zupirus_quant_${STAMP}.dump"
```

If that file is empty, stop. Do not migrate.

Also copy the PDF volume if you have published files already:

```bash
docker run --rm -v zupirus_quant_lab_data:/data:ro -v "$HOME/zupirus-backups":/backup alpine \
  tar czf "/backup/lab_data_${STAMP}.tgz" -C /data .
```

## 2. Pull this release

```bash
git fetch origin
git checkout main
git pull origin main
```

Use the branch or tag you intend to ship if it is not `main` yet. Read `docs/PIVOT_PLAN.md` once before the migrate step.

## 3. Migrate

Migrations run when the API container starts (`init()` on boot). They are additive. To apply them once, before you recreate the rest of the stack, you can start only the database and a one-shot migrator:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d timescaledb redis
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml run --rm --no-deps \
  -e APP_ENV=production \
  api python -c "from app.db import init; init(); print('migrations ok')"
```

`run` uses the image you have built. If this is the first boot of this release, build first (next section) and then run the one-shot command again. A second run is safe: applied versions are recorded in `schema_migrations`.

Check the new tables:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  psql -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus_quant}" \
  -c "\dt quant_studies" -c "\dt methodologies" \
  -c "SELECT version, name FROM schema_migrations ORDER BY version;"
```

You should see version 29. You should still see historical tables such as `trading_accounts` if they existed before this release.

## 4. Rebuild and restart

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml ps
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz || true
```

`/readyz` returns 503 until the research container has written `research_heartbeat` (within about 45 seconds). That container is the quant librarian. It reconciles pending USDT transfers. It does not place trades.

There is no execution container in this compose file. Do not start `python -m app.engine` on the host.

Reload Caddy only if you changed `Caddyfile`:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml --profile public exec proxy caddy reload --config /etc/caddy/Caddyfile
```

If the VPS uses Nginx Proxy Manager instead of the compose Caddy profile, leave NPM as it is: it should already proxy `zupirus.com`, `www`, `app.zupirus.com`, and `adm.zupirus.com` to `127.0.0.1:8080`.

## 5. After it is up

1. Sign in at `https://adm.zupirus.com`.
2. Save the USDT BEP20 and TRC20 receiving addresses under billing. Do not paste a private key.
3. Run a study from admin (`POST /api/v1/admin/quant/studies`) or the publisher UI, read the draft PDF, set the price, then publish.
4. Only then set `COMMERCIAL_REPORTS_SALE_ENABLED=true` in `.env` and recreate the API container:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d api
```

5. Buy a guide with a small USDT transfer on a test wallet and confirm the library download names the buyer when watermarking is on.

## 6. Rollback

If the new API fails health checks:

```bash
# Stop the new app processes. Leave the database running.
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml stop api research

# Put the previous git revision back and rebuild.
git checkout <previous-good-sha>
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build
```

Migration 029 only adds tables and nullable-or-defaulted columns. The previous application can boot with those extra objects still present. You do not need to drop them.

If a migration in this release corrupted data (it is not supposed to), restore the dump from step 1 into a new database name first and point `DATABASE_URL` at it only after you have checked a `SELECT count(*)` on `users` and `orders`:

```bash
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml exec -T timescaledb \
  pg_restore -U "${POSTGRES_USER:-zupirus}" -d "${POSTGRES_DB:-zupirus_quant}" --clean --if-exists \
  < "$HOME/zupirus-backups/zupirus_quant_${STAMP}.dump"
```

`--clean` drops objects in the target database. Use it only on a database you have already copied, or restore into an empty database you create for the purpose. Do not run it against the only copy of production.

Restore PDF files from the tar if the volume was replaced:

```bash
docker run --rm -v zupirus_quant_lab_data:/data -v "$HOME/zupirus-backups":/backup alpine \
  tar xzf "/backup/lab_data_${STAMP}.tgz" -C /data
```
