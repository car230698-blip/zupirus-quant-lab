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


def is_postgres() -> bool:
    """Return True if PostgreSQL / TimescaleDB is configured."""
    return bool(DATABASE_URL and (DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")))


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
            _pg_pool = ConnectionPool(conn_str, min_size=2, max_size=20, timeout=30.0, open=True)
            logger.info("Connected to PostgreSQL/TimescaleDB connection pool")
        except Exception as e:
            logger.error("Failed to initialize PostgreSQL pool (%s). Reverting to SQLite.", e)
            _pg_pool = None
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
        return cur

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
    """Transaction context manager ensuring atomic execution with rollback on error."""
    pool = get_pg_pool()
    if pool is not None:
        conn = pool.getconn()
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
        # SQLite transaction
        c = sqlite3.connect(DB, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=30000')
        try:
            c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()


def init():
    """Initialize database schema, tables, and TimescaleDB hypertables."""
    pool = get_pg_pool()
    if pool is not None:
        conn = pool.getconn()
        try:
            with conn.cursor() as cur:
                # 1. Enable TimescaleDB extension if available
                try:
                    cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")
                    conn.commit()
                    logger.info("TimescaleDB extension enabled.")
                except Exception as e:
                    conn.rollback()
                    logger.warning("TimescaleDB extension not active (%s); falling back to native PostgreSQL.", e)

                # 2. Relational Core Tables
                cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('customer','admin'))
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id TEXT REFERENCES users(id),
                    expires DOUBLE PRECISION NOT NULL
                );
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT REFERENCES users(id),
                    login TEXT NOT NULL,
                    server TEXT NOT NULL,
                    mode TEXT NOT NULL CHECK(mode IN ('DEMO','REPLAY')),
                    enabled INT NOT NULL DEFAULT 0,
                    risk DOUBLE PRECISION NOT NULL DEFAULT 0.25,
                    max_spread DOUBLE PRECISION NOT NULL DEFAULT 0.8,
                    max_positions INT NOT NULL DEFAULT 1,
                    max_dd DOUBLE PRECISION NOT NULL DEFAULT 10,
                    balance DOUBLE PRECISION NOT NULL DEFAULT 10000,
                    equity DOUBLE PRECISION NOT NULL DEFAULT 10000,
                    peak DOUBLE PRECISION NOT NULL DEFAULT 10000,
                    seen DOUBLE PRECISION NOT NULL DEFAULT 0,
                    positions INT NOT NULL DEFAULT 0,
                    UNIQUE(login,server)
                );
                CREATE TABLE IF NOT EXISTS pairings (
                    code TEXT PRIMARY KEY,
                    account_id TEXT REFERENCES accounts(id),
                    expires DOUBLE PRECISION NOT NULL,
                    used INT NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS devices (
                    token TEXT PRIMARY KEY,
                    account_id TEXT UNIQUE REFERENCES accounts(id)
                );
                CREATE TABLE IF NOT EXISTS signals (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL CHECK(source IN ('DEMO','REPLAY')),
                    side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
                    price DOUBLE PRECISION NOT NULL,
                    sl DOUBLE PRECISION NOT NULL,
                    tp DOUBLE PRECISION NOT NULL,
                    created DOUBLE PRECISION NOT NULL,
                    expires DOUBLE PRECISION NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dispatches (
                    id BIGSERIAL PRIMARY KEY,
                    account_id TEXT REFERENCES accounts(id),
                    signal_id TEXT REFERENCES signals(id),
                    state TEXT NOT NULL DEFAULT 'queued',
                    nonce TEXT,
                    ticket TEXT,
                    deal TEXT,
                    reason TEXT,
                    created DOUBLE PRECISION NOT NULL,
                    updated DOUBLE PRECISION NOT NULL,
                    UNIQUE(account_id,signal_id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS unique_deal ON dispatches(account_id,deal) WHERE deal IS NOT NULL AND deal != '';
                CREATE TABLE IF NOT EXISTS audit (
                    id BIGSERIAL PRIMARY KEY,
                    ts DOUBLE PRECISION NOT NULL,
                    actor TEXT NOT NULL,
                    event TEXT NOT NULL,
                    detail TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    decision INT,
                    result TEXT,
                    error TEXT,
                    created DOUBLE PRECISION NOT NULL
                );
                CREATE TABLE IF NOT EXISTS news (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    impact TEXT NOT NULL,
                    ts DOUBLE PRECISION NOT NULL
                );
                CREATE TABLE IF NOT EXISTS kv (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sim_positions (
                    dispatch_id BIGINT PRIMARY KEY REFERENCES dispatches(id),
                    account_id TEXT REFERENCES accounts(id),
                    side TEXT NOT NULL,
                    entry DOUBLE PRECISION NOT NULL,
                    sl DOUBLE PRECISION NOT NULL,
                    tp DOUBLE PRECISION NOT NULL,
                    lots DOUBLE PRECISION NOT NULL
                );
                CREATE TABLE IF NOT EXISTS login_limits (
                    key TEXT PRIMARY KEY,
                    attempts INT NOT NULL,
                    until DOUBLE PRECISION NOT NULL
                );
                """)
                conn.commit()

                # 3. TimescaleDB Hypertables for High-Frequency Ticks and Candles
                cur.execute("""
                CREATE TABLE IF NOT EXISTS quotes (
                    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    source TEXT NOT NULL,
                    symbol TEXT NOT NULL DEFAULT 'XAUUSD',
                    ts DOUBLE PRECISION NOT NULL,
                    bid DOUBLE PRECISION NOT NULL,
                    ask DOUBLE PRECISION NOT NULL,
                    UNIQUE(source, ts)
                );
                CREATE TABLE IF NOT EXISTS candles (
                    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    symbol TEXT NOT NULL DEFAULT 'XAUUSD',
                    timeframe TEXT NOT NULL DEFAULT 'M15',
                    open DOUBLE PRECISION NOT NULL,
                    high DOUBLE PRECISION NOT NULL,
                    low DOUBLE PRECISION NOT NULL,
                    close DOUBLE PRECISION NOT NULL,
                    volume DOUBLE PRECISION NOT NULL DEFAULT 0,
                    UNIQUE(symbol, timeframe, time)
                );
                CREATE TABLE IF NOT EXISTS snapshots (
                    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    account_id TEXT REFERENCES accounts(id),
                    ts DOUBLE PRECISION NOT NULL,
                    balance DOUBLE PRECISION NOT NULL,
                    equity DOUBLE PRECISION NOT NULL
                );
                """)
                conn.commit()

                # Convert to hypertables if TimescaleDB is available
                for table, time_col in [("quotes", "time"), ("candles", "time"), ("snapshots", "time")]:
                    try:
                        cur.execute(f"SELECT create_hypertable('{table}', '{time_col}', if_not_exists => TRUE);")
                        conn.commit()
                    except Exception as e:
                        conn.rollback()
                        logger.debug("Hypertable creation skipped for %s: %s", table, e)

            conn.commit()
        finally:
            pool.putconn(conn)
    else:
        # SQLite initialization
        c = sqlite3.connect(DB)
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin')));
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),login TEXT NOT NULL,server TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('DEMO','REPLAY')),enabled INTEGER NOT NULL DEFAULT 0,risk REAL NOT NULL DEFAULT 0.25,max_spread REAL NOT NULL DEFAULT 0.8,max_positions INTEGER NOT NULL DEFAULT 1,max_dd REAL NOT NULL DEFAULT 10,balance REAL NOT NULL DEFAULT 10000,equity REAL NOT NULL DEFAULT 10000,peak REAL NOT NULL DEFAULT 10000,seen REAL NOT NULL DEFAULT 0,positions INTEGER NOT NULL DEFAULT 0,UNIQUE(login,server));
        CREATE TABLE IF NOT EXISTS pairings(code TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS devices(token TEXT PRIMARY KEY,account_id TEXT UNIQUE REFERENCES accounts(id));
        CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,source TEXT NOT NULL CHECK(source IN ('DEMO','REPLAY')),side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),price REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,created REAL NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS dispatches(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT REFERENCES accounts(id),signal_id TEXT REFERENCES signals(id),state TEXT NOT NULL DEFAULT 'queued',nonce TEXT,ticket TEXT,deal TEXT,reason TEXT,created REAL NOT NULL,updated REAL NOT NULL,UNIQUE(account_id,signal_id));
        CREATE UNIQUE INDEX IF NOT EXISTS unique_deal ON dispatches(account_id,deal) WHERE deal IS NOT NULL AND deal != '';
        CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY,account_id TEXT REFERENCES accounts(id),ts REAL NOT NULL,balance REAL NOT NULL,equity REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY,source TEXT NOT NULL,ts REAL NOT NULL,bid REAL NOT NULL,ask REAL NOT NULL,UNIQUE(source,ts));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts REAL NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,decision INTEGER,result TEXT,error TEXT,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,title TEXT NOT NULL,currency TEXT NOT NULL,impact TEXT NOT NULL,ts REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sim_positions(dispatch_id INTEGER PRIMARY KEY REFERENCES dispatches(id),account_id TEXT REFERENCES accounts(id),side TEXT NOT NULL,entry REAL NOT NULL,sl REAL NOT NULL,tp REAL NOT NULL,lots REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,until REAL NOT NULL);
        ''')
        c.commit()
        c.close()


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

def insert_timescale_quote(source: str, ts: float, bid: float, ask: float, symbol: str = "XAUUSD"):
    """Insert quote tick into TimescaleDB hypertable."""
    with tx() as c:
        if is_postgres():
            c.execute(
                "INSERT INTO quotes(time, source, symbol, ts, bid, ask) VALUES(to_timestamp(?), ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                (ts, source, symbol, ts, bid, ask)
            )
        else:
            c.execute(
                "INSERT OR IGNORE INTO quotes(source, ts, bid, ask) VALUES(?,?,?,?)",
                (source, ts, bid, ask)
            )


def query_timescale_candles(symbol: str = "XAUUSD", timeframe: str = "M15", limit: int = 100) -> List[Dict[str, Any]]:
    """Query recent aggregated OHLCV candles from TimescaleDB or snapshots."""
    with tx() as c:
        if is_postgres():
            # Uses TimescaleDB time_bucket for continuous M15 candle aggregation
            rows = c.execute("""
                SELECT 
                    time_bucket('15 minutes', time) AS bucket,
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
            return [dict(r) for r in rows]
        return []
