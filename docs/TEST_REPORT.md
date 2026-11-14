# Báo cáo kiểm thử thực tế — 15/11/2026

Release: **0.1.0-demo**. Không có kết luận “toàn bộ nghiệm thu đã pass”.

| Hạng mục | Kết quả thực tế | Bằng chứng |
|---|---|---|
| Pytest API/engine/research/safety | **58 passed**, 10.41 giây | `test-output.txt`, `junit.xml` |
| Luồng feed → SMA → risk → dispatch → receipt | PASS trong test API với broker mô phỏng | `test_feed_strategy_risk_copy_broker_e2e` |
| Concurrent intent authorization | PASS: 8 request, duy nhất 1 `SEND_ONCE` | `test_concurrent_send_permit_only_once` |
| Broker fill nhưng mất receipt / mất journal local | PASS mô hình: 20 lần reconnect, vẫn 1 broker send | `test_crash_after_fill_reconciles_once` |
| Mất authorization hoặc crash trước send | PASS: fail closed, không send lại | `test_crash_before_send_fails_closed`, `test_crash_after_local_journal_no_send` |
| RBAC/tenant/CSRF/session/pairing/Real lock | PASS trong API và DB tests | `test_system.py`, `test_more_safety.py` |
| Risk amount/spread/DD/margin prerequisite/count/news/TTL | PASS các backend gates đã triển khai; margin tính broker ở EA chưa runtime-tested | Tests + MQ5 static checks |
| LangGraph checkpoint, interrupt, restart, approve/reject | PASS thư viện LangGraph thật, SQLite thật | Tests + `local-smoke-output.txt` |
| OOS temporal split/future mutation | PASS | `test_walkforward_no_overlap_and_future_leakage` |
| Ba tiến trình API/Execution/Research | **PASS**, restart worker và bảo toàn dữ liệu; Execution chạy khi Research dừng | `local-smoke-output.txt` |
| Giao diện qua jsdom + API thật | **PASS**, đăng nhập, Replay, copy toggle, assistant, duyệt research, monitor và SVG có dữ liệu | `dom-smoke-output.txt` |
| Kiểm tra Python/JavaScript/shell/Compose cấu trúc | **PASS tĩnh** | `package-check-output.txt` |
| Dependency consistency | PASS `pip check`: No broken requirements found | Đã chạy trong môi trường phát triển |
| Docker build/Compose runtime smoke | **BLOCKED**, exit 77: không có Docker CLI/daemon | `docker-smoke-output.txt`; có script chạy trên VPS/CI |
| Chromium visual/browser smoke | **BLOCKED**: Chromium không được tạo Unix socket trong môi trường này; tải browser riêng cũng không thành công | `ui-smoke-output.txt`; DOM test không thay thế screenshot/layout/CSP test |
| MetaEditor compile / `.ex5` | **CHƯA CHẠY**: không có MT5/MetaEditor Windows | Chỉ bàn giao `.mq5`; không tạo `.ex5` giả |
| Giao dịch/khôi phục trên broker MT5 Demo | **CHƯA CHẠY** | Checklist `ACCEPTANCE_MT5.md` |
| AI/Vision với provider/key thật | **CHƯA CHẠY**; đường no-key/provider-failure đã pass | `test_ai_missing_and_provider_failure` |
| Public DNS/TLS và VPS khách hàng | **CHƯA TRIỂN KHAI** | Không có quyền truy cập VPS/DNS được cung cấp |

## Ý nghĩa giới hạn

- 58 tests không đồng nghĩa đã kiểm thử MQL5 runtime. Test crash dùng client model Python gọi API thật và broker giả lập lưu SQLite; source MQ5 có kiểm tra tĩnh riêng.
- Kiểm thử risk ở backend dựa trên telemetry do EA cung cấp. Backend không truy vấn trực tiếp broker để xác minh loại account hoặc broker receipts.
- Docker smoke script đã được gọi thực tế và báo BLOCKED; không đổi trạng thái này thành pass bằng cách kiểm tra YAML.
- DOM smoke xác minh hành vi JS và wiring API; chưa xác minh visual rendering, mobile overflow hay CSP thực thi bởi trình duyệt.
- Test OOS chỉ đánh giá tính đúng của quy trình trên dữ liệu tổng hợp, không chứng minh hiệu quả giao dịch hoặc tránh drawdown thực tế.

## Điều kiện đóng nghiệm thu còn lại

Chạy Docker smoke trên VPS Linux có Docker, compile MQ5 với 0 errors và xử lý warnings, kiểm tra UI trên desktop/mobile, thực hiện toàn bộ ma trận MT5 Demo khi có tick thị trường, đối chiếu order/deal và thử restart/mất mạng. Chỉ sau đó mới có thể kết luận bản Demo sẵn sàng vận hành trong môi trường của người dùng. Real vẫn khóa, không có đường cấu hình bật Real.
