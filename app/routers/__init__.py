"""API routers modularized by domain."""
from app.routers.accounts import router as accounts_router
from app.routers.accounts_lifecycle import router as accounts_lifecycle_router
from app.routers.admin_ai import router as admin_ai_router
from app.routers.admin_billing import router as admin_billing_router
from app.routers.admin_ops import router as admin_ops_router
from app.routers.admin_payments import router as admin_payments_router
from app.routers.admin_users import router as admin_users_router
from app.routers.ai_chat import router as ai_chat_router
from app.routers.auth import router as auth_router
from app.routers.billing import router as billing_router
from app.routers.dashboard import router as dashboard_router
from app.routers.ea import router as ea_router
from app.routers.legacy_ea import router as legacy_ea_router
from app.routers.metaapi_dispatch import router as metaapi_dispatch_router
from app.routers.notifications import router as notifications_router
from app.routers.realtime import router as realtime_router
from app.routers.signals import router as signals_router
from app.routers.skills import router as skills_router
from app.routers.sources import router as sources_router
from app.routers.telemetry import router as telemetry_router
from app.routers.telemetry_admin import router as telemetry_admin_router
from app.routers.webhooks import router as webhooks_router

__all__ = [
    "accounts_router",
    "accounts_lifecycle_router",
    "admin_ai_router",
    "admin_billing_router",
    "admin_ops_router",
    "admin_payments_router",
    "admin_users_router",
    "ai_chat_router",
    "auth_router",
    "billing_router",
    "dashboard_router",
    "ea_router",
    "legacy_ea_router",
    "metaapi_dispatch_router",
    "notifications_router",
    "realtime_router",
    "signals_router",
    "skills_router",
    "sources_router",
    "telemetry_router",
    "telemetry_admin_router",
    "webhooks_router",
]
