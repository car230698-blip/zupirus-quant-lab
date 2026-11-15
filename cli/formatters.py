"""Output formatting utilities for CLI-Anything architecture.
Ensures 100% clean, parseable JSON for AI Agents and formatted views for humans."""
import sys
import json
from typing import Any, Dict, List, Optional


def emit_json(data: Dict[str, Any], exit_code: int = 0):
    """Emit pure, unpolluted JSON to stdout and exit."""
    formatted = json.dumps(data, indent=2, ensure_ascii=False)
    sys.stdout.write(formatted + "\n")
    sys.stdout.flush()
    sys.exit(exit_code)


def emit_error(message: str, code: str = "ERROR", details: Optional[Any] = None, as_json: bool = False, exit_code: int = 1):
    """Emit error either as structured JSON or human-readable text."""
    if as_json:
        payload = {
            "success": False,
            "error": message,
            "code": code,
        }
        if details:
            payload["details"] = details
        emit_json(payload, exit_code=exit_code)
    else:
        sys.stderr.write(f"\n[ERROR] {message}\n")
        if details:
            sys.stderr.write(f"Details: {details}\n")
        sys.stderr.flush()
        sys.exit(exit_code)


def format_table(headers: List[str], rows: List[List[Any]]) -> str:
    """Format tabular data cleanly with aligned columns."""
    if not rows:
        return "No records found."
    cols = len(headers)
    widths = [len(h) for h in headers]
    for row in rows:
        for i in range(cols):
            val = str(row[i]) if i < len(row) else ""
            widths[i] = max(widths[i], len(val))

    # Header
    header_line = " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    sep_line = "-+-".join("-" * widths[i] for i in range(cols))
    data_lines = [
        " | ".join((str(r[i]) if i < len(r) else "").ljust(widths[i]) for i in range(cols))
        for r in rows
    ]
    return f"{header_line}\n{sep_line}\n" + "\n".join(data_lines)
