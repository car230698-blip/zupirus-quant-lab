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

    def xadd(self, name: str, fields: Dict[str, Any], id: str = "*", maxlen: Optional[int] = None) -> str:
        with self._lock:
            if name not in self._streams:
                self._streams[name] = []
            entry_id = f"{int(time.time() * 1000)}-{len(self._streams[name])}"
            entry = {"id": entry_id, "data": fields, "ts": time.time()}
            self._streams[name].append(entry)
            if maxlen and len(self._streams[name]) > maxlen:
                self._streams[name] = self._streams[name][-maxlen:]
            return entry_id

    def xread(self, streams: Dict[str, str], count: Optional[int] = None, block: Optional[int] = None) -> List[Any]:
        with self._lock:
            results = []
            for stream_name, last_id in streams.items():
                entries = self._streams.get(stream_name, [])
                filtered = [
                    (e["id"], {k: str(v) for k, v in e["data"].items()})
                    for e in entries
                ]
                if count:
                    filtered = filtered[-count:]
                if filtered:
                    results.append((stream_name, filtered))
            return results

    def xgroup_create(self, name: str, groupname: str, id: str = "$", mkstream: bool = False) -> bool:
        if mkstream and name not in self._streams:
            self._streams[name] = []
        return True

    def xreadgroup(self, groupname: str, consumername: str, streams: Dict[str, str], count: Optional[int] = None, block: Optional[int] = None) -> List[Any]:
        return self.xread(streams, count=count, block=block)

    def xack(self, name: str, groupname: str, *ids: str) -> int:
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


def get_redis_client():
    """Return live Redis client if REDIS_URL is configured, retrying periodically if previously fallen back to mock."""
    global _redis_instance, _redis_last_retry_ts
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
            logger.warning("Could not connect to Redis (%s). Falling back to resilient in-memory mock.", e)

    if _redis_instance is None:
        _redis_instance = InMemoryRedisMock()
    return _redis_instance


# ---------------------------------------------------------------------------
# 1. Real-time Signal Distribution via Redis Streams & Pub/Sub
# ---------------------------------------------------------------------------

def publish_signal_event(signal_data: Dict[str, Any]) -> str:
    """Publish a newly generated trading signal to Redis Stream and Pub/Sub."""
    r = get_redis_client()
    payload = {
        "signal_id": str(signal_data.get("id", "")),
        "source": str(signal_data.get("source", "")),
        "side": str(signal_data.get("side", "")),
        "price": str(signal_data.get("price", 0.0)),
        "sl": str(signal_data.get("sl", 0.0)),
        "tp": str(signal_data.get("tp", 0.0)),
        "created": str(signal_data.get("created", time.time())),
        "expires": str(signal_data.get("expires", time.time() + 45)),
    }
    # Add to stream
    stream_id = r.xadd(STREAM_SIGNALS, payload, maxlen=1000)
    # Broadcast to Pub/Sub subscribers
    try:
        r.publish(CHANNEL_SIGNALS, json.dumps(payload))
    except Exception:
        pass
    return stream_id


def read_recent_signals(count: int = 20) -> List[Dict[str, Any]]:
    """Read recent signal entries from the Redis stream."""
    r = get_redis_client()
    try:
        entries = r.xread({STREAM_SIGNALS: "0-0"}, count=count)
        if not entries:
            return []
        items = []
        for stream_name, stream_entries in entries:
            for entry_id, data in stream_entries:
                item = dict(data)
                item["stream_id"] = entry_id
                items.append(item)
        return items
    except Exception as e:
        logger.debug(f"Error reading signal stream: {e}")
        return []


def consume_signals_stream(group_name: str = "cg_dispatches", consumer_name: str = "worker-1", count: int = 10) -> List[Dict[str, Any]]:
    """Consume signals using Redis Consumer Group for guaranteed durable delivery."""
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
        for stream_name, stream_entries in entries:
            for entry_id, data in stream_entries:
                item = dict(data)
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


def get_all_active_heartbeats() -> List[Dict[str, Any]]:
    """List all accounts with active (unexpired) heartbeats."""
    r = get_redis_client()
    keys = r.keys(f"{KEY_HEARTBEAT_PREFIX}*")
    result = []
    for k in keys:
        raw = r.get(k)
        if raw:
            try:
                acc_id = k.split(":")[-1]
                data = json.loads(raw)
                data["account_id"] = acc_id
                result.append(data)
            except Exception:
                pass
    return result


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

