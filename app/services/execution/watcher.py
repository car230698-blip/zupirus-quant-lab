"""Backwards compatibility shim for execution watcher."""
from app.domains.execution.watcher import *  # noqa: F401, F403
from app.domains.execution.watcher import _is_metaapi_success  # noqa: F401
