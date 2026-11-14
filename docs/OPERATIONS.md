# Vận hành Demo trên VPS

## Phạm vi triển khai

Chạy một replica mỗi service. Không chạy thêm Execution hoặc Research worker bằng tay trên cùng volume. Chỉ API được truy cập qua proxy; DB không mở cổng. Caddy hỗ trợ HTTPS tự động; nếu DNS/firewall chưa đúng, sử dụng Replay loopback và SSH tunnel, không mở cổng 8080 toàn Internet.

`start.sh` không tự cài Docker, không đổi firewall/DNS và không deploy lên tài khoản cloud nào. Người vận hành cần đáp ứng điều kiện môi trường trong README.

## Quan sát

- API `/healthz`: kiểm tra DB truy cập được; không khẳng định broker hoặc worker đang online.
- Docker healthcheck của Execution/Research dựa trên heartbeat riêng, tối đa 60 giây.
- Dashboard hiển thị heartbeat quá 20 giây là offline. Một account MT5 chỉ nhận permit khi heartbeat mới trong 30 giây.
- Unknown/intent và lack of quote là tình trạng cần xem xét; không auto-retry trading.
- Log không ghi pairing code, bearer, password hay AI key. Bảo vệ `.env` ngoài source control.
- Lịch tin cần quản trị cập nhật từ nguồn đáng tin. Không có feed tin tự động mặc định.

## Backup

Trong API container, chạy `python scripts/backup.py`; script dùng SQLite online backup API cho cả DB ứng dụng và research. Copy thư mục `/data/backups/<UTC timestamp>/` ra nơi lưu độc lập, mã hóa và giới hạn quyền. Snapshot hai file không phải một transaction chung; nên pause copy và dừng worker trong maintenance khi cần snapshot nhất quán toàn hệ thống.

Chụp/copy `.env` riêng bằng cơ chế bí mật, không đưa vào archive chia sẻ. Giữ terminal FILE_COMMON journals và broker history độc lập.

## Restore

1. Pause toàn bộ account, dừng EA và feeder; xác minh broker positions/deals hiện tại.
2. Dừng API, Execution, Research trước khi thay database.
3. Restore hai DB tương ứng, giữ owner UID 10001 trong volume. Không xóa WAL trong khi còn process mở DB.
4. Khởi động API ở trạng thái copy vẫn pause. Đối chiếu mọi dispatch đã phát sau thời điểm backup với broker và journals. Database rollback có thể lùi bộ đếm dispatch; **không bật copy trước khi xử lý đầy đủ việc này**.
5. Không tái dùng môi trường restore để gửi các dispatch cũ. Chỉ trở lại sau nghiệm thu bảo toàn mapping id/magic/receipt và giám sát Demo.

Bản này không có automation restore hoặc operator tool giải quyết ambiguous intent; đó là giới hạn cần chấp nhận cho bản Demo.

## Nâng cấp và bí mật

Schema hiện là phiên bản đầu, dùng `CREATE TABLE IF NOT EXISTS`; chưa có framework migration nâng cấp giữa các release. Backup trước thay đổi schema. Dependencies được khóa trong `requirements.lock`; kiểm tra lại vulnerability/dependency compatibility trước phát hành mới.

Admin bootstrap không có email verification, reset password self-service hay MFA. Muốn đổi password hiện hữu cần bổ sung quy trình quản trị an toàn; thay `ADMIN_PASSWORD` trong env không cập nhật DB. Không chia sẻ account Admin; không chạy bản này như dịch vụ khách hàng Real.

Đổi `FEED_TOKEN` cần restart API và cập nhật feeder. Thu hồi credential EA qua web làm pause copy, sau đó ghép lại; không bỏ unresolved intents. Đổi AI key không cần thay Execution.
