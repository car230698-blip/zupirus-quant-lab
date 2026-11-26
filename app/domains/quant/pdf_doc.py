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
        if section.get("chart") and not preview:
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
