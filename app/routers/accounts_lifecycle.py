import time
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Request

from app.db import tx, audit
from app.routers.deps import get_current_user, fail
from app.metaapi import MetaApiClient
from app.routers.accounts import _resolve_target_account

logger = logging.getLogger("zupirus.accounts")
router = APIRouter(tags=["accounts"])


@router.post("/api/v1/accounts/{account_id}/toggle")
@router.post("/api/metaapi/accounts/{account_id}/toggle")
async def toggle_account(account_id: str, request: Request, u: dict = Depends(get_current_user)):
    """Toggle or deterministically set auto-trading state for a cloud MT5 terminal."""
    explicit_active: Optional[bool] = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            raw_val = body.get("is_active") if body.get("is_active") is not None else body.get("active")
            if raw_val is not None:
                explicit_active = bool(raw_val)
    except Exception:
        pass

    with tx() as c:
        acc_d = _resolve_target_account(c, account_id, u)
        real_id = acc_d["id"]
        owner_id = acc_d["user_id"]
        if explicit_active is not None:
            new_state = 1 if explicit_active else 0
        else:
            new_state = 1 if int(acc_d.get("auto_trade") or 0) == 0 else 0

        if acc_d.get("_is_ea_bridge"):
            c.execute("UPDATE accounts SET enabled=? WHERE id=? AND user_id=?", (new_state, real_id, owner_id))
            if not new_state:
                c.execute("UPDATE dispatches SET state='cancelled',updated=? WHERE account_id=? AND state='queued'", (time.time(), real_id))
        else:
            c.execute("UPDATE trading_accounts SET auto_trade=? WHERE id=? AND user_id=?", (new_state, real_id, owner_id))
            try:
                c.execute("UPDATE metaapi_cloud_accounts SET auto_trade=? WHERE id=? AND user_id=?", (new_state, real_id, owner_id))
            except Exception:
                pass
        audit(c, u["id"], "trading_account_toggle_auto_trade", {
            "account_id": real_id,
            "auto_trade": new_state
        })

    return {
        "id": real_id,
        "auto_trade": new_state,
        "is_active": bool(new_state),
        "status": "ACTIVE" if new_state else "PAUSED"
    }


@router.post("/api/v1/accounts/cloud/{account_id}/{action}")
@router.post("/api/metaapi/accounts/cloud/{account_id}/{action}")
async def cloud_deploy_action(account_id: str, action: str, u: dict = Depends(get_current_user)):
    """Deploy or undeploy MetaApi cloud terminal for an account."""
    act = action.lower().strip()
    if act not in ("deploy", "undeploy"):
        fail(400, "Hành động không hợp lệ (chỉ chấp nhận 'deploy' hoặc 'undeploy').")

    with tx() as c:
        acc = _resolve_target_account(c, account_id, u)

    real_id = acc["id"]
    owner_id = acc["user_id"]
    meta_id = acc.get("metaapi_account_id")
    client = MetaApiClient()
    new_state = "DEPLOYED" if act == "deploy" else "UNDEPLOYED"
    if meta_id:
        if act == "deploy":
            ok = await client.deploy_account(meta_id)
        else:
            ok = await client.undeploy_account(meta_id)
        if not ok:
            logger.error(f"MetaApi cloud {act} failed for account {real_id} (meta_id={meta_id})")
            fail(502, f"Thao tác {act.upper()} trên MetaApi Cloud thất bại. Trạng thái hiện tại được giữ nguyên.")

    with tx() as c:
        if acc.get("_is_ea_bridge"):
            new_en = 1 if act == "deploy" else 0
            c.execute("UPDATE accounts SET enabled=? WHERE id=? AND user_id=?", (new_en, real_id, owner_id))
        else:
            c.execute("UPDATE trading_accounts SET deployment_state=? WHERE id=? AND user_id=?", (new_state, real_id, owner_id))
            try:
                c.execute("UPDATE metaapi_cloud_accounts SET metaapi_state=? WHERE id=? AND user_id=?", (new_state, real_id, owner_id))
            except Exception:
                pass

    return {
        "id": real_id,
        "action": act,
        "deployment_state": new_state,
        "success": True,
        "message": f"Đã {'kích hoạt' if act == 'deploy' else 'tạm ngưng'} trạm Cloud thành công."
    }


@router.post("/api/v1/accounts/{account_id}/sync")
@router.post("/api/metaapi/accounts/{account_id}/sync")
async def sync_account(account_id: str, u: dict = Depends(get_current_user)):
    """Sync real-time equity & balance from MetaApi Cloud terminal."""
    with tx() as c:
        acc = _resolve_target_account(c, account_id, u)

    client = MetaApiClient()
    real_id = acc["id"]
    owner_id = acc["user_id"]
    meta_id = acc.get("metaapi_account_id") or real_id
    eq = float(acc.get("equity") or 0.0)
    bal = float(acc.get("balance") or 0.0)
    if not acc.get("_is_ea_bridge") and not client.is_mock:
        info = await client.get_account_information(meta_id)
        if isinstance(info, dict) and info.get("connected", True):
            new_eq = float(info.get("equity") or 0.0)
            new_bal = float(info.get("balance") or 0.0)
            if new_eq > 0 or new_bal > 0:
                eq = new_eq
                bal = new_bal
    now_ts = time.time()

    with tx() as c:
        if acc.get("_is_ea_bridge"):
            c.execute(
                "UPDATE accounts SET equity=?, balance=?, seen=? WHERE id=? AND user_id=?",
                (eq, bal, now_ts, real_id, owner_id)
            )
        else:
            c.execute(
                "UPDATE trading_accounts SET equity=?, balance=?, last_sync=? WHERE id=? AND user_id=?",
                (eq, bal, now_ts, real_id, owner_id)
            )
            try:
                c.execute(
                    "UPDATE metaapi_cloud_accounts SET equity=?, balance=?, last_sync=? WHERE id=? AND user_id=?",
                    (eq, bal, now_ts, real_id, owner_id)
                )
            except Exception:
                pass

    return {"id": real_id, "equity": eq, "balance": bal, "last_sync": now_ts}


@router.delete("/api/v1/accounts/{account_id}")
@router.delete("/api/metaapi/accounts/{account_id}")
async def delete_account(account_id: str, u: dict = Depends(get_current_user)):
    """Undeploy and delete cloud terminal on MetaApi and remove account strictly for the owning user."""
    is_admin = u.get("role") == "admin"
    user_id = u["id"]
    found = False
    meta_id = None
    target_user_id = None
    resolved_trading_id = None
    resolved_real_id = None
    resolved_legacy_id = None
    resolved_cloud_id = None

    with tx() as c:
        # 1. Check trading_accounts (prefer current user's row first to avoid cross-tenant collision on login)
        acc_row = c.execute(
            "SELECT * FROM trading_accounts WHERE (id=? OR mt5_login=? OR metaapi_account_id=?) AND user_id=?",
            (account_id, account_id, account_id, user_id),
        ).fetchone()
        if not acc_row and is_admin:
            acc_row = c.execute(
                "SELECT * FROM trading_accounts WHERE id=? OR mt5_login=? OR metaapi_account_id=?",
                (account_id, account_id, account_id),
            ).fetchone()
        if acc_row:
            acc = dict(acc_row)
            if not is_admin and acc["user_id"] != user_id:
                fail(403, "Không có quyền xoá tài khoản này.")
            found = True
            target_user_id = acc["user_id"]
            resolved_trading_id = acc["id"]
            meta_id = acc.get("metaapi_account_id")

        if not found:
            # 2. Check real_accounts
            racc_row = c.execute(
                "SELECT * FROM real_accounts WHERE (id=? OR login=?) AND user_id=?",
                (account_id, account_id, user_id),
            ).fetchone()
            if not racc_row:
                racc_row = c.execute(
                    "SELECT * FROM real_accounts WHERE id=? OR login=?",
                    (account_id, account_id),
                ).fetchone()
            if racc_row:
                racc = dict(racc_row)
                if not is_admin and racc["user_id"] != user_id:
                    fail(403, "Không có quyền xoá tài khoản này.")
                found = True
                target_user_id = racc["user_id"]
                resolved_real_id = racc["id"]

        if not found:
            # 3. Check legacy accounts
            lacc_row = c.execute(
                "SELECT * FROM accounts WHERE (id=? OR login=?) AND user_id=?",
                (account_id, account_id, user_id),
            ).fetchone()
            if not lacc_row:
                lacc_row = c.execute(
                    "SELECT * FROM accounts WHERE id=? OR login=?",
                    (account_id, account_id),
                ).fetchone()
            if lacc_row:
                lacc = dict(lacc_row)
                if not is_admin and lacc["user_id"] != user_id:
                    fail(403, "Không có quyền xoá tài khoản này.")
                found = True
                target_user_id = lacc["user_id"]
                resolved_legacy_id = lacc["id"]

        if not found:
            # 4. Check metaapi_cloud_accounts
            macc_row = c.execute(
                "SELECT * FROM metaapi_cloud_accounts WHERE (id=? OR login=?) AND user_id=?",
                (account_id, account_id, user_id),
            ).fetchone()
            if not macc_row:
                macc_row = c.execute(
                    "SELECT * FROM metaapi_cloud_accounts WHERE id=? OR login=?",
                    (account_id, account_id),
                ).fetchone()
            if macc_row:
                macc = dict(macc_row)
                if not is_admin and macc["user_id"] != user_id:
                    fail(403, "Không có quyền xoá tài khoản này.")
                found = True
                target_user_id = macc["user_id"]
                resolved_cloud_id = macc["id"]
                meta_id = macc.get("metaapi_account_id")

        if not found:
            fail(404, "Tài khoản không tồn tại.")

    if meta_id:
        client = MetaApiClient()
        try:
            await client.undeploy_account(meta_id)
        except Exception as e:
            logger.warning(f"Could not undeploy MetaApi account {meta_id}: {e}")
        try:
            await client.delete_account(meta_id)
        except Exception as e:
            logger.warning(f"Could not delete MetaApi account {meta_id}: {e}")

    with tx() as c:
        is_pg = bool(getattr(c, "_is_pg", False))
        # Resolve only matching legacy accounts.id belonging to target_user_id
        if resolved_legacy_id:
            matching_acc_ids = [resolved_legacy_id]
        else:
            matching_acc_ids = [
                r[0] for r in c.execute(
                    "SELECT id FROM accounts WHERE (id=? OR login=?) AND user_id=?",
                    (account_id, account_id, target_user_id),
                ).fetchall()
            ]
        from app.db import setkv
        from app.redis_client import get_redis_client
        for aid in matching_acc_ids:
            login_row = c.execute("SELECT login FROM accounts WHERE id=?", (aid,)).fetchone()
            if login_row and login_row[0]:
                setkv(c, f"ea_deleted:{login_row[0]}", str(int(time.time())))
            for dep_table in ("devices", "pairings", "snapshots", "dispatches", "metaapi_trade_executions", "account_symbol_map", "sim_positions"):
                if is_pg:
                    c.execute("SAVEPOINT sp_del_dep")
                try:
                    c.execute(f"DELETE FROM {dep_table} WHERE account_id=?", (aid,))
                    if is_pg:
                        c.execute("RELEASE SAVEPOINT sp_del_dep")
                except Exception:
                    if is_pg:
                        try:
                            c.execute("ROLLBACK TO SAVEPOINT sp_del_dep")
                        except Exception:
                            pass
            c.execute("DELETE FROM accounts WHERE id=? AND user_id=?", (aid, target_user_id))
            try:
                r_cli = get_redis_client()
                if r_cli:
                    r_cli.delete(f"hb:{aid}")
            except Exception:
                pass

        # Delete from real_accounts strictly by id and user_id
        target_rid = resolved_real_id or account_id
        c.execute("DELETE FROM real_accounts WHERE id=? AND user_id=?", (target_rid, target_user_id))

        # Delete from trading_accounts and dependent tables strictly by id and user_id
        target_tid = resolved_trading_id or account_id
        for dep_table in ("metaapi_trade_executions", "account_symbol_map", "signal_dispatch_locks"):
            if is_pg:
                c.execute("SAVEPOINT sp_del_tdep")
            try:
                c.execute(
                    f"DELETE FROM {dep_table} WHERE account_id IN (SELECT id FROM trading_accounts WHERE id=? AND user_id=?)",
                    (target_tid, target_user_id),
                )
                if is_pg:
                    c.execute("RELEASE SAVEPOINT sp_del_tdep")
            except Exception:
                if is_pg:
                    try:
                        c.execute("ROLLBACK TO SAVEPOINT sp_del_tdep")
                    except Exception:
                        pass
        c.execute("DELETE FROM trading_accounts WHERE id=? AND user_id=?", (target_tid, target_user_id))

        # Delete from metaapi_cloud_accounts strictly by id and user_id
        target_cid = resolved_cloud_id or target_tid
        if is_pg:
            c.execute("SAVEPOINT sp_del_cdep")
        try:
            c.execute("DELETE FROM metaapi_cloud_accounts WHERE id=? AND user_id=?", (target_cid, target_user_id))
            if is_pg:
                c.execute("RELEASE SAVEPOINT sp_del_cdep")
        except Exception:
            if is_pg:
                try:
                    c.execute("ROLLBACK TO SAVEPOINT sp_del_cdep")
                except Exception:
                    pass

        audit(c, u["id"], "trading_account_deleted", {
            "account_id": resolved_trading_id or resolved_legacy_id or account_id,
            "target_user_id": target_user_id,
            "metaapi_account_id": meta_id,
        })

    return {"ok": True, "id": resolved_trading_id or resolved_legacy_id or account_id, "status": "DELETED", "message": "Đã xoá tài khoản MT5 thành công."}
