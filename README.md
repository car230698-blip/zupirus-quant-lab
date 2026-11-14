# ZUPIRUS Quant Lab — Hệ thống Mô phỏng Định lượng XAUUSD M15 Tự vận hành

Bản bàn giao nghiệm thu của **ZUPIRUS Quant Lab** cho cặp tài sản **XAUUSD (nến cơ sở M15, bối cảnh đa khung H1/H4)** hoạt động nghiêm ngặt ở chế độ **Mô phỏng (`SIMULATION_ONLY`)**.

Sau khi kết nối một lần từ bộ thu MT5 demo (hoặc chạy ở chế độ phát lại ngoại tuyến), hệ thống tự thu dữ liệu, tiếp tục từ mốc đã ghi khi khởi động lại, tổng hợp nến M15 đã đóng, đánh giá chiến lược ứng viên, áp dụng quy tắc phiên **15/15** và đệm rủi ro xuyên SL **P95**, đối soát từng deal và tự cập nhật hoặc quay lui chính sách giao dịch trong mô phỏng mà không cần người dùng xuất/tải CSV hay duyệt tay từng tín hiệu.

---

## 1. Kiến trúc Phân tách Trách nhiệm

Mã nguồn được chia tách rõ ràng theo từng miền trách nhiệm trong `src/quant/` và `scripts/`:

- `scripts/record-mt5-demo.py`: Bộ thu báo giá Bid/Ask XAUUSD chạy trên máy Windows có MT5 demo (Python x64 + gói `MetaTrader5`). Hỗ trợ tự nhận diện tên mã có hậu tố (`XAUUSD`, `XAUUSDm`, `XAUUSD.a`, `XAUUSD.pro` → chuẩn hóa về `XAUUSD`), chuẩn hóa thời gian UTC (`time_msc`), lưu bền vững vào SQLite chế độ WAL (`ticks_spool` + `collector_watermark`) khi VPS hoặc mạng gián đoạn, và tự đồng bộ theo lô sang VPS Linux.
- `src/quant/tickIngestor.ts`: Đầu cuối tiếp nhận báo giá có xác thực (`POST /api/ingest/ticks`). Ghi bền vững từng lô xuống đĩa (`fs.fsyncSync` vào `ticks-batches.ndjson`) trước khi trả lời xác nhận (`200 OK`), tuần tự hóa các yêu cầu đồng thời, đảm bảo retry và dữ liệu trùng cho cùng kết quả, phân biệt tick trùng với nhiều báo giá hợp lệ trong cùng một mili giây (`seqInMs`), theo dõi tick sai thứ tự / mất đoạn / báo giá cũ, và tổng hợp nến M15 đã đóng theo thứ tự thời gian thị trường.
- `src/quant/marketSchedule.ts`: Cấu hình và bộ kiểm tra quy tắc phiên **15/15** theo lịch broker (`America/New_York`, tự động tính giờ mùa hè `EDT UTC-4` và giờ mùa đông `EST UTC-5`, ngày đóng sớm và trạng thái chỉ được đóng lệnh). Ngừng mở lệnh mới và đóng vị thế đang mở từ 15 phút trước giờ đóng phiên thứ Sáu/đóng sớm; không suy ra lịch chạy từ tick tương lai; khi đã lỡ giờ đóng (do mất báo giá trong cửa sổ 15 phút cuối), tự động đóng bắt buộc tại báo giá hợp lệ đầu tiên khi có báo giá trở lại (`MISSED_CUTOFF_FIRST_VALID_QUOTE`).
- `src/quant/riskGate.ts`: Chốt kiểm soát rủi ro độc lập với bộ học (`evaluateRiskGate`), tích hợp ngân sách rủi ro 1% equity, giới hạn bởi phần ngân sách sụt giảm còn lại trước ngưỡng ngày/toàn phiên (`effectiveRiskBudgetPct`), và **đệm xuyên SL theo phân vị P95** của tối đa 50 lệnh chạm SL trước đó (`computeSlOvershootP95Buffer`, dùng `0.10 USD/oz` khi dưới 10 mẫu).
- `src/quant/simBroker.ts` & `src/quant/reconciliation.ts`: Broker mô phỏng nội bộ (`SIMULATION_ONLY`) khớp lệnh theo Bid/Ask có thứ tự, spread, phí, gap qua mức cản, đóng một phần (50% tại TP1), SL/TP, thời hạn giữ lệnh và quy tắc 15/15. Ghi nhận độ trượt xuyên SL (`slOvershootUsdPerOz`) và đối soát đủ 100% khối lượng (`RECONCILED_OK`).
- `src/quant/costStress.ts`: Tách biệt rõ hai báo cáo chịu tải chi phí:
  1. **Phân tích hậu kiểm chi phí 2× trên các lệnh đã khớp (`POST_HOC_2X_ON_EXECUTED_TRADES`)**.
  2. **Chạy lại mô phỏng toàn phần với mô hình chi phí 2× + độ trễ vào/thoát lệnh (`FULL_RE_SIMULATION_WITH_COST_AND_LATENCY`)**.
- `src/quant/researchTeam.ts` & `src/quant/fixtures.ts`: Đội Nghiên cứu & Kiểm định chạy mô phỏng song song ứng viên, lọc mẫu chồng lấn ranh giới Walk-Forward (`OVERLAPS_WF_BOUNDARY`) và mẫu chưa đóng (`UNCLOSED_AT_CUTOFF`), kiểm định có giới hạn vị thế/khối lượng danh mục (`applyValidationCapacity`), kèm bộ 5 fixture có chủ đích (`runAllLearningBranchFixtures`) chứng minh đầy đủ 5 nhánh quyết định: thiếu mẫu, giữ nguyên vì không vượt trội, tự kích hoạt chính sách mới, tự quay lui khi suy giảm, và dừng mở vị thế mới khi cả chính sách trước cũng suy giảm.
- `src/quant/storage.ts` & `src/quant/orchestrator.ts`: Lưu trữ nguyên tử (`quant-state.json` + `journal.ndjson` + `ticks-batches.ndjson`), khôi phục vị thế và trạng thái sau restart mà không mở trùng, ghi deal trùng hoặc tính P&L hai lần.

---

## 2. Hướng dẫn Cài đặt, Kiểm thử và Build từ Bản Clone Sạch (Local / CI)

```bash
# 1. Cài đặt dependencies từ lockfile
npm ci

# 2. Kiểm tra kiểu tĩnh TypeScript (Lint)
npm run lint

# 3. Build giao diện sản phẩm
npm run build

# 4. Chạy toàn bộ bộ kiểm thử tự động (23 kịch bản End-to-End, Tick Ingest, Python SQLite Collector, 15/15, P95 SL, 5 Nhánh Học & RBAC)
npm test

# 5. Chạy kiểm thử tự thân của bộ thu Python SQLite
python3 scripts/record-mt5-demo.py --self-test

# 6. Khởi chạy ứng dụng (mặc định tại cổng 3000)
cp .env.example .env
npm start
```

---

## 3. Triển khai trên VPS Linux bằng Docker Compose

Ứng dụng đóng gói kèm `Dockerfile` và `docker-compose.yml` với tên dự án `zupirus-quant-lab`, volume bền vững `zupirus_quant_lab_data` và mặc định chỉ bind vào địa chỉ loopback `127.0.0.1:3100` trên VPS.

```bash
# 1. Tạo file cấu hình môi trường từ file mẫu và đặt các token RBAC riêng
cp .env.example .env

# 2. Build và khởi động dịch vụ ngầm bằng Docker Compose
docker compose -p zupirus-quant-lab up -d --build --wait

# 3. Kiểm tra trạng thái container và healthcheck
docker compose -p zupirus-quant-lab ps
curl -fsS http://127.0.0.1:3100/api/health

# 4. Kiểm tra trạng thái đầu cuối thu thập tick và lịch phiên 15/15
curl -fsS http://127.0.0.1:3100/api/ingest/status
curl -fsS http://127.0.0.1:3100/api/schedule

# 5. Xem nhật ký hoạt động thời gian thực
docker compose -p zupirus-quant-lab logs -f
```

### Mở giao diện từ máy trạm qua SSH Tunnel

```bash
ssh -N -L 3100:127.0.0.1:3100 <user>@<dia-chi-ip-vps>
```

Mở trình duyệt tại `http://127.0.0.1:3100` để quan sát **Tổng quan Tài khoản** và **Vận hành Admin**.

---

## 4. Kết nối Một lần Bộ thu MT5 Demo trên Máy Windows sang VPS Linux

Gói Python `MetaTrader5` chính thức chỉ phát hành cho **Windows 64-bit (Python 3.10–3.12)**. Do đó, máy Windows chạy MT5 demo đảm nhiệm việc đọc báo giá Bid/Ask XAUUSD và tự đồng bộ sang VPS Linux qua cổng đẩy `/api/ingest/ticks`.

### 4.1. Cài đặt một lần trên máy Windows chạy MT5 Demo

1. Mở phần mềm **MetaTrader 5** và đăng nhập tài khoản **Demo** (đảm bảo mã vàng như `XAUUSD`, `XAUUSDm`, hoặc `XAUUSD.a` có trong cửa sổ *Market Watch*).
2. Cài đặt **Python 3.10 – 3.12 (64-bit)** trên Windows và cài gói `MetaTrader5`:

```powershell
py -3.11 -m venv .venv-mt5
.\.venv-mt5\Scripts\Activate.ps1
pip install --upgrade pip MetaTrader5
```

3. Mở kết nối SSH Tunnel từ máy Windows tới VPS Linux (hoặc trỏ qua HTTPS nội bộ):

```powershell
ssh -N -L 3100:127.0.0.1:3100 <user>@<dia-chi-ip-vps>
```

4. Khởi chạy dịch vụ thu thập tự động (chỉ cần khởi chạy một lần; tự lưu SQLite WAL khi mất mạng và tự đồng bộ tiếp từ mốc watermark khi có mạng lại):

```powershell
python scripts/record-mt5-demo.py `
  --server-url http://127.0.0.1:3100 `
  --token zupirus-collector-demo-token `
  --db ./data/mt5_ticks_spool.sqlite `
  --symbol XAUUSD `
  --collector-id WIN-MT5-DEMO-01
```

---

## 5. Phân quyền Truy cập (RBAC)

Hệ thống phân tách rõ 3 vai trò qua Bearer Token (`Authorization: Bearer <token>`) hoặc thanh chọn vai trò kiểm tra trên giao diện:

- **`ADMIN` (`ADMIN_AUTH_TOKEN`)**: Toàn quyền xem bảng điều khiển, truy vết kiểm toán và thực thi các thao tác điều khiển (`/api/control/*`).
- **`VIEWER` (`VIEWER_AUTH_TOKEN`)**: Chỉ được phép xem số liệu tài khoản, nhật ký hai đội, báo cáo chi phí 2×, kết quả fixture và truy vết (`/api/state`, `/api/trace/*`, `/api/cost-analysis`, `/api/learning-fixtures`). Mọi yêu cầu tới `/api/control/*` hoặc `/api/ingest/ticks` đều bị từ chối với mã `403 FORBIDDEN`.
- **`COLLECTOR` (`COLLECTOR_AUTH_TOKEN`)**: Chỉ được phép đẩy lô báo giá (`POST /api/ingest/ticks`) và kiểm tra trạng thái đồng bộ (`GET /api/ingest/status`). Bị từ chối (`403 FORBIDDEN`) khi truy cập sổ cái tài khoản (`/api/state`) hoặc điều khiển (`/api/control/*`).

---

## 6. Ranh giới Bằng chứng Kiểm thử & Lưu ý Nghiệm thu

- **Chế độ thực thi**: Toàn bộ hệ thống khóa cứng ở `SIMULATION_ONLY`. Mọi giao dịch đều khớp trên `SimBroker` nội bộ.
- **Tách biệt bằng chứng phần mềm và hiệu quả thị trường**:
  - Bộ dữ liệu phát lại xác định (`./data/xauusd_m15_replay.json`) và bộ 5 fixture có chủ đích (`src/quant/fixtures.ts`) được dùng để **kiểm chứng tính đúng đắn của phần mềm** (luồng thu thập bền vững, quy tắc 15/15 có DST và xử lý lỡ giờ cắt, đệm P95 SL, lọc rò rỉ dữ liệu Walk-Forward, và đủ 5 nhánh tự học/quay lui/dừng mở lệnh).
  - Kết quả từ dữ liệu phát lại hoặc fixture kiểm thử phần mềm **không được dùng để khẳng định chiến lược có lợi nhuận thực tế trên thị trường**. Việc đánh giá hiệu quả chiến lược thực tế cần thời gian thu thập chuỗi báo giá dài ngày từ MT5 demo trên VPS.
