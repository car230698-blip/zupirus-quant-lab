"""Quantitative Research PDF Reports Catalog, Library, Checkout, Download & Admin Publisher Router."""
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.db import tx, audit
from app.routers.deps import fail, get_current_admin, get_current_user
from app.security import digest
from app.domains.reports.service import (
    attach_report_pdf_files,
    build_or_get_report_bundle_zip,
    create_admin_report_draft,
    create_report_checkout_order,
    discontinue_admin_report,
    get_public_report_detail,
    grant_report_entitlement_tx,
    issue_signed_report_download_token,
    list_admin_reports,
    list_public_reports,
    list_user_report_library,
    publish_admin_report,
    revoke_report_entitlement_for_refund_tx,
    update_admin_report,
    verify_signed_report_download_token,
    verify_user_report_download_access,
)
from app.domains.reports.pdf_builder import ensure_gold_research_suite_v1_seeded

router = APIRouter(tags=["reports"])


def _get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    tok = request.cookies.get("session") or request.cookies.get("token")
    if not tok:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            tok = auth[7:].strip()
    if not tok:
        return None
    try:
        with tx() as c:
            row = c.execute(
                "SELECT u.id, u.email, u.role, u.status FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = ? AND s.expires > ?",
                (digest(tok), time.time()),
            ).fetchone()
            if not row:
                return None
            u = dict(row)
            if str(u.get("status") or "").lower() == "suspended":
                return None
            return u
    except Exception:
        return None


class ReportCheckoutRequest(BaseModel):
    payment_method: str = "USDT"
    network: Optional[str] = "BEP20"


class AdminReportDraftRequest(BaseModel):
    title: str
    subtitle: Optional[str] = ""
    description: Optional[str] = ""
    slug: Optional[str] = None
    summary: Optional[str] = ""
    market: str = "XAUUSD"
    timeframe: str = "M15 / H1"
    version: str = "v1.0"
    price_vnd: int = 790000
    price_usd: float = 32.0
    page_count: int = 18
    methodology_json: Optional[Any] = None
    highlights_json: Optional[Any] = None
    preview_highlights: Optional[List[str]] = None
    wfo_metrics_json: Optional[Any] = None
    wfo_metrics: Optional[Dict[str, Any]] = None
    research_candidate_id: Optional[str] = None


class AdminReportUpdateRequest(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    slug: Optional[str] = None
    summary: Optional[str] = None
    market: Optional[str] = None
    timeframe: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    price_vnd: Optional[int] = None
    price_usd: Optional[float] = None
    page_count: Optional[int] = None
    highlights_json: Optional[Any] = None
    preview_highlights: Optional[List[str]] = None
    wfo_metrics_json: Optional[Any] = None
    wfo_metrics: Optional[Dict[str, Any]] = None
    research_candidate_id: Optional[str] = None
    changelog: Optional[str] = None


class AdminReportPublishRequest(BaseModel):
    version: Optional[str] = None
    changelog: Optional[str] = None


# ── PUBLIC & CUSTOMER REPORT CATALOG ENDPOINTS ──────────────────────────────


@router.get("/api/v1/reports")
@router.get("/api/reports")
def api_list_public_reports(market: Optional[str] = Query(default=None)):
    """Public catalog listing only PUBLISHED quantitative research reports."""
    items = list_public_reports()
    if market:
        m_u = market.strip().upper()
        items = [i for i in items if m_u in str(i.get("market") or "").upper()]
    return {"items": items, "count": len(items)}


@router.get("/api/v1/reports/my/library")
@router.get("/api/v1/reports/my-library")
@router.get("/api/v1/library/reports")
@router.get("/api/reports/my/library")
def api_get_my_report_library(current_user: dict = Depends(get_current_user)):
    """Authenticated customer's purchased PDF report library and pending report orders."""
    uid_str = str(current_user["id"])
    items = list_user_report_library(uid_str)
    with tx() as c:
        pending_rows = c.execute(
            """
            SELECT o.id, o.report_id, o.report_version, o.amount_vnd, o.amount_usd, o.currency,
                   o.payment_gateway, o.status, o.created_at, o.expires_at, r.title
            FROM orders o
            LEFT JOIN research_reports r ON r.id = o.report_id
            WHERE o.user_id = ? AND UPPER(COALESCE(o.product_type, '')) = 'PDF_REPORT'
              AND UPPER(COALESCE(o.status, '')) = 'PENDING'
            ORDER BY o.created_at DESC LIMIT 20
            """,
            (uid_str,),
        ).fetchall()
        pending_orders = []
        for r in pending_rows:
            d = dict(r)
            d["order_code"] = d["id"]
            d["amount"] = d.get("amount_vnd") if str(d.get("currency") or "VND").upper() == "VND" else d.get("amount_usd")
            pending_orders.append(d)
    return {
        "items": items,
        "count": len(items),
        "pending_orders": pending_orders,
    }


@router.get("/api/v1/reports/{report_id}")
@router.get("/api/reports/{report_id}")
def api_get_public_report_detail(report_id: str, request: Request):
    """Public report detail. Only PUBLISHED reports are visible publicly (or DISCONTINUED if owned by current buyer)."""
    opt_user = _get_optional_user(request)
    uid_str = str(opt_user["id"]) if opt_user else None
    item = get_public_report_detail(report_id, user_id=uid_str)
    if not item:
        fail(404, "Không tìm thấy báo cáo hoặc báo cáo chưa được xuất bản.")
    item["is_owned"] = bool(item.get("owned"))
    return item


@router.get("/api/v1/reports/{report_id}/sample-pdf")
@router.get("/api/reports/{report_id}/sample-pdf")
def api_download_sample_pdf(report_id: str, request: Request):
    """Stream free sample preview PDF for a PUBLISHED report."""
    opt_user = _get_optional_user(request)
    uid_str = str(opt_user["id"]) if opt_user else None
    item = get_public_report_detail(report_id, user_id=uid_str)
    if not item:
        fail(404, "Không tìm thấy bản đọc thử báo cáo.")
    with tx() as c:
        row = c.execute(
            "SELECT id, slug, version, sample_pdf_path FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        if not row or not row["sample_pdf_path"]:
            fail(404, "Báo cáo này chưa có tệp PDF đọc thử.")
        sample_path = Path(str(row["sample_pdf_path"]))
        if not sample_path.is_file():
            fail(404, "Tệp PDF đọc thử không tồn tại trên máy chủ.")
        slug = str(row["slug"] or row["id"])
        ver = str(row["version"] or "v1.0")
    return FileResponse(
        sample_path,
        media_type="application/pdf",
        filename=f"{slug}-{ver}-sample.pdf",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": f'inline; filename="{slug}-{ver}-sample.pdf"',
        },
    )


@router.post("/api/v1/reports/{report_id}/checkout")
@router.post("/api/reports/{report_id}/checkout")
def api_checkout_report(
    report_id: str,
    body: ReportCheckoutRequest,
    current_user: dict = Depends(get_current_user),
):
    """Decommissioned: Off-the-shelf report sales are discontinued."""
    fail(403, "Mô hình ấn phẩm bán sẵn đã ngừng hoạt động. Vui lòng tạo yêu cầu phân tích kỹ thuật hoặc nghiên cứu định lượng theo đơn.")


@router.post("/api/v1/reports/{report_id}/download-token")
@router.post("/api/reports/{report_id}/download-token")
def api_issue_report_download_token(
    report_id: str,
    version: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Issue a short-lived signed download token strictly bound to (user_id, report_id, purchased_version)."""
    uid_str = str(current_user["id"])
    role_str = str(current_user.get("role") or "customer")
    try:
        _, _, ver = verify_user_report_download_access(
            user_id=uid_str,
            user_role=role_str,
            report_id=report_id,
            version=version,
        )
    except PermissionError as exc:
        fail(403, str(exc))
    except FileNotFoundError as exc:
        fail(404, str(exc))

    with tx() as c:
        r_row = c.execute(
            "SELECT id FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        canonical_rep_id = str(r_row["id"]) if r_row else report_id

    tok = issue_signed_report_download_token(uid_str, canonical_rep_id, ver, ttl_sec=300)
    return {
        "token": tok,
        "report_id": canonical_rep_id,
        "version": ver,
        "download_url": f"/api/v1/reports/{canonical_rep_id}/download?version={ver}&token={tok}",
        "bundle_download_url": f"/api/v1/reports/{canonical_rep_id}/download-bundle?version={ver}&token={tok}",
        "expires_in": 300,
    }


@router.get("/api/v1/reports/{report_id}/download-bundle")
@router.get("/api/reports/{report_id}/download-bundle")
def api_download_report_bundle(
    report_id: str,
    version: Optional[str] = Query(default=None),
    token: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Protected endpoint to download the full research suite bundle ZIP (PDF, ledger CSV, metrics JSON, config, replay CLI).
    Strictly verifies ownership, trial expiration, and version entitlement."""
    uid_str = str(current_user["id"])
    role_str = str(current_user.get("role") or "customer")
    effective_version = version

    with tx() as c:
        rep_row = c.execute(
            "SELECT id, slug FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        if not rep_row:
            fail(404, "Không tìm thấy báo cáo.")
        canonical_rep_id = str(rep_row["id"])

    if token:
        verified = verify_signed_report_download_token(token, current_user_id=uid_str)
        if not verified:
            fail(403, "Liên kết tải không hợp lệ, đã hết hạn hoặc thuộc về tài khoản khác.")
        tok_rep_id, tok_ver = verified
        if tok_rep_id != canonical_rep_id:
            fail(403, "Token tải không khớp với mã báo cáo.")
        effective_version = tok_ver

    try:
        # Strictly verify entitlement and trial expiration!
        _, _, dl_ver = verify_user_report_download_access(
            user_id=uid_str,
            user_role=role_str,
            report_id=canonical_rep_id,
            version=effective_version,
        )
        bundle_path, dl_filename, _ = build_or_get_report_bundle_zip(canonical_rep_id, dl_ver)
    except PermissionError as exc:
        fail(403, str(exc))
    except FileNotFoundError as exc:
        fail(404, str(exc))

    return FileResponse(
        path=str(bundle_path),
        filename=dl_filename,
        media_type="application/zip",
    )


@router.get("/api/v1/reports/{report_id}/download")
@router.get("/api/reports/{report_id}/download")
def api_download_purchased_report_pdf(
    report_id: str,
    version: Optional[str] = Query(default=None),
    token: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Protected endpoint to download the full PDF report from private storage.
    Enforces ownership per (user_id, report_id, purchased_version) and rejects cross-user tokens."""
    uid_str = str(current_user["id"])
    role_str = str(current_user.get("role") or "customer")
    effective_version = version

    with tx() as c:
        rep_row = c.execute(
            "SELECT id, slug FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        if not rep_row:
            fail(404, "Không tìm thấy báo cáo.")
        canonical_rep_id = str(rep_row["id"])

    if token:
        verified = verify_signed_report_download_token(token, current_user_id=uid_str)
        if not verified:
            fail(403, "Liên kết tải PDF không hợp lệ, đã hết hạn hoặc thuộc về tài khoản khác.")
        tok_rep_id, tok_ver = verified
        if tok_rep_id != canonical_rep_id:
            fail(403, "Token tải PDF không khớp với mã báo cáo.")
        effective_version = tok_ver

    try:
        file_path, dl_filename, dl_ver = verify_user_report_download_access(
            user_id=uid_str,
            user_role=role_str,
            report_id=canonical_rep_id,
            version=effective_version,
        )
    except PermissionError as exc:
        fail(403, str(exc))
    except FileNotFoundError as exc:
        fail(404, str(exc))

    watermark_on = False
    watermark_policy_known = False
    with tx() as c:
        try:
            flag = c.execute(
                "SELECT watermark_enabled FROM research_reports WHERE id = ?",
                (canonical_rep_id,),
            ).fetchone()
            watermark_on = bool(flag and int(flag[0] or 0))
            watermark_policy_known = True
        except Exception:
            try:
                mflag = c.execute(
                    """
                    SELECT watermark_enabled FROM methodologies
                    WHERE report_id = ?
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (canonical_rep_id,),
                ).fetchone()
                if mflag is not None:
                    watermark_on = bool(int(mflag[0] or 0))
                    watermark_policy_known = True
            except Exception:
                watermark_policy_known = False
    if not watermark_policy_known and role_str.lower() != "admin":
        # Fail closed: never silently skip a watermark that could not be read.
        fail(503, "Không đọc được cấu hình watermark của ấn phẩm. Thử lại sau.")
    if watermark_on and role_str.lower() != "admin":
        from app.domains.quant.pdf_doc import build_license_page
        from app.domains.quant.service import merge_pdfs
        buyer = str(current_user.get("email") or uid_str)
        license_pdf = build_license_page([
            f"Buyer / Người mua: {buyer}",
            f"Report / Ấn phẩm: {canonical_rep_id}",
            f"Version / Phiên bản: {dl_ver}",
            "Educational copy. Past statistics are not a promise of profit.",
            "Bản học tập. Thống kê quá khứ không phải cam kết lợi nhuận.",
        ])
        stamped = merge_pdfs([file_path.read_bytes(), license_pdf])
        return Response(
            content=stamped,
            media_type="application/pdf",
            headers={
                "Cache-Control": "private, no-store, no-cache, must-revalidate",
                "X-Report-Id": canonical_rep_id,
                "X-Report-Version": dl_ver,
                "X-Buyer-Watermark": "applied",
                "Content-Disposition": f'attachment; filename="{dl_filename}"',
            },
        )

    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=dl_filename,
        headers={
            "Cache-Control": "private, no-store, no-cache, must-revalidate",
            "X-Report-Id": canonical_rep_id,
            "X-Report-Version": dl_ver,
            "Content-Disposition": f'attachment; filename="{dl_filename}"',
        },
    )


# ── ADMIN REPORT WORKFLOW & LIFECYCLE ENDPOINTS ─────────────────────────────


@router.get("/api/v1/admin/reports")
@router.get("/api/admin/reports")
def api_admin_list_reports(admin: dict = Depends(get_current_admin)):
    """Admin view of all research reports (DRAFT, PUBLISHED, DISCONTINUED) and available WFO candidates."""
    items = list_admin_reports()
    with tx() as c:
        cand_rows = c.execute(
            """
            SELECT id, name, status, sample_size, win_rate, profit_factor,
                   sharpe_ratio, max_drawdown_pct, oos_net_units, rules_json, updated_at
            FROM strategy_candidates
            ORDER BY updated_at DESC LIMIT 30
            """
        ).fetchall()
        candidates = []
        for r in cand_rows:
            d = dict(r)
            try:
                d["rules"] = json.loads(d.get("rules_json") or "{}")
            except Exception:
                d["rules"] = {}
            candidates.append(d)
    return {
        "items": items,
        "count": len(items),
        "research_candidates": candidates,
    }


@router.post("/api/v1/admin/reports")
@router.post("/api/admin/reports")
def api_admin_create_report(
    body: AdminReportDraftRequest,
    admin: dict = Depends(get_current_admin),
):
    """Decommissioned: Creating off-the-shelf report drafts is stopped."""
    fail(403, "Chức năng tạo bản nháp ấn phẩm bán sẵn mới đã ngừng hoạt động. Vui lòng sử dụng mô hình nghiên cứu theo đơn.")


@router.put("/api/v1/admin/reports/{report_id}")
@router.patch("/api/v1/admin/reports/{report_id}")
@router.put("/api/admin/reports/{report_id}")
@router.patch("/api/admin/reports/{report_id}")
def api_admin_update_report(
    report_id: str,
    body: AdminReportUpdateRequest,
    admin: dict = Depends(get_current_admin),
):
    """Decommissioned: Updating off-the-shelf report drafts is stopped."""
    fail(403, "Chức năng chỉnh sửa ấn phẩm bán sẵn đã ngừng hoạt động.")


@router.post("/api/v1/admin/reports/{report_id}/upload-pdf")
@router.post("/api/admin/reports/{report_id}/upload-pdf")
async def api_admin_upload_report_pdf(
    report_id: str,
    version: Optional[str] = Form(default=None),
    changelog: Optional[str] = Form(default=None),
    full_pdf: Optional[UploadFile] = File(default=None),
    sample_pdf: Optional[UploadFile] = File(default=None),
    admin: dict = Depends(get_current_admin),
):
    """Decommissioned: Uploading PDF for off-the-shelf reports is stopped."""
    fail(403, "Chức năng tải lên PDF cho ấn phẩm bán sẵn đã ngừng hoạt động.")


@router.get("/api/v1/admin/reports/{report_id}/preview-pdf")
@router.get("/api/admin/reports/{report_id}/preview-pdf")
def api_admin_preview_report_pdf(
    report_id: str,
    kind: str = Query(default="full"),
    version: Optional[str] = Query(default=None),
    admin: dict = Depends(get_current_admin),
):
    """Admin preview of full or sample PDF for any report (including DRAFT)."""
    with tx() as c:
        row = c.execute(
            "SELECT id, slug, version, full_pdf_path, sample_pdf_path FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        if not row:
            fail(404, "Không tìm thấy báo cáo.")
        rep = dict(row)
        ver = (version or rep.get("version") or "v1.0").strip()
        v_row = c.execute(
            "SELECT full_pdf_path, sample_pdf_path FROM report_versions WHERE report_id = ? AND version = ?",
            (rep["id"], ver),
        ).fetchone()
        if version and not v_row and ver != rep.get("version"):
            fail(404, f"Phiên bản '{version}' không tồn tại cho ấn phẩm này.")

        if v_row:
            rel = str((v_row["sample_pdf_path"] if kind.lower() == "sample" else v_row["full_pdf_path"]) or "").strip()
        elif not version or ver == rep.get("version"):
            rel = str((rep.get("sample_pdf_path") if kind.lower() == "sample" else rep.get("full_pdf_path")) or "").strip()
        else:
            rel = ""

        if not rel:
            fail(404, f"Chưa có tệp PDF cho phiên bản '{ver}'.")
        p = Path(rel)
        if not p.is_file():
            fail(404, f"Tệp PDF của phiên bản '{ver}' không tồn tại trên ổ đĩa.")
    return FileResponse(
        p,
        media_type="application/pdf",
        filename=f"{rep['slug']}-{ver}-{kind}.pdf",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/api/v1/admin/reports/{report_id}/preview-bundle")
@router.get("/api/admin/reports/{report_id}/preview-bundle")
def api_admin_preview_report_bundle(
    report_id: str,
    version: Optional[str] = Query(default=None),
    admin: dict = Depends(get_current_admin),
):
    """Admin preview and download of the complete research suite bundle ZIP strictly by version."""
    with tx() as c:
        row = c.execute(
            "SELECT id, slug, version FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        if not row:
            fail(404, "Không tìm thấy báo cáo.")
        rep_id = str(row["id"])
        rep_ver = str(row["version"] or "v1.0")
        eff_ver = (version or rep_ver).strip()
        if version:
            v_row = c.execute(
                "SELECT id FROM report_versions WHERE report_id = ? AND version = ?",
                (rep_id, eff_ver),
            ).fetchone()
            if not v_row and eff_ver != rep_ver:
                fail(404, f"Phiên bản '{version}' không tồn tại.")
    try:
        bundle_path, dl_filename, _ = build_or_get_report_bundle_zip(rep_id, eff_ver)
    except FileNotFoundError as exc:
        fail(404, str(exc))
    except Exception as exc:
        fail(400, f"Lỗi tạo gói bằng chứng: {exc}")

    return FileResponse(
        path=str(bundle_path),
        filename=dl_filename,
        media_type="application/zip",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/api/v1/admin/reports/{report_id}/toggle-sale")
@router.post("/api/admin/reports/{report_id}/toggle-sale")
def api_admin_toggle_report_sale(
    report_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Decommissioned: Toggling sales for off-the-shelf reports is stopped."""
    fail(403, "Chức năng mở bán ấn phẩm thương mại đã ngừng hoạt động.")


@router.post("/api/v1/admin/reports/{report_id}/publish")
@router.post("/api/admin/reports/{report_id}/publish")
def api_admin_publish_report(
    report_id: str,
    body: Optional[AdminReportPublishRequest] = None,
    admin: dict = Depends(get_current_admin),
):
    """Decommissioned: Publishing off-the-shelf reports is stopped."""
    fail(403, "Chức năng xuất bản ấn phẩm bán sẵn đã ngừng hoạt động.")


@router.post("/api/v1/admin/reports/{report_id}/discontinue")
@router.post("/api/admin/reports/{report_id}/discontinue")
def api_admin_discontinue_report(
    report_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Stop new sales of a report while preserving download entitlements for existing buyers."""
    try:
        return discontinue_admin_report(report_id=report_id, admin_id=str(admin["id"]))
    except ValueError as exc:
        fail(404 if "Không tìm thấy" in str(exc) else 400, str(exc))


@router.post("/api/v1/admin/orders/{order_id}/refund")
@router.post("/api/admin/orders/{order_id}/refund")
def api_admin_refund_report_order(
    order_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Mark a report order as REFUNDED and immediately revoke its PDF download entitlement."""
    with tx() as c:
        o_row = c.execute(
            "SELECT id, user_id, status, product_type, report_id, report_version FROM orders WHERE id = ?",
            (order_id,),
        ).fetchone()
        if not o_row:
            fail(404, "Không tìm thấy đơn hàng.")
        ord_dict = dict(o_row)
        revoked = revoke_report_entitlement_for_refund_tx(
            c,
            order_id=str(ord_dict["id"]),
            admin_id=str(admin["id"]),
        )
    return {
        "ok": True,
        "order_id": ord_dict["id"],
        "status": "REFUNDED",
        "entitlement_revoked": revoked,
    }


class AdminGrantTrialRequest(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None
    version: Optional[str] = "v1.0"
    trial_days: int = 30
    notes: Optional[str] = "Institutional Evaluation Trial License"


@router.post("/api/v1/admin/reports/{report_id}/entitlements/grant-trial")
@router.post("/api/admin/reports/{report_id}/entitlements/grant-trial")
def api_admin_grant_trial_entitlement(
    report_id: str,
    body: AdminGrantTrialRequest,
    admin: dict = Depends(get_current_admin),
):
    """Decommissioned: Granting new trials for off-the-shelf reports is stopped."""
    fail(403, "Đã ngừng cấp trial cho ấn phẩm bán sẵn. Vui lòng sử dụng mô hình nghiên cứu theo đơn.")
