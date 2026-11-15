import os
import sys
import time
from app.db import get_db

try:
    key = sys.argv[1] if len(sys.argv) > 1 else 'execution_heartbeat'
    with get_db() as conn:
        r = conn.execute('SELECT value FROM kv WHERE key = ?', (key,)).fetchone()
        if r and time.time() - float(r[0]) < 60:
            sys.exit(0)
        sys.exit(1)
except Exception:
    sys.exit(1)
