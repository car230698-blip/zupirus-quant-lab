import time, secrets, re, logging
from typing import Literal, Optional
from fastapi import APIRouter, Depends
from pydantic import Field
from app.db import tx, audit
from app.security import password_hash
from app.routers.deps import Model, fail, get_current_admin

logger = logging.getLogger("zupirus.api")
router = APIRouter()


class CreateUser(Model):
    email: str = Field(min_length=3, max_length=150)
    password: str = Field(min_length=1, max_length=128)
    role: Literal['customer', 'admin', 'user'] = 'customer'
    name: Optional[str] = None

class UpdateUserRole(Model):
    role: Literal['customer', 'admin', 'user']

class UpdateUserPassword(Model):
    password: str = Field(min_length=1, max_length=128)

@router.get('/api/admin/users')
def list_admin_users(u=Depends(get_current_admin)):
    with tx() as c:
        rows = c.execute("""
            SELECT u.id, u.email, u.role,
                   (SELECT COUNT(*) FROM report_entitlements re WHERE re.user_id = u.id AND re.status = 'ACTIVE') as entitlements_count,
                   (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires > ?) as active_sessions,
                   (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as orders_count
            FROM users u
            ORDER BY u.email ASC
        """, (time.time(),)).fetchall()
        users_list = []
        for r in rows:
            uid = r[0]
            susp_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"user_suspended:{uid}",)).fetchone()
            is_susp = bool(susp_row and susp_row[0] in ("1", "true", "True"))
            users_list.append({
                'id': uid,
                'email': r[1],
                'role': r[2],
                'entitlements_count': r[3],
                'accounts_count': r[3],
                'active_sessions': r[4],
                'orders_count': r[5],
                'is_suspended': is_susp,
            })
    return {'users': users_list, 'total': len(users_list)}

@router.post('/api/admin/users')
def create_admin_user(p: CreateUser, u=Depends(get_current_admin)):
    email = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        fail(422, 'Email không hợp lệ')
    if len(p.password.strip()) < 8:
        fail(422, 'Mật khẩu phải có ít nhất 8 ký tự')
    db_role = 'admin' if p.role == 'admin' else 'customer'
    with tx() as c:
        if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            fail(409, 'Email đã tồn tại')
        uid = f"usr_{secrets.token_hex(8)}"
        c.execute('INSERT INTO users(id, email, password, role) VALUES(?,?,?,?)', (uid, email, password_hash(p.password.strip()), db_role))
        audit(c, u['id'], 'user_created', {'target_user_id': uid, 'email': email, 'role': db_role})
    return {'ok': True, 'id': uid, 'email': email, 'role': db_role}

@router.put('/api/admin/users/{target_uid}/role')
def update_user_role(target_uid: str, p: UpdateUserRole, u=Depends(get_current_admin)):
    db_role = 'admin' if p.role == 'admin' else 'customer'
    if target_uid == u['id'] and db_role != 'admin':
        fail(400, 'Không thể tự hạ quyền quản trị của chính mình')
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET role=? WHERE id=?', (db_role, target_uid))
        audit(c, u['id'], 'user_role_changed', {'target_user_id': target_uid, 'email': row[1], 'new_role': db_role})
    return {'ok': True}

@router.put('/api/admin/users/{target_uid}/password')
def reset_user_password(target_uid: str, p: UpdateUserPassword, u=Depends(get_current_admin)):
    clean_pw = p.password.strip()
    if len(clean_pw) < 8:
        fail(422, 'Mật khẩu mới phải có ít nhất 8 ký tự')
    with tx() as c:
        row = c.execute('SELECT id, email FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET password=? WHERE id=?', (password_hash(clean_pw), target_uid))
        if target_uid != u['id']:
            c.execute('DELETE FROM sessions WHERE user_id=?', (target_uid,))
        audit(c, u['id'], 'user_password_reset', {'target_user_id': target_uid, 'email': row[1]})
    return {'ok': True, 'message': f'Đã đặt lại mật khẩu cho {row[1]} thành công.'}

@router.post('/api/admin/users/{target_uid}/toggle-suspend')
def toggle_suspend_user(target_uid: str, u=Depends(get_current_admin)):
    if target_uid == u['id']:
        fail(400, 'Không thể tự đình chỉ tài khoản của chính mình')
    with tx() as c:
        row = c.execute('SELECT id, email FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        key = f"user_suspended:{target_uid}"
        curr = c.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        now_susp = not bool(curr and curr[0] in ("1", "true", "True"))
        if now_susp:
            c.execute("INSERT INTO kv (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'", (key,))
            c.execute("DELETE FROM sessions WHERE user_id = ?", (target_uid,))
            audit(c, u['id'], 'user_suspended', {'target_user_id': target_uid, 'email': row[1]})
            msg = f"Đã đình chỉ tài khoản {row[1]} và hủy các phiên đăng nhập."
        else:
            c.execute("DELETE FROM kv WHERE key = ?", (key,))
            audit(c, u['id'], 'user_unsuspended', {'target_user_id': target_uid, 'email': row[1]})
            msg = f"Đã mở khóa hoạt động cho tài khoản {row[1]}."
    return {'ok': True, 'is_suspended': now_susp, 'message': msg}

@router.delete('/api/admin/users/{target_uid}')
async def delete_admin_user(target_uid: str, u=Depends(get_current_admin)):
    if target_uid == u['id']:
        fail(400, 'Không thể xóa tài khoản của chính mình')
    user_email = ""
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        user_email = row[1]

        # 1. Purge report entitlements and user related records
        for usr_t in ('report_entitlements', 'orders', 'subscriptions', 'payment_transactions', 'legal_disclaimers', 'sessions', 'hindsight_memories', 'otp_codes'):
            try:
                c.execute(f'DELETE FROM {usr_t} WHERE user_id=?', (target_uid,))
            except Exception:
                pass

        # 2. Purge any legacy tables if they exist
        for leg_t in ('accounts', 'trading_accounts', 'real_accounts', 'metaapi_cloud_accounts'):
            try:
                c.execute(f'DELETE FROM {leg_t} WHERE user_id=?', (target_uid,))
            except Exception:
                pass

        # 3. Delete user record
        c.execute('DELETE FROM users WHERE id=?', (target_uid,))
        audit(c, u['id'], 'user_deleted', {'target_user_id': target_uid, 'email': user_email})

    return {'ok': True, 'message': f'Đã xoá người dùng {user_email} thành công.'}
