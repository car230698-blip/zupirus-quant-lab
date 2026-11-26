"""Store OHLC, run studies, and publish a methodology as a draft PDF report."""
from __future__ import annotations

import json
import secrets
import time
from io import BytesIO
from typing import Any, Dict, List, Optional

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    PdfReader = None  # type: ignore[misc,assignment]
    PdfWriter = None  # type: ignore[misc,assignment]

from app.core.db import insert_timescale_candle, to_epoch_ts
from app.db import audit, tx
from app.domains.quant.candles import normalize_candles
from app.domains.quant.methodology import build_methodology
from app.domains.quant.pdf_doc import build_methodology_pdf
from app.domains.quant.studies import run_studies
from app.domains.reports.service import create_admin_report_draft


def merge_pdfs(parts: List[bytes]) -> bytes:
    writer = PdfWriter()
    for part in parts:
        reader = PdfReader(BytesIO(part))
        for page in reader.pages:
            writer.add_page(page)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def render_bilingual_pdf(document: Dict[str, Any], *, preview: bool = False, watermark: Optional[str] = None) -> bytes:
    vi = build_methodology_pdf(document, lang="vi", preview=preview, watermark=watermark)
    en = build_methodology_pdf(document, lang="en", preview=preview, watermark=watermark)
    return merge_pdfs([vi, en])


_RESERVED_LIVE_SOURCES = frozenset({
    "MARKET_LIVE",
    "LIVE_FEED",
    "METAAPI",
    "DEMO",
    "REPLAY",
})


def ingest_candles(rows: List[Dict[str, Any]], *, symbol: str, timeframe: str, source: str = "QUANT_IMPORT") -> int:
    src = (source or "QUANT_IMPORT").strip() or "QUANT_IMPORT"
    if src.upper() in _RESERVED_LIVE_SOURCES:
        raise ValueError(
            f"Research imports cannot use live-feed source '{src}'. "
            "Use QUANT_IMPORT or another research-only source name."
        )
    candles = normalize_candles(rows)
    sym = symbol.upper().replace("/", "")
    tf = timeframe.upper()
    with tx() as c:
        for candle in candles:
            insert_timescale_candle(
                c,
                symbol=sym,
                timeframe=tf,
                ts=float(candle.time),
                open_p=candle.open,
                high_p=candle.high,
                low_p=candle.low,
                close_p=candle.close,
                volume=candle.volume,
                source=src,
                replace_ohlcv=True,
            )
    return len(candles)


def load_candles(*, symbol: str, timeframe: str, source: Optional[str] = None, limit: int = 20000) -> List[Dict[str, Any]]:
    sym = symbol.upper().replace("/", "")
    tf = timeframe.upper()
    cap = max(10, min(int(limit or 20000), 100000))
    with tx() as c:
        if source:
            rows = c.execute(
                """
                SELECT time, open, high, low, close, volume
                FROM candles
                WHERE symbol = ? AND timeframe = ? AND source = ?
                ORDER BY time ASC
                LIMIT ?
                """,
                (sym, tf, source, cap),
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT time, open, high, low, close, volume
                FROM candles
                WHERE symbol = ? AND timeframe = ?
                ORDER BY time ASC
                LIMIT ?
                """,
                (sym, tf, cap),
            ).fetchall()
    out = []
    for row in rows:
        data = dict(row) if hasattr(row, "keys") else {
            "time": row[0], "open": row[1], "high": row[2], "low": row[3], "close": row[4], "volume": row[5],
        }
        out.append({
            "time": int(to_epoch_ts(data["time"])),
            "open": float(data["open"]),
            "high": float(data["high"]),
            "low": float(data["low"]),
            "close": float(data["close"]),
            "volume": float(data.get("volume") or 0),
        })
    return out


def _column_names(c, table: str) -> List[str]:
    try:
        info = c.execute(f"PRAGMA table_info({table})").fetchall()
        if info:
            return [str(row[1]) for row in info]
    except Exception:
        pass
    try:
        info = c.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = ?
            """,
            (table,),
        ).fetchall()
        return [str(row[0]) for row in info]
    except Exception:
        return []


def create_methodology_from_candles(
    rows: List[Dict[str, Any]],
    *,
    symbol: str,
    timeframe: str,
    title_vi: str,
    title_en: str,
    price_usd: float,
    strategy_name: str = "breakout_retest",
    admin_id: str = "admin",
    version: str = "v1.0",
    price_vnd: Optional[int] = None,
    round_trip_cost_r: float = 0.0,
    source: str = "QUANT_IMPORT",
    store_candles: bool = True,
) -> Dict[str, Any]:
    """Ingest candles, compute studies, write bilingual PDFs, and open a DRAFT report.

    Publishing stays a separate admin action. Price is whatever the caller sets.
    """
    if price_usd is None or float(price_usd) <= 0:
        raise ValueError("price_usd is required and must be positive. The owner sets the price.")
    canonical_source = (source or "QUANT_IMPORT").strip() or "QUANT_IMPORT"
    bundle = run_studies(
        rows,
        symbol=symbol,
        timeframe=timeframe,
        strategy_name=strategy_name,
        round_trip_cost_r=round_trip_cost_r,
    )
    from app.domains.ai.report_writer import generate_research_report
    ai_report = generate_research_report(bundle, use_gemini=True)
    document = build_methodology(bundle, title_vi=title_vi, title_en=title_en, version=version, ai_report=ai_report)
    if store_candles:
        ingest_candles(rows, symbol=symbol, timeframe=timeframe, source=canonical_source)

    rule_study = next((s for s in bundle.get("studies", []) if str(s.get("id", "")).startswith("rule_backtest")), {})
    metrics_tbl = {row[0]: row[1] for row in rule_study.get("table", {}).get("rows", [])} if rule_study else {}

    summary = document["highlights_vi"][0] + " " + document["highlights_vi"][2]
    draft = create_admin_report_draft(
        title=title_vi,
        summary=summary,
        description=document["disclaimer_vi"],
        market=bundle["symbol"],
        timeframe=bundle["timeframe"],
        version=version,
        price_usd=float(price_usd),
        price_vnd=price_vnd,
        preview_highlights=document["highlights_vi"],
        wfo_metrics={
            "evidence_type": "QUANT_STUDY_BACKTEST",
            "sample_size": bundle["candle_count"],
            "trades_count": rule_study.get("sample_size"),
            "win_rate": metrics_tbl.get("win_rate"),
            "profit_factor": metrics_tbl.get("profit_factor"),
            "max_drawdown": metrics_tbl.get("max_drawdown_r"),
            "sharpe_ratio": metrics_tbl.get("sharpe_ratio"),
            "sortino_ratio": metrics_tbl.get("sortino_ratio"),
            "calmar_ratio": metrics_tbl.get("calmar_ratio"),
            "t_statistic": metrics_tbl.get("t_statistic"),
            "p_value": metrics_tbl.get("p_value"),
            "cost_model_r": round_trip_cost_r,
            "cost_model_is_assumed": True,
            "cost_model_note": "Chi phí khứ hồi R là tham số của quy tắc kiểm tra trên mẫu lịch sử.",
            "data_source": canonical_source,
        },
        admin_id=admin_id,
    )
    preview = render_bilingual_pdf(document, preview=True)
    full = render_bilingual_pdf(document, preview=False)
    sample_path = draft.get("sample_pdf_path")
    full_path = draft.get("full_pdf_path")
    if sample_path:
        from pathlib import Path
        Path(sample_path).write_bytes(preview)
    if full_path:
        from pathlib import Path
        Path(full_path).write_bytes(full)

    now = time.time()
    study_id = f"study_{secrets.token_hex(6)}"
    method_id = f"method_{secrets.token_hex(6)}"
    with tx() as c:
        c.execute(
            """
            INSERT INTO quant_studies (
                id, symbol, timeframe, source, params_json, result_json, candle_count,
                range_start, range_end, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                study_id,
                bundle["symbol"],
                bundle["timeframe"],
                canonical_source,
                json.dumps(bundle["parameters"]),
                json.dumps(bundle["studies"]),
                bundle["candle_count"],
                bundle["range_start"],
                bundle["range_end"],
                admin_id,
                now,
            ),
        )
        c.execute(
            """
            INSERT INTO methodologies (
                id, study_id, report_id, slug, title_vi, title_en, version, status,
                disclaimer_vi, disclaimer_en, document_json, price_usd, watermark_enabled,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                method_id,
                study_id,
                draft["id"],
                draft.get("slug"),
                document["title_vi"],
                document["title_en"],
                version,
                document["disclaimer_vi"],
                document["disclaimer_en"],
                json.dumps(document),
                float(price_usd),
                now,
                now,
            ),
        )
        cols = _column_names(c, "research_reports")
        if "watermark_enabled" in cols:
            c.execute(
                "UPDATE research_reports SET watermark_enabled = 1, updated_at = ? WHERE id = ?",
                (now, draft["id"]),
            )
        audit(c, admin_id, "methodology_draft_created", {
            "methodology_id": method_id,
            "study_id": study_id,
            "report_id": draft["id"],
        })
    return {
        "study_id": study_id,
        "methodology_id": method_id,
        "report_id": draft["id"],
        "slug": draft.get("slug"),
        "status": "DRAFT",
        "price_usd": float(price_usd),
        "candle_count": bundle["candle_count"],
        "symbol": bundle["symbol"],
        "timeframe": bundle["timeframe"],
        "highlights": document["highlights_vi"],
        "watermark_enabled": True,
    }


def list_studies(limit: int = 50) -> List[Dict[str, Any]]:
    with tx() as c:
        rows = c.execute(
            """
            SELECT id, symbol, timeframe, source, candle_count, range_start, range_end, created_by, created_at
            FROM quant_studies
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (max(1, min(limit, 200)),),
        ).fetchall()
    return [dict(row) if hasattr(row, "keys") else {
        "id": row[0], "symbol": row[1], "timeframe": row[2], "source": row[3],
        "candle_count": row[4], "range_start": row[5], "range_end": row[6],
        "created_by": row[7], "created_at": row[8],
    } for row in rows]


def get_study(study_id: str) -> Optional[Dict[str, Any]]:
    with tx() as c:
        row = c.execute(
            """
            SELECT id, symbol, timeframe, source, params_json, result_json, candle_count, range_start, range_end, created_by, created_at
            FROM quant_studies
            WHERE id = ?
            """,
            (study_id,),
        ).fetchone()
    if not row:
        return None
    data = dict(row) if hasattr(row, "keys") else {
        "id": row[0], "symbol": row[1], "timeframe": row[2], "source": row[3],
        "params_json": row[4], "result_json": row[5], "candle_count": row[6],
        "range_start": row[7], "range_end": row[8], "created_by": row[9], "created_at": row[10],
    }
    try:
        data["parameters"] = json.loads(data.get("params_json") or "{}")
    except Exception:
        data["parameters"] = {}
    try:
        data["studies"] = json.loads(data.get("result_json") or "[]")
    except Exception:
        data["studies"] = []
    return data


def list_buyers(limit: int = 200) -> List[Dict[str, Any]]:
    with tx() as c:
        rows = c.execute(
            """
            SELECT u.email, e.report_id, r.title, e.purchased_version, e.status,
                   e.granted_at, e.order_id, o.status AS order_status,
                   o.expected_amount_usdt, o.payment_gateway, o.amount_usd
            FROM report_entitlements e
            JOIN users u ON u.id = e.user_id
            JOIN research_reports r ON r.id = e.report_id
            LEFT JOIN orders o ON o.id = e.order_id
            ORDER BY e.granted_at DESC
            LIMIT ?
            """,
            (max(1, min(limit, 500)),),
        ).fetchall()
    items = []
    for row in rows:
        data = dict(row) if hasattr(row, "keys") else {}
        if not data:
            continue
        items.append({
            "email": data.get("email"),
            "report_id": data.get("report_id"),
            "title": data.get("title"),
            "purchased_version": data.get("purchased_version"),
            "entitlement_status": data.get("status"),
            "granted_at": data.get("granted_at"),
            "order_id": data.get("order_id"),
            "order_status": data.get("order_status"),
            "amount_usd": data.get("amount_usd"),
            "expected_amount_usdt": data.get("expected_amount_usdt"),
            "payment_gateway": data.get("payment_gateway"),
        })
    return items


def list_pdf_orders(limit: int = 200) -> List[Dict[str, Any]]:
    with tx() as c:
        rows = c.execute(
            """
            SELECT o.id, o.user_id, u.email, o.report_id, o.report_version, o.amount_usd,
                   o.expected_amount_usdt, o.payment_gateway, o.status, o.created_at, r.title
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            LEFT JOIN research_reports r ON r.id = o.report_id
            WHERE UPPER(COALESCE(o.product_type, '')) = 'PDF_REPORT'
            ORDER BY o.created_at DESC
            LIMIT ?
            """,
            (max(1, min(limit, 500)),),
        ).fetchall()
    return [dict(row) if hasattr(row, "keys") else {} for row in rows]


def load_methodology_document(report_id: str) -> Optional[Dict[str, Any]]:
    with tx() as c:
        row = c.execute(
            """
            SELECT document_json, watermark_enabled
            FROM methodologies
            WHERE report_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (report_id,),
        ).fetchone()
    if not row:
        return None
    data = dict(row) if hasattr(row, "keys") else {"document_json": row[0], "watermark_enabled": row[1]}
    try:
        document = json.loads(data["document_json"])
    except Exception:
        return None
    document["_watermark_enabled"] = bool(data.get("watermark_enabled", 1))
    return document
