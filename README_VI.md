# ZUPIRUS Quant Lab — Demo/Replay 0.1.0

Bản mã nguồn tự chứa để chạy thử trên **một VPS**. Có giao diện khách hàng/Admin, API, Execution độc lập, LangGraph bền vững, EA Copy MQL5 và dữ liệu Replay. Không có EA Master. Không có cấu hình mở giao dịch Real.

**Trạng thái bàn giao:** phần mềm Demo có kiểm thử; chưa phải bản đã được nghiệm thu MT5 hay chứng nhận vận hành Fintech. Docker runtime, MetaEditor và trình duyệt đồ họa còn các bước nghiệm thu được ghi rõ trong `docs/TEST_REPORT.md`. Không trình bày kiểm thử mô hình Python như kiểm thử EA thật.

## Khởi động

Yêu cầu: Linux VPS có Docker Engine + Docker Compose v2.24.4 trở lên và Python 3.12+; khuyến nghị 2 vCPU, 4 GB RAM, 20 GB đĩa. Cần Internet để tải image/dependencies ở lần build đầu. Giải nén rồi đứng trong thư mục `zupirus`.

**Đúng một lệnh khởi động:**

```bash
bash scripts/start.sh
```

Nếu chưa có `.env`, script tạo từ `.env.example`, tự sinh mật khẩu Admin và feed token ngẫu nhiên, quyền file `0600`. Mặc định chỉ bind `127.0.0.1:8080`. Đăng nhập bằng `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env`; một tài khoản Replay tổng hợp đã bật sẵn cho Admin. Đồ thị sẽ có dữ liệu ngay; lệnh chỉ xuất hiện khi SMA giao cắt, không ép lệnh để làm đẹp demo. Khách mới có thể đăng ký rồi tạo Replay riêng.

Trên VPS từ xa ở chế độ Replay, dùng SSH port forwarding của SSH client để chuyển cổng 8080 về máy cá nhân. Không cần cài MT5 hay cung cấp AI key.

### Hai tên miền HTTPS

Trước khi chạy lệnh trên, tạo `.env` theo `.env.example` và đặt:

| Biến | Giá trị / yêu cầu |
|---|---|
| `DEPLOY_MODE` | `public` để bật Caddy và hai tên miền |
| `COOKIE_SECURE` | `true` khi public, bắt buộc |
| `ADMIN_EMAIL` | Email tài khoản Admin bạn muốn sử dụng |
| `ADMIN_PASSWORD` | Để trống để script tự sinh, hoặc mật khẩu riêng ít nhất 16 ký tự |
| `ACME_EMAIL` | Email nhận thông báo chứng chỉ TLS |
| `ALLOWED_ORIGINS` | `https://zupirus.com,https://adm.zupirus.com`; mặc định cũng cho localhost |
| `FEED_TOKEN` | Để trống để tự sinh; chỉ chia sẻ với dịch vụ nạp giá Windows |
| `AI_API_KEY` | Tùy chọn; để trống vẫn chạy toàn bộ Replay/Execution/WFO |
| `AI_BASE_URL` | API tương thích chat completions; mặc định `https://api.openai.com/v1` |
| `AI_MODEL` | Model hỗ trợ ảnh nếu dùng Vision; mặc định `gpt-4.1-mini`, phải kiểm tra quyền sử dụng của key |
| `API_URL` | Cho price feeder Windows: `https://zupirus.com` |
| `MT5_SYMBOL` | Cho price feeder Windows: đúng alias vàng của broker, ví dụ `XAUUSDm` |

Trỏ DNS A của `zupirus.com` và `adm.zupirus.com` tới VPS (chỉ đặt AAAA nếu IPv6 thực sự hoạt động), mở TCP 80/443. Caddy tự xin TLS. Khách truy cập `zupirus.com`; Admin dùng `adm.zupirus.com`. Cookie là host-only, hai cổng đăng nhập riêng. Proxy chặn `/api/admin/*` trên miền khách; backend vẫn bắt buộc role Admin trên mọi miền.

**Không** bật `COOKIE_SECURE=false` khi public. Mật khẩu bootstrap chỉ dùng khi tạo Admin; đổi `.env` không tự đổi mật khẩu tài khoản đã tồn tại.

## Cấu trúc

- `app/main.py`: auth, tenant ownership, pairing, device protocol, feed, dashboard, admin, assistant.
- `app/engine.py`: dữ liệu giá → SMA crossover → risk gates → dispatch; Replay broker giả lập.
- `app/research.py`: Walk-Forward OOS, checkpoint SQLite, interrupt/chấp thuận, AI/Vision adapter có fallback.
- `app/db.py`, `security.py`: schema có ràng buộc, transaction, hash mật khẩu và credential.
- `web/`: giao diện tiếng Việt, dark fintech, responsive, SVG Equity/Balance, không cần CDN/build frontend.
- `ea/Zupirus_Copy_EA.mq5`: EA Copy Demo-only. **Chưa có `.ex5` vì chưa biên dịch trên MetaEditor.**
- `scripts/feed_mt5.py`: dịch vụ giá trên Windows; chỉ đọc tick Demo, không mở lệnh.
- `data/replay.json`: 900 giá đóng cửa **tổng hợp**, seed cố định; không phải dữ liệu broker.
- `tests/`, `scripts/*smoke*`, `.github/workflows/ci.yml`: kiểm thử và CI có thể chạy lại.
- `docs/`: kiến trúc, giao thức, an toàn, vận hành và checklist MT5.

## Hành trình sử dụng

1. Tạo tài khoản khách, đăng nhập, chọn **Tài khoản & EA**.
2. Tạo Replay để thử nhanh, hoặc khai báo login/server MT5 Demo chính xác.
3. Đặt rủi ro mỗi lệnh, spread, hạn lệnh và drawdown. Demo mới mặc định tạm dừng.
4. Với Demo: lấy mã ghép nối, gắn EA, chờ heartbeat rồi bật copy. Mã hết hạn sau 5 phút và chỉ dùng một lần.
5. Theo dõi order/deal trong Nhật ký. `UNKNOWN` không được gửi lại tự động.
6. Admin: chạy WFO trong Research Lab; xem báo cáo rồi chấp thuận/từ chối. Chấp thuận chỉ lưu ứng viên, không tự sửa Execution.
7. Tin USD/ALL tác động cao được nhập vào lịch đã kiểm chứng; Execution chặn lệnh mới ±15 phút. Chưa có feed tin thương mại tự động.

## Kiểm thử

```bash
python -m pip install -r requirements.lock
python -m pytest -q
python scripts/verify_package.py
python scripts/local_smoke.py
npm ci
python scripts/run_dom_smoke.py
bash scripts/docker_smoke.sh
```

`ui_smoke.py` là kiểm thử Chromium bổ sung (cần Playwright, Chromium và API thử nghiệm tại 18081); không dùng trên dữ liệu khách thật. DOM smoke tự tạo database tạm và chạy API/Execution/Research riêng.

`docker_smoke.sh` dùng project/volume riêng, dọn **chỉ dữ liệu smoke** khi xong. Không chạy lệnh `down -v` với project vận hành thật.

Xem kết quả thực tế tại `docs/TEST_REPORT.md`. Hướng dẫn cuối cùng: `docs/ACCEPTANCE_MT5.md`.
