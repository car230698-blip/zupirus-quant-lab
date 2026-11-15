# ZUPIRUS Quant Lab · Architecture Documentation

## 1. Executive Summary & Core Architectural Shift

ZUPIRUS Quant Lab is an institutional-grade algorithmic trading and quantitative intelligence platform specializing in closed-candle execution for XAUUSD (Gold).

Starting in **v2026.2**, ZUPIRUS has completely deprecated all legacy client-side EA binaries (`.ex5`), local VPS requirements, pairing codes, and master trading accounts. The entire execution infrastructure operates on a **100% Direct-to-User Cloud MT5 Architecture via MetaApi Cloud Bridge**.

```
                           ┌────────────────────────────┐
                           │    Signal Sources          │
                           │  - TradingView Webhooks    │
                           │  - MetaApi Demo Feed       │
                           └─────────────┬──────────────┘
                                         │
                                         ▼
                           ┌────────────────────────────┐
                           │   4 Mandatory Safety       │
                           │   Guards & Sanitizer       │
                           │ 1. Mandatory ATR(14) SL    │
                           │ 2. News Shield (±15m USD)  │
                           │ 3. Entry Slippage (20 pips)│
                           │ 4. Redis Idempotency (60s) │
                           └─────────────┬──────────────┘
                                         │
                                         ▼
                           ┌────────────────────────────┐
                           │   Fan-Out Dispatcher       │
                           │   (MetaApi Trading API)    │
                           └─────────────┬──────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 ▼                       ▼                       ▼
      ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐
      │ MT5 Client Terminal  ││ MT5 Client Terminal  ││ MT5 Client Terminal  │
      │ User #1 (London G2)  ││ User #2 (London G2)  ││ User #3 (London G2)  │
      └──────────────────────┘└──────────────────────┘└──────────────────────┘
```

---

## 2. The 3-Domain Surface Model

| Domain | Target User | Responsibility |
|---|---|---|
| `zupirus.com` | Public / Prospects | Next-gen landing page, 100% Cloud MT5 showcase, 4 safety shields visual, dynamic USD/VND pricing calculator. |
| `app.zupirus.com` | End Investors / Clients | MT5 connection portal, dual expiry tracker (Cloud vs Copy-Trade), SePay VietQR payment checkout, tier-gated risk management (Compounding, Prop Firm Mode). |
| `adm.zupirus.com` | Quant Engineers & Admins | Real-time USD/VND rate monitor with cache controls, dual-currency revenue metrics, MetaApi telemetry, signal pipeline testing, and live audit feed. |

---

## 3. Product & Billing Architecture

The pricing structure cleanly separates physical cloud computing infrastructure from copy-trade quantitative signal services:

1. **Cloud MT5 Bridge Infrastructure ($10 / month / slot):**
   - Provisions an isolated MT5 terminal on MetaApi Cloud (`cloud-g2`, London).
   - Replaces traditional VPS requirements and avoids MT5 terminal crashes.
2. **Copy-Trade Signal Tiers:**
   - **Starter Tier ($20/mo | Combo $30/mo):** 1 MT5 slot, 100% 4 default safety shields, standard 1.0x multiplier.
   - **Growth Tier ($35/mo | Combo $45/mo):** Up to 3 MT5 slots, Custom Risk Multiplier (0.5x–3.0x), Auto-Compounding, Break-Even & Partial TP.
   - **Prop Firm Alpha Tier ($49/mo | Combo $59/mo):** Up to 5 MT5 slots, Prop Firm Pass Guard (Daily Drawdown 4.5%, Profit Target 8.0%), access to Alpha Quant strategies, dedicated support.

### Real-Time USD $\rightarrow$ VND Conversion Engine
- Automatic exchange rate lookup via exchangerate-api, cached in Redis (`fx:usd_vnd`, TTL 2 hours), with a hardcoded fallback (`25,500.0`).
- Mathematical ceiling to nearest 1,000 VND (`math.ceil(amount_vnd / 1000.0) * 1000`).
- Exchange rate lock mechanism: When an order is created, the rate and exact VND amount are locked in `orders` for 20 minutes (`ORDER_LOCK_MINUTES`).

---

## 4. The 4 Mandatory Safety Guards

Every signal passing through the ingestion pipeline must strictly pass all 4 guards before fan-out dispatch:

1. **Mandatory Stop Loss & Anti-Martingale:**
   - Evaluates signal SL. If missing, auto-attaches ATR(14) stop loss ($3.50 / 35 pips on XAUUSD).
   - Limits maximum concurrent open trades to 2.
2. **News Shield (±15 min USD High-Impact Window):**
   - Queries `news` table for high-impact USD events (CPI, NFP, FOMC interest rate announcements).
   - Blocks new order entries during `[event_time - 15m, event_time + 15m]`.
3. **Entry Slippage Guard:**
   - Verifies market price drift at ingestion time.
   - Rejects the signal if `abs(market_price - entry_price) > 20 pips` ($2.00 on XAUUSD).
4. **Redis Idempotency Deduplication:**
   - Computes SHA-256 fingerprint of `source:symbol:action:entry_price`.
   - Uses `SET NX` with 60s TTL to guarantee exactly-once processing.

All evaluations are recorded to `signal_audit_logs` table for institutional traceability.
