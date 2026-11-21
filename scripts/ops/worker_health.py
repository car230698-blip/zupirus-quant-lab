import os
import sys
import time
from pathlib import Path

repo_root = str(Path(__file__).resolve().parents[2])
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

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
