"""Accounts Lifecycle Router — Re-export shim for backwards compatibility.
All lifecycle endpoints have been consolidated directly into app.routers.accounts.
"""
from app.routers.accounts import (
    router,
    toggle_account,
    cloud_deploy_action,
    sync_account,
    delete_account,
)

__all__ = [
    "router",
    "toggle_account",
    "cloud_deploy_action",
    "sync_account",
    "delete_account",
]
