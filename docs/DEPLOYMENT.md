# ZUPIRUS Quant Lab · Deployment & Operations Guide

## 1. Production Topology

```
Host: 109.199.100.120 (Ubuntu Linux)
App Directory: /home/hoangminh2306/zupirus-quant-lab-test

Containers (Docker Compose `zupirus-prod`):
- zupirus-prod-api: FastAPI backend & Vite SPA server (port 8000)
- zupirus-prod-execution: Quant execution & safety guard background loop
- zupirus-prod-research: LangGraph research & Walk-Forward validation agent
- zupirus-prod-timescaledb: TimescaleDB PostgreSQL database (port 5432)
- zupirus-prod-redis: Redis idempotency locks & pub/sub cache (port 6379)
```

Reverse Proxy: Nginx manages SSL certificates and routes:
- `https://zupirus.com` -> Landing Page
- `https://app.zupirus.com` -> User Application
- `https://adm.zupirus.com` -> Admin Command Center

---

## 2. Environment Variables Configuration

Copy `.env.example` to `.env` on the deployment host:

```bash
# Production URLs & Domains
ALLOWED_ORIGINS=https://zupirus.com,https://app.zupirus.com,https://adm.zupirus.com
COOKIE_SECURE=true

# Databases
DATABASE_URL=postgresql://zupirus:password@timescaledb:5432/zupirus
REDIS_URL=redis://redis:6379/0

# MetaApi Cloud MT5
METAAPI_TOKEN=<jwt_token>
METAAPI_REGION=london
METAAPI_ACCOUNT_TYPE=cloud-g2

# Webhook Secrets
TRADINGVIEW_WEBHOOK_SECRET=your_tv_secret_2026
SEPAY_WEBHOOK_SECRET=your_sepay_token

# Real-Time FX Rate
FX_RATE_PROVIDER_URL=https://api.exchangerate-api.com/v4/latest/USD
FX_RATE_CACHE_TTL_SECONDS=7200
FALLBACK_USD_VND_RATE=25500.0
```

---

## 3. Remote Deployment Procedure

1. Push latest commits to the VPS remote:
   ```bash
   git push root@109.199.100.120:/home/hoangminh2306/zupirus-quant-lab-test main:main
   ```

2. Build and restart Docker containers:
   ```bash
   ssh root@109.199.100.120 "cd /home/hoangminh2306/zupirus-quant-lab-test && npm run build && docker compose -p zupirus-prod up -d --build"
   ```

3. Health check verification:
   ```bash
   curl -I https://zupirus.com/healthz
   curl -I https://zupirus.com/readyz
   ```
