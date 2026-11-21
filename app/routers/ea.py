"""Legacy EA Router — Re-export shim for backwards compatibility.
Route implementation is isolated in app.routers.legacy_ea, and dashboard is in app.routers.dashboard.
"""
from app.routers.legacy_ea import router, _ensure_ea_tables
from app.routers.dashboard import dashboard

__all__ = ["router", "dashboard", "_ensure_ea_tables"]
