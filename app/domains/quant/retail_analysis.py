"""Deterministic Retail Technical Analysis Engine & Mobile-Optimized PDF Generator.

Designed for individual retail traders requesting on-demand technical analysis
for major pairs (XAUUSD, EURUSD, USDJPY) across H1 and H4 timeframes.
Operates strictly on closed candles, deterministic structure rules, and
produces clean, mobile-readable 2-4 page PDF research notes.
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from app.domains.quant.candles import Candle
from app.domains.quant.pdf_doc import _ensure_fonts, _font, _text, _wrap

PAGE_W, PAGE_H = A4
TEAL = HexColor("#0F766E")
INK = HexColor("#0F172A")
MUTED = HexColor("#475569")
RULE = HexColor("#CBD5E1")
GREEN_BG = HexColor("#DCFCE7")
GREEN_TEXT = HexColor("#166534")
RED_BG = HexColor("#FEE2E2")
RED_TEXT = HexColor("#991B1B")
AMBER_BG = HexColor("#FEF3C7")
AMBER_TEXT = HexColor("#92400E")
CARD_BG = HexColor("#F8FAFC")


def calculate_ema(values: Sequence[float], period: int) -> List[float]:
    if not values:
        return []
    alpha = 2.0 / (period + 1.0)
    ema_vals: List[float] = [values[0]]
    for v in values[1:]:
        ema_vals.append(alpha * v + (1.0 - alpha) * ema_vals[-1])
    return ema_vals


def calculate_atr(candles: Sequence[Candle], period: int = 14) -> List[float]:
    if len(candles) < 2:
        return [c.range for c in candles]
    trs: List[float] = [candles[0].range]
    for i in range(1, len(candles)):
        hl = candles[i].high - candles[i].low
        hc = abs(candles[i].high - candles[i - 1].close)
        lc = abs(candles[i].low - candles[i - 1].close)
        trs.append(max(hl, hc, lc))
    return calculate_ema(trs, period)


@dataclass
class RetailAnalysisResult:
    run_id: str
    symbol: str
    symbol_display: str
    timeframe: str
    cutoff_time_utc: str
    bars_evaluated: int
    status: str  # "SUCCESS" or "INSUFFICIENT_DATA"
    bias: str  # "BUY", "SELL", or "ĐỨNG NGOÀI"
    bias_display_vi: str
    confidence_pct: int
    current_price: float
    ema_20: float
    ema_50: float
    atr_14: float
    support_zone: Tuple[float, float]
    resistance_zone: Tuple[float, float]
    invalidation_level: float
    entry_zone: Optional[Tuple[float, float]]
    stop_loss: Optional[float]
    take_profit_1: Optional[float]
    take_profit_2: Optional[float]
    risk_reward_ratio: float
    thesis_summary_vi: str
    action_plan_vi: str
    re_evaluation_condition_vi: str
    candle_summary: List[Dict[str, Any]]
    limitations_vi: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "symbol": self.symbol,
            "symbol_display": self.symbol_display,
            "timeframe": self.timeframe,
            "cutoff_time_utc": self.cutoff_time_utc,
            "bars_evaluated": self.bars_evaluated,
            "status": self.status,
            "bias": self.bias,
            "bias_display_vi": self.bias_display_vi,
            "confidence_pct": self.confidence_pct,
            "current_price": self.current_price,
            "ema_20": self.ema_20,
            "ema_50": self.ema_50,
            "atr_14": self.atr_14,
            "support_zone": list(self.support_zone),
            "resistance_zone": list(self.resistance_zone),
            "invalidation_level": self.invalidation_level,
            "entry_zone": list(self.entry_zone) if self.entry_zone else None,
            "stop_loss": self.stop_loss,
            "take_profit_1": self.take_profit_1,
            "take_profit_2": self.take_profit_2,
            "risk_reward_ratio": self.risk_reward_ratio,
            "thesis_summary_vi": self.thesis_summary_vi,
            "action_plan_vi": self.action_plan_vi,
            "re_evaluation_condition_vi": self.re_evaluation_condition_vi,
            "limitations_vi": self.limitations_vi,
        }


def run_retail_technical_analysis(
    symbol: str,
    timeframe: str,
    candles: Sequence[Candle],
    period_bars: int = 100,
) -> RetailAnalysisResult:
    """Run deterministic rule-based technical analysis on closed candles."""
    sym_u = symbol.strip().upper()
    tf_u = timeframe.strip().upper()
    run_id = f"rta_{uuid.uuid4().hex[:10]}"

    sym_display = {
        "XAUUSD": "Vàng giao ngay Spot Gold (XAU/USD)",
        "GC=F": "Hợp đồng tương lai vàng COMEX (GC=F)",
        "EURUSD": "Euro / Đô la Mỹ Spot (EUR/USD)",
        "USDJPY": "Đô la Mỹ / Yên Nhật Spot (USD/JPY)",
    }.get(sym_u, f"{sym_u} OTC Market")

    if len(candles) < 30:
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        return RetailAnalysisResult(
            run_id=run_id,
            symbol=sym_u,
            symbol_display=sym_display,
            timeframe=tf_u,
            cutoff_time_utc=now_utc,
            bars_evaluated=len(candles),
            status="INSUFFICIENT_DATA",
            bias="ĐỨNG NGOÀI",
            bias_display_vi="THIẾU DỮ LIỆU ĐỂ PHÂN TÍCH",
            confidence_pct=0,
            current_price=0.0,
            ema_20=0.0,
            ema_50=0.0,
            atr_14=0.0,
            support_zone=(0.0, 0.0),
            resistance_zone=(0.0, 0.0),
            invalidation_level=0.0,
            entry_zone=None,
            stop_loss=None,
            take_profit_1=None,
            take_profit_2=None,
            risk_reward_ratio=0.0,
            thesis_summary_vi="Chuỗi dữ liệu nến đóng quá ngắn (dưới 30 nến). Hệ thống từ chối đưa ra tín hiệu vì không đủ độ tin cậy thống kê.",
            action_plan_vi="Cần tải thêm lịch sử nến hoàn chỉnh trước khi khởi tạo bản phân tích.",
            re_evaluation_condition_vi="Cập nhật nguồn nến có tối thiểu 50 nến đóng liên tục.",
            candle_summary=[],
            limitations_vi="Không thể xác thực cấu trúc thị trường khi thiếu mẫu nến lịch sử tối thiểu.",
        )

    # Use specified lookback window of closed candles
    eval_candles = list(candles[-period_bars:])
    cutoff_dt = datetime.fromtimestamp(eval_candles[-1].time, tz=timezone.utc)
    cutoff_str = cutoff_dt.strftime("%Y-%m-%d %H:%M:%S UTC")

    closes = [c.close for c in eval_candles]
    ema20_series = calculate_ema(closes, 20)
    ema50_series = calculate_ema(closes, 50)
    atr_series = calculate_atr(eval_candles, 14)

    cur_price = closes[-1]
    cur_ema20 = ema20_series[-1]
    cur_ema50 = ema50_series[-1]
    cur_atr = atr_series[-1]

    # Find swing highs and swing lows (fractals: 2 left, 2 right)
    swing_highs: List[float] = []
    swing_lows: List[float] = []
    for i in range(2, len(eval_candles) - 2):
        c = eval_candles[i]
        if (c.high > eval_candles[i - 1].high and c.high > eval_candles[i - 2].high and
                c.high > eval_candles[i + 1].high and c.high > eval_candles[i + 2].high):
            swing_highs.append(c.high)
        if (c.low < eval_candles[i - 1].low and c.low < eval_candles[i - 2].low and
                c.low < eval_candles[i + 1].low and c.low < eval_candles[i + 2].low):
            swing_lows.append(c.low)

    # Key Support: Nearest swing low below current price or lowest recent low
    lows_below = [lvl for lvl in swing_lows if lvl < cur_price]
    key_sup = max(lows_below) if lows_below else min(c.low for c in eval_candles[-20:])
    support_zone = (round(key_sup - cur_atr * 0.3, 2), round(key_sup + cur_atr * 0.2, 2))

    # Key Resistance: Nearest swing high above current price or highest recent high
    highs_above = [lvl for lvl in swing_highs if lvl > cur_price]
    key_res = min(highs_above) if highs_above else max(c.high for c in eval_candles[-20:])
    resistance_zone = (round(key_res - cur_atr * 0.2, 2), round(key_res + cur_atr * 0.3, 2))

    # Determine trend & Bias
    is_bullish_trend = cur_price > cur_ema20 > cur_ema50
    is_bearish_trend = cur_price < cur_ema20 < cur_ema50
    range_span = key_res - key_sup

    # Avoid trading into wall
    dist_to_res = key_res - cur_price
    dist_to_sup = cur_price - key_sup

    if is_bullish_trend and dist_to_res > cur_atr * 0.8:
        bias = "BUY"
        bias_display = "MUA KHI ĐIỀU CHỈNH (BUY ON RETEST)"
        confidence = 72
        entry_low = round(max(cur_ema20 - cur_atr * 0.2, key_sup), 2)
        entry_high = round(cur_price, 2)
        entry_zone = (entry_low, entry_high)
        stop_loss = round(key_sup - cur_atr * 0.4, 2)
        risk = max(cur_price - stop_loss, cur_atr * 0.5)
        take_profit_1 = round(cur_price + risk * 1.5, 2)
        take_profit_2 = round(cur_price + risk * 2.0, 2)
        invalidation = stop_loss
        rr = round(1.5, 2)
        thesis = (
            f"Cấu trúc nến hoàn chỉnh xác nhận xu hướng tăng trên khung {tf_u}. Giá nằm trên cả 2 đường "
            f"EMA 20 ({cur_ema20:.2f}) và EMA 50 ({cur_ema50:.2f}). Vùng hỗ trợ chính đã kiểm định thành công tại "
            f"{support_zone[0]} - {support_zone[1]}. Lực mua chiếm ưu thế rõ rệt."
        )
        plan = (
            f"Canh mở vị thế MUA trong vùng {entry_low} - {entry_high}. Cắt lỗ (Stop Loss) cố định dưới mức {stop_loss}. "
            f"Chốt lời mục tiêu TP1 tại {take_profit_1} (1.5R) và TP2 tại {take_profit_2} (2.0R)."
        )
        re_eval = (
            f"Nếu nến đóng cửa phá vỡ xuống dưới mức vô hiệu {invalidation}, cấu trúc tăng bị hủy bỏ, "
            f"lập tức thoát trạng thái mua và chuyển sang quan sát."
        )
    elif is_bearish_trend and dist_to_sup > cur_atr * 0.8:
        bias = "SELL"
        bias_display = "BÁN KHI HỒI PHỤC (SELL ON PULLBACK)"
        confidence = 70
        entry_low = round(cur_price, 2)
        entry_high = round(min(cur_ema20 + cur_atr * 0.2, key_res), 2)
        entry_zone = (entry_low, entry_high)
        stop_loss = round(key_res + cur_atr * 0.4, 2)
        risk = max(stop_loss - cur_price, cur_atr * 0.5)
        take_profit_1 = round(cur_price - risk * 1.5, 2)
        take_profit_2 = round(cur_price - risk * 2.0, 2)
        invalidation = stop_loss
        rr = round(1.5, 2)
        thesis = (
            f"Cấu trúc nến hoàn chỉnh xác nhận xu hướng giảm rõ nét trên khung {tf_u}. Giá vận động dưới cả 2 đường "
            f"EMA 20 ({cur_ema20:.2f}) và EMA 50 ({cur_ema50:.2f}). Vùng kháng cự hình thành quanh "
            f"{resistance_zone[0]} - {resistance_zone[1]}. Áp lực cung chi phối."
        )
        plan = (
            f"Canh mở vị thế BÁN trong vùng {entry_low} - {entry_high}. Cắt lỗ (Stop Loss) đặt tại {stop_loss}. "
            f"Chốt lời mục tiêu TP1 tại {take_profit_1} (1.5R) và TP2 tại {take_profit_2} (2.0R)."
        )
        re_eval = (
            f"Nếu nến đóng cửa vượt lên trên mức vô hiệu {invalidation}, cấu trúc giảm bị phá vỡ, "
            f"lập tức ngừng bán và chuyển sang trạng thái đứng ngoài."
        )
    else:
        bias = "ĐỨNG NGOÀI"
        bias_display = "ĐỨNG NGOÀI QUAN SÁT (STAND ASIDE)"
        confidence = 50
        entry_zone = None
        stop_loss = None
        take_profit_1 = None
        take_profit_2 = None
        invalidation = round(key_res if cur_price > (key_sup + key_res) / 2 else key_sup, 2)
        rr = 0.0
        thesis = (
            f"Thị trường đang trong pha tích lũy giằng co biên độ hẹp giữa vùng hỗ trợ {support_zone[0]}-{support_zone[1]} "
            f"và kháng cự {resistance_zone[0]}-{resistance_zone[1]}. Đường EMA 20 ({cur_ema20:.2f}) và EMA 50 ({cur_ema50:.2f}) "
            f"đi ngang đan xen, không có xung lực rõ ràng."
        )
        plan = (
            "Khuyến nghị giữ kỷ luật ĐỨNG NGOÀI bảo toàn vốn. Tuyệt đối không giao dịch bắt đỉnh/đáy trong vùng tích lũy. "
            "Chờ đợi tín hiệu bứt phá nến đóng (breakout) xác nhận trước khi tham gia."
        )
        re_eval = (
            f"Tái đánh giá khi có nến đóng cửa vượt hẳn qua kháng cự {resistance_zone[1]} (kích hoạt kịch bản Mua) "
            f"hoặc phá vỡ hỗ trợ {support_zone[0]} (kích hoạt kịch bản Bán)."
        )

    candle_summary = [
        {
            "time": c.time,
            "utc": datetime.fromtimestamp(c.time, tz=timezone.utc).strftime("%m-%d %H:%M"),
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
        }
        for c in eval_candles[-15:]
    ]

    limitations = (
        "Báo cáo phân tích kỹ thuật cá nhân được tính toán hoàn toàn theo các quy tắc định lượng "
        "trên nến đã đóng hoàn thành tại thời điểm cutoff. Không có bất kỳ cam kết lợi nhuận nào. "
        "Chi phí spread thực tế và trượt giá có thể làm sai lệch điểm khớp lệnh so với mô hình."
    )

    return RetailAnalysisResult(
        run_id=run_id,
        symbol=sym_u,
        symbol_display=sym_display,
        timeframe=tf_u,
        cutoff_time_utc=cutoff_str,
        bars_evaluated=len(eval_candles),
        status="SUCCESS",
        bias=bias,
        bias_display_vi=bias_display,
        confidence_pct=confidence,
        current_price=cur_price,
        ema_20=cur_ema20,
        ema_50=cur_ema50,
        atr_14=cur_atr,
        support_zone=support_zone,
        resistance_zone=resistance_zone,
        invalidation_level=invalidation,
        entry_zone=entry_zone,
        stop_loss=stop_loss,
        take_profit_1=take_profit_1,
        take_profit_2=take_profit_2,
        risk_reward_ratio=rr,
        thesis_summary_vi=thesis,
        action_plan_vi=plan,
        re_evaluation_condition_vi=re_eval,
        candle_summary=candle_summary,
        limitations_vi=limitations,
    )


class _RetailPDFWriter:
    """PDF Writer formatted cleanly for mobile and tablet readability (large clear typography, 2-4 pages)."""

    def __init__(self, watermark: Optional[str] = None):
        self.family = _ensure_fonts()
        self.watermark = (watermark or "").strip()
        self.buffer = BytesIO()
        self.canvas = canvas.Canvas(self.buffer, pagesize=A4, pageCompression=0)
        self.canvas.setTitle("ZUPIRUS Technical Analysis")
        self.y = PAGE_H - 18 * mm
        self.page = 1

    def _draw_chrome(self) -> None:
        c = self.canvas
        # Top banner
        c.setFillColor(TEAL)
        c.rect(0, PAGE_H - 14 * mm, PAGE_W, 14 * mm, fill=1, stroke=0)
        c.setFillColor(HexColor("#FFFFFF"))
        c.setFont(_font(self.family, True), 9)
        c.drawString(14 * mm, PAGE_H - 9 * mm, _text("ZUPIRUS QUANT LAB  ·  BẢN PHÂN TÍCH KỸ THUẬT CÁ NHÂN", self.family))

        # Bottom footer
        c.setFillColor(MUTED)
        c.setFont(_font(self.family, False), 7.5)
        c.drawString(14 * mm, 9 * mm, _text("Bảo mật · Không chia sẻ bản quyền · Nguồn: ZUPIRUS Quant Engine", self.family))
        c.drawRightString(PAGE_W - 14 * mm, 9 * mm, _text(f"Trang {self.page}/3", self.family))
        c.setStrokeColor(RULE)
        c.line(14 * mm, 12 * mm, PAGE_W - 14 * mm, 12 * mm)

        if self.watermark:
            c.saveState()
            c.setFillColor(Color(0.45, 0.52, 0.58, alpha=0.14))
            c.translate(PAGE_W / 2, PAGE_H / 2)
            c.rotate(30)
            c.setFont(_font(self.family, True), 10)
            label = _text(f"Licensed to {self.watermark} · not for redistribution", self.family)
            c.drawCentredString(0, 0, label[:120])
            c.restoreState()

    def new_page(self) -> None:
        self.canvas.showPage()
        self.page += 1
        self._draw_chrome()
        self.y = PAGE_H - 20 * mm

    def ensure(self, needed: float) -> None:
        if self.y - needed < 16 * mm:
            self.new_page()

    def heading(self, text: str, size: float = 13) -> None:
        self.ensure(14 * mm)
        self.canvas.setFillColor(INK)
        self.canvas.setFont(_font(self.family, True), size)
        self.canvas.drawString(14 * mm, self.y, _text(text, self.family)[:100])
        self.y -= (size * 0.45 + 3.5) * mm

    def paragraph(self, text: str, size: float = 9.5, color=INK, bold: bool = False) -> None:
        font_name = _font(self.family, bold)
        for block in str(text).split("\n"):
            lines = _wrap(_text(block, self.family), font_name, size, PAGE_W - 28 * mm)
            for line in lines:
                self.ensure(5.5 * mm)
                self.canvas.setFillColor(color)
                self.canvas.setFont(font_name, size)
                self.canvas.drawString(14 * mm, self.y, line)
                self.y -= (size * 0.38 + 1.8) * mm
        self.y -= 1.2 * mm

    def card(self, title: str, content: List[Tuple[str, str]], bg_color=CARD_BG, border_color=RULE) -> None:
        card_h = (len(content) * 5.2 + 10) * mm
        self.ensure(card_h + 4 * mm)
        c = self.canvas
        left = 14 * mm
        width = PAGE_W - 28 * mm

        c.setFillColor(bg_color)
        c.roundRect(left, self.y - card_h, width, card_h, 3 * mm, fill=1, stroke=0)
        c.setStrokeColor(border_color)
        c.setLineWidth(0.8)
        c.roundRect(left, self.y - card_h, width, card_h, 3 * mm, fill=0, stroke=1)

        c.setFillColor(INK)
        c.setFont(_font(self.family, True), 9)
        c.drawString(left + 4 * mm, self.y - 6 * mm, _text(title, self.family))

        c.setFont(_font(self.family, False), 8.5)
        cur_y = self.y - 11 * mm
        for label, val in content:
            c.setFillColor(MUTED)
            c.drawString(left + 4 * mm, cur_y, _text(label, self.family))
            c.setFillColor(INK)
            c.setFont(_font(self.family, True), 8.5)
            c.drawRightString(left + width - 4 * mm, cur_y, _text(val, self.family))
            c.setFont(_font(self.family, False), 8.5)
            cur_y -= 5.0 * mm

        self.y -= card_h + 3 * mm

    def price_chart(self, candles: Sequence[Dict[str, Any]], sup: Tuple[float, float], res: Tuple[float, float], ema20: float, ema50: float) -> None:
        if not candles:
            return
        chart_h = 48 * mm
        self.ensure(chart_h + 10 * mm)
        c = self.canvas
        left = 14 * mm
        width = PAGE_W - 28 * mm
        bottom = self.y - chart_h

        c.setFillColor(HexColor("#F8FAFC"))
        c.rect(left, bottom, width, chart_h, fill=1, stroke=0)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.rect(left, bottom, width, chart_h, fill=0, stroke=1)

        highs = [cd["high"] for cd in candles] + [res[1]]
        lows = [cd["low"] for cd in candles] + [sup[0]]
        max_p = max(highs)
        min_p = min(lows)
        span = max(0.0001, max_p - min_p)
        pad = span * 0.08
        min_p -= pad
        max_p += pad
        span = max_p - min_p

        # Draw Resistance Band
        res_y1 = bottom + ((res[0] - min_p) / span) * chart_h
        res_y2 = bottom + ((res[1] - min_p) / span) * chart_h
        c.setFillColor(Color(0.88, 0.28, 0.35, alpha=0.18))
        c.rect(left, min(res_y1, res_y2), width, max(2.0, abs(res_y2 - res_y1)), fill=1, stroke=0)
        c.setFillColor(RED_TEXT)
        c.setFont(_font(self.family, True), 6.5)
        c.drawString(left + 2 * mm, min(res_y1, res_y2) + 1, f"Kháng cự: {res[0]} - {res[1]}")

        # Draw Support Band
        sup_y1 = bottom + ((sup[0] - min_p) / span) * chart_h
        sup_y2 = bottom + ((sup[1] - min_p) / span) * chart_h
        c.setFillColor(Color(0.13, 0.65, 0.42, alpha=0.18))
        c.rect(left, min(sup_y1, sup_y2), width, max(2.0, abs(sup_y2 - sup_y1)), fill=1, stroke=0)
        c.setFillColor(GREEN_TEXT)
        c.setFont(_font(self.family, True), 6.5)
        c.drawString(left + 2 * mm, min(sup_y1, sup_y2) + 1, f"Hỗ trợ: {sup[0]} - {sup[1]}")

        # Draw Candlesticks
        n = len(candles)
        slot_w = width / max(1, n)
        body_w = max(2.5, slot_w * 0.65)
        for idx, cd in enumerate(candles):
            cx = left + idx * slot_w + slot_w / 2
            o_y = bottom + ((cd["open"] - min_p) / span) * chart_h
            h_y = bottom + ((cd["high"] - min_p) / span) * chart_h
            l_y = bottom + ((cd["low"] - min_p) / span) * chart_h
            c_y = bottom + ((cd["close"] - min_p) / span) * chart_h

            is_up = cd["close"] >= cd["open"]
            bar_color = GREEN_TEXT if is_up else RED_TEXT

            c.setStrokeColor(bar_color)
            c.setLineWidth(0.8)
            c.line(cx, l_y, cx, h_y)

            b_top = max(o_y, c_y)
            b_bot = min(o_y, c_y)
            b_h = max(1.0, b_top - b_bot)
            c.setFillColor(GREEN_BG if is_up else RED_BG)
            c.rect(cx - body_w / 2, b_bot, body_w, b_h, fill=1, stroke=1)

            if idx % 3 == 0:
                c.setFillColor(MUTED)
                c.setFont(_font(self.family, False), 6.0)
                c.drawCentredString(cx, bottom - 3 * mm, cd["utc"][-5:])

        self.y = bottom - 7 * mm

    def save(self) -> bytes:
        import re
        self.canvas.save()
        raw_bytes = self.buffer.getvalue()
        # Normalize non-deterministic ReportLab trailer ID so byte-for-byte SHA256 is reproducible
        return re.sub(
            rb'/ID\s*\[<[0-9a-fA-F]+><[0-9a-fA-F]+>\]',
            rb'/ID [<00000000000000000000000000000000><00000000000000000000000000000000>]',
            raw_bytes,
        )


def generate_retail_pdf(result: RetailAnalysisResult, watermark: Optional[str] = None) -> bytes:
    """Generate professional 2-3 page technical analysis PDF note optimized for mobile reading."""
    writer = _RetailPDFWriter(watermark=watermark)
    writer._draw_chrome()

    # Page 1: Executive Action Note
    writer.heading(f"{result.symbol} · {result.timeframe} TECHNICAL NOTE", size=15)
    writer.paragraph(
        f"Mã: {result.symbol_display}  |  Khung: {result.timeframe}  |  Cutoff: {result.cutoff_time_utc}",
        size=8.5,
        color=MUTED,
    )
    writer.y -= 2 * mm

    # Executive Bias Badge Card
    badge_bg = GREEN_BG if result.bias == "BUY" else RED_BG if result.bias == "SELL" else AMBER_BG
    badge_text_c = GREEN_TEXT if result.bias == "BUY" else RED_TEXT if result.bias == "SELL" else AMBER_TEXT

    writer.card(
        "KHUYẾN NGHỊ ĐỊNH LƯỢNG (EXECUTIVE BIAS)",
        [
            ("Trạng thái hành động", result.bias_display_vi),
            ("Độ tin cậy mô hình", f"{result.confidence_pct}%"),
            ("Giá đóng cửa hiện tại", f"{result.current_price:.2f}"),
            ("Mức vô hiệu kịch bản (Invalidation)", f"{result.invalidation_level:.2f}"),
        ],
        bg_color=badge_bg,
        border_color=badge_text_c,
    )

    writer.heading("1. Luận điểm kỹ thuật (Thesis)", size=11)
    writer.paragraph(result.thesis_summary_vi, size=9.0)

    writer.heading("2. Kế hoạch hành động & Quản trị rủi ro", size=11)
    writer.paragraph(result.action_plan_vi, size=9.0)

    # Detailed Levels Card
    level_items = [
        ("Vùng Hỗ trợ (Support)", f"{result.support_zone[0]:.2f} - {result.support_zone[1]:.2f}"),
        ("Vùng Kháng cự (Resistance)", f"{result.resistance_zone[0]:.2f} - {result.resistance_zone[1]:.2f}"),
        ("EMA 20 / EMA 50", f"{result.ema_20:.2f} / {result.ema_50:.2f}"),
        ("Biên độ biến động ATR(14)", f"{result.atr_14:.2f}"),
    ]
    if result.entry_zone:
        level_items.append(("Vùng vào lệnh (Entry Zone)", f"{result.entry_zone[0]:.2f} - {result.entry_zone[1]:.2f}"))
        level_items.append(("Dừng lỗ (Stop Loss)", f"{result.stop_loss:.2f}"))
        level_items.append(("Mục tiêu 1 (Take Profit 1)", f"{result.take_profit_1:.2f} (1.5R)"))
        level_items.append(("Mục tiêu 2 (Take Profit 2)", f"{result.take_profit_2:.2f} (2.0R)"))

    writer.card("CÁC MỐC GIÁ KỸ THUẬT QUAN TRỌNG", level_items)

    # Page 2: Price Action & Visual Chart
    writer.new_page()
    writer.heading("3. Biểu đồ cấu trúc giá & Các vùng hỗ trợ / kháng cự", size=11)
    writer.paragraph(
        "Biểu đồ minh họa 15 nến đóng gần nhất, các vùng giá then chốt và đường xu hướng động EMA:",
        size=8.5,
        color=MUTED,
    )
    writer.price_chart(
        candles=result.candle_summary,
        sup=result.support_zone,
        res=result.resistance_zone,
        ema20=result.ema_20,
        ema50=result.ema_50,
    )

    writer.heading("4. Điều kiện kích hoạt tái đánh giá (Re-evaluation)", size=11)
    writer.paragraph(result.re_evaluation_condition_vi, size=9.0)

    writer.heading("5. Bảng giá nến đóng gần nhất", size=11)
    candle_table_rows = [
        (c["utc"], f"{c['open']:.2f}", f"{c['high']:.2f}", f"{c['low']:.2f}", f"{c['close']:.2f}")
        for c in result.candle_summary[-6:]
    ]
    writer.card(
        "DỮ LIỆU NẾN ĐÃ ĐÓNG TẠI THỜI ĐIỂM CUTOFF (UTC)",
        [(r[0], f"O:{r[1]} H:{r[2]} L:{r[3]} C:{r[4]}") for r in candle_table_rows],
    )

    writer.heading("6. Giới hạn & Tuyên bố rủi ro (Risk Disclaimer)", size=10)
    writer.paragraph(result.limitations_vi, size=8.0, color=MUTED)
    writer.paragraph(
        "Bản phân tích này chỉ phục vụ mục đích nghiên cứu và giáo dục định lượng. "
        "ZUPIRUS Quant Lab không cung cấp dịch vụ ủy thác đầu tư hoặc tư vấn giao dịch tài chính cá nhân. "
        "Nhà đầu tư chịu trách nhiệm hoàn toàn đối với mọi quyết định sử dụng vốn của mình.",
        size=7.5,
        color=MUTED,
    )

    return writer.save()
