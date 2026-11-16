"""MetaApi Market Data Streamer & Master Signal Feeder (24/5 Worker).
Maintains live XAUUSD tick ingestion into quotes & candle aggregation (M1, M5, M15, H1)
and synchronizes signals from the master signal feed terminal into the Quant Lab curator funnel.
"""
import os
import time
import json
import uuid
import asyncio
import logging
from typing import Dict, Any, List, Optional
import httpx

from app.db import tx, audit, is_postgres
from app.metaapi import MetaApiClient, execute_fan_out_for_signal
from app.services.sources.curator import log_shadow_signal, list_sources
from app.services.signal_ingestion.sanitizer import (
    acquire_signal_idempotency_lock,
    check_mandatory_sl_guard,
    check_news_shield_guard,
    check_slippage_guard,
    check_live_spread_guard,
)

logger = logging.getLogger("zupirus.streamer")

FEED_ACCOUNT_ID = os.getenv("METAAPI_SIGNAL_FEED_ACCOUNT_ID", "").strip()


class MarketDataStreamer:
    """Streams live quotes and copies master feed signals into ZUPIRUS Quant Lab."""

    def __init__(self, metaapi_client: Optional[MetaApiClient] = None):
        self.client = metaapi_client or MetaApiClient()
        self.feed_account_id = FEED_ACCOUNT_ID
        self.known_master_positions = set()
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
        except Exception as e:
            # If sqlite table doesn't have unique constraint, fallback to standard insert
            try:
                with tx() as c:
                    c.execute(
                        "INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (bar["symbol"], bar["timeframe"], bar["time"], bar["open"], bar["high"], bar["low"], bar["close"], bar["volume"])
                    )
            except Exception:
                pass

    async def poll_master_feed_signals(self):
        """Poll open positions on master signal feed account and route to ACTIVE_LIVE or SHADOW_ONLY."""
        if not self.feed_account_id or self.client.is_mock:
            return

        try:
            positions = await self.client.get_open_positions(self.feed_account_id)
            current_ids = {str(p.get("id")) for p in positions if p.get("id")}
            new_position_ids = current_ids - self.known_master_positions

            for pos in positions:
                pos_id = str(pos.get("id"))
                if pos_id in new_position_ids:
                    self.known_master_positions.add(pos_id)
                    await self._process_master_signal(pos)

        except Exception as e:
            logger.error(f"Error polling master signal feed: {e}")

    async def _process_master_signal(self, pos: Dict[str, Any]):
        """Process a detected position on the master feed terminal."""
        symbol = pos.get("symbol", "XAUUSD")
        pos_type = pos.get("type", "POSITION_TYPE_BUY")
        action = "BUY" if "BUY" in pos_type.upper() else "SELL"
        entry_price = float(pos.get("openPrice") or 0.0)
        sl = float(pos.get("stopLoss") or 0.0) if pos.get("stopLoss") else None
        tp = float(pos.get("takeProfit") or 0.0) if pos.get("takeProfit") else None
        pos_id = str(pos.get("id", uuid.uuid4().hex[:8]))

        # Find registered source
        sources = list_sources()
        target_source = None
        for s in sources:
            if s.get("source_type") == "METAAPI_FEED":
                target_source = s
                break

        if not target_source:
            # Default to shadow observation only (0 broker cost)
            target_source = {"id": "src_metaapi_master", "status": "SHADOW_ONLY", "name": "MetaApi Master Feed"}

        source_id = target_source["id"]
        source_status = target_source.get("status", "SHADOW_ONLY")

        logger.info(f"MASTER FEED SIGNAL DETECTED: {action} {symbol} @ {entry_price} (Source: {target_source['name']}, Status: {source_status})")

        # Route A: SHADOW_ONLY (0 execution cost, record to shadow ledger)
        if source_status != "ACTIVE_LIVE":
            log_shadow_signal(
                source_id=source_id,
                symbol=symbol,
                action=action,
                entry_price=entry_price,
                sl=sl,
                tp=tp,
                metadata={"master_position_id": pos_id}
            )
            return

        # Route B: ACTIVE_LIVE (Verify through 4 Safety Guards then execute to clients)
        # 1. Idempotency Lock
        lock_token = acquire_signal_idempotency_lock(pos_id)
        if not lock_token:
            logger.warning(f"Master feed signal {pos_id} already locked/executed. Skipping.")
            return

        # 2. Mandatory SL Guard
        ok_sl, sl_err = check_mandatory_sl_guard(sl, entry_price)
        if not ok_sl:
            logger.warning(f"Master signal rejected by Mandatory SL Guard: {sl_err}")
            return

        # 3. News Shield Guard
        now_ts = time.time()
        ok_news, news_err = check_news_shield_guard(now_ts)
        if not ok_news:
            logger.warning(f"Master signal rejected by News Shield Guard: {news_err}")
            return

        # 4. Entry Slippage Guard: Query actual latest tick quote from database
        current_market_price = entry_price
        with tx() as c:
            q_row = c.execute("SELECT bid, ask FROM quotes WHERE symbol = ? ORDER BY ts DESC LIMIT 1", (symbol,)).fetchone()
            if q_row and q_row[0] and q_row[1]:
                current_market_price = round((float(q_row[0]) + float(q_row[1])) / 2.0, 2)

        ok_slip, slip_err = check_slippage_guard(symbol, entry_price, current_market_price)
        if not ok_slip:
            logger.warning(f"Master signal rejected by Slippage Guard: {slip_err} (Live: {current_market_price}, Entry: {entry_price})")
            return

        # Execute fan-out to all deployed active accounts
        with tx() as c:
            accounts = [dict(r) for r in c.execute(
                "SELECT * FROM trading_accounts WHERE auto_trade = 1 AND metaapi_account_id IS NOT NULL"
            ).fetchall()]

        if accounts:
            signal_payload = {
                "id": pos_id,
                "symbol": symbol,
                "action": action,
                "entry_price": entry_price,
                "sl": sl,
                "tp": tp,
                "source": "METAAPI_FEED"
            }
            res = await execute_fan_out_for_signal(signal_payload, accounts, self.client)
            with tx() as c:
                audit(c, "master_feed", "live_execution_fanout", res)
            logger.info(f"Live Execution Fan-Out Finished: {res.get('executed')}/{res.get('total_accounts')} filled.")


# Singleton instance
_streamer_instance: Optional[MarketDataStreamer] = None

def get_streamer() -> MarketDataStreamer:
    global _streamer_instance
    if _streamer_instance is None:
        from app.config import METAAPI_SIGNAL_FEED_ACCOUNT_ID
        _streamer_instance = MarketDataStreamer(feed_account_id=METAAPI_SIGNAL_FEED_ACCOUNT_ID)
    return _streamer_instance
