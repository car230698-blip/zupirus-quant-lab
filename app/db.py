"""Database abstraction supporting PostgreSQL + TimescaleDB (with hypertables and time-series queries)
and automatic fallback to SQLite WAL for standalone testing."""
import os
import re
import time
import json
import sqlite3
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("zupirus.db")

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.getenv('DATA_DIR', ROOT / 'runtime'))
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / 'lab.sqlite3'

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

_pg_pool = None


class DatabaseUnavailableError(RuntimeError):
    """Raised when the primary database is configured but unavailable."""
    pass


def is_postgres() -> bool:
    """Return True if PostgreSQL / TimescaleDB is configured."""
    return bool(DATABASE_URL and (DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")))


def _configure_pg_conn(conn):
    """Set socket timeouts on PostgreSQL connection so paused/frozen servers abort quickly."""
    try:
        import socket
        raw_sock = getattr(getattr(conn, "pgconn", None), "socket", -1)
        fd = raw_sock() if callable(raw_sock) else raw_sock
        if isinstance(fd, int) and fd > 0:
            s = socket.fromfd(fd, socket.AF_INET, socket.SOCK_STREAM)
            try:
                s.settimeout(3.0)
            finally:
                s.close()
    except Exception:
        pass


def get_pg_pool():
    """Lazily initialize and return the PostgreSQL connection pool."""
    global _pg_pool
    if _pg_pool is None and is_postgres():
        try:
            from psycopg_pool import ConnectionPool
            # Clean connection string for psycopg
            conn_str = DATABASE_URL
            if conn_str.startswith("postgres://"):
                conn_str = "postgresql://" + conn_str[11:]
            _pg_pool = ConnectionPool(
                conn_str,
                min_size=2,
                max_size=20,
                timeout=3.0,
                open=True,
                configure=_configure_pg_conn,
                kwargs={"connect_timeout": 3}
            )
            logger.info("Connected to PostgreSQL/TimescaleDB connection pool")
        except Exception as e:
            logger.error("Failed to initialize PostgreSQL pool (%s). System in fail-closed state.", e)
            _pg_pool = None
            raise DatabaseUnavailableError(f"PostgreSQL connection failed: {e}")
    return _pg_pool


class RowDictWrapper:
    """Wrapper that provides dict-like and index-like access for rows across SQLite and PostgreSQL."""
    def __init__(self, data: Dict[str, Any], keys: List[str], values: Tuple[Any, ...]):
        self._dict = data
        self._keys = keys
        self._values = values

    def __getitem__(self, item: Any) -> Any:
        if isinstance(item, int):
            return self._values[item]
        return self._dict[item]

    def __iter__(self):
        return iter(self._dict)

    def keys(self):
        return self._dict.keys()

    def values(self):
        return self._dict.values()

    def items(self):
        return self._dict.items()

    def get(self, key: str, default: Any = None) -> Any:
        return self._dict.get(key, default)

    def __repr__(self) -> str:
        return repr(self._dict)


class CursorWrapper:
    """Cursor wrapper that translates standard ? placeholders and SQLite-isms to PostgreSQL."""
    def __init__(self, raw_cursor, is_pg: bool = False):
        self._cur = raw_cursor
        self._is_pg = is_pg

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if hasattr(self._cur, "close"):
            try:
                self._cur.close()
            except Exception:
                pass

    def _adapt_sql(self, sql: str) -> str:
        if not self._is_pg:
            return sql
        # Translate PRAGMA statements away
        if sql.strip().upper().startswith("PRAGMA"):
            return "SELECT 1"
        # Translate ? to %s
        translated = re.sub(r'\?', '%s', sql)
        # Translate INSERT OR IGNORE INTO table ... -> INSERT INTO table ... ON CONFLICT DO NOTHING
        if re.search(r'INSERT\s+OR\s+IGNORE\s+INTO', translated, re.IGNORECASE):
            translated = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO', 'INSERT INTO', translated, flags=re.IGNORECASE)
            if "ON CONFLICT" not in translated.upper():
                translated += " ON CONFLICT DO NOTHING"
        # Translate INSERT OR REPLACE INTO login_limits ... -> ON CONFLICT(key) DO UPDATE
        if re.search(r'INSERT\s+OR\s+REPLACE\s+INTO\s+login_limits', translated, re.IGNORECASE):
            translated = re.sub(r'INSERT\s+OR\s+REPLACE\s+INTO\s+login_limits', 'INSERT INTO login_limits', translated, flags=re.IGNORECASE)
            translated += " ON CONFLICT(key) DO UPDATE SET attempts=EXCLUDED.attempts, until=EXCLUDED.until"
        # Translate INSERT OR REPLACE INTO kv ... -> ON CONFLICT(key) DO UPDATE
        elif re.search(r'INSERT\s+OR\s+REPLACE\s+INTO\s+kv', translated, re.IGNORECASE):
            translated = re.sub(r'INSERT\s+OR\s+REPLACE\s+INTO\s+kv', 'INSERT INTO kv', translated, flags=re.IGNORECASE)
            translated += " ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
        # Translate INSERT OR REPLACE INTO metaapi_cloud_accounts ... -> ON CONFLICT(login, server) DO UPDATE
        elif re.search(r'INSERT\s+OR\s+REPLACE\s+INTO\s+metaapi_cloud_accounts', translated, re.IGNORECASE):
            translated = re.sub(r'INSERT\s+OR\s+REPLACE\s+INTO\s+metaapi_cloud_accounts', 'INSERT INTO metaapi_cloud_accounts', translated, flags=re.IGNORECASE)
            translated += " ON CONFLICT (login, server) DO UPDATE SET metaapi_account_id=EXCLUDED.metaapi_account_id, metaapi_state=EXCLUDED.metaapi_state, auto_trade=EXCLUDED.auto_trade, encrypted_password=EXCLUDED.encrypted_password, last_sync=EXCLUDED.last_sync"
        return translated

    def execute(self, sql: str, params: Optional[Any] = None):
        adapted = self._adapt_sql(sql)
        if params is None:
            self._cur.execute(adapted)
        else:
            self._cur.execute(adapted, params)
        return self

    def executescript(self, script: str):
        if not self._is_pg:
            self._cur.executescript(script)
        else:
            # PostgreSQL executes multi-statement block directly
            self._cur.execute(script)
        return self

    @property
    def rowcount(self) -> int:
        return getattr(self._cur, "rowcount", -1)

    def fetchone(self) -> Optional[Any]:
        row = self._cur.fetchone()
        if row is None:
            return None
        if self._is_pg:
            cols = [desc[0] for desc in self._cur.description]
            row_dict = dict(zip(cols, row))
            return RowDictWrapper(row_dict, cols, tuple(row))
        return row

    def fetchall(self) -> List[Any]:
        rows = self._cur.fetchall()
        if not self._is_pg:
            return rows
        cols = [desc[0] for desc in self._cur.description] if self._cur.description else []
        return [RowDictWrapper(dict(zip(cols, r)), cols, tuple(r)) for r in rows]

    def __iter__(self):
        while True:
            row = self.fetchone()
            if row is None:
                break
            yield row

    @property
    def lastrowid(self):
        return getattr(self._cur, 'lastrowid', None)


class ConnectionWrapper:
    """Connection abstraction managing commit, rollback, and cursor creation."""
    def __init__(self, raw_conn, is_pg: bool = False, pool=None):
        self._conn = raw_conn
        self._is_pg = is_pg
        self._pool = pool
        self._cur = None

    def cursor(self):
        raw_cur = self._conn.cursor()
        return CursorWrapper(raw_cur, is_pg=self._is_pg)

    def execute(self, sql: str, params: Optional[Any] = None):
        cur = self.cursor()
        cur.execute(sql, params)
        self._cur = cur
        return cur

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount if self._cur is not None else -1

    def executescript(self, script: str):
        cur = self.cursor()
        cur.executescript(script)
        return cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if self._is_pg and self._pool is not None:
            self._pool.putconn(self._conn)
        else:
            self._conn.close()


@contextmanager
def tx():
    """Transaction context manager ensuring atomic execution with rollback on error.
    Strictly fail-closed when PostgreSQL is configured."""
    if is_postgres():
        pool = get_pg_pool()
        if pool is None:
            raise DatabaseUnavailableError("PostgreSQL connection failed: system is configured for PostgreSQL and cannot fail-open to SQLite.")
        try:
            conn = pool.getconn(timeout=2.5)
        except Exception as e:
            raise DatabaseUnavailableError(f"Failed to acquire PostgreSQL connection from pool: {e}")
        wrapped = ConnectionWrapper(conn, is_pg=True, pool=pool)
        try:
            yield wrapped
            wrapped.commit()
        except BaseException:
            wrapped.rollback()
            raise
        finally:
            wrapped.close()
    else:
        # SQLite transaction (test mode only)
        c = sqlite3.connect(DB, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=30000')
        wrapped = ConnectionWrapper(c, is_pg=False)
        try:
            c.execute('BEGIN IMMEDIATE')
            yield wrapped
            wrapped.commit()
        except BaseException:
            wrapped.rollback()
            raise
        finally:
            wrapped.close()


# Convenient alias for tx()
get_db_connection = tx


def init():
    """Initialize database schema, tables, and TimescaleDB hypertables using versioned migrations."""
    from .migrations import run_all_migrations
    if is_postgres():
        pool = get_pg_pool()
        if pool is None:
            raise DatabaseUnavailableError("Cannot initialize database: PostgreSQL pool unavailable.")
        conn = pool.getconn()
        try:
            # 1. Enable TimescaleDB extension if available
            try:
                with conn.cursor() as cur:
                    cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")
                conn.commit()
                logger.info("TimescaleDB extension verified/enabled.")
            except Exception as e:
                conn.rollback()
                logger.debug("CREATE EXTENSION timescaledb skipped: %s", e)

            wrapped = ConnectionWrapper(conn, is_pg=True, pool=pool)
            run_all_migrations(wrapped, is_pg=True)
            wrapped.commit()
        finally:
            pool.putconn(conn)
    else:
        # SQLite initialization
        c = sqlite3.connect(DB)
        c.execute('PRAGMA journal_mode=WAL')
        wrapped = ConnectionWrapper(c, is_pg=False)
        run_all_migrations(wrapped, is_pg=False)
        wrapped.commit()
        wrapped.close()

def audit(c, actor: str, event: str, detail: Any):
    """Record an audit trail event."""
    c.execute(
        'INSERT INTO audit(ts,actor,event,detail) VALUES(?,?,?,?)',
        (time.time(), actor, event, json.dumps(detail, ensure_ascii=False))
    )


def setkv(c, key: str, value: Any):
    """Store or update a key-value pair."""
    c.execute(
        'INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        (key, str(value))
    )


def getkv(c, key: str, default: Optional[str] = None) -> Optional[str]:
    """Retrieve a key-value pair."""
    row = c.execute('SELECT value FROM kv WHERE key=?', (key,)).fetchone()
    if row:
        return row[0]
    return default


# ---------------------------------------------------------------------------
# TimescaleDB High-Speed Time-Series Query Helpers
# ---------------------------------------------------------------------------

SUPPORTED_TIMEFRAMES = {
    "M1": "1 minute",
    "M5": "5 minutes",
    "M15": "15 minutes",
    "H1": "1 hour",
    "D1": "1 day",
}


def insert_timescale_quote(source: str, ts: float, bid: float, ask: float, symbol: str = "XAUUSD"):
    """Insert quote tick into TimescaleDB hypertable."""
    with tx() as c:
        if is_postgres():
            c.execute(
                "INSERT INTO quotes(time, source, symbol, ts, bid, ask) VALUES(to_timestamp(?), ?, ?, ?, ?, ?) ON CONFLICT (time, source, symbol, ts) DO NOTHING",
                (ts, source, symbol, ts, bid, ask)
            )
        else:
            c.execute(
                "INSERT OR IGNORE INTO quotes(source, symbol, ts, bid, ask) VALUES(?,?,?,?,?)",
                (source, symbol, ts, bid, ask)
            )


def to_epoch_ts(val: Any) -> float:
    """Convert numeric epoch or Postgres datetime/timestamptz to float epoch seconds."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if hasattr(val, "timestamp"):
        return float(val.timestamp())
    return float(val)


def insert_timescale_candle(
    c,
    symbol: str,
    timeframe: str,
    ts: float,
    open_p: float,
    high_p: float,
    low_p: float,
    close_p: float,
    volume: float = 1.0,
    source: str = "MARKET_LIVE",
):
    """Insert or upsert an OHLCV candle into TimescaleDB (Postgres) or SQLite."""
    if is_postgres():
        c.execute(
            """
            INSERT INTO candles (time, source, symbol, timeframe, open, high, low, close, volume)
            VALUES (to_timestamp(?), ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (time, source, symbol, timeframe) DO UPDATE SET
                high = GREATEST(candles.high, excluded.high),
                low = LEAST(candles.low, excluded.low),
                close = excluded.close,
                volume = candles.volume + excluded.volume
            """,
            (float(ts), source, symbol, timeframe, float(open_p), float(high_p), float(low_p), float(close_p), float(volume)),
        )
    else:
        try:
            c.execute(
                """
                INSERT INTO candles (source, symbol, timeframe, time, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (time, source, symbol, timeframe) DO UPDATE SET
                    high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume
                """,
                (source, symbol, timeframe, int(ts), float(open_p), float(high_p), float(low_p), float(close_p), float(volume)),
            )
        except Exception:
            c.execute(
                "DELETE FROM candles WHERE source = ? AND symbol = ? AND timeframe = ? AND time = ?",
                (source, symbol, timeframe, int(ts)),
            )
            c.execute(
                "INSERT INTO candles (source, symbol, timeframe, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (source, symbol, timeframe, int(ts), float(open_p), float(high_p), float(low_p), float(close_p), float(volume)),
            )


def _sanitize_candle_outliers(candles: List[Dict[str, Any]], max_dev_pct: float = 0.10) -> List[Dict[str, Any]]:
    """Filter/clamp corrupt single-bar spike outliers (>10% from median close) so one bad tick doesn't squash charts or inflate ATR."""
    if len(candles) < 3:
        return candles
    closes = sorted(float(c["close"]) for c in candles if c.get("close") is not None and float(c["close"]) > 0)
    if not closes:
        return candles
    med = closes[len(closes) // 2]
    if med <= 0:
        return candles
    lo_bound = med * (1.0 - max_dev_pct)
    hi_bound = med * (1.0 + max_dev_pct)
    cleaned: List[Dict[str, Any]] = []
    for item in candles:
        try:
            o = float(item["open"])
            h = float(item["high"])
            l = float(item["low"])
            cl = float(item["close"])
        except (TypeError, ValueError, KeyError):
            continue
        if o < lo_bound or o > hi_bound or cl < lo_bound or cl > hi_bound:
            continue
        body_lo = min(o, cl)
        body_hi = max(o, cl)
        fixed = dict(item)
        if l < lo_bound:
            fixed["low"] = body_lo
        if h > hi_bound:
            fixed["high"] = body_hi
        cleaned.append(fixed)
    return cleaned or candles


def query_timescale_candles(symbol: str = "XAUUSD", timeframe: str = "M15", source: str = "ALL", limit: int = 100) -> List[Dict[str, Any]]:
    """Query recent aggregated OHLCV candles from TimescaleDB or snapshots.
    Strictly validates timeframe (M1, M5, M15, H1, D1) and isolates source (DEMO, REPLAY, LIVE_FEED, ALL)."""
    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe '{timeframe}'. Supported: {', '.join(SUPPORTED_TIMEFRAMES.keys())}")
    if source not in ("DEMO", "REPLAY", "LIVE_FEED", "ALL"):
        raise ValueError(f"Unsupported source '{source}'. Supported: DEMO, REPLAY, LIVE_FEED, ALL")

    bucket_interval = SUPPORTED_TIMEFRAMES[timeframe]

    with tx() as c:
        if is_postgres():
            # 1. Read historical candles stored by streamer/market ingestion
            if source == "ALL":
                hist_rows = c.execute("""
                    SELECT time AS bucket, open, high, low, close, volume
                    FROM candles
                    WHERE symbol = ? AND timeframe = ?
                    ORDER BY time DESC
                    LIMIT ?
                """, (symbol, timeframe, limit)).fetchall()
                quote_rows = c.execute(f"""
                    SELECT 
                        time_bucket('{bucket_interval}', time) AS bucket,
                        first(bid, time) AS open,
                        max(bid) AS high,
                        min(bid) AS low,
                        last(bid, time) AS close,
                        count(*) AS volume
                    FROM quotes
                    WHERE symbol = ?
                    GROUP BY bucket
                    ORDER BY bucket DESC
                    LIMIT ?
                """, (symbol, limit)).fetchall()
            else:
                hist_rows = c.execute("""
                    SELECT time AS bucket, open, high, low, close, volume
                    FROM candles
                    WHERE symbol = ? AND timeframe = ? AND source = ?
                    ORDER BY time DESC
                    LIMIT ?
                """, (symbol, timeframe, source, limit)).fetchall()
                quote_rows = c.execute(f"""
                    SELECT 
                        time_bucket('{bucket_interval}', time) AS bucket,
                        first(bid, time) AS open,
                        max(bid) AS high,
                        min(bid) AS low,
                        last(bid, time) AS close,
                        count(*) AS volume
                    FROM quotes
                    WHERE symbol = ? AND source = ?
                    GROUP BY bucket
                    ORDER BY bucket DESC
                    LIMIT ?
                """, (symbol, source, limit)).fetchall()

            merged: Dict[str, Dict[str, Any]] = {}
            for r in hist_rows:
                d = dict(r)
                bkey = str(d.get("bucket"))
                merged[bkey] = d
            for r in quote_rows:
                d = dict(r)
                bkey = str(d.get("bucket"))
                if bkey not in merged:
                    merged[bkey] = d
            ordered = [merged[k] for k in sorted(merged.keys(), reverse=True)[:limit]]
            return _sanitize_candle_outliers(ordered)
        else:
            # SQLite fallback aggregation
            if source == "ALL":
                rows = c.execute("""
                    SELECT time, open, high, low, close, volume
                    FROM candles
                    WHERE symbol = ? AND timeframe = ?
                    ORDER BY time DESC
                    LIMIT ?
                """, (symbol, timeframe, limit)).fetchall()
            else:
                rows = c.execute("""
                    SELECT time, open, high, low, close, volume
                    FROM candles
                    WHERE symbol = ? AND source = ? AND timeframe = ?
                    ORDER BY time DESC
                    LIMIT ?
                """, (symbol, source, timeframe, limit)).fetchall()
            if rows:
                return _sanitize_candle_outliers([dict(r) for r in rows])

            # Aggregate from quotes if candles table is empty
            tf_seconds = {"M1": 60, "M5": 300, "M15": 900, "H1": 3600, "D1": 86400}.get(timeframe, 900)
            if source == "ALL":
                quote_rows = c.execute("SELECT ts, bid FROM quotes WHERE symbol = ? ORDER BY ts ASC", (symbol,)).fetchall()
            else:
                quote_rows = c.execute("SELECT ts, bid FROM quotes WHERE symbol = ? AND source = ? ORDER BY ts ASC", (symbol, source)).fetchall()
            if not quote_rows:
                return []
            buckets: Dict[int, List[float]] = {}
            for qr in quote_rows:
                b = int(qr['ts'] // tf_seconds) * tf_seconds
                if b not in buckets:
                    buckets[b] = []
                buckets[b].append(float(qr['bid']))
            result = []
            for b in sorted(buckets.keys(), reverse=True)[:limit]:
                p_list = buckets[b]
                result.append({
                    "time": b,
                    "open": p_list[0],
                    "high": max(p_list),
                    "low": min(p_list),
                    "close": p_list[-1],
                    "volume": len(p_list)
                })
            return _sanitize_candle_outliers(result)


def run_with_timeout(fn, timeout: float = 2.0):
    """Run callable in a daemon thread with strict timeout to avoid blocking main thread."""
    import threading
    res = [None]
    err = [None]
    done = threading.Event()

    def _target():
        try:
            res[0] = fn()
        except Exception as ex:
            err[0] = ex
        finally:
            done.set()

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    if not done.wait(timeout=timeout):
        raise TimeoutError(f"Database operation timed out after {timeout}s")
    if err[0] is not None:
        raise err[0]
    return res[0]


def check_db_health(timeout: float = 2.0) -> Dict[str, Any]:
    """Diagnostic health check verifying live database connection."""
    if not is_postgres():
        try:
            with tx() as c:
                row = c.execute("SELECT 1").fetchone()
                ok = bool(row and row[0] == 1)
            return {
                "status": "up" if ok else "down",
                "engine": "sqlite",
                "is_postgres": False,
            }
        except Exception as e:
            return {
                "status": "down",
                "engine": "sqlite",
                "is_postgres": False,
                "error": str(e)
            }

    try:
        ms = max(500, int(timeout * 1000))
        with tx() as c:
            c.execute(f"SET LOCAL statement_timeout = {ms}")
            row = c.execute("SELECT 1").fetchone()
            ok = bool(row and row[0] == 1)
        return {
            "status": "up" if ok else "down",
            "engine": "postgresql",
            "is_postgres": True,
        }
    except Exception as e:
        return {
            "status": "down",
            "engine": "postgresql",
            "is_postgres": True,
            "error": str(e)
        }


def check_timescale_metadata(timeout: float = 2.0) -> Dict[str, Any]:
    """Retrieve TimescaleDB metadata if in PostgreSQL mode."""
    if not is_postgres():
        return {"timescaledb_available": False, "mode": "sqlite"}

    def _probe():
        with tx() as c:
            from .migrations import verify_timescaledb_metadata
            return verify_timescaledb_metadata(c, is_pg=True)

    try:
        return run_with_timeout(_probe, timeout=timeout)
    except Exception as e:
        return {"timescaledb_available": False, "error": str(e)}
