"""Pip size used by research code when a study names a symbol.

This does not size or send orders.
"""
from __future__ import annotations


def pip_size_for_symbol(symbol: str) -> float:
    sym = str(symbol or "").upper().replace("/", "").replace(" ", "")
    if "JPY" in sym and not sym.startswith("XAU"):
        return 0.01
    if sym.startswith("XAU") or sym.startswith("XAG"):
        return 0.01
    if sym.startswith("US") and sym[2:5].isalpha() and len(sym) <= 6:
        return 0.01
    return 0.0001
