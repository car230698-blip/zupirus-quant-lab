"""Admin Users Router — Re-export shim for backwards compatibility.
Implementation is housed in app.routers.admin.users.
"""
from app.routers.admin.users import router

__all__ = ["router"]
