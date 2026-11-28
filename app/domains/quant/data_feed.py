"""Automated OHLCV market data ingestion feed for ZUPIRUS Quant Lab.

Retrieves institutional COMEX Gold (GC=F) and major FX historical candles from public feeds,
validates integrity, normalizes into UTC Candle objects, and stores into TimescaleDB/SQLite.
Zero-credential, deterministic, independent of any broker account.
"""
from __future__ import annotations

import json
import logging
import math
import urllib.request
from datetime import datetime, timezone
import hashlib
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.db import insert_timescale_candle, is_postgres, tx
from app.domains.quant.candles import Candle, CandleValidationError, normalize_candles

logger = logging.getLogger("zupirus.quant.data_feed")

SYMBOL_MAP = {
    "XAUUSD": "XAUUSD=X",
    "GOLD": "XAUUSD=X",
    "XAU/USD": "XAUUSD=X",
    "GC=F": "GC=F",
    "EURUSD": "EURUSD=X",
    "EUR/USD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "GBP/USD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "USD/JPY": "USDJPY=X",
    "BTCUSD": "BTC-USD",
    "BTC/USD": "BTC-USD",
    "BTCUSDT": "BTC-USD",
    "BTC-USD": "BTC-USD",
    "US30": "^DJI",
    "DJI": "^DJI",
    "^DJI": "^DJI",
}

TIMEFRAME_MAP = {
    "M15": "15m",
    "H1": "1h",
    "D1": "1d",
    "M5": "5m",
}


@dataclass
class DatasetIdentity:
    """Explicit identity and audit trail for a market dataset."""
    asset_class: str
    symbol: str
    symbol_display: str
    provider: str
    timeframe: str
    timezone: str
    bars_count: int
    start_time_utc: str
    end_time_utc: str
    cutoff_date: str
    data_version_id: str
    data_sha256: str
    is_spot_confirmed: bool
    limitations: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "asset_class": self.asset_class,
            "symbol": self.symbol,
            "symbol_display": self.symbol_display,
            "provider": self.provider,
            "timeframe": self.timeframe,
            "timezone": self.timezone,
            "bars_count": self.bars_count,
            "start_time_utc": self.start_time_utc,
            "end_time_utc": self.end_time_utc,
            "cutoff_date": self.cutoff_date,
            "data_version_id": self.data_version_id,
            "data_sha256": self.data_sha256,
            "is_spot_confirmed": self.is_spot_confirmed,
            "limitations": self.limitations,
        }


def compute_candles_sha256(candles: Sequence[Candle]) -> str:
    """Compute deterministic cryptographic SHA-256 fingerprint over candle stream."""
    if not candles:
        return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"  # SHA-256 of empty string
    hasher = hashlib.sha256()
    for c in candles:
        row_str = f"{int(c.time)}:{c.open:.4f}:{c.high:.4f}:{c.low:.4f}:{c.close:.4f}:{c.volume:.2f}\n"
        hasher.update(row_str.encode("utf-8"))
    return hasher.hexdigest()


def build_dataset_identity(symbol: str, timeframe: str, candles: Sequence[Candle]) -> DatasetIdentity:
    """Build verifiable dataset identity conforming to institutional provenance standards."""
    sym_u = symbol.strip().upper()
    tf_u = timeframe.strip().upper()
    bars_n = len(candles)

    start_iso = datetime.fromtimestamp(candles[0].time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if bars_n > 0 else "N/A"
    end_iso = datetime.fromtimestamp(candles[-1].time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if bars_n > 0 else "N/A"
    cutoff = datetime.fromtimestamp(candles[-1].time, tz=timezone.utc).strftime("%Y-%m-%d") if bars_n > 0 else "N/A"

    data_hash = compute_candles_sha256(candles)
    canonical_sym = SYMBOL_MAP.get(sym_u, sym_u).replace("=", "_").replace("^", "").replace("-", "_")
    version_id = f"ds_{canonical_sym}_{tf_u}_{data_hash[:8]}"

    if sym_u in ("GC=F", "COMEX_GOLD"):
        return DatasetIdentity(
            asset_class="COMEX_GOLD_FUTURES",
            symbol="GC=F",
            symbol_display="Hợp đồng tương lai vàng COMEX (COMEX Gold Futures - GC=F)",
            provider="Yahoo Finance / COMEX",
            timeframe=tf_u,
            timezone="UTC",
            bars_count=bars_n,
            start_time_utc=start_iso,
            end_time_utc=end_iso,
            cutoff_date=cutoff,
            data_version_id=version_id,
            data_sha256=data_hash,
            is_spot_confirmed=False,
            limitations=(
                "Dữ liệu nguồn được thu thập từ hợp đồng tương lai vàng COMEX (GC=F), không phải giá giao ngay "
                "XAU/USD Spot OTC hay CFD. Giá tương lai có chênh lệch basis, chi phí rollover và đặc tính thanh khoản riêng. "
                "Nghiên cứu mang tính thăm dò cấu trúc giá vàng tương lai, không công bố hay bảo đảm lợi thế thực nghiệm "
                "trên thị trường Spot khi chưa có dữ liệu tick Spot trực tiếp."
            ),
        )
    elif sym_u in ("XAUUSD", "GOLD", "XAU/USD", "XAUUSD=X"):
        return DatasetIdentity(
            asset_class="SPOT_COMMODITY",
            symbol="XAUUSD=X",
            symbol_display="Vàng giao ngay Spot Gold (XAU/USD)",
            provider="Yahoo Finance / Spot Gold Benchmark",
            timeframe=tf_u,
            timezone="UTC",
            bars_count=bars_n,
            start_time_utc=start_iso,
            end_time_utc=end_iso,
            cutoff_date=cutoff,
            data_version_id=version_id,
            data_sha256=data_hash,
            is_spot_confirmed=True,
            limitations="Dữ liệu giá giao ngay XAU/USD OTC tham chiếu. Cần lưu ý spread thực tế từ broker có thể giãn mạnh trong các phiên giao dịch có tin tức biến động mạnh.",
        )
    elif sym_u in ("USDJPY", "USD/JPY", "USDJPY=X"):
        return DatasetIdentity(
            asset_class="FOREX_SPOT",
            symbol="USDJPY=X",
            symbol_display="Tỷ giá USD/JPY Spot Benchmark",
            provider="Yahoo Finance / FX Benchmark",
            timeframe=tf_u,
            timezone="UTC",
            bars_count=bars_n,
            start_time_utc=start_iso,
            end_time_utc=end_iso,
            cutoff_date=cutoff,
            data_version_id=version_id,
            data_sha256=data_hash,
            is_spot_confirmed=True,
            limitations="Dữ liệu tham chiếu OTC tổng hợp, không bao gồm độ giãn spread trong thời điểm tin tức kinh tế quan trọng.",
        )
    elif sym_u in ("EURUSD", "EUR/USD", "EURUSD=X"):
        return DatasetIdentity(
            asset_class="FOREX_SPOT",
            symbol="EURUSD=X",
            symbol_display="Tỷ giá EUR/USD Spot Benchmark",
            provider="Yahoo Finance / FX Benchmark",
            timeframe=tf_u,
            timezone="UTC",
            bars_count=bars_n,
            start_time_utc=start_iso,
            end_time_utc=end_iso,
            cutoff_date=cutoff,
            data_version_id=version_id,
            data_sha256=data_hash,
            is_spot_confirmed=True,
            limitations="Dữ liệu tham chiếu OTC tổng hợp, không bao gồm độ giãn spread trong thời điểm tin tức kinh tế quan trọng.",
        )
    elif sym_u in ("BTCUSD", "BTC/USD", "BTCUSDT", "BTC-USD"):
        return DatasetIdentity(
            asset_class="CRYPTO_SPOT",
            symbol="BTC-USD",
            symbol_display="Bitcoin Spot (BTC/USD)",
            provider="Yahoo Finance / Crypto Aggregator",
            timeframe=tf_u,
            timezone="UTC",
            bars_count=bars_n,
            start_time_utc=start_iso,
            end_time_utc=end_iso,
            cutoff_date=cutoff,
            data_version_id=version_id,
            data_sha256=data_hash,
            is_spot_confirmed=True,
            limitations="Dữ liệu giá tổng hợp từ các sàn giao dịch giao ngay, có thể chênh lệch vi mô giữa các sàn thanh khoản khác nhau.",
        )
    else:
        return DatasetIdentity(
            asset_class="SYNTHETIC_OR_CUSTOM",
            symbol=sym_u,
            symbol_display=f"{sym_u} ({tf_u})",
            provider="Local / Custom Feed",
            timeframe=tf_u,
            timezone="UTC",
            bars_count=bars_n,
            start_time_utc=start_iso,
            end_time_utc=end_iso,
            cutoff_date=cutoff,
            data_version_id=version_id,
            data_sha256=data_hash,
            is_spot_confirmed=False,
            limitations="Dữ liệu tùy chỉnh hoặc thử nghiệm cục bộ, không dùng để công bố khuyến nghị thương mại.",
        )


def _resolve_yahoo_symbol_and_interval(symbol: str, timeframe: str) -> Tuple[str, str]:
    sym_clean = symbol.strip().upper()
    tf_clean = timeframe.strip().upper()
    yahoo_sym = SYMBOL_MAP.get(sym_clean, sym_clean)
    yahoo_interval = TIMEFRAME_MAP.get(tf_clean, "15m")
    return yahoo_sym, yahoo_interval


def fetch_public_ohlcv(
    symbol: str = "XAUUSD",
    timeframe: str = "M15",
    range_str: str = "5d",
    timeout_sec: int = 15,
) -> List[Candle]:
    """Fetch raw OHLCV bars from Yahoo Finance chart API and return normalized Candle objects."""
    yahoo_sym, yahoo_interval = _resolve_yahoo_symbol_and_interval(symbol, timeframe)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}?interval={yahoo_interval}&range={range_str}"

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            if resp.status != 200:
                raise ValueError(f"Public feed returned HTTP status {resp.status}")
            raw_data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.error(f"Failed to fetch public OHLCV for {symbol} ({yahoo_sym}): {exc}")
        raise RuntimeError(f"Không thể kết nối nguồn dữ liệu nến cho {symbol}: {exc}") from exc

    results = raw_data.get("chart", {}).get("result")
    if not results or not isinstance(results, list):
        raise ValueError(f"No chart data found for symbol {symbol}")

    chart = results[0]
    timestamps = chart.get("timestamp") or []
    quote = chart.get("indicators", {}).get("quote", [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    n = min(len(timestamps), len(opens), len(highs), len(lows), len(closes))
    if n == 0:
        return []

    raw_candidates = []
    for i in range(n):
        ts = timestamps[i]
        o = opens[i]
        h = highs[i]
        l = lows[i]
        c = closes[i]
        v = volumes[i] if i < len(volumes) and volumes[i] is not None else 1.0

        if any(x is None for x in (ts, o, h, l, c)):
            continue
        try:
            o_f, h_f, l_f, c_f = float(o), float(h), float(l), float(c)
            v_f = float(v) if v is not None else 1.0
            if min(o_f, h_f, l_f, c_f) <= 0 or not all(math.isfinite(x) for x in (o_f, h_f, l_f, c_f)):
                continue
            # Correct any micro-inconsistencies where high < max(open, close)
            h_f = max(h_f, o_f, c_f)
            l_f = min(l_f, o_f, c_f)
            raw_candidates.append({
                "time": int(ts),
                "open": o_f,
                "high": h_f,
                "low": l_f,
                "close": c_f,
                "volume": v_f,
            })
        except Exception:
            continue

    if not raw_candidates:
        return []

    return normalize_candles(raw_candidates)


def sync_market_candles(
    symbol: str = "XAUUSD",
    timeframe: str = "M15",
    range_str: str = "5d",
) -> Dict[str, Any]:
    """Fetch latest candles and upsert into TimescaleDB/SQLite."""
    sym_clean = symbol.strip().upper()
    tf_clean = timeframe.strip().upper()

    candles = fetch_public_ohlcv(symbol=sym_clean, timeframe=tf_clean, range_str=range_str)
    if not candles:
        return {
            "symbol": sym_clean,
            "timeframe": tf_clean,
            "synced_count": 0,
            "status": "EMPTY_FEED",
            "message": f"Không có nến mới nào từ nguồn cho {sym_clean} ({tf_clean})",
        }

    saved_count = 0
    with tx() as conn:
        for bar in candles:
            insert_timescale_candle(
                conn,
                symbol=sym_clean,
                timeframe=tf_clean,
                ts=float(bar.time),
                open_p=bar.open,
                high_p=bar.high,
                low_p=bar.low,
                close_p=bar.close,
                volume=bar.volume,
                source="MARKET_LIVE",
                replace_ohlcv=True,
            )
            saved_count += 1

    cand_dicts = [
        {
            "time": c.time,
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
            "volume": c.volume,
        }
        for c in candles
    ]
    start_dt = datetime.fromtimestamp(candles[0].time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    end_dt = datetime.fromtimestamp(candles[-1].time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return {
        "symbol": sym_clean,
        "timeframe": tf_clean,
        "synced_count": saved_count,
        "total_candles": len(candles),
        "earliest": candles[0].time,
        "latest": candles[-1].time,
        "start_datetime": start_dt,
        "end_datetime": end_dt,
        "status": "OK",
        "message": f"Đã đồng bộ thành công {saved_count} nến {sym_clean} ({tf_clean}) vào TimescaleDB.",
        "candles": cand_dicts,
    }


def get_market_data_status() -> List[Dict[str, Any]]:
    """Inspect candle inventory across tracked symbols and timeframes."""
    symbols = ["XAUUSD", "EURUSD", "GBPUSD"]
    timeframes = ["M15", "H1"]
    status_list = []

    with tx() as conn:
        for sym in symbols:
            for tf in timeframes:
                try:
                    row = conn.execute(
                        """
                        SELECT COUNT(*) as cnt, MIN(time) as min_ts, MAX(time) as max_ts
                        FROM candles
                        WHERE symbol = ? AND timeframe = ?
                        """,
                        (sym, tf),
                    ).fetchone()

                    cnt = int(row[0] or 0) if row else 0
                    min_ts = row[1] if row and row[1] else None
                    max_ts = row[2] if row and row[2] else None

                    status_list.append({
                        "symbol": sym,
                        "timeframe": tf,
                        "count": cnt,
                        "earliest_ts": str(min_ts) if min_ts else None,
                        "latest_ts": str(max_ts) if max_ts else None,
                        "health": "HEALTHY" if cnt >= 50 else ("LOW_DATA" if cnt > 0 else "NO_DATA"),
                    })
                except Exception as exc:
                    logger.debug(f"Error querying candle status for {sym} {tf}: {exc}")
                    status_list.append({
                        "symbol": sym,
                        "timeframe": tf,
                        "count": 0,
                        "earliest_ts": None,
                        "latest_ts": None,
                        "health": "ERROR",
                        "error": str(exc),
                    })

    return status_list
