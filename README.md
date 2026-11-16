# ZUPIRUS Quant Lab

> **100% Autonomous Cloud MT5 Execution · Zero EA · Zero VPS · Multi-Pair Gold & Forex**

ZUPIRUS Quant Lab is an autonomous quantitative trading & cloud execution platform supporting **XAUUSD, EURUSD, GBPUSD, and USDJPY**. It connects directly to customer MT5 accounts via **MetaApi Cloud Bridge**, automates the full customer lifecycle from OTP registration and **SePay VietQR** billing to **24/5 position protection**, and runs a **3-Stage Tabula Rasa AI Evolution Loop**.

---

## Core Architecture

### 1. Zero-Touch Customer Lifecycle (`app.zupirus.com`)
- **Authentication & Security:** Email registration with **Resend API OTP** (isolated attempt tracking), AES-encrypted MT5 credentials, and unified Cookie / Bearer session auth.
- **Automated SePay VietQR Billing:** Real-time USD/VND conversion, atomic webhook fulfillment (`UNDERPAID` accumulation to `PAID`), automatic subscription activation/renewal, and email payment receipts.
- **Auto-Provisioning & Cloud Deploy:** Automatic account classification (`STANDARD`, `CENT`, `PROP_FIRM`, `RAW_ECN`), broker symbol mapping, tier-aware protection defaults (`auto_be_partial_tp`, `is_prop_firm_mode`), and 3-attempt MetaApi deploy retry.
- **24/5 Protection & Subscription Lifecycle Worker:**
  - `PositionWatcher` (every 5s): Auto Break-Even at `1R`, 50% Partial TP1, Friday `21:00 UTC` Prop Firm close, and `4.5%` daily drawdown circuit breaker.
  - Hourly lifecycle pass: 3-day & 1-day renewal reminders; suspends new entries (`auto_trade = 0`) on expiry while keeping `EXPIRED_PROTECTING` active until open positions close, then undeploys idle terminals to save Cloud costs.

### 2. Autonomous 3-Stage AI Evolution (`Tabula Rasa`)
- **24/5 Live Market & Macro Feed:** Polls live quotes & `M1`/`M15` candles across `XAUUSD`, `EURUSD`, `GBPUSD`, `USDJPY` into TimescaleDB + Redis, plus 6-hour USD economic calendar sync.
- **Stage 1 (`EXTERNAL_FEED`) & Public Discovery:** Polls public **TradingView Forex/Gold Scanner** (`M15`, `H1`, `H4`) + cross-asset `DXY`/`US10Y` context into `SHADOW_ONLY`, grades signals against real `M1` candles, and auto-rotates top sources into `ACTIVE_LIVE`.
- **Stage 2 (`HYBRID`) & Stage 3 (`ZUPIRUS_AGENT`):** Distills lessons into `Hindsight` memory, validates candidates with **Walk-Forward Out-of-Sample** (`win_rate >= 55%`, `profit_factor >= 1.4`, `sample_size >= 30`), and optionally auto-promotes to `ZUPIRUS_AGENT` (`M15` AI Swarm + 5 Skills + 4-Layer Safety Shields).

### 3. Streamlined 3-Tab Admin Portal (`adm.zupirus.com`)
1. **Giám Sát AI & Cảnh Báo (Command Radar):** 4-lamp system health radar, Global Kill-Switch, Dry-Run System Test, natural-language Live AI Decision Feed, and Error/Alert Center.
2. **Trí Tuệ AI & Nguồn Tín Hiệu (AI Evolution):** 3-stage maturity progress, M1 grading journal, Hindsight risk lessons, Walk-Forward results, built-in vs self-learned skills, and Gemini API Pool.
3. **Kinh Doanh & Khách Hàng (Business & Customers):** SePay/FX configuration, exception-only manual order approval, and customer account compliance controls.

---

## Tech Stack

- **Backend:** FastAPI, Python 3.12, Pydantic v2, Asyncio Fan-Out
- **Database & Cache:** TimescaleDB (PostgreSQL), Redis
- **Execution Bridge:** MetaApi Cloud API
- **Frontend:** React 19, TypeScript, TailwindCSS, Vite
- **Payments & Email:** SePay VietQR, Resend API

---

## Deployment & Local Development

### Production (Docker Compose)
```bash
# Configure .env from .env.example (METAAPI_TOKEN, SEPAY_WEBHOOK_SECRET, RESEND_API_KEY, ENCRYPTION_KEY, TRADINGVIEW_WEBHOOK_SECRET)
docker compose -p zupirus-prod up -d --build
```

### Local Development & Testing
```bash
# 1. Install dependencies
pip install -r requirements.lock
npm ci

# 2. Run API & Frontend
uvicorn app.main:app --host 0.0.0.0 --port 8000
npm run dev

# 3. Run End-to-End Autonomous System Tests
pytest tests/test_end_to_end_autonomous_system.py tests/test_full_autonomous_lifecycle.py -q
```
