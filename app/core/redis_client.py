"""Redis client supporting real-time signal distribution (Pub/Sub & Streams),
heartbeat caching, and distributed locking (SET NX PX) with seamless offline fallback."""
import os
import time
import json
import uuid
import logging
import threading
from typing import Any, Dict, List, Optional
from contextlib import contextmanager

logger = logging.getLogger("zupirus.redis")

REDIS_URL = os.getenv("REDIS_URL", "").strip()

STREAM_SIGNALS = "stream:signals"
CHANNEL_SIGNALS = "channel:signals"
KEY_HEARTBEAT_PREFIX = "cache:heartbeat:"
KEY_DISPATCH_LOCK_PREFIX = "lock:dispatch:"


class InMemoryRedisMock:
    """Thread-safe in-memory Redis mock for unit tests and offline operation."""
    def __init__(self):
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = {}
        self._expires: Dict[str, float] = {}
        self._streams: Dict[str, List[Dict[str, Any]]] = {STREAM_SIGNALS: []}
        self._acked: Dict[Any, set] = {}
        self._stream_seq: Dict[str, int] = {}
        self._subscribers: List[Any] = []

    def _purge_expired(self):
        now = time.time()
        expired = [k for k, exp in self._expires.items() if exp <= now]
        for k in expired:
            self._data.pop(k, None)
            self._expires.pop(k, None)

    def ping(self) -> bool:
        return True

    def set(self, name: str, value: Any, ex: Optional[int] = None, nx: bool = False, px: Optional[int] = None) -> bool:
        with self._lock:
            self._purge_expired()
            now = time.time()
            if nx and name in self._data:
                return False
            self._data[name] = str(value)
            if px:
                self._expires[name] = now + (px / 1000.0)
            elif ex:
                self._expires[name] = now + ex
            else:
                self._expires.pop(name, None)
            return True

    def get(self, name: str) -> Optional[str]:
        with self._lock:
            self._purge_expired()
            return self._data.get(name)

    def delete(self, *names: str) -> int:
        with self._lock:
            count = 0
            for name in names:
                if name in self._data:
                    del self._data[name]
                    self._expires.pop(name, None)
                    count += 1
            return count

    def eval(self, script: str, numkeys: int, *keys_and_args: Any) -> Any:
        # Atomic lock release simulation: if get(k1) == arg1 then del(k1) return 1 else return 0
        with self._lock:
            self._purge_expired()
            key = str(keys_and_args[0])
            val = str(keys_and_args[1]) if len(keys_and_args) > 1 else ""
            if self._data.get(key) == val:
                self.delete(key)
                return 1
            return 0

    @staticmethod
    def _parse_stream_id(sid: str):
        try:
            parts = str(sid).split("-", 1)
            return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
        except Exception:
            return (0, 0)

    def xadd(self, name: str, fields: Dict[str, Any], id: str = "*", maxlen: Optional[int] = None, approximate: bool = True) -> str:
        with self._lock:
            if name not in self._streams:
                self._streams[name] = []
            seq = self._stream_seq.get(name, 0) + 1
            self._stream_seq[name] = seq
            entry_id = f"{int(time.time() * 1000)}-{seq}"
            entry = {"id": entry_id, "data": fields, "ts": time.time()}
            self._streams[name].append(entry)
            if maxlen and len(self._streams[name]) > maxlen:
                self._streams[name] = self._streams[name][-maxlen:]
            return entry_id

    def xrevrange(self, name: str, max: str = "+", min: str = "-", count: Optional[int] = None) -> List[Any]:
        with self._lock:
            entries = list(reversed(self._streams.get(name, [])))
            if count:
                entries = entries[:count]
            return [(e["id"], {k: str(v) for k, v in e["data"].items()}) for e in entries]

    def xread(self, streams: Dict[str, str], count: Optional[int] = None, block: Optional[int] = None) -> List[Any]:
        with self._lock:
            results = []
            for stream_name, last_id in streams.items():
                entries = self._streams.get(stream_name, [])
                lid = str(last_id or "0-0")
                is_from_zero = lid in ("0", "0-0", "-", "", ">")
                if not is_from_zero:
                    lid_tuple = self._parse_stream_id(lid)
                    entries = [e for e in entries if self._parse_stream_id(e["id"]) > lid_tuple]
                filtered = [
                    (e["id"], {k: str(v) for k, v in e["data"].items()})
                    for e in entries
                ]
                if count:
                    filtered = filtered[-count:] if is_from_zero else filtered[:count]
                if filtered:
                    results.append((stream_name, filtered))
            return results

    def xgroup_create(self, name: str, groupname: str, id: str = "$", mkstream: bool = False) -> bool:
        with self._lock:
            if mkstream and name not in self._streams:
                self._streams[name] = []
            self._acked.setdefault((name, groupname), set())
            return True

    def xreadgroup(self, groupname: str, consumername: str, streams: Dict[str, str], count: Optional[int] = None, block: Optional[int] = None) -> List[Any]:
        with self._lock:
            results = []
            for stream_name, last_id in streams.items():
                acked_set = self._acked.get((stream_name, groupname), set())
                entries = [e for e in self._streams.get(stream_name, []) if e["id"] not in acked_set]
                lid = str(last_id or ">")
                if lid not in ("0", "0-0", "-", "", ">"):
                    lid_tuple = self._parse_stream_id(lid)
                    entries = [e for e in entries if self._parse_stream_id(e["id"]) > lid_tuple]
                filtered = [
                    (e["id"], {k: str(v) for k, v in e["data"].items()})
                    for e in entries
                ]
                if count:
                    filtered = filtered[:count]
                if filtered:
                    results.append((stream_name, filtered))
            return results

    def xack(self, name: str, groupname: str, *ids: str) -> int:
        with self._lock:
            acked_set = self._acked.setdefault((name, groupname), set())
            for item_id in ids:
                acked_set.add(str(item_id))
            return len(ids)

    def publish(self, channel: str, message: str) -> int:
        return 1

    def incr(self, key: str, amount: int = 1) -> int:
        with self._lock:
            self._purge_expired()
            cur = int(self._data.get(key) or 0) + amount
            self._data[key] = str(cur)
            return cur

    def expire(self, key: str, time_sec: int) -> bool:
        with self._lock:
            if key in self._data:
                self._expires[key] = time.time() + time_sec
                return True
            return False

    def keys(self, pattern: str = "*") -> List[str]:
        with self._lock:
            self._purge_expired()
            import fnmatch
            return [k for k in self._data.keys() if fnmatch.fnmatch(k, pattern)]


_redis_instance = None
_redis_last_retry_ts: float = 0.0
_REDIS_RETRY_INTERVAL_SEC: float = 15.0
_redis_init_lock = threading.Lock()


def reset_redis_client():
    """Clear cached Redis client after connection loss so next call reconnects."""
    global _redis_instance, _redis_last_retry_ts
    with _redis_init_lock:
        _redis_instance = None
        _redis_last_retry_ts = 0.0


def get_redis_client():
    """Return live Redis client if REDIS_URL is configured, retrying periodically if previously fallen back to mock."""
    global _redis_instance, _redis_last_retry_ts
    with _redis_init_lock:
        now = time.time()
        if _redis_instance is not None:
            if not isinstance(_redis_instance, InMemoryRedisMock) or not REDIS_URL:
                return _redis_instance
            if (now - _redis_last_retry_ts) < _REDIS_RETRY_INTERVAL_SEC:
                return _redis_instance

        if REDIS_URL:
            _redis_last_retry_ts = now
            try:
                import redis
                client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=3, socket_connect_timeout=3)
                client.ping()
                logger.info("Connected to live Redis server at %s", REDIS_URL)
                _redis_instance = client
                return _redis_instance
            except Exception as e:
                app_env = os.getenv("APP_ENV", "development").strip().lower()
                if app_env == "production":
                    logger.critical("Failed to connect to Redis server in production (%s). Fail-closed safety activated.", e)
                    raise RuntimeError(f"Production Redis connection failed (fail-closed): {e}")
                logger.warning("Could not connect to Redis (%s). Falling back to resilient in-memory mock.", e)

        app_env = os.getenv("APP_ENV", "development").strip().lower()
        if app_env == "production":
            logger.critical("REDIS_URL not configured or Redis unavailable in production. Fail-closed safety activated.")
            raise RuntimeError("Production Redis connection failed: REDIS_URL not configured or unreachable")

        if _redis_instance is None:
            _redis_instance = InMemoryRedisMock()
        return _redis_instance


# ---------------------------------------------------------------------------
# 1. Real-time Signal Distribution via Redis Streams & Pub/Sub
# ---------------------------------------------------------------------------

def publish_signal_event(signal_data: Dict[str, Any]) -> str:
    """Publish a newly generated trading signal to Redis Stream and Pub/Sub with stable event_id deduplication."""
    r = get_redis_client()
    sig_id = str(signal_data.get("id") or signal_data.get("signal_id") or "")
    event_id = str(
        signal_data.get("event_id")
        or (f"outbox_{signal_data['outbox_id']}_{sig_id}" if signal_data.get("outbox_id") is not None else f"sig_evt_{sig_id}")
    )
    payload = {
        "event_id": event_id,
        "signal_id": sig_id,
        "source": str(signal_data.get("source", "")),
        "side": str(signal_data.get("side", "")),
        "price": str(signal_data.get("price", 0.0)),
        "sl": str(signal_data.get("sl", 0.0)),
        "tp": str(signal_data.get("tp", 0.0)),
        "created": str(signal_data.get("created", time.time())),
        "expires": str(signal_data.get("expires", time.time() + 45)),
    }
    dedup_key = f"outbox:published_stream_id:{event_id}"
    try:
        existing_stream_id = r.get(dedup_key)
        if existing_stream_id:
            return str(existing_stream_id)
    except Exception:
        pass

    # Add to stream
    stream_id = r.xadd(STREAM_SIGNALS, payload, maxlen=1000)
    try:
        r.set(dedup_key, str(stream_id), ex=3600)
    except Exception:
        pass
    # Broadcast to Pub/Sub subscribers
    try:
        r.publish(CHANNEL_SIGNALS, json.dumps(payload))
    except Exception:
        pass
    return stream_id


def read_recent_signals(count: int = 20) -> List[Dict[str, Any]]:
    """Read recent signal entries from the Redis stream, deduplicating by stable event_id / signal_id."""
    r = get_redis_client()
    try:
        entries = r.xread({STREAM_SIGNALS: "0-0"}, count=count)
        if not entries:
            return []
        items = []
        seen_ids = set()
        for stream_name, stream_entries in entries:
            for entry_id, data in stream_entries:
                item = dict(data)
                dedup_token = item.get("event_id") or item.get("signal_id") or entry_id
                if dedup_token in seen_ids:
                    continue
                seen_ids.add(dedup_token)
                item["stream_id"] = entry_id
                items.append(item)
        return items
    except Exception as e:
        logger.debug(f"Error reading signal stream: {e}")
        return []


def consume_signals_stream(group_name: str = "cg_dispatches", consumer_name: str = "worker-1", count: int = 10) -> List[Dict[str, Any]]:
    """Consume signals using Redis Consumer Group for guaranteed durable delivery with event_id deduplication."""
    r = get_redis_client()
    try:
        try:
            r.xgroup_create(STREAM_SIGNALS, group_name, id="0", mkstream=True)
        except Exception:
            pass  # Group already exists
        entries = r.xreadgroup(group_name, consumer_name, {STREAM_SIGNALS: ">"}, count=count)
        if not entries:
            return []
        items = []
        seen_ids = set()
        for stream_name, stream_entries in entries:
            for entry_id, data in stream_entries:
                item = dict(data)
                dedup_token = item.get("event_id") or item.get("signal_id") or entry_id
                if dedup_token in seen_ids:
                    try:
                        r.xack(STREAM_SIGNALS, group_name, entry_id)
                    except Exception:
                        pass
                    continue
                seen_ids.add(dedup_token)
                item["stream_id"] = entry_id
                items.append(item)
        return items
    except Exception as e:
        logger.debug(f"Error consuming signal stream: {e}")
        return []


def ack_signal(stream_id: str, group_name: str = "cg_dispatches") -> bool:
    """Acknowledge message processing in Redis consumer group."""
    r = get_redis_client()
    try:
        res = r.xack(STREAM_SIGNALS, group_name, stream_id)
        return bool(res)
    except Exception as e:
        logger.debug(f"Error acking signal stream: {e}")
        return False


# ---------------------------------------------------------------------------
# 2. Heartbeat Caching
# ---------------------------------------------------------------------------

def cache_heartbeat(account_id: str, heartbeat_data: Dict[str, Any], ttl: int = 60) -> bool:
    """Cache the latest heartbeat metrics for an account with TTL."""
    r = get_redis_client()
    key = f"{KEY_HEARTBEAT_PREFIX}{account_id}"
    payload = json.dumps({
        **heartbeat_data,
        "cached_at": time.time(),
    })
    return bool(r.set(key, payload, ex=ttl))


def get_cached_heartbeat(account_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve the cached heartbeat for an account if not expired."""
    r = get_redis_client()
    key = f"{KEY_HEARTBEAT_PREFIX}{account_id}"
    raw = r.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 3. Distributed Lock (signal_id + account_id)
# ---------------------------------------------------------------------------

LUA_RELEASE_LOCK = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""


def acquire_dispatch_lock(account_id: str, signal_id: str, ttl_seconds: int = 15) -> Optional[str]:
    """Acquire a distributed lock to prevent duplicate order dispatch.
    Returns nonce token if acquired, None if locked by another worker."""
    r = get_redis_client()
    lock_key = f"{KEY_DISPATCH_LOCK_PREFIX}{account_id}:{signal_id}"
    token = str(uuid.uuid4())
    acquired = r.set(lock_key, token, nx=True, ex=ttl_seconds)
    return token if acquired else None


def release_dispatch_lock(account_id: str, signal_id: str, token: str) -> bool:
    """Atomically release the distributed lock if the token matches."""
    r = get_redis_client()
    lock_key = f"{KEY_DISPATCH_LOCK_PREFIX}{account_id}:{signal_id}"
    try:
        res = r.eval(LUA_RELEASE_LOCK, 1, lock_key, token)
        return bool(res)
    except Exception:
        # Fallback if eval is unsupported
        if r.get(lock_key) == token:
            r.delete(lock_key)
            return True
        return False


class LockAcquisitionError(Exception):
    """Raised when distributed lock cannot be acquired."""
    pass


@contextmanager
def dispatch_lock(account_id: str, signal_id: str, ttl_seconds: int = 15):
    """Context manager for distributed dispatch locking."""
    token = acquire_dispatch_lock(account_id, signal_id, ttl_seconds)
    if not token:
        raise LockAcquisitionError(f"Duplicate dispatch blocked by distributed lock: account={account_id}, signal={signal_id}")
    try:
        yield token
    finally:
        release_dispatch_lock(account_id, signal_id, token)


# ---------------------------------------------------------------------------
# 4. Real-Time SSE Event Bus (Redis Streams + In-Memory Fallback)
# ---------------------------------------------------------------------------

_RT_LOCK = threading.Lock()
_RT_LOCAL_BUS: Dict[str, List[Dict[str, Any]]] = {}


def publish_realtime_event(channel: str, event_type: str, payload: Dict[str, Any]) -> bool:
    """Publish a real-time UI event for SSE subscribers (best-effort, non-blocking)."""
    now_ts = time.time()
    entry = {
        "event": event_type,
        "data": payload,
        "ts": now_ts,
    }
    try:
        r = get_redis_client()
        stream_key = f"zupirus:rt:{channel}"
        r.xadd(stream_key, {"payload": json.dumps(entry, default=str)}, maxlen=100, approximate=True)
        return True
    except Exception:
        with _RT_LOCK:
            bucket = _RT_LOCAL_BUS.setdefault(channel, [])
            bucket.append(entry)
            if len(bucket) > 100:
                del bucket[:-100]
        return False


def poll_realtime_events(channel: str, since_ts: float) -> List[Dict[str, Any]]:
    """Read real-time events newer than since_ts for SSE delivery."""
    events: List[Dict[str, Any]] = []
    try:
        r = get_redis_client()
        stream_key = f"zupirus:rt:{channel}"
        if hasattr(r, "xrevrange"):
            rows = r.xrevrange(stream_key, count=100)
            for _msg_id, fields in reversed(rows):
                raw = fields.get("payload") if isinstance(fields, dict) else None
                if not raw:
                    continue
                item = json.loads(raw)
                if float(item.get("ts") or 0.0) > since_ts:
                    events.append(item)
            return events
    except Exception:
        pass

    with _RT_LOCK:
        for item in _RT_LOCAL_BUS.get(channel, []):
            if float(item.get("ts") or 0.0) > since_ts:
                events.append(item)
    return events


def check_rate_limit(key: str, limit: int, window_sec: int) -> bool:
    """
    Check rate limit for a given key using Redis INCR + EXPIRE.
    Returns True if request is ALLOWED (count <= limit), False if EXCEEDED (429).
    Gracefully falls back to allowing the request if Redis is unreachable.
    """
    if limit <= 0 or window_sec <= 0:
        return True
    try:
        r = get_redis_client()
        rate_key = f"zupirus:ratelimit:{key}"
        val = r.incr(rate_key)
        if val == 1:
            r.expire(rate_key, window_sec)
        return int(val) <= limit
    except Exception as exc:
        logger.warning("Rate limit check failed for key %s (falling back to ALLOW): %s", key, exc)
        return True


