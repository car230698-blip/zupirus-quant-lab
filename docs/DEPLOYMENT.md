# ZUPIRUS Quant Lab · Deployment & Operations Guide

## 1. Production Topology & Domain Routing

```
Host: 109.199.100.120 (Ubuntu 24.04 LTS)
Base Project Directory: /home/hoangminh2306/zupirus-quant-lab-test
Compose Project Name: zupirus-prod

Containers (Docker Compose):
- zupirus-prod-api: FastAPI backend & compiled Vite SPA server (port 8000 -> host 127.0.0.1:8080)
- zupirus-prod-execution: Real-time Quant signal engine & 4 Safety Shields background dispatcher
- zupirus-prod-research: LangGraph research agent & rolling Walk-Forward validation worker
- zupirus-prod-timescaledb: TimescaleDB PostgreSQL database (port 5432)
- zupirus-prod-redis: Redis idempotency locks, pub/sub streams, and FX cache (port 6379)
```

Nginx Proxy Manager (`npm-app-1`) handles SSL certificates (Let's Encrypt) and reverse proxy routing:
- `https://zupirus.com` -> Landing Page (Vite SPA) & Public Billing / FX APIs
- `https://app.zupirus.com` -> User Command App (Cloud MT5 terminals, VietQR checkout, dual expiry tracker)
- `https://adm.zupirus.com` -> Admin Center (FX monitor, revenue analytics, signal audit logs)

---

## 2. Environment Variables Configuration

Copy `.env.example` to `.env` on the deployment host:

```bash
# Production URLs & Domains
ALLOWED_ORIGINS=https://zupirus.com,https://www.zupirus.com,https://app.zupirus.com,https://adm.zupirus.com
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

## 3. Automated CI/CD Architecture (GitHub Actions)

The repository is equipped with a two-stage automated CI/CD pipeline in `.github/workflows/`:

```mermaid
flowchart LR
    A[git push origin main] --> B[CI Workflow: ci.yml]
    B --> C[Job: Backend Tests]
    B --> D[Job: Frontend Tests]
    C --> E{100% Passed?}
    D --> E
    E -- Yes --> F[CD Workflow: deploy.yml]
    E -- No --> G[Halt / Alert]
    F --> H[SSH to VPS via appleboy/ssh-action]
    H --> I[git pull origin main]
    I --> J[Run DB Migrations]
    J --> K[docker compose up -d --build]
    K --> L[zupirus-cli healthcheck]
```

### 3.1 Continuous Integration (`.github/workflows/ci.yml`)
Triggers on `push` and `pull_request` to `main`, plus manual `workflow_dispatch`:
1. **Backend Job (`backend-test`)**:
   - Python 3.12 environment setup.
   - Installs locked dependencies from `requirements.lock`.
   - Runs static checks via `ruff` and `scripts/verify_package.py`.
   - Executes full pytest suite (70+ test cases covering live FX rate conversion, VND ceil-to-1000 rounding, SePay VietQR webhook fulfillment, 4 Mandatory Safety Shields, and MetaApi Direct-to-User execution).
   - Validates agent-native healthcheck: `python -m cli healthcheck --json`.
2. **Frontend Job (`frontend-test`)**:
   - Node.js 22 environment setup.
   - Installs dependencies via `npm ci`.
   - Verifies TypeScript typings across all 3 domains via `npm run lint`.
   - Builds production bundle via `npm run build`.
   - Runs frontend tests via `npm test`.

### 3.2 Continuous Deployment (`.github/workflows/deploy.yml`)
- Triggered automatically via `workflow_run` only when `ZUPIRUS CI` passes 100% on `main`.
- Can also be triggered manually on demand via **Actions -> ZUPIRUS CD -> Run workflow**.
- Connects securely to the VPS over SSH (`appleboy/ssh-action@v1.0.3`) using configured GitHub Secrets:
  1. `git pull origin main` in the production directory.
  2. Applies any pending database schema migrations.
  3. Rebuilds and restarts the service cluster:
     ```bash
     docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build --remove-orphans
     ```
  4. Executes post-deployment health inspection:
     ```bash
     docker exec zupirus-prod-api-1 python -m cli healthcheck --json || curl -f http://127.0.0.1:8080/healthz
     ```

---

## 4. Required GitHub Repository Secrets

To enable automated CD deployment, configure the following secrets in GitHub (**Settings $\rightarrow$ Secrets and variables $\rightarrow$ Actions $\rightarrow$ New repository secret**):

| Secret Name | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `VPS_HOST` | IPv4 address of the production server | `109.199.100.120` |
| `VPS_USER` | SSH user account | `root` |
| `VPS_SSH_KEY` | Private SSH key (OpenSSH format) with authorized access to the VPS | `-----BEGIN OPENSSH PRIVATE KEY----- ...` |
| `VPS_PORT` | SSH daemon listening port | `22` |
| `VPS_DEPLOY_PATH` | Absolute path to the repository on the VPS | `/home/hoangminh2306/zupirus-quant-lab-test` |

> [!NOTE]
> If `VPS_PORT` or `VPS_DEPLOY_PATH` are omitted, the workflow automatically defaults to port `22` and `/home/hoangminh2306/zupirus-quant-lab-test`.

---

## 5. Monitoring, Verification & Operations

### 5.1 Real-Time Health & Status Check
Check status remotely or directly on the VPS:
```bash
# Agent-native JSON healthcheck
docker exec zupirus-prod-api-1 python -m cli healthcheck --json

# Comprehensive component inspection (DB, Redis, Price Feed, Workers, Kill-switch)
docker exec zupirus-prod-api-1 python -m cli system status --json

# Test live USD/VND exchange rate and SePay order pricing
docker exec zupirus-prod-api-1 python -m cli billing fx --json
```

### 5.2 Viewing Container Logs
```bash
# Follow FastAPI backend logs
docker compose -p zupirus-prod logs -f api

# Follow Execution engine and Safety Shields logs
docker compose -p zupirus-prod logs -f execution

# Follow Research / Walk-Forward worker logs
docker compose -p zupirus-prod logs -f research
```

---

## 6. Emergency Rollback & Disaster Recovery

If a faulty release is detected in production, execute one of the following recovery procedures:

### Option A: Automated Rollback via Git Revert (Recommended)
1. Revert the problematic commit locally and push to `main`:
   ```bash
   git revert HEAD
   git push origin main
   ```
2. GitHub Actions CI will automatically test and CD will deploy the clean revert.

### Option B: Immediate Manual SSH Rollback
1. SSH into the production server:
   ```bash
   ssh root@109.199.100.120
   ```
2. Checkout the desired stable commit hash and restart containers:
   ```bash
   cd /home/hoangminh2306/zupirus-quant-lab-test
   git checkout <STABLE_COMMIT_HASH>
   docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build --remove-orphans
   docker exec zupirus-prod-api-1 python -m cli healthcheck --json
   ```

### Option C: Instant Emergency Trading Halt (Kill-Switch)
If an abnormal market event occurs or an order anomaly is detected, activate the system-wide emergency halt:
```bash
docker exec zupirus-prod-api-1 python -m cli system kill-switch --on --reason "Emergency halt due to investigation" --json
```
To resume normal trading operations once verified safe:
```bash
docker exec zupirus-prod-api-1 python -m cli system kill-switch --off --reason "Issue resolved and verified" --json
```
