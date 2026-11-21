"""Notifications Router for user and admin in-app notification center."""
import time
import json
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel

from app.db import tx
from app.routers.deps import get_current_user

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    u: dict = Depends(get_current_user),
):
    """Retrieve notifications for the current user or admin."""
    user_id = u["id"]
    is_admin = (u.get("role") == "admin")

    with tx() as c:
        if is_admin:
            sql = """
                SELECT id, user_id, role, severity, title, body, meta_json, read_at, created_at
                FROM notifications
                WHERE (role = 'admin' OR user_id = ? OR user_id IS NULL)
            """
            params: List[Any] = [user_id]
        else:
            sql = """
                SELECT id, user_id, role, severity, title, body, meta_json, read_at, created_at
                FROM notifications
                WHERE user_id = ?
            """
            params = [user_id]

        if unread_only:
            sql += " AND read_at IS NULL"

        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        rows = c.execute(sql, tuple(params)).fetchall()

        if is_admin:
            count_sql = "SELECT COUNT(*) FROM notifications WHERE (role = 'admin' OR user_id = ? OR user_id IS NULL) AND read_at IS NULL"
            unread_count = c.execute(count_sql, (user_id,)).fetchone()[0]
        else:
            count_sql = "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL"
            unread_count = c.execute(count_sql, (user_id,)).fetchone()[0]

    items = []
    for r in rows:
        d = dict(r) if hasattr(r, "keys") else {
            "id": r[0], "user_id": r[1], "role": r[2], "severity": r[3],
            "title": r[4], "body": r[5], "meta_json": r[6], "read_at": r[7], "created_at": r[8]
        }
        meta = {}
        if d.get("meta_json"):
            try:
                meta = json.loads(d["meta_json"])
            except Exception:
                pass
        d["meta"] = meta
        items.append(d)

    return {
        "ok": True,
        "unread_count": int(unread_count or 0),
        "notifications": items,
    }


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    u: dict = Depends(get_current_user),
):
    """Mark a single notification as read."""
    now = time.time()
    user_id = u["id"]
    is_admin = (u.get("role") == "admin")

    with tx() as c:
        if is_admin:
            c.execute(
                "UPDATE notifications SET read_at = ? WHERE id = ? AND (role = 'admin' OR user_id = ? OR user_id IS NULL)",
                (now, notification_id, user_id),
            )
        else:
            c.execute(
                "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?",
                (now, notification_id, user_id),
            )
    return {"ok": True}


@router.post("/read-all")
def mark_all_notifications_read(
    u: dict = Depends(get_current_user),
):
    """Mark all unread notifications as read."""
    now = time.time()
    user_id = u["id"]
    is_admin = (u.get("role") == "admin")

    with tx() as c:
        if is_admin:
            c.execute(
                "UPDATE notifications SET read_at = ? WHERE (role = 'admin' OR user_id = ? OR user_id IS NULL) AND read_at IS NULL",
                (now, user_id),
            )
        else:
            c.execute(
                "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
                (now, user_id),
            )
    return {"ok": True}
