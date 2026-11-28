"""Turn a study bundle into a bilingual methodology document.

The wording is educational. It records what was measured, on which sample,
and what the measurement does not claim.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DISCLAIMER_VI = (
    "Tài liệu này là bài nghiên cứu thống kê phục vụ học tập. "
    "Số liệu trên dữ liệu quá khứ không phải dự báo và không phải cam kết lợi nhuận. "
    "Giao dịch ngoại hối, vàng và chỉ số có thể làm mất một phần hoặc toàn bộ vốn. "
    "ZUPIRUS không thực thi lệnh, không copy-trade, không cho thuê VPS và không giữ tiền giao dịch của bạn. "
    "Người đọc tự quyết định, tự chịu rủi ro, và nên đối chiếu lại trên dữ liệu của chính mình trước khi dùng bất kỳ quy tắc nào."
)

DISCLAIMER_EN = (
    "This document is a statistical study for education. "
    "Figures computed on past data are not a forecast and are not a promise of profit. "
    "Trading forex, gold, or indices can lose some or all of the capital you commit. "
    "ZUPIRUS does not place orders, copy trades, rent a VPS for you, or hold your trading funds. "
    "You decide whether to use any rule, you carry the risk, and you should recompute the study on your own data first."
)


def _fmt_ts(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _lines_for_table(table: Dict[str, Any]) -> List[str]:
    columns = table.get("columns") or []
    lines = [" | ".join(str(c) for c in columns)]
    for row in table.get("rows") or []:
        lines.append(" | ".join("" if cell is None else str(cell) for cell in row))
    return lines


def _section(heading_vi: str, heading_en: str, lines_vi: List[str], lines_en: List[str], chart: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {
        "heading_vi": heading_vi,
        "heading_en": heading_en,
        "lines_vi": lines_vi,
        "lines_en": lines_en,
        "chart": chart,
    }


def build_methodology(
    bundle: Dict[str, Any],
    *,
    title_vi: str,
    title_en: str,
    version: str = "v1.0",
    author: str = "ZUPIRUS Quant Lab",
    ai_report: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    studies = {item["id"]: item for item in bundle.get("studies") or []}
    start = _fmt_ts(bundle["range_start"])
    end = _fmt_ts(bundle["range_end"])
    symbol = bundle.get("symbol") or "XAUUSD"
    timeframe = bundle.get("timeframe") or "M15"
    cost = bundle.get("parameters", {}).get("round_trip_cost_r", 0.0)
    preview_sections = [
        _section(
            "Mục đích và phạm vi",
            "Purpose and scope",
            [
                f"{title_vi} là một phương pháp đọc thị trường, không phải một dịch vụ vào lệnh.",
                f"Thị trường: {symbol}. Khung: {timeframe}. Mẫu: {bundle.get('candle_count')} nến, từ {start} đến {end}.",
                "Các phép tính có thể chạy lại: cùng nến và cùng tham số cho cùng một bảng số.",
                "ZUPIRUS không kết nối tài khoản MT5 của bạn và không tự động khớp lệnh.",
            ],
            [
                f"{title_en} is a way to read a market, not an order-execution service.",
                f"Market: {symbol}. Timeframe: {timeframe}. Sample: {bundle.get('candle_count')} bars, from {start} to {end}.",
                "The calculations are reproducible: the same bars and the same parameters produce the same tables.",
                "ZUPIRUS does not connect to your MT5 account and does not fill orders for you.",
            ],
        ),
        _section(
            "Cách đọc tài liệu này",
            "How to read this note",
            [
                "Mỗi bảng là thống kê mô tả trên đúng mẫu đã chọn.",
                "Một tỷ lệ cao trong mẫu không có nghĩa là phiên sau sẽ lặp lại.",
                f"Chi phí khứ hồi đang dùng trong bài kiểm tra quy tắc: {cost} R. Nếu bạn trả spread hoặc hoa hồng khác, hãy đổi tham số và tính lại.",
                "Phần đọc thử dừng ở mô tả dữ liệu. Bản đầy đủ có bảng phiên, biến động, mùa vụ và đường đi của quy tắc.",
            ],
            [
                "Every table describes only the selected sample.",
                "A high rate inside the sample does not mean the next session will repeat it.",
                f"Round-trip cost used in the rule study: {cost} R. If your spread or commission differs, change the parameter and recompute.",
                "The preview stops at the data description. The full note contains the session, volatility, seasonality, and rule-path tables.",
            ],
        ),
    ]
    full_sections = list(preview_sections)
    catalog = [
        ("session_profile", "Hành vi theo phiên", "Session behaviour"),
        ("volatility_regimes", "Vùng biến động", "Volatility regimes"),
        ("range_breakout", "Phá biên độ phiên Á", "Asia-range breaks"),
        ("mean_reversion_trend", "Hồi quy và độ bền xu hướng", "Mean reversion and trend persistence"),
        ("seasonality", "Mùa vụ theo giờ và thứ", "Hour and weekday seasonality"),
        ("rule_backtest_asia_break", "Đường đi lịch sử: Breakout & Retest", "Historical path: Breakout & Retest"),
        ("rule_backtest_asian_mean_reversion", "Đường đi lịch sử: Đảo chiều phiên Á", "Historical path: Asian Mean-Reversion"),
        ("rule_backtest_london_liquidity_sweep", "Đường đi lịch sử: Quét thanh khoản London", "Historical path: London Liquidity Sweep"),
    ]
    for key, heading_vi, heading_en in catalog:
        study = studies.get(key)
        if not study:
            continue
        lines_vi = [study.get("notes_vi") or "", *_lines_for_table(study.get("table") or {"columns": [], "rows": []})]
        lines_en = [study.get("notes_en") or "", *_lines_for_table(study.get("table") or {"columns": [], "rows": []})]
        if study.get("weekday_table"):
            lines_vi.append("Thứ trong tuần:")
            lines_en.append("Weekday:")
            lines_vi.extend(_lines_for_table(study["weekday_table"]))
            lines_en.extend(_lines_for_table(study["weekday_table"]))
        params = study.get("parameters") or {}
        if params:
            rendered = ", ".join(f"{k}={v}" for k, v in params.items())
            lines_vi.append(f"Tham số: {rendered}")
            lines_en.append(f"Parameters: {rendered}")
        full_sections.append(_section(heading_vi, heading_en, lines_vi, lines_en, study.get("chart")))

        # If rule study contains cost matrix, monte carlo, or equity curves, append specialized sections
        if key.startswith("rule_backtest"):
            cost_matrix = study.get("cost_stress_matrix")
            if cost_matrix and cost_matrix.get("rows"):
                c_sec = _section(
                    "Ma trận nhạy chi phí giao dịch (Cost Stress Matrix)",
                    "Transaction Friction Stress Matrix",
                    [
                        "Bảng so sánh kỳ vọng (Expectancy), Profit Factor và ý nghĩa thống kê (t-stat, p-value) theo các mức chi phí:",
                    ],
                    [
                        "Expectancy, Profit Factor, and statistical significance across realistic friction tiers:",
                    ],
                )
                c_sec["table"] = cost_matrix
                full_sections.append(c_sec)

            mc = study.get("monte_carlo_risk")
            if mc and mc.get("simulations"):
                mc_table = {
                    "columns": ["metric", "value", "description_vi", "description_en"],
                    "rows": [
                        ["simulations", mc.get("simulations"), "Số lượt mô phỏng ngẫu nhiên", "Random bootstrap iterations"],
                        ["p50_max_dd", f"{mc.get('p50_max_dd')} R", "Mức sụt giảm trung vị (Median DD)", "Median Max Drawdown"],
                        ["p95_max_dd", f"{mc.get('p95_max_dd')} R", "Sụt giảm phân vị 95% (Tail Risk P95)", "95th percentile Max DD"],
                        ["p99_max_dd", f"{mc.get('p99_max_dd')} R", "Sụt giảm phân vị 99% (Worst-case P99)", "99th percentile Max DD"],
                        ["p95_loss_streak", f"{mc.get('p95_max_losing_streak')} lệnh", "Chuỗi thua tối đa P95", "P95 Max consecutive losses"],
                        ["prob_streak_5", f"{float(mc.get('prob_loss_streak_5') or 0)*100:.1f}%", "Xác suất gặp chuỗi thua >= 5 lệnh", "Probability of streak >= 5"],
                        ["prob_streak_7", f"{float(mc.get('prob_loss_streak_7') or 0)*100:.1f}%", "Xác suất gặp chuỗi thua >= 7 lệnh", "Probability of streak >= 7"],
                    ],
                }
                mc_sec = _section(
                    "Đánh giá rủi ro đuôi Monte Carlo & Chuỗi thua",
                    "Monte Carlo Tail Risk & Loss Streak Distribution",
                    [
                        "1,000 lượt mô phỏng đảo ngẫu nhiên chuỗi lệnh nhằm kiểm tra rủi ro phân vị xấu và nguy cơ chuỗi thua liên tiếp:",
                    ],
                    [
                        "1,000 bootstrap resamplings assessing tail drawdown and consecutive loss streaks:",
                    ],
                )
                mc_sec["table"] = mc_table
                full_sections.append(mc_sec)

            eq_series = study.get("equity_series")
            dd_series = study.get("drawdown_series")
            if eq_series and dd_series:
                curve_sec = _section(
                    "Đường cong vốn & Biểu đồ sụt giảm (Equity & Underwater)",
                    "Equity Curve & Underwater Drawdown Charts",
                    [
                        "Đường cong tích lũy R-multiples và biểu đồ sụt giảm vốn thực tế:",
                    ],
                    [
                        "Cumulative R-multiples equity curve and underwater drawdown trajectory:",
                    ],
                )
                curve_sec["line_chart"] = {
                    "title": "Cumulative Equity Curve (R)",
                    "values": [pt["equity_r"] for pt in eq_series],
                }
                curve_sec["underwater_chart"] = {
                    "title": "Underwater Drawdown (R)",
                    "values": [pt["drawdown_r"] for pt in dd_series],
                }
                full_sections.append(curve_sec)
    if ai_report and ai_report.get("sections"):
        for sec in ai_report["sections"]:
            sec_title = str(sec.get("title") or "Nghiên cứu chuyên sâu")
            sec_content = str(sec.get("content") or "")
            full_sections.append(
                _section(
                    heading_vi=sec_title,
                    heading_en=sec_title,
                    lines_vi=[sec_content],
                    lines_en=[sec_content],
                )
            )

    full_sections.append(
        _section(
            "Giới hạn",
            "Limits",
            [
                "Mẫu có thể quá ngắn, lệch về một chế độ thị trường, hoặc thiếu chi phí thật của sàn bạn dùng.",
                "Quy tắc phá biên phiên Á chỉ là một ví dụ có thể kiểm lại. Nó không phải khuyến nghị mua hoặc bán.",
                "Không có con số nào trong tài liệu này là lợi nhuận bạn sẽ nhận được.",
            ],
            [
                "The sample can be short, stuck in one market regime, or missing the real costs of your broker.",
                "The Asia-range break is one example you can recompute. It is not a recommendation to buy or sell.",
                "No figure in this note is a profit you will receive.",
            ],
        )
    )
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    return {
        "title_vi": title_vi.strip(),
        "title_en": title_en.strip(),
        "version": version.strip() or "v1.0",
        "author": author,
        "as_of": now,
        "symbol": symbol,
        "timeframe": timeframe,
        "disclaimer_vi": DISCLAIMER_VI,
        "disclaimer_en": DISCLAIMER_EN,
        "preview_sections": preview_sections,
        "full_sections": full_sections,
        "highlights_vi": (ai_report.get("highlights_vi") if ai_report and ai_report.get("highlights_vi") else [
            f"Mẫu {bundle.get('candle_count')} nến {symbol} {timeframe}.",
            "Có bảng phiên, biến động, mùa vụ và một quy tắc minh họa với mức sụt giảm trên mẫu.",
            "Không cam kết lợi nhuận. Không tự động vào lệnh.",
        ]),
        "highlights_en": [
            f"Sample of {bundle.get('candle_count')} {symbol} {timeframe} bars.",
            "Includes session, volatility, seasonality, and one illustrative rule with its in-sample drawdown.",
            "No profit promise. No automated order entry.",
        ],
    }
