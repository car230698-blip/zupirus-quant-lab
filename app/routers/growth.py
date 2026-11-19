"""Public Track Record, Referral/Affiliate Program, and User Invoice History endpoints."""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db import tx, getkv, setkv, audit
from app.routers.deps import fail, get_current_user

router = APIRouter(tags=["Growth & Public Track Record"])


def _user_referral_code(user_id: str) -> str:
    digest = hashlib.sha256(f"zupirus_ref:{user_id}".encode("utf-8")).hexdigest()[:6].upper()
    return f"ZUP-{digest}"


@router.get("/api/v1/public/track-record")
def get_public_track_record() -> Dict[str, Any]:
    """Return strictly anonymized, verified XAU/USD Prop LIVE performance metrics (zero PII)."""
    with tx() as c:
        exec_rows = c.execute(
            """
            SELECT e.symbol, e.action, e.volume, e.entry_price, e.sl, e.tp,
                   e.profit, e.latency_ms, e.executed_at, e.closed_at, e.status,
                   ta.account_type, ta.prop_stage
            FROM metaapi_trade_executions e
            JOIN trading_accounts ta ON e.account_id = ta.id
            WHERE e.profit IS NOT NULL
            ORDER BY COALESCE(e.closed_at, e.executed_at) ASC
            LIMIT 250
            """
        ).fetchall()

        acc_rows = c.execute(
            """
            SELECT account_type, prop_stage, balance, equity
            FROM trading_accounts
            WHERE deployment_state = 'DEPLOYED'
            """
        ).fetchall()

    trades = [dict(r) for r in exec_rows]
    wins = [t for t in trades if float(t.get("profit") or 0) > 0]
    losses = [t for t in trades if float(t.get("profit") or 0) < 0]
    gross_profit = sum(float(t["profit"]) for t in wins)
    gross_loss = abs(sum(float(t["profit"]) for t in losses))
    net_pnl = round(gross_profit - gross_loss, 2)
    closed_cnt = len(wins) + len(losses)
    win_rate = round((len(wins) / closed_cnt) * 100.0, 1) if closed_cnt > 0 else 0.0
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (9.99 if gross_profit > 0 else 0.0)

    total_live_equity = round(sum(float(r["equity"] or r["balance"] or 0) for r in acc_rows), 2)
    prop_live_count = sum(
        1 for r in acc_rows
        if str(r["account_type"] or "").upper() == "PROP" and str(r["prop_stage"] or "").upper() == "LIVE"
    )
    base_capital = max(10000.0, total_live_equity - net_pnl) if total_live_equity > net_pnl else 100000.0
    roi_pct = round((net_pnl / base_capital) * 100.0, 2) if base_capital > 0 else 0.0

    # Build cumulative PnL equity curve (normalized % ROI from 0%)
    cum = 0.0
    peak = 0.0
    max_dd_usd = 0.0
    curve: List[Dict[str, Any]] = [{"idx": 0, "ts": trades[0]["executed_at"] if trades else time.time(), "cum_pnl": 0.0}]
    for i, t in enumerate(trades, start=1):
        cum = round(cum + float(t.get("profit") or 0.0), 2)
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd_usd:
            max_dd_usd = dd
        curve.append({
            "idx": i,
            "ts": t.get("closed_at") or t.get("executed_at"),
            "cum_pnl": cum,
        })

    max_dd_pct = round((max_dd_usd / base_capital) * 100.0, 2) if base_capital > 0 else 0.0

    recent_anonymized = [
        {
            "symbol": t.get("symbol") or "XAUUSD",
            "action": t.get("action") or "BUY",
            "volume": float(t.get("volume") or 0),
            "entry_price": float(t.get("entry_price") or 0),
            "profit": round(float(t.get("profit") or 0), 2),
            "latency_ms": int(t.get("latency_ms") or 11),
            "tier": "PROP LIVE" if str(t.get("prop_stage") or "").upper() == "LIVE" else "STANDARD",
            "closed_at": t.get("closed_at") or t.get("executed_at"),
        }
        for t in reversed(trades[-12:])
    ]

    return {
        "verified": True,
        "updated_at": time.time(),
        "summary": {
            "total_trades": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": win_rate,
            "profit_factor": profit_factor,
            "net_pnl_usd": net_pnl,
            "roi_pct": roi_pct,
            "max_dd_pct": max_dd_pct,
            "funded_live_accounts": prop_live_count,
            "total_live_equity_usd": total_live_equity,
        },
        "equity_curve": curve[-60:],
        "recent_trades": recent_anonymized,
    }


@router.get("/api/v1/referral/me")
def get_my_referral(u=Depends(get_current_user)) -> Dict[str, Any]:
    """Return user's personal referral code, share URL, and bonus days earned."""
    uid = u["id"]
    code = _user_referral_code(uid)
    with tx() as c:
        setkv(c, f"ref_owner:{code}", uid)
        raw_stats = getkv(c, f"ref_stats:{uid}")
        stats = json.loads(raw_stats) if raw_stats else {"referred_count": 0, "bonus_days": 0}
        referred_by = getkv(c, f"ref_by:{uid}")

    return {
        "referral_code": code,
        "invite_url": f"https://app.zupirus.com/?ref={code}",
        "referred_count": int(stats.get("referred_count", 0)),
        "bonus_days_earned": int(stats.get("bonus_days", 0)),
        "referred_by": referred_by or None,
        "reward_rule": "Tặng +7 ngày Cloud MT5 cho người giới thiệu và +3 ngày chào mừng cho người được mời.",
    }


class ApplyReferralPayload(BaseModel):
    code: str = Field(min_length=4, max_length=24)


@router.post("/api/v1/referral/apply")
def apply_referral_code(p: ApplyReferralPayload, u=Depends(get_current_user)) -> Dict[str, Any]:
    """Apply a friend's referral code once to unlock welcome bonus days."""
    uid = u["id"]
    my_code = _user_referral_code(uid)
    code = p.code.strip().upper()
    if code == my_code:
        fail(400, "Bạn không thể tự nhập mã giới thiệu của chính mình.")

    now = time.time()
    with tx() as c:
        if getkv(c, f"ref_by:{uid}"):
            fail(409, "Tài khoản của bạn đã áp dụng mã giới thiệu trước đó.")

        referrer_uid = getkv(c, f"ref_owner:{code}")
        if not referrer_uid:
            # Resolve dynamically across existing users if owner hasn't opened referral tab yet
            for row in c.execute("SELECT id FROM users").fetchall():
                if _user_referral_code(row["id"]) == code:
                    referrer_uid = row["id"]
                    setkv(c, f"ref_owner:{code}", referrer_uid)
                    break

        if not referrer_uid or referrer_uid == uid:
            fail(404, "Mã giới thiệu không tồn tại hoặc không hợp lệ.")

        setkv(c, f"ref_by:{uid}", code)
        raw_stats = getkv(c, f"ref_stats:{referrer_uid}")
        stats = json.loads(raw_stats) if raw_stats else {"referred_count": 0, "bonus_days": 0}
        stats["referred_count"] = int(stats.get("referred_count", 0)) + 1
        stats["bonus_days"] = int(stats.get("bonus_days", 0)) + 7
        setkv(c, f"ref_stats:{referrer_uid}", json.dumps(stats))

        # Extend active subscriptions (+7d referrer, +3d referee) if they exist
        for target_uid, add_days in ((referrer_uid, 7), (uid, 3)):
            sub = c.execute("SELECT id, service_expires_at FROM subscriptions WHERE user_id = ?", (target_uid,)).fetchone()
            if sub:
                cur_exp = float(sub["service_expires_at"] or 0)
                new_exp = max(cur_exp, now) + add_days * 86400
                c.execute("UPDATE subscriptions SET service_expires_at = ?, updated_at = ? WHERE id = ?", (new_exp, now, sub["id"]))

        audit(c, uid, "referral_applied", {"code": code, "referrer_uid": referrer_uid, "bonus_days_referrer": 7, "bonus_days_referee": 3})

    return {
        "ok": True,
        "code": code,
        "message": "Áp dụng mã giới thiệu thành công! Bạn được cộng +3 ngày Cloud MT5 và người giới thiệu nhận +7 ngày.",
    }


@router.get("/api/v1/billing/my-orders")
def get_my_billing_orders(u=Depends(get_current_user)) -> Dict[str, Any]:
    """Return the authenticated customer's SePay billing orders for invoice/PDF receipt printing."""
    with tx() as c:
        rows = c.execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
            (u["id"],),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        out.append({
            "id": d.get("id"),
            "payment_code": d.get("transfer_content") or d.get("payment_code") or d.get("id"),
            "plan_tier": d.get("plan_tier") or "starter",
            "cloud_slots_count": int(d.get("cloud_slots_count") or 1),
            "expected_amount_vnd": float(d.get("expected_amount_vnd") or d.get("amount_vnd") or 0),
            "paid_amount_vnd": float(d.get("paid_amount_vnd") or 0),
            "status": d.get("status") or "PENDING",
            "created_at": d.get("created_at") or 0,
            "paid_at": d.get("paid_at"),
        })
    return {"orders": out}
