"""Admin Payments Router — Re-export shim for backwards compatibility.
Implementation is housed in app.routers.admin.billing.
"""
from app.routers.admin.billing import router

__all__ = ["router"]
