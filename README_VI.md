# ZUPIRUS Quant Lab · Hệ Thống Giao Dịch Định Lượng Tự Hành

> **Thực thi 100% Điện toán đám mây Cloud MT5 · Không EA · Không VPS · 4 Màng Lọc Bảo Vệ Vốn Bắt Buộc**

ZUPIRUS Quant Lab là nền tảng giao dịch định lượng chuẩn tổ chức chuyên biệt cho chiến lược nến đóng XAUUSD (Vàng). Hệ thống kết nối trực tiếp đến tài khoản MT5 của nhà đầu tư qua MetaApi Cloud Bridge (máy chủ London G2) và phân bổ lệnh song song với độ trễ tính bằng mili-giây.

---

## 4 Trụ Cột Nền Tảng

1. **Kiến Trúc Thực Thi Trực Tiếp Đám Mây (Direct-to-User):**
   - Loại bỏ hoàn toàn việc cài đặt file EA `.ex5` trên máy khách.
   - Khách hàng không cần tốn tiền thuê VPS hay lo lắng mất điện, mất mạng.
   - Không phụ thuộc vào tài khoản Master trung gian (triệt tiêu độ trễ kép và trượt khối lượng).
2. **4 Màng Lọc An Toàn Bắt Buộc (Tặng mặc định 100% ở mọi gói):**
   - **Màng lọc 1:** Bắt buộc có Stop Loss & Chống Martingale (Tự động gắn SL ATR(14) 35 pips / $3.50 nếu thiếu; tối đa 2 lệnh đồng thời).
   - **Màng lọc 2:** Cửa sổ bảo vệ tin tức News Shield (Khóa lệnh ±15 phút trước và sau khi ra tin USD High-Impact: CPI, NFP, FED).
   - **Màng lọc 3:** Chống trượt giá Entry Slippage Guard (Hủy lệnh ngay nếu giá thị trường lệch quá 20 pips / $2.00).
   - **Màng lọc 4:** Khóa phân tán Redis Deduplication (Chống trùng lặp lệnh tuyệt đối trong 60 giây).
3. **Mô Hình Giá Minh Bạch & Quy Đổi Tỷ Giá USD → VND Thực Tế:**
   - Phí Hạ Tầng Cloud MT5: $10/tháng/slot.
   - Phí Dịch Vụ Tín Hiệu: Starter ($20/tháng), Growth ($35/tháng), Prop Firm Alpha ($49/tháng).
   - Tỷ giá USD/VND lấy thời gian thực, cache Redis, làm tròn lên bội số 1.000đ và chốt cố định 20 phút khi tạo mã SePay VietQR.
4. **Công Cụ Dòng Lệnh Agent-Native CLI (`zupirus-cli`):**
   - Hỗ trợ thao tác hoàn toàn qua Terminal với cờ `--json` chuẩn máy đọc.

---

## Cấu Trúc 3 Tên Miền

- `https://zupirus.com`: Trang chủ giới thiệu công nghệ, 4 màng lọc an toàn và bảng giá tương tác USD / VNĐ.
- `https://app.zupirus.com`: Ứng dụng người dùng kết nối MT5, theo dõi hạn dùng (Cloud & Tín hiệu), thanh toán VietQR và tinh chỉnh đòn bẩy.
- `https://adm.zupirus.com`: Trung tâm điều hành Admin giám sát tỷ giá, doanh thu, telemetry MetaApi và nhật ký kiểm toán tín hiệu.

---

## Tài Liệu Tham Khảo

- [Kiến trúc hệ thống](docs/ARCHITECTURE.md)
- [Đặc tả API](docs/API.md)
- [Cơ chế thanh toán & Tỷ giá](docs/BILLING.md)
- [Hướng dẫn triển khai VPS](docs/DEPLOYMENT.md)
# ZUPIRUS Quant Lab · Hệ Thống Giao Dịch Định Lượng Tự Hành

> **Thực thi 100% Điện toán đám mây Cloud MT5 · Không EA · Không VPS · 4 Màng Lọc Bảo Vệ Vốn Bắt Buộc**

ZUPIRUS Quant Lab là nền tảng giao dịch định lượng chuẩn tổ chức chuyên biệt cho chiến lược nến đóng XAUUSD (Vàng). Hệ thống kết nối trực tiếp đến tài khoản MT5 của nhà đầu tư qua MetaApi Cloud Bridge (máy chủ London G2) và phân bổ lệnh song song với độ trễ tính bằng mili-giây.

---

## 4 Trụ Cột Nền Tảng

1. **Kiến Trúc Thực Thi Trực Tiếp Đám Mây (Direct-to-User):**
   - Loại bỏ hoàn toàn việc cài đặt file EA `.ex5` trên máy khách.
   - Khách hàng không cần tốn tiền thuê VPS hay lo lắng mất điện, mất mạng.
   - Không phụ thuộc vào tài khoản Master trung gian (triệt tiêu độ trễ kép và trượt khối lượng).
2. **4 Màng Lọc An Toàn Bắt Buộc (Tặng mặc định 100% ở mọi gói):**
   - **Màng lọc 1:** Bắt buộc có Stop Loss & Chống Martingale (Tự động gắn SL ATR(14) 35 pips / $3.50 nếu thiếu; tối đa 2 lệnh đồng thời).
   - **Màng lọc 2:** Cửa sổ bảo vệ tin tức News Shield (Khóa lệnh ±15 phút trước và sau khi ra tin USD High-Impact: CPI, NFP, FED).
   - **Màng lọc 3:** Chống trượt giá Entry Slippage Guard (Hủy lệnh ngay nếu giá thị trường lệch quá 20 pips / $2.00).
   - **Màng lọc 4:** Khóa phân tán Redis Deduplication (Chống trùng lặp lệnh tuyệt đối trong 60 giây).
3. **Mô Hình Giá Minh Bạch & Quy Đổi Tỷ Giá USD → VND Thực Tế:**
   - Phí Hạ Tầng Cloud MT5: $10/tháng/slot.
   - Phí Dịch Vụ Tín Hiệu: Starter ($20/tháng), Growth ($35/tháng), Prop Firm Alpha ($49/tháng).
   - Tỷ giá USD/VND lấy thời gian thực, cache Redis, làm tròn lên bội số 1.000đ và chốt cố định 20 phút khi tạo mã SePay VietQR.
4. **Công Cụ Dòng Lệnh Agent-Native CLI (`zupirus-cli`):**
   - Hỗ trợ thao tác hoàn toàn qua Terminal với cờ `--json` chuẩn máy đọc.

---

## Cấu Trúc 3 Tên Miền

- `https://zupirus.com`: Trang chủ giới thiệu công nghệ, 4 màng lọc an toàn và bảng giá tương tác USD / VNĐ.
- `https://app.zupirus.com`: Ứng dụng người dùng kết nối MT5, theo dõi hạn dùng (Cloud & Tín hiệu), thanh toán VietQR và tinh chỉnh đòn bẩy.
- `https://adm.zupirus.com`: Trung tâm điều hành Admin giám sát tỷ giá, doanh thu, telemetry MetaApi và nhật ký kiểm toán tín hiệu.

---

## Tài Liệu Tham Khảo

- [Kiến trúc hệ thống](docs/ARCHITECTURE.md)
- [Đặc tả API](docs/API.md)
- [Cơ chế thanh toán & Tỷ giá](docs/BILLING.md)
- [Hướng dẫn triển khai VPS](docs/DEPLOYMENT.md)

