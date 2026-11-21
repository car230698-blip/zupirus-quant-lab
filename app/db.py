"""Database abstraction — Re-export shim for backwards compatibility.
Implementation is housed in app.core.db.
"""
from app.core.db import *  # noqa: F403,F401
from app.core.db import (
    ROOT, DATA, DB, DATABASE_URL,
    is_postgres, get_pg_pool, init, tx, get_db_connection,
    setkv, getkv, audit, check_db_health, check_timescale_metadata,
    DatabaseUnavailableError, _configure_pg_conn,
)
import app.core.db as _core_db

_pg_pool = _core_db._pg_pool
_pg_pool_lock = _core_db._pg_pool_lock
