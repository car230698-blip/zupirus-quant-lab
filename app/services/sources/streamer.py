"""Market Data Streamer (24/5 Worker).
Maintains live XAUUSD tick ingestion into quotes & candle aggregation (M1, M5, M15, H1)
for charting, ATR computation, and AI Agent quantitative research.
Note: Master MT5 account position copying is strictly eliminated per ZUPIRUS architecture.
"""
import time
import logging
from typing import Dict, Any, Optional

from app.db import tx
from app.metaapi import MetaApiClient

logger = logging.getLogger("zupirus.streamer")


class MarketDataStreamer:
    """Streams live quotes and aggregates M1 candles into ZUPIRUS Quant Lab."""

    def __init__(self, metaapi_client: Optional[MetaApiClient] = None):
        self.client = metaapi_client or MetaApiClient()
        self.current_m1_bars: Dict[str, Dict[str, Any]] = {}
        self.current_m15_bars: Dict[str, Dict[str, Any]] = {}

    def ingest_tick(self, symbol: str, bid: float, ask: float, ts: Optional[float] = None, source: str = "METAAPI"):
        """Save tick quote and aggregate both M1 and M15 candles per symbol."""
        now_ts = ts or time.time()
        sym = str(symbol or "XAUUSD").upper()
        dec = 2 if ("XAU" in sym or "GOLD" in sym) else (3 if "JPY" in sym else 5)
        bid_r = round(float(bid), dec)
        ask_r = round(float(ask), dec)

        try:
            from app.db import insert_timescale_quote
            insert_timescale_quote(source, now_ts, bid_r, ask_r, symbol=sym)
        except Exception:
            with tx() as c:
                c.execute(
                    "INSERT INTO quotes (ts, source, bid, ask) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    (now_ts, source, bid_r, ask_r)
                )

        mid = round((bid_r + ask_r) / 2.0, dec)

        # 1. Update M1 candle for this symbol
        bar_minute = int(now_ts // 60) * 60
        cur_m1 = self.current_m1_bars.get(sym)
        if cur_m1 is None or cur_m1["time"] != bar_minute:
            if cur_m1:
                self._save_candle(cur_m1)
            cur_m1 = {
                "symbol": sym,
                "timeframe": "M1",
                "time": bar_minute,
                "open": mid,
                "high": mid,
                "low": mid,
                "close": mid,
                "volume": 1
            }
            self.current_m1_bars[sym] = cur_m1
        else:
            cur_m1["high"] = max(cur_m1["high"], mid)
            cur_m1["low"] = min(cur_m1["low"], mid)
            cur_m1["close"] = mid
            cur_m1["volume"] += 1
        self._save_candle(cur_m1)

        # 2. Update M15 candle for this symbol
        bar_m15 = int(now_ts // 900) * 900
        cur_m15 = self.current_m15_bars.get(sym)
        if cur_m15 is None or cur_m15["time"] != bar_m15:
            if cur_m15:
                self._save_candle(cur_m15)
            cur_m15 = {
                "symbol": sym,
                "timeframe": "M15",
                "time": bar_m15,
                "open": mid,
                "high": mid,
                "low": mid,
                "close": mid,
                "volume": 1
            }
            self.current_m15_bars[sym] = cur_m15
        else:
            cur_m15["high"] = max(cur_m15["high"], mid)
            cur_m15["low"] = min(cur_m15["low"], mid)
            cur_m15["close"] = mid
            cur_m15["volume"] += 1
        self._save_candle(cur_m15)

    def _save_candle(self, bar: Dict[str, Any]):
        """Persist candle into candles table (TimescaleDB or SQLite)."""
        try:
            from app.db import insert_timescale_candle
            with tx() as c:
                insert_timescale_candle(
                    c,
                    symbol=bar["symbol"],
                    timeframe=bar["timeframe"],
                    ts=bar["time"],
                    open_p=bar["open"],
                    high_p=bar["high"],
                    low_p=bar["low"],
                    close_p=bar["close"],
                    volume=bar["volume"],
                    source="MARKET_LIVE",
                )
        except Exception as e:
            logger.debug(f"Failed saving candle {bar.get('timeframe')}: {e}")


# Singleton instance
_streamer_instance: Optional[MarketDataStreamer] = None


def get_streamer() -> MarketDataStreamer:
    global _streamer_instance
    if _streamer_instance is None:
        _streamer_instance = MarketDataStreamer()
    return _streamer_instance


def fetch_and_ingest_live_market_data(symbol: str = "XAUUSD") -> Optional[Dict[str, Any]]:
    """Fetch real live XAU/USD market quote and M15/M1 candles:
    1. Prioritizes MetaApi live symbol price when METAAPI_TOKEN & a DEPLOYED account exist.
    2. Automatically falls back to live market feed (Yahoo Finance GC=F / XAUUSD=X).
    Persists into `quotes`, `candles` (M1 & M15), and Redis `quote:XAUUSD:live`.
    """
    import os
    import httpx
    now_ts = time.time()
    headers = {"User-Agent": "ZUPIRUS-QuantLab/0.2.0 (+https://zupirus.com)"}
    bid = None
    ask = None
    m15_bars = []
    source_name = "MARKET_LIVE"

    # 1. Try MetaApi live symbol price if token is configured
    meta_token = os.getenv("METAAPI_TOKEN", "").strip()
    if meta_token and meta_token.lower() not in ("mock", "test", "demo", "none"):
        try:
            with tx() as c:
                acc_row = c.execute(
                    "SELECT metaapi_account_id FROM trading_accounts WHERE deployment_state = 'DEPLOYED' AND metaapi_account_id IS NOT NULL LIMIT 1"
                ).fetchone()
            if acc_row and acc_row[0]:
                meta_acc_id = acc_row[0]
                url_m = f"https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/{meta_acc_id}/symbols/{symbol}/current-price"
                with httpx.Client(timeout=4.0) as client:
                    rm = client.get(url_m, headers={"auth-token": meta_token})
                    if rm.status_code == 200:
                        dm = rm.json()
                        if dm.get("bid") and dm.get("ask"):
                            bid = round(float(dm["bid"]), 2)
                            ask = round(float(dm["ask"]), 2)
                            source_name = "METAAPI_STREAM"
        except Exception as e:
            logger.debug(f"MetaApi live price fallback to market feed: {e}")

    # 2. Fallback / supplement M15 history from Yahoo Finance for Gold & FX pairs
    sym_u = str(symbol or "XAUUSD").upper()
    yf_cfg = {
        "XAUUSD": (("GC=F", "XAUUSD=X"), 2, 0.14, 500.0),
        "EURUSD": (("EURUSD=X",), 5, 0.00008, 0.5),
        "GBPUSD": (("GBPUSD=X",), 5, 0.00010, 0.5),
        "USDJPY": (("JPY=X", "USDJPY=X"), 3, 0.012, 50.0),
    }
    yf_list, dec, half_spread, min_valid = yf_cfg.get(sym_u, (("GC=F", "XAUUSD=X"), 2, 0.14, 500.0))

    for yf_sym in yf_list:
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}?interval=15m&range=5d"
            with httpx.Client(timeout=6.0, headers=headers) as client:
                r = client.get(url)
                if r.status_code != 200:
                    continue
                result = r.json().get("chart", {}).get("result", [{}])[0]
                meta = result.get("meta", {})
                price = meta.get("regularMarketPrice")
                if bid is None and price and float(price) > min_valid:
                    mid = round(float(price), dec)
                    bid = round(mid - half_spread, dec)
                    ask = round(mid + half_spread, dec)

                timestamps = result.get("timestamp") or []
                quote_arr = (result.get("indicators", {}).get("quote") or [{}])[0]
                opens = quote_arr.get("open") or []
                highs = quote_arr.get("high") or []
                lows = quote_arr.get("low") or []
                closes = quote_arr.get("close") or []
                vols = quote_arr.get("volume") or []

                for i, ts_val in enumerate(timestamps):
                    if i < len(closes) and closes[i] is not None and opens[i] is not None:
                        m15_bars.append({
                            "symbol": sym_u,
                            "timeframe": "M15",
                            "time": int(ts_val),
                            "open": round(float(opens[i]), dec),
                            "high": round(float(highs[i]), dec),
                            "low": round(float(lows[i]), dec),
                            "close": round(float(closes[i]), dec),
                            "volume": int(vols[i] or 1) if i < len(vols) and vols[i] else 1,
                        })
                if bid is not None:
                    break
        except Exception as e:
            logger.debug(f"Yahoo Finance quote fetch skipped for {yf_sym}: {e}")

    if bid is None or ask is None:
        return None

    # 3. Persist live quote into DB and Redis
    try:
        from app.db import insert_timescale_quote
        insert_timescale_quote(source_name, now_ts, bid, ask, symbol=symbol)
    except Exception:
        with tx() as c:
            c.execute(
                "INSERT INTO quotes (ts, source, symbol, bid, ask) VALUES (?, ?, ?, ?, ?)",
                (now_ts, source_name, symbol, bid, ask)
            )

    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        rc.set(f"quote:{symbol}:live", f"{bid}:{ask}:{now_ts}", ex=180)
    except Exception:
        pass

    # 4. Persist M15 candles and current M1 candle
    streamer = get_streamer()
    streamer.ingest_tick(symbol=symbol, bid=bid, ask=ask, ts=now_ts, source=source_name)
    if m15_bars:
        from app.db import insert_timescale_candle
        with tx() as c:
            for bar in m15_bars[-120:]:
                try:
                    insert_timescale_candle(
                        c,
                        symbol=bar["symbol"],
                        timeframe=bar["timeframe"],
                        ts=bar["time"],
                        open_p=bar["open"],
                        high_p=bar["high"],
                        low_p=bar["low"],
                        close_p=bar["close"],
                        volume=bar["volume"],
                        source=source_name,
                    )
                except Exception:
                    pass

    return {"symbol": symbol, "bid": bid, "ask": ask, "source": source_name, "m15_bars": len(m15_bars), "ts": now_ts}


SUPPORTED_SYMBOLS = ("XAUUSD", "EURUSD", "GBPUSD", "USDJPY")
_symbol_rr_idx = 0


def fetch_next_supported_market_data() -> Optional[Dict[str, Any]]:
    """Round-robin live quote & candle feeder across XAUUSD and major FX pairs."""
    global _symbol_rr_idx
    sym = SUPPORTED_SYMBOLS[_symbol_rr_idx % len(SUPPORTED_SYMBOLS)]
    _symbol_rr_idx += 1
    return fetch_and_ingest_live_market_data(sym)
