# ZUPIRUS Quant Lab

> **100% Autonomous Cloud MT5 Execution · Direct Cloud MetaApi · Multi-Pair Gold & Forex**

ZUPIRUS Quant Lab là nền tảng giao dịch định lượng & thực thi lệnh đám mây tự động 100%, hỗ trợ các cặp tài sản chủ lực: **XAUUSD, EURUSD, GBPUSD, USDJPY**. Hệ thống kết nối trực tiếp đến tài khoản MetaTrader 5 (MT5) của khách hàng thông qua **MetaApi Cloud Bridge** (Zero EA, Zero VPS trên máy khách hàng), tự động hóa toàn bộ vòng đời khách hàng từ đăng ký OTP qua email, thanh toán VietQR với **SePay**, đến bảo vệ vị thế 24/5 và chu kỳ học tăng cường **3-Stage Tabula Rasa AI Evolution Loop**.

---

## 🏛️ Kiến Trúc Hệ Thống (Domain-Driven Architecture)

Mã nguồn backend tuân thủ triệt để nguyên tắc Clean Architecture & Domain-Driven Design (DDD) với 5 miền nghiệp vụ cốt lõi tại `app/domains/`:

```
zupirus-quant-lab/
├── app/
│   ├── domains/                      # 5 Miền nghiệp vụ độc lập & tách biệt
│   │   ├── accounts/                 # Quản lý tài khoản, mã hóa AES-256 GCM, phân loại Standard/Cent/Prop
│   │   │   ├── classifier.py         # Phân loại tài khoản & tính toán Lot chuẩn hóa
│   │   │   ├── lifecycle.py          # Vòng đời kết nối MT5 Cloud Bridge (deploy/undeploy)
│   │   │   └── repository.py         # Truy xuất dữ liệu tài khoản
│   │   ├── billing/                  # Quản lý gói cước, cổng thanh toán VietQR & tỷ giá
│   │   │   ├── service.py            # Xử lý đơn hàng, tích lũy UNDERPAID -> PAID, 48h grace window
│   │   │   ├── sepay.py              # Xác thực webhook & chữ ký HMAC-SHA256 / ApiKey SePay
│   │   │   ├── fx_rate.py            # Tỷ giá USD/VND động theo thời gian thực (cache TTL 1800s)
│   │   │   └── subscription.py       # Kích hoạt & gia hạn tự động
│   │   ├── execution/                # Thực thi lệnh trực tiếp đám mây & Giám sát rủi ro
│   │   │   ├── engine.py             # Engine giao dịch & worker thực thi lệnh (fail-closed auto-rollback)
│   │   │   ├── metaapi_client.py     # Client giao tiếp MetaApi REST/WS API
│   │   │   ├── fanout.py             # Fan-out song song microsecond cho nhiều tài khoản
│   │   │   ├── watcher.py            # PositionWatcher 24/5 (Auto BE 1R, Partial TP, DD breaker 4.5%)
│   │   │   ├── symbol_mapper.py      # Map symbol theo broker (ví dụ: XAUUSDm, GOLD)
│   │   │   ├── symbol_precision.py   # Chuẩn hóa digit & tick size tránh lỗi broker
│   │   │   └── portfolio.py          # Quản lý danh mục & phân bổ rủi ro (cap 2.0% prop risk)
│   │   ├── signals/                  # Tiếp nhận, chuẩn hóa & thẩm định tín hiệu
│   │   │   ├── ingestion/            # Khử trùng lặp, lọc blacklist & định dạng tín hiệu
│   │   │   │   ├── context.py        # Snapshot bối cảnh thị trường (Spread, ATR, Regime)
│   │   │   │   ├── normalizer.py     # Chuẩn hóa payload TradingView/Webhook
│   │   │   │   └── sanitizer.py      # 4 Lớp khiên bảo vệ bắt buộc (Mandatory Guards)
│   │   │   └── sources/              # Nguồn tín hiệu TradingView Scanner & Webhook
│   │   │       ├── curator.py        # Thẩm định & chấm điểm Shadow Ledger
│   │   │       ├── discovery.py      # Quét tìm kiếm chiến lược mới
│   │   │       └── streamer.py       # Quản lý stream dữ liệu nến M1 thật
│   │   └── ai/                       # Nghiên cứu định lượng & Tiến hóa tự động
│   │       ├── research_graph.py     # Đồ thị nghiên cứu LangGraph 3 giai đoạn
│   │       ├── hindsight.py          # Bộ nhớ bài học rủi ro sau đóng lệnh (Hindsight Memory)
│   │       ├── gemini_client.py      # Pool quản lý hạn ngạch & xoay tua Google Gemini
│   │       ├── calendar_sync.py      # Đồng bộ lịch kinh tế vĩ mô ForexFactory (USD High-Impact)
│   │       ├── signal_swarm.py       # Đánh giá tín hiệu đa góc nhìn qua Swarm AI
│   │       └── ingest_swarm.py       # Pipeline xử lý tài liệu định lượng & tin tức
│   ├── routers/                      # REST API Endpoints (Admin, Accounts, Billing, Signals, Webhooks)
│   │   ├── admin/                    # Phân hệ Admin (AI, Billing, Accounts, Monitor, Skills)
│   │   ├── accounts.py               # Tài khoản khách hàng & kết nối Cloud MetaApi
│   │   ├── billing.py                # Bảng giá, đơn hàng & đăng ký gói cước
│   │   ├── webhooks.py               # Tiếp nhận TradingView & SePay VietQR webhooks
│   │   └── skills.py                 # Self-Evolving Quant Skills & MCP Tool Registry
│   ├── services/                     # Backwards-compatibility shims hướng về app/domains/
│   ├── core/                         # Cấu hình hệ thống, DB pool, mã hóa, logging
│   └── main.py                       # FastAPI application entrypoint (Strict CSP, CORS perimeter)
├── web/                              # Giao diện người dùng duy nhất (Single Source of Truth)
│   ├── public/                       # Static assets (Favicon, logo, OG Image, EA bridge file)
│   └── src/                          # React 19 + TypeScript + Vite + Tailwind CSS
│       ├── api/client.ts             # API client trung tâm thống nhất (typed fetch wrapper)
│       ├── components/               # UI Components (Admin, User Portal, Landing modular sections)
│       ├── data/quantConstants.ts    # Định danh gói cước chuẩn: starter (1) | growth (3) | alpha (5)
│       └── utils/currencyFormat.ts   # Định dạng tiền tệ chuẩn cho tài khoản Cent/Standard
├── scripts/                          # Bộ công cụ vận hành & bảo trì hệ thống
│   ├── ops/                          # Vận hành Database & Backup (backup_postgres.py, vps_daily_backup.sh)
│   ├── qa/                           # Kiểm thử tĩnh, acceptance check & diagnostic (vps_acceptance_check.py)
│   ├── community/                    # Bot tự động hóa Discord (VIP member, bump reminder, digest)
│   ├── verify_package.py             # Script kiểm tra toàn vẹn kiến trúc & AST
│   └── worker_health.py              # Script healthcheck cho Docker containers
├── data/                             # Dữ liệu tĩnh, schema di trú và snapshots
├── tests/                            # Bộ kiểm thử tự động pytest (152 bài test)
├── compose.yaml                      # Cấu hình dịch vụ Docker Compose nền tảng
├── compose.prod.yaml                 # Cấu hình khóa bảo mật Production trên VPS
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
- **Đăng ký an toàn qua OTP Email:** Sử dụng Resend API với cơ chế khóa số lần thử (brute-force lockout), mã hóa mật khẩu MT5 bằng AES-256 GCM.
- **Thanh toán tự động với SePay VietQR:**
  - Tự động tạo mã QR VietQR động theo thời gian thực kèm nội dung chuyển khoản `ZP <ORDER_ID_6>`.
  - Hỗ trợ đa dạng endpoint webhook: `/api/webhooks/sepay`, `/api/sepay/webhook`, `/api/v1/webhooks/sepay`.
  - Xác thực đa tầng (HMAC-SHA256, API Key, Bearer Token), bóc tách nội dung ngân hàng thông minh.
  - Xử lý tích lũy thanh toán thiếu (`UNDERPAID` ➔ `PAID`), cửa sổ ân hạn 48 giờ (`48h grace window`) tự động kích hoạt đơn hàng trễ.
- **Khởi tạo kết nối MetaApi thông minh:** Nhận diện loại tài khoản (`CENT`, `PROP_FIRM`, `RAW_ECN`, `STANDARD`) để tự động tính toán khối lượng lệnh (Lot size) đồng nhất theo % rủi ro mục tiêu.
- **PositionWatcher 24/5:** Quét vị thế mỗi 5 giây, tự động dời Stop Loss về điểm hòa vốn (Break-Even) khi đạt 1R, đóng 50% khối lượng tại TP1, tự động đóng toàn bộ vị thế trước 21:00 UTC thứ Sáu cho tài khoản Quỹ (Prop Firm), và ngắt giao dịch khẩn cấp khi chạm ngưỡng lỗ tối đa trong ngày (4.5% daily drawdown).

### 2. 4 Lớp Khiên Bảo Vệ Rủi Ro Bắt Buộc (4 Mandatory Safety Guards)
Mọi tín hiệu giao dịch trước khi phân phối (Fan-out) đến tài khoản người dùng đều phải vượt qua 4 chốt kiểm duyệt fail-closed:
1. **Lớp 1 — Lọc Khử Trùng Lặp (Deduplication Guard):** Chặn các tín hiệu cùng hướng trong khoảng thời gian ngắn trên cùng cặp tiền.
2. **Lớp 2 — Kiểm Tra Bắt Buộc Stop Loss (Mandatory Stop Loss Guard):** Tuyệt đối từ chối mọi lệnh không có Stop Loss hoặc Stop Loss = 0. Tự động gắn ATR SL dự phòng nếu được bật.
3. **Lớp 3 — Khiên Chặn Tin Tức Vĩ Mô (Macro News Shield):** Tự động đóng băng mở lệnh mới trong khoảng ±30 phút quanh thời điểm công bố tin tức USD High-Impact (CPI, NFP, FOMC).
4. **Lớp 4 — Kiểm Tra Trượt Giá Thực Tế (Max Slippage Guard):** Đối chiếu giá yêu cầu với nến M1 hiện tại, từ chối vào lệnh nếu trượt giá vượt quá `MAX_ENTRY_SLIPPAGE_PIPS` (3.0 pips).

### 3. Chu Trình Tiến Hóa AI 3 Giai Đoạn (Tabula Rasa Loop)
- **Giai đoạn 1 (`EXTERNAL_FEED`):** Lắng nghe tín hiệu quét từ TradingView Scanner đa khung thời gian (`M15`, `H1`, `H4`), thẩm định điểm số thực tế trên nến `M1` thật, tự động xoay tua các nguồn có chất lượng tốt vào luồng phát lệnh trực tiếp.
- **Giai đoạn 2 (`HYBRID`):** Lọc tín hiệu qua bộ nhớ bài học `Hindsight`, kiểm định mẫu ngoại suy (Walk-Forward Out-of-Sample: `win_rate >= 55%`, `profit_factor >= 1.4`, `samples >= 30`, ma sát vòng `WFO_ROUNDTRIP_COST_PIPS=3.5`).
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
APP_ENV=production
DATABASE_URL=postgresql://zupirus:your_password@127.0.0.1:5432/zupirus
REDIS_PASSWORD=your_strong_redis_password_here
REDIS_URL=redis://:your_strong_redis_password_here@127.0.0.1:6379/0
ENCRYPTION_KEY=your_64char_master_encryption_key_here
ADMIN_EMAIL=admin@zupirus.com
ADMIN_PASSWORD=your_secure_admin_password_here
METAAPI_TOKEN=your_metaapi_cloud_token_here
SEPAY_WEBHOOK_SECRET=your_sepay_webhook_secret_here
SEPAY_BANK_NAME=VietinBank
SEPAY_ACCOUNT_NUMBER=105887054819
SEPAY_ACCOUNT_HOLDER=LE NGUYEN NHU THUY
RESEND_API_KEY=re_your_resend_api_key_here
ENABLE_LEGACY_EA_BRIDGE=false
MIN_INDUCTIVE_SAMPLES=30
PROP_LIVE_MAX_PORTFOLIO_RISK_PCT=2.0
WFO_ROUNDTRIP_COST_PIPS=3.5
```

### 3. Cài Đặt & Khởi Chạy Local
```bash
# 1. Cài đặt thư viện Python
uv pip install -r requirements.lock

# 2. Cài đặt thư viện Frontend
npm ci

# 3. Chạy Backend API (FastAPI)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 4. Chạy Frontend dev server (Vite)
npm run dev
```

---

## 🚀 Triển Khai Sản Phẩm (Production Deployment)

Hệ thống được đóng gói container hóa hoàn chỉnh qua Docker Compose với cấu hình bảo mật production nghiêm ngặt:

```bash
# Build và chạy toàn bộ dịch vụ (API, Execution Worker, Research Worker, TimescaleDB, Redis)
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml up -d --build

# Kiểm tra trạng thái containers và tính sẵn sàng của dịch vụ
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml ps

# Xem log thời gian thực của API
docker compose -p zupirus-prod -f compose.yaml -f compose.prod.yaml logs -f --tail=100 api
```

### Khóa Bảo Mật Production Đã Được Kiểm Chứng:
- **Loopback Binds (127.0.0.1):** Toàn bộ cổng dịch vụ cốt lõi (`timescaledb:5432`, `redis:6379`, `api:8080`) chỉ lắng nghe trên `127.0.0.1`, tuyệt đối không mở cổng công khai `0.0.0.0`.
- **Bắt Buộc REDIS_PASSWORD:** Không cho phép khởi động container Redis với mật khẩu mặc định hoặc rỗng trên môi trường production.
- **Edge Security Isolation:** Các endpoint nhạy cảm (`/api/v1/stream/admin`, `/api/admin/monitor`) bị chặn tại lớp biên Caddy / Nginx Proxy Manager (trả về HTTP 403 Forbidden).
- **Chính Sách CSP Nghiêm Ngặt:** HTML trang chủ và ứng dụng không chứa inline script thực thi (`0 inline script tags`).

---

## 🧪 Kiểm Thử & Đảm Bảo Chất Lượng (QA & Testing)

Dự án sở hữu bộ kiểm thử tự động toàn diện với tỷ lệ pass 100%:

```bash
# 1. Kiểm tra cú pháp và lỗi tiềm ẩn (Ruff)
ruff check app/ cli/ tests/ --select E9,F63,F7,F82

# 2. Kiểm tra tĩnh cấu trúc, compose, bảo mật CSP và AST
python scripts/verify_package.py

# 3. Chạy toàn bộ Unit & Integration tests phía backend (152 tests)
pytest tests/ -v

# 4. Chạy linter, unit test frontend và build Vite production
npm test

# 5. Kiểm tra nghiệm thu tự động trên máy chủ VPS
python scripts/qa/vps_acceptance_check.py http://127.0.0.1:8080
```

---

## 📦 Bộ Tiện Ích Vận Hành (Scripts)

Các công cụ tiện ích trong thư mục `scripts/` được phân nhóm theo mục đích sử dụng:

- **`scripts/ops/`**:
  - `backup_postgres.py` / `vps_daily_backup.sh`: Sao lưu tự động cơ sở dữ liệu TimescaleDB.
  - `restore_postgres.py`: Phục hồi dữ liệu an toàn từ bản sao lưu.
  - `postgres_tools.py`: Tiện ích kiểm tra kết nối, chỉ mục và dung lượng bảng.
- **`scripts/qa/`**:
  - `verify_package.py`: Bộ kiểm tra toàn vẹn kiến trúc trước khi commit.
  - `vps_acceptance_check.py`: Bộ 5 bài kiểm tra nghiệm thu tự động sau khi deploy lên VPS.
  - `check_sepay_status.py`: Công cụ chẩn đoán kết nối và webhook SePay VietQR.
  - `e2e_portal_smoke.py`: Kiểm tra luồng portal từ đăng nhập tới đặt lệnh.
- **`scripts/community/`**:
  - `manage_discord_vip.py`: Đồng bộ phân quyền VIP trên Discord tự động theo gói cước.
  - `optimize_discord_channels.py`: Tối ưu hóa kênh và cấu trúc danh mục Discord.
  - `discord_bump_reminder.py` / `discord_daily_digest.py`: Nhắc nhở và gửi tổng kết thị trường hàng ngày.

---

## 🔒 Giấy Phép & Bảo Mật

Bản quyền thuộc về **ZUPIRUS Quant Lab**. Mọi hành vi sao chép hoặc phân phối lại khi chưa có văn bản đồng ý đều bị nghiêm cấm.
