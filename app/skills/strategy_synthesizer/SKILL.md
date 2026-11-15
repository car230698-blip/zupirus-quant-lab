# Kỹ Năng: Strategy Synthesizer & Walk-Forward Validator (strategy_synthesizer)

## Mục Đích
Tổng hợp các ứng viên chiến lược mới (Strategy Candidates) hoàn toàn từ dữ liệu quy nạp (Tabula Rasa Inductive Learning) trong Hindsight Semantic Memory, thay vì dựa vào các chỉ báo kỹ thuật cài cứng. Kỹ năng này đóng gói ứng viên kèm bộ quy tắc định lượng, chạy kiểm tra Out-of-Sample trên nến TimescaleDB và chuyển tiếp lên hàng đợi phê duyệt của Admin trên `adm.zupirus.com`.

## Điều Kiện Kích Hoạt
- Khi hệ thống thu thập đủ một số lượng mẫu lệnh thắng/thua (tối thiểu 5–10 lệnh) đã phản tư.
- Định kỳ trong chu trình nghiên cứu của AI Agent (`app/research.py`).
- Khi Admin yêu cầu tổng hợp các phát hiện mới từ thị trường thực chiến.

## Các Bước Suy Luận Chuẩn
1. Truy vấn các cụm quy tắc từ Hindsight Memory (category `SEMANTIC`, tag `discovered_rule` hoặc `inductive`).
2. Nhận diện các điều kiện vào lệnh có kỳ vọng toán học dương (Win Rate >= 60%, Profit Factor >= 1.5):
   - Ví dụ: "Trong phiên London, tín hiệu BUY khi ATR(14) nằm trong khoảng $2.5 - $5.0 và cách xa tin USD > 60m đạt tỷ lệ thắng 68%".
3. Đóng gói thành cấu trúc Ứng viên Chiến lược (`strategy_candidates`):
   - Tên ứng viên: `Inductive Alpha #{timestamp}`
   - Bộ quy tắc định lượng JSON (`rules_json`)
   - Tỷ lệ thắng kỳ vọng và quy mô mẫu
4. Đẩy ứng viên vào chu trình kiểm tra Walk-Forward (120 bar Train / 60 bar OOS) trong `app/research.py`.
5. Tạo bản ghi trạng thái `DISCOVERED` chờ người quản trị phê duyệt.

## Định Dạng Đầu Ra
```json
{
  "candidate_id": "strat_a1b2c3d4",
  "name": "Inductive Alpha: London BUY Edge",
  "status": "DISCOVERED",
  "expected_win_rate": 0.67,
  "sample_size": 18,
  "rules": {
    "session": "London",
    "side": "BUY",
    "filter_atr_min": 2.5,
    "filter_news_dist_mins": 45
  },
  "ready_for_admin_review": true
}
```
