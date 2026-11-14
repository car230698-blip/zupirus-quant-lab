# Ranh giới an toàn và các giới hạn đã biết

## Đã triển khai

- Role customer/admin, service credential riêng; ownership query ở backend, không chỉ ẩn nút UI.
- Scrypt password hashing, hashed session/device/pairing tokens, expiring one-time pairing, host-only cookies, CSRF header/Origin, CSP không inline script, HTML escape cho dữ liệu người dùng.
- Từ chối role tự khai khi đăng ký, UNIQUE broker login/server, DB CHECK không cho REAL account/signal.
- Local EA checks Demo trước init, trước mọi WebRequest và trước OrderSend; account/server thay đổi thì dừng.
- Durable write-before-send; transaction cấp send permit; immutable final receipt; broker history reconciliation, magic per dispatch; không tự resend unknown.
- Giới hạn tiền risk tại backend dựa trên equity telemetry; EA tính lot và risk thực tế theo contract broker. Backend và local áp dụng ngưỡng nhỏ hơn.
- Admin halt, audit records, volume bền vững, no privileged container, no-new-privileges, read-only root filesystem.

## Không được suy diễn thành bảo đảm

1. Backend không có broker API hoặc attestation để tự chứng minh `mode=DEMO`, equity, risk_amount, ticket/deal là thật. Nó ràng buộc identity và loại môi trường khai báo; EA chính thức cưỡng chế tại terminal. Người sửa binary hoặc tự viết client có thể khai gian. Đây không phải khóa Real có sức chống đối thủ kiểm soát terminal.
2. Không có exactly-once end-to-end transaction với broker. Thiết kế ưu tiên bỏ lỡ lệnh hơn rủi ro resend. Hỏng/rollback storage, chỉnh sửa EA/DB hoặc vận hành sai có thể phá invariants. Không tuyên bố tuyệt đối không trùng ngoài giả định đã nêu.
3. Receipt chỉ ghi một entry deal đầu tiên và order ticket để xác nhận có fill; chưa thu thập đầy đủ mọi partial fill, exit deal, commission/swap và P&L theo từng vị thế Demo. Balance/equity/positions lấy từ heartbeat terminal. Không phải accounting ledger dùng để quyết toán khách hàng.
4. Stop loss không đảm bảo lỗ tối đa trong gap hoặc execution slippage. Số tiền risk được tính trước khi gửi, không phải guarantee tài chính.
5. Web chưa có MFA, reset password/verify email, CAPTCHA, WAF/rate limiting toàn diện hay kiểm thử xâm nhập. Login có rate-limit theo email/IP; sau reverse proxy dùng địa chỉ proxy nội bộ nên không được coi là giải pháp chống DDoS đầy đủ.
6. Audit trong SQLite không append-only/tamper-evident đối với root hoặc người có quyền DB. Không có HA, distributed failover, regulatory certification hay SLA.
7. AI là read-only advisory. Có thể sai; không được quyền sửa risk/strategy hoặc đặt lệnh. Input news/images/questions là dữ liệu không đáng tin. Cung cấp AI key đồng nghĩa dữ liệu dashboard hoặc ảnh được gửi tới provider đã cấu hình.
8. Lịch kinh tế thủ công có thể thiếu. Dữ liệu Replay/OOS tổng hợp không chứng minh hiệu quả đầu tư.
9. Demo strategy cố định chỉ nhằm nghiệm thu đường truyền. Không có cam kết win rate, lợi nhuận hoặc khuyến nghị đem chạy tiền thật.
10. Code MQ5 đã được kiểm tra tĩnh nhưng chưa được compiler MT5 xác minh. Phải xem đó là source candidate cho tới khi compile và nghiệm thu broker hoàn tất.

## Điều kiện chấp nhận bản Demo

Có thể chấp nhận để review source và kiểm thử Replay sau khi kiểm tra môi trường. Chưa nên coi là hoàn tất nghiệm thu VPS/MT5 cho tới khi Docker smoke, compile EA, kiểm thử broker và UI browser thật pass. Các mục chưa kiểm chứng đều được ghi trong TEST_REPORT, không bị chuyển thành “pass” bằng mock.
