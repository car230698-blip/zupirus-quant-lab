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
    password: str = Field(min_length=8, max_length=128)
    role: Literal['customer', 'admin', 'user'] = 'customer'
    name: Optional[str] = None

class UpdateUserRole(Model):
    role: Literal['customer', 'admin', 'user']

class UpdateUserPassword(Model):
    password: str = Field(min_length=8, max_length=128)

@router.get('/api/admin/users')
def list_admin_users(u=Depends(get_current_admin)):
    with tx() as c:
        rows = c.execute("""
            SELECT u.id, u.email, u.role,
                   ((SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) +
                    (SELECT COUNT(*) FROM trading_accounts ta WHERE ta.user_id = u.id)) as accounts_count,
                   (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires > ?) as active_sessions
            FROM users u
            ORDER BY u.email ASC
        """, (time.time(),)).fetchall()
        users_list = []
        for r in rows:
            users_list.append({
                'id': r[0],
                'email': r[1],
                'role': r[2],
                'accounts_count': r[3],
                'active_sessions': r[4],
            })
    return {'users': users_list, 'total': len(users_list)}

@router.post('/api/admin/users')
def create_admin_user(p: CreateUser, u=Depends(get_current_admin)):
    email = p.email.strip().lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        fail(422, 'Email không hợp lệ')
    db_role = 'admin' if p.role == 'admin' else 'customer'
    with tx() as c:
        if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            fail(409, 'Email đã tồn tại')
        uid = f"usr_{secrets.token_hex(8)}"
        c.execute('INSERT INTO users VALUES(?,?,?,?)', (uid, email, password_hash(p.password), db_role))
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
    with tx() as c:
        row = c.execute('SELECT id, email FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        c.execute('UPDATE users SET password=? WHERE id=?', (password_hash(p.password), target_uid))
        c.execute('DELETE FROM sessions WHERE user_id=?', (target_uid,))
        audit(c, u['id'], 'user_password_reset', {'target_user_id': target_uid, 'email': row[1]})
    return {'ok': True}

@router.delete('/api/admin/users/{target_uid}')
async def delete_admin_user(target_uid: str, u=Depends(get_current_admin)):
    if target_uid == u['id']:
        fail(400, 'Không thể xóa tài khoản của chính mình')
    meta_ids_to_cleanup = set()
    user_email = ""
    with tx() as c:
        row = c.execute('SELECT id, email, role FROM users WHERE id=?', (target_uid,)).fetchone()
        if not row:
            fail(404, 'Không tìm thấy người dùng')
        user_email = row[1]

        try:
            for r in c.execute('SELECT metaapi_account_id FROM trading_accounts WHERE user_id=?', (target_uid,)).fetchall():
                if r and r[0]:
                    meta_ids_to_cleanup.add(str(r[0]))
        except Exception:
            pass
        try:
            for r in c.execute('SELECT metaapi_account_id FROM metaapi_cloud_accounts WHERE user_id=?', (target_uid,)).fetchall():
                if r and r[0]:
                    meta_ids_to_cleanup.add(str(r[0]))
        except Exception:
            pass

    if meta_ids_to_cleanup:
        from app.metaapi import MetaApiClient
        client = MetaApiClient()
        for mid in meta_ids_to_cleanup:
            try:
                await client.undeploy_account(mid)
            except Exception as e:
                logger.warning(f"Failed to undeploy MetaApi account {mid} during user deletion: {e}")
            try:
                await client.delete_account(mid)
            except Exception as e:
                logger.warning(f"Failed to delete MetaApi account {mid} during user deletion: {e}")

    with tx() as c:
        # 1. Accounts belonging to user & their foreign key children
        acc_ids = [r[0] for r in c.execute('SELECT id FROM accounts WHERE user_id=?', (target_uid,)).fetchall()]
        for aid in acc_ids:
            for dep_t in ('snapshots', 'sim_positions', 'dispatches', 'metaapi_trade_executions', 'account_symbol_map'):
                try:
                    c.execute(f'DELETE FROM {dep_t} WHERE account_id=?', (aid,))
                except Exception:
                    pass
            c.execute('DELETE FROM accounts WHERE id=? AND user_id=?', (aid, target_uid))

        # 2. Cloud trading accounts & executions
        for dep_t in ('metaapi_trade_executions', 'account_symbol_map', 'signal_dispatch_locks'):
            try:
                c.execute(f'DELETE FROM {dep_t} WHERE account_id IN (SELECT id FROM trading_accounts WHERE user_id=?)', (target_uid,))
            except Exception:
                pass
        try:
            c.execute('DELETE FROM trading_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass
        try:
            c.execute('DELETE FROM metaapi_cloud_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass

        # 3. Real accounts
        try:
            c.execute('DELETE FROM real_accounts WHERE user_id=?', (target_uid,))
        except Exception:
            pass

        # 4. User level records (orders, subscriptions, transactions, disclaimers, sessions, memories)
        for usr_t in ('orders', 'subscriptions', 'payment_transactions', 'legal_disclaimers', 'sessions', 'hindsight_memories'):
            try:
                c.execute(f'DELETE FROM {usr_t} WHERE user_id=?', (target_uid,))
            except Exception:
                pass

        # 5. Delete user record
        c.execute('DELETE FROM users WHERE id=?', (target_uid,))
        audit(c, u['id'], 'user_deleted', {'target_user_id': target_uid, 'email': user_email, 'cleaned_metaapi_ids': list(meta_ids_to_cleanup)})
    return {'ok': True, 'message': f'Đã xoá người dùng {user_email} thành công.'}
