# Kỹ Năng: Liquidity & Spread Auditor (liquidity_spread_auditor)

## Mục Đích
Kiểm toán nguyên nhân gốc rễ (Root Cause Analysis) khi một vị thế chạm ngưỡng Stop Loss (SL). Giúp AI Agent phân biệt minh bạch giữa việc "Chiến lược nhận định sai hướng thị trường" với "Bị quét SL do giãn spread phiên đêm" hoặc "Bị săn thanh khoản (Liquidity Sweep) tại các vùng đỉnh/đáy then chốt".

## Điều Kiện Kích Hoạt
- Khi có lệnh giao dịch chạm Stop Loss (SL) hoặc đóng vị thế với PnL âm.
- Trong quy trình phản tư sau giao dịch (Post-trade Reflection) tại `app/hindsight.py`.

## Các Bước Suy Luận Chuẩn
1. Xác định thời điểm khớp lệnh thoát và mức giá dừng lỗ `stop_loss`.
2. Kiểm tra giờ thoát lệnh theo UTC:
   - Nếu trong khoảng 21:45 - 23:15 UTC (Giờ giao phiên New York / Sydney): Nguy cơ giãn spread tự nhiên của các sàn môi giới (Rollover Spread Expansion).
3. Đối chiếu giá Bid/Ask thực tế so với biên độ nến M1 tại thời điểm đóng lệnh:
   - Nếu `abs(exit_price - stop_loss) <= 3 pips` và nến tiếp theo rút chân ngược lại: Gắn nhãn `LIQUIDITY_SWEEP` (Quét thanh khoản).
   - Nếu spread tại thời điểm đóng > 6 pips đối với XAUUSD: Gắn nhãn `SPREAD_SPIKE_ROLLOVER`.
   - Nếu giá nến M1 đóng nến xuyên thủng dứt khoát qua SL: Gắn nhãn `TREND_FAIL` (Sai xu hướng thị trường).
4. Đưa ra khuyến nghị điều chỉnh cho đội Agent (ví dụ: cần nới rộng vùng đệm SL thêm 0.5x ATR hoặc ngắt giao dịch trong khung giờ 22:00 - 23:30 UTC).

## Định Dạng Đầu Ra
```json
{
  "loss_category": "LIQUIDITY_SWEEP",
  "symbol": "XAUUSD",
  "stop_loss": 2680.00,
  "exit_price": 2679.80,
  "distance_to_sl_pips": 2.0,
  "max_spread_observed": 4.2,
  "is_spread_anomaly": false,
  "audit_notes": "Giá chỉ chạm qua SL 2.0 pips trước khi rút chân. Khuyến nghị cộng thêm 0.3x ATR vùng đệm cho các lệnh bán/mua tại hỗ trợ/kháng cự cứng."
}
```
