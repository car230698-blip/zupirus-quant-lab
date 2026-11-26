"""ZUPIRUS Quant Lab - Research Report Generator.
Report Title: Breakout & Retest vàng COMEX M15 — nghiên cứu thăm dò.
"""
import json
import time
from pathlib import Path
from typing import Dict, Any, List

from app.db import tx, ROOT, DATA
from app.domains.reports.pdf_builder import (
    build_pdf_bytes,
    get_public_samples_dir,
    get_private_reports_dir,
)


def _format_hourly_rows(hourly_data: List[Dict[str, Any]]) -> List[str]:
    """Format hourly breakdown into structured table rows for PDF text display."""
    lines = [
        "Khung gio (UTC)       | So lenh | PF (3.5p) | Exp R (3.5p) | PF (5.0p) | Exp R (5.0p)",
        "-----------------------------------------------------------------------------------------",
    ]
    for row in hourly_data:
        h_label = row["hour_label"][:17]
        cnt = row["trade_count"]
        if cnt > 0:
            pf35_str = f"{row['pf_3_5']:.2f}"
            exp35_str = f"{row['expectancy_r_3_5']:+.3f} R"
            pf50_str = f"{row['pf_5_0']:.2f}"
            exp50_str = f"{row['expectancy_r_5_0']:+.3f} R"
            line = f"{h_label:17s} | {cnt:7d} | {pf35_str:9s} | {exp35_str:12s} | {pf50_str:9s} | {exp50_str:12s}"
        else:
            line = f"{h_label:17s} |       0 | Chua xac minh duoc (0 lenh trong mau quan sat)"
        lines.append(line)
    lines.append("-----------------------------------------------------------------------------------------")
    return lines


def create_sample_pdf_pages(study: Dict[str, Any]) -> List[List[str]]:
    ds = study["dataset_info"]
    base = study["full_period_metrics"]["baseline_3_5_pips"]
    sessions = study["full_period_metrics"]["sessions_baseline"]
    full_hourly = study["full_period_metrics"].get("hourly_breakdown", [])
    holdout_hourly = study["holdout_30pct_oos"].get("hourly_breakdown", [])

    page_1 = [
        "# 1. CAU HOI & PHUONG PHAP NGHIEN CUU THAM DO",
        "Nghien cuu tham do kiem dinh tren 4,582 nen M15 hop dong vang tuong lai COMEX (GC=F):",
        "'Mo hinh Breakout & Retest khung M15 co con ky vong loi nhuan duong sau chi phi giao dich",
        "(3.5 pips co so va 5.0 pips chi phi cao), va hieu qua khac biet the nao giua cac khung gio?'",
        " ",
        "# 2. BO QUY TAC TOAN HOC THAM DO (FORMAL SPECIFICATION)",
        "- Vung bien do: 20 nen M15 gan nhat xac dinh Swing High va Swing Low (loai tru nen hien tai).",
        "- Dieu kien Breakout: Gia Close vuot dinh/day Swing kem bien do nen (High-Low) >= 1.0 * ATR(14).",
        "- Dieu kien Retest: Trong vong 6 nen (90 phut), gia quay lai vung pha vo (+/- 0.5 * ATR)",
        "  kem rau nen tu choi (Wick Rejection Ratio) >= 0.30 theo huong pha vo.",
        "- Diem vao lenh: Gia Close cua nen Retest da dong (Zero Lookahead).",
        "- Quan tri vi the: SL dat ngoai cuc tri nen Retest + 0.5 ATR (min 15 pips); TP = 2.0 * Risk.",
        "- Gioi han thoi gian (Time Stop): Dong lenh tai nen thu 32 (8 gio) neu chua cham SL/TP.",
        "- Xu ly va cham cung nen: Tinh cham SL truoc neu High >= TP va Low <= SL trong cung 1 nen.",
        " ",
        "# 3. DU LIEU THI TRUONG SU DUNG",
        f"- Ma hop dong: {ds['symbol']} ({ds['underlying_asset']})",
        f"- Do phu: {ds['total_bars']} nen M15 ({ds['start_time']} -> {ds['end_time']})",
        "- Luu y ve du lieu: Day la hop dong tuong lai COMEX GC=F, co chenh lech gia co so (basis),",
        "  khoang trong rollover va gio nghi CME Globex (22:00-23:00 UTC), khong phai XAU/USD giao ngay.",
    ]

    page_2 = [
        "# 4. TOM TAT KET QUA QUAN SAT & PHAN RA KHUNG GIO",
        f"Tong so lenh toan ky: {base['trade_count']} lenh | Ty le thang: {base['win_rate']}% | Profit Factor: {base['profit_factor']}",
        f"Ky vong trung binh: {base['expectancy_r']} R/lenh | Net R: {base['net_r']} R | Max Drawdown: {base['max_drawdown_pct']}%",
        " ",
        "KET QUA QUAN SAT THEO 4 KHOANG PHIEN CHINH (CHI PHI CO SO 3.5 PIPS):",
        "-----------------------------------------------------------------------------------------",
        f"1. Phien A (Asian 00:00-08:00 UTC):         {sessions['Asian']['trade_count']} lenh | Win: {sessions['Asian']['win_rate']}% | PF: {sessions['Asian']['profit_factor']} | Exp: +{sessions['Asian']['expectancy_r']} R",
        f"2. Phien Au (London 08:00-13:00 UTC):       {sessions['London']['trade_count']} lenh | Win: {sessions['London']['win_rate']}% | PF: {sessions['London']['profit_factor']} | Exp: {sessions['London']['expectancy_r']} R",
        f"3. Chong lan Au-My (Overlap 13:00-17:00):   {sessions['London_NY_Overlap']['trade_count']} lenh | Win: {sessions['London_NY_Overlap']['win_rate']}% | PF: {sessions['London_NY_Overlap']['profit_factor']} | Exp: +{sessions['London_NY_Overlap']['expectancy_r']} R",
        f"4. Cuoi My (Late NY 17:00-22:00 UTC):       {sessions['Late_NY']['trade_count']} lenh | Win: {sessions['Late_NY']['win_rate']}% | PF: {sessions['Late_NY']['profit_factor']} | Exp: {sessions['Late_NY']['expectancy_r']} R",
        "-----------------------------------------------------------------------------------------",
        " ",
        "# 5. KET LUAN THAM DO",
        "1. Tong the: Chien luoc Breakout & Retest tren M15 co ky vong am (-0.096 R/lenh sau chi phi",
        "   3.5 pips) neu ap dung lien tuc toan thoi gian ma khong phan biet khung gio.",
        "2. Phan bo theo gio: Mot so khung gio co ky vong duong trong mau quan sat nhu khoang",
        "   02:00-05:59 UTC, 07:00-07:59 UTC, 13:00-13:59 UTC va 15:00-15:59 UTC.",
        "3. Cac khung gio khac co ky vong am hoac chua xac minh duoc do khong co lenh trong mau.",
        "4. Ban doc thu khong chua toan bo bang chi tiet 24 gio hay nhat ky lenh. Vui long xem Ban Day Du.",
    ]

    return [page_1, page_2]


def create_full_pdf_pages(study: Dict[str, Any]) -> List[List[str]]:
    ds = study["dataset_info"]
    base = study["full_period_metrics"]["baseline_3_5_pips"]
    severe = study["full_period_metrics"]["severe_5_0_pips"]
    sessions_b = study["full_period_metrics"]["sessions_baseline"]
    sessions_s = study["full_period_metrics"]["sessions_severe"]
    holdout = study["holdout_30pct_oos"]
    folds = study["wfo_folds"]
    full_hourly = study["full_period_metrics"].get("hourly_breakdown", [])
    holdout_hourly = study["holdout_30pct_oos"].get("hourly_breakdown", [])

    page_1 = [
        "# 1. GIA THUYET & PHUONG PHAP NGHIEN CUU THAM DO",
        "Bao cao nghien cuu dinh luong doc lap tu ZUPIRUS Quant Lab, danh gia mo hinh Breakout & Retest",
        "tren khung M15 hop dong tuong lai vang COMEX (GC=F) xuyen suot 4,582 nen nhat quan.",
        " ",
        "QUY TAC VA THAM SO THAM DO:",
        "- Vung bien do tham chieu: 20 nen M15 gan nhat (Swing High / Swing Low, loai tru nen hien tai).",
        "- Nhan dien Breakout: Nen Close dong ngoai bien do kem Range Expansion (High-Low) >= 1.0 * ATR(14).",
        "- Nhan dien Retest: Trong 6 nen tiep theo, gia hoi ve (+/- 0.5 ATR) va co Wick Ratio >= 0.30.",
        "- Diem vao & Thoat lenh: Vao tai Close nen Retest; SL ngoai cuc tri + 0.5 ATR; TP = 2.0R.",
        "- Time Stop: 32 nen M15 (8 gio giao dich). Va cham cung nen: Tinh cham SL truoc.",
        " ",
        "# 2. DU LIEU THI TRUONG & MO HINH CHI PHI",
        f"- Ma hop dong: {ds['symbol']} ({ds['underlying_asset']}) | Nguon: {ds['data_source']}",
        f"- Mau du lieu: {ds['total_bars']} nen M15 tu {ds['start_time']} den {ds['end_time']}.",
        "- Tinh chat hop dong: GC=F la hop dong tuong lai, co chenh lech basis voi Vang giao ngay (Spot)",
        "  va nghi bao tri hang ngay luc 22:00-23:00 UTC tren san CME Globex.",
        "- Kich ban chi phi co so: 3.5 pips ($0.35/oz) phi spread + truot gia khuyen nghi.",
        "- Kich ban chi phi cao (Stress Test): 5.0 pips ($0.50/oz).",
    ]

    # Page 2: Table for 116 Full Period Trades by UTC Hour
    page_2 = [
        "# 3. BANG 1: PHAN RA 116 LENH TOAN KY THEO TUNG KHUNG GIO UTC VA MUC CHI PHI",
        "Ket qua doi soat chi tiet 116 lenh tren toan bo mau du lieu quan sat (3.5 pips vs 5.0 pips):",
    ]
    page_2.extend(_format_hourly_rows(full_hourly)[:15])  # Hours 00 to 11

    # Page 3: Rest of Table 1 (Hours 12 to 23) + Summary
    page_3 = [
        "# 3. BANG 1 (TIEP THEO): PHAN RA 116 LENH TOAN KY (KHUNG GIO 12:00 - 23:59 UTC)",
    ]
    page_3.extend(_format_hourly_rows(full_hourly)[15:])  # Hours 12 to 23
    page_3.extend([
        " ",
        "NHAN XET TONG THE 116 LENH:",
        f"- Toan ky 3.5 pips: {base['trade_count']} lenh | Win: {base['win_rate']}% | PF: {base['profit_factor']} | Exp: {base['expectancy_r']} R | Net R: {base['net_r']} R",
        f"- Toan ky 5.0 pips: {severe['trade_count']} lenh | Win: {severe['win_rate']}% | PF: {severe['profit_factor']} | Exp: {severe['expectancy_r']} R | Net R: {severe['net_r']} R",
        "- Mot so khung gio co ky vong duong trong mau quan sat: 02:00, 03:00, 04:00, 05:00, 07:00, 13:00 va 15:00 UTC.",
        "- Cac khung gio khac co ky vong am hoac chua xac minh duoc do khong co lenh phat sinh trong mau.",
    ])

    # Page 4: Table for 36 Holdout Trades by UTC Hour
    page_4 = [
        "# 4. BANG 2: PHAN RA 36 LENH NGOAI MAU (HOLDOUT OOS) THEO TUNG KHUNG GIO UTC",
        "Ket qua doi soat 36 lenh ngoai mau doc lap (30% Holdout OOS) qua tung khung gio:",
    ]
    page_4.extend(_format_hourly_rows(holdout_hourly)[:15])

    # Page 5: Rest of Table 2 + WFO Matrix + Conclusion
    page_5 = [
        "# 4. BANG 2 (TIEP THEO): PHAN RA 36 LENH NGOAI MAU (KHUNG GIO 12:00 - 23:59 UTC)",
    ]
    page_5.extend(_format_hourly_rows(holdout_hourly)[15:])
    page_5.extend([
        " ",
        "# 5. MA TRAN WALK-FORWARD OPTIMIZATION (WFO) & NHAN DINH",
        f"Tap Holdout 30% OOS ({holdout['bar_count']} nen): {holdout['baseline_3_5_pips']['trade_count']} lenh | Win: {holdout['baseline_3_5_pips']['win_rate']}% | PF (3.5p): {holdout['baseline_3_5_pips']['profit_factor']} | Exp: {holdout['baseline_3_5_pips']['expectancy_r']} R",
        "Ma tran 4 Fold WFO lien tiep:",
    ])
    for f in folds:
        b_m = f["out_of_sample_base"]
        s_m = f["out_of_sample_severe"]
        page_5.append(
            f"- Fold {f['fold']}: OOS Trades={b_m['trade_count']:2d} | PF(3.5p)={b_m['profit_factor']:4.2f} | Exp={b_m['expectancy_r']:+6.3f}R | PF(5.0p)={s_m['profit_factor']:4.2f}"
        )
    page_5.extend([
        " ",
        "# 6. KET LUAN NGHIEN CUU THAM DO & KHUYEN NGHI",
        "1. Tong the toan mau ghi nhan ky vong am (-0.096 R/lenh), khong the giao dich 24/5 thieu chon loc.",
        "2. Trong mau quan sat, mot so khung gio co ky vong duong (dac biet la 13:00-13:59 UTC va 15:00-15:59 UTC",
        "   cung nhu mot so gio phien A). Cac khung gio khac co ky vong am hoac chua xac minh duoc.",
        "3. Danh gia duyet: CAN THEM BANG CHUNG do du lieu hien tai chi bao gom 4,582 nen tuong lai COMEX GC=F.",
        "   Can mo rong kiem dinh tren du lieu tick Vang giao ngay (Spot OTC/CFD) 3-5 nam truoc khi ap dung.",
        " ",
        "ZUPIRUS Quant Lab - Luu tru nghien cuu tham do noi bo | Ban Quyen 2026",
    ])

    return [page_1, page_2, page_3, page_4, page_5]


def generate_and_save_reports() -> Dict[str, Any]:
    with open("data/research_xauusd_breakout_retest_evidence.json", "r", encoding="utf-8") as f:
        study = json.load(f)

    pub_dir = get_public_samples_dir()
    priv_dir = get_private_reports_dir()

    sample_filename = "zupirus-xauusd-breakout-retest-m15-sample.pdf"
    full_filename = "zupirus-xauusd-breakout-retest-m15-full.pdf"

    sample_path = pub_dir / sample_filename
    full_path = priv_dir / full_filename

    sample_pages = create_sample_pdf_pages(study)
    full_pages = create_full_pdf_pages(study)

    sample_bytes = build_pdf_bytes(
        title="ZUPIRUS QUANT LAB - BREAKOUT & RETEST VANG COMEX M15 (SAMPLE)",
        subtitle="Breakout & Retest vang COMEX M15 - nghien cuu tham do (v1.0)",
        pages_lines=sample_pages,
    )
    sample_path.write_bytes(sample_bytes)

    full_bytes = build_pdf_bytes(
        title="ZUPIRUS QUANT LAB - FULL QUANTITATIVE RESEARCH REPORT",
        subtitle="Breakout & Retest vang COMEX M15 - nghien cuu tham do (v1.0)",
        pages_lines=full_pages,
    )
    full_path.write_bytes(full_bytes)

    print(f"Generated Sample PDF: {sample_path} ({len(sample_bytes)} bytes)")
    print(f"Generated Full PDF:   {full_path} ({len(full_bytes)} bytes)")

    # Register Draft report in DB
    now_ts = time.time()
    rep_id = "rep_xauusd_breakout_retest_m15_v1"
    slug = "breakout-retest-vang-comex-m15-nghien-cuu-tham-do-v1"
    title = "Breakout & Retest vàng COMEX M15 — nghiên cứu thăm dò"
    summary = (
        "Nghiên cứu thăm dò 4,582 nến M15 Vàng tương lai COMEX (GC=F) sau chi phí: "
        "Tổng thể mẫu quan sát ghi nhận kỳ vọng âm (-0.096 R/lệnh ở 3.5 pips và -0.113 R/lệnh ở 5.0 pips). "
        "Một số khung giờ có kỳ vọng dương trong mẫu quan sát (như 02:00-05:59 UTC, 07:00-07:59 UTC, "
        "13:00-13:59 UTC và 15:00-15:59 UTC), trong khi các khung giờ khác ghi nhận kỳ vọng âm hoặc chưa xác minh được do không có lệnh."
    )
    description = (
        "Báo cáo nghiên cứu thăm dò độc lập từ ZUPIRUS Quant Lab trên 4,582 nến M15 Vàng tương lai COMEX (GC=F). "
        "Mô phỏng thực thi với chi phí cơ sở 3.5 pips và chi phí cao 5.0 pips. Kết quả cho thấy toàn bộ 116 lệnh "
        "có kỳ vọng âm (-0.096 R), nhưng một số khung giờ có kỳ vọng dương trong mẫu quan sát. "
        "Báo cáo đối soát bảng chi tiết từng khung giờ cho 116 lệnh toàn kỳ và 36 lệnh ngoài mẫu (Holdout OOS)."
    )

    highlights = [
        "Định nghĩa toán học chặt chẽ: Swing 20 nến, Range Expansion >= 1.0 ATR, Wick Rejection >= 0.30, SL/TP 2.0R.",
        "Quy tắc va chạm cùng nến bảo thủ (Conservative Same-bar Collision): Tính chạm SL trước khi High & Low cùng nến chạm mốc.",
        "Mô hình chi phí thực tế: Đánh giá độ nhạy giữa kịch bản cơ sở (3.5 pips) và kịch bản chi phí cao (5.0 pips).",
        "Đối soát bảng chi tiết từng khung giờ UTC: Bảng riêng cho 116 lệnh toàn kỳ và 36 lệnh ngoài mẫu (Holdout).",
        "Kết luận trung thực: Một số khung giờ có kỳ vọng dương trong mẫu quan sát; cần thêm bằng chứng dữ liệu Spot nhiều năm trước khi triển khai thực tế.",
    ]

    wfo_metrics = {
        "method": "Rolling WFO (Train 1500 / Test 750) & 30% Holdout OOS",
        "market": "GC=F (COMEX Gold Continuous Futures)",
        "timeframe": "M15",
        "total_bars": study["dataset_info"]["total_bars"],
        "cost_model_baseline_pips": 3.5,
        "cost_model_severe_pips": 5.0,
        "cost_model_is_assumed": True,
        "cost_model_note": "Giả định chi phí 3.5 pips ($0.35/oz) kịch bản cơ sở và 5.0 pips ($0.50/oz) kịch bản stress.",
        "full_period": study["full_period_metrics"],
        "holdout_30pct_oos": study["holdout_30pct_oos"],
        "wfo_folds_summary": [
            {
                "fold": f["fold"],
                "oos_trades": f["out_of_sample_base"]["trade_count"],
                "oos_pf_base": f["out_of_sample_base"]["profit_factor"],
                "oos_exp_base": f["out_of_sample_base"]["expectancy_r"],
                "oos_pf_severe": f["out_of_sample_severe"]["profit_factor"],
            }
            for f in study["wfo_folds"]
        ],
        "verdict": "INSUFFICIENT_EVIDENCE_FOR_LIVE",
        "verdict_reason": (
            "Nghiên cứu thăm dò: Tổng thể toàn kỳ âm (-0.096 R/lệnh); "
            "một số khung giờ có kỳ vọng dương trong mẫu quan sát; "
            "mẫu dữ liệu 4,582 nến GC=F cần bổ sung dữ liệu spot dài hạn."
        ),
    }

    with tx() as c:
        existing = c.execute("SELECT id FROM research_reports WHERE id = ?", (rep_id,)).fetchone()
        if existing:
            c.execute(
                """
                UPDATE research_reports
                SET slug = ?, title = ?, summary = ?, description = ?, status = 'DRAFT',
                    sample_pdf_path = ?, full_pdf_path = ?, preview_highlights_json = ?,
                    wfo_metrics_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    slug,
                    title,
                    summary,
                    description,
                    str(sample_path),
                    str(full_path),
                    json.dumps(highlights, ensure_ascii=False),
                    json.dumps(wfo_metrics, ensure_ascii=False),
                    now_ts,
                    rep_id,
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
                ) VALUES (?, ?, ?, ?, ?, 'XAU/USD (GC=F)', 'M15', 'v1.0', 'DRAFT', ?, ?, 'VND', ?, ?, ?, NULL, ?, NULL, ?, ?)
                """,
                (
                    rep_id,
                    slug,
                    title,
                    summary,
                    description,
                    29.0,
                    750000,
                    str(sample_path),
                    str(full_path),
                    json.dumps(highlights, ensure_ascii=False),
                    json.dumps(wfo_metrics, ensure_ascii=False),
                    now_ts,
                    now_ts,
                ),
            )

        c.execute(
            """
            INSERT INTO report_versions (
                id, report_id, version, full_pdf_path, sample_pdf_path, changelog, wfo_metrics_json, published_at, created_at
            ) VALUES (?, ?, 'v1.0', ?, ?, 'Breakout & Retest vang COMEX M15 - nghien cuu tham do ban dau.', ?, ?, ?)
            ON CONFLICT(report_id, version) DO UPDATE SET
                full_pdf_path = excluded.full_pdf_path,
                sample_pdf_path = excluded.sample_pdf_path,
                wfo_metrics_json = excluded.wfo_metrics_json
            """,
            (
                f"ver_{rep_id}_v1_0",
                rep_id,
                str(full_path),
                str(sample_path),
                json.dumps(wfo_metrics, ensure_ascii=False),
                now_ts,
                now_ts,
            ),
        )

    print(f"Registered report in DB with id '{rep_id}' and status 'DRAFT'.")
    return {
        "report_id": rep_id,
        "sample_pdf": str(sample_path),
        "full_pdf": str(full_path),
        "status": "DRAFT",
    }


if __name__ == "__main__":
    generate_and_save_reports()
