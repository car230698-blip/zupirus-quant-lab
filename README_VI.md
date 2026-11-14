# ZUPIRUS Quant Lab — Demo/Replay 0.2.0

Bản nâng cấp kiến trúc toàn diện cho **ZUPIRUS Quant Lab**, tích hợp đồng bộ 4 công nghệ lõi:

1. **PostgreSQL + TimescaleDB:** Cơ sở dữ liệu chính thay thế SQLite (lưu tài khoản, cấu hình rủi ro, đối soát EA và checkpoint phê duyệt), kết hợp hypertable của TimescaleDB để lưu trữ và truy vấn chuỗi thời gian nến/tick XAUUSD tốc độ cao với hàm `time_bucket`.
2. **Redis:** Hàng đợi phân phối tín hiệu thời gian thực (Pub/Sub & Streams `stream:signals`) từ Quant Engine tới EA Copy, cache trạng thái heartbeat (`cache:heartbeat:{account_id}`) và khóa phân tán (Distributed Lock `lock:dispatch:{account_id}:{signal_id}`) chống mở trùng lệnh.
3. **Vercel AI SDK 6:** Tầng giao diện và tương tác AI (`web/`) sử dụng **Vercel AI SDK 6** (`ToolLoopAgent`, `useChat`, Generative UI và cơ chế `needsApproval: true`) cho bảng hàng đợi phê duyệt chiến lược của Admin và trợ lý tra cứu danh mục của khách hàng.
4. **LangSmith:** Tracing và giám sát toàn diện (bật tự động khi có `LANGSMITH_API_KEY` trong `.env`, có cơ chế fallback an toàn khi chạy offline) để ghi vết toàn bộ luồng suy luận, gọi công cụ, độ trễ và lượng token của cả LangGraph lẫn Vercel AI SDK 6.

---

## 1. Khởi động với Docker Compose

Yêu cầu: Linux VPS có Docker Engine + Docker Compose v2.24.4 trở lên.

```bash
docker compose up -d --build
```

Compose tự động khởi tạo 5 dịch vụ liên hoàn:
- `timescaledb`: PostgreSQL 16 tích hợp TimescaleDB với volume bền vững `timescaledb_data`.
- `redis`: Redis 7 Alpine hỗ trợ Streams, Pub/Sub và Khóa phân tán.
- `api`: FastAPI với Vercel AI SDK 6 Data Stream endpoints và RBAC.
- `execution`: Quant Engine phát tín hiệu SMA crossover, nạp Redis Stream và chốt chặn rủi ro.
- `research`: LangGraph Walk-Forward Optimization kết nối LangSmith và checkpoint PostgreSQL.

---

## 2. Cấu hình Môi trường (.env)

Xem chi tiết trong `.env.example`:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL + TimescaleDB (`postgresql://zupirus:...@timescaledb:5432/zupirus`) |
| `REDIS_URL` | Chuỗi kết nối Redis Streams & Cache (`redis://:...@redis:6379/0`) |
| `LANGSMITH_API_KEY` | Khóa API LangSmith để bật tracing giám sát toàn diện |
| `LANGSMITH_TRACING` | `true` để kích hoạt LangSmith tracing |
| `LANGSMITH_PROJECT` | Tên dự án trên LangSmith (mặc định: `zupirus-quant-lab`) |
| `AI_API_KEY` | Khóa API mô hình ngôn ngữ (OpenAI / Gemini / Vercel AI) |

---

## 3. Cấu trúc Thư mục

- `app/db.py`: Tầng kết nối PostgreSQL + TimescaleDB (hypertables, time-series query helpers, fallback SQLite).
- `app/redis_client.py`: Hàng đợi phân phối tín hiệu Redis Streams, Pub/Sub, Heartbeat Cache và Distributed Lock (`SET NX PX`).
- `app/tracing.py`: Tầng giám sát LangSmith tracing, đo độ trễ và ghi vết token prompt/completion.
- `app/engine.py`: Động cơ giao dịch định lượng kết nối Redis Streams và khóa phân tán.
- `app/research.py`: LangGraph WFO tích hợp PostgreSQL checkpointer và LangSmith telemetry.
- `app/main.py`: API Server với các endpoint Vercel AI SDK 6 Data Stream và Generative UI.
- `web/`: Giao diện React + TypeScript, Vercel AI SDK 6 `ToolLoopAgent` (`needsApproval: true`) và `useChat`.
- `tests/test_modern_architecture.py`: Bộ kiểm thử tự động toàn diện cho cả 4 công nghệ.
