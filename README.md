# ZUPIRUS Quant Lab

ZUPIRUS Quant Lab là dự án độc lập xây dựng một hệ thống định lượng tự vận hành cho XAUUSD khung M15. Bản đầu tiên dùng dữ liệu phát lại và broker mô phỏng để kiểm chứng toàn bộ vòng lặp, từ nến đã đóng đến quyết định giao dịch và cập nhật chính sách.

> **Trạng thái hiện tại:** Repo đang ở giai đoạn đặc tả. Chưa có ứng dụng, bộ kiểm thử hay cấu hình Docker để chạy.

## Vòng vận hành

1. **Nhận dữ liệu.** Bộ phát lại cấp nến M15 đã đóng. Hệ thống kiểm tra nến trùng, sai thứ tự, khoảng trống và chất lượng dữ liệu.
2. **Phân tích và chọn chiến lược.** Hệ thống nhận diện thị trường có xu hướng, đi ngang, co hẹp hoặc biến động sốc. Chính sách đang hiệu lực xét các chiến lược theo xu hướng, hồi quy trung bình và phá vỡ biến động. Hệ thống có thể đứng ngoài khi thiếu dữ liệu hoặc thiếu thiết lập phù hợp.
3. **Kiểm soát rủi ro và thực thi.** Chốt rủi ro kiểm tra khối lượng, giới hạn vị thế và sụt giảm trước khi broker mô phỏng nhận lệnh. Hệ thống ghi giá dự kiến, giá khớp, chi phí, khối lượng và lý do thoát. Khối lượng đã đối soát xác định trạng thái đóng một phần hoặc đóng hết.
4. **Nghiên cứu và học lại.** Đội nghiên cứu dùng kết quả đã đối soát và các mẫu mô phỏng song song để xếp hạng chiến lược theo trạng thái thị trường. Kiểm định walk-forward theo thời gian, so sánh với chính sách cơ sở trên cùng kỳ và đo kết quả sau chi phí, sụt giảm tối đa cùng độ nhạy khi nhân đôi chi phí.
5. **Cập nhật chính sách.** Chính sách mới chỉ có hiệu lực trong mô phỏng khi đạt tiêu chí định trước. Khi hiệu quả suy giảm, hệ thống quay về phiên bản hợp lệ hoặc dừng mở vị thế mới. Vị thế đang mở tiếp tục dùng quy tắc của phiên bản đã mở vị thế đó.

Mã truy vết liên kết nến, trạng thái thị trường, quyết định, giao dịch và lần học. Nhật ký bền vững và tiến độ phát lại cho phép tiếp tục sau restart. Vòng nghiệm thu chạy tự động sau khi khởi động, bằng bộ dữ liệu đi kèm và không cần khóa API LLM.

## Giao diện

| Trang | Thông tin cần hiển thị |
| --- | --- |
| Tổng quan tài khoản | Số dư, equity, kết quả theo thời gian, vị thế mở, lịch sử giao dịch, nguồn dữ liệu và thời điểm cập nhật. |
| Vận hành admin | Trạng thái hai đội, nến đã xử lý, lý do chọn hoặc đứng ngoài, quyết định rủi ro, kết quả ngoài mẫu, phiên bản chính sách và lịch sử quay lui. |

Hai trang dùng chung hệ thống thiết kế tài chính bằng tiếng Việt, hỗ trợ desktop và điện thoại. Số liệu lấy từ ứng dụng đang chạy và được gắn nhãn **Mô phỏng**.

## Lộ trình

| Giai đoạn | Kết quả cần đạt |
| --- | --- |
| 1. Bản mô phỏng | Hai đội tự chạy xuyên suốt. Kết quả đối soát đi vào lần học tiếp theo và có thể làm đổi lựa chọn cho ít nhất một trạng thái thị trường. |
| 2. Nghiệm thu VPS | Chạy từ bản clone sạch ở commit đã kiểm tra. Docker Compose dùng tên dự án và volume riêng, có health check và bind mặc định vào `127.0.0.1:3100`. Truy cập qua SSH tunnel và kiểm tra tiếp tục sau restart. |
| 3. MT5 demo | Kiểm tra luồng dữ liệu, khớp lệnh demo, đối soát và phản hồi về đội nghiên cứu. |
| 4. Đánh giá giao dịch thật | Xem xét kết quả ngoài mẫu, chất lượng thực thi demo và khả năng kiểm soát rủi ro trước khi quyết định triển khai. |

## Tiêu chí nghiệm thu giai đoạn 1

- [ ] Sau khi khởi động, server tự đi từ nến đến quyết định, lệnh mô phỏng, đối soát, học lại và cập nhật chính sách.
- [ ] Truy được từ lần học về các giao dịch đã đối soát và tái hiện được lý do đổi hoặc quay lui chính sách.
- [ ] Kiểm thử quyền phủ quyết rủi ro, thiếu mẫu, dữ liệu trùng, restart, đóng một phần và hạch toán P&L một lần.
- [ ] Kiểm thử chống nhìn trước và loại mẫu chồng qua ranh giới huấn luyện và kiểm định.
- [ ] Xác minh mọi lệnh của bản nghiệm thu đi tới broker mô phỏng.
- [ ] Kiểm tra hai trang với dữ liệu thực từ vòng mô phỏng trên desktop và mobile.
- [ ] Công bố commit nghiệm thu, kết quả lint, build, test và smoke test, cùng hướng dẫn VPS và kiểm tra sau restart.

Kết quả trên dữ liệu tổng hợp dùng để kiểm chứng hành vi ứng dụng. Đánh giá lợi thế giao dịch thuộc các giai đoạn kiểm định tiếp theo.
