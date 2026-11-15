# Kỹ Năng: Macro News Interpreter (macro_news_interpreter)

## Mục Đích
Phân tích và diễn giải bối cảnh kinh tế vĩ mô xoay quanh các tin tức kinh tế quan trọng (đặc biệt là USD: CPI, Non-Farm Payrolls, FOMC Interest Rate Decision, GDP, PPI). Giúp AI Agent đánh giá độ nhạy tin tức của các nguồn tín hiệu và lý giải những đợt trượt giá bất thường.

## Điều Kiện Kích Hoạt
- Khi tiếp nhận tín hiệu mới cần kiểm tra khoảng cách tới tin tức kinh tế USD.
- Khi đối chiếu lệnh thua để xác định xem lệnh có bị quét bởi cú giật tin tức hay không.
- Khi đánh giá nguồn tín hiệu (nguồn nào hay mở lệnh cờ bạc trước thềm tin tức đỏ).

## Các Bước Suy Luận Chuẩn
1. Truy vấn bảng `news` với bộ lọc tiền tệ `USD` và mức độ tác động `HIGH` trong khung thời gian quanh thời điểm chỉ định.
2. Tính toán khoảng cách thời gian tuyệt đối (phút): `distance_minutes = abs(news_timestamp - signal_timestamp) / 60.0`.
3. Đánh giá trạng thái rủi ro vĩ mô:
   - `distance_minutes <= 30`: `BLACKOUT_HIGH_RISK` (Cửa sổ đóng băng bắt buộc của Màng lọc Tin tức ZUPIRUS).
   - `30 < distance_minutes <= 60`: `PRE_NEWS_VOLATILITY` (Thị trường nén biến động trước tin).
   - `distance_minutes > 60`: `CLEAR_MACRO_WINDOW` (Bối cảnh vĩ mô an toàn cho giao dịch định lượng).
4. Đánh giá độ nhạy tin tức: Nếu nguồn tín hiệu phát sinh lệnh trong vòng 15 phút trước thềm CPI/FOMC, gắn cờ cảnh báo `HIGH_NEWS_SENSITIVITY` (nguồn có xu hướng đánh cược tin tức).

## Định Dạng Đầu Ra
```json
{
  "currency": "USD",
  "nearest_event_title": "US Core CPI MoM",
  "distance_minutes": 18.5,
  "is_in_blackout": true,
  "risk_status": "BLACKOUT_HIGH_RISK",
  "recommendation": "Màng lọc Tin tức cần kích hoạt chặn khớp lệnh để bảo vệ vốn khách hàng."
}
```
