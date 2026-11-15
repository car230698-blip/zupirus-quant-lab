# ZUPIRUS Quant Lab · Institutional Quantitative Trading System

> **100% Direct Cloud MT5 Execution · Zero EA · Zero VPS · 4 Mandatory Safety Guards**

ZUPIRUS Quant Lab is a production-grade algorithmic trading platform designed for closed-candle execution on XAUUSD (Gold). It connects directly to investor MT5 accounts via MetaApi Cloud Bridge (London G2 datacenter) and dispatches verified signals concurrently with microsecond latency.

---

## Key Pillars

1. **Direct-to-User Cloud Architecture:**
   - No client-side `.ex5` files or Expert Advisors to install.
   - No personal VPS needed.
   - No intermediary master accounts (eliminates dual-latency and volume mismatch).
2. **4 Mandatory Safety Guards:**
   - **Guard 1:** Mandatory Stop Loss & Anti-Martingale (Auto-attaches ATR(14) $3.50 SL if missing; max 2 concurrent trades).
   - **Guard 2:** News Shield (Blocks new orders ±15 minutes around USD High-Impact events: CPI, NFP, FED).
   - **Guard 3:** Entry Slippage Guard (Rejects entry if market price drifts > 20 pips / $2.00).
   - **Guard 4:** Redis Idempotency Lock (60-second atomic deduplication).
3. **Transparent Hybrid Pricing & Real-Time FX Conversion:**
   - Cloud MT5 Bridge Slot: $10 / month / account.
   - Copy-Trade Signal Service: Starter ($20/mo), Growth ($35/mo), Prop Firm Alpha ($49/mo).
   - Live USD $\rightarrow$ VND conversion cached in Redis, ceiling-rounded to 1,000 VND, and locked for 20 minutes in SePay VietQR checkout.
4. **Agent-Native CLI (`zupirus-cli`):**
   - Full terminal-driven operations with `--json` output support.

---

## Tech Stack

- **Backend:** FastAPI, Python 3.12, Pydantic v2, Asyncio Fan-Out
- **Database:** TimescaleDB (PostgreSQL) Hypertables, Redis Distributed Locks
- **Cloud Bridge:** MetaApi Cloud Trading API (`cloud-g2`, London)
- **Frontend:** React 19, TypeScript, TailwindCSS, Vite
- **Payments:** SePay VietQR Automated Banking Fulfillment

---

## Quickstart

```bash
# 1. Install dependencies
pip install -r requirements.txt
npm install

# 2. Run backend
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. Run frontend development server
npm run dev

# 4. Agent-native CLI
python -m cli billing fx --json
python -m cli signal test-ingest --action BUY --price 2680.50 --json
```

---

## Documentation

- [System Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Billing & FX Conversion](docs/BILLING.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
# ZUPIRUS Quant Lab · Institutional Quantitative Trading System

> **100% Direct Cloud MT5 Execution · Zero EA · Zero VPS · 4 Mandatory Safety Guards**

ZUPIRUS Quant Lab is a production-grade algorithmic trading platform designed for closed-candle execution on XAUUSD (Gold). It connects directly to investor MT5 accounts via MetaApi Cloud Bridge (London G2 datacenter) and dispatches verified signals concurrently with microsecond latency.

---

## Key Pillars

1. **Direct-to-User Cloud Architecture:**
   - No client-side `.ex5` files or Expert Advisors to install.
   - No personal VPS needed.
   - No intermediary master accounts (eliminates dual-latency and volume mismatch).
2. **4 Mandatory Safety Guards:**
   - **Guard 1:** Mandatory Stop Loss & Anti-Martingale (Auto-attaches ATR(14) $3.50 SL if missing; max 2 concurrent trades).
   - **Guard 2:** News Shield (Blocks new orders ±15 minutes around USD High-Impact events: CPI, NFP, FED).
   - **Guard 3:** Entry Slippage Guard (Rejects entry if market price drifts > 20 pips / $2.00).
   - **Guard 4:** Redis Idempotency Lock (60-second atomic deduplication).
3. **Transparent Hybrid Pricing & Real-Time FX Conversion:**
   - Cloud MT5 Bridge Slot: $10 / month / account.
   - Copy-Trade Signal Service: Starter ($20/mo), Growth ($35/mo), Prop Firm Alpha ($49/mo).
   - Live USD $\rightarrow$ VND conversion cached in Redis, ceiling-rounded to 1,000 VND, and locked for 20 minutes in SePay VietQR checkout.
4. **Agent-Native CLI (`zupirus-cli`):**
   - Full terminal-driven operations with `--json` output support.

---

## Tech Stack

- **Backend:** FastAPI, Python 3.12, Pydantic v2, Asyncio Fan-Out
- **Database:** TimescaleDB (PostgreSQL) Hypertables, Redis Distributed Locks
- **Cloud Bridge:** MetaApi Cloud Trading API (`cloud-g2`, London)
- **Frontend:** React 19, TypeScript, TailwindCSS, Vite
- **Payments:** SePay VietQR Automated Banking Fulfillment

---

## Quickstart

```bash
# 1. Install dependencies
pip install -r requirements.txt
npm install

# 2. Run backend
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. Run frontend development server
npm run dev

# 4. Agent-native CLI
python -m cli billing fx --json
python -m cli signal test-ingest --action BUY --price 2680.50 --json
```

---

## Documentation

- [System Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Billing & FX Conversion](docs/BILLING.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

