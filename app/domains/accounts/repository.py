"""Accounts Repository — Single Source of Truth database operations for trading_accounts."""
import time
import logging
from typing import Any, Dict, List, Optional
from app.db import tx

logger = logging.getLogger("zupirus.domains.accounts.repository")


def list_user_accounts(user_id: int) -> List[Dict[str, Any]]:
    """List all connected MT5 trading accounts for a given user."""
    with tx() as c:
        rows = c.execute(
            """
            SELECT id, user_id, account_name, mt5_login, broker_server, platform,
                   account_type, currency, leverage, balance, equity, risk_percent,
                   max_lot, risk_multiplier, auto_trade, prop_stage, prop_daily_dd_limit_pct,
                   prop_max_dd_limit_pct, metaapi_state, last_sync, created_at
            FROM trading_accounts
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_account_by_id(account_id: str, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Retrieve an account by ID, optionally verifying ownership."""
    with tx() as c:
        if user_id is not None:
            row = c.execute(
                "SELECT * FROM trading_accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            ).fetchone()
        else:
            row = c.execute(
                "SELECT * FROM trading_accounts WHERE id = ?",
                (account_id,),
            ).fetchone()
        return dict(row) if row else None


def update_account_balances(account_id: str, balance: float, equity: float) -> None:
    """Update balance, equity, and last_sync timestamp for an account."""
    with tx() as c:
        c.execute(
            """
            UPDATE trading_accounts
            SET balance = ?, equity = ?, last_sync = ?
            WHERE id = ?
            """,
            (balance, equity, time.time(), account_id),
        )


def update_deployment_state(account_id: str, state: str, user_id: Optional[int] = None) -> None:
    """Update deployment state across trading_accounts and metaapi_cloud_accounts."""
    with tx() as c:
        if user_id is not None:
            c.execute(
                "UPDATE trading_accounts SET deployment_state = ? WHERE id = ? AND user_id = ?",
                (state, account_id, user_id),
            )
            try:
                c.execute(
                    "UPDATE metaapi_cloud_accounts SET metaapi_state = ? WHERE id = ? AND user_id = ?",
                    (state, account_id, user_id),
                )
            except Exception:
                pass
        else:
            c.execute(
                "UPDATE trading_accounts SET deployment_state = ? WHERE id = ?",
                (state, account_id),
            )


def delete_trading_account(account_id: str, user_id: Optional[int] = None) -> bool:
    """Delete an account from trading_accounts and metaapi_cloud_accounts."""
    with tx() as c:
        if user_id is not None:
            c.execute("DELETE FROM trading_accounts WHERE id = ? AND user_id = ?", (account_id, user_id))
            try:
                c.execute("DELETE FROM metaapi_cloud_accounts WHERE id = ? AND user_id = ?", (account_id, user_id))
            except Exception:
                pass
        else:
            c.execute("DELETE FROM trading_accounts WHERE id = ?", (account_id,))
            try:
                c.execute("DELETE FROM metaapi_cloud_accounts WHERE id = ?", (account_id,))
            except Exception:
                pass
    return True
