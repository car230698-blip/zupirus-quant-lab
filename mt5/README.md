# Nghiệm thu liên kết MT5 demo

Chạy bản thử với `ENABLE_COPY_DEMO_PILOT=true` và token admin riêng. Với Docker Compose, đặt biến này trong `.env` trước khi tạo lại container thử. Dùng HTTPS hoặc SSH tunnel tới cổng loopback của bản thử.

1. Với token admin, gọi `POST /api/control/copy-demo/links`. Giữ `id` để tra trạng thái và nhập `pairingCode` vào EA trong vòng 10 phút.
2. Sao chép `Zupirus_Demo_Link_EA.mq5` vào `MQL5/Experts` của terminal, mở MetaEditor và biên dịch. Trên MT5 demo, thêm URL bản thử vào danh sách cho phép WebRequest trong Options → Expert Advisors.
3. Gắn EA vào một chart. Nhập cùng URL trong `InpServerUrl` và mã trong `InpPairingCode`. EA lưu thông tin xác thực trong thư mục `MQL5/Files` của terminal.
4. Gọi `GET /api/control/copy-demo/links/<id>` bằng token admin. Xác minh `lastSeen` cập nhật sau heartbeat, và `balance`, `equity` khớp MT5. Sau khi khởi động lại terminal trên cùng tài khoản, kiểm tra heartbeat tiếp tục cập nhật.

Nếu mã đã tiêu thụ nhưng MT5 chưa nhận được phản hồi ghép nối, admin gọi `DELETE /api/control/copy-demo/links/<id>` để thu hồi liên kết, tạo mã mới rồi gắn lại EA. Việc thu hồi cũng ngắt quyền gửi heartbeat của EA cũ.

EA này chỉ gửi thông tin tài khoản demo. Kiểm thử phát tín hiệu và thực thi giao dịch sẽ dùng một bước nghiệm thu riêng.
