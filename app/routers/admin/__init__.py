"""Admin Routers Package — Centralized administration routing under /api/admin."""
from fastapi import APIRouter, Depends
from app.routers.deps import get_current_admin
from app.routers.admin.ops import router as admin_ops_router
from app.routers.admin.billing import router as admin_billing_router
from app.routers.admin.ai import router as admin_ai_router
from app.routers.admin.users import router as admin_users_router

admin_router = APIRouter(dependencies=[Depends(get_current_admin)], tags=["admin"])

__all__ = [
    "admin_router",
    "admin_ops_router",
    "admin_billing_router",
    "admin_ai_router",
    "admin_users_router",
]
