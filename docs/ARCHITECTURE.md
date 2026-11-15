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

Every signal passing through the ingestion pipeline must strictly pass all 4 guards in prioritized sequence before fan-out dispatch:

1. **Lớp 1 — Redis Deduplication (60s Idempotency):**
   - Computes SHA-256 fingerprint of `source:symbol:action:entry_price`.
   - Uses `SET NX` with 60s TTL (`signal_ingest:{source}:{hash}`) to immediately block duplicate webhook deliveries at the gateway.
2. **Lớp 2 — Mandatory Stop Loss & Anti-Martingale:**
   - Evaluates signal SL. If missing and `AUTO_ATTACH_ATR_SL=true`, dynamically attaches SL derived from live `ATR(14)` M15 (default ~$3.50 / 35 pips on XAUUSD).
   - Strictly enforces anti-martingale risk by clamping `MAX_CONCURRENT_TRADES_PER_ACCOUNT=2`.
3. **Lớp 3 — News Shield (±15 min USD High-Impact Window):**
   - Queries `news` table for high-impact USD events (CPI, NFP, FOMC interest rate announcements).
   - Blocks 100% of new order entries during `[event_time - 15m, event_time + 15m]`.
4. **Lớp 4 — Entry Slippage Guard (<= 20 pips):**
   - Verifies real-time price drift against live tick quotes.
   - Cancels the order if `abs(market_price - entry_price) > 20 pips` ($2.00 on XAUUSD).

All evaluations and real-time market snapshots are recorded to `signal_audit_logs` table for institutional traceability.

---

## 5. Tabula Rasa Agent Learning & Autonomous Transition Model

ZUPIRUS Quant Lab operates on an inductive, zero-prejudice learning lifecycle ("Tabula Rasa"):

| Trạng thái | Nguồn phát lệnh khách (`app.zupirus.com`) | Vai trò Đội AI Agent (`research.py`, `hindsight.py`, `swarm.py`) |
|---|---|---|
| **Giai đoạn 1 (Hiện tại)**<br>`SIGNAL_SOURCE=EXTERNAL_FEED` | **100% từ nguồn ngoài:**<br>• TradingView Webhook<br>• MetaApi Demo Signal Feed | **Trang giấy trắng (Quan sát & Học quy nạp):**<br>• Không cài sẵn bất kỳ chiến lược kỹ thuật cứng nào.<br>• Tuyệt đối không tự phát lệnh cho khách.<br>• Chụp snapshot bối cảnh thị trường (phiên, ATR, tin tức) + kết quả PnL/MAE/MFE để tự đúc kết chiến lược. |
| **Giai đoạn 2 (Tương lai)**<br>`SIGNAL_SOURCE=ZUPIRUS_AGENT` | **100% từ Chiến lược tự học của ZUPIRUS**<br>(Ngắt hoàn toàn phụ thuộc copy lệnh ngoài) | **Tự hành hoàn toàn:**<br>• Chỉ kích hoạt sau khi Strategy Candidate vượt qua Walk-Forward Out-of-Sample, Shadow Forward-Test, và được Admin phê duyệt trên `adm.zupirus.com`. |

### Chu Trình Học Quy Nạp Thực Chiến (Inductive Lifecycle)

```
[ External Signal Received ] ──► [ 4 Mandatory Guards ] ──► [ Fan-Out MT5 Dispatch ]
            │                                                      │
            ▼                                                      ▼
  [ Market Context Snapshot ]                               [ Order Fill & Exit ]
  • Trading Session (Á/Âu/Mỹ)                               • Realized Net PnL
  • Live M15 ATR(14)                                        • Max Adverse Excursion (MAE)
  • Live Spread & Price Drift                               • Max Favorable Excursion (MFE)
  • News Proximity (Minutes)                                • Execution Latency
            │                                                      │
            └─────────────────────────┬────────────────────────────┘
                                      ▼
                        [ Hindsight Long-term Memory ]
                        • Episodic: Vết khớp lệnh & bối cảnh
                        • Reflective: Tự phân tích thắng / thua
                        • Semantic: Đúc kết quy tắc mẫu hình
                                      │
                                      ▼
                      [ Tabula Rasa Research Engine ]
                      • Inductive Strategy Candidate Discovery
                      • Rolling 120/60 Walk-Forward Verification
                      • Shadow Forward-Testing Mode
                                      │
                                      ▼
                        [ Admin Approval Gate ]
                     (adm.zupirus.com Approval Queue)
                                      │
                                      ▼ (Admin Confirmed)
                  [ SIGNAL_SOURCE = ZUPIRUS_AGENT ]
```


