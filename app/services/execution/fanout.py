"""Backwards compatibility shim for execution fanout.
Uses calculate_normalized_lot_size for direct execution.
"""
from app.domains.execution.fanout import *  # noqa: F401, F403
from app.domains.accounts.classifier import calculate_normalized_lot_size  # noqa: F401
