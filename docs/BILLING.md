# ZUPIRUS Quant Lab · Product & Billing Architecture

## 1. Product Philosophy: Transparent Hybrid Tiers

ZUPIRUS Quant Lab separates **physical cloud terminal infrastructure** from **algorithmic copy-trade service tiers**. This prevents cross-subsidizing infrastructure costs while offering customers full clarity on where their subscription funds are allocated.

| Component | Cost | Value Provided |
|---|---|---|
| **Cloud MT5 Bridge Slot** | **$10 / month / account** | MetaApi `cloud-g2` isolated terminal in London Equinix datacenter. Replaces $15–$30/mo VPS fees, eliminates power outages, terminal crashes, and local MQL5 EA headaches. |
| **Starter Copy-Trade** | **$20 / month** | Full access to closed-candle quantitative signals, 100% 4 default safety guards included. Basic bundle with 1 Cloud slot = **$30/mo**. |
| **Growth Copy-Trade** | **$35 / month** | Up to 3 accounts, Custom Risk Multiplier (up to 3.0x), Auto-Compounding, Break-Even & Partial TP. Growth bundle with 1 Cloud slot = **$45/mo**. |
| **Prop Firm Alpha** | **$49 / month** | Up to 5 accounts, Prop Firm Pass Guard (Daily DD 4.5%, Profit Target 8.0%), Alpha strategies, dedicated support. Alpha bundle with 1 Cloud slot = **$59/mo**. |

---

## 2. Real-Time FX Rate Engine

To provide seamless domestic payments in Vietnam without credit card fees or conversion spreads:
- The backend queries the live USD/VND interbank rate via `FX_RATE_PROVIDER_URL`.
- The rate is cached in Redis at key `fx:usd_vnd` with a configurable TTL (default 7,200s / 2 hours).
- If the live feed fails or network is disconnected, `FALLBACK_USD_VND_RATE` (default `25,500.0`) is utilized safely.
- All amounts in VND are rounded up to the nearest 1,000 VND:
  $$\text{VND} = \left\lceil \frac{\text{USD} \times \text{Rate}}{1000} \right\rceil \times 1000$$

---

## 3. Order Rate Locking & SePay VietQR

When an investor clicks **"Tạo Mã Thanh Toán VietQR"**:
1. An order record is created in the `orders` table with status `PENDING`.
2. The current exchange rate and exact VND amount are locked for 20 minutes (`ORDER_LOCK_MINUTES`).
3. A standardized SePay VietQR image URL is generated:
   `https://qr.sepay.vn/img?acc=0336230698&bank=MBBank&amount={amount_vnd}&des=ZP%20{order_suffix}`
4. When SePay posts transaction confirmation to `/api/sepay/webhook`:
   - Matches memo pattern `ZP <order_suffix>`.
   - Transitions order status to `PAID`.
   - Upserts user subscription, extending `service_expires_at` by 30 days and updating feature flags.
   - Extends `cloud_expires_at` on associated MT5 accounts.
   - Automatically provisions/redeploys any pending MetaApi terminals with retry backoff.

