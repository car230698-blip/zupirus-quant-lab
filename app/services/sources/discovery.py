"""Autonomous External Source Discovery & Cross-Asset Context Feeder (DXY / US10Y).
- Fetches live intermarket drivers (DXY `DX-Y.NYB`, US 10Y Yield `^TNX`) for Gold (XAU/USD) bias.
- Discovers and records shadow observation signals from external feeds / multi-timeframe structure
  so EOD M1 Grader & Hindsight always receive fresh real-market learning samples.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from app.db import tx, getkv
from app.services.sources.curator import create_source, record_shadow_signal

logger = logging.getLogger("zupirus.discovery")


def _fetch_yf_quote(symbol: str) -> Optional[Dict[str, float]]:
    import httpx
    headers = {"User-Agent": "ZUPIRUS-QuantLab/0.2.0 (+https://zupirus.com)"}
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=15m&range=1d"
        with httpx.Client(timeout=5.0, headers=headers) as client:
            r = client.get(url)
            if r.status_code != 200:
                return None
            res = r.json().get("chart", {}).get("result", [{}])[0]
            meta = res.get("meta", {})
            price = meta.get("regularMarketPrice")
            prev = meta.get("chartPreviousClose") or meta.get("previousClose")
            if price is None:
                return None
            p = float(price)
            pv = float(prev) if prev else p
            chg_pct = ((p - pv) / pv * 100.0) if pv else 0.0
            return {"price": round(p, 3), "change_pct": round(chg_pct, 3)}
    except Exception:
        return None


def fetch_cross_asset_context() -> Dict[str, Any]:
    """Fetch DXY and US10Y yield with 5-minute Redis cache to inform Gold (XAUUSD) macro bias."""
    now = time.time()
    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        cached = rc.get("macro:cross_asset:live")
        if cached:
            raw = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
            return json.loads(raw)
    except Exception:
        rc = None

    dxy = _fetch_yf_quote("DX-Y.NYB")
    us10y = _fetch_yf_quote("^TNX")

    bias = "NEUTRAL"
    if dxy and us10y:
        if dxy["change_pct"] <= -0.10 and us10y["change_pct"] <= 0.0:
            bias = "BULLISH_GOLD"
        elif dxy["change_pct"] >= 0.10 and us10y["change_pct"] >= 0.0:
            bias = "BEARISH_GOLD"
    elif dxy:
        if dxy["change_pct"] <= -0.15:
            bias = "BULLISH_GOLD"
        elif dxy["change_pct"] >= 0.15:
            bias = "BEARISH_GOLD"

    ctx = {
        "ts": now,
        "dxy": dxy,
        "us10y": us10y,
        "gold_macro_bias": bias,
    }
    try:
        if rc is not None:
            rc.set("macro:cross_asset:live", json.dumps(ctx), ex=300)
    except Exception:
        pass
    return ctx


def _poll_tradingview_public_scanner() -> int:
    """Poll TradingView Public Forex/Gold Scanner API across M15, H1, H4 for
    XAUUSD, EURUSD, GBPUSD, USDJPY without requiring any manual user setup."""
    import httpx
    now = time.time()
    tickers_map = {
        "OANDA:XAUUSD": ("XAUUSD", 2, 5.0),
        "FX:EURUSD": ("EURUSD", 5, 0.0025),
        "FX:GBPUSD": ("GBPUSD", 5, 0.0030),
        "FX:USDJPY": ("USDJPY", 3, 0.35),
    }
    payload = {
        "symbols": {"tickers": list(tickers_map.keys())},
        "columns": ["Recommend.All|15", "Recommend.All|60", "Recommend.All|240", "close", "ATR"],
    }
    try:
        with httpx.Client(timeout=6.0) as client:
            r = client.post("https://scanner.tradingview.com/forex/scan", json=payload)
            if r.status_code != 200:
                return 0
            rows = r.json().get("data") or []
    except Exception as e:
        logger.debug(f"TradingView public scanner skip: {e}")
        return 0

    tf_sources = [
        (0, "src_tv_m15_consensus", "TradingView Public M15 Consensus", 1800),
        (1, "src_tv_h1_consensus", "TradingView Public H1 Consensus", 3600),
        (2, "src_tv_h4_trend", "TradingView Public H4 Trend", 14400),
    ]
    ingested = 0
    for _, sid, sname, _ in tf_sources:
        create_source(
            name=sname,
            source_type="PUBLIC_SCANNER",
            status="SHADOW_ONLY",
            symbol_universe="XAUUSD,EURUSD,GBPUSD,USDJPY",
            source_id=sid,
        )

    with tx() as c:
        for row in rows:
            ticker = row.get("s")
            vals = row.get("d") or []
            if ticker not in tickers_map or len(vals) < 5:
                continue
            sym, dec, fallback_atr = tickers_map[ticker]
            price = vals[3]
            if price is None:
                continue
            entry = round(float(price), dec)
            atr = float(vals[4]) if vals[4] else fallback_atr
            sl_dist = max(atr * 1.5, fallback_atr * 0.6)
            tp_dist = sl_dist * 2.0

            for col_idx, sid, _, cooldown in tf_sources:
                rec = vals[col_idx]
                if rec is None:
                    continue
                rec_f = float(rec)
                if rec_f >= 0.35:
                    side = "BUY"
                elif rec_f <= -0.35:
                    side = "SELL"
                else:
                    continue

                recent = c.execute(
                    "SELECT id FROM shadow_signals WHERE source_id = ? AND symbol = ? AND signal_time >= ?",
                    (sid, sym, now - cooldown),
                ).fetchone()
                if recent:
                    continue

                sl_p = round(entry - sl_dist if side == "BUY" else entry + sl_dist, dec)
                tp_p = round(entry + tp_dist if side == "BUY" else entry - tp_dist, dec)
                record_shadow_signal(
                    source_id=sid,
                    symbol=sym,
                    side=side,
                    entry_price=entry,
                    stop_loss=sl_p,
                    take_profit=tp_p,
                    signal_time=now,
                    db_cursor=c,
                )
                ingested += 1
    return ingested


def discover_and_ingest_external_signals() -> Dict[str, Any]:
    """Autonomously poll public TradingView Scanner, configured external feeds, and
    cross-asset structure across XAUUSD, EURUSD, GBPUSD, USDJPY into SHADOW_ONLY."""
    now = time.time()
    ingested = _poll_tradingview_public_scanner()

    # 1. Check any custom discovery feeds stored in kv (`discovery:feeds`)
    feeds: List[Dict[str, Any]] = []
    with tx() as c:
        raw_feeds = getkv(c, "discovery:feeds")
        if raw_feeds:
            try:
                feeds = json.loads(raw_feeds)
            except Exception:
                feeds = []

    if feeds:
        import hashlib
        import httpx
        for feed in feeds[:5]:
            url = str(feed.get("url") or "").strip()
            url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()[:10]
            sid = str(feed.get("source_id") or "").strip() or f"src_disc_{url_hash}"
            sname = str(feed.get("name") or sid)
            if not url:
                continue
            try:
                with httpx.Client(timeout=6.0) as client:
                    resp = client.get(url)
                    if resp.status_code != 200:
                        continue
                    items = resp.json()
                    if isinstance(items, dict):
                        items = items.get("signals") or [items]
                    create_source(name=sname, source_type="AUTO_DISCOVERY", status="SHADOW_ONLY", source_id=sid)
                    with tx() as c:
                        for item in (items or [])[:3]:
                            side = str(item.get("action") or item.get("side") or "").upper()
                            entry = float(item.get("entry_price") or item.get("price") or 0)
                            sl = float(item.get("sl") or item.get("stop_loss") or 0)
                            tp = float(item.get("tp") or item.get("take_profit") or 0)
                            if side in ("BUY", "SELL") and entry > 0 and sl > 0:
                                recent = c.execute(
                                    "SELECT id FROM shadow_signals WHERE source_id = ? AND signal_time >= ?",
                                    (sid, now - 1800),
                                ).fetchone()
                                if not recent:
                                    record_shadow_signal(
                                        source_id=sid,
                                        symbol=str(item.get("symbol") or "XAUUSD").upper(),
                                        side=side,
                                        entry_price=entry,
                                        stop_loss=sl,
                                        take_profit=tp or None,
                                        signal_time=now,
                                        db_cursor=c,
                                    )
                                    ingested += 1
            except Exception as e:
                logger.debug(f"Discovery feed poll skipped for {url}: {e}")

    # 2. Cross-asset intermarket shadow observer (DXY/US10Y + M15 XAUUSD live quote)
    ctx = fetch_cross_asset_context()
    bias = ctx.get("gold_macro_bias", "NEUTRAL")
    if bias in ("BULLISH_GOLD", "BEARISH_GOLD"):
        sid = "src_auto_cross_asset"
        create_source(
            name="Auto Cross-Asset (DXY/US10Y)",
            source_type="AUTO_DISCOVERY",
            status="SHADOW_ONLY",
            source_id=sid,
        )
        with tx() as c:
            q_row = c.execute(
                "SELECT bid, ask, ts FROM quotes WHERE symbol = 'XAUUSD' ORDER BY ts DESC LIMIT 1"
            ).fetchone()
            recent = c.execute(
                "SELECT id FROM shadow_signals WHERE source_id = ? AND signal_time >= ?",
                (sid, now - 3600),
            ).fetchone()
            if q_row and not recent and (now - float(q_row[2] or 0)) < 180:
                mid = round((float(q_row[0]) + float(q_row[1])) / 2.0, 2)
                is_buy = bias == "BULLISH_GOLD"
                record_shadow_signal(
                    source_id=sid,
                    symbol="XAUUSD",
                    side="BUY" if is_buy else "SELL",
                    entry_price=mid,
                    stop_loss=round(mid - 5.0 if is_buy else mid + 5.0, 2),
                    take_profit=round(mid + 10.0 if is_buy else mid - 10.0, 2),
                    signal_time=now,
                    db_cursor=c,
                )
                ingested += 1

    return {"ok": True, "ingested": ingested, "cross_asset_bias": bias}
