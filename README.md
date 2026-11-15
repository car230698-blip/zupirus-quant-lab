# ZUPIRUS Quant Lab · Demo-Only Production Release (v0.2.0)

[![Demo safety and smoke](https://github.com/car230698-blip/zupirus-quant-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/car230698-blip/zupirus-quant-lab/actions/workflows/ci.yml)
[![Branch](https://img.shields.io/badge/branch-main-cyan.svg)](https://github.com/car230698-blip/zupirus-quant-lab/tree/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Nền tảng phân tích định lượng XAUUSD chuỗi thời gian tốc độ cao và hệ thống sao chép lệnh MT5 Demo (Hard-locked against live real capital execution).

Tài liệu chi tiết tiếng Việt: [README_VI.md](README_VI.md) · Hướng dẫn Agent CLI: [SKILL.md](SKILL.md)

---

## 1. Kiến Trúc Cốt Lõi (4 Công Nghệ Nâng Cấp)

1. **PostgreSQL 16 + TimescaleDB 2.17:**
   - CSDL chính lưu trữ tài khoản, cấu hình rủi ro, đối soát lệnh và checkpoint bền vững LangGraph.
   - Hypertables (`quotes`, `candles`, `snapshots`) phân vùng theo cột `time`, hỗ trợ hàm `time_bucket` truy vấn nến M1, M5, M15, H1, D1 siêu tốc.
   - Ràng buộc duy nhất tương thích TimescaleDB (`UNIQUE(time, source, ts)`).
2. **Redis 7 (Streams, Pub/Sub & Distributed Lock):**
   - Hàng đợi tín hiệu thời gian thực `stream:signals` kết hợp Transactional Outbox (commit PostgreSQL trước khi publish).
   - Khóa phân tán `lock:dispatch:{account_id}:{signal_id}` chống mở trùng lệnh khi nhiều worker hoặc request đồng thời.
   - Cache trạng thái heartbeat EA `cache:heartbeat:{account_id}` với TTL 45 giây.
3. **Vercel AI SDK 6 & React 19:**
   - Single-Page Application (SPA) viết bằng TypeScript + React 19 + Vite.
   - Tích hợp `ai@^6.0.332` và `@ai-sdk/react@^3.0.335` với giao thức Vercel AI Data Stream Protocol.
   - Generative UI: `PortfolioGenerativeUI`, `RecentOrdersGenerativeUI`.
   - ToolLoopAgent với cơ chế phê duyệt tương tác `needsApproval: true` cho Hàng đợi duyệt chiến lược Walk-Forward của Admin.
4. **LangSmith & LangGraph:**
   - Tự động kích hoạt khi có `LANGSMITH_API_KEY` trong `.env`, có cơ chế fallback an toàn (fail-safe offline buffer) khi không có mạng.
   - Tracing toàn bộ luồng suy luận, tool calls, độ trễ và lượng token; tự động ẩn (redact) mật khẩu, token, dữ liệu nhạy cảm.
   - Tách rời hoàn toàn: Execution worker vẫn vận hành bình thường ngay cả khi dịch vụ AI bị gián đoạn.
5. **Bộ Điều Phối Đa Chiến Lược (Multi-Strategy Coordinator):**
   - Đội ngũ chiến lược định lượng XAUUSD M15:
     - **Trend Following:** Giao cắt Fast SMA(5) / Slow SMA(20) khi có xung lực.
     - **Mean Reversion:** Bollinger Band 2-sigma hồi quy về trung bình trong thị trường dao động biên độ.
     - **Breakout:** Đột phá Donchian Channel 20 nến khi biến động mở rộng.
     - **Regime Detector:** Tự động đứng ngoài (`STAND_ASIDE`) khi thị trường đi ngang trong vùng nhiễu.

---

## 2. Phân Tuyến và Tên Miền (Same-Origin)

Hệ thống phục vụ cùng origin cho giao diện và backend trên từng tên miền, phân định rõ ràng giữa SPA route, tài nguyên tĩnh và `/api/*`:

| Tên Miền | Vai Trò | Tuyến Đường |
|---|---|---|
| **`zupirus.com`** / **`www.zupirus.com`** | Cổng Người Dùng (User Portal) | Đăng ký, đăng nhập, ghép nối EA MT5, bật/tắt copy, theo dõi số dư/equity, nhật ký lệnh và lý do bị từ chối/bỏ lỡ |
| **`adm.zupirus.com`** | Cổng Quản Trị (Admin Portal) | Giám sát 2 đội Agent (Execution & Research), Kill-Switch, Hàng đợi duyệt chiến lược AI SDK 6, Nhật ký hoạt động toàn hệ thống, LangSmith Tracing |

---

## 3. Khởi Chạy Local & Docker Production

### Chạy bằng Docker Compose (Khuyến nghị cho Production/Staging)

```bash
# 1. Sao chép biến môi trường mẫu
cp .env.example .env

# 2. Khởi chạy toàn bộ stack với PostgreSQL, TimescaleDB và Redis thật
docker compose up -d --build

# 3. Kiểm tra trạng thái các container
docker compose ps
```

### Chạy Bộ Kiểm Thử (Unit & Integration Tests)

```bash
# Kiểm thử toàn diện 81 bài test
pytest -v

# Kiểm thử giao diện và kịch bản đóng gói
python scripts/verify_package.py
python scripts/local_smoke.py
python scripts/run_dom_smoke.py
```

### Chụp Ảnh Giao Diện Nghiệm Thu

```bash
python scripts/capture_screenshots.py
# Ảnh được lưu tại screenshots/ và copy vào brain artifacts:
# - screenshots/user_desktop_1440.png
# - screenshots/user_mobile_390.png
# - screenshots/admin_desktop_1440.png
# - screenshots/admin_mobile_390.png
```

---

## 4. Hướng Dẫn Vận Hành Trên VPS Thử Nghiệm

VPS cấu hình độc lập, không can thiệp vào stack chính đang chạy trên cổng 80/443 (Nginx Proxy Manager):

- **SSH:** `hoangminh2306@109.199.100.120` (Cổng 22)
- **Thư mục bản thử:** `~/zupirus-quant-lab-test`
- **Compose project:** `zupirus-test`
- **Cổng loopback:** `127.0.0.1:3101`

### Khởi động bản thử trên VPS

```bash
cd ~/zupirus-quant-lab-test
git fetch origin main && git checkout main && git pull origin main
docker compose -p zupirus-test -f compose.yaml -f compose.smoke.yaml up -d --build
```

### Kiểm tra sức khỏe & Readiness Fail-Closed

```bash
curl -s http://127.0.0.1:3101/healthz
curl -s http://127.0.0.1:3101/readyz
```

### Sao lưu (Backup) và Khôi phục (Restore) PostgreSQL

```bash
# Sao lưu dữ liệu ra file nén .sql.gz và file metadata .json
python scripts/backup_postgres.py --url "$DATABASE_URL" --output /backups

# Khôi phục dữ liệu từ bản sao lưu
python scripts/restore_postgres.py --url "$DATABASE_URL" --file /backups/zupirus_pg_backup_TIMESTAMP.sql.gz
```

### Quy trình Quay Lui (Rollback)

Nếu cần quay lui phiên bản:

```bash
cd ~/zupirus-quant-lab-test
git checkout <PREVIOUS_COMMIT_SHA>
docker compose -p zupirus-test up -d --build
```

---

## 5. Kết Quả Nghiệm Thu (Acceptance Table)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| **Multi-stage Docker Build (React + Vite)** | **ĐẠT** | Multi-stage Dockerfile biên dịch React 19 + TypeScript (`dist/`), phục vụ cùng origin qua FastAPI `app.mount('/assets')` và SPA catch-all fallback |
| **API Pure JSON & 404/401 Safety** | **ĐẠT** | Tuyến `/api/*` trả về 100% JSON, không bao giờ rơi về HTML khi 404, 401 hoặc lỗi máy chủ (`test_spa_fallback_and_api_pure_json` PASSED) |
| **Vercel AI SDK 6 Integration** | **ĐẠT** | `@ai-sdk/react@^3.0.335` & `ai@^6.0.332` tích hợp Data Stream Protocol, Generative UI và ToolLoopAgent `needsApproval: true` |
| **PostgreSQL & TimescaleDB Hypertables** | **ĐẠT** | Hypertables `quotes`, `candles`, `snapshots`, migration phiên bản tương thích DB mới lẫn cũ, chống ghi trùng tick |
| **Redis Streams & Distributed Lock** | **ĐẠT** | Transactional Outbox + Redis Streams `stream:signals`, khóa `lock:dispatch:{aid}:{sid}` chống mở lệnh đúp (`test_redis_distributed_locking` PASSED) |
| **Fail-Closed Docker Smoke** | **ĐẠT** | Tách riêng ngắt Redis và PostgreSQL: `/readyz` trả đúng HTTP 503 và báo lỗi chính xác phụ thuộc, tự động hồi phục khi unpause |
| **Multi-Strategy Coordinator** | **ĐẠT** | Trend Following, Mean Reversion, Breakout, và Stand Aside; ghi nhận lý do vào lệnh/đứng ngoài vào metadata và outbox |
| **Giao diện Người dùng & Quản trị** | **ĐẠT** | Nghiệm thu cả desktop (1440px) và mobile (390px), đầy đủ luồng đăng ký/đăng nhập, ghép EA, toggle copy, deal reconciliation |
| **Bộ kiểm thử tự động toàn diện** | **ĐẠT** | **81/81 test cases PASSED (100%)** |
