#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker Engine + Compose v2 required.' >&2; exit 2; }
docker compose version >/dev/null
if [ ! -f .env ]; then
  umask 077
  cp .env.example .env
fi
# Generate missing secrets locally; do not echo secrets in container logs.
command -v python3 >/dev/null || { echo 'python3 is required for first-run credentials.' >&2; exit 2; }
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('.env'); text=p.read_text()
for key in ('ADMIN_PASSWORD','FEED_TOKEN'):
 lines=text.splitlines(); found=False
 for i,line in enumerate(lines):
  if line.startswith(key+'='):
   found=True
   if not line.partition('=')[2].strip(): lines[i]=key+'='+secrets.token_urlsafe(32)
 if not found: lines.append(key+'='+secrets.token_urlsafe(32))
 text='\n'.join(lines)+'\n'
p.write_text(text); p.chmod(0o600)
PY
mode="$(sed -n 's/^DEPLOY_MODE=//p' .env | tail -1)"
if [ "$mode" = public ]; then
  if ! grep -qx 'COOKIE_SECURE=true' .env; then echo 'Public mode requires COOKIE_SECURE=true in .env.' >&2; exit 2; fi
  docker compose --profile public up -d --build --wait
  echo 'Ready: https://zupirus.com and https://adm.zupirus.com. Admin credentials are in .env.'
else
  docker compose up -d --build --wait
  echo 'Replay ready on http://localhost:8080 (use SSH tunnel for remote VPS). Admin credentials are in .env.'
fi
