import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import tx, getkv

try:
    key = sys.argv[1] if len(sys.argv) > 1 else 'execution_heartbeat'
    with tx() as c:
        val = getkv(c, key)
        if val and time.time() - float(val) < 60:
            sys.exit(0)
        sys.exit(1)
except Exception as e:
    sys.exit(1)
