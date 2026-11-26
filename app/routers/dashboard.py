"""Dashboard Router — Quantitative Research Portal & Report Entitlements Telemetry."""
import csv
import io
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from app.core.redis_client import check_rate_limit
from app.db import tx
from app.routers.deps import get_current_user

logger = logging.getLogger("zupirus.dashboard")
router = APIRouter(tags=["dashboard"])


@router.get('/api/dashboard')
def dashboard(
    u=Depends(get_current_user),
    account_id: Optional[str] = None,
    state: Optional[str] = None,
    days: int = 30,
):
    """Retrieve quantitative research dashboard data for authenticated user:
    PDF report entitlements, purchases, and system health telemetry.
    Customer auto-trading accounts and broker connections are eliminated in ZUPIRUS Quant Lab.
    """
    with tx() as c:
        # Load user's research report entitlements
        entitlements = c.execute(
            """
            SELECT e.id, e.report_id, e.purchased_version, e.status, e.granted_at, 0 as download_count,
                   r.title, r.market, r.timeframe, r.slug
            FROM report_entitlements e
            LEFT JOIN research_reports r ON r.id = e.report_id
            WHERE e.user_id = ?
            ORDER BY e.granted_at DESC
            """,
            (u['id'],),
        ).fetchall()
        reports_list = [dict(e) for e in entitlements]

        # Load user's report purchase orders
        order_rows = c.execute(
            """
            SELECT id, id as order_code, product_type, report_id, report_version, amount_usd as amount, currency, status, created_at, paid_at
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 50
            """,
            (u['id'],),
        ).fetchall()
        orders = [dict(o) for o in order_rows]

        health = dict(
            c.execute(
                "SELECT key,value FROM kv WHERE key IN ('execution_heartbeat','research_heartbeat','replay_price','strategy_last_decision','halted')"
            ).fetchall()
        )

        return {
            'accounts': [],
            'reports': reports_list,
            'orders': orders,
            'series': [],
            'health': health,
            'real_trading': False,
        }


def _csv_safe(val: Any) -> Any:
    """Neutralize potential CSV formula injection (CWE-1236) by prepending a single quote."""
    if val is None:
        return ""
    s = str(val)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s


@router.get('/api/v1/orders/export')
def export_orders_csv(
    u=Depends(get_current_user),
    days: int = 30,
):
    """Export PDF report purchase statement as CSV with UTF-8 BOM (utf-8-sig)."""
    if not check_rate_limit(f"orders_export:{u['id']}", limit=10, window_sec=60):
        raise HTTPException(
            status_code=429,
            detail="Quá nhiều yêu cầu xuất CSV. Giới hạn tối đa 10 lần/phút.",
        )

    now_ts = time.time()
    cutoff_ts = now_ts - max(1, min(days, 365)) * 86400

    with tx() as c:
        rows = c.execute(
            """
            SELECT o.id, o.id as order_code, o.product_type, o.report_id, o.report_version,
                   COALESCE(o.amount_usd, 0.0) as amount, o.currency, o.status, o.created_at, o.paid_at, r.title
            FROM orders o
            LEFT JOIN research_reports r ON r.id = o.report_id
            WHERE o.user_id = ? AND o.created_at >= ?
            ORDER BY o.created_at DESC
            """,
            (u["id"], cutoff_ts),
        ).fetchall()

    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 with BOM
    writer = csv.writer(buf)
    writer.writerow([
        "Mã Đơn Hàng",
        "Mã Tra Cứu",
        "Loại Sản Phẩm",
        "Mã Báo Cáo",
        "Tiêu Đề",
        "Phiên Bản",
        "Số Tiền",
        "Tiền Tệ",
        "Trạng Thái",
        "Thời Gian Tạo",
        "Thời Gian Thanh Toán",
    ])

    for r in rows:
        d = dict(r)
        created_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(d.get("created_at") or now_ts))
        paid_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(d.get("paid_at"))) if d.get("paid_at") else ""
        writer.writerow([
            _csv_safe(d.get("id")),
            _csv_safe(d.get("order_code")),
            _csv_safe(d.get("product_type") or "PDF_REPORT"),
            _csv_safe(d.get("report_id")),
            _csv_safe(d.get("title") or ""),
            _csv_safe(d.get("report_version") or "v1.0"),
            _csv_safe(d.get("amount")),
            _csv_safe(d.get("currency") or "VND"),
            _csv_safe(d.get("status")),
            created_str,
            paid_str,
        ])

    csv_data = buf.getvalue().encode("utf-8-sig")
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=zupirus_orders_{int(now_ts)}.csv",
            "X-Content-Type-Options": "nosniff",
        },
    )
