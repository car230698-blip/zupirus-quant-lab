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

    ver_str = d.get("version") or "v1.0"
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
        "status": str(d.get("status") or "DRAFT").upper(),
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
        "can_purchase": is_commercial_reports_sale_enabled() and (str(d.get("status") or "").upper() == "PUBLISHED"),
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
    """Return strictly PUBLISHED research reports for public catalog browsing."""
    with tx() as c:
        ensure_flagship_sample_report_seeded(c)
        rows = c.execute(
            """
            SELECT * FROM research_reports
            WHERE UPPER(status) = 'PUBLISHED'
            ORDER BY COALESCE(published_at, created_at) DESC, id DESC
            """
        ).fetchall()
        return [_format_report_row(r, include_private_paths=False) for r in rows]


def get_public_report_detail(report_id_or_slug: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Return detail for a single PUBLISHED report (or DISCONTINUED if user already owns an entitlement)."""
    key = (report_id_or_slug or "").strip()
    if not key:
        return None
    with tx() as c:
        ensure_flagship_sample_report_seeded(c)
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
        rep["can_purchase"] = is_commercial_reports_sale_enabled() and (st == "PUBLISHED")
        return rep


def list_admin_reports() -> List[Dict[str, Any]]:
    """Admin: List all reports across DRAFT, READY_FOR_REVIEW, APPROVED, PUBLISHED, DISCONTINUED."""
    with tx() as c:
        ensure_flagship_sample_report_seeded(c)
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
    eff_usd = round(max(1.0, float(price_usd or 29.0)), 2)
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
            title=f"ZUPIRUS QUANT LAB - FULL RESEARCH REPORT ({version})",
            subtitle=f"{title} | Market: {market} ({timeframe})",
            pages_lines=[
                [
                    "# 1. Research Summary & Hypothesis",
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
            c.execute(
                """
                INSERT INTO report_versions (
                    id, report_id, version, full_pdf_path, sample_pdf_path, changelog, wfo_metrics_json, published_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(report_id, version) DO UPDATE SET
                    full_pdf_path = excluded.full_pdf_path,
                    sample_pdf_path = excluded.sample_pdf_path,
                    wfo_metrics_json = excluded.wfo_metrics_json
                """,
                (
                    f"ver_{real_id}_{_slugify(new_version)}",
                    real_id,
                    new_version,
                    full_path,
                    sample_path,
                    updates.get("changelog") or f"Updated {new_version}",
                    wfo_json,
                    now,
                    now,
                ),
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


def publish_admin_report(report_id: str, version: Optional[str] = None, changelog: Optional[str] = None, admin_id: str = "admin") -> Dict[str, Any]:
    """Admin: Approve and publish a report (or a new version of a report).
    Requires a valid full PDF file to exist before publishing."""
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

        c.execute(
            """
            UPDATE research_reports
            SET status = 'PUBLISHED', version = ?, full_pdf_path = ?, published_at = COALESCE(published_at, ?), updated_at = ?
            WHERE id = ?
            """,
            (eff_ver, full_path, now, now, real_id),
        )
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
        audit(c, admin_id, "research_report_published", {"report_id": real_id, "version": eff_ver})
        updated = c.execute("SELECT * FROM research_reports WHERE id = ?", (real_id,)).fetchone()
        return _format_report_row(updated, include_private_paths=True)


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

    if not is_commercial_reports_sale_enabled():
        fail(400, "Cổng mua trực tuyến đang tạm tắt. Các báo cáo hiện tại đang trong giai đoạn tiền thẩm định và đọc thử miễn phí.")

    now_ts = time.time()
    method_u = str(payment_method or "USDT").strip().upper()
    if method_u in ("SEPAY", "VIETQR", "VND"):
        fail(400, "Cổng thanh toán SePay / VietQR đã ngừng hoạt động. Vui lòng thanh toán mặc định bằng USDT (BEP20 hoặc TRC20).")

    from app.domains.billing.crypto_direct import (
        allocate_unique_usdt_amount,
        get_crypto_wallets_config,
    )
    crypto_cfg = get_crypto_wallets_config()
    if "TRC20" in method_u:
        network = "TRC20"
    else:
        network = "BEP20" if crypto_cfg.get("bep20_address") or not crypto_cfg.get("trc20_address") else "TRC20"

    wallet_address = crypto_cfg.get("trc20_address") if network == "TRC20" else crypto_cfg.get("bep20_address")
    if not wallet_address:
        wallet_address = "0x55d398326f99059fF775485246999027B3197955"

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
        if rep_status == "DISCONTINUED":
            fail(400, "Báo cáo này đã ngừng phát hành đơn mới.")
        if rep_status != "PUBLISHED":
            fail(400, "Báo cáo này chưa được xuất bản công khai.")

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


def grant_report_entitlement_tx(c, order: Dict[str, Any], now_ts: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Atomically grant exactly-once download entitlement for the purchased report & version inside an existing DB transaction.
    Idempotent against duplicate webhooks or retries."""
    now = float(now_ts if now_ts is not None else time.time())
    order_id = str(order["id"])
    user_id = str(order["user_id"])
    rep_id = str(order.get("report_id") or "").strip()
    if not rep_id and str(order.get("plan_tier") or "").startswith("report:"):
        rep_id = str(order["plan_tier"]).split("report:", 1)[1].strip()
    if not rep_id:
        return None

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
        if ent_d.get("status") != "ACTIVE":
            c.execute(
                "UPDATE report_entitlements SET status = 'ACTIVE', order_id = ?, full_pdf_path = ?, granted_at = ?, revoked_at = NULL WHERE id = ?",
                (order_id, locked_pdf_path, now, ent_d["id"]),
            )
            ent_d["status"] = "ACTIVE"
        c.execute(
            "UPDATE orders SET entitlement_status = 'GRANTED', cloud_deploy_status = 'NOT_APPLICABLE' WHERE id = ?",
            (order_id,),
        )
        return ent_d

    ent_id = f"ent_{secrets.token_hex(8)}"
    c.execute(
        """
        INSERT INTO report_entitlements (
            id, user_id, report_id, purchased_version, full_pdf_path, order_id, status, granted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL)
        ON CONFLICT(order_id) DO NOTHING
        """,
        (ent_id, user_id, rep_id, purchased_ver, locked_pdf_path, order_id, now),
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
    Legacy signal subscriptions are NEVER converted into PDF entitlements."""
    with tx() as c:
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
        for r in rows:
            d = dict(r)
            ent_id = d["entitlement_id"]
            rep_id = d["report_id"]
            ver = d["purchased_version"]
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
                "granted_at": float(d.get("granted_at") or time.time()),
                "download_url": f"/api/v1/reports/{rep_id}/download?version={quote(str(ver))}",
            })
        return items


def verify_user_report_download_access(
    user_id: str,
    user_role: str,
    report_id: str,
    version: Optional[str] = None,
) -> Tuple[Path, str, str]:
    """Strictly verify that `user_id` holds an ACTIVE entitlement for `(report_id, version)` (or is admin).
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
    raw = os.getenv("SECRET_KEY") or os.getenv("ZUPIRUS_SECRET") or "zupirus-quant-lab-report-download-secret"
    return raw.encode("utf-8")


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
