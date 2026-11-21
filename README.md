# ZUPIRUS Quant Lab

> **100% Autonomous Cloud MT5 Execution · Direct Cloud Bridge · Multi-Pair Gold & Forex**

ZUPIRUS Quant Lab là nền tảng giao dịch định lượng & thực thi lệnh đám mây tự động 100%, hỗ trợ các cặp tài sản chủ lực: **XAUUSD, EURUSD, GBPUSD, USDJPY**. Hệ thống kết nối trực tiếp đến tài khoản MetaTrader 5 (MT5) của khách hàng thông qua **MetaApi Cloud Bridge** (Zero EA, Zero VPS trên máy khách hàng), tự động hóa toàn bộ vòng đời khách hàng từ đăng ký OTP qua email, thanh toán VietQR với **SePay**, đến bảo vệ vị thế 24/5 và chu kỳ học tăng cường **3-Stage Tabula Rasa AI Evolution Loop**.

---

## 🏛️ Kiến Trúc Hệ Thống (Domain-Driven Architecture)

Mã nguồn backend tuân thủ triệt để nguyên tắc Clean Architecture & Domain-Driven Design (DDD) với 5 miền nghiệp vụ cốt lõi tại `app/domains/`:

```
zupirus-quant-lab/
├── app/
│   ├── domains/                      # 5 Miền nghiệp vụ độc lập & tách biệt
│   │   ├── accounts/                 # Quản lý tài khoản, mã hóa AES, phân loại Standard/Cent/Prop
│   │   │   ├── classifier.py         # Phân loại tài khoản & tính toán Lot chuẩn hóa
│   │   │   ├── lifecycle.py          # Vòng đời kết nối MT5 Cloud Bridge
│   │   │   └── repository.py         # Truy xuất dữ liệu tài khoản
│   │   ├── billing/                  # Quản lý gói cước, cổng thanh toán VietQR & tỷ giá
│   │   │   ├── service.py            # Xử lý đơn hàng, tích lũy UNDERPAID -> PAID
│   │   │   ├── sepay.py              # Xác thực webhook & chữ ký SePay
│   │   │   ├── fx_rate.py            # Tỷ giá USD/VND động theo thời gian thực
│   │   │   └── subscription.py       # Kích hoạt & gia hạn tự động
│   │   ├── execution/                # Thực thi lệnh trực tiếp đám mây & Giám sát rủi ro
│   │   │   ├── engine.py             # Engine giao dịch & worker thực thi lệnh
│   │   │   ├── metaapi_client.py     # Client giao tiếp MetaApi REST/WS API
│   │   │   ├── fanout.py             # Fan-out song song microsecond cho nhiều tài khoản
│   │   │   ├── watcher.py            # PositionWatcher 24/5 (Auto BE 1R, Partial TP, DD breaker)
│   │   │   ├── symbol_mapper.py      # Map symbol theo broker (ví dụ: XAUUSDm, GOLD)
│   │   │   ├── symbol_precision.py   # Chuẩn hóa digit & tick size tránh lỗi broker
│   │   │   └── portfolio.py          # Quản lý danh mục & phân bổ rủi ro
│   │   ├── signals/                  # Tiếp nhận, chuẩn hóa & thẩm định tín hiệu
│   │   │   ├── ingestion/            # Khử trùng lặp, lọc blacklist & định dạng tín hiệu
│   │   │   │   ├── context.py
│   │   │   │   ├── normalizer.py
│   │   │   │   └── sanitizer.py
│   │   │   └── sources/              # Nguồn tín hiệu TradingView Scanner & Webhook
│   │   │       ├── curator.py
│   │   │       ├── discovery.py
│   │   │       └── streamer.py
│   │   └── ai/                       # Nghiên cứu định lượng & Tiến hóa tự động
│   │       ├── research_graph.py     # Đồ thị nghiên cứu LangGraph
│   │       ├── hindsight.py          # Bộ nhớ bài học rủi ro sau đóng lệnh (Hindsight Memory)
│   │       ├── gemini_client.py      # Pool quản lý hạn ngạch & gọi Google Gemini
│   │       ├── calendar_sync.py      # Đồng bộ lịch kinh tế vĩ mô USD
│   │       ├── signal_swarm.py       # Đánh giá tín hiệu đa góc nhìn qua Swarm AI
│   │       └── ingest_swarm.py       # Phân tích luồng tin tức vĩ mô
│   ├── routers/                      # REST API Endpoints (Admin, Accounts, Billing, Signals)
│   ├── services/                     # Backwards-compatibility shims hướng về app/domains/
│   ├── core/                         # Cấu hình hệ thống, DB pool, mã hóa, logging
│   └── main.py                       # FastAPI application entrypoint
├── web/                              # Giao diện người dùng duy nhất (Single Source of Truth)
│   ├── public/                       # Static assets (Favicon, logo, EA bridge file)
│   └── src/                          # React 19 + TypeScript + Vite + Tailwind CSS
├── scripts/                          # Bộ công cụ vận hành & bảo trì hệ thống
│   ├── ops/                          # Vận hành Database & Backup (Postgres, TimescaleDB, Migration)
│   ├── qa/                           # Kiểm thử tĩnh, acceptance check & smoke test
│   ├── community/                    # Bot tự động hóa Discord (VIP member, bump reminder, digest)
│   ├── verify_package.py             # Shim kiểm tra toàn vẹn gói deploy cho CI
│   └── worker_health.py              # Script healthcheck cho Docker containers
├── data/                             # Dữ liệu tĩnh, schema di trú và snapshots
├── tests/                            # Bộ kiểm thử tự động pytest
├── compose.yaml                      # Cấu hình triển khai Docker Compose Production
├── Dockerfile                        # Multi-stage production container build
└── requirements.lock                 # Pinned dependencies qua uv
```

---

## 🌐 Hệ Thống Cổng Dịch Vụ (Multi-Domain Routing)

| Tên miền | Chức năng | Đối tượng |
| :--- | :--- | :--- |
| **`zupirus.com`** | Trang giới thiệu, bảng giá, biểu đồ hiệu suất định lượng & tài liệu | Khách vãng lai |
| **`app.zupirus.com`** | Cổng quản lý tài khoản MT5, cấu hình rủi ro, thanh toán gói cước VietQR & nhật ký lệnh | Khách hàng |
| **`adm.zupirus.com`** | Command Radar giám sát 4 đèn cảnh báo, Kill-Switch, phê duyệt thanh toán & quản lý AI Evolution | Quản trị viên |

---

## ⚡ Các Tính Năng Nổi Bật

### 1. Vòng Đời Khách Hàng Không Chạm (Zero-Touch Cloud Execution)
- **Đăng ký an toàn qua OTP Email:** Sử dụng Resend API với cơ chế khóa số lần thử, mã hóa thông tin tài khoản MT5 bằng AES-256 GCM.
- **Thanh toán tự động với SePay:** Tự động tạo mã QR VietQR theo thời gian thực, xử lý tích lũy số tiền thanh toán thiếu (`UNDERPAID` ➔ `PAID`), tự động nâng cấp gói và gia hạn dịch vụ.
- **Khởi tạo kết nối MetaApi thông minh:** Nhận diện loại tài khoản (`CENT`, `PROP_FIRM`, `RAW_ECN`, `STANDARD`) để tự động tính toán khối lượng lệnh (Lot size) đồng nhất theo % rủi ro mục tiêu.
- **PositionWatcher 24/5:** Quét vị thế mỗi 5 giây, tự động dời Stop Loss về điểm hòa vốn (Break-Even) khi đạt 1R, đóng 50% khối lượng tại TP1, tự động đóng toàn bộ vị thế trước 21:00 UTC thứ Sáu cho tài khoản Quỹ (Prop Firm), và ngắt giao dịch khẩn cấp khi chạm ngưỡng lỗ tối đa trong ngày (4.5% daily drawdown).

### 2. Chu Trình Tiến Hóa AI 3 Giai Đoạn (Tabula Rasa Loop)
- **Giai đoạn 1 (`EXTERNAL_FEED`):** Lắng nghe tín hiệu quét từ TradingView Scanner đa khung thời gian (`M15`, `H1`, `H4`), thẩm định điểm số thực tế trên nến `M1` thật, tự động xoay tua các nguồn có chất lượng tốt vào luồng phát lệnh trực tiếp.
- **Giai đoạn 2 (`HYBRID`):** Lọc tín hiệu qua bộ nhớ bài học `Hindsight`, kiểm định mẫu ngoại suy (Walk-Forward Out-of-Sample: `win_rate >= 55%`, `profit_factor >= 1.4`, `samples >= 30`).
- **Giai đoạn 3 (`ZUPIRUS_AGENT`):** Đội ngũ Swarm Agent tự chủ ra quyết định vào lệnh độc lập, kết hợp 4 lớp khiên bảo vệ vĩ mô và lịch kinh tế USD.

---

## 🛠️ Hướng Dẫn Cài Đặt & Phát Triển Cục Bộ

### 1. Yêu Cầu Môi Trường
- Python 3.12+ (khuyến nghị dùng `uv` để cài thư viện nhanh chóng)
- Node.js 20+ hoặc 22+
- Docker & Docker Compose
- PostgreSQL / TimescaleDB & Redis

### 2. Cấu Hình Biến Môi Trường (`.env`)
Tạo file `.env` từ `.env.example`:
```env
DATABASE_URL=postgresql://zupirus:password@127.0.0.1:5432/zupirus
REDIS_URL=redis://127.0.0.1:6379/0
ENCRYPTION_KEY=your-32-byte-base64-key
METAAPI_TOKEN=your-metaapi-token
SEPAY_WEBHOOK_SECRET=your-sepay-secret
RESEND_API_KEY=re_your_resend_api_key
GEMINI_API_KEY=your-google-gemini-key
APP_SECRET=your-jwt-app-secret
```

### 3. Cài Đặt & Khởi Chạy Local
```bash
# Cài đặt backend
uv pip install -r requirements.lock

# Cài đặt frontend
npm ci

# Chạy Backend API (FastAPI)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Chạy Frontend dev server (Vite)
npm run dev
```

---

## 🚀 Triển Khai Sản Phẩm (Production Deployment)

Hệ thống được đóng gói container hóa hoàn chỉnh qua Docker Compose:

```bash
# Build và chạy toàn bộ dịch vụ (API, Execution Worker, Research Worker, TimescaleDB, Redis)
docker compose -p zupirus-prod up -d --build

# Kiểm tra trạng thái containers
docker compose -p zupirus-prod ps

# Xem log thời gian thực của API
docker compose -p zupirus-prod logs -f --tail=100 api
```

Healthcheck endpoints có sẵn:
- Liveness check: `GET /healthz`
- Readiness check (DB, TimescaleDB, Redis, Workers): `GET /readyz`

---

## 🧪 Kiểm Thử & Đảm Bảo Chất Lượng (QA & Testing)

Dự án sở hữu bộ kiểm thử tự động toàn diện:

```bash
# 1. Kiểm tra tĩnh cấu trúc, compose, bảo mật CSP và AST
python scripts/verify_package.py

# 2. Chạy toàn bộ Unit & Integration tests phía backend
pytest -q -p no:cacheprovider tests/

# 3. Chạy toàn bộ linter, unit test frontend và build Vite
npm test
```

---

## 📦 Bộ Tiện Ích Vận Hành (Scripts)

Các công cụ tiện ích trong thư mục `scripts/` được phân nhóm theo mục đích sử dụng:

- **`scripts/ops/`**:
  - `backup_postgres.py` / `vps_daily_backup.sh`: Sao lưu tự động cơ sở dữ liệu.
  - `restore_postgres.py`: Phục hồi dữ liệu từ bản sao lưu.
  - `postgres_tools.py`: Tiện ích kiểm tra kết nối và chỉ mục.
- **`scripts/qa/`**:
  - `verify_package.py`: Bộ kiểm tra toàn vẹn kiến trúc trước khi commit.
  - `vps_acceptance_check.py`: Kiểm tra nghiệm thu chất lượng các dịch vụ VPS.
  - `e2e_portal_smoke.py`: Kiểm tra luồng portal từ đăng nhập tới đặt lệnh.
- **`scripts/community/`**:
  - `manage_discord_vip.py`: Đồng bộ phân quyền VIP trên Discord tự động theo gói cước.
  - `optimize_discord_channels.py`: Tối ưu hóa kênh và cấu trúc danh mục Discord.
  - `discord_bump_reminder.py` / `discord_daily_digest.py`: Nhắc nhở và gửi tổng kết thị trường hàng ngày.

---

## 🔒 Giấy Phép & Bảo Mật

Bản quyền thuộc về **ZUPIRUS Quant Lab**. Mọi hành vi sao chép hoặc phân phối lại khi chưa có văn bản đồng ý đều bị nghiêm cấm.
