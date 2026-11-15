# Kỹ Năng: Market Regime Scanner (market_regime_scanner)

## Mục Đích
Phân tích bối cảnh và chế độ biến động thị trường tại thời điểm phát sinh tín hiệu giao dịch. Kỹ năng này không phát sinh lệnh mà cung cấp dữ liệu định lượng về độ biến động ATR(14), biên độ nến và phiên giao dịch hiện hành (Á, Âu, Mỹ hoặc Giao phiên London-NY).

## Điều Kiện Kích Hoạt
- Khi tiếp nhận một tín hiệu mới cần gắn nhãn snapshot bối cảnh thị trường.
- Khi Agent kiểm tra điều kiện biến động (tránh vào lệnh khi thị trường đóng băng hoặc biến động quá mức bất thường).

## Các Bước Suy Luận Chuẩn
1. Truy vấn 14 đến 30 nến gần nhất (khung M15 hoặc M1) từ TimescaleDB / SQLite.
2. Tính True Range (TR) cho từng nến: `TR = max(High - Low, abs(High - Close_prev), abs(Low - Close_prev))`.
3. Tính đường trung bình động ATR 14 chu kỳ.
4. Xác định phiên giao dịch theo giờ UTC:
   - 00:00 - 08:00 UTC: Phiên Á (Tokyo / Sydney)
   - 08:00 - 13:00 UTC: Phiên Âu (London)
   - 13:00 - 16:00 UTC: Giao phiên London & New York (Thanh khoản đỉnh)
   - 16:00 - 22:00 UTC: Phiên Mỹ (New York chiều)
   - 22:00 - 24:00 UTC: Giãn phiên / Rollover (Rủi ro spread cao)
5. Phân loại chế độ biến động (Volatility Regime):
   - XAUUSD ATR < $2.0: `LOW_VOLATILITY`
   - XAUUSD ATR $2.0 - $5.5: `NORMAL_VOLATILITY`
   - XAUUSD ATR $5.5 - $10.0: `HIGH_VOLATILITY`
   - XAUUSD ATR > $10.0: `EXTREME_VOLATILITY`

## Định Dạng Đầu Ra
```json
{
  "symbol": "XAUUSD",
  "session": "London/NY Overlap",
  "atr_14": 4.25,
  "volatility_regime": "NORMAL_VOLATILITY",
  "last_close": 2684.50,
  "is_safe_volatility": true
}
```
