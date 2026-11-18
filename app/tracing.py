"""LangSmith tracing and monitoring integration with robust offline fallback."""
import os
import time
import uuid
import logging
from typing import Any, Callable, Dict, List, Optional
from functools import wraps

logger = logging.getLogger("zupirus.tracing")

# Configuration
LANGSMITH_API_KEY = os.getenv("LANGSMITH_API_KEY", "").strip()
LANGSMITH_TRACING = os.getenv("LANGSMITH_TRACING", "true").lower() in ("true", "1", "yes")
LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "zupirus-quant-lab").strip()
LANGSMITH_ENDPOINT = os.getenv("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com").strip()

# Internal in-memory ring buffer for trace inspection (available even offline)
MAX_TRACE_HISTORY = 200
_trace_history: List[Dict[str, Any]] = []

_client = None
_client_initialized = False


def is_langsmith_enabled() -> bool:
    """Return True if LangSmith API key is configured and tracing is enabled."""
    return bool(LANGSMITH_API_KEY and LANGSMITH_TRACING)


# Prevent langsmith/langchain SDK from attempting unauthenticated trace uploads
if not is_langsmith_enabled():
    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "false"


def get_langsmith_client():
    """Lazily initialize and return the LangSmith client, or None if disabled/offline."""
    global _client, _client_initialized
    if _client_initialized:
        return _client
    _client_initialized = True
    if not is_langsmith_enabled():
        return None
    try:
        from langsmith import Client
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = LANGSMITH_API_KEY
        os.environ["LANGCHAIN_PROJECT"] = LANGSMITH_PROJECT
        os.environ["LANGCHAIN_ENDPOINT"] = LANGSMITH_ENDPOINT
        _client = Client(api_key=LANGSMITH_API_KEY, api_url=LANGSMITH_ENDPOINT)
        logger.info(f"LangSmith tracing initialized for project '{LANGSMITH_PROJECT}'")
        return _client
    except Exception as e:
        logger.warning(f"Failed to initialize LangSmith client: {e}. Falling back to local tracing.")
        return None


REDACTED = "[REDACTED]"
SENSITIVE_KEYS = {
    "password", "secret", "token", "eatoken", "admin_password",
    "ai_api_key", "authorization", "cookie", "pairingcode", "api_key"
}


def sanitize_secrets(obj: Any) -> Any:
    """Recursively redact sensitive keys and secrets from trace payloads."""
    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            k_lower = str(k).lower()
            if k_lower in SENSITIVE_KEYS or any(s in k_lower for s in ("password", "secret", "token", "auth", "key")):
                cleaned[k] = REDACTED
            else:
                cleaned[k] = sanitize_secrets(v)
        return cleaned
    elif isinstance(obj, list):
        return [sanitize_secrets(x) for x in obj]
    elif isinstance(obj, str):
        if len(obj) > 60 and ("bearer " in obj.lower() or "token" in obj.lower()):
            return REDACTED
        return obj
    return obj


def record_trace(
    name: str,
    run_type: str,
    inputs: Dict[str, Any],
    outputs: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    latency_ms: float = 0.0,
    metadata: Optional[Dict[str, Any]] = None,
    tokens: Optional[Dict[str, int]] = None,
) -> str:
    """Record a trace event both in memory and to LangSmith if configured."""
    run_id = str(uuid.uuid4())
    ts = time.time()
    sanitized_inputs = sanitize_secrets(inputs)
    sanitized_outputs = sanitize_secrets(outputs or {})
    trace_entry = {
        "id": run_id,
        "name": name,
        "run_type": run_type,
        "timestamp": ts,
        "latency_ms": round(latency_ms, 2),
        "inputs": sanitized_inputs,
        "outputs": sanitized_outputs,
        "error": error,
        "metadata": sanitize_secrets(metadata or {}),
        "tokens": tokens or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "langsmith_synced": False,
    }

    # Always persist to in-memory audit ring buffer for local UI/inspection
    _trace_history.append(trace_entry)
    if len(_trace_history) > MAX_TRACE_HISTORY:
        _trace_history.pop(0)

    # Sync to LangSmith if active
    client = get_langsmith_client()
    if client:
        try:
            extra = {"metadata": trace_entry["metadata"]}
            if tokens:
                extra["token_usage"] = tokens
            client.create_run(
                name=name,
                run_type=run_type,
                inputs=sanitized_inputs,
                outputs=sanitized_outputs,
                error=error,
                project_name=LANGSMITH_PROJECT,
                run_id=run_id,
                extra=extra,
            )
            trace_entry["langsmith_synced"] = True
        except Exception as e:
            logger.debug(f"LangSmith sync failed gracefully: {e}")

    return run_id


def trace_run(name: str, run_type: str = "chain", metadata: Optional[Dict[str, Any]] = None):
    """Decorator to measure and trace function execution."""
    def decorator(func: Callable):
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            inputs = {"args": [str(a)[:500] for a in args], "kwargs": {k: str(v)[:500] for k, v in kwargs.items()}}
            error_str = None
            result = None
            try:
                result = func(*args, **kwargs)
                return result
            except Exception as e:
                error_str = str(e)
                raise
            finally:
                latency_ms = (time.perf_counter() - t0) * 1000
                out_dict = {"result": str(result)[:1000]} if result is not None else {}
                record_trace(name, run_type, inputs, out_dict, error_str, latency_ms, metadata)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            inputs = {"args": [str(a)[:500] for a in args], "kwargs": {k: str(v)[:500] for k, v in kwargs.items()}}
            error_str = None
            result = None
            try:
                result = await func(*args, **kwargs)
                return result
            except Exception as e:
                error_str = str(e)
                raise
            finally:
                latency_ms = (time.perf_counter() - t0) * 1000
                out_dict = {"result": str(result)[:1000]} if result is not None else {}
                record_trace(name, run_type, inputs, out_dict, error_str, latency_ms, metadata)

        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    return decorator


def trace_ai_interaction(
    prompt: str,
    response_text: str,
    model: str = "gpt-4.1-mini",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: float = 0.0,
    tool_calls: Optional[List[Dict[str, Any]]] = None,
    error: Optional[str] = None,
) -> str:
    """Trace an AI completion or agent tool call step."""
    total_tokens = prompt_tokens + completion_tokens
    metadata = {
        "model": model,
        "tool_calls_count": len(tool_calls) if tool_calls else 0,
        "tool_calls": tool_calls or [],
    }
    tokens = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }
    return record_trace(
        name=f"ai_completion:{model}",
        run_type="llm",
        inputs={"prompt": prompt[:3000]},
        outputs={"response": response_text[:3000]},
        error=error,
        latency_ms=latency_ms,
        metadata=metadata,
        tokens=tokens,
    )


def trace_langgraph_step(
    node_name: str,
    inputs: Dict[str, Any],
    outputs: Dict[str, Any],
    latency_ms: float = 0.0,
    error: Optional[str] = None,
) -> str:
    """Trace a LangGraph research node execution."""
    return record_trace(
        name=f"langgraph:{node_name}",
        run_type="chain",
        inputs=inputs,
        outputs=outputs,
        error=error,
        latency_ms=latency_ms,
        metadata={"framework": "langgraph", "node": node_name},
    )


def get_trace_summary() -> Dict[str, Any]:
    """Return summary of tracing activity for admin telemetry."""
    client = get_langsmith_client()
    configured = is_langsmith_enabled()
    connected = client is not None
    tool_name = "LangSmith Cloud Tracing" if (configured and connected) else "Local Buffer (Offline Trace Logger)"
    last_trace = _trace_history[-1] if _trace_history else None
    last_updated = last_trace["timestamp"] if last_trace else time.time()
    return {
        "tracing_tool": tool_name,
        "langsmith_configured": configured,
        "langsmith_connected": connected,
        "project": LANGSMITH_PROJECT,
        "endpoint": LANGSMITH_ENDPOINT,
        "total_traces_recorded": len(_trace_history),
        "last_updated": last_updated,
        "availability_info": f"Active: {tool_name} · Buffer size: {len(_trace_history)}/{MAX_TRACE_HISTORY} traces",
        "recent_traces": _trace_history[-20:],
    }

