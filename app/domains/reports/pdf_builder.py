"""Pure-Python valid PDF generator and flagship XAU/USD quant research report seeder.
Zero external binary dependencies; generates valid PDF-1.4 documents readable by all PDF viewers and pypdf.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import List, Optional

from app.db import DATA, ROOT

logger = logging.getLogger("zupirus.domains.reports.pdf_builder")


def get_private_reports_dir() -> Path:
    d = DATA / "reports_private"
    try:
        d.mkdir(parents=True, exist_ok=True)
        return d
    except OSError:
        tmp = Path("/tmp/reports_private")
        tmp.mkdir(parents=True, exist_ok=True)
        return tmp


def get_public_samples_dir() -> Path:
    d = DATA / "reports_samples"
    try:
        d.mkdir(parents=True, exist_ok=True)
        return d
    except OSError:
        pass
    fallback = ROOT / "public" / "reports_samples"
    try:
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback
    except OSError:
        pass
    tmp = Path("/tmp/reports_samples")
    tmp.mkdir(parents=True, exist_ok=True)
    return tmp


def _escape_pdf_text(text: str) -> str:
    """Sanitize text to ASCII/Latin-1 safe characters for standard PDF Type1 Helvetica font."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", text or "")
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    ascii_str = ascii_str.replace("đ", "d").replace("Đ", "D")
    safe = "".join(c if 32 <= ord(c) <= 126 else " " for c in ascii_str)
    return safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf_bytes(title: str, subtitle: str, pages_lines: List[List[str]]) -> bytes:
    """Build a valid multi-page PDF-1.4 document from structured lines.
    Uses ReportLab + DejaVu for UTF-8 Vietnamese and crisp rendering when available,
    falling back to Type1 Helvetica byte stream.
    """
    if not pages_lines:
        pages_lines = [["ZUPIRUS Quant Lab - XAU/USD Research Report"]]

    try:
        from app.domains.quant.pdf_doc import _Writer, _ensure_fonts
        family = _ensure_fonts()
        writer = _Writer(family, None)
        for p_idx, lines in enumerate(pages_lines):
            writer.new_page()
            writer.heading(title)
            writer.paragraph(f"{subtitle}  ·  Trang {p_idx + 1}/{len(pages_lines)}", size=8.5)
            for line in lines:
                if not line or not line.strip():
                    continue
                clean = line.strip()
                if clean.startswith("# ") or clean.startswith("## "):
                    writer.heading(clean.lstrip("# ").strip())
                else:
                    writer.paragraph(clean)
        return writer.save()
    except Exception as e:
        logger.warning("ReportLab builder fallback: %s", e)

    objects: List[bytes] = []

    def add_obj(content: bytes) -> int:
        objects.append(content)
        return len(objects)

    # 1: Catalog, 2: Pages, 3: Font Helvetica, 4: Font Helvetica-Bold
    add_obj(b"<< /Type /Catalog /Pages 2 0 R >>")
    add_obj(b"<< /Type /Pages /Kids [] /Count 0 >>")  # placeholder
    add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    page_obj_ids: List[int] = []
    for p_idx, lines in enumerate(pages_lines):
        stream_cmds: List[str] = ["BT"]
        # Header banner
        stream_cmds.append("/F2 14 Tf")
        stream_cmds.append("50 780 Td")
        stream_cmds.append(f"({_escape_pdf_text(title)}) Tj")
        stream_cmds.append("/F1 10 Tf")
        stream_cmds.append("0 -18 Td")
        stream_cmds.append(f"({_escape_pdf_text(subtitle + f' | Page {p_idx + 1}/{len(pages_lines)}')}) Tj")
        stream_cmds.append("0 -24 Td")

        for line in lines:
            is_heading = line.startswith("# ") or line.startswith("## ")
            clean_line = line.lstrip("# ").strip()
            if is_heading:
                stream_cmds.append("/F2 11 Tf")
                stream_cmds.append("0 -18 Td")
                stream_cmds.append(f"({_escape_pdf_text(clean_line[:95])}) Tj")
                stream_cmds.append("/F1 10 Tf")
            else:
                # Wrap long lines at 92 chars
                raw = clean_line or " "
                chunks = [raw[i:i + 92] for i in range(0, len(raw), 92)] or [" "]
                for chk in chunks:
                    stream_cmds.append("0 -14 Td")
                    stream_cmds.append(f"({_escape_pdf_text(chk)}) Tj")

        stream_cmds.append("ET")
        stream_bytes = "\n".join(stream_cmds).encode("latin-1", errors="ignore")
        content_id = add_obj(
            f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("latin-1")
            + stream_bytes
            + b"\nendstream"
        )
        page_id = add_obj(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            f"/Contents {content_id} 0 R >>".encode("latin-1")
        )
        page_obj_ids.append(page_id)

    kids_str = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(page_obj_ids)} >>".encode("latin-1")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: List[int] = [0]
    for idx, obj_bytes in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{idx} 0 obj\n".encode("latin-1"))
        out.extend(obj_bytes)
        out.extend(b"\nendobj\n")

    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))

    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n".encode("latin-1")
    )
    return bytes(out)


def ensure_flagship_sample_report_seeded(c) -> Optional[str]:
    """Ensure at least 1 flagship published XAU/USD quant research report and 1 draft report exist
    with real downloadable sample PDF and private full PDF files on disk."""
    pub_dir = get_public_samples_dir()
    priv_dir = get_private_reports_dir()

    sample_file = pub_dir / "zupirus-xauusd-london-ny-microstructure-v1.0-sample.pdf"
    full_file = priv_dir / "zupirus-xauusd-london-ny-microstructure-v1.0-full.pdf"

    if not sample_file.exists():
        sample_bytes = build_pdf_bytes(
            title="ZUPIRUS QUANT LAB - XAU/USD RESEARCH PREVIEW (SAMPLE)",
            subtitle="Report: London-NY Liquidity Sweep & ATR Regime Filter (v1.0)",
            pages_lines=[
                [
                    "# 1. Executive Summary (Ban Doc Thu Mien Phi)",
                    "Bao cao nghien cuu dinh luong XAU/USD khung M15 & H1 tren du lieu lich su va kiem dinh",
                    "Walk-Forward Out-of-Sample (Rolling 120 train / 60 OOS). Tai lieu nay chi phuc vu",
                    "muc dich nghien cuu dinh luong doc lap, khong phai tin hieu giao dich tu dong.",
                    " ",
                    "# 2. Gia Thuyet Nghien Cuu & Phan Phien (Session Hypothesis)",
                    "- Thi truong muc tieu: XAU/USD (Spot Gold)",
                    "- Khung thoi gian: M15 ket hop xu huong H1 (SMA4 vs SMA16)",
                    "- Phien uu tien: London (08:00-13:00 UTC) & London/NY Overlap (13:00-17:00 UTC)",
                    "- Gia dinh chi phi giao dich (Assumed Round-trip Cost): 3.5 pips ($0.35/oz) bao gom",
                    "  spread va truot gia uoc tinh.",
                    " ",
                    "# 3. Noi Dung Trong Ban PDF Day Du",
                    "- Bo quy tac Hazard Guard & Edge Filter chi tiet theo tung phien A - Au - My.",
                    "- Thong ke Walk-Forward Out-of-Sample sau chi phi, Expectancy, Profit Factor, Drawdown.",
                    "- Bang phan ranh gioi thanh khoan 20-bar Swing High/Low va ty le rau nen (Wick Ratio).",
                ]
            ],
        )
        sample_file.write_bytes(sample_bytes)

    if not full_file.exists():
        full_bytes = build_pdf_bytes(
            title="ZUPIRUS QUANT LAB - FULL QUANTITATIVE RESEARCH REPORT",
            subtitle="XAU/USD London-NY Liquidity Sweep & Walk-Forward Analysis (v1.0)",
            pages_lines=[
                [
                    "# 1. Hypothesis & Methodology (Phuong Phap Kiem Dinh WFO)",
                    "Bao cao nay trinh bay ket qua kiem dinh Walk-Forward Optimization (120 bars In-Sample",
                    "Training / 60 bars Out-of-Sample Verification) tren XAU/USD M15 voi dieu kien loc:",
                    "1. Phien giao dich (Preferred Session): London & London/NY Overlap.",
                    "2. Cau truc H1 Trend: Khong gop chung khi thieu du lieu (tra INSUFFICIENT_EVIDENCE).",
                    "3. Mo hinh chi phi gia dinh (Assumed Cost Model): 3.5 pips/lenh ($0.35/oz).",
                    " ",
                    "# 2. Out-of-Sample Metrics & Session Breakdown",
                    "- Method: Rolling Walk-Forward 120/60 (Strictly Chronological, Zero Lookahead)",
                    "- Cost Model Assumption: 3.5 pips round-trip (Assumed Spread + Slippage)",
                    "- Stop-Loss Geometry: Dynamic ATR(14) * 1.5 | Take-Profit: 2.0R - 2.5R",
                    "- Hazard Guard: Freeze 15m before and after High-Impact USD releases (CPI, NFP, FOMC).",
                ],
                [
                    "# 3. Edge Filter & Microstructure Parameters",
                    "- Momentum Slope Threshold (10-bar M15): >= 0.20 USD/bar in direction of H1 bias.",
                    "- Liquidity Sweep Check: 20-bar Swing High/Low pierce & close-inside confirmation.",
                    "- Wick Rejection Ratio: >= 0.35 on trigger bar.",
                    "- Session Filter Enforcement: Strictly stand aside during Late NY / Pre-Asia low liquidity.",
                    " ",
                    "# 4. Research Disclaimer",
                    "Tai lieu nghien cuu dinh luong doc lap cua ZUPIRUS Quant Lab. Moi so lieu chi phi giao dich",
                    "va kiem dinh WFO deu ghi ro gia dinh nguon du lieu. Khach hang tu chu quyet dinh",
                    "khi tham khao tai lieu; ZUPIRUS khong ket noi MT5 va khong giao dich thay khach hang.",
                ],
            ],
        )
        full_file.write_bytes(full_bytes)

    now = time.time()
    rep_id = "rep_xauusd_london_ny_v1"
    slug = "bao-cao-dinh-luong-xauusd-london-ny-microstructure-v1"
    existing = c.execute("SELECT id FROM research_reports WHERE id = ? OR slug = ?", (rep_id, slug)).fetchone()
    wfo_metrics = {
        "method": "Rolling 120 Train / 60 Out-of-Sample (WFO)",
        "market": "XAU/USD",
        "timeframe": "M15 / H1",
        "preferred_session": "London",
        "cost_model_pips": 3.5,
        "cost_model_is_assumed": True,
        "cost_model_note": "Giả định chi phí khứ hồi 3.5 pips ($0.35/oz) gồm spread và trượt giá ước tính.",
        "evidence_type": "WALK_FORWARD_BACKTEST",
        "sample_size": 42,
        "win_rate": 0.57,
        "profit_factor": 1.64,
        "expectancy_price_units": 1.85,
        "net_return_after_costs": 77.7,
        "max_drawdown_pct": 3.4,
        "session_breakdown": {
            "London": {"trades": 26, "win_rate": 0.61, "net_units": 54.2},
            "London/New York Overlap": {"trades": 16, "win_rate": 0.50, "net_units": 23.5},
        },
    }
    highlights = [
        "Phân tích cấu trúc vi mô XAU/USD khung M15 kết hợp bộ lọc xu hướng H1.",
        "Kiểm định Walk-Forward ngoài mẫu (Out-of-Sample) với mô hình chi phí 3.5 pips truy vết rõ ràng.",
        "Thống kê chi tiết Expectancy, Profit Factor, Max Drawdown và phân rã hiệu suất theo từng phiên Á - Âu - Mỹ.",
        "Bộ thông số Hazard Guard (tránh nhiễu CPI/NFP/FOMC) và Edge Filter thanh khoản 20 nến.",
    ]

    if not existing:
        c.execute(
            """
            INSERT INTO research_reports (
                id, slug, title, summary, description, market, timeframe, version, status,
                price_usd, price_vnd, currency, sample_pdf_path, full_pdf_path,
                preview_highlights_json, research_candidate_id, wfo_metrics_json,
                published_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'XAU/USD', 'M15 / H1', 'v1.0', 'DISCONTINUED', ?, ?, 'VND', ?, ?, ?, NULL, ?, NULL, ?, ?)
            """,
            (
                rep_id,
                slug,
                "Báo Cáo Định Lượng XAU/USD: Cấu Trúc Thanh Khoản Phiên Âu-Mỹ & Kiểm Định Walk-Forward",
                "Nghiên cứu chuyên sâu về hành vi quét thanh khoản 20-bar Swing trên Vàng (XAU/USD) khung M15/H1, kèm kết quả kiểm định ngoài mẫu (OOS) sau chi phí 3.5 pips và bộ lọc phiên London - New York.",
                "Ấn phẩm nghiên cứu định lượng độc lập từ ZUPIRUS Quant Lab. Báo cáo trình bày trọn vẹn từ giả thuyết thị trường, quy tắc định lượng có điều kiện (Preferred Session, H1 Trend, Swept Liquidity, Wick Ratio), mô hình chi phí giao dịch giả định 3.5 pips cho tới bảng phân rã kết quả Out-of-Sample theo từng phiên giao dịch.",
                29.0,
                750000,
                str(sample_file),
                str(full_file),
                json.dumps(highlights, ensure_ascii=False),
                json.dumps(wfo_metrics, ensure_ascii=False),
                now,
                now,
            ),
        )
        # No report_versions row: this legacy placeholder stays DISCONTINUED so the
        # public catalog only shows real published methodology guides.
    else:
        # One-shot retirement of the synthetic flagship so the public catalog
        # only lists real methodology guides. Operators may re-publish for tests.
        try:
            retired = c.execute(
                "SELECT value FROM kv WHERE key = 'legacy_flagship_retired'"
            ).fetchone()
            if not retired:
                c.execute(
                    "UPDATE research_reports SET status = 'DISCONTINUED', updated_at = ? WHERE id = ? AND UPPER(status) = 'PUBLISHED'",
                    (now, rep_id),
                )
                c.execute(
                    "INSERT INTO kv (key, value) VALUES ('legacy_flagship_retired', '1') "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
                )
        except Exception:
            pass
    return rep_id
