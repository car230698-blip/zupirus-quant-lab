# ZUPIRUS Quant Lab · API Reference Specification

All API endpoints follow REST conventions and return JSON payloads.

---

## 1. Billing & FX Rate Endpoints

### `GET /api/v1/billing/exchange-rate`
Retrieve current USD/VND exchange rate and tier price equivalents.
- **Response:**
  ```json
  {
    "rate": 25729.33,
    "rate_formatted": "25,729.3 VND/USD",
    "source": "API",
    "is_cached": true,
    "updated_at": 1794758526.0,
    "pricing_vnd": {
      "cloud_slot_10usd": 258000,
      "tier_starter_bundle_30usd": 772000,
      "tier_growth_bundle_45usd": 1158000,
      "tier_alpha_bundle_59usd": 1519000
    }
  }
  ```

### `POST /api/v1/billing/refresh-exchange-rate`
Force refresh the USD/VND exchange rate from the live rate provider and update Redis cache. (Requires Admin role).

### `GET /api/v1/billing/subscription`
Get the current authenticated user's subscription status and feature allowances.

### `POST /api/v1/billing/checkout`
Create a payment order with locked exchange rate and VietQR payment details.
- **Request Body:**
  ```json
  {
    "plan_tier": "growth",
    "cloud_slots": 1
  }
  ```
- **Response:**
  ```json
  {
    "id": "ord_8f293b",
    "amount_usd": 45.0,
    "locked_exchange_rate": 25729.33,
    "amount_vnd": 1158000,
    "status": "PENDING",
    "qr_code_url": "https://qr.sepay.vn/img?acc=0336230698&bank=MBBank&amount=1158000&des=ZP%208F293B",
    "payment_content": "ZP 8F293B",
    "expires_at": 1794759726.0
  }
  ```

### `GET /api/v1/billing/orders/{order_id}`
Query status of an active checkout order (`PENDING`, `PAID`, `EXPIRED`).

### `GET /api/v1/billing/admin/revenue`
Admin endpoint returning aggregated USD and VND revenue metrics and tier breakdown.

---

## 2. Webhook Ingestion Endpoints

### `POST /api/v1/webhooks/tradingview?secret={token}`
TradingView alert webhook endpoint. Evaluates signal through the 4 Safety Guards and dispatches fan-out orders to all eligible connected MT5 terminals.
- **Payload Example:**
  ```json
  {
    "action": "BUY",
    "ticker": "XAUUSD",
    "price": 2685.50,
    "sl": 2680.00,
    "tp": 2695.00,
    "strategy_tier": "STANDARD"
  }
  ```

### `POST /api/sepay/webhook`
SePay bank transaction webhook endpoint. Matches order memo (`ZP <order_suffix>`), marks order `PAID`, extends subscription and cloud slots, and auto-deploys terminals on MetaApi.

---

## 3. Trading Account Management Endpoints

### `GET /api/v1/accounts`
List connected MT5 Cloud accounts for the current user (or all if admin).

### `POST /api/v1/accounts`
Connect and provision a new MT5 terminal on MetaApi Cloud without requiring local software.
- **Request Body:**
  ```json
  {
    "login": "10928374",
    "password": "TradersPassword123",
    "server": "Exness-MT5Real",
    "account_name": "Main Gold Account",
    "risk_multiplier": 1.0,
    "is_compounding": false,
    "is_prop_firm_mode": false
  }
  ```

### `PATCH /api/v1/accounts/{account_id}`
Update account risk parameters (subject to subscription tier validation).

### `POST /api/v1/accounts/{account_id}/toggle`
Toggle automated order reception (`ACTIVE` vs `PAUSED`).

### `POST /api/v1/accounts/{account_id}/sync`
Synchronize real-time balance and equity directly from the broker via MetaApi.

### `DELETE /api/v1/accounts/{account_id}`
Undeploy MetaApi terminal and remove the account.

---

## 4. Signal Audit & Testing Endpoints

### `GET /api/v1/signals/audit-logs?limit=50`
Retrieve recent signal audit logs recorded by the safety pipeline.

### `GET /api/v1/signals/stats`
Aggregate stats on signal throughput, approval rate, rejection reasons, and execution latency.

### `POST /api/v1/signals/test-ingest`
Test ingest a hypothetical signal through the 4 guards without sending orders to broker.
