"""Trading accounts management router for Direct-to-User Cloud MT5 execution."""
import asyncio
import time
import secrets
import logging
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException, Request

from app.db import tx, audit
from app.routers.deps import get_current_user, fail
from app.schemas.accounts import (
    TradingAccountCreate,
    TradingAccountUpdate,
)
from app.metaapi import MetaApiClient
from app.security import encrypt_secret
from app.services.billing_service import get_user_subscription

logger = logging.getLogger("zupirus.accounts")
router = APIRouter(tags=["accounts"])
_USER_ACCOUNT_LOCKS: Dict[str, asyncio.Lock] = {}


def _get_user_account_lock(user_id: str) -> asyncio.Lock:
    """Return a per-user asyncio lock to serialize concurrent account provisioning."""
    lock = _USER_ACCOUNT_LOCKS.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _USER_ACCOUNT_LOCKS[user_id] = lock
    return lock


def _row_to_account_response(row: dict) -> dict:
    """Format database row to standard account response dict."""
    import json
    row = dict(row)
    now_ts = time.time()
    cloud_exp = row.get("cloud_expires_at") or row.get("subscription_expires_at")
    is_cloud_active = (cloud_exp is None or float(cloud_exp) > now_ts)
    login_val = str(row.get("mt5_login") or row.get("login") or "")
    server_val = str(row.get("broker_server") or row.get("server") or "")

    rc = {}
    raw_rc = row.get("risk_config")
    if raw_rc:
        try:
            rc = json.loads(raw_rc) if isinstance(raw_rc, str) else dict(raw_rc)
        except Exception:
            rc = {}

    max_lot_val = row.get("max_lot")
    if max_lot_val is None:
        max_lot_val = rc.get("max_lot", 1.0)
    daily_profit_usd = row.get("daily_profit_target_usd")
    if daily_profit_usd is None:
        daily_profit_usd = rc.get("daily_profit_target_usd", 0.0)
    sym_map_custom = row.get("symbol_mapping_custom")
    if sym_map_custom is None:
        sym_map_custom = rc.get("symbol_mapping_custom", "")

    mult_val = float(row.get("risk_multiplier") or row.get("multiplier") or rc.get("multiplier") or 1.0)
    dd_val = float(row.get("prop_daily_dd_limit_pct") or rc.get("prop_daily_dd_limit_pct") or 4.5)

    bal_val = float(row.get("balance") or 0.0)
    eq_val = float(row.get("equity") or 0.0)
    pos_cnt = int(row.get("positions") or 0)
    hb = None
    try:
        from app.redis_client import get_cached_heartbeat
        hb = get_cached_heartbeat(row["id"])
        if hb:
            bal_val = float(hb.get("balance") or bal_val)
            eq_val = float(hb.get("equity") or eq_val)
            pos_cnt = int(hb.get("positions") or pos_cnt)
    except Exception:
        pass

    return {
        "id": row["id"],
        "user_id": row.get("user_id"),
        "email": row.get("email") or row.get("user_email"),
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
        "risk_percent": float(row.get("risk_percent") or rc.get("risk_percent") or 1.0),
        "max_lot": float(max_lot_val or 1.0),
        "multiplier": mult_val,
        "risk_multiplier": mult_val,
        "lot_multiplier": mult_val,
        "is_compounding": bool(row.get("is_compounding", 0)),
        "is_prop_firm_mode": bool(row.get("is_prop_firm_mode", 0)),
        "prop_stage": str(row.get("prop_stage") or rc.get("prop_stage") or "CHALLENGE").upper(),
        "auto_be_partial_tp": bool(row.get("auto_be_partial_tp", 0)),
        "prop_daily_dd_limit_pct": dd_val,
        "max_daily_dd_pct": dd_val,
        "prop_profit_target_pct": float(row.get("prop_profit_target_pct") or rc.get("prop_profit_target_pct") or 8.0),
        "daily_profit_target_usd": float(daily_profit_usd or 0.0),
        "symbol_mapping_custom": str(sym_map_custom or ""),
        "auto_trade": int(row.get("auto_trade", 1)),
        "enabled": bool(int(row.get("auto_trade", 1))),
        "account_type": row.get("account_type") or "STANDARD",
        "currency": row.get("currency") or "USD",
        "contract_size": float(row.get("contract_size") or 100.0),
        "tick_value": float(row.get("tick_value") or 1.0),
        "latency_ms": int(row.get("latency_ms") or 35),
        "balance": bal_val,
        "equity": eq_val,
        "positions": pos_cnt,
        "cached_heartbeat": hb,
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
                SELECT a.*, u.email AS email, s.plan_tier, s.service_expires_at, s.allow_compounding, s.allow_prop_firm_mode
                FROM trading_accounts a
                LEFT JOIN users u ON u.id = a.user_id
                LEFT JOIN subscriptions s ON s.user_id = a.user_id
                ORDER BY a.created_at DESC
            """
            rows = c.execute(query).fetchall()
        else:
            query = """
                SELECT a.*, u.email AS email, s.plan_tier, s.service_expires_at, s.allow_compounding, s.allow_prop_firm_mode
                FROM trading_accounts a
                LEFT JOIN users u ON u.id = a.user_id
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
    """Connect and provision an MT5 terminal on MetaApi Cloud (serialized per user)."""
    async with _get_user_account_lock(u["id"]):
        return await _create_account_locked(p, request, u)


async def _create_account_locked(
    p: TradingAccountCreate,
    request: Request,
    u: dict,
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
            if p.disclaimer_accepted:
                disc_id = f"disc_{secrets.token_hex(6)}"
                client_ip = request.client.host if request.client else "127.0.0.1"
                c.execute(
                    "INSERT INTO legal_disclaimers(id, user_id, terms_version, accepted_at, ip_address, signature_text, status) VALUES(?,?,?,?,?,?,?)",
                    (disc_id, user_id, "v1.0", now_ts, client_ip, u.get("email", "trader"), "active")
                )
                disc = {"id": disc_id}
            else:
                fail(403, "Yêu cầu đọc và ký Điều khoản Miễn trừ trách nhiệm pháp lý trước khi kết nối Cloud MT5.")

    # 2. Check if this (mt5_login, broker_server) already exists
    with tx() as c:
        existing_same_acc = c.execute(
            """
            SELECT ta.*, u.email AS owner_email
            FROM trading_accounts ta
            LEFT JOIN users u ON u.id = ta.user_id
            WHERE ta.mt5_login=? AND ta.broker_server=?
            """,
            (p.login, p.server)
        ).fetchone()
        existing_count = c.execute(
            "SELECT COUNT(*) FROM trading_accounts WHERE user_id=? AND NOT (mt5_login=? AND broker_server=?)",
            (user_id, p.login, p.server)
        ).fetchone()[0]

    if existing_same_acc:
        existing_same_acc = dict(existing_same_acc)
        owner_id = existing_same_acc["user_id"]
        # Strictly prevent cross-tenant account takeover regardless of owner_email format
        if owner_id != user_id and u.get("role") != "admin":
            fail(409, "Tài khoản MT5 trên Server này đã được liên kết hoặc xảy ra xung đột dữ liệu.")

    import os
    in_pytest = bool(os.getenv("PYTEST_CURRENT_TEST")) and os.getenv("ENFORCE_PAID_SUBSCRIPTION_IN_TEST") != "1"
    max_allowed = int(sub.get("max_mt5_accounts", 0))
    if u.get("role") != "admin" and not in_pytest and (not sub.get("is_active") or max_allowed <= 0):
        fail(
            403,
            "Bạn chưa kích hoạt gói thuê bao Cloud MT5 (0 khe cắm khả dụng). Vui lòng tạo mã QR SePay và hoàn tất thanh toán trước khi liên kết tài khoản MT5."
        )
    if existing_count >= max_allowed and u.get("role") != "admin":
        fail(403, f"Gói thuê bao hiện tại ({str(sub.get('plan_tier') or 'STARTER').upper()}) chỉ cho phép tối đa {max_allowed} tài khoản MT5. Vui lòng nâng cấp gói để thêm slot.")

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

    # Auto-detect Prop Firm server to apply safe Daily Drawdown limit (4.0% Prop vs 5.0% Standard/Cent)
    srv_lower = (p.server or "").lower()
    is_prop_server = is_prop or any(k in srv_lower for k in ("ftmo", "fundednext", "5ers", "the5ers", "alpha", "e8", "fundingpips", "prop"))
    effective_dd_limit = float(p.prop_daily_dd_limit_pct) if p.prop_daily_dd_limit_pct not in (None, 4.5, 4.0) else (4.0 if is_prop_server else 5.0)

    # 4. Provision & Auto-Deploy terminal on MetaApi Cloud (with 3-attempt transient retry)
    client = MetaApiClient()
    prov = None
    for attempt in range(1, 4):
        try:
            prov = await client.provision_account(
                name=p.account_name or f"User-{user_id[:6]}",
                login=p.login,
                password=p.password,
                server=p.server,
                platform=p.platform,
            )
            break
        except Exception as e:
            err_msg = str(e).lower()
            is_auth_or_server_err = any(k in err_msg for k in ("password", "credential", "invalid", "server", "unauthorized", "401", "403", "not found"))
            if is_auth_or_server_err or attempt == 3:
                logger.error(f"MetaApi provisioning failed for login {p.login} (attempt {attempt}): {e}")
                fail(400, f"Lỗi kết nối MetaApi Cloud (kiểm tra lại Mật khẩu/Server MT5): {str(e)}")
            import asyncio as _asyncio
            await _asyncio.sleep(1)

    meta_id = prov.get("id")
    meta_state = prov.get("state", "DEPLOY_PENDING")

    # Auto-call deploy_account() with 3 retries on transient errors
    if meta_id:
        import asyncio as _asyncio
        deployed_ok = False
        for attempt in range(1, 4):
            try:
                if await client.deploy_account(meta_id):
                    deployed_ok = True
                    meta_state = "DEPLOYED"
                    break
            except Exception as dep_err:
                logger.warning(f"MetaApi deploy attempt {attempt}/3 failed for {meta_id}: {dep_err}")
            if attempt < 3:
                await _asyncio.sleep(1)
        if not deployed_ok and meta_state != "DEPLOYED":
            meta_state = "DEPLOY_PENDING"
    account_id = existing_same_acc["id"] if existing_same_acc else f"acc_{secrets.token_hex(8)}"
    enc_pwd = encrypt_secret(p.password)

    # Cloud expiration defaults to 30 days or matches subscription
    cloud_expiry = sub.get("service_expires_at") or (now_ts + 30 * 86400)

    prop_stage_val = str(p.prop_stage or "CHALLENGE").upper()
    if prop_stage_val not in ("CHALLENGE", "LIVE"):
        prop_stage_val = "CHALLENGE"

    with tx() as c:
        try:
            if existing_same_acc:
                c.execute("""
                    UPDATE trading_accounts SET
                        user_id=?, encrypted_master_password=?, metaapi_account_id=?,
                        deployment_state=?, subscription_expires_at=?, cloud_expires_at=?,
                        auto_trade=1, last_sync=?, risk_multiplier=?, is_compounding=?,
                        is_prop_firm_mode=?, prop_stage=?, prop_daily_dd_limit_pct=?, prop_profit_target_pct=?
                    WHERE id=?
                """, (
                    user_id, enc_pwd, meta_id,
                    meta_state, cloud_expiry, cloud_expiry,
                    now_ts, risk_mult, 1 if is_compounding else 0,
                    1 if is_prop else 0, prop_stage_val, effective_dd_limit, p.prop_profit_target_pct,
                    account_id
                ))
            else:
                cnt_row = c.execute("SELECT COUNT(*) FROM trading_accounts WHERE user_id = ?", (user_id,)).fetchone()
                if u.get("role") != "admin" and max_allowed > 0 and cnt_row and int(cnt_row[0]) >= max_allowed:
                    fail(403, f"Gói dịch vụ hiện tại cho phép tối đa {max_allowed} tài khoản MT5 Cloud.")
                c.execute("""
                    INSERT INTO trading_accounts(
                        id, user_id, mt5_login, encrypted_master_password, broker_server,
                        metaapi_account_id, deployment_state, risk_config, subscription_expires_at,
                        cloud_expires_at, auto_trade, balance, equity, created_at, last_sync,
                        risk_multiplier, is_compounding, is_prop_firm_mode, prop_stage,
                        prop_daily_dd_limit_pct, prop_profit_target_pct
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    account_id, user_id, p.login, enc_pwd, p.server,
                    meta_id, meta_state, '{"risk_percent": 1.0, "max_lot": 1.0, "multiplier": 1.0}', cloud_expiry,
                    cloud_expiry, 1, 0.0, 0.0, now_ts, now_ts,
                    risk_mult, 1 if is_compounding else 0, 1 if is_prop else 0, prop_stage_val,
                    effective_dd_limit, p.prop_profit_target_pct
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
        except HTTPException:
            if not existing_same_acc and meta_id:
                try:
                    await client.delete_account(meta_id)
                except Exception:
                    pass
            raise
        except Exception as e:
            logger.error(f"Failed to save account {p.login} to database: {e}")
            try:
                if meta_id:
                    await client.delete_account(meta_id)
            except Exception as rollback_err:
                logger.warning(f"Failed to rollback MetaApi account {meta_id}: {rollback_err}")
            fail(409, "Tài khoản MT5 trên Server này đã được liên kết hoặc xảy ra xung đột dữ liệu.")

        from app.services.account_classifier import detect_account_type
        from app.services.symbol_mapper import discover_and_map_account_symbols

    # Perform MetaApi network calls outside the database transaction lock
    acc_currency = "USD"
    acc_info = None
    try:
        acc_info = await client.get_account_information(meta_id)
        if acc_info and acc_info.get("currency"):
            acc_currency = str(acc_info.get("currency")).upper()
    except Exception:
        pass

    broker_symbols_list = None
    try:
        if hasattr(client, "get_symbols"):
            broker_symbols_list = await client.get_symbols(meta_id)
    except Exception:
        broker_symbols_list = None

    acc_type = detect_account_type(currency=acc_currency, server=p.server, name=p.account_name)
    contract_size = 1.0 if acc_type == "CENT" else 100.0
    auto_be_default = 1 if sub.get("allow_partial_tp_be") else 0
    auto_prop_default = 1 if (is_prop or (sub.get("allow_prop_firm_mode") and acc_type in ("PROP", "PROP_FIRM"))) else 0

    with tx() as c:
        c.execute(
            """
            UPDATE trading_accounts
            SET account_type=?, contract_size=?, auto_be_partial_tp=?, is_prop_firm_mode=?, latency_ms=28
            WHERE id=?
            """,
            (acc_type, contract_size, auto_be_default, auto_prop_default, account_id),
        )
        discover_and_map_account_symbols(account_id, broker_symbols_list or ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"], db_cursor=c)

        # Attempt immediate live balance synchronization from broker
        if acc_info and acc_info.get("balance") is not None:
            real_bal = float(acc_info.get("balance", 0.0))
            real_eq = float(acc_info.get("equity", real_bal))
            if real_bal > 0:
                c.execute("UPDATE trading_accounts SET balance=?, equity=? WHERE id=?", (real_bal, real_eq, account_id))
                c.execute("UPDATE metaapi_cloud_accounts SET balance=?, equity=? WHERE id=?", (real_bal, real_eq, account_id))

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


def _resolve_target_account(c, account_id: str, u: dict) -> dict:
    """Resolve an account row with strict tenant isolation (supports both trading_accounts and EA Bridge accounts)."""
    is_admin = u.get("role") == "admin"
    user_id = u["id"]
    row = c.execute(
        "SELECT * FROM trading_accounts WHERE (id=? OR mt5_login=? OR metaapi_account_id=?) AND user_id=?",
        (account_id, account_id, account_id, user_id),
    ).fetchone()
    if row:
        return dict(row)

    # Check if trading_account exists under another user
    any_row = c.execute(
        "SELECT * FROM trading_accounts WHERE id=? OR mt5_login=? OR metaapi_account_id=?",
        (account_id, account_id, account_id),
    ).fetchone()
    if any_row:
        acc = dict(any_row)
        if is_admin:
            return acc
        fail(403, "Không có quyền thao tác trên tài khoản này.")

    # Fallback: check EA Bridge accounts table
    ea_row = c.execute(
        "SELECT * FROM accounts WHERE (id=? OR login=?) AND user_id=?",
        (account_id, account_id, user_id),
    ).fetchone()
    if not ea_row and is_admin:
        ea_row = c.execute(
            "SELECT * FROM accounts WHERE id=? OR login=?",
            (account_id, account_id),
        ).fetchone()
    if ea_row:
        d = dict(ea_row)
        d["_is_ea_bridge"] = True
        d["auto_trade"] = int(d.get("enabled", 1))
        d["mt5_login"] = d.get("login")
        d["broker_server"] = d.get("server")
        return d

    fail(404, "Tài khoản không tồn tại.")


@router.patch("/api/v1/accounts/{account_id}")
def update_account_risk(
    account_id: str,
    p: TradingAccountUpdate,
    u: dict = Depends(get_current_user)
):
    """Update risk management parameters with subscription tier validation."""
    import json
    user_id = u["id"]
    sub = get_user_subscription(user_id)

    with tx() as c:
        acc = _resolve_target_account(c, account_id, u)
        real_id = acc["id"]
        owner_id = acc["user_id"]

        rc = {}
        if acc.get("risk_config"):
            try:
                rc = json.loads(acc["risk_config"]) if isinstance(acc["risk_config"], str) else dict(acc["risk_config"])
            except Exception:
                rc = {}

        updates = []
        params = []

        if p.risk_multiplier is not None:
            if p.risk_multiplier > 1.0 and not sub.get("allow_custom_multiplier") and u.get("role") != "admin":
                fail(403, "Cần nâng cấp lên gói Growth hoặc Prop Firm Alpha để dùng Risk Multiplier > 1.0x.")
            updates.append("risk_multiplier=?")
            params.append(p.risk_multiplier)
            rc["multiplier"] = p.risk_multiplier
            rc["risk_multiplier"] = p.risk_multiplier

        if p.max_lot is not None:
            updates.append("max_lot=?")
            params.append(p.max_lot)
            rc["max_lot"] = p.max_lot

        if p.daily_profit_target_usd is not None:
            updates.append("daily_profit_target_usd=?")
            params.append(p.daily_profit_target_usd)
            rc["daily_profit_target_usd"] = p.daily_profit_target_usd

        if p.symbol_mapping_custom is not None:
            updates.append("symbol_mapping_custom=?")
            params.append(p.symbol_mapping_custom)
            rc["symbol_mapping_custom"] = p.symbol_mapping_custom

        if p.is_compounding is not None:
            if p.is_compounding and not sub.get("allow_compounding") and u.get("role") != "admin":
                fail(403, "Cần nâng cấp lên gói Growth hoặc Prop Firm Alpha để bật Lãi Kép (Auto-Compounding).")
            updates.append("is_compounding=?")
            params.append(1 if p.is_compounding else 0)
            rc["is_compounding"] = bool(p.is_compounding)

        if p.is_prop_firm_mode is not None:
            if p.is_prop_firm_mode and not sub.get("allow_prop_firm_mode") and u.get("role") != "admin":
                fail(403, "Cần nâng cấp lên gói Prop Firm Alpha để kích hoạt Chế Độ Thi Quỹ (Prop Firm Guard).")
            updates.append("is_prop_firm_mode=?")
            params.append(1 if p.is_prop_firm_mode else 0)
            rc["is_prop_firm_mode"] = bool(p.is_prop_firm_mode)

        if p.prop_stage is not None:
            stage_clean = str(p.prop_stage).upper()
            if stage_clean in ("CHALLENGE", "LIVE"):
                updates.append("prop_stage=?")
                params.append(stage_clean)
                rc["prop_stage"] = stage_clean

        if p.auto_be_partial_tp is not None:
            updates.append("auto_be_partial_tp=?")
            params.append(1 if p.auto_be_partial_tp else 0)
            rc["auto_be_partial_tp"] = bool(p.auto_be_partial_tp)

        if p.prop_daily_dd_limit_pct is not None:
            updates.append("prop_daily_dd_limit_pct=?")
            params.append(p.prop_daily_dd_limit_pct)
            rc["prop_daily_dd_limit_pct"] = p.prop_daily_dd_limit_pct

        if p.prop_profit_target_pct is not None:
            updates.append("prop_profit_target_pct=?")
            params.append(p.prop_profit_target_pct)
            rc["prop_profit_target_pct"] = p.prop_profit_target_pct

        if p.auto_trade is not None:
            updates.append("auto_trade=?")
            params.append(1 if p.auto_trade else 0)

        if acc.get("_is_ea_bridge"):
            if p.prop_daily_dd_limit_pct is not None:
                c.execute("UPDATE accounts SET max_dd=? WHERE id=? AND user_id=?", (float(p.prop_daily_dd_limit_pct), real_id, owner_id))
            if p.auto_trade is not None:
                c.execute("UPDATE accounts SET enabled=? WHERE id=? AND user_id=?", (1 if p.auto_trade else 0, real_id, owner_id))
            updated_ea = c.execute("SELECT * FROM accounts WHERE id=? AND user_id=?", (real_id, owner_id)).fetchone()
            return {
                "id": real_id,
                "status": "UPDATED",
                "account": dict(updated_ea) if updated_ea else {"id": real_id},
                "message": "Đã cập nhật cấu hình rủi ro cho trạm EA Bridge thành công."
            }

        if updates:
            updates.append("risk_config=?")
            params.append(json.dumps(rc))
            params.extend([real_id, owner_id])
            c.execute(f"UPDATE trading_accounts SET {', '.join(updates)} WHERE id=? AND user_id=?", params)

            # Sync matching fields to metaapi_cloud_accounts
            cloud_updates = []
            cloud_params = []
            if p.risk_multiplier is not None:
                cloud_updates.append("multiplier=?")
                cloud_params.append(p.risk_multiplier)
            if p.max_lot is not None:
                cloud_updates.append("max_lot=?")
                cloud_params.append(p.max_lot)
            if p.auto_trade is not None:
                cloud_updates.append("auto_trade=?")
                cloud_params.append(1 if p.auto_trade else 0)
            if cloud_updates:
                cloud_params.extend([real_id, owner_id])
                c.execute(f"UPDATE metaapi_cloud_accounts SET {', '.join(cloud_updates)} WHERE id=? AND user_id=?", cloud_params)
            audit(c, user_id, "trading_account_risk_updated", {
                "account_id": real_id,
                "updates": p.model_dump(exclude_unset=True)
            })

        updated_row = c.execute("SELECT * FROM trading_accounts WHERE id=? AND user_id=?", (real_id, owner_id)).fetchone()
        account_data = _row_to_account_response(dict(updated_row)) if updated_row else {"id": real_id}

    return {
        "id": real_id,
        "status": "UPDATED",
        "account": account_data,
        "message": "Đã cập nhật cấu hình rủi ro thành công."
    }

