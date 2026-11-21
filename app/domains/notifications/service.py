"""In-App and Multi-Channel Notification Service.
Publishes notifications to in-app database table, SSE stream channel, and Resend email (with cooldown).
"""
import time
import json
import uuid
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("zupirus.domains.notifications")


def emit_notification(
    c,
    user_id: Optional[str] = None,
    role: str = "user",
    severity: str = "INFO",
    title: str = "",
    body: str = "",
    meta: Optional[Dict[str, Any]] = None,
    send_email: bool = False,
    cooldown_key: Optional[str] = None,
    cooldown_sec: int = 1800,
) -> str:
    """Emits an in-app and multi-channel notification.
    - Persists record into `notifications` table.
    - Dispatches real-time SSE event via `publish_realtime_event`.
    - If `send_email=True`, enforces cooldown window and sends email via Resend mailer.
    """
    now = time.time()
    notif_id = f"notif_{uuid.uuid4().hex[:12]}"
    meta_json = json.dumps(meta or {}, ensure_ascii=False)

    # 1. Persist notification in DB
    try:
        c.execute(
            """
            INSERT INTO notifications (id, user_id, role, severity, title, body, meta_json, read_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (notif_id, user_id, role, severity, title, body, meta_json, now),
        )
    except Exception as e:
        logger.warning(f"Failed to persist notification {notif_id}: {e}")

    # 2. Dispatch real-time SSE event
    try:
        from app.core.redis_client import publish_realtime_event
        event_payload = {
            "id": notif_id,
            "user_id": user_id,
            "role": role,
            "severity": severity,
            "title": title,
            "body": body,
            "meta": meta or {},
            "created_at": now,
        }
        if role == "admin":
            publish_realtime_event("admin", "notification", event_payload)
        if user_id:
            publish_realtime_event(f"user:{user_id}", "notification", event_payload)
        publish_realtime_event("user", "notification", event_payload)
    except Exception as e:
        logger.debug(f"Failed to publish notification SSE: {e}")

    # 3. Optional Email Alert with cooldown check
    if send_email:
        should_send = True
        if cooldown_key:
            try:
                row = c.execute("SELECT value FROM kv WHERE key = ?", (f"cd_{cooldown_key}",)).fetchone()
                if row:
                    last_sent = float(row["value"] if hasattr(row, "keys") else row[0])
                    if (now - last_sent) < cooldown_sec:
                        should_send = False
                if should_send:
                    c.execute(
                        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (f"cd_{cooldown_key}", str(now)),
                    )
            except Exception as e:
                logger.debug(f"Cooldown check error: {e}")

        if should_send:
            try:
                if role == "admin":
                    from app.core.mailer import send_admin_alert_email
                    send_admin_alert_email(title, body)
                elif user_id:
                    row = c.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
                    if row:
                        u_email = (row["email"] if hasattr(row, "keys") else row[0]) or ""
                        if "@" in u_email and not u_email.endswith(("@example.com", "@zupirus.local")):
                            from app.core.mailer import send_resend_email
                            html = f"""
                            <div style="background:#050811;color:#f8fafc;padding:24px;font-family:Arial,sans-serif;">
                              <div style="max-width:540px;margin:0 auto;background:#0d1527;border:1px solid #f59e0b;border-radius:12px;padding:24px;">
                                <h2 style="color:#f59e0b;margin:0 0 12px;">[{severity}] {title}</h2>
                                <p style="color:#cbd5e1;font-size:13px;line-height:1.6;">{body}</p>
                              </div>
                            </div>
                            """
                            send_resend_email(to=u_email, subject=f"[ZUPIRUS CẢNH BÁO] {title}", html=html)
            except Exception as e:
                logger.debug(f"Notification email dispatch error: {e}")

    return notif_id
