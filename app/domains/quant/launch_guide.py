"""Seed the first real bilingual EURUSD H1 guide on first deploy.

The guide is created as DRAFT. One admin Publish action makes it public.
The full edition is never read from the public git tree; it is rendered into
private report storage from the committed candle sample + methodology.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("zupirus.launch_guide")

ROOT = Path(__file__).resolve().parents[3]
GUIDE_DIR = ROOT / "data" / "guides"
CANDLE_PATH = ROOT / "data" / "eurusd_h1_yahoo.json"
META_PATH = GUIDE_DIR / "guide-meta.json"
PREVIEW_NAME = "eurusd-h1-asia-london-preview.pdf"
FULL_NAME = "eurusd-h1-asia-london-full.pdf"

REPORT_ID = "rep_eurusd_h1_asia_london_v1"
SLUG = "eurusd-h1-asia-london-breakout-stats-v1"
PRICE_USD = 19.0
METHOD_ID = "method_eurusd_h1_asia_london_v1"


def _load_meta() -> Dict[str, Any]:
    if not META_PATH.exists():
        return {}
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def _file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _atomic_write_bytes(dest: Path, payload: bytes) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{dest.name}.", suffix=".tmp", dir=str(dest.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(payload)
        os.replace(tmp_name, dest)
    except Exception:
        try:
            Path(tmp_name).unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _atomic_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{dest.name}.", suffix=".tmp", dir=str(dest.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        shutil.copyfile(src, tmp_path)
        os.replace(tmp_path, dest)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _ensure_pdf_bytes(dest: Path, payload: bytes) -> None:
    if dest.exists() and dest.is_file():
        h = hashlib.sha256(payload).hexdigest()
        if _file_digest(dest) == h:
            return
    _atomic_write_bytes(dest, payload)


def _ensure_pdf_file(src: Path, dest: Path) -> None:
    if dest.exists() and dest.is_file() and _file_digest(dest) == _file_digest(src):
        return
    _atomic_copy(src, dest)


def _render_launch_pdfs(meta: Dict[str, Any]) -> Tuple[bytes, bytes]:
    """Build preview + full PDFs from the packaged candle sample (not from git full PDF)."""
    from app.domains.quant.candles import normalize_candles
    from app.domains.quant.methodology import build_methodology
    from app.domains.quant.service import render_bilingual_pdf
    from app.domains.quant.studies import run_studies

    if not CANDLE_PATH.exists():
        raise FileNotFoundError(f"Launch candle sample missing: {CANDLE_PATH}")
    rows = json.loads(CANDLE_PATH.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("Launch candle sample is empty")
    symbol = str(meta.get("symbol") or "EURUSD")
    timeframe = str(meta.get("timeframe") or "H1")
    cost = float(meta.get("round_trip_cost_r") or 0.05)
    candles = normalize_candles(rows)
    bundle = run_studies(candles, symbol=symbol, timeframe=timeframe, round_trip_cost_r=cost)
    doc = meta.get("document_json")
    if not isinstance(doc, dict) or doc.get("symbol") != symbol or doc.get("timeframe") != timeframe:
        doc = build_methodology(
            bundle,
            title_vi=str(meta.get("title_vi") or "EURUSD H1 Asia / London"),
            title_en=str(meta.get("title_en") or "EURUSD H1 Asia / London"),
            version="v1.0",
        )
    preview = render_bilingual_pdf(doc, preview=True)
    full = render_bilingual_pdf(doc, preview=False)
    return preview, full


def _pick_free_slug(c) -> str:
    candidates = [SLUG, f"{SLUG}-canonical", f"{SLUG}-{REPORT_ID[-6:]}"]
    for candidate in candidates:
        owner = c.execute("SELECT id FROM research_reports WHERE slug = ?", (candidate,)).fetchone()
        if not owner:
            return candidate
        owner_id = owner["id"] if hasattr(owner, "keys") else owner[0]
        if owner_id == REPORT_ID:
            return candidate
    raise RuntimeError(
        f"No free slug for launch guide {REPORT_ID}; conflicting reports occupy {candidates}"
    )


def _ensure_methodology_and_watermark(c, *, meta: Dict[str, Any], slug: str, now: float) -> None:
    title = meta.get("title_vi") or "EURUSD H1 Asia / London breakout statistics"
    description = meta.get("disclaimer_vi") or ""
    doc = meta.get("document_json") or {
        "title_vi": title,
        "title_en": meta.get("title_en") or title,
        "version": "v1.0",
        "disclaimer_vi": description,
        "disclaimer_en": meta.get("disclaimer_en") or "",
        "highlights_vi": meta.get("highlights_vi") or [],
        "highlights_en": meta.get("highlights_en") or [],
        "symbol": meta.get("symbol") or "EURUSD",
        "timeframe": meta.get("timeframe") or "H1",
    }

    c.execute("SAVEPOINT sp_launch_guide_watermark")
    try:
        c.execute(
            "UPDATE research_reports SET watermark_enabled = 1, updated_at = ? WHERE id = ?",
            (now, REPORT_ID),
        )
        c.execute("RELEASE SAVEPOINT sp_launch_guide_watermark")
    except Exception:
        c.execute("ROLLBACK TO SAVEPOINT sp_launch_guide_watermark")

    existing = c.execute("SELECT id FROM methodologies WHERE id = ?", (METHOD_ID,)).fetchone()
    c.execute("SAVEPOINT sp_launch_guide_methodology")
    try:
        if existing:
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
                    slug,
                    doc.get("title_vi") or title,
                    doc.get("title_en") or title,
                    "v1.0",
                    doc.get("disclaimer_vi") or description,
                    doc.get("disclaimer_en") or "",
                    json.dumps(doc, ensure_ascii=False),
                    PRICE_USD,
                    now,
                    METHOD_ID,
                ),
            )
        else:
            c.execute(
                """
                INSERT INTO methodologies (
                    id, study_id, report_id, slug, title_vi, title_en, version, status,
                    disclaimer_vi, disclaimer_en, document_json, price_usd, watermark_enabled,
                    created_at, updated_at
                ) VALUES (?, NULL, ?, ?, ?, ?, 'v1.0', 'DRAFT', ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    METHOD_ID,
                    REPORT_ID,
                    slug,
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
        c.execute("RELEASE SAVEPOINT sp_launch_guide_methodology")
    except Exception as exc:
        c.execute("ROLLBACK TO SAVEPOINT sp_launch_guide_methodology")
        logger.warning("Could not upsert methodologies row yet (migration pending?): %s", exc)


def ensure_launch_guide_seeded(c) -> Optional[str]:
    """Install the EURUSD H1 Asia/London methodology as a DRAFT report.

    Idempotent. Does not overwrite operator-managed price/status/paths once the
    canonical report exists. Retries missing methodology rows. Does not publish.
    """
    from app.domains.reports.pdf_builder import get_private_reports_dir, get_public_samples_dir

    meta = _load_meta()
    if not meta:
        logger.warning("Launch guide meta missing at %s; skip seed.", META_PATH)
        return None

    pub_dir = get_public_samples_dir()
    priv_dir = get_private_reports_dir()
    sample_dest = pub_dir / f"{REPORT_ID}-v1.0-sample.pdf"
    full_dest = priv_dir / f"{REPORT_ID}-v1.0-full.pdf"

    preview_src = GUIDE_DIR / PREVIEW_NAME
    try:
        if preview_src.exists() and not sample_dest.exists():
            _ensure_pdf_file(preview_src, sample_dest)
        if not sample_dest.exists() or not full_dest.exists():
            preview_bytes, full_bytes = _render_launch_pdfs(meta)
            if not sample_dest.exists():
                _ensure_pdf_bytes(sample_dest, preview_bytes)
            if not full_dest.exists():
                _ensure_pdf_bytes(full_dest, full_bytes)
    except Exception as exc:
        logger.warning("Launch guide PDF prepare failed: %s", exc)
        if not sample_dest.exists() or not full_dest.exists():
            return None

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

    by_id = c.execute(
        "SELECT id, slug, sample_pdf_path, full_pdf_path FROM research_reports WHERE id = ?",
        (REPORT_ID,),
    ).fetchone()
    if by_id:
        slug = by_id["slug"] if hasattr(by_id, "keys") else by_id[1]
        # Repair missing files only; do not overwrite operator price/status.
        if not sample_dest.exists() or not full_dest.exists():
            try:
                preview_bytes, full_bytes = _render_launch_pdfs(meta)
                if not sample_dest.exists():
                    _ensure_pdf_bytes(sample_dest, preview_bytes)
                if not full_dest.exists():
                    _ensure_pdf_bytes(full_dest, full_bytes)
            except Exception as exc:
                logger.warning("Launch guide PDF repair failed: %s", exc)
        # Retry methodology/watermark if incomplete.
        method = c.execute("SELECT id FROM methodologies WHERE id = ?", (METHOD_ID,)).fetchone()
        if not method:
            _ensure_methodology_and_watermark(c, meta=meta, slug=str(slug or SLUG), now=now)
        return REPORT_ID

    slug = _pick_free_slug(c)
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
            slug,
            title,
            summary,
            description,
            PRICE_USD,
            int(round(PRICE_USD * 25500)),
            str(sample_dest),
            str(full_dest),
            json.dumps(highlights, ensure_ascii=False),
            json.dumps(wfo_metrics, ensure_ascii=False),
            now,
            now,
        ),
    )
    _ensure_methodology_and_watermark(c, meta=meta, slug=slug, now=now)
    return REPORT_ID
