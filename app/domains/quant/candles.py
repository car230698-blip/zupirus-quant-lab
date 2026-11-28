"""OHLC candle model, validation, and session labels.

All timestamps are Unix seconds interpreted in UTC. Studies are deterministic:
the same candles and parameters always produce the same result.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Sequence


SESSIONS = (
    ("asia", 0, 7),
    ("london", 7, 13),
    ("new_york", 13, 21),
    ("off_hours", 21, 24),
)

SESSION_LABELS = {
    "asia": {"vi": "Á", "en": "Asia"},
    "london": {"vi": "London", "en": "London"},
    "new_york": {"vi": "New York", "en": "New York"},
    "off_hours": {"vi": "Ngoài phiên chính", "en": "Off-hours"},
}


class CandleValidationError(ValueError):
    """Raised when a candle series cannot be used for a reproducible study."""


@dataclass(frozen=True)
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    @property
    def utc(self) -> datetime:
        return datetime.fromtimestamp(self.time, tz=timezone.utc)

    @property
    def session(self) -> str:
        return session_name(self.time)

    @property
    def range(self) -> float:
        return self.high - self.low

    @property
    def body(self) -> float:
        return self.close - self.open


def session_name(ts: int) -> str:
    hour = datetime.fromtimestamp(int(ts), tz=timezone.utc).hour
    for name, start, end in SESSIONS:
        if start <= hour < end:
            return name
    return "off_hours"


def _as_mapping(row: Any) -> Mapping[str, Any]:
    if isinstance(row, Mapping):
        return row
    if isinstance(row, Candle):
        return {
            "time": row.time,
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
            "volume": row.volume,
        }
    raise CandleValidationError("Each candle must be an object with time, open, high, low, and close.")


def _num(row: Mapping[str, Any], *keys: str) -> float:
    import math
    for key in keys:
        if key in row and row[key] is not None and row[key] != "":
            try:
                value = float(row[key])
            except (TypeError, ValueError, OverflowError) as exc:
                raise CandleValidationError(f"Field '{key}' is not a number.") from exc
            if not math.isfinite(value):
                raise CandleValidationError(f"Field '{key}' must be a finite number.")
            return value
    raise CandleValidationError(f"Missing numeric field: {'/'.join(keys)}.")


def _validate_unix_seconds(value: float, *, allow_millis: bool = False) -> int:
    import math
    from datetime import datetime, timezone

    if allow_millis and value > 10_000_000_000:
        value = value / 1000.0
    if value <= 0 or not math.isfinite(value):
        raise CandleValidationError("Candle time must be a positive finite Unix timestamp.")
    try:
        datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise CandleValidationError("Candle time is outside the representable UTC range.") from exc
    whole = int(value)
    if whole <= 0:
        raise CandleValidationError("Candle time must be a positive finite Unix timestamp.")
    return whole


def _time_seconds(row: Mapping[str, Any]) -> int:
    from datetime import datetime, timezone
    raw = None
    for key in ("time", "timestamp", "ts", "t"):
        if key in row and row[key] is not None and row[key] != "":
            raw = row[key]
            break
    if raw is None:
        raise CandleValidationError("Each candle needs a UTC timestamp in 'time'.")
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            raw = raw.replace(tzinfo=timezone.utc)
        try:
            # datetime.timestamp() is always seconds — do not apply the ms heuristic.
            return _validate_unix_seconds(float(raw.timestamp()), allow_millis=False)
        except (OverflowError, OSError, ValueError) as exc:
            raise CandleValidationError("Candle time is outside the representable UTC range.") from exc
    if hasattr(raw, "timestamp") and not isinstance(raw, (int, float, str)):
        raise CandleValidationError("Candle time must be a Unix timestamp or timezone-aware datetime.")
    try:
        value = float(raw)
    except (TypeError, ValueError, OverflowError) as exc:
        raise CandleValidationError("Candle time must be a Unix timestamp.") from exc
    return _validate_unix_seconds(value, allow_millis=True)


def parse_candle(row: Any, index: int = 0) -> Candle:
    data = _as_mapping(row)
    try:
        candle = Candle(
            time=_time_seconds(data),
            open=_num(data, "open", "o"),
            high=_num(data, "high", "h"),
            low=_num(data, "low", "l"),
            close=_num(data, "close", "c"),
            volume=_num(data, "volume", "v") if any(k in data and data[k] not in (None, "") for k in ("volume", "v")) else 0.0,
        )
    except CandleValidationError as exc:
        raise CandleValidationError(f"Candle #{index}: {exc}") from exc
    if min(candle.open, candle.high, candle.low, candle.close) <= 0:
        raise CandleValidationError(f"Candle #{index}: prices must be positive.")
    if candle.high < candle.low:
        raise CandleValidationError(f"Candle #{index}: high is below low.")
    if candle.high < max(candle.open, candle.close) or candle.low > min(candle.open, candle.close):
        raise CandleValidationError(f"Candle #{index}: open/close is outside the high-low range.")
    if candle.volume < 0:
        raise CandleValidationError(f"Candle #{index}: volume cannot be negative.")
    return candle


def normalize_candles(rows: Sequence[Any] | Iterable[Any]) -> List[Candle]:
    """Validate, sort, and de-duplicate candles. The last row for a timestamp wins."""
    parsed: Dict[int, Candle] = {}
    count = 0
    for index, row in enumerate(rows):
        candle = parse_candle(row, index)
        parsed[candle.time] = candle
        count += 1
    if count == 0:
        raise CandleValidationError("At least one candle is required.")
    return [parsed[ts] for ts in sorted(parsed)]


def weekday_name(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%A")


def utc_date_key(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def parse_csv_candles(csv_text: str) -> List[Dict[str, Any]]:
    """Parse CSV text from MetaTrader 4/5, TradingView, Dukascopy, or standard format into candle dicts."""
    import csv
    import io
    from datetime import datetime, timezone

    if not csv_text or not csv_text.strip():
        raise CandleValidationError("CSV dữ liệu nến trống.")

    sample = csv_text[:2048]
    delim = ","
    if "\t" in sample and sample.count("\t") > sample.count(","):
        delim = "\t"
    elif ";" in sample and sample.count(";") > sample.count(","):
        delim = ";"

    clean_lines = [
        line for line in csv_text.splitlines()
        if line.strip() and not line.strip().startswith("#") and not line.strip().startswith("//")
    ]
    if not clean_lines:
        raise CandleValidationError("Không tìm thấy dòng dữ liệu nào trong CSV (chỉ có chú thích hoặc dòng trống).")

    reader = csv.reader(io.StringIO("\n".join(clean_lines)), delimiter=delim)
    rows = [r for r in reader if r and any(cell.strip() for cell in r)]
    if not rows:
        raise CandleValidationError("Không tìm thấy dòng dữ liệu nào trong CSV.")

    header = [c.strip().lower().lstrip("<").rstrip(">") for c in rows[0]]
    has_header = any(h in header for h in ("open", "close", "time", "date", "high", "low", "timestamp"))

    data_rows = rows[1:] if has_header else rows
    if not data_rows:
        raise CandleValidationError("CSV chỉ chứa tiêu đề, không có nến dữ liệu.")

    time_idx = -1
    date_idx = -1
    open_idx = -1
    high_idx = -1
    low_idx = -1
    close_idx = -1
    vol_idx = -1

    if has_header:
        for i, h in enumerate(header):
            if h in ("time", "timestamp", "ts", "datetime", "gmt time", "date time") and time_idx == -1:
                time_idx = i
            elif h in ("date", "<date>"):
                date_idx = i
            elif h in ("time", "<time>") and date_idx != -1:
                time_idx = i
            elif h in ("open", "o", "<open>"):
                open_idx = i
            elif h in ("high", "h", "<high>"):
                high_idx = i
            elif h in ("low", "l", "<low>"):
                low_idx = i
            elif h in ("close", "c", "<close>"):
                close_idx = i
            elif h in ("volume", "vol", "v", "tickvol", "<vol>", "<tickvol>"):
                vol_idx = i
    else:
        if len(data_rows[0]) >= 6:
            date_idx, time_idx, open_idx, high_idx, low_idx, close_idx = 0, 1, 2, 3, 4, 5
            vol_idx = 6 if len(data_rows[0]) >= 7 else -1
        elif len(data_rows[0]) >= 5:
            time_idx, open_idx, high_idx, low_idx, close_idx = 0, 1, 2, 3, 4

    if open_idx == -1 or high_idx == -1 or low_idx == -1 or close_idx == -1:
        raise CandleValidationError("Không tìm thấy đủ 4 cột Open, High, Low, Close trong file CSV.")

    parsed_candles: List[Dict[str, Any]] = []

    def _parse_ts(raw_dt_str: str) -> int:
        raw = raw_dt_str.strip().replace("T", " ").replace("Z", "")
        try:
            val = float(raw)
            if val > 10_000_000_000:
                val /= 1000.0
            return int(val)
        except ValueError:
            pass

        formats = (
            "%Y-%m-%d %H:%M:%S",
            "%Y.%m.%d %H:%M:%S",
            "%Y/%m/%d %H:%M:%S",
            "%d.%m.%Y %H:%M:%S",
            "%d/%m/%Y %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y.%m.%d %H:%M",
            "%Y/%m/%d %H:%M",
            "%d.%m.%Y %H:%M",
            "%d/%m/%Y %H:%M",
            "%Y-%m-%d",
            "%Y.%m.%d",
        )
        for fmt in formats:
            try:
                dt = datetime.strptime(raw[:19], fmt).replace(tzinfo=timezone.utc)
                return int(dt.timestamp())
            except ValueError:
                continue
        raise CandleValidationError(f"Không thể nhận diện định dạng thời gian: '{raw_dt_str}'.")

    for idx, r in enumerate(data_rows):
        try:
            if date_idx != -1 and time_idx != -1 and date_idx != time_idx:
                raw_time_str = f"{r[date_idx]} {r[time_idx]}"
            elif time_idx != -1:
                raw_time_str = r[time_idx]
            elif date_idx != -1:
                raw_time_str = r[date_idx]
            else:
                raw_time_str = r[0]

            ts = _parse_ts(raw_time_str)
            op = float(r[open_idx])
            hi = float(r[high_idx])
            lo = float(r[low_idx])
            cl = float(r[close_idx])
            vl = float(r[vol_idx]) if vol_idx != -1 and vol_idx < len(r) and r[vol_idx].strip() else 0.0

            parsed_candles.append({
                "time": ts,
                "open": op,
                "high": hi,
                "low": lo,
                "close": cl,
                "volume": vl,
            })
        except (ValueError, IndexError) as exc:
            raise CandleValidationError(f"Dòng #{idx + 1}: Lỗi phân tích nến - {exc}") from exc

    return parsed_candles


def resample_candles(candles: Sequence[Candle], target_tf: str) -> List[Candle]:
    """Resample candle series into higher timeframe bars (H1, H4).
    Only includes closed/complete buckets.
    """
    tf_u = target_tf.strip().upper()
    if tf_u in ("M15", "15M"):
        return list(candles)

    bucket_secs = 3600 if tf_u in ("H1", "1H") else 14400 if tf_u in ("H4", "4H") else 86400
    if not candles:
        return []

    buckets: Dict[int, List[Candle]] = {}
    for c in candles:
        b_ts = (c.time // bucket_secs) * bucket_secs
        buckets.setdefault(b_ts, []).append(c)

    resampled: List[Candle] = []
    for b_ts in sorted(buckets.keys()):
        b_candles = buckets[b_ts]
        # Form composite candle
        op = b_candles[0].open
        hi = max(c.high for c in b_candles)
        lo = min(c.low for c in b_candles)
        cl = b_candles[-1].close
        vol = sum(c.volume for c in b_candles)
        resampled.append(Candle(time=b_ts, open=op, high=hi, low=lo, close=cl, volume=vol))

    return resampled
