"""Trading accounts management router for Direct-to-User Cloud MT5 execution."""
import time
import secrets
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request

from app.db import tx, audit
from app.routers.deps import get_current_user, get_current_admin, fail
from app.schemas.accounts import (
    TradingAccountCreate,
    TradingAccountUpdate,
    TradingAccountResponse,
)
from app.metaapi import MetaApiClient
from app.security import encrypt_secret
from app.services.billing_service import get_user_subscription

logger = logging.getLogger("zupirus.accounts")
router = APIRouter(tags=["accounts"])


def _row_to_account_response(row: dict) -> dict:
    """Format database row to standard account response dict."""
    now_ts = time.time()
    cloud_exp = row.get("cloud_expires_at") or row.get("subscription_expires_at")
    is_cloud_active = (cloud_exp is None or float(cloud_exp) > now_ts)
    login_val = str(row.get("mt5_login") or row.get("login") or "")
    server_val = str(row.get("broker_server") or row.get("server") or "")

    return {
        "id": row["id"],
        "login": login_val,
        "server": server_val,
        "mt5_login": login_val,
        "broker_server": server_val,
        "platform": row.get("platform") or "mt5",
        "account_name": row.get("account_name") or f"MT5-{login_val}",
        "deployment_state": row.get("deployment_state") or row.get("metaapi_state") or "DEPLOYED",
        "metaapi_state": row.get("deployment_state") or row.get("metaapi_state") or "DEPLOYED",
        "metaapi_account_id": row.get("metaapi_account_id"),
        "cloud_expires_at": float(cloud_exp) if cloud_exp else None,
        "is_cloud_active": is_cloud_active,
        "risk_percent": float(row.get("risk_percent") or 1.0),
        "max_lot": float(row.get("max_lot") or 1.0),
        "multiplier": float(row.get("multiplier") or row.get("risk_multiplier") or 1.0),
        "risk_multiplier": float(row.get("risk_multiplier") or row.get("multiplier") or 1.0),
        "is_compounding": bool(row.get("is_compounding", 0)),
        "is_prop_firm_mode": bool(row.get("is_prop_firm_mode", 0)),
        "auto_be_partial_tp": bool(row.get("auto_be_partial_tp", 0)),
        "prop_daily_dd_limit_pct": float(row.get("prop_daily_dd_limit_pct") or 4.5),
        "prop_profit_target_pct": float(row.get("prop_profit_target_pct") or 8.0),
        "auto_trade": int(row.get("auto_trade", 1)),
        "account_type": row.get("account_type") or "STANDARD",
        "currency": row.get("currency") or "USD",
        "contract_size": float(row.get("contract_size") or 100.0),
        "tick_value": float(row.get("tick_value") or 1.0),
        "latency_ms": int(row.get("latency_ms") or 35),
        "balance": float(row.get("balance") or 0.0),
        "equity": float(row.get("equity") or 0.0),
        "last_sync": float(row.get("last_sync")) if row.get("last_sync") else None,
        "created_at": float(row.get("created_at") or now_ts),
    }


@router.get("/api/v1/accounts")
@router.get("/api/metaapi/accounts")
def list_accounts(u: dict = Depends(get_current_user)):
    """List connected Cloud MT5 accounts for the current user (or all accounts if admin)."""
    with tx() as c:
        if u.get("role") == "admin":
            query = """
                SELECT a.*, s.plan_tier, s.service_expires_at, s.allow_compounding, s.allow_prop_firm_mode
                FROM trading_accounts a
                LEFT JOIN subscriptions s ON s.user_id = a.user_id
                ORDER BY a.created_at DESC
            """
            rows = c.execute(query).fetchall()
        else:
            query = """
                SELECT a.*, s.plan_tier, s.service_expires_at, s.allow_compounding, s.allow_prop_firm_mode
                FROM trading_accounts a
                LEFT JOIN subscriptions s ON s.user_id = a.user_id
                WHERE a.user_id = ?
                ORDER BY a.created_at DESC
            """
            rows = c.execute(query, (u["id"],)).fetchall()

        raw_accounts = [_row_to_account_response(dict(r)) for r in rows]
        # Deduplicate accounts by (login, server) keeping the most recently updated
        seen = set()
        accounts = []
        for a in raw_accounts:
            login = a.get("login") or a.get("mt5_login") or a.get("id")
            server = (a.get("server") or a.get("broker_server") or "").lower()
            key = (str(login), server)
            if key not in seen:
                seen.add(key)
                accounts.append(a)
        return {"accounts": accounts}


@router.post("/api/v1/accounts")
@router.post("/api/metaapi/accounts")
async def create_account(
    p: TradingAccountCreate,
    request: Request,
    u: dict = Depends(get_current_user)
):
    """
    Connect and provision an MT5 terminal on MetaApi Cloud without needing EA or VPS.
    Direct-to-User execution stream.
    """
    user_id = u["id"]
    sub = get_user_subscription(user_id)
    now_ts = time.time()

    # 1. Enforce Terms of Service / Legal Disclaimer
    with tx() as c:
        disc = c.execute(
            "SELECT id FROM legal_disclaimers WHERE user_id=? AND status='active'",
            (user_id,)
        ).fetchone()
        if not disc:
            fail(403, "Yêu cầu đọc và ký Điều khoản Miễn trừ trách nhiệm pháp lý trước khi kết nối Cloud MT5.")

    # 2. Check maximum account limit according to subscription
    with tx() as c:
        existing_count = c.execute(
            "SELECT COUNT(*) FROM trading_accounts WHERE user_id=?",
            (user_id,)
        ).fetchone()[0]

    max_allowed = sub.get("max_mt5_accounts", 1)
    if existing_count >= max_allowed and u.get("role") != "admin":
        fail(403, f"Gói thuê bao hiện tại ({sub.get('plan_tier').upper()}) chỉ cho phép tối đa {max_allowed} tài khoản MT5. Vui lòng nâng cấp gói để thêm slot.")

    # 3. Check tier permissions for advanced features
    risk_mult = p.risk_multiplier
    if risk_mult > 1.0 and not sub.get("allow_custom_multiplier") and u.get("role") != "admin":
        fail(403, "Tính năng Risk Multiplier > 1.0x chỉ dành cho gói Growth hoặc Prop Firm Alpha.")

    is_compounding = p.is_compounding
    if is_compounding and not sub.get("allow_compounding") and u.get("role") != "admin":
        fail(403, "Tính năng Tự động Lãi kép (Auto-Compounding) chỉ dành cho gói Growth hoặc Prop Firm Alpha.")

    is_prop = p.is_prop_firm_mode
    if is_prop and not sub.get("allow_prop_firm_mode") and u.get("role") != "admin":
        fail(403, "Tính năng Bảo Vệ Quỹ (Prop Firm Pass Guard) chỉ dành cho gói Prop Firm Alpha.")

    # 4. Provision terminal on MetaApi Cloud
    client = MetaApiClient()
    try:
        prov = await client.provision_account(
            name=p.account_name or f"User-{user_id[:6]}",
            login=p.login,
            password=p.password,
            server=p.server,
            platform=p.platform,
        )
    except Exception as e:
        logger.error(f"MetaApi provisioning failed for login {p.login}: {e}")
        fail(400, f"Lỗi kết nối MetaApi Cloud: {str(e)}")

    meta_id = prov.get("id")
    meta_state = prov.get("state", "DEPLOYED")
    account_id = f"acc_{secrets.token_hex(8)}"
    enc_pwd = encrypt_secret(p.password)

    # Cloud expiration defaults to 30 days or matches subscription
    cloud_expiry = sub.get("service_expires_at") or (now_ts + 30 * 86400)

    with tx() as c:
        try:
            c.execute("""
                INSERT INTO trading_accounts(
                    id, user_id, mt5_login, encrypted_master_password, broker_server,
                    metaapi_account_id, deployment_state, risk_config, subscription_expires_at,
                    cloud_expires_at, auto_trade, balance, equity, created_at, last_sync,
                    risk_multiplier, is_compounding, is_prop_firm_mode,
                    prop_daily_dd_limit_pct, prop_profit_target_pct
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                account_id, user_id, p.login, enc_pwd, p.server,
                meta_id, meta_state, '{"risk_percent": 1.0, "max_lot": 1.0, "multiplier": 1.0}', cloud_expiry,
                cloud_expiry, 1, 0.0, 0.0, now_ts, now_ts,
                risk_mult, 1 if is_compounding else 0, 1 if is_prop else 0,
                p.prop_daily_dd_limit_pct, p.prop_profit_target_pct
            ))
            # Also keep metaapi_cloud_accounts in sync for backwards compatibility
            c.execute("""
                INSERT OR REPLACE INTO metaapi_cloud_accounts(
                    id, user_id, login, server, platform, account_name,
                    metaapi_account_id, metaapi_state, disclaimer_id,
                    risk_percent, max_lot, multiplier, auto_trade,
                    balance, equity, currency, encrypted_password, last_sync, created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,0.0,0.0,'USD',?,?,?)
            """, (
                account_id, user_id, p.login, p.server, p.platform, p.account_name,
                meta_id, meta_state, disc["id"],
                1.0, 1.0, risk_mult,
                enc_pwd, now_ts, now_ts
            ))
        except Exception as e:
            logger.error(f"Failed to save account {p.login} to database: {e}")
            try:
                import asyncio
                if meta_id:
                    asyncio.create_task(client.delete_account(meta_id))
            except Exception as rollback_err:
                logger.warning(f"Failed to rollback MetaApi account {meta_id}: {rollback_err}")
            fail(409, "Tài khoản MT5 trên Server này đã được liên kết hoặc xảy ra xung đột dữ liệu.")

        from app.services.account_classifier import detect_account_type
        from app.services.symbol_mapper import discover_and_map_account_symbols
        acc_type = detect_account_type(currency="USD", server=p.server, name=p.account_name)
        c.execute("UPDATE trading_accounts SET account_type=?, latency_ms=28 WHERE id=?", (acc_type, account_id))
        discover_and_map_account_symbols(account_id, ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"], db_cursor=c)

        # Attempt immediate live balance synchronization from broker
        try:
            acc_info = await client.get_account_information(meta_id)
            if acc_info and acc_info.get("balance") is not None:
                real_bal = float(acc_info.get("balance", 0.0))
                real_eq = float(acc_info.get("equity", real_bal))
                if real_bal > 0:
                    c.execute("UPDATE trading_accounts SET balance=?, equity=? WHERE id=?", (real_bal, real_eq, account_id))
                    c.execute("UPDATE metaapi_cloud_accounts SET balance=?, equity=? WHERE id=?", (real_bal, real_eq, account_id))
        except Exception:
            pass

        audit(c, user_id, "trading_account_cloud_connected", {
            "account_id": account_id,
            "login": p.login,
            "server": p.server,
            "metaapi_id": meta_id,
            "plan_tier": sub.get("plan_tier")
        })

    return {
        "id": account_id,
        "metaapi_account_id": meta_id,
        "state": meta_state,
        "message": "Đã kết nối tài khoản MT5 Cloud thành công. Hệ thống tự động bắn lệnh trực tiếp khi có tín hiệu.",
    }


@router.patch("/api/v1/accounts/{account_id}")
def update_account_risk(
    account_id: str,
    p: TradingAccountUpdate,
    u: dict = Depends(get_current_user)
):
    """Update risk management parameters with subscription tier validation."""
    user_id = u["id"]
    sub = get_user_subscription(user_id)

    with tx() as c:
        acc = c.execute("SELECT * FROM trading_accounts WHERE id=?", (account_id,)).fetchone()
        if not acc:
            fail(404, "Tài khoản không tồn tại.")
        if u.get("role") != "admin" and acc["user_id"] != user_id:
            fail(403, "Không có quyền chỉnh sửa tài khoản này.")

        updates = []
        params = []

        if p.risk_multiplier is not None:
            if p.risk_multiplier > 1.0 and not sub.get("allow_custom_multiplier") and u.get("role") != "admin":
                fail(403, "Cần nâng cấp lên gói Growth hoặc Prop Firm Alpha để dùng Risk Multiplier > 1.0x.")
            updates.append("risk_multiplier=?")
            params.append(p.risk_multiplier)

        if p.is_compounding is not None:
            if p.is_compounding and not sub.get("allow_compounding") and u.get("role") != "admin":
                fail(403, "Cần nâng cấp lên gói Growth hoặc Prop Firm Alpha để bật Lãi Kép (Auto-Compounding).")
            updates.append("is_compounding=?")
            params.append(1 if p.is_compounding else 0)

        if p.is_prop_firm_mode is not None:
            if p.is_prop_firm_mode and not sub.get("allow_prop_firm_mode") and u.get("role") != "admin":
                fail(403, "Cần nâng cấp lên gói Prop Firm Alpha để kích hoạt Chế Độ Thi Quỹ (Prop Firm Guard).")
            updates.append("is_prop_firm_mode=?")
            params.append(1 if p.is_prop_firm_mode else 0)

        if p.auto_be_partial_tp is not None:
            updates.append("auto_be_partial_tp=?")
            params.append(1 if p.auto_be_partial_tp else 0)

        if p.prop_daily_dd_limit_pct is not None:
            updates.append("prop_daily_dd_limit_pct=?")
            params.append(p.prop_daily_dd_limit_pct)

        if p.prop_profit_target_pct is not None:
            updates.append("prop_profit_target_pct=?")
            params.append(p.prop_profit_target_pct)

        if p.auto_trade is not None:
            updates.append("auto_trade=?")
            params.append(1 if p.auto_trade else 0)

        if updates:
            params.append(account_id)
            c.execute(f"UPDATE trading_accounts SET {', '.join(updates)} WHERE id=?", params)

            # Sync matching fields to metaapi_cloud_accounts
            cloud_updates = []
            cloud_params = []
            if p.risk_multiplier is not None:
                cloud_updates.append("multiplier=?")
                cloud_params.append(p.risk_multiplier)
            if p.auto_trade is not None:
                cloud_updates.append("auto_trade=?")
                cloud_params.append(1 if p.auto_trade else 0)
            if cloud_updates:
                cloud_params.append(account_id)
                c.execute(f"UPDATE metaapi_cloud_accounts SET {', '.join(cloud_updates)} WHERE id=?", cloud_params)
            audit(c, user_id, "trading_account_risk_updated", {
                "account_id": account_id,
                "updates": p.model_dump(exclude_unset=True)
            })

    return {"id": account_id, "status": "UPDATED", "message": "Đã cập nhật cấu hình rủi ro thành công."}


@router.post("/api/v1/accounts/{account_id}/toggle")
@router.post("/api/metaapi/accounts/{account_id}/toggle")
def toggle_account(account_id: str, u: dict = Depends(get_current_user)):
    """Toggle auto-trading state for a cloud MT5 terminal."""
    with tx() as c:
        acc = c.execute("SELECT * FROM trading_accounts WHERE id=?", (account_id,)).fetchone()
        if not acc:
            fail(404, "Tài khoản không tồn tại.")
        if u.get("role") != "admin" and acc["user_id"] != u["id"]:
            fail(403, "Không có quyền.")

        new_state = 1 if acc["auto_trade"] == 0 else 0
        c.execute("UPDATE trading_accounts SET auto_trade=? WHERE id=?", (new_state, account_id))
        try:
            c.execute("UPDATE metaapi_cloud_accounts SET auto_trade=? WHERE id=?", (new_state, account_id))
        except Exception:
            pass
        audit(c, u["id"], "trading_account_toggle_auto_trade", {
            "account_id": account_id,
            "auto_trade": new_state
        })

    return {
        "id": account_id,
        "auto_trade": new_state,
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
        acc_row = c.execute("SELECT * FROM trading_accounts WHERE id=?", (account_id,)).fetchone()
        if not acc_row:
            acc_row = c.execute("SELECT * FROM trading_accounts WHERE mt5_login=? OR metaapi_account_id=?", (account_id, account_id)).fetchone()
        if not acc_row:
            fail(404, "Tài khoản không tồn tại.")
        acc = dict(acc_row)
        if u.get("role") != "admin" and acc["user_id"] != u["id"]:
            fail(403, "Không có quyền.")

    meta_id = acc.get("metaapi_account_id")
    client = MetaApiClient()
    new_state = "DEPLOYED" if act == "deploy" else "UNDEPLOYED"
    if meta_id:
        if act == "deploy":
            await client.deploy_account(meta_id)
        else:
            await client.undeploy_account(meta_id)

    with tx() as c:
        c.execute("UPDATE trading_accounts SET deployment_state=? WHERE id=?", (new_state, acc["id"]))
        try:
            c.execute("UPDATE metaapi_cloud_accounts SET metaapi_state=? WHERE id=? OR metaapi_account_id=?", (new_state, acc["id"], meta_id))
        except Exception:
            pass

    return {
        "id": acc["id"],
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
        acc = c.execute("SELECT * FROM trading_accounts WHERE id=?", (account_id,)).fetchone()
        if not acc:
            fail(404, "Tài khoản không tồn tại.")
        if u.get("role") != "admin" and acc["user_id"] != u["id"]:
            fail(403, "Không có quyền.")

    client = MetaApiClient()
    meta_id = acc.get("metaapi_account_id") or account_id
    info = await client.get_account_information(meta_id)
    eq = float(info.get("equity", acc["equity"]))
    bal = float(info.get("balance", acc["balance"]))
    now_ts = time.time()

    with tx() as c:
        c.execute(
            "UPDATE trading_accounts SET equity=?, balance=?, last_sync=? WHERE id=?",
            (eq, bal, now_ts, account_id)
        )

    return {"id": account_id, "equity": eq, "balance": bal, "last_sync": now_ts}


@router.delete("/api/v1/accounts/{account_id}")
@router.delete("/api/metaapi/accounts/{account_id}")
async def delete_account(account_id: str, u: dict = Depends(get_current_user)):
    """Undeploy cloud terminal on MetaApi and remove account from platform."""
    with tx() as c:
        acc = c.execute("SELECT * FROM trading_accounts WHERE id=?", (account_id,)).fetchone()
        if not acc:
            fail(404, "Tài khoản không tồn tại.")
        if u.get("role") != "admin" and acc["user_id"] != u["id"]:
            fail(403, "Không có quyền.")

    meta_id = acc.get("metaapi_account_id")
    if meta_id:
        client = MetaApiClient()
        try:
            await client.undeploy_account(meta_id)
        except Exception as e:
            logger.warning(f"Could not undeploy MetaApi account {meta_id}: {e}")

    with tx() as c:
        c.execute("DELETE FROM trading_accounts WHERE id=?", (account_id,))
        try:
            c.execute("DELETE FROM metaapi_cloud_accounts WHERE id=?", (account_id,))
        except Exception:
            pass
        audit(c, u["id"], "trading_account_deleted", {"account_id": account_id})

    return {"id": account_id, "status": "DELETED", "message": "Đã gỡ tài khoản MT5 Cloud thành công."}
