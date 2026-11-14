# Nghiệm thu cuối cùng trên MT5 Demo

**Chưa thực hiện trong môi trường bàn giao.** Chỉ ký nghiệm thu sau khi có log MetaEditor, Experts/Journal và lịch sử order/deal thật trên tài khoản Demo. Không chuyển sang Real.

## Chuẩn bị

1. VPS đã chạy Compose, DNS/TLS của hai tên miền đúng; `/healthz` trả `status=ok` và `real_trading=false`. Đăng nhập Admin tại `adm.zupirus.com`, thấy cả hai heartbeat.
2. Trên Windows, cài MT5/MetaEditor chính thức của broker và đăng nhập **Demo**. Đồng bộ đồng hồ Windows/NTP; không dùng Contest. Chọn broker có XAU/USD contract metadata.
3. Chép `ea/Zupirus_Copy_EA.mq5` vào `MQL5/Experts/ZUPIRUS/`, mở bằng MetaEditor, nhấn F7. Lưu compile log. Yêu cầu **0 error**, xem và xử lý tất cả warnings trước khi gắn EA. File `.ex5` được tạo trên Windows, không được cung cấp giả trong gói.
4. MT5 → Tools → Options → Expert Advisors → cho phép WebRequest tới `https://zupirus.com`; bật Algo Trading.
5. Trên web khách, tạo tài khoản với login và server đúng nguyên văn từ MT5. Lấy mã ghép nối 5 phút. Gắn EA vào đúng một chart; đặt `PairingCode`, `ApiURL` không có dấu `/` cuối. Nếu broker có nhiều alias vàng, đặt `GoldSymbol` chính xác; EA sẽ từ chối đoán khi mơ hồ.
6. Web phải có heartbeat và đúng số dư/equity của Demo. Sau khi thành công, bỏ pairing code khỏi preset chia sẻ; không chép token hoặc FILE_COMMON cho người khác.

## Nạp giá trung tâm (không có EA Master)

Trên Windows chạy một **dịch vụ chỉ đọc tick** từ MT5 Demo:

- Python được broker/MetaTrader5 Python package hỗ trợ; cài `MetaTrader5`, `httpx`, `python-dotenv`.
- Chép riêng `scripts/feed_mt5.py` và `.env` chỉ gồm `API_URL`, `FEED_TOKEN`, `MT5_SYMBOL` (không chép admin password/AI key).
- Chạy `python feed_mt5.py` trong thư mục chứa file và `.env` đó. Script không gọi lệnh trading.
- Terminal feeder và EA Copy có thể khác nhau, nhưng giá/reference phải cùng đơn vị XAU/USD. EA kiểm tra drift theo giá broker khách.
- Khi thị trường đóng cuối tuần hoặc tick cũ, feeder không phát dữ liệu mới, Execution không tự tạo signal Demo. Replay vẫn chạy. Không nới điều kiện freshness để ép nghiệm thu.

## Ma trận nghiệm thu

| Ca thử | Thao tác | Tiêu chí pass |
|---|---|---|
| Ghép nối | Dùng mã đúng rồi thử lại mã đó | Lần đầu thành công, lần hai bị từ chối |
| Sai identity | Ghép với login/server khác | HTTP 403; không gửi lệnh |
| Real hard lock | Thử gắn EA trên Real với Algo Trading đang tắt | `INIT_FAILED` trước ghép nối/giao dịch; backend REAL trả 422 |
| Bật/tạm dừng | Bật copy rồi pause trên web | Pause chặn queued mới; vị thế cũ vẫn có SL/TP, không tự đóng |
| Signal thực | Chờ SMA giao cắt khi có tick Demo mới | Một dispatch, một lần OrderSend, broker order và entry deal khớp UI |
| Rủi ro | Hạ web/local risk, tăng spread giả lập bằng ngưỡng rất thấp | EA/Backend từ chối; lot không vượt budget hoặc min-lot ép tăng |
| Margin/hạn lệnh | Cấu hình Demo không đủ margin hoặc đã đủ vị thế | Không mở thêm vị thế |
| SL/TP | Kiểm tra order/position tại broker | SL/TP đã gửi, hợp lệ theo stop level, không có vị thế naked do retry |
| Report bị mất | Dùng firewall/proxy thử nghiệm chặn `/report` sau khi broker khớp | Khi mở mạng, khôi phục cùng dispatch; số entry order không tăng |
| Terminal restart | Restart ngay sau send trước receipt | EA đối soát history theo magic; báo lại cùng order/deal, không resend |
| Intent chưa gửi | Chặn mạng sau khi server cấp permit trước OrderSend | Intent/unknown chờ đối soát, không tự gửi lại |
| Hai bản EA | Gắn thêm EA cùng account trên host đó | File lock chặn bản thứ hai; server chỉ cấp permit một lần |
| Đổi account | Chuyển terminal sang account/server khác | EA dừng; không tiếp tục sử dụng credential cũ |
| Thu hồi | Thu hồi EA trên web | Request device sau đó bị 401, copy dừng |
| Tin kinh tế | Admin thêm USD high tại thời gian hiện tại | Signal/intent mới bị chặn trong cửa sổ ±15 phút |
| Admin kill switch | Chọn Dừng toàn hệ thống | Tài khoản pause, queued bị hủy; intent vẫn đối soát được |
| AI outage | Bỏ key/dừng Research container | Execution heartbeat và xử lý Demo vẫn hoạt động |
| Research restart | Chạy WFO, dừng worker ở interrupt, bật lại rồi duyệt | Cùng job/thread tiếp tục, không mất quyết định; không sửa Execution |

## Hồ sơ nghiệm thu cần giữ

Build MT5/MetaEditor, broker/server, symbol specification (tick size/value, volume step/min/max, stop/filling mode), version hash gói, thời điểm UTC, compile log, Experts/Journal, history order/deal và API audit. Không ghi password/token vào báo cáo.

Nếu có duplicate, missing SL/TP, sai risk hoặc identity mismatch được cho qua: dừng copy, giữ toàn bộ dữ liệu/journal và chưa chấp nhận bản phát hành. Không tuyên bố “chỉ chờ mở thị trường là triển khai thật” trước khi các ca này pass.

Lưu ý: EA dùng `WebRequest`; nghiệm thu tích hợp phải chạy trên terminal Demo, không suy diễn từ MT5 Strategy Tester. Bộ Replay/WFO của backend không phải bộ Strategy Tester của broker.
