"""Common dependencies and authentication helpers for API routers."""
import time
from fastapi import Request, HTTPException, Depends
from pydantic import BaseModel, ConfigDict
from app.db import tx
from app.security import digest


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


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


def owned(c, account, u):
    a = c.execute('SELECT * FROM accounts WHERE id=? AND user_id=?', (account, u['id'])).fetchone()
    if not a:
        try:
            a = c.execute('SELECT * FROM real_accounts WHERE id=? AND user_id=?', (account, u['id'])).fetchone()
        except Exception:
            pass
    if not a:
        fail(404, 'Account not found')
    return a


def device(c, request: Request, p):
    bearer = request.headers.get('authorization', '')
    if not bearer.startswith('Bearer '):
        fail(401, 'Device credential required')
    a = c.execute('SELECT a.* FROM accounts a JOIN devices d ON d.account_id=a.id WHERE d.token=?', (digest(bearer[7:]),)).fetchone()
    if not a:
        fail(401, 'Invalid device')
    if (a['login'], a['server'], a['mode']) != (p.login, p.server, p.mode) or p.mode != 'DEMO':
        fail(403, 'Demo identity required')
    return a

