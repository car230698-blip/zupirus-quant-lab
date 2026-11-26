# Pivot plan — ZUPIRUS Quant Lab

Owner: Minh Hoang. Site: https://zupirus.com. Decision date: 25 November 2026. This repository is the implementation of that decision.

The product is a library of quantitative studies sold as PDF guides. It is not a trading terminal.

## What the repository was

A single FastAPI process, a React/Vite front end, TimescaleDB, Redis, and Caddy. Domains were already split the way production uses them:

- `zupirus.com` / `www` — public site
- `app.zupirus.com` — signed-in customer
- `adm.zupirus.com` — admin, blocked on the other hosts

The old product connected customer MT5 accounts through MetaApi, fanned signals out to those accounts, ran a risk watcher (break-even, partial close, daily drawdown, Friday flatten), took TradingView webhooks, and billed Cloud MT5 slots. SePay/VietQR was the original cashier. USDT BEP20/TRC20 was added later. A partial pivot had already started: research report tables, a PDF catalog, and a hard lock that refuses customer auto-trading when `APP_ENV=production`. The public site and a lot of internal copy still described Cloud MT5, VPS, prop-firm automation, and profit-shaped metrics. Migration 028, as it stood on `main`, dropped historical trading tables.

## What is removed or switched off

Nothing here deletes production rows.

| Area | What happens now |
| --- | --- |
| Compose execution worker | Not in `compose.yaml`. `scripts/verify_package.py` fails if it comes back. |
| `python -m app.engine` | If someone starts it, and the legacy flag is off, it only writes a heartbeat and exits the trade loop. Production sets the flag false. |
| Research loop (`signal discovery`, walk-forward induction, macro station) | `research_graph.main` redirects to the quant librarian unless `ENABLE_LEGACY_RESEARCH_LOOP=true`. Compose runs `python -m app.domains.quant.worker` directly. |
| TradingView / copy-trade dispatch | Existing webhook code still checks `is_customer_auto_trading_enabled()`, which is false in production with no bypass. |
| Customer MT5 connect / deploy routes | Already absent. Tests that required them are listed in `tests/conftest.py` `collect_ignore`. |
| `app.domains.execution.fanout` and `watcher` | Stay deleted. A guardrail test asserts the fan-out module does not import. |
| Migration 028 | Records `legacy_customer_execution=retired` in `kv`. It does not `DROP TABLE`. |
| Landing, portal, SEO, i18n | Copy that sold Cloud MT5, VPS, prop-firm automation, or a profit outcome was rewritten or taken off the landing page. Old section components remain in the tree and are not mounted. |
| SePay as a sales register | Gateway flag is false. Report checkout rejects SePay/VietQR and asks for USDT. |
| Receiving-wallet fallback | Checkout no longer substitutes the public USDT token contract as a destination. No wallet configured means HTTP 400. |

`ENABLE_LEGACY_CUSTOMER_EXECUTION=true` can still be set outside production for a local experiment. Production compose forces it false.

## What is kept and reused

- Accounts, sessions, password hashing, email OTP, admin role, CSRF header `X-Zupirus`.
- TimescaleDB `candles` hypertable (and the SQLite equivalent) via `insert_timescale_candle`.
- `research_reports`, `report_versions`, `report_entitlements`, and `orders.product_type = PDF_REPORT`.
- USDT amount locking, on-chain match, and idempotent entitlement grant in `app/domains/billing/crypto_direct.py`.
- Admin user list and the existing report publish / unpublish / price update routes.
- Redis, Caddy host split, loopback binds, and the `lab_data` volume for PDF files.
- The pure-Python PDF helper is still used for older sample files. New methodology PDFs use ReportLab and DejaVu so Vietnamese accents survive.

## Target architecture

```
Browser  →  Caddy / NPM  →  API (127.0.0.1:8080)
                              ├─ auth, catalog, checkout, signed download
                              ├─ admin studies and publish
                              └─ quant librarian (heartbeat + USDT reconcile)
                           TimescaleDB  candles, studies, orders, users
                           Redis        locks and cache
                           lab_data     preview and full PDFs
```

Studies are pure functions in `app/domains/quant/studies.py`. The same candles and the same parameters produce the same tables. A methodology document (`methodology.py`) turns that bundle into Vietnamese and English sections plus the disclaimer. `pdf_doc.py` draws the tables and bar charts. `service.py` stores the candles, the study JSON, the document JSON, and a DRAFT row in `research_reports`. Publishing is still a separate admin action. A buyer download of a watermarked guide appends a page with their email and the version. The link itself remains the existing HMAC token, valid for at most 15 minutes, and it is bound to the signed-in user.

### Studies included

- Session profile (Asia 00:00–07:00, London 07:00–13:00, New York 13:00–21:00, off-hours, all UTC).
- ATR regimes split at the 33rd and 66th percentile of that sample.
- How often London breaks the same-day Asia range, and whether the London close stays outside.
- Lag-1 autocorrelation and directional persistence of close-to-close returns.
- Open-to-close average by UTC hour and by weekday.
- One illustrative rule: first London or New York break of the Asia high or low, stop at the other side, target 1R, same-bar stop-and-target counted as a loss, optional round-trip cost in R. The output is expectancy, win rate, profit factor, and maximum drawdown on that path only.

The rule text in the PDF says the path is historical. It does not say the reader should trade it.

### Admin API

- `POST /api/v1/admin/quant/studies` — candles in, draft report out. `price_usd` is required so a price is a decision, not a hidden default.
- `GET /api/v1/admin/quant/studies`
- `GET /api/v1/admin/library/orders`
- `GET /api/v1/admin/library/buyers`
- Existing `POST /api/v1/admin/reports/{id}/publish`, price patch, and discontinue.

### Migrations

| Version | Effect on an existing production database |
| --- | --- |
| 001–027 | Unchanged. Already applied databases skip them. |
| 028 | Upserts two `kv` flags. Does not drop tables. If a database already applied the old 028 and lost tables, this change does not bring the rows back. Restore that database from the backup in `DEPLOY.md` if those rows are still needed. |
| 029 | Creates `quant_studies` and `methodologies` if missing. Adds `research_reports.watermark_enabled` (default 0) and `report_entitlements.download_count` (default 0). |

## Copy rules

Do not write “cam kết lợi nhuận”, win-rate advertising, or “pass the prop firm” claims. A number in a guide is tied to a sample, a clock, and a cost parameter. The disclaimer is in both languages, on the preview and on the full file.

## Owner decisions still open

- The price of the first guide. The API requires a price per draft. Landing cards show example amounts (0 for the preview, 29 and 49 USD) so the page is not empty. They are not a price list.
- The first topics. The engine can run on XAUUSD, EURUSD, GBPUSD, USDJPY, or an index once OHLC is loaded. No topic is published as the flagship.
- Whether `COMMERCIAL_REPORTS_SALE_ENABLED` should stay false until that first PDF is read by the owner. The default in production compose is false.
- The BEP20 and TRC20 receiving addresses. They are not in the repo.
- Whether old Cloud MT5 subscription orders should stay visible in the admin order list for accounting. They are not deleted.
- Whether to keep the unmounted React components that still describe the old terminal (`LandingGuardSimulatorSection`, lot calculator, account tabs). They are not on the landing page. Deleting them is a later cleanup, not required to stop selling the old product.
- A real OHLC vendor. Import is a JSON post of candles or rows already in `candles`. There is no broker feed in the librarian.

## Tests

`pytest tests/` runs the library, checkout, auth, and architecture checks. Modules that only asserted the removed fan-out and MT5 account routes are listed in `collect_ignore` so the suite matches the product that ships. New coverage:

- `tests/test_quant_studies.py` — sessions, validation, reproducibility, the rule’s R multiple, cost, persistence, bilingual PDF, buyer name on the license page.
- `tests/test_quant_library_api.py` — draft hidden until publish, USDT checkout, watermarked download, buyers and orders, migration 028 keeps `trading_accounts`, checkout without a wallet is rejected.

## Secrets

See the release report for the names that appeared in git history. Values are not repeated here. Placeholders live only in `.env.example`.
