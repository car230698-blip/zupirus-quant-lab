"""Backward compatibility re-export shim for notifications service."""
from app.domains.notifications.service import emit_notification

__all__ = ["emit_notification"]
