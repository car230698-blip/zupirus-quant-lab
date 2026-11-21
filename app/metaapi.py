"""MetaApi Direct Client — Re-export shim for backwards compatibility.
Implementation is housed in app.domains.execution.metaapi_client.
"""
from app.domains.execution.metaapi_client import *  # noqa: F403,F401
from app.domains.execution.fanout import execute_fan_out_for_signal  # noqa: F401
