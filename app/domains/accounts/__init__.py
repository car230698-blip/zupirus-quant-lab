"""Accounts Domain — Account management, lifecycle, classification & risk repository."""
from app.domains.accounts.classifier import detect_account_type, calculate_normalized_lot_size

__all__ = ["detect_account_type", "calculate_normalized_lot_size"]
