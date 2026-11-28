"""Quantitative Research Report Catalog, Per-Report Checkout, Versioning, and Entitlement Service."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from app.config import ORDER_LOCK_MINUTES
from app.core.config import is_commercial_reports_sale_enabled
from app.db import audit, tx
from app.domains.reports.pdf_builder import (
    build_pdf_bytes,
    ensure_flagship_sample_report_seeded,
    ensure_gold_research_suite_v1_seeded,
    get_private_reports_dir,
    get_public_samples_dir,
)
from app.services.fx_rate import convert_usd_to_vnd, get_usd_vnd_rate

logger = logging.getLogger("zupirus.domains.reports.service")

VALID_REPORT_STATUSES = ("DRAFT", "READY_FOR_REVIEW", "APPROVED", "PUBLISHED", "DISCONTINUED")


def _slugify(text: str) -> str:
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", text or "bao-cao-xauusd")
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    ascii_str = ascii_str.replace("đ", "d").replace("Đ", "D").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_str).strip("-")
    return slug or f"report-{secrets.token_hex(4)}"


def _compute_sha256(filepath: str | Path | None) -> str:
    """Compute deterministic SHA-256 hash of a file on disk."""
    if not filepath:
        return ""
    p = Path(filepath)
    if not p.is_file():
        return ""
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def _column_names(c, table: str) -> list[str]:
    """Retrieve column names for a given table across Postgres and SQLite."""
    from app.core.db import is_postgres
    if is_postgres():
        rows = c.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
            (table.lower(),),
        ).fetchall()
        return [r[0] for r in rows]
    rows = c.execute(f"PRAGMA table_info({table})").fetchall()
    return [r[1] for r in rows]


def check_report_purchase_eligibility(status: Optional[str], is_for_sale: bool = True) -> Tuple[bool, Optional[str]]:
    """Determine if a report is currently eligible for online purchase.
    Strictly synchronizes:
    - Report status must be PUBLISHED
    - Report is_for_sale flag must be True
    - Commercial sales flag must be ON
    - Direct USDT flag must be ON
    - Valid receiving wallet (TRC20 or BEP20) must be configured
    """
    if str(status or "").upper() != "PUBLISHED":
        return False, "Báo cáo chưa được xuất bản công khai."
    if not is_for_sale:
        return False, "Ấn phẩm hiện chưa được bật cờ mở bán thương mại."
    if not is_commercial_reports_sale_enabled():
        return False, "Cổng mở bán thương mại đang tạm tắt để kiểm định."

    from app.core.config import is_usdt_payment_enabled
    if not is_usdt_payment_enabled():
        return False, "Phương thức thanh toán USDT hiện chưa được kích hoạt."

    from app.domains.billing.crypto_direct import get_crypto_wallets_config, validate_trc20_address, validate_bep20_address
    cfg = get_crypto_wallets_config()
    trc20_valid = bool(cfg.get("has_trc20") and validate_trc20_address(cfg.get("trc20_address", "")))
    bep20_valid = bool(cfg.get("has_bep20") and validate_bep20_address(cfg.get("bep20_address", "")))
    if not (trc20_valid or bep20_valid):
        return False, "Chưa cấu hình địa chỉ ví USDT hợp lệ (TRC20 hoặc BEP20) để nhận thanh toán."

    return True, None


def _format_report_row(row: Any, include_private_paths: bool = False) -> Dict[str, Any]:
    d = dict(row)
    rep_id = d.get("id")
    slug = d.get("slug") or rep_id
    highlights = []
    if d.get("preview_highlights_json"):
        try:
            highlights = json.loads(d["preview_highlights_json"])
        except Exception:
            highlights = []
    wfo_metrics = {}
    if d.get("wfo_metrics_json"):
        try:
            wfo_metrics = json.loads(d["wfo_metrics_json"])
        except Exception:
            wfo_metrics = {}

    has_sample = bool(d.get("sample_pdf_path") and Path(str(d["sample_pdf_path"])).is_file())
    has_full = bool(d.get("full_pdf_path") and Path(str(d["full_pdf_path"])).is_file())
    is_for_sale = bool(d.get("is_for_sale", 0))
    st_upper = str(d.get("status") or "DRAFT").upper()
    if st_upper == "PUBLISHED":
        review_status = "PUBLISHED"
    elif st_upper == "DISCONTINUED":
        review_status = "DISCONTINUED"
    elif has_full:
        review_status = "READY_FOR_REVIEW"
    else:
        review_status = "DRAFT_NO_FILE"

    ver_str = d.get("version") or "v1.0"
    can_purchase, _ = check_report_purchase_eligibility(d.get("status"), is_for_sale)
    out = {
        "id": rep_id,
        "slug": slug,
        "title": d.get("title") or "",
        "subtitle": d.get("description") or d.get("summary") or "",
        "summary": d.get("summary") or "",
        "description": d.get("description") or "",
        "market": d.get("market") or "XAU/USD",
        "timeframe": d.get("timeframe") or "M15 / H1",
        "version": ver_str,
        "current_version": ver_str,
        "status": st_upper,
        "review_status": review_status,
        "is_for_sale": is_for_sale,
        "price_usd": round(float(d.get("price_usd") or 29.0), 2),
        "price_vnd": int(d.get("price_vnd") or 750000),
        "currency": d.get("currency") or "VND",
        "preview_highlights": highlights,
        "highlights": highlights,
        "research_candidate_id": d.get("research_candidate_id"),
        "wfo_metrics": wfo_metrics,
        "has_sample_pdf": has_sample,
        "has_full_pdf": has_full,
        "sample_pdf_url": f"/api/v1/reports/{rep_id}/sample-pdf" if has_sample else None,
        "can_purchase": can_purchase,
        "commercial_sale_enabled": is_commercial_reports_sale_enabled(),
        "published_at": float(d["published_at"]) if d.get("published_at") else None,
        "created_at": float(d.get("created_at") or time.time()),
        "updated_at": float(d.get("updated_at") or time.time()),
    }
    if include_private_paths:
        out["sample_pdf_path"] = d.get("sample_pdf_path")
        out["full_pdf_path"] = d.get("full_pdf_path")
    return out


def list_public_reports() -> List[Dict[str, Any]]:
    """Return strictly PUBLISHED research reports for public catalog browsing. Strictly read-only."""
    with tx() as c:
        rows = c.execute(
            """
            SELECT * FROM research_reports
            WHERE UPPER(status) = 'PUBLISHED'
            ORDER BY COALESCE(published_at, created_at) DESC, id DESC
            """
        ).fetchall()
        return [_format_report_row(r, include_private_paths=False) for r in rows]


def get_public_report_detail(report_id_or_slug: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Return detail for a single PUBLISHED report (or DISCONTINUED if user already owns an entitlement). Strictly read-only."""
    key = (report_id_or_slug or "").strip()
    if not key:
        return None
    with tx() as c:
        row = c.execute(
            "SELECT * FROM research_reports WHERE id = ? OR slug = ? LIMIT 1",
            (key, key),
        ).fetchone()
        if not row:
            return None
        rep = _format_report_row(row, include_private_paths=False)
        st = rep["status"]
        owned_versions: List[str] = []
        if user_id:
            ent_rows = c.execute(
                """
                SELECT purchased_version FROM report_entitlements
                WHERE user_id = ? AND report_id = ? AND status = 'ACTIVE'
                ORDER BY granted_at DESC
                """,
                (user_id, rep["id"]),
            ).fetchall()
            owned_versions = [str(r[0]) for r in ent_rows]

        if st != "PUBLISHED" and not owned_versions:
            return None

        rep["owned"] = len(owned_versions) > 0
        rep["owned_versions"] = owned_versions
        rep["can_purchase"] = rep.get("can_purchase", False)
        return rep


def list_admin_reports() -> List[Dict[str, Any]]:
    """Admin: List all reports across DRAFT, READY_FOR_REVIEW, APPROVED, PUBLISHED, DISCONTINUED. Strictly read-only."""
    with tx() as c:
        rows = c.execute(
            "SELECT * FROM research_reports ORDER BY updated_at DESC, created_at DESC"
        ).fetchall()
        result = []
        for r in rows:
            item = _format_report_row(r, include_private_paths=True)
            v_rows = c.execute(
                "SELECT version, published_at, changelog FROM report_versions WHERE report_id = ? ORDER BY published_at DESC",
                (item["id"],),
            ).fetchall()
            item["versions"] = [dict(vr) for vr in v_rows]
            sales_cnt = c.execute(
                "SELECT COUNT(*) FROM report_entitlements WHERE report_id = ? AND status = 'ACTIVE'",
                (item["id"],),
            ).fetchone()[0]
            item["active_entitlements_count"] = int(sales_cnt or 0)
            result.append(item)
        return result


def create_admin_report_draft(
    title: str,
    summary: str,
    description: str = "",
    market: str = "XAU/USD",
    timeframe: str = "M15 / H1",
    version: str = "v1.0",
    price_usd: float = 29.0,
    price_vnd: Optional[int] = None,
    currency: str = "VND",
    preview_highlights: Optional[List[str]] = None,
    research_candidate_id: Optional[str] = None,
    wfo_metrics: Optional[Dict[str, Any]] = None,
    admin_id: str = "admin",
) -> Dict[str, Any]:
    """Admin: Create a new research report draft (never auto-published by AI)."""
    now = time.time()
    rep_id = f"rep_{secrets.token_hex(6)}"
    base_slug = _slugify(title)
    rate, _, _ = get_usd_vnd_rate()
    # Preserve the caller's positive price. Methodology drafts may be below $1.
    raw_usd = float(price_usd) if price_usd is not None else 29.0
    eff_usd = round(raw_usd, 2)
    if eff_usd < 0.01:
        raise ValueError("price_usd must be at least 0.01 after rounding")
    eff_vnd = int(price_vnd) if (price_vnd is not None and int(price_vnd) > 0) else convert_usd_to_vnd(eff_usd, rate)

    with tx() as c:
        slug = base_slug
        dup = c.execute("SELECT 1 FROM research_reports WHERE slug = ?", (slug,)).fetchone()
        if dup:
            slug = f"{base_slug}-{rep_id[-4:]}"

        resolved_wfo = dict(wfo_metrics or {})
        if research_candidate_id and not resolved_wfo:
            cand_row = c.execute(
                "SELECT id, name, status, rules_json, sample_size, win_rate, profit_factor, sharpe_ratio, max_drawdown_pct, oos_net_units FROM strategy_candidates WHERE id = ?",
                (research_candidate_id,),
            ).fetchone()
            if cand_row:
                cd = dict(cand_row)
                try:
                    rj = json.loads(cd.get("rules_json") or "{}")
                except Exception:
                    rj = {}
                resolved_wfo = {
                    "candidate_id": cd["id"],
                    "candidate_name": cd["name"],
                    "evidence_type": "WALK_FORWARD_BACKTEST",
                    "sample_size": cd.get("sample_size") or 0,
                    "win_rate": cd.get("win_rate"),
                    "profit_factor": cd.get("profit_factor"),
                    "sharpe_ratio": cd.get("sharpe_ratio"),
                    "max_drawdown_pct": cd.get("max_drawdown_pct"),
                    "oos_net_units": cd.get("oos_net_units"),
                    "preferred_session": rj.get("preferred_session", "London"),
                    "cost_model_pips": 3.5,
                    "cost_model_is_assumed": True,
                    "cost_model_note": "Giả định chi phí khứ hồi 3.5 pips ($0.35/oz) gồm spread và trượt giá.",
                }

        # Auto-generate default sample and full PDF files if none uploaded yet so admin can preview immediately
        pub_dir = get_public_samples_dir()
        priv_dir = get_private_reports_dir()
        sample_path = pub_dir / f"{rep_id}-{version}-sample.pdf"
        full_path = priv_dir / f"{rep_id}-{version}-full.pdf"

        hl_list = preview_highlights or [
            f"Giả thuyết & Kiểm định Walk-Forward trên {market} ({timeframe}).",
            "Mô hình chi phí giao dịch giả định được ghi nhận minh bạch.",
        ]
        sample_bytes = build_pdf_bytes(
            title=f"ZUPIRUS QUANT LAB - SAMPLE PREVIEW ({version})",
            subtitle=f"{title} | Market: {market} ({timeframe})",
            pages_lines=[
                [
                    "# 1. Executive Summary (Sample Preview)",
                    summary,
                    " ",
                    "# 2. Highlights",
                    *[f"- {h}" for h in hl_list],
                ]
            ],
        )
        sample_path.write_bytes(sample_bytes)

        full_bytes = build_pdf_bytes(
            title=f"ZUPIRUS QUANT LAB - FULL RESEARCH REPORT ({version}) [Bố cục mẫu tự động]",
            subtitle=f"{title} | Market: {market} ({timeframe})",
            pages_lines=[
                [
                    "# 1. Research Summary & Hypothesis (Bố cục mẫu tự động / Placeholder Layout)",
                    summary,
                    " ",
                    "# 2. Detailed Quantitative Analysis",
                    description or summary,
                    " ",
                    "# 3. Walk-Forward & Cost Model Metrics",
                    json.dumps(resolved_wfo, ensure_ascii=False),
                ]
            ],
        )
        full_path.write_bytes(full_bytes)

        c.execute(
            """
            INSERT INTO research_reports (
                id, slug, title, summary, description, market, timeframe, version, status,
                price_usd, price_vnd, currency, sample_pdf_path, full_pdf_path,
                preview_highlights_json, research_candidate_id, wfo_metrics_json,
                published_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """,
            (
                rep_id,
                slug,
                title.strip(),
                summary.strip(),
                (description or summary).strip(),
                (market or "XAU/USD").strip(),
                (timeframe or "M15 / H1").strip(),
                (version or "v1.0").strip(),
                eff_usd,
                eff_vnd,
                (currency or "VND").strip().upper(),
                str(sample_path),
                str(full_path),
                json.dumps(hl_list, ensure_ascii=False),
                research_candidate_id,
                json.dumps(resolved_wfo, ensure_ascii=False),
                now,
                now,
            ),
        )
        audit(c, admin_id, "research_report_draft_created", {"report_id": rep_id, "title": title, "version": version})
        row = c.execute("SELECT * FROM research_reports WHERE id = ?", (rep_id,)).fetchone()
        return _format_report_row(row, include_private_paths=True)


def update_admin_report(
    report_id: str,
    updates: Dict[str, Any],
    admin_id: str = "admin",
) -> Dict[str, Any]:
    """Admin: Edit report metadata, price, version, attached research candidate, or review status.
    When version changes on an already-published report, old version files and entitlements remain intact."""
    now = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM research_reports WHERE id = ? OR slug = ?", (report_id, report_id)).fetchone()
        if not row:
            raise ValueError(f"Không tìm thấy báo cáo '{report_id}'.")
        cur = dict(row)
        real_id = cur["id"]

        title = str(updates.get("title") if updates.get("title") is not None else cur["title"]).strip()
        summary = str(updates.get("summary") if updates.get("summary") is not None else cur["summary"]).strip()
        description = str(updates.get("description") if updates.get("description") is not None else cur["description"]).strip()
        market = str(updates.get("market") if updates.get("market") is not None else cur["market"]).strip()
        timeframe = str(updates.get("timeframe") if updates.get("timeframe") is not None else cur["timeframe"]).strip()
        new_version = str(updates.get("version") if updates.get("version") is not None else cur["version"]).strip()
        price_usd = round(float(updates.get("price_usd") if updates.get("price_usd") is not None else cur["price_usd"]), 2)
        if updates.get("price_vnd") is not None:
            price_vnd = int(updates["price_vnd"])
        elif updates.get("price_usd") is not None:
            rate, _, _ = get_usd_vnd_rate()
            price_vnd = convert_usd_to_vnd(price_usd, rate)
        else:
            price_vnd = int(cur["price_vnd"])
        currency = str(updates.get("currency") if updates.get("currency") is not None else cur["currency"]).strip().upper()

        hl_json = cur.get("preview_highlights_json")
        if updates.get("preview_highlights") is not None:
            hl_json = json.dumps(updates["preview_highlights"], ensure_ascii=False)

        cand_id = updates.get("research_candidate_id") if "research_candidate_id" in updates else cur.get("research_candidate_id")
        wfo_json = cur.get("wfo_metrics_json")
        if updates.get("wfo_metrics") is not None:
            wfo_json = json.dumps(updates["wfo_metrics"], ensure_ascii=False)
        elif cand_id and cand_id != cur.get("research_candidate_id"):
            cand_row = c.execute(
                "SELECT id, name, status, rules_json, sample_size, win_rate, profit_factor, sharpe_ratio, max_drawdown_pct, oos_net_units FROM strategy_candidates WHERE id = ?",
                (cand_id,),
            ).fetchone()
            if cand_row:
                cd = dict(cand_row)
                wfo_json = json.dumps({
                    "candidate_id": cd["id"],
                    "candidate_name": cd["name"],
                    "evidence_type": "WALK_FORWARD_BACKTEST",
                    "sample_size": cd.get("sample_size") or 0,
                    "win_rate": cd.get("win_rate"),
                    "profit_factor": cd.get("profit_factor"),
                    "sharpe_ratio": cd.get("sharpe_ratio"),
                    "max_drawdown_pct": cd.get("max_drawdown_pct"),
                    "oos_net_units": cd.get("oos_net_units"),
                    "cost_model_pips": 3.5,
                    "cost_model_is_assumed": True,
                }, ensure_ascii=False)

        new_status = str(updates.get("status") or cur["status"]).strip().upper()
        if new_status not in VALID_REPORT_STATUSES:
            new_status = cur["status"]

        # Human Admin Gatekeeper: Prevent modifying status to PUBLISHED via metadata update API or automated agents
        is_agent_caller = any(str(admin_id).lower().startswith(p) for p in ("agent", "autonomous_", "worker", "system", "force"))
        if is_agent_caller and new_status == "PUBLISHED":
            raise PermissionError("Tiến trình tự động/Agent không được phép xuất bản trực tiếp. Yêu cầu admin phê duyệt.")
        if new_status == "PUBLISHED" and cur.get("status") != "PUBLISHED":
            raise ValueError("API sửa metadata không được phép đổi trạng thái sang PUBLISHED thay cho luồng xuất bản chính thức. Vui lòng sử dụng chức năng Xuất bản & Phê duyệt (Publish).")

        sample_path = cur.get("sample_pdf_path")
        full_path = cur.get("full_pdf_path")
        # If version bumped without new uploaded file yet, create a dedicated versioned PDF file so previous version file is never overwritten
        if new_version != cur.get("version"):
            priv_dir = get_private_reports_dir()
            new_full_file = priv_dir / f"{real_id}-{new_version}-full.pdf"
            if not new_full_file.exists():
                if full_path and Path(full_path).is_file():
                    new_full_file.write_bytes(Path(full_path).read_bytes())
                else:
                    new_full_file.write_bytes(
                        build_pdf_bytes(
                            title=f"ZUPIRUS QUANT LAB - FULL RESEARCH REPORT ({new_version})",
                            subtitle=f"{title} | Market: {market} ({timeframe})",
                            pages_lines=[["# 1. Research Summary", summary, " ", "# 2. Analysis", description]],
                        )
                    )
            full_path = str(new_full_file)

        pub_at = cur.get("published_at")
        if new_status == "PUBLISHED" and not pub_at:
            if not full_path or not Path(str(full_path)).is_file():
                raise ValueError("Không thể chuyển trạng thái sang PUBLISHED khi chưa có file PDF đầy đủ hợp lệ.")
            pub_at = now

        c.execute(
            """
            UPDATE research_reports
            SET title = ?, summary = ?, description = ?, market = ?, timeframe = ?, version = ?,
                status = ?, price_usd = ?, price_vnd = ?, currency = ?,
                sample_pdf_path = ?, full_pdf_path = ?,
                preview_highlights_json = ?, research_candidate_id = ?, wfo_metrics_json = ?,
                published_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                title, summary, description, market, timeframe, new_version,
                new_status, price_usd, price_vnd, currency,
                sample_path, full_path,
                hl_json, cand_id, wfo_json,
                pub_at, now, real_id,
            ),
        )

        if new_status == "PUBLISHED" and full_path:
            existing_ver = c.execute("SELECT id FROM report_versions WHERE report_id = ? AND version = ?", (real_id, new_version)).fetchone()
            if existing_ver:
                c.execute(
                    """
                    UPDATE report_versions SET
                        full_pdf_path = ?,
                        sample_pdf_path = ?,
                        wfo_metrics_json = ?
                    WHERE report_id = ? AND version = ?
                    """,
                    (full_path, sample_path, wfo_json, real_id, new_version),
                )

        audit(c, admin_id, "research_report_updated", {"report_id": real_id, "version": new_version, "status": new_status})
        updated = c.execute("SELECT * FROM research_reports WHERE id = ?", (real_id,)).fetchone()
        return _format_report_row(updated, include_private_paths=True)


def attach_report_pdf_files(
    report_id: str,
    full_pdf_bytes: Optional[bytes] = None,
    sample_pdf_bytes: Optional[bytes] = None,
    version_override: Optional[str] = None,
    admin_id: str = "admin",
) -> Dict[str, Any]:
    """Save uploaded full PDF (to private storage) and/or sample PDF (to public samples storage).
    Validates `%PDF-` magic header and never overwrites an older version's file when version changes."""
    for label, b_data in (("full_pdf", full_pdf_bytes), ("sample_pdf", sample_pdf_bytes)):
        if b_data is not None:
            if len(b_data) < 16 or not b_data.lstrip().startswith(b"%PDF-"):
                raise ValueError(f"File '{label}' không phải định dạng PDF hợp lệ (thiếu header %PDF-).")

    now = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM research_reports WHERE id = ? OR slug = ?", (report_id, report_id)).fetchone()
        if not row:
            raise ValueError(f"Không tìm thấy báo cáo '{report_id}'.")
        cur = dict(row)
        real_id = cur["id"]
        eff_ver = (version_override or cur.get("version") or "v1.0").strip()
        safe_ver = _slugify(eff_ver)

        # IMMUTABILITY LOCK: If this specific version is already published, reject file overwrite
        ver_row = c.execute(
            "SELECT published_at FROM report_versions WHERE report_id = ? AND version = ?",
            (real_id, eff_ver),
        ).fetchone()
        if ver_row and ver_row[0]:
            raise ValueError(
                f"Phiên bản '{eff_ver}' của báo cáo '{real_id}' đã được phát hành công khai và bị khóa bất biến (immutable). "
                "Để cập nhật nội dung mới, quản trị viên bắt buộc phải tạo một phiên bản mới (ví dụ v1.1 hoặc v2.0) thay vì ghi đè lên phiên bản cũ."
            )

        full_path = cur.get("full_pdf_path")
        sample_path = cur.get("sample_pdf_path")

        if full_pdf_bytes is not None:
            priv_file = get_private_reports_dir() / f"{real_id}-{safe_ver}-full.pdf"
            priv_file.write_bytes(full_pdf_bytes)
            full_path = str(priv_file)

        if sample_pdf_bytes is not None:
            pub_file = get_public_samples_dir() / f"{real_id}-{safe_ver}-sample.pdf"
            pub_file.write_bytes(sample_pdf_bytes)
            sample_path = str(pub_file)

        c.execute(
            """
            UPDATE research_reports
            SET version = ?, full_pdf_path = ?, sample_pdf_path = ?, updated_at = ?
            WHERE id = ?
            """,
            (eff_ver, full_path, sample_path, now, real_id),
        )
        if full_path:
            c.execute(
                """
                INSERT INTO report_versions (
                    id, report_id, version, full_pdf_path, sample_pdf_path, changelog, wfo_metrics_json, published_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(report_id, version) DO UPDATE SET
                    full_pdf_path = excluded.full_pdf_path,
                    sample_pdf_path = excluded.sample_pdf_path
                """,
                (
                    f"ver_{real_id}_{safe_ver}",
                    real_id,
                    eff_ver,
                    full_path,
                    sample_path,
                    f"Uploaded PDF for {eff_ver}",
                    cur.get("wfo_metrics_json"),
                    now,
                    now,
                ),
            )
        audit(c, admin_id, "research_report_pdf_uploaded", {
            "report_id": real_id,
            "version": eff_ver,
            "full_uploaded": full_pdf_bytes is not None,
            "sample_uploaded": sample_pdf_bytes is not None,
        })
        updated = c.execute("SELECT * FROM research_reports WHERE id = ?", (real_id,)).fetchone()
        return _format_report_row(updated, include_private_paths=True)


def publish_admin_report(
    report_id: str,
    version: Optional[str] = None,
    changelog: Optional[str] = None,
    admin_id: str = "admin",
    is_human_admin: bool = True,
) -> Dict[str, Any]:
    """Admin: Approve and publish a report (or a new version of a report).
    Requires a valid full PDF file to exist before publishing.
    Strictly forbids automated agents or workers from auto-publishing."""
    if not is_human_admin or str(admin_id or "").startswith(("autonomous_", "agent_", "system_")):
        raise PermissionError("Tiến trình tự động/Agent không được phép xuất bản trực tiếp. Bắt buộc cần Admin con người phê duyệt.")

    now = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM research_reports WHERE id = ? OR slug = ?", (report_id, report_id)).fetchone()
        if not row:
            raise ValueError(f"Không tìm thấy báo cáo '{report_id}'.")
        cur = dict(row)
        real_id = cur["id"]
        eff_ver = (version or cur.get("version") or "v1.0").strip()
        full_path = cur.get("full_pdf_path")
        if not full_path or not Path(str(full_path)).is_file():
            raise ValueError("Báo cáo chưa có file PDF đầy đủ hợp lệ. Vui lòng tải lên PDF trước khi xuất bản.")

        # If publishing a newer version while pointing to an old version's filename, copy to a version-specific file
        safe_ver = _slugify(eff_ver)
        expected_priv_file = get_private_reports_dir() / f"{real_id}-{safe_ver}-full.pdf"
        if Path(str(full_path)).resolve() != expected_priv_file.resolve():
            if not expected_priv_file.exists():
                expected_priv_file.write_bytes(Path(str(full_path)).read_bytes())
            full_path = str(expected_priv_file)

        # Ensure full PDF is not an auto-generated placeholder layout
        full_content = Path(str(full_path)).read_bytes()
        if (
            b"Placeholder Layout" in full_content
            or b"B\xe1\xbb\x91 c\xe1\xbb\xa5c m\xe1\xba\xabu t\xe1\xbb\xb1 \xc4\x91\xe1\xbb\x99ng" in full_content
            or (b"# 1. Research Summary" in full_content and len(full_content) < 3500)
        ):
            raise ValueError("Tệp PDF hiện tại chỉ là bản bố cục mẫu tự động. Backend từ chối xuất bản khi phiên bản chưa có tệp nghiên cứu thực được phê duyệt.")

        # Gold Suite specific validation: require verified bundle zip & manifest
        if "gold" in real_id.lower():
            try:
                build_or_get_report_bundle_zip(real_id, eff_ver)
            except Exception as exc:
                raise ValueError(f"Không thể xuất bản Gold Research Suite do thiếu gói bằng chứng hoặc manifest: {exc}")

        # Compute cryptographic hashes and package manifest for immutability auditing
        full_hash = _compute_sha256(full_path)
        sample_path_str = str(cur.get("sample_pdf_path") or "")
        sample_hash = _compute_sha256(sample_path_str) if sample_path_str else ""

        full_size = Path(str(full_path)).stat().st_size if Path(str(full_path)).is_file() else 0
        sample_size = Path(sample_path_str).stat().st_size if sample_path_str and Path(sample_path_str).is_file() else 0

        manifest = {
            "report_id": real_id,
            "version": eff_ver,
            "published_at": now,
            "publisher_admin_id": admin_id,
            "files": {
                "full_pdf": {
                    "path": str(full_path),
                    "sha256": full_hash,
                    "size_bytes": full_size,
                },
                "sample_pdf": {
                    "path": sample_path_str,
                    "sha256": sample_hash,
                    "size_bytes": sample_size,
                },
            },
        }
        manifest_json = json.dumps(manifest, ensure_ascii=False)
        file_hashes_json = json.dumps({
            "full_pdf": full_hash,
            "sample_pdf": sample_hash,
        }, ensure_ascii=False)

        c.execute(
            """
            UPDATE research_reports
            SET status = 'PUBLISHED', is_for_sale = 1, version = ?, full_pdf_path = ?, published_at = COALESCE(published_at, ?), updated_at = ?
            WHERE id = ?
            """,
            (eff_ver, full_path, now, now, real_id),
        )

        try:
            cols = _column_names(c, "report_versions")
            if "manifest_json" not in cols:
                c.execute("ALTER TABLE report_versions ADD COLUMN manifest_json TEXT")
            if "file_hashes_json" not in cols:
                c.execute("ALTER TABLE report_versions ADD COLUMN file_hashes_json TEXT")
        except Exception:
            pass

        c.execute(
            """
            INSERT INTO report_versions (
                id, report_id, version, full_pdf_path, sample_pdf_path, changelog, wfo_metrics_json, published_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(report_id, version) DO UPDATE SET
                full_pdf_path = excluded.full_pdf_path,
                sample_pdf_path = excluded.sample_pdf_path,
                changelog = COALESCE(excluded.changelog, report_versions.changelog),
                published_at = excluded.published_at
            """,
            (
                f"ver_{real_id}_{safe_ver}",
                real_id,
                eff_ver,
                full_path,
                cur.get("sample_pdf_path"),
                changelog or f"Published version {eff_ver}",
                cur.get("wfo_metrics_json"),
                now,
                now,
            ),
        )
        try:
            c.execute(
                "UPDATE report_versions SET manifest_json = ?, file_hashes_json = ? WHERE report_id = ? AND version = ?",
                (manifest_json, file_hashes_json, real_id, eff_ver),
            )
        except Exception:
            pass
        audit(c, admin_id, "research_report_published", {
            "report_id": real_id,
            "version": eff_ver,
            "full_pdf_sha256": full_hash,
        })
        updated = c.execute("SELECT * FROM research_reports WHERE id = ?", (real_id,)).fetchone()
        out = _format_report_row(updated, include_private_paths=True)
        out["file_hashes"] = {
            "full_pdf_sha256": full_hash,
            "sample_pdf_sha256": sample_hash,
        }
        out["manifest"] = manifest
        return out


def discontinue_admin_report(report_id: str, admin_id: str = "admin") -> Dict[str, Any]:
    """Admin: Stop selling a report (status='DISCONTINUED').
    Prevents new checkout orders while strictly preserving download rights for existing buyers."""
    now = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM research_reports WHERE id = ? OR slug = ?", (report_id, report_id)).fetchone()
        if not row:
            raise ValueError(f"Không tìm thấy báo cáo '{report_id}'.")
        real_id = row["id"]
        c.execute(
            "UPDATE research_reports SET status = 'DISCONTINUED', updated_at = ? WHERE id = ?",
            (now, real_id),
        )
        audit(c, admin_id, "research_report_discontinued", {"report_id": real_id})
        updated = c.execute("SELECT * FROM research_reports WHERE id = ?", (real_id,)).fetchone()
        return _format_report_row(updated, include_private_paths=True)


def create_report_checkout_order(
    user_id: str,
    report_id: str,
    payment_method: str = "USDT",
) -> Dict[str, Any]:
    """Create a per-report checkout order locking the exact report price in USDT.
    Default payment gateway is on-chain USDT (BEP20 or TRC20).
    Rejects unpublished or discontinued reports, and blocks duplicate purchase if the user already owns this exact version."""
    from app.routers.deps import fail
    from app.core.config import is_commercial_reports_sale_enabled, is_usdt_payment_enabled

    if not is_commercial_reports_sale_enabled():
        fail(400, "Cổng mua trực tuyến đang tạm tắt. Các báo cáo hiện tại đang trong giai đoạn tiền thẩm định và đọc thử miễn phí.")

    if not is_usdt_payment_enabled():
        fail(400, "Phương thức thanh toán USDT hiện chưa được kích hoạt hoặc đang tạm khóa.")

    now_ts = time.time()
    method_u = str(payment_method or "USDT").strip().upper()
    if method_u in ("SEPAY", "VIETQR", "VND"):
        fail(400, "Cổng thanh toán SePay / VietQR đã ngừng hoạt động. Vui lòng thanh toán mặc định bằng USDT (BEP20 hoặc TRC20).")

    from app.domains.billing.crypto_direct import (
        allocate_unique_usdt_amount,
        get_crypto_wallets_config,
        validate_trc20_address,
        validate_bep20_address,
    )
    crypto_cfg = get_crypto_wallets_config()
    trc20_addr = str(crypto_cfg.get("trc20_address") or "").strip()
    bep20_addr = str(crypto_cfg.get("bep20_address") or "").strip()
    trc20_valid = validate_trc20_address(trc20_addr)
    bep20_valid = validate_bep20_address(bep20_addr)

    if "TRC20" in method_u:
        if not trc20_valid:
            fail(400, "Địa chỉ ví USDT mạng TRC20 chưa được cấu hình hợp lệ trên hệ thống.")
        network = "TRC20"
        wallet_address = trc20_addr
    elif "BEP20" in method_u:
        if not bep20_valid:
            fail(400, "Địa chỉ ví USDT mạng BEP20 chưa được cấu hình hợp lệ trên hệ thống.")
        network = "BEP20"
        wallet_address = bep20_addr
    else:
        if bep20_valid:
            network = "BEP20"
            wallet_address = bep20_addr
        elif trc20_valid:
            network = "TRC20"
            wallet_address = trc20_addr
        else:
            fail(400, "Chưa cấu hình ví nhận USDT. Quản trị viên cần lưu địa chỉ BEP20 hoặc TRC20 hợp lệ trước khi mở đơn.")

    gateway = f"USDT_{network}"
    currency = "USDT"

    with tx() as c:
        ensure_flagship_sample_report_seeded(c)
        rep_row = c.execute(
            "SELECT * FROM research_reports WHERE id = ? OR slug = ? LIMIT 1",
            (report_id.strip(), report_id.strip()),
        ).fetchone()
        if not rep_row:
            fail(404, "Báo cáo nghiên cứu không tồn tại.")
        rep = dict(rep_row)
        real_rep_id = rep["id"]
        rep_status = str(rep.get("status") or "DRAFT").upper()

        can_buy, unavail_reason = check_report_purchase_eligibility(rep_status, bool(rep.get("is_for_sale", 0)))
        if not can_buy:
            fail(400, unavail_reason or "Báo cáo hiện không trong trạng thái có thể đặt mua.")

        rep_version = str(rep.get("version") or "v1.0").strip()
        existing_ent = c.execute(
            """
            SELECT id FROM report_entitlements
            WHERE user_id = ? AND report_id = ? AND purchased_version = ? AND status = 'ACTIVE'
            """,
            (user_id, real_rep_id, rep_version),
        ).fetchone()
        if existing_ent:
            fail(409, f"Bạn đã sở hữu báo cáo này (phiên bản {rep_version}) trong Thư viện của tôi.")

        # Check for existing valid pending order to prevent duplicate creation on rapid clicks/tabs
        existing_order = c.execute(
            """
            SELECT * FROM orders
            WHERE user_id = ? AND report_id = ? AND report_version = ?
              AND status = 'PENDING' AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, real_rep_id, rep_version, now_ts),
        ).fetchone()
        if existing_order:
            eo = dict(existing_order)
            cur_gw = str(eo.get("payment_gateway") or gateway)
            cur_net = cur_gw.replace("USDT_", "") or network
            cur_wallet = trc20_addr if "TRC20" in cur_gw else bep20_addr
            return {
                "order_id": eo["id"],
                "order_code": eo["id"],
                "report_id": real_rep_id,
                "report_title": rep.get("title", ""),
                "report_version": rep_version,
                "amount_usd": float(eo.get("amount_usd") or 0.0),
                "expected_amount_usdt": float(eo.get("expected_amount_usdt") or eo.get("amount_usd") or 0.0),
                "amount": float(eo.get("expected_amount_usdt") or eo.get("amount_usd") or 0.0),
                "currency": "USDT",
                "payment_gateway": cur_gw,
                "network": cur_net,
                "wallet_address": cur_wallet,
                "status": "PENDING",
                "expires_at": float(eo.get("expires_at") or 0.0),
                "created_at": float(eo.get("created_at") or 0.0),
                "already_exists": True,
            }

        total_usd = round(float(rep.get("price_usd") or 29.0), 2)
        rate, _, _ = get_usd_vnd_rate()
        amount_vnd = int(rep.get("price_vnd") or convert_usd_to_vnd(total_usd, rate))
        locked_rate = round(amount_vnd / max(total_usd, 0.01), 2) if amount_vnd > 0 else rate

        expected_usdt = allocate_unique_usdt_amount(total_usd, gateway, db_cursor=c)
        expires_at = now_ts + (ORDER_LOCK_MINUTES * 60)
        order_id = f"ord_{secrets.token_hex(6)}"
        content_memo = f"ZP {order_id[-6:].upper()}"

        hold_key = f"usdt_hold:{gateway}:{expected_usdt:.2f}"
        c.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (hold_key, order_id),
        )

        c.execute(
            """
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_gateway,
                created_at, expires_at, currency, expected_amount_usdt,
                product_type, report_id, report_version
            ) VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING', ?, ?, ?, ?, ?, 'PDF_REPORT', ?, ?)
            """,
            (
                order_id,
                user_id,
                total_usd,
                locked_rate,
                amount_vnd,
                f"report:{real_rep_id}",
                gateway,
                now_ts,
                expires_at,
                currency,
                expected_usdt,
                real_rep_id,
                rep_version,
            ),
        )
        if wallet_address:
            c.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"order_wallet:{order_id}", wallet_address),
            )

    return {
        "id": order_id,
        "order_id": order_id,
        "order_code": order_id,
        "product_type": "PDF_REPORT",
        "report_id": real_rep_id,
        "report_title": rep.get("title"),
        "report_version": rep_version,
        "plan_tier": f"report:{real_rep_id}",
        "cloud_slots_count": 0,
        "amount": expected_usdt,
        "amount_usd": total_usd,
        "locked_exchange_rate": locked_rate,
        "amount_vnd": amount_vnd,
        "status": "PENDING",
        "currency": "USDT",
        "payment_gateway": gateway,
        "expected_amount_usdt": expected_usdt,
        "amount_usdt": expected_usdt,
        "wallet_address": wallet_address,
        "crypto_network": network,
        "network": network,
        "qr_code_url": None,
        "qr_url": None,
        "payment_content": content_memo,
        "transfer_memo": content_memo,
        "created_at": now_ts,
        "expires_at": expires_at,
    }


def grant_report_entitlement_tx(
    c,
    order: Dict[str, Any],
    now_ts: Optional[float] = None,
    is_trial: Optional[int] = None,
    expires_at: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Atomically grant exactly-once download entitlement for the purchased report & version inside an existing DB transaction.
    Separates perpetual purchased entitlements from time-limited trial licenses."""
    now = float(now_ts if now_ts is not None else time.time())
    order_id = str(order["id"])
    user_id = str(order["user_id"])
    rep_id = str(order.get("report_id") or "").strip()
    if not rep_id and str(order.get("plan_tier") or "").startswith("report:"):
        rep_id = str(order["plan_tier"]).split("report:", 1)[1].strip()
    if not rep_id:
        return None

    if is_trial is not None:
        effective_is_trial = int(is_trial)
    elif order.get("payment_status") == "FREE_TRIAL" or order.get("is_trial") or "trial" in order_id:
        effective_is_trial = 1
    else:
        effective_is_trial = 0

    if expires_at is not None:
        effective_expires_at = float(expires_at)
    elif order.get("expires_at"):
        effective_expires_at = float(order["expires_at"])
    elif effective_is_trial == 1:
        effective_expires_at = now + 86400 * 30
    else:
        effective_expires_at = None

    rep_row = c.execute("SELECT * FROM research_reports WHERE id = ?", (rep_id,)).fetchone()
    if not rep_row:
        logger.error(f"Report {rep_id} not found while granting entitlement for order {order_id}")
        return None
    rep = dict(rep_row)
    purchased_ver = str(order.get("report_version") or rep.get("version") or "v1.0").strip()

    # Look up version-specific PDF path first so later version updates never alter what this order unlocked
    ver_row = c.execute(
        "SELECT full_pdf_path FROM report_versions WHERE report_id = ? AND version = ?",
        (rep_id, purchased_ver),
    ).fetchone()
    locked_pdf_path = str((ver_row[0] if ver_row and ver_row[0] else rep.get("full_pdf_path")) or "")

    existing_by_order = c.execute(
        "SELECT * FROM report_entitlements WHERE order_id = ?",
        (order_id,),
    ).fetchone()
    if existing_by_order:
        return dict(existing_by_order)

    existing_by_ver = c.execute(
        "SELECT * FROM report_entitlements WHERE user_id = ? AND report_id = ? AND purchased_version = ?",
        (user_id, rep_id, purchased_ver),
    ).fetchone()
    if existing_by_ver:
        ent_d = dict(existing_by_ver)
        # INVARIANT: Never overwrite perpetual ownership (is_trial == 0) with a trial grant or expiration
        if ent_d.get("is_trial") == 0:
            effective_is_trial = 0
            effective_expires_at = None
        if ent_d.get("status") != "ACTIVE" or (ent_d.get("is_trial") == 1 and ent_d.get("expires_at") != effective_expires_at):
            c.execute(
                "UPDATE report_entitlements SET status = 'ACTIVE', order_id = ?, full_pdf_path = ?, expires_at = ?, is_trial = ?, granted_at = ?, revoked_at = NULL WHERE id = ?",
                (order_id, locked_pdf_path, effective_expires_at, effective_is_trial, now, ent_d["id"]),
            )
            ent_d["status"] = "ACTIVE"
            ent_d["expires_at"] = effective_expires_at
            ent_d["is_trial"] = effective_is_trial
        c.execute(
            "UPDATE orders SET entitlement_status = 'GRANTED', cloud_deploy_status = 'NOT_APPLICABLE' WHERE id = ?",
            (order_id,),
        )
        return ent_d

    ent_id = f"ent_{secrets.token_hex(8)}"
    c.execute(
        """
        INSERT INTO report_entitlements (
            id, user_id, report_id, purchased_version, full_pdf_path, order_id, status,
            expires_at, is_trial, download_count, granted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 0, ?, NULL)
        ON CONFLICT(order_id) DO NOTHING
        """,
        (ent_id, user_id, rep_id, purchased_ver, locked_pdf_path, order_id, effective_expires_at, effective_is_trial, now),
    )
    c.execute(
        "UPDATE orders SET entitlement_status = 'GRANTED', cloud_deploy_status = 'NOT_APPLICABLE' WHERE id = ?",
        (order_id,),
    )
    audit(c, user_id, "report_entitlement_granted", {
        "entitlement_id": ent_id,
        "report_id": rep_id,
        "purchased_version": purchased_ver,
        "order_id": order_id,
        "is_trial": effective_is_trial,
        "expires_at": effective_expires_at,
    })
    row = c.execute("SELECT * FROM report_entitlements WHERE order_id = ?", (order_id,)).fetchone()
    return dict(row) if row else None


def revoke_report_entitlement_for_refund_tx(c, order_id: str, admin_id: str = "admin") -> bool:
    """Synchronize report entitlement access when an order is confirmed REFUNDED."""
    now = time.time()
    c.execute(
        "UPDATE orders SET status = 'REFUNDED', payment_status = 'REFUNDED', entitlement_status = 'REVOKED' WHERE id = ?",
        (order_id,),
    )
    cur = c.execute(
        "UPDATE report_entitlements SET status = 'REFUNDED', revoked_at = ? WHERE order_id = ? AND status = 'ACTIVE'",
        (now, order_id),
    )
    revoked = getattr(cur, "rowcount", 1) > 0
    audit(c, admin_id, "report_entitlement_refund_revoked", {"order_id": order_id, "revoked": revoked})
    return revoked


def list_user_report_library(user_id: str) -> List[Dict[str, Any]]:
    """Return all ACTIVE purchased PDF reports in the authenticated user's personal library.
    Correctly surfaces trial expiration status while preserving perpetual purchased access."""
    with tx() as c:
        try:
            rows = c.execute(
                """
                SELECT e.id AS entitlement_id, e.report_id, e.purchased_version, e.full_pdf_path,
                       e.order_id, e.status AS entitlement_status, e.granted_at, e.expires_at, e.is_trial,
                       r.slug, r.title, r.summary, r.market, r.timeframe, r.version AS latest_version,
                       r.status AS report_status, r.price_usd, r.price_vnd
                FROM report_entitlements e
                JOIN research_reports r ON r.id = e.report_id
                WHERE e.user_id = ? AND e.status = 'ACTIVE'
                ORDER BY e.granted_at DESC
                """,
                (user_id,),
            ).fetchall()
        except Exception as err:
            logger.warning("Query with expires_at failed (%s), falling back to baseline entitlements columns.", err)
            rows = c.execute(
                """
                SELECT e.id AS entitlement_id, e.report_id, e.purchased_version, e.full_pdf_path,
                       e.order_id, e.status AS entitlement_status, e.granted_at,
                       r.slug, r.title, r.summary, r.market, r.timeframe, r.version AS latest_version,
                       r.status AS report_status, r.price_usd, r.price_vnd
                FROM report_entitlements e
                JOIN research_reports r ON r.id = e.report_id
                WHERE e.user_id = ? AND e.status = 'ACTIVE'
                ORDER BY e.granted_at DESC
                """,
                (user_id,),
            ).fetchall()
        items = []
        now_ts = time.time()
        for r in rows:
            d = dict(r)
            ent_id = d["entitlement_id"]
            rep_id = d["report_id"]
            ver = d["purchased_version"]
            is_trial = bool(d.get("is_trial") or 0)
            exp_val = d.get("expires_at")
            exp_ts = float(exp_val) if exp_val is not None else None
            is_expired = bool(is_trial and exp_ts and now_ts > exp_ts)
            items.append({
                "entitlement_id": ent_id,
                "report_id": rep_id,
                "slug": d.get("slug") or rep_id,
                "title": d.get("title") or "",
                "summary": d.get("summary") or "",
                "market": d.get("market") or "XAU/USD",
                "timeframe": d.get("timeframe") or "M15 / H1",
                "purchased_version": ver,
                "latest_version": d.get("latest_version") or ver,
                "order_id": d.get("order_id"),
                "is_trial": is_trial,
                "expires_at": exp_ts,
                "is_expired": is_expired,
                "status": "EXPIRED" if is_expired else "ACTIVE",
                "granted_at": float(d.get("granted_at") or now_ts),
                "download_url": f"/api/v1/reports/{rep_id}/download?version={quote(str(ver))}" if not is_expired else None,
                "bundle_download_url": f"/api/v1/reports/{rep_id}/download-bundle?version={quote(str(ver))}" if not is_expired else None,
            })
        return items


list_purchased_reports_for_user = list_user_report_library


def verify_user_report_download_access(
    user_id: str,
    user_role: str,
    report_id: str,
    version: Optional[str] = None,
) -> Tuple[Path, str, str]:
    """Strictly verify that `user_id` holds an ACTIVE non-expired entitlement for `(report_id, version)` (or is admin).
    Returns `(pdf_file_path, filename, purchased_version)` or raises PermissionError / FileNotFoundError."""
    with tx() as c:
        rep_row = c.execute(
            "SELECT * FROM research_reports WHERE id = ? OR slug = ? LIMIT 1",
            (report_id, report_id),
        ).fetchone()
        if not rep_row:
            raise FileNotFoundError("Báo cáo không tồn tại.")
        rep = dict(rep_row)
        real_rep_id = rep["id"]

        if str(user_role or "").lower() == "admin":
            target_ver = (version or rep.get("version") or "v1.0").strip()
            v_row = c.execute(
                "SELECT full_pdf_path FROM report_versions WHERE report_id = ? AND version = ?",
                (real_rep_id, target_ver),
            ).fetchone()
            pdf_path_str = str((v_row[0] if v_row and v_row[0] else rep.get("full_pdf_path")) or "")
        else:
            if version:
                ent_row = c.execute(
                    """
                    SELECT * FROM report_entitlements
                    WHERE user_id = ? AND report_id = ? AND purchased_version = ? AND status = 'ACTIVE'
                    LIMIT 1
                    """,
                    (user_id, real_rep_id, version.strip()),
                ).fetchone()
            else:
                ent_row = c.execute(
                    """
                    SELECT * FROM report_entitlements
                    WHERE user_id = ? AND report_id = ? AND status = 'ACTIVE'
                    ORDER BY granted_at DESC LIMIT 1
                    """,
                    (user_id, real_rep_id),
                ).fetchone()
            if not ent_row:
                raise PermissionError("Tài khoản của bạn chưa có quyền tải phiên bản báo cáo PDF này.")
            ent = dict(ent_row)

            # Strict backend trial expiration check
            is_trial = bool(ent.get("is_trial") or 0)
            exp_val = ent.get("expires_at")
            if is_trial and exp_val is not None:
                if time.time() > float(exp_val):
                    raise PermissionError(
                        "Quyền dùng thử (Trial) của bạn đối với báo cáo này đã hết hạn. "
                        "Vui lòng liên hệ quản trị viên hoặc nâng cấp giấy phép."
                    )

            target_ver = str(ent["purchased_version"])
            pdf_path_str = str(ent.get("full_pdf_path") or "")
            if not pdf_path_str or not Path(pdf_path_str).is_file():
                v_row = c.execute(
                    "SELECT full_pdf_path FROM report_versions WHERE report_id = ? AND version = ?",
                    (real_rep_id, target_ver),
                ).fetchone()
                if v_row and v_row[0]:
                    pdf_path_str = str(v_row[0])

        if not pdf_path_str or not Path(pdf_path_str).is_file():
            raise FileNotFoundError("File PDF của phiên bản này hiện không khả dụng trên máy chủ.")

        safe_slug = _slugify(rep.get("slug") or real_rep_id)
        safe_ver = _slugify(target_ver)
        download_filename = f"zupirus-{safe_slug}-{safe_ver}.pdf"
        return Path(pdf_path_str), download_filename, target_ver


def _signing_secret() -> bytes:
    raw = os.getenv("REPORT_DOWNLOAD_SECRET") or os.getenv("ENCRYPTION_KEY") or os.getenv("SECRET_KEY") or os.getenv("ZUPIRUS_SECRET")
    if raw:
        return raw.encode("utf-8")
    app_env = os.getenv("APP_ENV", "dev").strip().lower()
    if app_env in ("production", "prod") and not os.getenv("PYTEST_CURRENT_TEST"):
        raise RuntimeError("REPORT_DOWNLOAD_SECRET or ENCRYPTION_KEY is required in production")
    return b"dev-only-report-download-secret"


def issue_signed_report_download_token(user_id: str, report_id: str, version: str, ttl_sec: int = 300) -> str:
    """Issue a time-limited HMAC-SHA256 signed download token bound strictly to `(user_id, report_id, version)`."""
    exp = int(time.time()) + max(30, min(ttl_sec, 3600))
    payload = f"{user_id}:{report_id}:{version}:{exp}"
    sig = hmac.new(_signing_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_signed_report_download_token(token: str, current_user_id: str) -> Optional[Tuple[str, str]]:
    """Verify a signed download token and enforce that `current_user_id` matches the token's `user_id`
    (prevents sharing download URLs across accounts)."""
    if not token or ":" not in token:
        return None
    parts = token.split(":")
    if len(parts) != 5:
        return None
    t_uid, t_rep, t_ver, t_exp_str, t_sig = parts
    if t_uid != current_user_id:
        return None
    try:
        if int(t_exp_str) < int(time.time()):
            return None
    except ValueError:
        return None
    payload = f"{t_uid}:{t_rep}:{t_ver}:{t_exp_str}"
    expected_sig = hmac.new(_signing_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(t_sig, expected_sig):
        return None
    return t_rep, t_ver


def _generate_standalone_replay_py() -> str:
    """Return complete zero-dependency standalone replay CLI script for client bundles."""
    return '''"""ZUPIRUS Quant Lab - Standalone Quantitative Replay Tool (Institutional Client Edition).

Zero third-party dependencies required. Runs on Python 3.8+ Standard Library.
Executes locked Breakout & Retest quantitative rules and produces verifiable transaction ledgers.

Usage:
  python replay.py --file data/sample_candles.csv
  python replay.py --file data/sample_candles.csv --output-ledger my_ledger.csv
  python replay.py --file data/sample_candles.csv --spread-pips 3.5 --slippage-pips 1.0
"""
import argparse
import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import math
import sys


@dataclass(frozen=True)
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    @property
    def utc(self) -> datetime:
        return datetime.fromtimestamp(self.time, tz=timezone.utc)


@dataclass
class TradeExitResult:
    exit_bar: Candle
    exit_price: float
    exit_reason: str
    gross_r: float
    bars_held: int


def parse_candle_file(file_path):
    raw_candles = []
    seen = set()
    with open(file_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(line for line in f if not line.startswith("#") and line.strip())
        for row in reader:
            normalized = {k.lower().strip(): v.strip() for k, v in row.items() if k}
            raw_t = normalized.get("time") or normalized.get("timestamp")
            if not raw_t and "datetime" in normalized:
                clean_dt = normalized["datetime"].replace("UTC", "").strip()
                dt = datetime.fromisoformat(clean_dt).replace(tzinfo=timezone.utc)
                ts = int(dt.timestamp())
            else:
                ts = int(float(raw_t))
            if ts in seen:
                continue
            seen.add(ts)
            raw_candles.append(Candle(
                time=ts,
                open=float(normalized["open"]),
                high=float(normalized["high"]),
                low=float(normalized["low"]),
                close=float(normalized["close"]),
                volume=float(normalized.get("volume", 100)),
            ))
    raw_candles.sort(key=lambda x: x.time)
    return raw_candles


def _walk_trade_exit(bars, side, entry, stop, target, max_bars=32):
    risk = (entry - stop) if side == "long" else (stop - entry)
    if risk <= 0 or not bars:
        return None
    for idx, bar in enumerate(bars):
        bars_held = idx + 1
        if side == "long":
            if bar.open <= stop:
                return TradeExitResult(bar, bar.open, "STOP_LOSS", (bar.open - entry) / risk, bars_held)
            if bar.open >= target:
                return TradeExitResult(bar, bar.open, "TAKE_PROFIT", (bar.open - entry) / risk, bars_held)
            hit_stop = bar.low <= stop
            hit_target = bar.high >= target
            if hit_stop and hit_target:
                return TradeExitResult(bar, stop, "STOP_LOSS", -1.0, bars_held)
            if hit_stop:
                return TradeExitResult(bar, stop, "STOP_LOSS", -1.0, bars_held)
            if hit_target:
                return TradeExitResult(bar, target, "TAKE_PROFIT", (target - entry) / risk, bars_held)
        else:
            if bar.open >= stop:
                return TradeExitResult(bar, bar.open, "STOP_LOSS", (entry - bar.open) / risk, bars_held)
            if bar.open <= target:
                return TradeExitResult(bar, bar.open, "TAKE_PROFIT", (entry - bar.open) / risk, bars_held)
            hit_stop = bar.high >= stop
            hit_target = bar.low <= target
            if hit_stop and hit_target:
                return TradeExitResult(bar, stop, "STOP_LOSS", -1.0, bars_held)
            if hit_stop:
                return TradeExitResult(bar, stop, "STOP_LOSS", -1.0, bars_held)
            if hit_target:
                return TradeExitResult(bar, target, "TAKE_PROFIT", (entry - target) / risk, bars_held)

        is_close = bar.utc.hour >= 21
        if bars_held >= max_bars or is_close or idx == len(bars) - 1:
            gross_r = ((bar.close - entry) / risk) if side == "long" else ((entry - bar.close) / risk)
            reason = "SESSION_CLOSE" if is_close else ("TIME_STOP" if bars_held >= max_bars else "SAMPLE_END")
            return TradeExitResult(bar, bar.close, reason, gross_r, bars_held)
    return None


def rule_backtest(candles, spread_pips=3.5, slippage_pips=1.0):
    by_day = defaultdict(list)
    for c in candles:
        by_day[c.utc.strftime("%Y-%m-%d")].append(c)

    days_sorted = sorted(by_day.keys())
    total_days = len(days_sorted)
    train_cutoff = int(total_days * 0.50)
    val_cutoff = int(total_days * 0.80)
    train_days = set(days_sorted[:train_cutoff])
    val_days = set(days_sorted[train_cutoff:val_cutoff])

    trades = []
    friction_usd = (spread_pips + slippage_pips) * 0.10

    for day in days_sorted:
        bars = by_day[day]
        asia = [c for c in bars if 0 <= c.utc.hour < 5]
        if len(asia) != 20 or asia[0].utc.hour != 0 or asia[0].utc.minute != 0:
            continue
        valid_ts = all(asia[i].time == asia[0].time + i * 900 for i in range(20))
        if not valid_ts:
            continue

        asia_high = max(c.high for c in asia)
        asia_low = min(c.low for c in asia)
        if asia_high <= asia_low:
            continue

        later = [c for c in bars if c.utc.hour >= 5]
        if not later:
            continue

        split_set = "TRAIN" if day in train_days else ("VALIDATION" if day in val_days else "TEST")

        b_idx = None
        side = None
        for idx, bar in enumerate(later):
            if bar.close > asia_high:
                b_idx, side = idx, "long"
                break
            elif bar.close < asia_low:
                b_idx, side = idx, "short"
                break
        if b_idx is None:
            continue

        retest_idx = None
        for r_off, rc in enumerate(later[b_idx + 1 : min(b_idx + 9, len(later))]):
            act_idx = b_idx + 1 + r_off
            if side == "long":
                if rc.low <= asia_low:
                    break
                if rc.low <= asia_high:
                    retest_idx = act_idx
                    break
            else:
                if rc.high >= asia_high:
                    break
                if rc.high >= asia_low:
                    retest_idx = act_idx
                    break
        if retest_idx is None or retest_idx + 1 >= len(later):
            continue

        enter_bar = later[retest_idx + 1]
        entry = enter_bar.open
        stop = asia_low if side == "long" else asia_high
        risk = (entry - stop) if side == "long" else (stop - entry)
        if risk <= 0:
            continue
        tp = entry + 1.5 * risk if side == "long" else entry - 1.5 * risk

        exit_res = _walk_trade_exit(later[retest_idx + 1:], side, entry, stop, tp, max_bars=32)
        if not exit_res:
            continue

        cost_r = friction_usd / risk
        gross_r = exit_res.gross_r
        net_r = gross_r - cost_r

        trades.append({
            "trade_id": f"tr_{len(trades)+1:03d}",
            "day": day,
            "split_set": split_set,
            "side": side,
            "entry_datetime": enter_bar.utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "exit_datetime": exit_res.exit_bar.utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "entry_price": entry,
            "exit_price": exit_res.exit_price,
            "sl_price": stop,
            "tp_price": tp,
            "cost_pips": spread_pips + slippage_pips,
            "cost_r": round(cost_r, 4),
            "exit_reason": exit_res.exit_reason,
            "gross_r": round(gross_r, 4),
            "net_r": round(net_r, 4),
            "is_win": net_r > 0,
            "bars_held": exit_res.bars_held,
        })
    return trades


def main():
    p = argparse.ArgumentParser(description="ZUPIRUS Quant Lab Standalone Replay")
    p.add_argument("--file", "-f", default="data/sample_candles.csv", help="Input candle CSV")
    p.add_argument("--spread-pips", type=float, default=3.5, help="Spread in pips")
    p.add_argument("--slippage-pips", type=float, default=1.0, help="Slippage in pips")
    p.add_argument("--output-ledger", "-o", default=None, help="Output CSV ledger path")
    args = p.parse_args()

    candles = parse_candle_file(args.file)
    trades = rule_backtest(candles, spread_pips=args.spread_pips, slippage_pips=args.slippage_pips)

    wins = [t for t in trades if t["is_win"]]
    losses = [t for t in trades if not t["is_win"]]
    gw = sum(t["gross_r"] for t in wins)
    gl = abs(sum(t["gross_r"] for t in losses))
    pf_str = f"{gw/gl:.2f}" if gl > 0 else f"Không xác định (0 lệnh lỗ / {len(trades)} lệnh)"

    print("=" * 72)
    print("  ZUPIRUS GOLD RESEARCH SUITE V1 - STANDALONE REPLAY VERIFIER")
    print("=" * 72)
    print(f" Loaded Candles : {len(candles)} bars")
    print(f" Assumptions    : Spread {args.spread_pips} pips | Slippage {args.slippage_pips} pips | COMEX $0.10/tick")
    print(f" Total Trades   : {len(trades)}")
    print(f" Win Rate (%)   : {(len(wins)/len(trades)*100 if trades else 0):.2f}%")
    print(f" Profit Factor  : {pf_str}")
    print(f" Realized Net R : {sum(t['net_r'] for t in trades):.2f}R")
    print("-" * 72)
    for t in trades[:10]:
        print(f" {t['trade_id']} | {t['side']:<5} | In: {t['entry_datetime']} @ {t['entry_price']:.2f} | Out: {t['exit_price']:.2f} ({t['exit_reason']:<12}) | Net: {t['net_r']:+.3f}R")
    print("=" * 72)

    if args.output_ledger:
        with open(args.output_ledger, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(trades[0].keys()) if trades else ["empty"])
            writer.writeheader()
            writer.writerows(trades)
        print(f"Saved complete transaction ledger to: {args.output_ledger}")


if __name__ == "__main__":
    main()
'''


def _generate_bundle_quickstart_md(version: str, raw_csv_sha256: str, normalized_sha256: str) -> str:
    """Generate comprehensive bilingual QUICKSTART.md for the research suite bundle."""
    return f"""# ZUPIRUS Gold Research Suite {version.upper()} — Quickstart & Replay Guide

Chào mừng bạn đến với bộ tài liệu nghiên cứu định lượng độc quyền **ZUPIRUS Gold Research Suite {version}** (Breakout & Retest vàng COMEX M15).

## 1. Cấu trúc gói bàn giao
- `report_full.pdf`: Báo cáo nghiên cứu định lượng đầy đủ (chứa biểu đồ, bảng thống kê và ma trận ma sát).
- `trades_ledger.csv`: Toàn bộ nhật ký từng giao dịch (ID, thời điểm UTC, giá mô phỏng, chi phí, lý do thoát, PnL và Net R).
- `metrics.json`: Trích xuất toàn bộ dữ liệu thống kê, kiểm định Student's t-test, Monte Carlo và ma trận ma sát.
- `strategy_config.json`: Cấu hình tham số chi tiết của chiến lược Breakout & Retest M15.
- `replay.py`: Công cụ replay định lượng độc lập, chạy trực tiếp không phụ thuộc bất kỳ thư viện ngoài nào (Python 3.8+).
- `requirements.txt`: Tài liệu môi trường (chỉ yêu cầu Python 3.8+ thư viện chuẩn).
- `data/sample_candles.csv`: Tệp nến M15 mẫu phục vụ tái hiện kết quả.
- `MANIFEST.sha256`: Bảng mã băm SHA-256 đối soát tính toàn vẹn của từng tệp tin.

## 2. Kiểm tra tính toàn vẹn (SHA-256 Provenance)
Mã băm của file CSV nguyên bản và mã băm chuỗi nến chuẩn hóa được phân tách rõ ràng:
- **Raw CSV File Hash**: `{raw_csv_sha256}`
- **Normalized Candle Stream Hash**: `{normalized_sha256}`

Lệnh đối soát tự động:
```bash
sha256sum -c MANIFEST.sha256
```

## 3. Chạy công cụ Replay độc lập (Standalone Replay)
Công cụ `replay.py` hoạt động trên bất kỳ máy tính sạch nào cài sẵn Python 3.8+, không cần kết nối Internet, không cần tài khoản broker.
```bash
# Chạy với tham số mặc định (Spread 3.5 pips, Slippage 1.0 pip):
python replay.py --file data/sample_candles.csv

# Xuất kết quả sổ lệnh CSV ra tệp riêng:
python replay.py --file data/sample_candles.csv --output-ledger my_reproduced_ledger.csv

# Thử nghiệm với các mức chi phí khác nhau:
python replay.py --file data/sample_candles.csv --spread-pips 5.0 --slippage-pips 2.0
```

## 4. Chạy qua Repository ZUPIRUS Quant Lab (nếu có mã nguồn)
```bash
python -m cli.replay --input data/samples/comex_gold_m15_sample.csv
```
"""


def build_or_get_report_bundle_zip(report_id: str, version: str = "v1.0") -> Tuple[Path, str, Dict[str, str]]:
    """Build and cache the complete institutional research bundle ZIP for client download.
    Contains full PDF, ledger CSV, metrics JSON, strategy config, standalone CLI, sample data, and manifest."""
    import zipfile
    from datetime import datetime, timezone
    from app.domains.quant.data_feed import compute_candles_sha256
    from cli.replay import parse_candle_file
    from app.domains.quant.studies import run_studies, generate_ledger_csv

    bundles_dir = get_private_reports_dir() / "bundles"
    bundles_dir.mkdir(parents=True, exist_ok=True)

    with tx() as c:
        rep_row = c.execute(
            "SELECT id, slug, full_pdf_path FROM research_reports WHERE id = ? OR slug = ?",
            (report_id, report_id),
        ).fetchone()
        if not rep_row:
            raise FileNotFoundError(f"Không tìm thấy báo cáo {report_id}")
        slug = str(rep_row[1] or report_id)
        ver_row = c.execute(
            "SELECT full_pdf_path FROM report_versions WHERE report_id = ? AND version = ?",
            (rep_row[0], version),
        ).fetchone()
        pdf_path_str = str((ver_row[0] if ver_row and ver_row[0] else rep_row[2]) or "")

    pdf_file = Path(pdf_path_str)
    if not pdf_file.is_file():
        pdf_file = get_private_reports_dir() / f"rep_gold_research_suite_v1-{version}-full.pdf"

    if not pdf_file.is_file():
        raise FileNotFoundError(f"Không tìm thấy tệp PDF nghiên cứu đã phê duyệt của phiên bản {version}. Bản bố cục mẫu (placeholder) không được đóng gói xuất bản.")

    pdf_bytes = pdf_file.read_bytes()
    if pdf_bytes.startswith(b"%PDF-1.4 Default Report") or len(pdf_bytes) < 100:
        raise ValueError("Tệp PDF hiện tại chỉ là bản bố cục mẫu (placeholder), không được phép đóng gói bàn giao.")

    bundle_filename = f"zupirus-gold-research-suite-{version}.zip"
    zip_path = bundles_dir / bundle_filename

    # Source sample candle data
    sample_csv_path = Path("data/samples/comex_gold_m15_sample.csv")
    if not sample_csv_path.exists():
        raise FileNotFoundError("Tệp dữ liệu mẫu comex_gold_m15_sample.csv không tồn tại.")

    raw_csv_bytes = sample_csv_path.read_bytes()
    raw_csv_sha256 = hashlib.sha256(raw_csv_bytes).hexdigest()

    candles, _ = parse_candle_file(sample_csv_path)
    normalized_candles_sha256 = compute_candles_sha256(candles)

    # Run study to generate exact matching ledger and metrics
    study_bundle = run_studies(candles, symbol="GC=F", timeframe="M15", strategy_name="breakout_retest")
    ledger_csv_str = study_bundle.get("ledger_csv") or ""
    ledger_csv_bytes = ledger_csv_str.encode("utf-8")
    ledger_sha256 = hashlib.sha256(ledger_csv_bytes).hexdigest()

    metrics_json_str = json.dumps(study_bundle, indent=2, ensure_ascii=False)
    metrics_json_bytes = metrics_json_str.encode("utf-8")
    metrics_sha256 = hashlib.sha256(metrics_json_bytes).hexdigest()

    strategy_config = {
        "strategy_name": "Breakout & Retest of Asia Range M15",
        "version": version,
        "asset_class": "COMEX_GOLD_FUTURES",
        "symbol": "GC=F",
        "timeframe": "M15",
        "timezone": "UTC",
        "asia_range_utc": "00:00 - 05:00 UTC (strictly 20 M15 candles)",
        "breakout_rule": "First candle after 05:00 UTC closing beyond Asia High/Low",
        "retest_rule": "Retest of broken level within 1-8 candles without violating opposite boundary",
        "entry_rule": "At Open of candle immediately following confirmed retest",
        "stop_loss_rule": "Opposite boundary of Asia Range",
        "take_profit_rule": "1.5R from simulated entry price",
        "time_stop_rules": "Max 32 bars held or 21:00 UTC session close",
        "conservative_conflict_resolution": {
            "same_bar_sl_tp": "Stop Loss triggered first (-1.0R)",
            "gap_open": "Executed at Bar Open price"
        },
        "friction_model": {
            "comex_tick_size_usd": 0.10,
            "spread_pips": 3.5,
            "slippage_pips": 1.0,
            "total_friction_pips": 4.5,
            "total_friction_usd_per_oz": 0.45,
            "dynamic_r_cost_formula": "0.45 / initial_risk_usd"
        }
    }
    config_bytes = json.dumps(strategy_config, indent=2, ensure_ascii=False).encode("utf-8")
    config_sha256 = hashlib.sha256(config_bytes).hexdigest()

    standalone_replay_py = _generate_standalone_replay_py()
    replay_py_bytes = standalone_replay_py.encode("utf-8")
    replay_py_sha256 = hashlib.sha256(replay_py_bytes).hexdigest()

    reqs_bytes = b"# Python 3.8+ Standard Library only. Zero third-party dependencies required.\n"
    reqs_sha256 = hashlib.sha256(reqs_bytes).hexdigest()

    quickstart_md = _generate_bundle_quickstart_md(version, raw_csv_sha256, normalized_candles_sha256)
    quickstart_bytes = quickstart_md.encode("utf-8")
    quickstart_sha256 = hashlib.sha256(quickstart_bytes).hexdigest()

    pdf_sha256 = hashlib.sha256(pdf_bytes).hexdigest()

    manifest_lines = [
        f"# ZUPIRUS QUANT LAB - GOLD RESEARCH SUITE {version.upper()} SHA-256 MANIFEST",
        f"# Deterministic Canonical Verification Manifest",
        f"# Note: Raw CSV hash is explicitly separated from normalized candle stream hash.",
        "",
        f"# --- CANONICAL DATASET PROVENANCE ---",
        f"{raw_csv_sha256}  data/sample_candles.csv (raw_csv_file)",
        f"{normalized_candles_sha256}  candle_stream_normalized (normalized_candles_stream)",
        "",
        f"# --- ARTIFACTS & DELIVERABLES ---",
        f"{pdf_sha256}  report_full.pdf",
        f"{ledger_sha256}  trades_ledger.csv",
        f"{metrics_sha256}  metrics.json",
        f"{config_sha256}  strategy_config.json",
        f"{replay_py_sha256}  replay.py",
        f"{reqs_sha256}  requirements.txt",
        f"{quickstart_sha256}  QUICKSTART.md",
    ]
    manifest_bytes = "\n".join(manifest_lines).encode("utf-8")

    def _write_deterministic_zip(target_zip: Path):
        with zipfile.ZipFile(target_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            items = [
                ("report_full.pdf", pdf_bytes),
                ("trades_ledger.csv", ledger_csv_bytes),
                ("metrics.json", metrics_json_bytes),
                ("strategy_config.json", config_bytes),
                ("replay.py", replay_py_bytes),
                ("requirements.txt", reqs_bytes),
                ("data/sample_candles.csv", raw_csv_bytes),
                ("QUICKSTART.md", quickstart_bytes),
                ("MANIFEST.sha256", manifest_bytes),
            ]
            for arcname, data in items:
                zinfo = zipfile.ZipInfo(arcname, date_time=(2026, 1, 1, 0, 0, 0))
                zinfo.external_attr = 0o644 << 16
                zinfo.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zinfo, data)

    _write_deterministic_zip(zip_path)

    manifest_dict = {
        "raw_csv_file": raw_csv_sha256,
        "candle_stream_normalized": normalized_candles_sha256,
        "report_full_pdf": pdf_sha256,
        "trades_ledger_csv": ledger_sha256,
        "metrics_json": metrics_sha256,
        "strategy_config": config_sha256,
        "replay_py": replay_py_sha256,
        "zip_package": hashlib.sha256(zip_path.read_bytes()).hexdigest(),
    }
    return zip_path, bundle_filename, manifest_dict
