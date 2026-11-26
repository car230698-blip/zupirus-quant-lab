# ZUPIRUS Quant Lab

Educational statistical studies of forex, gold, and indices, published as PDF guides.

ZUPIRUS does not place orders, copy trades, host a cloud MT5 terminal, or rent a VPS. Figures in a guide describe a named historical sample. They are not a forecast and not a promise of profit.

| Host | Who | What |
| --- | --- | --- |
| `zupirus.com` and `www.zupirus.com` | Visitors | Landing page and the public library |
| `app.zupirus.com` | Customers | Preview, USDT checkout, purchased PDFs |
| `adm.zupirus.com` | Admin | Studies, pricing, publish, orders, buyers |

Production runs on one VPS with Docker Compose, Caddy in front of the API on `127.0.0.1:8080`, TimescaleDB/PostgreSQL, and Redis. See `DEPLOY.md` for the commands to run on that machine. See `docs/PIVOT_PLAN.md` for what changed from the old execution product.

## Local development

```bash
cp .env.example .env
# Fill POSTGRES_PASSWORD, REDIS_PASSWORD, ENCRYPTION_KEY, ADMIN_PASSWORD.
# Leave USDT wallet addresses empty until you are ready to take payment.

python3 -m pip install -r requirements.lock
npm ci
python3 -m pytest tests/ -q
npm test
```

`COMMERCIAL_REPORTS_SALE_ENABLED` stays false until a real guide is published and a receiving wallet is saved in the admin billing settings.

## What a guide contains

An admin posts OHLC candles. The lab stores them, runs the same studies every time (session behaviour, volatility regimes, Asia-range breaks, return persistence, hour and weekday seasonality, and the historical path of one illustrative rule), and writes a Vietnamese and English PDF with charts, a version, a date, and a risk disclaimer. The preview is free. The full file is sold with USDT on BEP20 or TRC20. A purchased download can append a page naming the buyer.
