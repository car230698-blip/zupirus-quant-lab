"""Script to generate the two PDF reports (Sample & Full) and register the DRAFT research report in DB.
Topic: Breakout & Retest XAU/USD M15: Expectancy After Costs & Cross-Session Heterogeneity.
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


def create_sample_pdf_pages(study: Dict[str, Any]) -> List[List[str]]:
    ds = study["dataset_info"]
    base = study["full_period_metrics"]["baseline_3_5_pips"]
    sessions = study["full_period_metrics"]["sessions_baseline"]

    page_1 = [
        "# 1. CAU HOI NGHIEN CUU & GIA THUYET DINH LUONG",
        "Nghien cuu kiem dinh thuc nghiem cau hoi:",
        "'Mo hinh Breakout & Retest khung M15 tren thi truong Vang co con ky vong loi nhuan duong",
        "sau chi phi giao dich thuc te (spread + truot gia), va ket qua khac biet the nao giua cac phien?'",
        " ",
        "# 2. BO QUY TAC TOAN HOC DANG CHUAN (FORMAL RULES)",
        "- Vung gia tham chieu: 20-bar Swing High & Swing Low (loai tru nen hien tai).",
        "- Dieu kien Breakout: Gia Close vuot dinh/day Swing kem Range Expansion >= 1.0 * ATR(14).",
        "- Dieu kien Retest: Trong toi da 6 nen (90 phut), gia quay lai test vung pha vo (+/- 0.5 * ATR)",
        "  kem Rejection Wick Ratio >= 0.30 theo chieu breakout.",
        "- Diem vao lenh: Gia Close cua nen Retest da dong (Zero Lookahead).",
        "- Cat lo & Chot loi: SL ngoai cuc tri nen Retest + 0.5 ATR (min 15 pips); TP dat ty le 2.0R.",
        "- Time Stop: Dong lenh tai nen thu 32 (8 tieng) neu chua cham SL hay TP.",
        "- Va cham cung nen (Collision): Gia dinh bao thu nhat - cham SL truoc neu cung nen.",
        " ",
        "# 3. DU LIEU THI TRUONG SU DUNG & MINH BACH NGUON",
        f"- Ma hop dong: {ds['symbol']} ({ds['underlying_asset']})",
        f"- Do phu: {ds['total_bars']} nen M15 ({ds['start_time']} -> {ds['end_time']})",
        "- Khac biet Spot vs Futures: Hop dong tuong lai GC=F co chenh lech gia co so (basis),",
        "  khoang trong ky dao han (rollover gaps) va gio nghi CME Globex (22:00-23:00 UTC).",
    ]

    page_2 = [
        "# 4. TOM TAT KET QUA HIEN THUC THEO PHIEN (CHI PHI CO SO 3.5 PIPS)",
        f"Tong so lenh: {base['trade_count']} | Ty le thang: {base['win_rate']}% | Profit Factor: {base['profit_factor']}",
        f"Ky vong trung binh: {base['expectancy_r']} R/lenh | Net R: {base['net_r']} R | Max DD: {base['max_drawdown_pct']}%",
        " ",
        "BANG PHAN RA KET QUA THEO 4 PHIEN CHINH:",
        "-----------------------------------------------------------------------------------------",
        f"1. Phien A (Asian 00:00-08:00 UTC):         {sessions['Asian']['trade_count']} lenh | Win: {sessions['Asian']['win_rate']}% | PF: {sessions['Asian']['profit_factor']} | Exp: +{sessions['Asian']['expectancy_r']} R",
        f"2. Phien Au (London 08:00-13:00 UTC):       {sessions['London']['trade_count']} lenh | Win: {sessions['London']['win_rate']}% | PF: {sessions['London']['profit_factor']} | Exp: {sessions['London']['expectancy_r']} R",
        f"3. Chồng lan Au-My (Overlap 13:00-17:00):   {sessions['London_NY_Overlap']['trade_count']} lenh | Win: {sessions['London_NY_Overlap']['win_rate']}% | PF: {sessions['London_NY_Overlap']['profit_factor']} | Exp: +{sessions['London_NY_Overlap']['expectancy_r']} R",
        f"4. Cuoi My (Late NY 17:00-22:00 UTC):       {sessions['Late_NY']['trade_count']} lenh | Win: {sessions['Late_NY']['win_rate']}% | PF: {sessions['Late_NY']['profit_factor']} | Exp: {sessions['Late_NY']['expectancy_r']} R",
        "-----------------------------------------------------------------------------------------",
        " ",
        "# 5. KET LUAN SO BO CHO BAN DOC THU",
        "1. Tong the: Chien luoc Breakout & Retest tren M15 KHONG CO KY VONG DUONG neu ap dung",
        "   lien tuc khong loc phien (-0.096 R/lenh sau khi tru chi phi 3.5 pips).",
        "2. Di biet phien: Loi the (Edge) tap trung o Phien Chong Lan Au-My (+0.102 R) va Phien A",
        "   (+0.157 R). Nguoc lai, Phien Au sang (-0.437 R) va Cuoi My (-0.757 R) gay thua lo nang.",
        "3. Ban doc thu khong chua danh sach chi tiet lenh hay khuyen nghi giao dich truc tiep.",
        "   Vui long xem Ban Day Du de nam ro ma tran WFO tung fold, kiem dinh do nhay va nhat ky lenh.",
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

    page_1 = [
        "# 1. GIA THUYET & PHUONG PHAP LUAN NGHIEN CUU (METHODOLOGY)",
        "Nghien cuu nay thuoc Phong nghien cuu dinh luong ZUPIRUS Quant Lab, nham giai ma tinh",
        "hieu qua thuc te cua mo hinh Breakout & Retest tren khung thoi gian M15 cua thi truong Vang.",
        " ",
        "QUY TAC VA DIEU KIEN KIEM DINH:",
        "- Bien do Swing: 20 nen M15 gan nhat de xac dinh Khang cu (Swing High) va Ho tro (Swing Low).",
        "- Nhan dien Breakout: Nen Close vuot hoan toan khoi bien do kem Range Expansion >= 1.0 ATR(14).",
        "- Retest & Wick Rejection: Trong 6 nen tiep theo, gia hoi ve vung pha vo (+/- 0.5 ATR) va tao",
        "  rau nen tu choi (Lower Wick cho Buy, Upper Wick cho Sell) voi Wick Ratio >= 0.30.",
        "- Quan tri vi the: SL dat tai cuc tri retest + 0.5 ATR (toi thieu 15 pips); TP = 2.0 * R.",
        "- Dong lenh cuong buc (Time Stop): 32 nen M15 (8 gio giao dich).",
        "- Va cham cung nen (Same-bar Collision): Gia dinh SL cham truoc (Conservative Loss Rule).",
        " ",
        "# 2. DU LIEU THI TRUONG & GIA DINH CHI PHI",
        f"- Nguon du lieu: {ds['data_source']} | Hop dong: {ds['symbol']}",
        f"- Do dai: {ds['total_bars']} nen M15 tu {ds['start_time']} den {ds['end_time']}.",
        "- Tinh chat hop dong: GC=F la hop dong tuong lai tren san COMEX (CME Globex). Gia co chenh",
        "  lech basis voi Vang giao ngay (Spot OTC/CFD) va nghi giao dich giua 22:00 va 23:00 UTC.",
        "- Kich ban chi phi co so: 3.5 pips ($0.35/oz) gom phi khuyen nghi spread + slippage.",
        "- Kich ban chi phi cao (Stress Test): 5.0 pips ($0.50/oz).",
    ]

    page_2 = [
        "# 3. BANG KET QUA TONG THE & PHAN RA THEO 4 PHIEN GIAO DICH",
        "So sanh hieu suat giua Kich ban Co so (3.5 pips) va Kich ban Chi phi cao (5.0 pips):",
        "-----------------------------------------------------------------------------------------",
        "Chi so                    | Kich ban Co so (3.5 pips)    | Kich ban Chi phi cao (5.0 pips)",
        "-----------------------------------------------------------------------------------------",
        f"Tong so lenh thuc hien     | {base['trade_count']} lenh                      | {severe['trade_count']} lenh",
        f"Ty le thang (Win Rate)    | {base['win_rate']}%                        | {severe['win_rate']}%",
        f"Profit Factor             | {base['profit_factor']}                         | {severe['profit_factor']}",
        f"Ky vong trung binh        | {base['expectancy_r']} R/lenh                 | {severe['expectancy_r']} R/lenh",
        f"Tong Net R tich luy       | {base['net_r']} R                      | {severe['net_r']} R",
        f"Sut giam lon nhat (MaxDD) | {base['max_drawdown_pct']}%                       | {severe['max_drawdown_pct']}%",
        "-----------------------------------------------------------------------------------------",
        " ",
        "PHAN RA THEO 4 PHIEN GIAO DICH CHINH (FULL PERIOD):",
        f"1. Phien A (Asian 00:00-08:00 UTC):",
        f"   - 3.5 pips: {sessions_b['Asian']['trade_count']} lenh | Win: {sessions_b['Asian']['win_rate']}% | PF: {sessions_b['Asian']['profit_factor']} | Exp: +{sessions_b['Asian']['expectancy_r']} R | Net R: +{sessions_b['Asian']['net_r']} R",
        f"   - 5.0 pips: {sessions_s['Asian']['trade_count']} lenh | Win: {sessions_s['Asian']['win_rate']}% | PF: {sessions_s['Asian']['profit_factor']} | Exp: +{sessions_s['Asian']['expectancy_r']} R | Net R: +{sessions_s['Asian']['net_r']} R",
        f"2. Phien Au (London 08:00-13:00 UTC):",
        f"   - 3.5 pips: {sessions_b['London']['trade_count']} lenh | Win: {sessions_b['London']['win_rate']}% | PF: {sessions_b['London']['profit_factor']} | Exp: {sessions_b['London']['expectancy_r']} R | Net R: {sessions_b['London']['net_r']} R",
        f"   - 5.0 pips: {sessions_s['London']['trade_count']} lenh | Win: {sessions_s['London']['win_rate']}% | PF: {sessions_s['London']['profit_factor']} | Exp: {sessions_s['London']['expectancy_r']} R | Net R: {sessions_s['London']['net_r']} R",
        f"3. Chồng lan Au-My (Overlap 13:00-17:00 UTC):",
        f"   - 3.5 pips: {sessions_b['London_NY_Overlap']['trade_count']} lenh | Win: {sessions_b['London_NY_Overlap']['win_rate']}% | PF: {sessions_b['London_NY_Overlap']['profit_factor']} | Exp: +{sessions_b['London_NY_Overlap']['expectancy_r']} R | Net R: +{sessions_b['London_NY_Overlap']['net_r']} R",
        f"   - 5.0 pips: {sessions_s['London_NY_Overlap']['trade_count']} lenh | Win: {sessions_s['London_NY_Overlap']['win_rate']}% | PF: {sessions_s['London_NY_Overlap']['profit_factor']} | Exp: +{sessions_s['London_NY_Overlap']['expectancy_r']} R | Net R: +{sessions_s['London_NY_Overlap']['net_r']} R",
        f"4. Cuoi My (Late NY 17:00-22:00 UTC):",
        f"   - 3.5 pips: {sessions_b['Late_NY']['trade_count']} lenh | Win: {sessions_b['Late_NY']['win_rate']}% | PF: {sessions_b['Late_NY']['profit_factor']} | Exp: {sessions_b['Late_NY']['expectancy_r']} R | Net R: {sessions_b['Late_NY']['net_r']} R",
        f"   - 5.0 pips: {sessions_s['Late_NY']['trade_count']} lenh | Win: {sessions_s['Late_NY']['win_rate']}% | PF: {sessions_s['Late_NY']['profit_factor']} | Exp: {sessions_s['Late_NY']['expectancy_r']} R | Net R: {sessions_s['Late_NY']['net_r']} R",
    ]

    page_3 = [
        "# 4. MA TRAN WALK-FORWARD OPTIMIZATION (WFO ROLLING FOLDS)",
        "Ket qua kiem dinh Walk-Forward tren cac cua so Out-of-Sample (OOS) lien tiep:",
        "-----------------------------------------------------------------------------------------",
        "Fold | Giai doan OOS                      | So lenh | OOS PF (3.5p) | OOS Exp (3.5p) | OOS PF (5.0p)",
        "-----------------------------------------------------------------------------------------",
    ]
    for f in folds:
        b_m = f["out_of_sample_base"]
        s_m = f["out_of_sample_severe"]
        t_rng = f["test_range"][:35]
        page_3.append(
            f"F{f['fold']}   | {t_rng:34s} | {b_m['trade_count']:7d} | {b_m['profit_factor']:13.2f} | {b_m['expectancy_r']:14.3f} | {s_m['profit_factor']:13.2f}"
        )
    page_3.extend([
        "-----------------------------------------------------------------------------------------",
        " ",
        "# 5. KIEM DINH TAP NGOAI MAU DOC LAP (30% HOLDOUT OUT-OF-SAMPLE)",
        f"Tap Holdout gom {holdout['bar_count']} nen tu {holdout['start_time']} den {holdout['end_time']}.",
        f"- So lenh OOS: {holdout['baseline_3_5_pips']['trade_count']} lenh",
        f"- Ty le thang OOS: {holdout['baseline_3_5_pips']['win_rate']}% | Profit Factor OOS: {holdout['baseline_3_5_pips']['profit_factor']}",
        f"- Ky vong OOS (3.5 pips): {holdout['baseline_3_5_pips']['expectancy_r']} R | Net R: {holdout['baseline_3_5_pips']['net_r']} R | MaxDD: {holdout['baseline_3_5_pips']['max_drawdown_pct']}%",
        f"- Ky vong OOS (5.0 pips): {holdout['severe_5_0_pips']['expectancy_r']} R | Net R: {holdout['severe_5_0_pips']['net_r']} R | MaxDD: {holdout['severe_5_0_pips']['max_drawdown_pct']}%",
        " ",
        "PHAN RA HOLDOUT THEO PHIEN:",
        f"- Overlap (13-17 UTC): {holdout['sessions_baseline']['London_NY_Overlap']['trade_count']} lenh | Win: {holdout['sessions_baseline']['London_NY_Overlap']['win_rate']}% | PF: {holdout['sessions_baseline']['London_NY_Overlap']['profit_factor']} | Exp: +{holdout['sessions_baseline']['London_NY_Overlap']['expectancy_r']} R",
        f"- Asian (00-08 UTC):   {holdout['sessions_baseline']['Asian']['trade_count']} lenh | Win: {holdout['sessions_baseline']['Asian']['win_rate']}% | PF: {holdout['sessions_baseline']['Asian']['profit_factor']} | Exp: +{holdout['sessions_baseline']['Asian']['expectancy_r']} R",
        f"- London (08-13 UTC):  {holdout['sessions_baseline']['London']['trade_count']} lenh | Win: {holdout['sessions_baseline']['London']['win_rate']}% | PF: {holdout['sessions_baseline']['London']['profit_factor']} | Exp: {holdout['sessions_baseline']['London']['expectancy_r']} R",
        f"- Late NY (17-22 UTC): {holdout['sessions_baseline']['Late_NY']['trade_count']} lenh | Win: {holdout['sessions_baseline']['Late_NY']['win_rate']}% | PF: {holdout['sessions_baseline']['Late_NY']['profit_factor']} | Exp: {holdout['sessions_baseline']['Late_NY']['expectancy_r']} R",
    ])

    page_4 = [
        "# 6. NHAT KY LENH NGOAI MAU DAI DIEN (REPRESENTATIVE OOS TRADES)",
        "Mau 8 giao dich ngoai mau (Holdout Out-of-Sample) truy vet chi tiet:",
        "-----------------------------------------------------------------------------------------",
        "ID | Thoi gian vao        | Phien    | Vi the | Vao     | SL      | TP      | Ly do | Net R",
        "-----------------------------------------------------------------------------------------",
    ]
    for tr in holdout["sample_trades"][:8]:
        d_str = tr["entry_datetime"][5:16]
        s_short = tr["session"].replace("London_NY_Overlap", "Overlap")[:7]
        page_4.append(
            f"{tr['trade_id']:2d} | {d_str:16s} | {s_short:8s} | {tr['side']:6s} | {tr['entry_price']:7.1f} | {tr['sl_price']:7.1f} | {tr['tp_price']:7.1f} | {tr['exit_reason']:5s} | {tr['r_multiple']:+5.2f}R"
        )
    page_4.extend([
        "-----------------------------------------------------------------------------------------",
        " ",
        "# 7. PHAN TICH RUI RO & KHUYEN NGHI NGHIEN CUU TIEP THEO",
        "1. Bẫy thanh khoản Phien Au (London Trap): London morning thuong xuyen tao cu pha vo gia",
        "   (Judas Swing) de quét thanh khoan dinh/day phien A, khien ty le thang sut con 20.0%.",
        "2. Hieu ung Overlap: Chi khi phien My mo cua (13:00-17:00 UTC), dong tien that tu ca 2 trung tam",
        "   moi tao du dong luc dua gia cham TP 2.0R (Win rate 40-50%, PF 1.17-1.69).",
        "3. Kiem dinh do nhay: Khi chi phi tang tu 3.5 len 5.0 pips, Expectancy sut them 0.017 R/lenh.",
        "4. Danh gia duyet: CAN THEM BANG CHUNG (INSUFFICIENT EVIDENCE FOR LIVE DEPLOYMENT) do:",
        "   - Do phu du lieu chi gom 4,582 nen (~2.5 thang tren hop dong tuong lai GC=F).",
        "   - Chien luoc can duoc mo rong kiem dinh tren du lieu tick Vang giao ngay (Spot OTC/CFD)",
        "     xuyen suot 3-5 nam va bat buoc phai co Bo loc cam giao dich phien Au sang va Cuoi My.",
        " ",
        "ZUPIRUS Quant Lab - Bao cao luu tru nghien cuu noi bo | Ban Quyen 2026",
    ])

    return [page_1, page_2, page_3, page_4]


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
        title="ZUPIRUS QUANT LAB - XAU/USD BREAKOUT & RETEST M15 (SAMPLE)",
        subtitle="Empirical Study: Expectancy After Costs & Cross-Session Heterogeneity (v1.0)",
        pages_lines=sample_pages,
    )
    sample_path.write_bytes(sample_bytes)

    full_bytes = build_pdf_bytes(
        title="ZUPIRUS QUANT LAB - FULL QUANTITATIVE RESEARCH REPORT",
        subtitle="Breakout & Retest XAU/USD M15: Full WFO Matrix & Session Dissection (v1.0)",
        pages_lines=full_pages,
    )
    full_path.write_bytes(full_bytes)

    print(f"Generated Sample PDF: {sample_path} ({len(sample_bytes)} bytes)")
    print(f"Generated Full PDF:   {full_path} ({len(full_bytes)} bytes)")

    # Register Draft report in DB
    now_ts = time.time()
    rep_id = "rep_xauusd_breakout_retest_m15_v1"
    slug = "breakout-retest-xauusd-m15-ky-vong-loi-nhuan-sau-chi-phi-va-phan-ra-phien-v1"
    title = "Breakout & Retest XAU/USD M15: Kỳ Vọng Lợi Nhuận Sau Chi Phí & Phân Rã Theo Phiên"
    summary = "Nghiên cứu định lượng thực nghiệm 4,582 nến M15 Vàng tương lai (GC=F) với mô hình chi phí 3.5 pips và 5.0 pips: Tổng thể âm (-0.096 R), chỉ giữ được lợi thế thực chất tại phiên Chồng lấn Âu - Mỹ (+0.102 R) và phiên Á (+0.157 R)."
    description = (
        "Báo cáo nghiên cứu độc lập giải quyết bài toán: Liệu mô hình Breakout & Retest kinh điển trên khung M15 Vàng "
        "có còn kỳ vọng dương sau khi trừ spread và trượt giá? Kết quả Walk-Forward Optimization (WFO) cho thấy chiến lược "
        "thua lỗ nếu áp dụng 24/5 (-0.096 R/lệnh), bộc lộ bẫy quét thanh khoản phiên Âu sáng (London Trap) với tỷ lệ thắng chỉ 20.0%, "
        "và chỉ tạo ra lợi thế cạnh tranh thực sự khi hội tụ dòng tiền phiên Chồng lấn Âu - Mỹ (13:00 - 17:00 UTC, PF 1.17 - 1.69) "
        "hoặc biên độ chặt phiên Á (PF 1.26). Toàn bộ dữ liệu, ma trận WFO, mô hình va chạm cùng nến và khuyến nghị nghiên cứu được trình bày chi tiết."
    )

    highlights = [
        "Định nghĩa toán học chặt chẽ: Swing 20 nến, Range Expansion >= 1.0 ATR, Wick Rejection >= 0.30, SL/TP 2.0R.",
        "Quy tắc va chạm cùng nến bảo thủ (Conservative Same-bar Collision): Tính chạm SL trước khi High & Low cùng nến chạm mốc.",
        "Mô hình chi phí thực tế: Đánh giá độ nhạy giữa kịch bản cơ sở (3.5 pips) và kịch bản chi phí cao (5.0 pips).",
        "Phân rã dị biệt sâu sắc giữa 4 phiên: Lợi thế tại Overlap (+0.102 R) và Á (+0.157 R); bẫy thanh khoản tại Âu sáng (-0.437 R).",
        "Kết luận trung thực: Cần thêm bằng chứng dữ liệu Spot nhiều năm trước khi triển khai thực tế.",
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
        "verdict_reason": "Chiến lược tổng thể âm (-0.096 R/lệnh); phụ thuộc chặt chẽ vào bộ lọc phiên; mẫu dữ liệu 4,582 nến GC=F cần bổ sung dữ liệu spot dài hạn.",
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
            ) VALUES (?, ?, 'v1.0', ?, ?, 'Bản thảo ban đầu kiểm định WFO và phân rã 4 phiên.', ?, ?, ?)
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
