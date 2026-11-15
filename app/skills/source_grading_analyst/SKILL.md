# Kỹ Năng: Source Grading Analyst (source_grading_analyst)

## Mục Đích
Thực thi quy trình đối chiếu và chấm điểm định lượng (EOD Candle Grader) cho toàn bộ các nguồn tín hiệu trong kho theo dõi ẩn `SHADOW_ONLY`. Đánh giá hiệu suất thực tế trên dữ liệu nến M1, tuân thủ kỷ luật rủi ro và chấm điểm tín nhiệm (Source Trust Score từ 0 đến 100) để phục vụ việc tuyển chọn nguồn hạt giống hoặc hạ cấp tự động.

## Điều Kiện Kích Hoạt
- Cuối mỗi ngày giao dịch (EOD - End of Day).
- Khi Admin yêu cầu tái đánh giá và sắp xếp lại bảng xếp hạng (Leaderboard) các nguồn tín hiệu trên `adm.zupirus.com`.

## Các Bước Suy Luận Chuẩn
1. Truy vấn toàn bộ các tín hiệu `shadow_signals` ở trạng thái `PENDING`.
2. Truy xuất chuỗi nến M1 từ thời điểm phát tín hiệu tới 24 giờ tiếp theo:
   - Đo lường độ gồng lỗ cực đại (Maximum Adverse Excursion - MAE) và lợi nhuận đỉnh cực đại (Maximum Favorable Excursion - MFE).
3. **Áp dụng Quy Tắc Chạm Kép Bảo Thủ (Conservative Dual-Touch Rule)**:
   - Nếu trong cùng 1 thanh nến M1 giá chạm cả ngưỡng Stop Loss và Take Profit, hệ thống **bắt buộc ghi nhận chạm Stop Loss trước** (`CONSERVATIVE_DUAL_HIT_SL`) để loại trừ mọi rủi ro ảo hóa thành tích giao dịch.
4. Tổng hợp chỉ số hiệu suất:
   - Profit Factor = Tổng PnL thắng / Tổng PnL thua
   - Win Rate = Số lệnh thắng / Tổng số lệnh
   - Max Drawdown (pips)
   - Tỷ lệ tuân thủ Stop Loss (100% lệnh phải có SL).
5. Tính điểm tín nhiệm Trust Score theo trọng số chuẩn:
   - 35 điểm: Profit Factor (chuẩn hóa trần 2.5)
   - 30 điểm: Max Drawdown thấp & 100% tuân thủ SL
   - 20 điểm: Win Rate (dao động 45% - 70%)
   - 15 điểm: Độ tin cậy kích thước mẫu (>= 30 lệnh)

## Định Dạng Đầu Ra
```json
{
  "evaluated_count": 18,
  "sources_updated": 4,
  "top_source": {
    "name": "TradingView Webhook Primary",
    "trust_score": 88.5,
    "profit_factor": 1.82,
    "win_rate": 0.64,
    "status": "ACTIVE_LIVE"
  }
}
```
