"""Seed the first real bilingual EURUSD H1 guide on first deploy.

The guide is created as DRAFT. One admin Publish action makes it public.
"""
from __future__ import annotations

import json
import logging
import shutil
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("zupirus.launch_guide")

ROOT = Path(__file__).resolve().parents[3]
GUIDE_DIR = ROOT / "data" / "guides"
META_PATH = GUIDE_DIR / "guide-meta.json"
PREVIEW_NAME = "eurusd-h1-asia-london-preview.pdf"
FULL_NAME = "eurusd-h1-asia-london-full.pdf"

REPORT_ID = "rep_eurusd_h1_asia_london_v1"
SLUG = "eurusd-h1-asia-london-breakout-stats-v1"
PRICE_USD = 19.0


def _load_meta() -> Dict[str, Any]:
    if not META_PATH.exists():
        return {}
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def ensure_launch_guide_seeded(c) -> Optional[str]:
    """Install the EURUSD H1 Asia/London methodology as a DRAFT report.

    Idempotent. Does not publish. Admin must publish from the portal
    (POST /api/v1/admin/reports/rep_eurusd_h1_asia_london_v1/publish).
    """
    from app.domains.reports.pdf_builder import get_private_reports_dir, get_public_samples_dir

    meta = _load_meta()
    if not meta:
        logger.warning("Launch guide meta missing at %s; skip seed.", META_PATH)
        return None

    preview_src = GUIDE_DIR / PREVIEW_NAME
    full_src = GUIDE_DIR / FULL_NAME
    if not preview_src.exists() or not full_src.exists():
        logger.warning("Launch guide PDFs missing under %s; skip seed.", GUIDE_DIR)
        return None

    pub_dir = get_public_samples_dir()
    priv_dir = get_private_reports_dir()
    sample_dest = pub_dir / f"{REPORT_ID}-v1.0-sample.pdf"
    full_dest = priv_dir / f"{REPORT_ID}-v1.0-full.pdf"
    if not sample_dest.exists() or sample_dest.stat().st_size != preview_src.stat().st_size:
        shutil.copy2(preview_src, sample_dest)
    if not full_dest.exists() or full_dest.stat().st_size != full_src.stat().st_size:
        shutil.copy2(full_src, full_dest)

    now = time.time()
    title = meta.get("title_vi") or "EURUSD H1 Asia / London breakout statistics"
    summary = " ".join((meta.get("highlights_vi") or [])[:2]) or title
    description = meta.get("disclaimer_vi") or ""
    highlights = meta.get("highlights_vi") or []
    wfo_metrics = {
        "evidence_type": "DESCRIPTIVE_STATISTICS",
        "sample_size": meta.get("candle_count"),
        "symbol": meta.get("symbol", "EURUSD"),
        "timeframe": meta.get("timeframe", "H1"),
        "source": meta.get("source", "YAHOO_FINANCE"),
        "range_start": meta.get("range_start"),
        "range_end": meta.get("range_end"),
        "round_trip_cost_r": meta.get("round_trip_cost_r", 0.05),
        "cost_model_is_assumed": True,
        "cost_model_note": "Round-trip cost is a parameter of the historical rule study, not a measured broker invoice.",
        "key_stats": meta.get("key_stats") or {},
        "launch_price_usdt": PRICE_USD,
        "launch_price_rationale": "19 USDT: modest one-time price for a multi-year H1 methodology PDF with bilingual tables and charts.",
    }

    existing = c.execute(
        "SELECT id, status FROM research_reports WHERE id = ? OR slug = ?",
        (REPORT_ID, SLUG),
    ).fetchone()
    if existing:
        existing_id = existing["id"] if hasattr(existing, "keys") else existing[0]
        # Keep operator publish status; refresh files and price metadata only.
        c.execute(
            """
            UPDATE research_reports
            SET sample_pdf_path = ?, full_pdf_path = ?, price_usd = ?,
                preview_highlights_json = ?, wfo_metrics_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                str(sample_dest),
                str(full_dest),
                PRICE_USD,
                json.dumps(highlights, ensure_ascii=False),
                json.dumps(wfo_metrics, ensure_ascii=False),
                now,
                existing_id,
            ),
        )
    else:
        c.execute(
            """
            INSERT INTO research_reports (
                id, slug, title, summary, description, market, timeframe, version, status,
                price_usd, price_vnd, currency, sample_pdf_path, full_pdf_path,
                preview_highlights_json, research_candidate_id, wfo_metrics_json,
                published_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'EURUSD', 'H1', 'v1.0', 'DRAFT', ?, ?, 'USD', ?, ?, ?, NULL, ?, NULL, ?, ?)
            """,
            (
                REPORT_ID,
                SLUG,
                title,
                summary,
                description,
                PRICE_USD,
                int(round(PRICE_USD * 25500)),  # illustrative VND mirror; checkout uses USDT
                str(sample_dest),
                str(full_dest),
                json.dumps(highlights, ensure_ascii=False),
                json.dumps(wfo_metrics, ensure_ascii=False),
                now,
                now,
            ),
        )

    # Best-effort watermark flag (column added in migration 029).
    try:
        c.execute(
            "UPDATE research_reports SET watermark_enabled = 1, updated_at = ? WHERE id = ?",
            (now, REPORT_ID),
        )
    except Exception:
        pass

    # Methodology row for bilingual document JSON
    doc = meta.get("document_json") or {
        "title_vi": title,
        "title_en": meta.get("title_en") or title,
        "version": "v1.0",
        "disclaimer_vi": description,
        "disclaimer_en": meta.get("disclaimer_en") or "",
        "highlights_vi": highlights,
        "highlights_en": meta.get("highlights_en") or [],
    }
    method_id = "method_eurusd_h1_asia_london_v1"
    method_existing = c.execute("SELECT id FROM methodologies WHERE id = ?", (method_id,)).fetchone()
    if method_existing:
        c.execute(
            """
            UPDATE methodologies
            SET report_id = ?, slug = ?, title_vi = ?, title_en = ?, version = ?,
                disclaimer_vi = ?, disclaimer_en = ?, document_json = ?, price_usd = ?,
                watermark_enabled = 1, updated_at = ?
            WHERE id = ?
            """,
            (
                REPORT_ID,
                SLUG,
                doc.get("title_vi") or title,
                doc.get("title_en") or title,
                "v1.0",
                doc.get("disclaimer_vi") or description,
                doc.get("disclaimer_en") or "",
                json.dumps(doc, ensure_ascii=False),
                PRICE_USD,
                now,
                method_id,
            ),
        )
    else:
        try:
            c.execute(
                """
                INSERT INTO methodologies (
                    id, study_id, report_id, slug, title_vi, title_en, version, status,
                    disclaimer_vi, disclaimer_en, document_json, price_usd, watermark_enabled,
                    created_at, updated_at
                ) VALUES (?, NULL, ?, ?, ?, ?, 'v1.0', 'DRAFT', ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    method_id,
                    REPORT_ID,
                    SLUG,
                    doc.get("title_vi") or title,
                    doc.get("title_en") or title,
                    doc.get("disclaimer_vi") or description,
                    doc.get("disclaimer_en") or "",
                    json.dumps(doc, ensure_ascii=False),
                    PRICE_USD,
                    now,
                    now,
                ),
            )
        except Exception as exc:
            logger.warning("Could not insert methodologies row yet (migration pending?): %s", exc)

    return REPORT_ID
