"""API routers modularized by domain."""
from app.routers.billing import router as billing_router
from app.routers.webhooks import router as webhooks_router
from app.routers.signals import router as signals_router
from app.routers.accounts import router as accounts_router
from app.routers.sources import router as sources_router
from app.routers.admin_billing import router as admin_billing_router
from app.routers.telemetry import router as telemetry_router

__all__ = [
    "billing_router",
    "webhooks_router",
    "signals_router",
    "accounts_router",
    "sources_router",
    "admin_billing_router",
    "telemetry_router",
]
