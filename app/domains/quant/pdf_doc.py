"""Branded methodology PDFs with embedded charts, a disclaimer, and an optional buyer watermark.

Vietnamese text uses DejaVu Sans, which covers the Latin accents used in Vietnamese.
If the font file is missing, the builder falls back to Helvetica and strips accents
so the file still opens.
"""
from __future__ import annotations

import unicodedata
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_DIR = Path(__file__).resolve().parent / "fonts"
PAGE_W, PAGE_H = A4
INK = HexColor("#102033")
TEAL = HexColor("#0F766E")
MUTED = HexColor("#475569")
RULE = HexColor("#D6DEE8")
BAR = HexColor("#0F766E")
NEG = HexColor("#B45309")

_FONTS_READY = False


def _ascii_fold(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return stripped.replace("đ", "d").replace("Đ", "D")


def _ensure_fonts() -> str:
    global _FONTS_READY
    regular = FONT_DIR / "DejaVuSans.ttf"
    bold = FONT_DIR / "DejaVuSans-Bold.ttf"
    if regular.is_file() and bold.is_file():
        if not _FONTS_READY:
            pdfmetrics.registerFont(TTFont("DejaVu", str(regular)))
            pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(bold)))
            _FONTS_READY = True
        return "DejaVu"
    return "Helvetica"


def _font(family: str, bold: bool = False) -> str:
    if family == "DejaVu":
        return "DejaVu-Bold" if bold else "DejaVu"
    return "Helvetica-Bold" if bold else "Helvetica"


def _text(value: Any, family: str) -> str:
    raw = "" if value is None else str(value)
    raw = raw.replace("\t", " ")
    if family == "Helvetica":
        raw = _ascii_fold(raw)
        raw = "".join(ch if 32 <= ord(ch) <= 126 else " " for ch in raw)
    return raw


def _wrap(text: str, font_name: str, size: float, width: float) -> List[str]:
    words = text.split()
    if not words:
        return [""]
    lines: List[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if pdfmetrics.stringWidth(trial, font_name, size) <= width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


class _Writer:
    def __init__(self, family: str, watermark: Optional[str]):
        self.family = family
        self.watermark = (watermark or "").strip()
        self.buffer = BytesIO()
        self.canvas = canvas.Canvas(self.buffer, pagesize=A4, pageCompression=0)
        self.canvas.setTitle("ZUPIRUS Quant Lab")
        self.y = PAGE_H - 22 * mm
        self.page = 1

    def _draw_chrome(self) -> None:
        c = self.canvas
        c.setFillColor(TEAL)
        c.rect(0, PAGE_H - 12 * mm, PAGE_W, 12 * mm, fill=1, stroke=0)
        c.setFillColor(HexColor("#F8FFFE"))
        c.setFont(_font(self.family, True), 9)
        c.drawString(16 * mm, PAGE_H - 8 * mm, _text("ZUPIRUS QUANT LAB  ·  educational research", self.family))
        c.setFillColor(MUTED)
        c.setFont(_font(self.family, False), 8)
        c.drawRightString(PAGE_W - 16 * mm, 10 * mm, _text(f"{self.page}", self.family))
        c.setStrokeColor(RULE)
        c.line(16 * mm, 14 * mm, PAGE_W - 16 * mm, 14 * mm)
        if self.watermark:
            c.saveState()
            c.setFillColor(Color(0.45, 0.52, 0.58, alpha=0.18))
            c.translate(PAGE_W / 2, PAGE_H / 2)
            c.rotate(32)
            c.setFont(_font(self.family, True), 11)
            label = _text(f"Licensed copy  ·  {self.watermark}  ·  not for redistribution", self.family)
            c.drawCentredString(0, 0, label[:140])
            c.restoreState()

    def new_page(self) -> None:
        if self.page > 1 or self.y < PAGE_H - 23 * mm:
            self.canvas.showPage()
            self.page += 1
        self._draw_chrome()
        self.y = PAGE_H - 22 * mm

    def ensure(self, needed: float) -> None:
        if self.y - needed < 20 * mm:
            self.new_page()

    def heading(self, text: str) -> None:
        self.ensure(16 * mm)
        self.canvas.setFillColor(INK)
        self.canvas.setFont(_font(self.family, True), 13)
        self.canvas.drawString(16 * mm, self.y, _text(text, self.family)[:110])
        self.y -= 7 * mm

    def paragraph(self, text: str, size: float = 9.5, color=INK) -> None:
        font_name = _font(self.family, False)
        for block in str(text).split("\n"):
            lines = _wrap(_text(block, self.family), font_name, size, PAGE_W - 32 * mm)
            for line in lines:
                self.ensure(6 * mm)
                self.canvas.setFillColor(color)
                self.canvas.setFont(font_name, size)
                self.canvas.drawString(16 * mm, self.y, line)
                self.y -= 4.6 * mm
        self.y -= 1.5 * mm

    def bar_chart(self, chart: Dict[str, Any]) -> None:
        labels: Sequence[Any] = chart.get("labels") or []
        values: Sequence[Any] = chart.get("values") or []
        pairs = [(str(label), float(value or 0)) for label, value in zip(labels, values)]
        pairs = pairs[:24]
        if not pairs:
            return
        self.ensure(62 * mm)
        self.paragraph(str(chart.get("title") or "Chart"), size=10)
        left = 16 * mm
        width = PAGE_W - 32 * mm
        height = 42 * mm
        bottom = self.y - height
        self.canvas.setStrokeColor(RULE)
        self.canvas.line(left, bottom, left + width, bottom)
        peak = max(abs(v) for _, v in pairs) or 1.0
        slot = width / len(pairs)
        bar_w = max(2.0, slot * 0.62)
        for index, (label, value) in enumerate(pairs):
            bar_h = (abs(value) / peak) * (height - 8 * mm)
            x = left + index * slot + (slot - bar_w) / 2
            self.canvas.setFillColor(BAR if value >= 0 else NEG)
            self.canvas.rect(x, bottom, bar_w, max(bar_h, 0.4), fill=1, stroke=0)
            self.canvas.setFillColor(MUTED)
            self.canvas.setFont(_font(self.family, False), 6.5)
            self.canvas.drawCentredString(x + bar_w / 2, bottom - 3.2 * mm, _text(label, self.family)[:8])
        self.y = bottom - 8 * mm

    def line_chart(self, chart: Dict[str, Any]) -> None:
        title = str(chart.get("title") or "Cumulative Equity Curve (R)")
        raw_vals = chart.get("values") or []
        values = [float(v or 0) for v in raw_vals]
        if not values:
            return
        self.ensure(65 * mm)
        self.paragraph(title, size=10, color=INK)
        left = 16 * mm
        width = PAGE_W - 32 * mm
        height = 40 * mm
        bottom = self.y - height

        c = self.canvas
        c.setFillColor(HexColor("#F8FAFC"))
        c.rect(left, bottom, width, height, fill=1, stroke=0)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.rect(left, bottom, width, height, fill=0, stroke=1)

        min_v = min(values)
        max_v = max(values)
        span = max(0.001, max_v - min_v)
        pad = span * 0.1
        min_y = min_v - pad
        max_y = max_v + pad
        y_range = max_y - min_y

        if min_y <= 0 <= max_y:
            zero_y = bottom + ((0.0 - min_y) / y_range) * height
            c.setStrokeColor(HexColor("#CBD5E1"))
            c.setLineWidth(0.6)
            c.line(left, zero_y, left + width, zero_y)
            c.setFillColor(MUTED)
            c.setFont(_font(self.family, False), 6.5)
            c.drawRightString(left - 1.5 * mm, zero_y - 2, "0.0R")

        for q in (0.25, 0.50, 0.75):
            gy = bottom + q * height
            val_at_q = min_y + q * y_range
            c.setStrokeColor(HexColor("#E2E8F0"))
            c.setLineWidth(0.4)
            c.line(left, gy, left + width, gy)
            c.setFillColor(MUTED)
            c.setFont(_font(self.family, False), 6.0)
            c.drawRightString(left - 1.5 * mm, gy - 2, f"{val_at_q:+.1f}R")

        n = len(values)
        points = []
        for i, val in enumerate(values):
            px = left + (i / max(1, n - 1)) * width
            py = bottom + ((val - min_y) / y_range) * height
            points.append((px, py))

        fill_path = c.beginPath()
        fill_path.moveTo(points[0][0], bottom)
        for px, py in points:
            fill_path.lineTo(px, py)
        fill_path.lineTo(points[-1][0], bottom)
        fill_path.close()
        c.setFillColor(Color(0.06, 0.46, 0.43, alpha=0.15))
        c.drawPath(fill_path, fill=1, stroke=0)

        line_path = c.beginPath()
        line_path.moveTo(points[0][0], points[0][1])
        for px, py in points[1:]:
            line_path.lineTo(px, py)
        c.setStrokeColor(TEAL)
        c.setLineWidth(1.4)
        c.drawPath(line_path, fill=0, stroke=1)

        end_pt = points[-1]
        c.setFillColor(TEAL)
        c.circle(end_pt[0], end_pt[1], 2.2, fill=1, stroke=0)
        c.setFont(_font(self.family, True), 7.5)
        c.drawRightString(left + width - 2 * mm, bottom + height - 4 * mm, f"Net Return: {values[-1]:+.2f}R")
        self.y = bottom - 6 * mm

    def underwater_chart(self, chart: Dict[str, Any]) -> None:
        title = str(chart.get("title") or "Drawdown Underwater Chart (R)")
        raw_vals = chart.get("values") or []
        values = [float(v or 0) for v in raw_vals]
        if not values:
            return
        self.ensure(52 * mm)
        self.paragraph(title, size=10, color=INK)
        left = 16 * mm
        width = PAGE_W - 32 * mm
        height = 30 * mm
        bottom = self.y - height

        c = self.canvas
        c.setFillColor(HexColor("#FFF1F2"))
        c.rect(left, bottom, width, height, fill=1, stroke=0)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.rect(left, bottom, width, height, fill=0, stroke=1)

        min_dd = min(values) if values else 0.0
        deepest = abs(min_dd) or 1.0
        top_y = bottom + height

        c.setStrokeColor(HexColor("#991B1B"))
        c.setLineWidth(0.8)
        c.line(left, top_y, left + width, top_y)

        n = len(values)
        points = []
        for i, val in enumerate(values):
            px = left + (i / max(1, n - 1)) * width
            offset = (abs(val) / deepest) * (height - 3 * mm)
            py = top_y - offset
            points.append((px, py))

        path = c.beginPath()
        path.moveTo(left, top_y)
        for px, py in points:
            path.lineTo(px, py)
        path.lineTo(points[-1][0], top_y)
        path.close()
        c.setFillColor(Color(0.88, 0.28, 0.35, alpha=0.35))
        c.drawPath(path, fill=1, stroke=0)

        line_path = c.beginPath()
        line_path.moveTo(points[0][0], points[0][1])
        for px, py in points[1:]:
            line_path.lineTo(px, py)
        c.setStrokeColor(HexColor("#BE123C"))
        c.setLineWidth(1.1)
        c.drawPath(line_path, fill=0, stroke=1)

        c.setFillColor(HexColor("#881337"))
        c.setFont(_font(self.family, True), 7.5)
        c.drawString(left + 2 * mm, bottom + 2 * mm, f"Max Sụt Giảm (Drawdown): -{deepest:.2f}R")
        self.y = bottom - 6 * mm

    def table(self, table_data: Dict[str, Any]) -> None:
        columns: Sequence[str] = table_data.get("columns") or []
        rows: Sequence[Sequence[Any]] = table_data.get("rows") or []
        if not columns or not rows:
            return
        row_h = 5.2 * mm
        header_h = 6.0 * mm
        needed = header_h + len(rows) * row_h + 8 * mm
        self.ensure(min(needed, 45 * mm))

        left = 16 * mm
        width = PAGE_W - 32 * mm
        col_w = width / len(columns)

        c = self.canvas
        c.setFillColor(HexColor("#F1F5F9"))
        c.rect(left, self.y - header_h, width, header_h, fill=1, stroke=0)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.rect(left, self.y - header_h, width, header_h, fill=0, stroke=1)

        c.setFillColor(INK)
        c.setFont(_font(self.family, True), 7.0)
        for i, col in enumerate(columns):
            cx = left + i * col_w + 1.5 * mm
            c.drawString(cx, self.y - 4.2 * mm, _text(col, self.family)[:18])
        self.y -= header_h

        c.setFont(_font(self.family, False), 6.8)
        for r_idx, row in enumerate(rows):
            self.ensure(row_h + 2 * mm)
            if r_idx % 2 == 1:
                c.setFillColor(HexColor("#F8FAFC"))
                c.rect(left, self.y - row_h, width, row_h, fill=1, stroke=0)
            c.setStrokeColor(HexColor("#E2E8F0"))
            c.setLineWidth(0.4)
            c.line(left, self.y - row_h, left + width, self.y - row_h)
            c.setFillColor(INK)
            for i, val in enumerate(row):
                cx = left + i * col_w + 1.5 * mm
                raw_val = "" if val is None else str(val)
                c.drawString(cx, self.y - 3.8 * mm, _text(raw_val, self.family)[:18])
            self.y -= row_h
        self.y -= 3 * mm

    def save(self) -> bytes:
        self.canvas.save()
        return self.buffer.getvalue()


def _sections_for_lang(sections: Sequence[Dict[str, Any]], lang: str) -> List[Dict[str, Any]]:
    key_h = "heading_en" if lang == "en" else "heading_vi"
    key_l = "lines_en" if lang == "en" else "lines_vi"
    out = []
    for section in sections:
        out.append({
            "heading": section.get(key_h) or section.get("heading_en") or "",
            "lines": section.get(key_l) or section.get("lines_en") or [],
            "chart": section.get("chart"),
            "line_chart": section.get("line_chart"),
            "underwater_chart": section.get("underwater_chart"),
            "table": section.get("table"),
        })
    return out


def build_methodology_pdf(
    document: Dict[str, Any],
    *,
    lang: str = "vi",
    preview: bool = False,
    watermark: Optional[str] = None,
) -> bytes:
    """Render a preview or the full methodology.

    Preview pages contain the opening sections and the disclaimer, not the full tables.
    """
    family = _ensure_fonts()
    language = "en" if str(lang).lower().startswith("en") else "vi"
    title = document["title_en"] if language == "en" else document["title_vi"]
    disclaimer = document["disclaimer_en"] if language == "en" else document["disclaimer_vi"]
    sections = document["preview_sections"] if preview else document["full_sections"]
    writer = _Writer(family, watermark if not preview else None)
    writer.new_page()
    writer.heading(title)
    meta = (
        f"Version {document.get('version')}  ·  {document.get('as_of')}  ·  {document.get('symbol')} {document.get('timeframe')}"
        if language == "en"
        else f"Phiên bản {document.get('version')}  ·  {document.get('as_of')}  ·  {document.get('symbol')} {document.get('timeframe')}"
    )
    writer.paragraph(meta, size=9, color=MUTED)
    kind = "Free preview. The full note is sold separately." if language == "en" else "Bản đọc thử miễn phí. Bản đầy đủ được bán riêng."
    if preview:
        writer.paragraph(kind, size=9, color=TEAL)
    elif watermark:
        label = f"Licensed to {watermark}." if language == "en" else f"Bản cấp cho {watermark}."
        writer.paragraph(label, size=9, color=TEAL)
    for section in _sections_for_lang(sections, language):
        writer.heading(str(section["heading"]))
        for line in section["lines"]:
            if str(line).strip():
                writer.paragraph(str(line))
        if not preview:
            if section.get("table"):
                writer.table(section["table"])
            if section.get("line_chart"):
                writer.line_chart(section["line_chart"])
            if section.get("underwater_chart"):
                writer.underwater_chart(section["underwater_chart"])
            if section.get("chart"):
                writer.bar_chart(section["chart"])
    writer.heading("Risk disclaimer" if language == "en" else "Tuyên bố rủi ro")
    writer.paragraph(disclaimer)
    if preview:
        writer.paragraph(
            "Tables, charts, and the historical rule path are in the full version."
            if language == "en"
            else "Bảng số, biểu đồ và đường đi lịch sử của quy tắc nằm ở bản đầy đủ."
        )
    return writer.save()


def build_license_page(lines: List[str]) -> bytes:
    """One extra page naming the buyer. Appended to the file they download."""
    family = _ensure_fonts()
    writer = _Writer(family, None)
    writer.new_page()
    writer.heading("Licensed copy / Bản cấp quyền")
    for line in lines:
        writer.paragraph(line)
    writer.paragraph(DISCLAIMER_LINE)
    return writer.save()


DISCLAIMER_LINE = (
    "Past statistics are not a promise of profit. "
    "This copy is for the named buyer and is not for redistribution."
)
