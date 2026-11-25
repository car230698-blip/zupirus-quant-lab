"""MetaApi Direct Client — Re-export shim for backwards compatibility.
Implementation is housed in app.domains.execution.metaapi_client.
"""
from typing import Any, Dict
from app.domains.execution.metaapi_client import *  # noqa: F403,F401


async def execute_fan_out_for_signal(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    """Stub: in Quant Lab, client auto-trading fan-out is disabled."""
    accounts = kwargs.get("accounts") or (args[1] if len(args) > 1 else [])
    return {"executed": 0, "skipped": len(accounts), "details": []}
