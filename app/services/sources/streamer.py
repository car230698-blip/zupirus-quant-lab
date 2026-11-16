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
        self.current_m1_bar = None

    def ingest_tick(self, symbol: str, bid: float, ask: float, ts: Optional[float] = None, source: str = "METAAPI"):
        """Save tick quote and aggregate M1 candle."""
        now_ts = ts or time.time()
        with tx() as c:
            c.execute(
                "INSERT INTO quotes (ts, source, bid, ask) VALUES (?, ?, ?, ?)",
                (now_ts, source, round(bid, 2), round(ask, 2))
            )

        # Update M1 candle
        bar_minute = int(now_ts // 60) * 60
        mid = (bid + ask) / 2.0
        if self.current_m1_bar is None or self.current_m1_bar["time"] != bar_minute:
            # Flush previous bar if existed
            if self.current_m1_bar:
                self._save_candle(self.current_m1_bar)
            self.current_m1_bar = {
                "symbol": symbol,
                "timeframe": "M1",
                "time": bar_minute,
                "open": mid,
                "high": mid,
                "low": mid,
                "close": mid,
                "volume": 1
            }
        else:
            b = self.current_m1_bar
            b["high"] = max(b["high"], mid)
            b["low"] = min(b["low"], mid)
            b["close"] = mid
            b["volume"] += 1

    def _save_candle(self, bar: Dict[str, Any]):
        """Persist closed candle into candles table."""
        try:
            with tx() as c:
                c.execute(
                    """
                    INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(symbol, timeframe, time) DO UPDATE SET
                    high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume
                    """,
                    (bar["symbol"], bar["timeframe"], bar["time"], bar["open"], bar["high"], bar["low"], bar["close"], bar["volume"])
                )
        except Exception:
            try:
                with tx() as c:
                    c.execute(
                        "INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (bar["symbol"], bar["timeframe"], bar["time"], bar["open"], bar["high"], bar["low"], bar["close"], bar["volume"])
                    )
            except Exception:
                pass


# Singleton instance
_streamer_instance: Optional[MarketDataStreamer] = None


def get_streamer() -> MarketDataStreamer:
    global _streamer_instance
    if _streamer_instance is None:
        _streamer_instance = MarketDataStreamer()
    return _streamer_instance
