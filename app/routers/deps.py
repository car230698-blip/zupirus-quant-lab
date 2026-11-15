"""Common dependencies and authentication helpers for API routers."""
import time
from fastapi import Request, HTTPException, Depends
from app.db import tx
from app.security import digest


def fail(status_code: int, detail: str):
    """Raise standard HTTP exception."""
    raise HTTPException(status_code=status_code, detail=detail)


def get_current_user(request: Request) -> dict:
    """Retrieve authenticated user from session cookie."""
    token = request.cookies.get('session', '')
    if not token:
        # Also check Authorization header for Bearer token support
        auth_hdr = request.headers.get('authorization', '')
        if auth_hdr.startswith('Bearer '):
            token = auth_hdr[7:].strip()

    if not token:
        fail(401, 'Đăng nhập để tiếp tục')

    with tx() as c:
        row = c.execute(
            'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',
            (digest(token), time.time())
        ).fetchone()
        if not row:
            fail(401, 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ')
        return dict(row)


def get_current_admin(u: dict = Depends(get_current_user)) -> dict:
    """Ensure authenticated user has admin role."""
    if u.get('role') != 'admin':
        fail(403, 'Yêu cầu quyền Quản trị viên (Admin)')
    return u
