"""Admin Ops Router — Re-export shim for backwards compatibility.
Implementation is housed in app.routers.admin.ops.
"""
from app.routers.admin.ops import router

__all__ = ["router"]
