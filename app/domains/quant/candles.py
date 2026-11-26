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
