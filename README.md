# ZUPIRUS Quant Lab — Hệ thống Mô phỏng Định lượng XAUUSD đa khung tự vận hành

Bản nghiệm thu đầu tiên của **ZUPIRUS Quant Lab** cho cặp tài sản **XAUUSD (nến cơ sở M15, bối cảnh H1/H4)** hoạt động ở chế độ **Mô phỏng (`SIMULATION_ONLY`)**.

Sau khi khởi động, hệ thống tự động vận hành trọn vòng mà không cần người vận hành bấm chạy hay duyệt tay từng chu kỳ:
**Nhận nến M15 đã đóng → Nhận diện trạng thái thị trường → Chọn chiến lược hoặc đứng ngoài → Kiểm tra rủi ro (có quyền phủ quyết) → Mô phỏng giao dịch → Đối soát kết quả → Học lại Walk-Forward → Tự cập nhật/Quay lui chính sách mô phỏng.**

---

## 1. Kiến trúc Phân tách Trách nhiệm

Mã nguồn được chia tách rõ ràng theo từng miền trách nhiệm trong `src/quant/`:

- `src/quant/types.ts`: Cấu trúc dữ liệu miền, mã chu kỳ liên kết (`cycleId`), trạng thái hai đội Agent và sổ cái đối soát.
- `src/quant/dataReplay.ts`: Bộ phát lại nến XAUUSD M15 xác định và bộ kiểm tra tính hợp lệ của nến đã đóng (thứ tự thời gian, trùng lặp, khoảng trống thời gian, cấu trúc OHLC, tách biệt **Giờ thị trường** `closeTime` và **Giờ hệ thống** `systemReceivedTime`).
- `src/quant/regimeDetector.ts`: Bộ phân loại 5 trạng thái thị trường nghiêm ngặt không nhìn trước tương lai (`INSUFFICIENT_DATA`, `TRENDING`, `RANGING`, `SQUEEZE_PRE_BREAKOUT`, `VOLATILITY_SHOCK`) kèm chỉ báo và ngưỡng phân loại.
- `src/quant/strategies.ts`: Ba chiến lược có điều kiện vào lệnh khác biệt thực sự (`STRAT_TREND_FOLLOW`, `STRAT_MEAN_REVERT`, `STRAT_VOL_BREAKOUT`), đường cơ sở cố định (`POLICY_BASELINE_FIXED_V1`) và Bộ điều phối (`selectStrategyForCycle`).
- `src/quant/riskGate.ts`: Chốt kiểm soát rủi ro có quyền phủ quyết vô điều kiện (`evaluateRiskGate`) và khóa bảo vệ ngăn bộ học sửa đổi giới hạn rủi ro (`guardLearnerCannotModifyRiskLimits`).
- `src/quant/simBroker.ts` & `src/quant/reconciliation.ts`: Broker mô phỏng nội bộ (`SIMULATION_ONLY`) hỗ trợ khớp lệnh, đóng một phần (50% tại TP1), đóng hết (TP2 / SL / Hết hạn thời gian), từ chối, hết hạn, quy tắc xung đột SL/TP trong cùng nến (`CONSERVATIVE_SL_FIRST`), ghim quy tắc quản lý theo phiên bản chính sách lúc mở lệnh và đối soát đủ 100% khối lượng (`RECONCILED_OK`).
- `src/quant/researchTeam.ts`: Đội Nghiên cứu & Kiểm định chạy mô phỏng song song các ứng viên đủ điều kiện (`PARALLEL_SHADOW_SIM`) và dùng giao dịch chính đã đối soát để theo dõi suy giảm chính sách, lọc mẫu chồng lấn ranh giới Walk-Forward (`OVERLAPS_WF_BOUNDARY`) và mẫu chưa đóng (`UNCLOSED_AT_CUTOFF`), báo cáo hiệu suất 1x và 2x chi phí, tự động kích hoạt chính sách mới hoặc tự quay lui/dừng mở vị thế khi suy giảm.
- `src/quant/storage.ts` & `src/quant/orchestrator.ts`: Lưu trữ bền vững (`quant-state.json` ghi nguyên tử + nhật ký `journal.ndjson`), đảm bảo tính lũy đẳng (idempotent) khi xử lý lại sự kiện trùng hoặc khôi phục sau restart.

---

## 2. Nguồn Dữ liệu Phát lại & Thời gian Quan sát Nghiệm thu

- **File dữ liệu phát lại**: `./data/xauusd_m15_replay.json` (Mã bộ dữ liệu: `ZUPIRUS-XAUUSD-M15-ACCEPTANCE-V1`).
- **Nguồn và thuyết minh dữ liệu tổng hợp**: Bộ dữ liệu gồm **72 nến XAUUSD M15 đã đóng** (tương ứng 18 giờ thị trường từ `2026-03-02T08:00:00Z` đến `2026-03-03T02:00:00Z`), được hiệu chuẩn tổng hợp có kiểm soát theo biên độ giá vàng giao ngay (`2860.00 – 2915.00 USD/oz`) để người nghiệm thu quan sát được đầy đủ 5 trạng thái thị trường:
  - Nến `1..14`: Trạng thái **Thiếu dữ liệu (`INSUFFICIENT_DATA`)** → Hệ thống tự động đứng ngoài chờ đủ 15 nến lịch sử.
  - Nến `15..30`: Trạng thái **Có xu hướng (`TRENDING`)** kèm 1 nến giãn spread (`spreadPts = 48 > 40`) tại nến 22 để chứng minh **Chốt rủi ro phủ quyết (`EXCESSIVE_SPREAD`)**.
  - Nến `31..44`: Trạng thái **Co hẹp trước phá vỡ (`SQUEEZE_PRE_BREAKOUT`)** và bứt phá biến động.
  - Nến `45..58`: Trạng thái **Đi ngang (`RANGING`)** kiểm chứng chiến lược hồi quy trung bình.
  - Nến `59..60`: Trạng thái **Biến động sốc (`VOLATILITY_SHOCK`)** → Hệ thống tự động đứng ngoài bảo toàn vốn.
  - Nến `61..72`: Tiếp tục phát lại sau giai đoạn sốc và đánh giá chính sách ở cuối bộ dữ liệu.
- Với `REPLAY_INTERVAL_MS=800`, bộ phát lại chạy khoảng 58 giây, qua 5 kỳ học. Bộ 72 nến có thể giữ chính sách cơ sở khi thiếu bằng chứng ngoài mẫu. Test dùng mẫu tổng hợp riêng để kiểm tra cả kích hoạt H1/M15, H4/M15 và trường hợp bị từ chối.
- Các ứng viên theo xu hướng và phá vỡ được đánh giá riêng theo phiên bản M15, H1/M15 và H4/M15. H1/H4 được tổng hợp theo UTC từ các nến M15 liên tục đã đóng. Cấu hình đa khung chỉ được thực thi nếu chính sách đã chọn nó và nến khung lớn đóng gần nhất xác nhận cùng hướng. Admin hiển thị khung và thời điểm nến dùng để quyết định.
- Bộ học xếp hạng trên tập huấn luyện và dùng tập ngoài mẫu để quyết định kích hoạt. Khi cập nhật một trạng thái lưu cũ, chính sách được học theo quy trình cũ quay về đường cơ sở để kiểm định lại. Vị thế đang mở giữ quy tắc quản lý lúc mở.


---

## 3. Hướng dẫn Cài đặt, Kiểm thử từ Bản Clone Sạch (Local / CI)

```bash
# 1. Clone sạch repository và chuyển vào thư mục dự án
git clone https://github.com/car230698-blip/zupirus-quant-lab.git
cd zupirus-quant-lab

# 2. Cài đặt dependencies
npm ci

# 3. Kiểm tra kiểu tĩnh TypeScript (Lint)
npm run lint

# 4. Chạy bộ kiểm thử tự động đầu cuối (End-to-End & Unit Tests)
npm test

# 5. Build giao diện sản phẩm
npm run build

# 6. Khởi chạy ứng dụng (mặc định tại cổng 3000)
cp .env.example .env
npm start
```

---

## 4. Triển khai Nghiệm thu trên VPS qua Docker Compose & SSH Tunnel

Ứng dụng được đóng gói kèm `Dockerfile` và `docker-compose.yml` với tên dự án riêng (`zupirus-quant-lab`), volume lưu trữ bền vững riêng (`zupirus_quant_lab_data`) và **chỉ bind vào địa chỉ loopback `127.0.0.1:3100`** trên VPS để đảm bảo an toàn.

### 4.1. Các lệnh chạy trên VPS từ một bản clone sạch

```bash
# 1. Clone repository về VPS
git clone https://github.com/car230698-blip/zupirus-quant-lab.git
cd zupirus-quant-lab

# 2. Ghim đúng commit nghiệm thu trên nhánh main
REVISION="THAY_BANG_SHA_COMMIT_DA_NGHIEM_THU"
git checkout --detach "$REVISION"
git rev-parse HEAD

# 3. Tạo file cấu hình môi trường từ file mẫu
cp .env.example .env

# 4. Build và khởi động dịch vụ ngầm bằng Docker Compose
docker compose -p zupirus-quant-lab up -d --build --wait

# 5. Kiểm tra trạng thái container và healthcheck
docker compose -p zupirus-quant-lab ps
curl -fsS http://127.0.0.1:3100/api/health

# 6. Xem nhật ký hoạt động thời gian thực
docker compose -p zupirus-quant-lab logs -f
```

### 4.2. Mở giao diện từ máy cá nhân qua SSH Tunnel

Trên máy trạm của người vận hành, mở một kết nối SSH chuyển tiếp cổng `3100`:

```bash
ssh -N -L 3100:127.0.0.1:3100 <user>@<dia-chi-ip-vps>
```

Sau đó mở trình duyệt tại địa chỉ:
- **Trang người dùng (Tổng quan tài khoản mô phỏng)**: `http://127.0.0.1:3100`
- **Trang quản trị (Bảng vận hành Admin)**: Chọn tab **"Bảng vận hành Admin"** trên thanh điều hướng.

### 4.3. Quy trình Kiểm tra Bền vững sau Restart và Dừng dịch vụ

```bash
# 1. Kiểm tra tiến độ hiện tại và số lần restart trước khi khởi động lại
curl -s http://127.0.0.1:3100/api/health

# 2. Thực hiện restart container
docker compose -p zupirus-quant-lab restart

# 3. Kiểm tra lại health và trạng thái sau restart (restartCount tăng thêm 1, giữ nguyên tiến độ nến, số dư, vị thế và lịch sử học)
curl -s http://127.0.0.1:3100/api/health

# 4. Dừng dịch vụ (giữ nguyên dữ liệu trong volume zupirus_quant_lab_data)
docker compose -p zupirus-quant-lab down
```

---

## 5. Thông tin File Cấu hình & Lưu trữ Dữ liệu Bền vững

- **File cấu hình mẫu**: `/.env.example` (sao chép thành `/.env` khi chạy).
- **File dữ liệu phát lại xác định**: `/data/xauusd_m15_replay.json`.
- **Nơi lưu trạng thái bền vững khi chạy**:
  - Đường dẫn mặc định (Local): `./data/runtime/quant-state.json` (ghi nguyên tử qua file tạm `.tmp`) và `./data/runtime/journal.ndjson` (nhật ký sự kiện chỉ ghi nối thêm - append-only).
  - Đường dẫn trong Docker Compose: `/app/data/runtime` được ánh xạ vào Docker named volume `zupirus_quant_lab_data`.

### Kiểm định từ báo giá tick MT5

```bash
node scripts/import-mt5-replay.mjs bars.csv ticks.csv /tmp/xau-replay.json
node scripts/pack-mt5-ticks.mjs ticks.csv /tmp/xau-ticks.bin
HOST=127.0.0.1 PORT=3200 DATA_DIR=/tmp/xau-tick-state \
  REPLAY_FILE=/tmp/xau-replay.json TICKS_FILE=/tmp/xau-ticks.bin npm start
```

Dùng hai file Exness UTC cùng khoảng thời gian. Chỉ đưa nến M15 đã đóng hoàn toàn vào bộ phát lại. Dùng thư mục trạng thái riêng cho mỗi bộ dữ liệu và chế độ. Có thể khởi động lại với cùng hai file và cùng thư mục để tiếp tục.

Tín hiệu vẫn lấy từ nến đã đóng. Mô phỏng khớp theo Bid/Ask đầu tiên tại hoặc sau giờ đóng nến, với thời hạn chờ tối đa 5 giây. Nếu thiếu báo giá trong thời hạn này, bỏ qua cơ hội. Cả vị thế chính và mẫu nghiên cứu đều xử lý SL/TP theo thứ tự tick. TP dùng giá mục tiêu, SL dùng giá báo khi chạm hoặc vượt ngưỡng. Phí theo cấu hình mô phỏng hiện có, chưa cộng độ trễ đặt lệnh hoặc trượt giá ngoài báo giá. Khi bỏ biến `TICKS_FILE`, hệ thống chạy mô phỏng theo nến như trước.
