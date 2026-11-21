"""Accounts Lifecycle Domain Service — Handles auto_trade toggle, risk profile updates, and revocations."""
import logging
from typing import Any, Dict, Optional
from app.db import tx
from app.domains.accounts.repository import get_account_by_id

logger = logging.getLogger("zupirus.domains.accounts.lifecycle")


def toggle_account_trading(account_id: str, user_id: int) -> Dict[str, Any]:
    """Toggle auto_trade between 1 (active) and 0 (paused)."""
    acc = get_account_by_id(account_id, user_id)
    if not acc:
        raise ValueError(f"Account {account_id} not found for user {user_id}")

    current_state = int(acc.get("auto_trade", 1))
    new_state = 0 if current_state == 1 else 1

    with tx() as c:
        c.execute(
            "UPDATE trading_accounts SET auto_trade = ? WHERE id = ? AND user_id = ?",
            (new_state, account_id, user_id),
        )

    logger.info("Toggled auto_trade for account %s: %s -> %s", account_id, current_state, new_state)
    return {"id": account_id, "auto_trade": new_state}


def update_account_risk(
    account_id: str,
    user_id: int,
    risk_percent: Optional[float] = None,
    max_lot: Optional[float] = None,
    risk_multiplier: Optional[float] = None,
) -> Dict[str, Any]:
    """Update risk management parameters for a trading account."""
    acc = get_account_by_id(account_id, user_id)
    if not acc:
        raise ValueError(f"Account {account_id} not found for user {user_id}")

    updates = []
    params = []

    if risk_percent is not None:
        clamped_risk = max(0.1, min(float(risk_percent), 5.0))
        updates.append("risk_percent = ?")
        params.append(clamped_risk)

    if max_lot is not None:
        clamped_max_lot = max(0.01, min(float(max_lot), 50.0))
        updates.append("max_lot = ?")
        params.append(clamped_max_lot)

    if risk_multiplier is not None:
        clamped_mult = max(0.1, min(float(risk_multiplier), 5.0))
        updates.append("risk_multiplier = ?")
        params.append(clamped_mult)

    if updates:
        params.extend([account_id, user_id])
        with tx() as c:
            c.execute(
                f"UPDATE trading_accounts SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                params,
            )

    updated = get_account_by_id(account_id, user_id)
    return updated or {}
