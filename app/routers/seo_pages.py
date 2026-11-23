"""Server-Side Rendered (SSR) SEO Knowledge Hub & Guide Pages for Google Top-1 Ranking.

Serves lightning-fast (<10ms TTFB), mobile-first, Sovereign-styled HTML pages with:
- Unique <title>, <meta name="description">, <link rel="canonical">, Open Graph & Twitter Cards
- Valid JSON-LD (Article, BreadcrumbList, CollectionPage)
- Strong semantic H1/H2/H3 hierarchy and internal links back to https://zupirus.com/ & https://app.zupirus.com/
"""
from __future__ import annotations

import html
import json
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["SEO Pages"])

PUBLISHED_DATE = "2026-11-19"

GUIDES: List[Dict[str, object]] = [
    {
        "slug": "bot-trade-vang-xauusd-cloud-mt5",
        "title": "Bot Trade Vàng XAU/USD Cloud MT5 Không Cần VPS | ZUPIRUS",
        "meta_description": "Tìm hiểu cách bot trade vàng XAU/USD chạy trên Cloud MT5 Zero-VPS với 4 lớp giáp Fail-Closed, Auto-SL ATR(14) và News Shield ±15 phút.",
        "keywords": "bot trade vàng XAUUSD, bot giao dịch vàng tự động, cloud MT5 không cần VPS, ZUPIRUS",
        "h1": "Bot Trade Vàng XAU/USD Trên Cloud MT5 Không Cần VPS Hoạt Động Như Thế Nào?",
        "read_time": "6 phút đọc",
        "badge": "CLOUD MT5 · XAU/USD",
        "sections": [
            (
                "1. Tại sao giao dịch XAU/USD thủ công hoặc treo VPS truyền thống dễ gặp rủi ro?",
                "Vàng (XAU/USD) có biên độ biến động trung bình 150–350 pips mỗi phiên Âu–Mỹ. Khi trader tự vào lệnh bằng tay hoặc chạy EA trên VPS Windows giá rẻ, 3 lỗi phổ biến nhất gây cháy tài khoản là: (1) quên đặt Stop Loss cứng hoặc dời SL theo cảm xúc, (2) VPS treo/mất kết nối đúng lúc ra tin CPI/NFP/FOMC, và (3) trượt giá (slippage) khiến khối lượng lot vượt quá giới hạn rủi ro."
            ),
            (
                "2. Kiến trúc Cloud MT5 Zero-VPS của ZUPIRUS Quant Lab",
                "Thay vì bắt người dùng thuê VPS và cài file .ex5 phức tạp, ZUPIRUS kết nối trực tiếp tới máy chủ sàn MT5 (Exness, ICMarkets, FTMO, The5ers, FundedNext...) thông qua cụm Cloud MT5 London G2 với độ trễ khớp lệnh trung bình ~10ms. Mật khẩu giao dịch được mã hóa AES-256 trước khi lưu và tiền của bạn luôn nằm 100% tại sàn."
            ),
            (
                "3. Bốn lớp giáp Fail-Closed bảo vệ mọi lệnh XAU/USD",
                "Mọi tín hiệu XAU/USD khung M15 trước khi đẩy xuống tài khoản đều phải vượt qua 4 lớp kiểm duyệt bắt buộc: L1 Idempotency Lock (chống lặp lệnh tuyệt đối qua Redis + DB), L2 Bắt buộc Stop Loss cứng theo biên độ ATR(14) & kiểm soát Spread, L3 News Shield tự động chặn vào lệnh trước/sau tin đỏ USD ±15 phút, và L4 Slippage Guard từ chối khớp nếu giá trượt quá 20 pips."
            ),
        ],
    },
    {
        "slug": "cach-pass-quy-ftmo-the5ers-fundednext",
        "title": "Cách Pass Quỹ FTMO, The5ers & FundedNext An Toàn | ZUPIRUS",
        "meta_description": "Chiến lược pass quỹ FTMO, The5ers, FundedNext bền vững với Prop Firm Guard: khóa Daily DD 4.0%, HWM 8.0% và chia lot chuẩn 0.75%-1.0%.",
        "keywords": "cách pass quỹ FTMO, pass quỹ The5ers, FundedNext, Prop Firm Guard, tài khoản quỹ live",
        "h1": "Cách Pass Quỹ FTMO, The5ers & FundedNext Bền Vững Với Prop Firm Guard",
        "read_time": "7 phút đọc",
        "badge": "PROP FIRM · PASS QUỸ",
        "sections": [
            (
                "1. Hai nguyên nhân chính khiến 90% trader trượt vòng thi quỹ Prop Firm",
                "Phần lớn trader thi FTMO, The5ers hay FundedNext không trượt vì thiếu tín hiệu đẹp, mà trượt vì vi phạm luật Daily Drawdown (5%/ngày) hoặc Max Overall Drawdown (10%) chỉ trong 1 phiên biến động mạnh. Khi tâm lý gỡ lỗ xuất hiện, việc tăng gấp đôi khối lượng lot sẽ phá vỡ toàn bộ tài khoản quỹ trong chưa đầy 30 phút."
            ),
            (
                "2. Cơ chế Prop Firm Guard 3 tầng trên ZUPIRUS",
                "ZUPIRUS tích hợp chế độ Prop Firm Guard riêng biệt cho 2 giai đoạn CHALLENGE (đang thi) và LIVE (đã cấp vốn): (1) Ngắt mạch Daily DD tự động tại ngưỡng an toàn 4.0% (thấp hơn mức 5.0% của sàn để dự phòng trượt giá), (2) Khóa HWM Trailing Drawdown tại 8.0% từ đỉnh Equity cao nhất, và (3) Tự động giảm 50% rủi ro khi đã đạt từ 80% mục tiêu lợi nhuận vòng thi để bảo toàn thành quả."
            ),
            (
                "3. Quy tắc vàng khi đã cầm tài khoản Quỹ LIVE (Funded)",
                "Khi tài khoản chuyển sang giai đoạn LIVE Funded, ZUPIRUS tự động kích hoạt trần rủi ro tối đa 1.0% cho mỗi ý tưởng lệnh (Idea Risk Cap) và giữ kỷ luật R:R >= 1.8. Kết quả thực tế trên hệ thống cho thấy danh mục 3 quỹ LIVE ($100K FTMO, $100K The5ers, $200K FundedNext) duy trì Max Drawdown dưới 1.5% trong khi vẫn đạt lợi nhuận ổn định."
            ),
        ],
    },
    {
        "slug": "quan-tri-rui-ro-drawdown-prop-firm",
        "title": "Công Thức Tính Lot XAU/USD & Quản Trị Daily Drawdown Chuẩn Quỹ Prop Firm",
        "meta_description": "Công thức tính khối lượng Lot XAU/USD chuẩn xác cho tài khoản Standard, Cent (USC) và Prop Firm. Cách kiểm soát Daily Drawdown dưới 4% và tối ưu Profit Factor.",
        "keywords": "công thức tính lot XAUUSD, quản trị rủi ro drawdown, tài khoản cent MT5, profit factor",
        "h1": "Công Thức Tính Lot XAU/USD & Quản Trị Daily Drawdown Chuẩn Định Lượng",
        "read_time": "5 phút đọc",
        "badge": "QUẢN TRỊ VỐN · LOT SIZING",
        "sections": [
            (
                "1. Công thức tính Lot chuẩn hóa theo khoảng cách Stop Loss",
                "Thay vì đánh một mức lot cố định (ví dụ lúc nào cũng 0.5 lot dù SL là 30 pips hay 100 pips), thuật toán định lượng tính khối lượng dựa trên ngân sách rủi ro cố định theo % Equity: Lot = (Equity × Risk%) / (SL_Points × Point_Size × Contract_Size). Nhờ đó, dù thị trường biến động mạnh hay nhẹ, mỗi lệnh thua luôn được kiểm soát chính xác đúng số USD cho phép."
            ),
            (
                "2. Xử lý chuẩn xác cho tài khoản Cent (USC) và Standard",
                "Trên các tài khoản Cent (Exness Standard Cent, v.v.), số dư hiển thị theo đơn vị USC (1 USD = 100 USC) và Contract Size khác tài khoản Standard. ZUPIRUS tự động nhận diện loại tài khoản CENT / STANDARD / PROP để quy đổi chính xác, đồng thời áp dụng nguyên tắc Fail-Closed (từ chối vào lệnh nếu min lot 0.01 vẫn vượt quá ngân sách rủi ro cho phép)."
            ),
            (
                "3. Kết hợp Auto Break-Even & kiểm soát chuỗi thua liên tiếp",
                "Với rủi ro 0.75% mỗi lệnh và trần lỗ ngày 4.0%, tài khoản quỹ có thể chịu được tới 5 lệnh thua liên tiếp trong ngày mà vẫn chưa chạm ngưỡng vi phạm của sàn. Kết hợp dời SL về hòa vốn (Auto Break-Even) tại +1.0R giúp bảo vệ lợi nhuận và nâng cao Profit Factor dài hạn."
            ),
        ],
    },
    {
        "slug": "ket-noi-mt5-cloud-zero-vps",
        "title": "Hướng Dẫn Kết Nối Cloud MT5 Không Cần VPS Trong 3 Phút (Exness, ICMarkets, FTMO)",
        "meta_description": "Hướng dẫn chi tiết 3 bước kết nối tài khoản MT5 Exness, ICMarkets, FTMO lên Cloud MT5 Zero-VPS của ZUPIRUS: không cần thuê VPS, không cần cài EA, kích hoạt SePay 24/7.",
        "keywords": "kết nối MT5 cloud, copy trade MT5 không cần VPS, MetaApi Cloud MT5, Exness ICMarkets MT5",
        "h1": "Hướng Dẫn Kết Nối Tài Khoản MT5 Lên Đám Mây Zero-VPS Trong 3 Phút",
        "read_time": "4 phút đọc",
        "badge": "HƯỚNG DẪN · ZERO-VPS",
        "sections": [
            (
                "Bước 1: Đăng ký tài khoản & xác thực bảo mật OTP",
                "Truy cập https://app.zupirus.com, đăng ký bằng email cá nhân và nhập mã xác thực OTP 6 chữ số được gửi tức thì về hộp thư. Toàn bộ phiên làm việc được bảo vệ bằng cookie HttpOnly và mã hóa mật khẩu chuẩn scrypt."
            ),
            (
                "Bước 2: Chọn gói hạ tầng Cloud MT5 & kích hoạt SePay VietQR 24/7",
                "Chọn gói phù hợp với số lượng tài khoản MT5 bạn muốn chạy: Starter ($25/tháng — 1 tài khoản), Growth ($39/tháng — tối đa 3 tài khoản) hoặc Alpha VIP ($59/tháng — tối đa 5 tài khoản kèm Prop Firm Guard). Quét mã SePay VietQR để hệ thống tự động đối soát và mở slot trong vài giây."
            ),
            (
                "Bước 3: Đấu nối MT5 Login & cấu hình lớp giáp rủi ro",
                "Tại tab Tài khoản Cloud MT5, nhập MT5 Login, Master Password và chọn Broker Server (Exness, ICMarkets, FTMO, The5ers, FundedNext...). Hệ thống tự động triển khai node trên cụm London G2, đồng bộ Balance/Equity và sổ lệnh theo thời gian thực qua SSE mà bạn không cần bật máy tính hay thuê VPS."
            ),
        ],
    },
    {
        "slug": "so-sanh-ftmo-the5ers-fundednext",
        "title": "So Sánh FTMO vs The5ers vs FundedNext 2026: Quỹ Nào Dễ Pass Bằng Bot XAU/USD?",
        "meta_description": "So sánh chi tiết luật Daily Drawdown, Max Drawdown, spread vàng XAU/USD và chính sách dùng Bot/EA trên 3 quỹ lớn nhất: FTMO, The5ers và FundedNext năm 2026.",
        "keywords": "so sánh FTMO The5ers FundedNext, quỹ prop firm tốt nhất 2026, thi quỹ bằng bot trade vàng, prop firm Việt Nam",
        "h1": "So Sánh FTMO vs The5ers vs FundedNext 2026: Quỹ Nào Phù Hợp Nhất Cho Bot XAU/USD?",
        "read_time": "8 phút đọc",
        "badge": "SO SÁNH QUỸ · PROP FIRM",
        "sections": [
            (
                "1. Bảng so sánh luật Drawdown & mục tiêu lợi nhuận (2-Step Standard)",
                "Cả 3 quỹ lớn đều có khung luật khá chuẩn mực nhưng khác biệt ở điểm tính Daily Loss: FTMO áp dụng Daily Loss 5% tính trên Equity đầu ngày và Max Loss 10% (Static), mục tiêu Phase 1 là 10%, Phase 2 là 5%. The5ers (High Stakes) yêu cầu mục tiêu Phase 1 chỉ 8% và Phase 2 là 5% với Daily Pause 5% và Max Loss 10%. FundedNext (Stellar 2-Step) nổi bật với chia lợi nhuận ngay từ giai đoạn thi (15% Profit Share) cùng Daily Loss 5% và Max Loss 10%."
            ),
            (
                "2. Khả năng tương thích với Bot Trade Vàng XAU/USD & News Trading",
                "Cả FTMO, The5ers và FundedNext đều cho phép sử dụng hệ thống giao dịch tự động (EA/Bot) nếu không lạm dụng HFT/Tick Scalping hay Copy Trade chéo giữa các người dùng lạ. Tuy nhiên, tài khoản LIVE của FTMO và The5ers có quy định chặt quanh tin đỏ USD (CPI, NFP, FOMC ±2 đến ±5 phút). Vì vậy lớp giáp News Shield ±15 phút của ZUPIRUS là yếu tố bắt buộc để tránh bị hủy lợi nhuận do vi phạm luật tin tức."
            ),
            (
                "3. Khuyến nghị phân bổ danh mục quỹ cho trader định lượng",
                "Thay vì dồn toàn bộ vốn mua 1 tài khoản lớn ở một quỹ duy nhất, trader chuyên nghiệp thường chia đều 3 quỹ (ví dụ: FTMO $100K + The5ers $100K + FundedNext $200K) và đồng bộ qua gói Alpha VIP (tối đa 5 tài khoản MT5) với mức rủi ro 0.75%/lệnh. Cách này vừa phân tán rủi ro đối tác quỹ, vừa tận dụng tối đa nguồn vốn cấp lên tới $400,000+."
            ),
        ],
    },
    {
        "slug": "ea-bot-trade-vang-co-bi-cam-prop-firm-khong",
        "title": "Dùng Bot/EA Trade Vàng Trên Prop Firm Có Bị Cấm Không? 5 Luật Bắt Buộc Phải Tránh",
        "meta_description": "Giải đáp chi tiết quy định dùng EA/Bot giao dịch vàng XAU/USD trên FTMO, The5ers, FundedNext: 5 hành vi bị cấm tuyệt đối (HFT, Martingale, tin đỏ) và cách cấu hình hợp lệ.",
        "keywords": "dùng bot trade quỹ có bị cấm không, EA pass quỹ FTMO, luật cấm prop firm, Martingale prop firm",
        "h1": "Dùng Bot/EA Trade Vàng Trên Quỹ Prop Firm Có Bị Cấm Không? 5 Luật Phải Tránh",
        "read_time": "6 phút đọc",
        "badge": "LUẬT QUỸ · COMPLIANCE",
        "sections": [
            (
                "1. Các quỹ Prop Firm uy tín CÓ cho phép dùng Bot/EA hợp lệ",
                "FTMO, The5ers, FundedNext và hầu hết quỹ uy tín đều cho phép dùng hệ thống giao dịch tự động (Algorithmic Trading / EA / Cloud API). Điều các quỹ cấm không phải là việc tự động hóa lệnh, mà là các kỹ thuật khai thác lỗi máy chủ demo hoặc đánh bạc rủi ro cực đoan."
            ),
            (
                "2. 5 hành vi khiến tài khoản quỹ bị khóa ngay lập tức",
                "Bạn tuyệt đối phải tránh: (1) High-Frequency Trading / Latency Arbitrage giữ lệnh dưới 30–60 giây, (2) Martingale / Grid gồng lỗ nhồi lot gấp thếp (vi phạm quy tắc Gambling / Risk Management), (3) Giao dịch sát giờ tin đỏ USD (CPI, NFP, FOMC) trên tài khoản Funded, (4) Đánh quá lớn một lệnh (>2% rủi ro) gọi là One-Sided Betting, và (5) Mở lệnh không có Stop Loss bảo vệ."
            ),
            (
                "3. Tại sao kiến trúc ZUPIRUS an toàn 100% trước bài kiểm tra của Quỹ",
                "ZUPIRUS không dùng Martingale, không dùng Grid và không đánh Tick Scalping. Mỗi lệnh XAU/USD khung M15 đều có Stop Loss cứng tính theo ATR(14), tỷ lệ R:R >= 1.8, trần rủi ro Idea Risk Cap <= 1.0% ở chế độ Prop LIVE, tự động chặn giao dịch ±15 phút quanh tin đỏ USD và ngắt mạch Daily DD tại 4.0% trước khi chạm luật 5.0% của sàn."
            ),
        ],
    },
    {
        "slug": "so-sanh-cloud-mt5-va-vps-forex",
        "title": "So Sánh Cloud MT5 Zero-VPS vs Thuê VPS Forex Truyền Thống (Chi Phí & Độ Trễ)",
        "meta_description": "Phân tích ưu nhược điểm giữa hạ tầng Cloud MT5 Zero-VPS (London G2) và thuê VPS Windows Forex truyền thống: độ trễ khớp lệnh, rủi ro treo MT5 và tổng chi phí hàng tháng.",
        "keywords": "so sánh Cloud MT5 và VPS Forex, thuê VPS chạy EA MT5, Cloud MT5 không cần VPS, độ trễ khớp lệnh MT5",
        "h1": "So Sánh Cloud MT5 Zero-VPS vs Thuê VPS Forex Truyền Thống: Nên Chọn Gì?",
        "read_time": "5 phút đọc",
        "badge": "HẠ TẦNG · CLOUD VS VPS",
        "sections": [
            (
                "1. Ba điểm yếu chí mạng của VPS Windows chạy MT5 truyền thống",
                "Khi thuê VPS Windows giá $15–$35/tháng để cài phần mềm MT5 và kéo file .ex5 vào biểu đồ, trader thường gặp 3 sự cố nghiêm trọng: (1) Windows tự khởi động lại cập nhật làm tắt MT5 mà chủ tài khoản không hay biết, (2) Tràn RAM/CPU khi mở nhiều biểu đồ khiến lệnh cắt lỗ hoặc dời Break-Even bị treo, và (3) Độ trễ mạng cao (80–250ms) nếu chọn nhầm vị trí máy chủ xa broker."
            ),
            (
                "2. Lợi thế của hạ tầng Cloud MT5 Zero-VPS London G2",
                "Cloud MT5 loại bỏ hoàn toàn giao diện Windows nặng nề: kết nối trực tiếp tới máy chủ broker qua API độ trễ thấp (~10–25ms tại cụm London G2), tự động giám sát trạng thái kết nối 24/7, đẩy log thực thi real-time qua SSE lên điện thoại/web và kích hoạt Idempotency Lock để không bao giờ xảy ra lỗi vào đúp lệnh khi mạng chập chờn."
            ),
            (
                "3. So sánh tổng chi phí sở hữu (TCO)",
                "Với VPS truyền thống, bạn phải trả tiền thuê VPS riêng ($20–$40/tháng) cộng thêm tiền mua hoặc thuê EA ($50–$200/tháng) và tự chịu rủi ro bảo trì kỹ thuật. Với ZUPIRUS, gói Starter ($25/tháng) đã bao gồm trọn gói cả hạ tầng Cloud MT5 Zero-VPS, chiến lược định lượng XAU/USD và 4 lớp giáp bảo vệ vốn."
            ),
        ],
    },
    {
        "slug": "cach-doc-profit-factor-sharpe-drawdown",
        "title": "Cách Kiểm Tra Bot Trade Vàng Thật Hay Lừa Đảo Qua Profit Factor, Sharpe & Drawdown",
        "meta_description": "Hướng dẫn 4 chỉ số định lượng bắt buộc để thẩm định Bot Trade Vàng XAU/USD: Profit Factor, Max Drawdown, Winrate vs R:R và cách phát hiện ảnh lợi nhuận ảo hoặc bot gồng lỗ.",
        "keywords": "kiểm tra bot trade thật hay ảo, profit factor là gì, max drawdown là gì, đánh giá bot trade vàng",
        "h1": "Cách Kiểm Tra Bot Trade Vàng Thật Hay Lừa Đảo Qua 4 Chỉ Số Định Lượng",
        "read_time": "6 phút đọc",
        "badge": "THẨM ĐỊNH · QUANT METRICS",
        "sections": [
            (
                "1. Cạm bẫy lớn nhất: Winrate 95% nhưng không có Stop Loss",
                "Rất nhiều nhóm bán bot trade vàng khoe lịch sử xanh 100% với Winrate 90–98%. Tuy nhiên, nếu kiểm tra sâu sẽ thấy họ KHÔNG đặt Stop Loss cứng hoặc dùng chiến thuật Martingale/Grid gồng âm trạng thái (Floating Drawdown) tới 40–70% tài khoản. Chỉ cần vàng chạy 1 chiều 400 pips trong phiên FOMC là toàn bộ lợi nhuận cả năm bốc hơi trong 1 đêm."
            ),
            (
                "2. Bốn chỉ số vàng để thẩm định hệ thống định lượng chuẩn",
                "Một hệ thống giao dịch XAU/USD đáng tin cậy cần đáp ứng đồng thời: (1) Profit Factor (Tổng lãi / Tổng lỗ) từ 1.5 đến 4.5 trên mẫu lệnh đủ lớn, (2) Max Drawdown thực tế dưới 5–10% (không giấu lệnh âm đang thả nổi), (3) Tỷ lệ Risk:Reward trung bình >= 1.5 để không phải gồng lỗ, và (4) Mọi lệnh đều có Stop Loss cứng ngay thời điểm khớp lệnh."
            ),
            (
                "3. Kiểm chứng minh bạch sổ lệnh thực tế trên ZUPIRUS",
                "ZUPIRUS công khai trực tiếp bảng Hiệu Suất Thực Tế (Public Verified Track Record) ngay trên trang chủ https://zupirus.com/#track-record với đầy đủ Winrate, Profit Factor, Max Drawdown, lợi nhuận ròng và lịch sử giao dịch đã ẩn danh từ cơ sở dữ liệu thực, giúp trader kiểm chứng bằng con số thay vì lời hứa hẹn."
            ),
        ],
    },
    {
        "slug": "bot-pass-quy-ftmo-the5ers-tu-dong",
        "title": "Bot Pass Quỹ FTMO, The5ers & FundedNext Tự Động 2026 | ZUPIRUS",
        "meta_description": "Giải pháp bot pass quỹ FTMO, The5ers, FundedNext tự động trên Cloud MT5. Tự động chốt lời bảo vệ chỉ tiêu, khóa rủi ro Daily Drawdown 4.0% và chống vi phạm tin đỏ.",
        "keywords": "bot pass quỹ ftmo, bot pass quỹ the5ers, bot pass quỹ fundednext, ea pass quỹ tự động, pass quỹ prop firm bằng bot, bot trade vàng chuẩn quỹ",
        "h1": "Bot Pass Quỹ FTMO, The5ers & FundedNext Tự Động: Giải Pháp Định Lượng Chuẩn Quỹ 2026",
        "read_time": "9 phút đọc",
        "badge": "PASS QUỸ · PROP AUTOMATION",
        "sections": [
            (
                "1. Nghịch lý của việc tự trade tay khi thi quỹ Prop Firm",
                "Hơn 90% trader trượt vòng Challenge của FTMO, The5ers hay FundedNext không phải do thiếu kiến thức phân tích kỹ thuật, mà do rào cản tâm lý khi đối diện với các giới hạn khắc nghiệt: Daily Drawdown 5.0%, Max Drawdown 10.0% và áp lực thời gian/chỉ tiêu lợi nhuận 8-10%. Sau 2 lệnh thua liên tiếp, trader thường mất bình tĩnh, tăng khối lượng lot (revenge trading) và làm bốc hơi tài khoản chỉ trong một phiên Âu hoặc Mỹ. Sử dụng bot định lượng loại bỏ 100% cảm xúc, thực thi kỷ luật cơ học từng pip."
            ),
            (
                "2. Cơ chế bảo vệ 3 giai đoạn: Challenge, Verification và Cấp Vốn LIVE",
                "Hệ thống ZUPIRUS phân định rạch ròi 3 trạng thái vận hành: (1) Tại Phase 1 (Mục tiêu 8-10%), bot duy trì rủi ro 0.75%/lệnh với tỷ lệ R:R >= 1.5; khi đạt 80% chỉ tiêu, hệ thống tự động giảm rủi ro về 0.35%/lệnh để về đích an toàn nhất mà không bị kéo ngược. (2) Tại Phase 2 (Mục tiêu 5%), rủi ro giữ ở 0.50%/lệnh. (3) Khi tài khoản lên LIVE (Funded), ZUPIRUS kích hoạt trần rủi ro nghiêm ngặt tối đa 1.0%/ngày nhằm mục tiêu bảo toàn tài khoản và rút lợi nhuận đều đặn hàng kỳ."
            ),
            (
                "3. Lớp khóa cứng Daily Drawdown 4.0% và News Shield ±15 Phút",
                "Luật các quỹ thường đánh rớt tài khoản nếu lỗ trong ngày chạm 5.0% Equity đầu ngày. ZUPIRUS đặt chốt chặn an toàn tại 4.0% (trước khi sàn kịp can thiệp). Khi chạm mức này, cụm máy chủ London G2 lập tức đóng toàn bộ lệnh mở, hủy lệnh chờ và ngắt quyền giao dịch của trạm cho tới hết ngày. Đồng thời, bộ lọc tin tức News Shield tự động đóng băng giao dịch trước và sau 15 phút quanh các sự kiện kinh tế đỏ USD (CPI, NFP, FOMC), đảm bảo tài khoản không bao giờ dính trượt giá hay vi phạm chính sách giao dịch tin."
            ),
        ],
    },
    {
        "slug": "copy-trade-vang-mt5-exness-khong-can-vps",
        "title": "Copy Trade Vàng XAU/USD Trên MT5 Exness Không Cần VPS | ZUPIRUS",
        "meta_description": "Hướng dẫn copy trade vàng XAU/USD tự động trên MT5 Exness bằng hạ tầng Cloud London G2. Không cần máy tính, không tốn tiền thuê VPS, khớp lệnh độ trễ cực thấp.",
        "keywords": "copy trade vàng exness, bot trade vàng exness không cần vps, copy trade xauusd mt5, bot tự động exness, ea vàng exness",
        "h1": "Copy Trade Vàng XAU/USD Trên MT5 Exness Không Cần VPS: Kết Nối Siêu Tốc London G2",
        "read_time": "7 phút đọc",
        "badge": "COPY TRADE · EXNESS CLOUD",
        "sections": [
            (
                "1. Tại sao không nên chạy Copy Trade qua VPS Windows truyền thống?",
                "Chạy EA hoặc bot copy trade thủ công bằng VPS Windows thường phát sinh chi phí từ $10-$25 mỗi tháng, cấu hình RAM/CPU yếu dẫn tới đơ máy, mất kết nối mạng đột ngột hoặc tự khởi động lại khi cập nhật Windows đúng lúc thị trường biến động mạnh. Với ZUPIRUS, người dùng không cần thuê VPS riêng: tài khoản MT5 Exness của bạn được kết nối trực tiếp lên cụm Cloud Container tại trung tâm dữ liệu London G2, chỉ cách máy chủ Exness dưới 3ms."
            ),
            (
                "2. Tương thích hoàn hảo với tài khoản Exness Standard, Raw Spread và Cent (USC)",
                "ZUPIRUS tự động nhận diện loại tài khoản Exness và điều chỉnh logic khớp lệnh. Nếu bạn dùng tài khoản Standard hoặc Raw Spread, hệ thống khớp lệnh theo đơn vị Lot chuẩn. Nếu bạn dùng tài khoản Cent (USC) với số vốn nhỏ $50-$100, hệ thống tự động quy đổi tỷ lệ khối lượng 1:100, đảm bảo mỗi lệnh chỉ chịu rủi ro vài chục cent tiền thật, an toàn tuyệt đối cho người mới bắt đầu trải nghiệm."
            ),
            (
                "3. Ba bước kích hoạt kết nối Exness chỉ trong 60 giây",
                "Bước 1: Đăng nhập vào ZUPIRUS Hub tại https://app.zupirus.com/. Bước 2: Chọn 'Thêm Tài Khoản MT5', nhập số tài khoản MT5 Exness, mật khẩu Master/Investor và chọn Server (ví dụ: Exness-MT5Real, Exness-MT5Real9...). Bước 3: Bật công tắc Auto-Trade. Toàn bộ tín hiệu định lượng XAU/USD từ mô hình Alpha Quant sẽ được đồng bộ theo thời gian thực 24/5."
            ),
        ],
    },
    {
        "slug": "kinh-nghiem-thi-quy-fundednext-stellar",
        "title": "Kinh Nghiệm Thi Quỹ FundedNext Stellar 2-Step Bằng Bot XAU/USD | ZUPIRUS",
        "meta_description": "Bí quyết vượt qua gói FundedNext Stellar 2-Step và nhận 15% chia sẻ lợi nhuận ngay từ vòng thi. Quy tắc giao dịch tin tức, quản lý drawdown và tối ưu lot size.",
        "keywords": "thi quỹ fundednext stellar, kinh nghiệm thi fundednext, bot trade fundednext, quỹ fundednext việt nam, fundednext stellar 2 step xauusd",
        "h1": "Kinh Nghiệm Thi Quỹ FundedNext Stellar 2-Step: Tận Dụng Bot Định Lượng & Nhận 15% Profit Share",
        "read_time": "8 phút đọc",
        "badge": "FUNDEDNEXT · STELLAR STRATEGY",
        "sections": [
            (
                "1. Điểm đặc sắc nhất của gói FundedNext Stellar 2-Step",
                "Trong số các quỹ Prop Firm hiện nay, gói Stellar của FundedNext có ưu thế vượt trội: Không giới hạn thời gian thi (No Time Limit), chia sẻ 15% lợi nhuận ngay từ giai đoạn Challenge và Verification khi bạn vượt qua các vòng, đồng thời đòn bẩy lên tới 1:100. Mục tiêu Phase 1 là 8% và Phase 2 là 5%, Daily Drawdown tối đa 5% và Max Drawdown 10% (dựa trên Balance)."
            ),
            (
                "2. Cấu hình rủi ro và khối lượng Lot tối ưu cho FundedNext Stellar",
                "Do luật Daily Drawdown tính trên Balance đầu ngày (hoặc Equity nếu Equity cao hơn Balance), chiến lược an toàn nhất trên cặp XAU/USD là đặt Stop Loss cố định 35-50 pips với rủi ro 0.6% mỗi lệnh. Với tài khoản $50,000, 0.6% rủi ro tương ứng $300. Nếu Stop Loss là 40 pips ($4/oz), khối lượng vào lệnh chuẩn là 0.75 lot. Nếu thua 2 lệnh liên tiếp trong ngày (-1.2%), hệ thống tự ngắt giao dịch để bảo toàn 3.8% Daily DD còn lại."
            ),
            (
                "3. Xử lý quy định tin tức và giữ lệnh qua đêm (Overnight/Weekend)",
                "FundedNext Stellar cho phép giữ lệnh qua đêm và qua tuần, tuy nhiên tài khoản LIVE có kiểm soát việc khớp lệnh trong cửa sổ tin tức kinh tế quan trọng. ZUPIRUS tự động kích hoạt News Shield để tránh vào lệnh mới trong khoảng ±15 phút quanh tin CPI/NFP. Nhờ đó, tài khoản của bạn luôn giữ được lịch sử sạch và đủ điều kiện rút tiền nhanh chóng qua cổng Crypto hoặc chuyển khoản ngân hàng."
            ),
        ],
    },
    {
        "slug": "top-5-sai-lam-chay-tai-khoan-quy-prop-firm",
        "title": "Top 5 Sai Lầm Khiến 90% Trader Cháy Quỹ Prop Firm & Cách Khắc Phục",
        "meta_description": "Phân tích 5 nguyên nhân phổ biến khiến trader mất tài khoản FTMO, The5ers: nhồi lệnh Martingale, không cắt lỗ, giao dịch tin NFP/CPI và vượt Daily Loss.",
        "keywords": "sai lầm thi quỹ prop firm, tại sao cháy quỹ ftmo, kinh nghiệm giữ quỹ the5ers, mẹo pass quỹ prop firm, quản lý vốn prop firm",
        "h1": "Top 5 Sai Lầm Khiến 90% Trader Cháy Tài Khoản Quỹ Prop Firm & Cách Khắc Phục Triệt Để",
        "read_time": "8 phút đọc",
        "badge": "CẢNH BÁO · RISK MANAGEMENT",
        "sections": [
            (
                "1. Sai lầm #1: Nhồi lệnh âm (Martingale) và không đặt Stop Loss cứng",
                "Nhiều trader có thói quen khi lệnh vàng đi ngược hướng 50 pips sẽ mở thêm lệnh gấp đôi lot với hy vọng giá hồi lại hòa vốn. Trên tài khoản quỹ với mức sụt giảm tối đa chỉ 10%, chỉ một cú giật 150-200 pips là tài khoản bị đóng băng ngay lập tức. Quy tắc bất biến: Mọi lệnh phải có Stop Loss ngay thời điểm mở lệnh và tuyệt đối không bao giờ nhồi lệnh âm."
            ),
            (
                "2. Sai lầm #2: Đánh cược tài sản vào giờ tin tức lớn (Gambling News)",
                "Các khung giờ công bố Non-Farm Payrolls (NFP) hay CPI của Mỹ thường có spread vàng giãn từ 1.5 pip lên 15-20 pips và trượt giá (slippage) nghiêm trọng. Nhiều trader hy vọng 'ăn đậm' bằng lệnh lớn trước tin, dẫn tới việc bị quét Stop Loss ở cả hai đầu hoặc vi phạm quy định cấm giao dịch tin tức của quỹ FTMO/The5ers. Giải pháp của ZUPIRUS là cơ chế News Shield tự động ngắt lệnh trước tin 15 phút."
            ),
            (
                "3. Sai lầm #3: Giao dịch quá mức (Overtrading) sau chuỗi thua & Không tính Daily DD",
                "Khi bị lỗ 2% trong ngày, tâm lý gỡ gạc khiến trader mở 5-10 lệnh tiếp theo liên tục trong trạng thái ức chế. Đến khi nhận thông báo từ quỹ thì tài khoản đã chạm ngưỡng Daily Drawdown 5.0%. Để khắc phục, hệ thống ZUPIRUS áp dụng khóa cơ học tại 4.0% Daily Loss — một khi đã chạm, máy tính sẽ cắt toàn bộ quyền can thiệp cho đến 00:00 GMT ngày hôm sau, bảo vệ 100% tài khoản sống sót đường dài."
            ),
        ],
    },
    {
        "slug": "chay-bot-vang-tai-khoan-cent-exness",
        "title": "Chạy Bot Vàng XAU/USD Trên Tài Khoản Cent Exness Vốn $50 - $100 | ZUPIRUS",
        "meta_description": "Cách chạy bot giao dịch vàng XAU/USD an toàn trên tài khoản Cent (USC) Exness chỉ từ $50-$100 vốn thực. Chia nhỏ rủi ro 100 lần, học tập và kiểm nghiệm an toàn.",
        "keywords": "bot vàng tài khoản cent exness, chạy ea tài khoản cent, bot xauusd vốn nhỏ, trade vàng cent exness, copy trade tài khoản cent",
        "h1": "Hướng Dẫn Chạy Bot Vàng XAU/USD Trên Tài Khoản Cent Exness: Vốn $50 Vẫn Chạy Chuẩn Định Lượng",
        "read_time": "7 phút đọc",
        "badge": "VỐN NHỎ · EXNESS CENT (USC)",
        "sections": [
            (
                "1. Tài khoản Cent (USC) là gì và vì sao là bước đệm lý tưởng?",
                "Tài khoản Standard Cent của Exness quy đổi 1 USD = 100 USC (Cent). Khi bạn nạp $50 vốn thật, số dư hiển thị trên MT5 là 5,000 USC. Điều này cho phép bạn giao dịch khối lượng siêu nhỏ: 1.00 Lot Cent tương đương 1 oz vàng (thay vì 100 oz như Standard), tức là biến động $1 trên giá vàng chỉ tương ứng $0.10 rủi ro thực tế. Đây là môi trường hoàn hảo để kiểm chứng độ ổn định của bot định lượng mà không lo áp lực tài chính."
            ),
            (
                "2. Thuật toán ZUPIRUS tự động nhận diện Contract Size tài khoản Cent",
                "Khi kết nối tài khoản MT5 Exness vào ZUPIRUS, hệ thống tự động đọc thông số Contract Size của mã vàng (XAUUSDm hoặc XAUUSDc). Nếu phát hiện tài khoản Cent, thuật toán Fanout Engine tự động điều chỉnh hệ số tính Lot để rủi ro trên mỗi lệnh đúng bằng 0.5% - 1.0% của 5,000 USC ($0.25 - $0.50 tiền thật). Bạn được trải nghiệm hệ thống quản trị rủi ro chuyên nghiệp như tài khoản quỹ $100,000."
            ),
            (
                "3. Lộ trình từ $50 Cent đến tài khoản Quỹ $100,000",
                "Lộ trình tối ưu cho mọi nhà đầu tư: Tháng 1 chạy tài khoản Cent với $50-$100 để quan sát cách bot xử lý phiên London, phiên New York và tự động khóa lệnh khi có tin tức. Khi đã hiểu rõ cách vận hành của hệ thống và thấy hiệu suất thực tế tăng trưởng ổn định, bạn có thể tự tin đầu tư gói thi quỹ FTMO/The5ers $50,000 - $100,000 để gia tăng thu nhập quy mô lớn."
            ),
        ],
    },
]

GUIDE_BY_SLUG = {str(g["slug"]): g for g in GUIDES}


def _render_shell(
    title: str,
    description: str,
    canonical: str,
    keywords: str,
    json_ld: dict,
    body_html: str,
    extra_head_html: str = "",
    lang: str = "vi",
) -> str:
    is_en = str(lang or "").strip().lower() == "en"
    html_lang = "en" if is_en else "vi"
    locale_val = "en_US" if is_en else "vi_VN"
    esc_title = html.escape(title)
    esc_desc = html.escape(description)
    esc_kw = html.escape(keywords)
    esc_canon = html.escape(canonical)
    ld_str = json.dumps(json_ld, ensure_ascii=False)

    nav_perf = "Real Performance" if is_en else "Hiệu Suất Thực Tế"
    nav_lot = "XAU/USD Lot Calculator" if is_en else "Tính Lot XAU/USD"
    nav_dd = "Prop Firm Drawdown" if is_en else "Tính Drawdown Quỹ"
    nav_guide = "Guides & Documentation" if is_en else "Kiến Thức & Hướng Dẫn"
    nav_cta = "Launch Portal →" if is_en else "Mở Cổng Giao Dịch →"

    footer_home = "Home" if is_en else "Trang Chủ"
    footer_guides = "Guides" if is_en else "Hướng Dẫn"
    footer_login = "Login" if is_en else "Đăng Nhập"
    footer_tagline = (
        "Zero-VPS Cloud MT5 Infrastructure & Prop Firm Guard"
        if is_en
        else "Hạ tầng Cloud MT5 XAU/USD Zero-VPS & Prop Firm Guard"
    )

    return f"""<!doctype html>
<html lang="{html_lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc_title}</title>
  <meta name="description" content="{esc_desc}" />
  <meta name="keywords" content="{esc_kw}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <link rel="canonical" href="{esc_canon}" />
  <link rel="alternate" hreflang="vi" href="https://zupirus.com/" />
  <link rel="alternate" hreflang="en" href="https://zupirus.com/?lang=en" />
  <link rel="alternate" hreflang="x-default" href="https://zupirus.com/?lang=en" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="ZUPIRUS Quant Lab" />
  <meta property="og:locale" content="{locale_val}" />
  <meta property="og:locale:alternate" content="{'vi_VN' if is_en else 'en_US'}" />
  <meta property="og:url" content="{esc_canon}" />
  <meta property="og:title" content="{esc_title}" />
  <meta property="og:description" content="{esc_desc}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc_title}" />
  <meta name="twitter:description" content="{esc_desc}" />
  <script type="application/ld+json">{ld_str}</script>
  {extra_head_html}
  <style>
    :root {{ color-scheme: dark; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #020617; color: #e2e8f0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.75; }}
    a {{ color: #fbbf24; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    header {{ position: sticky; top: 0; z-index: 20; background: rgba(2, 6, 23, 0.92); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.08); }}
    .nav {{ max-width: 980px; margin: 0 auto; padding: 14px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }}
    .brand {{ font-weight: 800; letter-spacing: 0.08em; color: #fbbf24; font-size: 16px; }}
    .nav-links {{ display: flex; flex-wrap: wrap; gap: 16px; align-items: center; font-size: 13px; }}
    .cta {{ background: #fbbf24; color: #020617 !important; padding: 8px 16px; border-radius: 10px; font-weight: 800; font-size: 13px; text-decoration: none !important; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 36px 20px 72px; }}
    .crumb {{ font-size: 12px; color: #94a3b8; margin-bottom: 18px; font-family: ui-monospace, SFMono-Regular, monospace; }}
    .badge {{ display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: #fbbf24; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.35); padding: 4px 10px; border-radius: 8px; font-family: ui-monospace, monospace; }}
    h1 {{ font-size: clamp(26px, 4vw, 38px); line-height: 1.25; color: #f8fafc; margin: 14px 0 12px; font-weight: 800; }}
    h2 {{ font-size: 21px; color: #fde68a; margin: 30px 0 10px; line-height: 1.35; }}
    p {{ color: #cbd5e1; font-size: 15.5px; margin: 0 0 14px; }}
    .card {{ background: #071022; border: 1px solid rgba(255,255,255,0.09); border-radius: 16px; padding: 22px; margin-top: 18px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 24px; }}
    .cta-box {{ margin-top: 38px; background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(6,182,212,0.10)); border: 1px solid rgba(245,158,11,0.38); border-radius: 18px; padding: 26px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }}
    .calc-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 18px; }}
    .field label {{ display: block; font-size: 12px; font-weight: 700; color: #94a3b8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em; }}
    .field input, .field select {{ width: 100%; background: #020617; color: #f8fafc; border: 1px solid rgba(148,163,184,0.28); border-radius: 10px; padding: 10px 12px; font-size: 15px; font-family: ui-monospace, SFMono-Regular, monospace; }}
    .presets {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }}
    .preset-btn {{ background: rgba(245,158,11,0.10); color: #fcd34d; border: 1px solid rgba(245,158,11,0.30); border-radius: 7px; padding: 4px 9px; font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: ui-monospace, monospace; }}
    .preset-btn:hover {{ background: rgba(245,158,11,0.22); }}
    .kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; }}
    .kpi {{ background: #020617; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; }}
    .kpi-primary {{ border-color: rgba(251,191,36,0.5); background: linear-gradient(135deg, rgba(245,158,11,0.14), rgba(2,6,23,0.95)); }}
    .kpi-label {{ font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }}
    .kpi-val {{ font-size: 22px; font-weight: 800; color: #f8fafc; font-family: ui-monospace, monospace; margin-top: 4px; }}
    .kpi-primary .kpi-val {{ color: #fbbf24; font-size: 26px; }}
    .kpi-sub {{ font-size: 11.5px; color: #94a3b8; margin-top: 4px; }}
    .alert-box {{ display: none; margin-top: 16px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.45); color: #fecaca; border-radius: 12px; padding: 14px 16px; font-size: 13.5px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 14px; }}
    th, td {{ border: 1px solid rgba(255,255,255,0.1); padding: 10px 12px; text-align: left; }}
    th {{ background: rgba(245,158,11,0.1); color: #fde68a; }}
    footer {{ border-top: 1px solid rgba(255,255,255,0.08); padding: 26px 20px; text-align: center; font-size: 12px; color: #64748b; }}
  </style>
</head>
<body>
  <header>
    <div class="nav">
      <a class="brand" href="https://zupirus.com/">⚡ ZUPIRUS QUANT LAB</a>
      <div class="nav-links">
        <a href="https://zupirus.com/#track-record">{nav_perf}</a>
        <a href="/cong-cu/tinh-lot-size-xauusd">{nav_lot}</a>
        <a href="/cong-cu/tinh-drawdown-quy-prop-firm">{nav_dd}</a>
        <a href="/huong-dan">{nav_guide}</a>
        <a href="https://www.youtube.com/@ZupirusTradingAcademy" target="_blank" rel="noopener noreferrer">YouTube</a>
        <a href="https://discord.gg/yxCx3dVe34" target="_blank" rel="noopener noreferrer">Discord</a>
        <a class="cta" href="https://app.zupirus.com/">{nav_cta}</a>
      </div>
    </div>
  </header>
  <main>{body_html}</main>
  <footer>
    © 2026 ZUPIRUS Quant Lab · {footer_tagline} ·
    <a href="https://zupirus.com/">{footer_home}</a> · <a href="/cong-cu/tinh-lot-size-xauusd">{nav_lot}</a> · <a href="/cong-cu/tinh-drawdown-quy-prop-firm">{nav_dd}</a> · <a href="/huong-dan">{footer_guides}</a> · <a href="https://www.youtube.com/@ZupirusTradingAcademy" target="_blank" rel="noopener noreferrer">YouTube</a> · <a href="https://app.zupirus.com/">{footer_login}</a>
  </footer>
</body>
</html>"""


def _resolve_lang(request: Optional[Request], lang: Optional[str]) -> str:
    if lang and str(lang).strip().lower() == "en":
        return "en"
    if request:
        acc = request.headers.get("accept-language", "").lower()
        if acc.startswith("en") or ",en" in acc:
            return "en"
    return "vi"


@router.get("/cong-cu/tinh-lot-size-xauusd", response_class=HTMLResponse)
def seo_lot_calculator_page(request: Request, lang: Optional[str] = Query(None)) -> HTMLResponse:
    effective_lang = _resolve_lang(request, lang)
    canonical = "https://zupirus.com/cong-cu/tinh-lot-size-xauusd"
    title = "Tính Lot Size Vàng XAU/USD & Drawdown Prop Firm | ZUPIRUS"
    desc = "Công cụ tính Lot Size XAU/USD miễn phí cho Standard, Cent và quỹ FTMO, The5ers, FundedNext. Tự tính số lệnh thua tối đa theo Daily DD 4%-5%."
    keywords = "tính lot size XAUUSD, công cụ tính lot vàng, tính lot MT5 chuẩn quỹ, tính drawdown FTMO, tài khoản cent XAUUSD"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebApplication",
                "name": "Công Cụ Tính Lot Size Vàng XAU/USD & Prop Firm Guard",
                "url": canonical,
                "applicationCategory": "FinanceApplication",
                "operatingSystem": "Web",
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                "publisher": {"@type": "Organization", "name": "ZUPIRUS Quant Lab", "url": "https://zupirus.com/"},
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": "1 pip vàng XAU/USD bằng bao nhiêu USD trên 1 lot chuẩn?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Trên tài khoản Standard MT5 (1.00 lot = 100 oz vàng), 1 pip tương ứng biến động giá $0.10/oz và có giá trị bằng $10 USD. Với 0.10 lot là $1/pip và 0.01 lot là $0.10/pip.",
                        },
                    },
                    {
                        "@type": "Question",
                        "name": "Nên để rủi ro bao nhiêu % mỗi lệnh khi thi quỹ FTMO, The5ers, FundedNext?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Mức rủi ro tối ưu nhất cho tài khoản quỹ Prop Firm là 0.50% đến 0.75% mỗi lệnh (tối đa 1.0% khi đã lên LIVE), giúp chịu được 5-8 lệnh thua liên tiếp trong ngày mà không chạm giới hạn Daily Drawdown 5%.",
                        },
                    },
                ],
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Trang chủ", "item": "https://zupirus.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Công cụ tính Lot XAU/USD", "item": canonical},
                ],
            },
        ],
    }

    guide_links = "".join(
        f'<li><a href="/huong-dan/{g["slug"]}">{html.escape(str(g["h1"]))}</a></li>'
        for g in GUIDES[:5]
    )

    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Trang chủ</a> / Công cụ tính Lot XAU/USD</div>
      <span class="badge">FREE QUANT TOOL · XAU/USD LOT &amp; PROP GUARD</span>
      <h1>Công Cụ Tính Lot Size Vàng XAU/USD &amp; Giới Hạn Drawdown Quỹ Prop Firm</h1>
      <p>Tính toán chính xác khối lượng Lot XAU/USD theo nguyên tắc <strong>Fail-Closed</strong> (làm tròn xuống để không bao giờ vượt ngân sách rủi ro), hỗ trợ đầy đủ tài khoản <strong>Standard, Cent (USC)</strong> và quỹ <strong>FTMO / The5ers / FundedNext</strong>.</p>

      <section class="card" aria-label="Máy tính Lot Size XAU/USD">
        <div class="calc-grid">
          <div class="field">
            <label for="calc-mode">Loại tài khoản MT5</label>
            <select id="calc-mode">
              <option value="PROP_CHALLENGE">Quỹ Prop Firm — Đang Thi (Challenge)</option>
              <option value="PROP_LIVE">Quỹ Prop Firm — Đã Cấp Vốn (LIVE)</option>
              <option value="STANDARD">Tài khoản Standard (Exness, ICMarkets...)</option>
              <option value="CENT">Tài khoản Cent / USC (1 Lot = 1 oz)</option>
            </select>
          </div>
          <div class="field">
            <label for="calc-balance">Vốn tài khoản (USD)</label>
            <input id="calc-balance" type="number" min="10" step="100" value="100000" />
            <div class="presets">
              <button type="button" class="preset-btn" data-preset-balance="1000">$1K</button>
              <button type="button" class="preset-btn" data-preset-balance="10000">$10K</button>
              <button type="button" class="preset-btn" data-preset-balance="50000">$50K</button>
              <button type="button" class="preset-btn" data-preset-balance="100000">$100K</button>
              <button type="button" class="preset-btn" data-preset-balance="200000">$200K</button>
            </div>
          </div>
          <div class="field">
            <label for="calc-risk">Rủi ro mỗi lệnh (% Equity)</label>
            <input id="calc-risk" type="number" min="0.1" max="10" step="0.05" value="0.75" />
            <div class="presets">
              <button type="button" class="preset-btn" data-preset-risk="0.5">0.5%</button>
              <button type="button" class="preset-btn" data-preset-risk="0.75">0.75%</button>
              <button type="button" class="preset-btn" data-preset-risk="1.0">1.0%</button>
              <button type="button" class="preset-btn" data-preset-risk="1.5">1.5%</button>
              <button type="button" class="preset-btn" data-preset-risk="2.0">2.0%</button>
            </div>
          </div>
          <div class="field">
            <label for="calc-sl">Khoảng cách Stop Loss (Pips · 10 pips = $1/oz)</label>
            <input id="calc-sl" type="number" min="5" max="500" step="1" value="35" />
          </div>
          <div class="field">
            <label for="calc-rr">Tỷ lệ Risk : Reward (R:R)</label>
            <input id="calc-rr" type="number" min="0.5" max="10" step="0.1" value="2.0" />
          </div>
          <div class="field">
            <label for="calc-dd">Giới hạn Daily Drawdown sàn (%)</label>
            <input id="calc-dd" type="number" min="1" max="15" step="0.5" value="5.0" />
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi kpi-primary">
            <div class="kpi-label">Khối Lượng Lot Khuyến Nghị</div>
            <div class="kpi-val" id="out-lot">2.14 Lot</div>
            <div class="kpi-sub" id="out-raw-lot">Chính xác: 2.1429 · Làm tròn xuống (Fail-Closed)</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Rủi Ro Thực Tế (1R)</div>
            <div class="kpi-val" id="out-risk-usd">$749.00</div>
            <div class="kpi-sub" id="out-sl-usd">35 pips ($3.50/oz)</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Lợi Nhuận Mục Tiêu (TP)</div>
            <div class="kpi-val" style="color:#34d399" id="out-target-usd">+$1,498.00</div>
            <div class="kpi-sub">Theo tỷ lệ R:R đã chọn</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Sức Chịu Đựng Chuỗi Thua/Ngày</div>
            <div class="kpi-val" style="font-size:16px" id="out-guard-losses">5 lệnh (khóa 4.0%)</div>
            <div class="kpi-sub" id="out-broker-losses">6 lệnh (sàn 5.0%)</div>
          </div>
        </div>
        <div class="alert-box" id="calc-alert" role="alert"></div>
      </section>

      <article class="card">
        <h2 style="margin-top:0">Công thức tính Lot Size Vàng XAU/USD chuẩn định lượng</h2>
        <p>Khối lượng vào lệnh an toàn được tính theo công thức: <strong>Lot = (Vốn USD × % Rủi ro) / (Số Pips SL × Giá trị 1 Pip)</strong>. Trong đó với XAU/USD trên hầu hết các sàn MT5 (Exness, ICMarkets, FTMO, The5ers, FundedNext):</p>
        <table>
          <thead>
            <tr>
              <th>Loại tài khoản</th>
              <th>Quy ước 1.00 Lot</th>
              <th>Biến động 1 Pip ($0.10/oz)</th>
              <th>Biến động $1.00/oz (10 Pips)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Standard / Prop Firm</strong></td>
              <td>100 oz vàng</td>
              <td>$10.00 / lot</td>
              <td>$100.00 / lot</td>
            </tr>
            <tr>
              <td><strong>Mini (0.10 Standard)</strong></td>
              <td>10 oz vàng</td>
              <td>$1.00 / lệnh</td>
              <td>$10.00 / lệnh</td>
            </tr>
            <tr>
              <td><strong>Micro (0.01 Standard)</strong></td>
              <td>1 oz vàng</td>
              <td>$0.10 / lệnh</td>
              <td>$1.00 / lệnh</td>
            </tr>
            <tr>
              <td><strong>Tài khoản Cent (USC)</strong></td>
              <td>1 oz vàng (1.00 Cent Lot)</td>
              <td>$0.10 / cent lot</td>
              <td>$1.00 / cent lot</td>
            </tr>
          </tbody>
        </table>
      </article>

      <div class="card">
        <h2 style="margin-top:0;font-size:17px">Tài liệu chuyên sâu về Bot XAU/USD &amp; Quỹ Prop Firm</h2>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:2">{guide_links}</ul>
      </div>

      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Để hệ thống Cloud MT5 tự tính Lot &amp; khóa Daily DD 4.0% cho bạn 24/7</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Không cần tính tay, không cần thuê VPS · 4 lớp giáp Fail-Closed tự động trên cụm London G2.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Mở Cổng Giao Dịch →</a>
      </div>
    """
    return HTMLResponse(
        _render_shell(
            title,
            desc,
            canonical,
            keywords,
            json_ld,
            body,
            extra_head_html="",
            lang=effective_lang,
        )
    )


@router.get("/cong-cu/tinh-drawdown-quy-prop-firm", response_class=HTMLResponse)
def seo_drawdown_calculator_page(request: Request, lang: Optional[str] = Query(None)) -> HTMLResponse:
    effective_lang = _resolve_lang(request, lang)
    canonical = "https://zupirus.com/cong-cu/tinh-drawdown-quy-prop-firm"
    title = "Bảng Tính Daily Drawdown & Phân Bổ Rủi Ro Quỹ Prop Firm | ZUPIRUS"
    desc = "Công cụ tính Daily Loss và Max Drawdown trực tuyến cho tài khoản quỹ FTMO, The5ers, FundedNext. Tự động tính ngưỡng dừng lỗ an toàn và số lệnh thua tối đa."
    keywords = "tính drawdown quỹ prop firm, tính daily loss FTMO, tính sụt giảm tài khoản quỹ, quản lý vốn FTMO The5ers, drawdown calculator prop firm"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebApplication",
                "name": "Bảng Tính Daily Drawdown & Phân Bổ Rủi Ro Quỹ Prop Firm",
                "url": canonical,
                "applicationCategory": "FinanceApplication",
                "operatingSystem": "Web",
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                "publisher": {"@type": "Organization", "name": "ZUPIRUS Quant Lab", "url": "https://zupirus.com/"},
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": "Daily Drawdown của quỹ FTMO được tính như thế nào?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "FTMO tính Daily Drawdown dựa trên Equity (hoặc Balance) tại thời điểm 00:00 CE(S)T của ngày hôm đó. Mức sụt giảm trong ngày không được vượt quá 5.0% mốc bắt đầu ngày, bao gồm cả các lệnh đang mở (floating loss).",
                        },
                    },
                    {
                        "@type": "Question",
                        "name": "Tại sao ZUPIRUS lại khóa tài khoản ở mốc 4.0% thay vì 5.0%?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "ZUPIRUS áp dụng vùng đệm an toàn 1.0% (Fail-Closed Buffer). Khi tài khoản chạm mức lỗ 4.0%, hệ thống tự động đóng lệnh và ngắt kết nối để chống trượt giá (slippage) và phí swap/commission làm tài khoản vô tình chạm ngưỡng 5.0% của quỹ.",
                        },
                    },
                    {
                        "@type": "Question",
                        "name": "Nên chia rủi ro bao nhiêu % mỗi lệnh để không bị vi phạm Daily Drawdown?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Khuyến nghị chuẩn định lượng là 0.50% đến 0.75% mỗi lệnh. Với mức rủi ro này, tài khoản có thể chịu được liên tiếp 5-8 lệnh thua mà vẫn nằm trong vùng an toàn dưới ngưỡng 4.0% khóa tự động.",
                        },
                    },
                ],
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Trang chủ", "item": "https://zupirus.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Tính Drawdown Quỹ Prop Firm", "item": canonical},
                ],
            },
        ],
    }

    guide_links = "".join(
        f'<li><a href="/huong-dan/{g["slug"]}">{html.escape(str(g["h1"]))}</a></li>'
        for g in GUIDES[:6]
    )

    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Trang chủ</a> / Tính Drawdown Quỹ Prop Firm</div>
      <span class="badge">PROP FIRM CALCULATOR · DAILY &amp; MAX DRAWDOWN</span>
      <h1>Bảng Tính Daily Drawdown &amp; Phân Bổ Rủi Ro Quỹ FTMO, The5ers &amp; FundedNext</h1>
      <p>Tính toán chính xác giới hạn lỗ trong ngày (Daily Loss Limit), ngưỡng vi phạm tối đa (Max Drawdown Breach) và vùng đệm an toàn tự động đóng lệnh (4.0% Safe Buffer) theo chuẩn định lượng ZUPIRUS.</p>

      <section class="card" aria-label="Máy tính Drawdown Quỹ Prop Firm">
        <div class="calc-grid">
          <div class="field">
            <label for="dd-preset-firm">Chọn Quy Định Quỹ Phổ Biến</label>
            <select id="dd-preset-firm">
              <option value="FTMO_100K">FTMO — Tài khoản $100,000 (Daily 5% / Max 10%)</option>
              <option value="FTMO_50K">FTMO — Tài khoản $50,000 (Daily 5% / Max 10%)</option>
              <option value="FTMO_200K">FTMO — Tài khoản $200,000 (Daily 5% / Max 10%)</option>
              <option value="THE5ERS_100K">The5ers High Stakes — $100,000 (Daily 5% / Max 10%)</option>
              <option value="THE5ERS_60K">The5ers High Stakes — $60,000 (Daily 5% / Max 10%)</option>
              <option value="FUNDEDNEXT_100K">FundedNext Stellar — $100,000 (Daily 5% / Max 10%)</option>
              <option value="FUNDEDNEXT_50K">FundedNext Stellar — $50,000 (Daily 5% / Max 10%)</option>
              <option value="CUSTOM">Tùy Chỉnh Thông Số Riêng</option>
            </select>
          </div>
          <div class="field">
            <label for="dd-starting-equity">Số dư / Equity đầu ngày ($ USD)</label>
            <input id="dd-starting-equity" type="number" min="1000" step="5000" value="100000" />
            <div class="presets">
              <button type="button" class="preset-btn" data-preset-eq="10000">$10K</button>
              <button type="button" class="preset-btn" data-preset-eq="25000">$25K</button>
              <button type="button" class="preset-btn" data-preset-eq="50000">$50K</button>
              <button type="button" class="preset-btn" data-preset-eq="100000">$100K</button>
              <button type="button" class="preset-btn" data-preset-eq="200000">$200K</button>
            </div>
          </div>
          <div class="field">
            <label for="dd-daily-limit">Hạn mức Daily Drawdown của Quỹ (%)</label>
            <input id="dd-daily-limit" type="number" min="1.0" max="15.0" step="0.5" value="5.0" />
          </div>
          <div class="field">
            <label for="dd-safe-buffer">Khóa an toàn ZUPIRUS Guard (%)</label>
            <input id="dd-safe-buffer" type="number" min="1.0" max="10.0" step="0.5" value="4.0" />
          </div>
          <div class="field">
            <label for="dd-risk-per-trade">Rủi ro định lượng mỗi lệnh (% Vốn)</label>
            <input id="dd-risk-per-trade" type="number" min="0.1" max="5.0" step="0.05" value="0.75" />
            <div class="presets">
              <button type="button" class="preset-btn" data-preset-trade-risk="0.5">0.5%</button>
              <button type="button" class="preset-btn" data-preset-trade-risk="0.75">0.75%</button>
              <button type="button" class="preset-btn" data-preset-trade-risk="1.0">1.0%</button>
            </div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi kpi-primary">
            <div class="kpi-label">Ngưỡng Khóa An Toàn ZUPIRUS</div>
            <div class="kpi-val" id="res-safe-loss">-$4,000 USD</div>
            <div class="kpi-sub" id="res-safe-equity">Dừng bot khi Equity &lt; $96,000</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Ngưỡng Vi Phạm Quỹ (Cháy)</div>
            <div class="kpi-val" style="color:#ef4444" id="res-firm-breach">-$5,000 USD</div>
            <div class="kpi-sub" id="res-firm-equity">Tài khoản bị tịch thu tại $95,000</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Vùng Đệm Trượt Giá (Slippage Shield)</div>
            <div class="kpi-val" style="color:#38bdf8" id="res-buffer-dollars">$1,000 USD</div>
            <div class="kpi-sub">Bảo toàn 1.0% đệm an toàn</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Số Lệnh Thua Cho Phép / Ngày</div>
            <div class="kpi-val" style="color:#a7f3d0" id="res-max-losses">5 Lệnh</div>
            <div class="kpi-sub" id="res-loss-per-trade">Mỗi lệnh -$750 USD (0.75%)</div>
          </div>
        </div>
      </section>

      <script>
        (function() {{
          function recalcDD() {{
            const startingEq = Math.max(100, parseFloat(document.getElementById('dd-starting-equity').value) || 100000);
            const dailyPct = Math.max(0.5, parseFloat(document.getElementById('dd-daily-limit').value) || 5.0);
            const safePct = Math.min(dailyPct - 0.1, Math.max(0.5, parseFloat(document.getElementById('dd-safe-buffer').value) || 4.0));
            const riskPct = Math.max(0.05, parseFloat(document.getElementById('dd-risk-per-trade').value) || 0.75);

            const firmBreachLoss = startingEq * (dailyPct / 100);
            const firmBreachEq = startingEq - firmBreachLoss;

            const safeLoss = startingEq * (safePct / 100);
            const safeEq = startingEq - safeLoss;

            const bufferDollars = firmBreachLoss - safeLoss;
            const lossPerTrade = startingEq * (riskPct / 100);
            const maxLosses = Math.floor(safeLoss / lossPerTrade);

            document.getElementById('res-safe-loss').textContent = '-$' + Math.round(safeLoss).toLocaleString('en-US') + ' USD';
            document.getElementById('res-safe-equity').textContent = 'Tự động dừng khi Equity < $' + Math.round(safeEq).toLocaleString('en-US');

            document.getElementById('res-firm-breach').textContent = '-$' + Math.round(firmBreachLoss).toLocaleString('en-US') + ' USD';
            document.getElementById('res-firm-equity').textContent = 'Quỹ tịch thu tại Equity $' + Math.round(firmBreachEq).toLocaleString('en-US');

            document.getElementById('res-buffer-dollars').textContent = '$' + Math.round(bufferDollars).toLocaleString('en-US') + ' USD';
            document.getElementById('res-max-losses').textContent = maxLosses + ' Lệnh Liên Tiếp';
            document.getElementById('res-loss-per-trade').textContent = 'Mỗi lệnh -$' + Math.round(lossPerTrade).toLocaleString('en-US') + ' (' + riskPct + '%)';
          }}

          document.getElementById('dd-preset-firm').addEventListener('change', function(e) {{
            const val = e.target.value;
            if (val === 'FTMO_100K') {{
              document.getElementById('dd-starting-equity').value = 100000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.75;
            }} else if (val === 'FTMO_50K') {{
              document.getElementById('dd-starting-equity').value = 50000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.75;
            }} else if (val === 'FTMO_200K') {{
              document.getElementById('dd-starting-equity').value = 200000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.75;
            }} else if (val === 'THE5ERS_100K') {{
              document.getElementById('dd-starting-equity').value = 100000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.60;
            }} else if (val === 'THE5ERS_60K') {{
              document.getElementById('dd-starting-equity').value = 60000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.60;
            }} else if (val === 'FUNDEDNEXT_100K') {{
              document.getElementById('dd-starting-equity').value = 100000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.70;
            }} else if (val === 'FUNDEDNEXT_50K') {{
              document.getElementById('dd-starting-equity').value = 50000;
              document.getElementById('dd-daily-limit').value = 5.0;
              document.getElementById('dd-safe-buffer').value = 4.0;
              document.getElementById('dd-risk-per-trade').value = 0.70;
            }}
            recalcDD();
          }});

          ['dd-starting-equity', 'dd-daily-limit', 'dd-safe-buffer', 'dd-risk-per-trade'].forEach(function(id) {{
            document.getElementById(id).addEventListener('input', recalcDD);
          }});

          document.querySelectorAll('[data-preset-eq]').forEach(function(btn) {{
            btn.addEventListener('click', function() {{
              document.getElementById('dd-starting-equity').value = this.dataset.presetEq;
              recalcDD();
            }});
          }});

          document.querySelectorAll('[data-preset-trade-risk]').forEach(function(btn) {{
            btn.addEventListener('click', function() {{
              document.getElementById('dd-risk-per-trade').value = this.dataset.presetTradeRisk;
              recalcDD();
            }});
          }});

          recalcDD();
        }})();
      </script>

      <article class="card">
        <h2>Bảng So Sánh Cơ Chế Daily Drawdown Các Quỹ Prop Firm 2026</h2>
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Quỹ Prop Firm</th>
                <th>Daily Drawdown</th>
                <th>Cách Tính Daily Loss</th>
                <th>Cơ Chế Safe Guard ZUPIRUS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>FTMO</strong></td>
                <td>5.0%</td>
                <td>Dựa trên Equity lúc 00:00 CE(S)T (bao gồm Floating Loss)</td>
                <td>Tự động ngắt tại 4.0% Daily Loss (bảo toàn 1.0% đệm trượt giá)</td>
              </tr>
              <tr>
                <td><strong>The5ers (High Stakes)</strong></td>
                <td>5.0%</td>
                <td>Dựa trên Balance hoặc Equity đầu ngày (theo mốc cao hơn)</td>
                <td>Khóa rủi ro ở 4.0%, tự giảm lot khi đạt 80% lợi nhuận mục tiêu</td>
              </tr>
              <tr>
                <td><strong>FundedNext (Stellar)</strong></td>
                <td>5.0%</td>
                <td>Dựa trên Balance khởi đầu ngày giao dịch</td>
                <td>News Shield đóng băng lệnh ±15 phút quanh tin CPI/NFP</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <div class="card">
        <h2 style="margin-top:0;font-size:17px">Hướng dẫn &amp; Tài liệu liên quan</h2>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:2">{guide_links}</ul>
      </div>

      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Kích hoạt bảo vệ 4 lớp giáp Fail-Closed trên Cloud MT5 ngay hôm nay</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Không cần tự canh lệnh, không lo chạm Daily Drawdown · Kết nối 60 giây.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Mở Cổng Giao Dịch →</a>
      </div>
    """
    return HTMLResponse(
        _render_shell(
            title,
            desc,
            canonical,
            keywords,
            json_ld,
            body,
            extra_head_html="",
            lang=effective_lang,
        )
    )


@router.get("/huong-dan", response_class=HTMLResponse)
def seo_guides_hub(request: Request, lang: Optional[str] = Query(None)) -> HTMLResponse:
    effective_lang = _resolve_lang(request, lang)
    canonical = "https://zupirus.com/huong-dan"
    title = (
        "Gold Bot Trading XAU/USD & Prop Firm Pass Knowledge Hub | ZUPIRUS"
        if effective_lang == "en"
        else "Kiến Thức Bot Trade Vàng XAU/USD & Pass Quỹ | ZUPIRUS"
    )
    desc = (
        "Comprehensive technical guide on XAU/USD gold bot trading on Zero-VPS Cloud MT5, lot size formulas, and passing FTMO, The5ers, FundedNext."
        if effective_lang == "en"
        else "Tổng hợp hướng dẫn bot trade vàng XAU/USD trên Cloud MT5 Zero-VPS, công thức tính lot chuẩn quỹ và cách pass FTMO, The5ers, FundedNext."
    )
    json_ld = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": title,
        "description": desc,
        "url": canonical,
        "isPartOf": {"@type": "WebSite", "name": "ZUPIRUS Quant Lab", "url": "https://zupirus.com/"},
    }
    cards = []
    for g in GUIDES:
        cards.append(
            f"""<article class="card">
              <span class="badge">{html.escape(str(g['badge']))}</span>
              <h2 style="margin-top:12px;font-size:18px"><a href="/huong-dan/{g['slug']}">{html.escape(str(g['h1']))}</a></h2>
              <p style="font-size:14px">{html.escape(str(g['meta_description']))}</p>
              <a href="/huong-dan/{g['slug']}" style="font-size:13px;font-weight:700">{'Read Details' if effective_lang == 'en' else 'Đọc chi tiết'} ({g['read_time']}) →</a>
            </article>"""
        )
    crumb_home = "Home" if effective_lang == "en" else "Trang chủ"
    crumb_guides = "Guides & Knowledge" if effective_lang == "en" else "Kiến Thức &amp; Hướng Dẫn"
    h1_text = (
        "XAU/USD Quantitative Trading, Cloud MT5 & Prop Firm Knowledge Hub"
        if effective_lang == "en"
        else "Kiến Thức Giao Dịch Định Lượng XAU/USD, Cloud MT5 &amp; Pass Quỹ Prop Firm"
    )
    sub_text = (
        "Technical documentation helping traders deploy automated XAU/USD infrastructure without VPS and pass prop firm challenges with 4 Fail-Closed Shields."
        if effective_lang == "en"
        else "Hệ thống tài liệu kỹ thuật giúp trader triển khai hạ tầng tự động hóa XAU/USD không cần VPS và bảo vệ tài khoản quỹ FTMO, The5ers, FundedNext bằng 4 lớp giáp Fail-Closed."
    )
    cta_title = "Ready to connect your MT5 account to London G2 Cloud?" if effective_lang == "en" else "Sẵn sàng kết nối tài khoản MT5 lên Cloud London G2?"
    cta_sub = "Review verified performance or activate instantly 24/7." if effective_lang == "en" else "Xem hiệu suất thực tế đã xác thực hoặc kích hoạt ngay qua SePay VietQR 24/7."
    cta_btn = "Get Started Now →" if effective_lang == "en" else "Bắt Đầu Ngay →"
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">{crumb_home}</a> / {crumb_guides}</div>
      <span class="badge">ZUPIRUS KNOWLEDGE HUB · SEO</span>
      <h1>{h1_text}</h1>
      <p>{sub_text}</p>
      <div class="grid">{''.join(cards)}</div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">{cta_title}</strong>
          <p style="margin:4px 0 0;font-size:13.5px">{cta_sub}</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">{cta_btn}</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, "bot trade vàng XAUUSD, pass quỹ FTMO, Cloud MT5 Zero-VPS, ZUPIRUS", json_ld, body, lang=effective_lang))


@router.get("/huong-dan/{slug}", response_class=HTMLResponse)
def seo_guide_detail(slug: str, request: Request, lang: Optional[str] = Query(None)) -> HTMLResponse:
    effective_lang = _resolve_lang(request, lang)
    g = GUIDE_BY_SLUG.get(slug)
    if not g:
        raise HTTPException(status_code=404, detail="Guide not found")

    canonical = f"https://zupirus.com/huong-dan/{slug}"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": g["h1"],
                "description": g["meta_description"],
                "datePublished": PUBLISHED_DATE,
                "dateModified": PUBLISHED_DATE,
                "author": {"@type": "Organization", "name": "ZUPIRUS Quant Lab"},
                "publisher": {"@type": "Organization", "name": "ZUPIRUS Quant Lab", "url": "https://zupirus.com/"},
                "mainEntityOfPage": canonical,
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Trang chủ", "item": "https://zupirus.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Hướng dẫn", "item": "https://zupirus.com/huong-dan"},
                    {"@type": "ListItem", "position": 3, "name": g["h1"], "item": canonical},
                ],
            },
        ],
    }

    sections_html = "".join(
        f"<h2>{html.escape(heading)}</h2><p>{html.escape(content)}</p>"
        for heading, content in g["sections"]  # type: ignore[misc]
    )
    related_html = "".join(
        f'<li><a href="/huong-dan/{other["slug"]}">{html.escape(str(other["h1"]))}</a></li>'
        for other in GUIDES
        if other["slug"] != slug
    )

    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Trang chủ</a> / <a href="/huong-dan">Hướng dẫn</a> / {html.escape(slug)}</div>
      <span class="badge">{html.escape(str(g['badge']))} · {html.escape(str(g['read_time']))}</span>
      <h1>{html.escape(str(g['h1']))}</h1>
      <p style="color:#94a3b8;font-size:13px">Cập nhật: {PUBLISHED_DATE} · Tác giả: ZUPIRUS Quant Lab</p>
      <article class="card">{sections_html}</article>
      <div class="card">
        <h2 style="margin-top:0;font-size:17px">Bài viết liên quan</h2>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:2">{related_html}</ul>
      </div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Trải nghiệm hạ tầng Cloud MT5 Zero-VPS &amp; Prop Firm Guard</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Hiệu suất XAU/USD xác thực minh bạch · Kích hoạt tự động SePay 24/7.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Mở Cổng Giao Dịch →</a>
      </div>
    """
    return HTMLResponse(
        _render_shell(
            str(g["title"]),
            str(g["meta_description"]),
            canonical,
            str(g["keywords"]),
            json_ld,
            body,
            lang=effective_lang,
        )
    )


ENGLISH_GUIDES: List[Dict[str, object]] = [
    {
        "slug": "ftmo-the5ers-automated-pass-guide",
        "title": "Automated FTMO & The5ers Challenge Pass Guide | ZUPIRUS Quant Lab",
        "meta_description": "Comprehensive guide to passing FTMO, The5ers, and FundedNext evaluations with automated Prop Firm Guard. 4.0% daily DD cap, 8.0% HWM lock, and 0.75% risk sizing.",
        "keywords": "pass FTMO challenge automated, FTMO trading bot, The5ers pass bot, FundedNext bot, prop firm risk management bot",
        "h1": "How to Pass FTMO, The5ers & FundedNext Prop Firm Challenges with Automated Quant Systems",
        "read_time": "6 min read",
        "badge": "PROP FIRM · CHALLENGE PASS",
        "sections": [
            (
                "1. Why 90% of Traders Fail Prop Firm Evaluations",
                "Traders rarely fail prop firm challenges due to lack of profitable setups. The overwhelming majority fail because of emotional overleveraging and violating the Daily Drawdown (5%/day) or Max Trailing Drawdown (10%) rule during high-volatility sessions (NFP, CPI, FOMC). When emotional revenge trading occurs, doubling down lot sizes breaches challenge rules within minutes."
            ),
            (
                "2. Three-Tier Prop Firm Guard Architecture on ZUPIRUS",
                "ZUPIRUS enforces institutional risk architecture designed specifically for CHALLENGE and FUNDED stages: (1) Hard Daily Drawdown Circuit-Breaker at 4.0% (safely below the 5.0% prop firm threshold to absorb broker spread spikes and slippage), (2) High-Water Mark Trailing Drawdown Lock at 8.0% from peak equity, and (3) Dynamic Risk De-escalation (50% lot reduction once 80% of the target profit is secured)."
            ),
            (
                "3. Disciplined Rules for Funded Live Accounts",
                "Once funded, ZUPIRUS locks risk at a maximum 1.0% per trading idea with a strict minimum R:R of 1.8. Live system audits across multiple prop accounts ($100K FTMO, $100K The5ers, $200K FundedNext) demonstrate consistent low drawdown under 1.5% while achieving steady, repeatable capital growth."
            ),
        ],
    },
    {
        "slug": "cloud-mt5-gold-trading-bot-zero-vps",
        "title": "Cloud MT5 Gold Trading Bot (XAU/USD) Zero-VPS Architecture | ZUPIRUS",
        "meta_description": "Discover how the ZUPIRUS Cloud MT5 quantitative bot executes XAU/USD trades with zero VPS, 4-layer Fail-Closed capital shield, ATR(14) stop loss, and news filters.",
        "keywords": "gold trading bot XAUUSD, cloud MT5 trading bot, zero VPS forex bot, automated gold trading MT5",
        "h1": "How Cloud MT5 Gold (XAU/USD) Trading Bots Operate Without a VPS",
        "read_time": "5 min read",
        "badge": "CLOUD MT5 · XAU/USD",
        "sections": [
            (
                "1. The Hidden Risks of Manual Gold Trading and Traditional Windows VPS",
                "Gold (XAU/USD) has an average daily range of 150–350 pips. When quants trade manually or host .ex5 Expert Advisors on cheap virtual private servers (VPS), the three most common causes of catastrophic account loss are: (1) emotional stop-loss manipulation, (2) unexpected VPS freezes or reboots during high-impact news releases, and (3) broker slippage during liquidity gaps."
            ),
            (
                "2. ZUPIRUS Zero-VPS London G2 Cloud Infrastructure",
                "Instead of requiring traders to install complex software or maintain Windows VPS instances, ZUPIRUS connects directly to broker MT5 server bridges via a dedicated London G2 Cloud cluster with ~10ms execution latency. Trading credentials are encrypted at rest with deep AES-256 keys, and funds remain 100% under your direct broker custody."
            ),
            (
                "3. Four-Layer Fail-Closed Capital Protection Shield",
                "Every M15 signal passes through 4 mandatory automated checkpoints before execution: L1 Idempotency Lock (prevents duplicate orders via Redis + DB), L2 Enforced Hard Stop Loss calculated from ATR(14) with strict spread filtering, L3 High-Impact News Filter (blocks new positions ±15 minutes around red-folder USD events), and L4 Slippage Guard (rejects fills if slippage exceeds 20 pips)."
            ),
        ],
    },
    {
        "slug": "prop-firm-risk-management-drawdown",
        "title": "Quant Lot Sizing Formula & Daily Drawdown Management for Prop Firms | ZUPIRUS",
        "meta_description": "Accurate lot sizing formula for Standard, Cent, and Prop firm accounts. Maintain daily drawdown below 4.0% and maximize risk-adjusted returns.",
        "keywords": "lot size formula gold, prop firm daily drawdown management, MT5 lot calculator, FTMO drawdown rules",
        "h1": "Dynamic Lot Sizing & Prop Firm Daily Drawdown Control for Quantitative Traders",
        "read_time": "5 min read",
        "badge": "CAPITAL RISK · LOT SIZING",
        "sections": [
            (
                "1. Formula-Driven Lot Sizing Based on Stop-Loss Distance",
                "Rather than trading fixed lot sizes regardless of volatility, quantitative execution sizes every trade based on a fixed percentage risk budget: Lot = (Equity × Risk%) / (SL_Points × Point_Size × Contract_Size). This guarantees that regardless of whether the stop loss is 35 pips or 70 pips, the dollar risk is strictly capped."
            ),
            (
                "2. Handling Standard vs. Cent (USC) Accounts Seamlessly",
                "On Cent accounts, contract sizes differ significantly from Standard accounts (100 oz vs. 1 oz). ZUPIRUS automatically recognizes account denominations and contract specifications, preventing devastating decimal order errors."
            ),
            (
                "3. Auto Break-Even and Multi-Trade Loss Streak Resilience",
                "With 0.75% risk per idea and a 4.0% daily loss limit, a prop firm portfolio can absorb more than 5 consecutive losses in a single day without breaching the firm's daily drawdown ceiling. Automated break-even adjustment at +1.0R further protects unrealized profits."
            ),
        ],
    },
]
ENGLISH_GUIDE_BY_SLUG: Dict[str, Dict[str, object]] = {g["slug"]: g for g in ENGLISH_GUIDES}  # type: ignore[misc]


@router.get("/en", response_class=HTMLResponse)
def seo_english_landing(request: Request) -> HTMLResponse:
    canonical = "https://zupirus.com/en"
    title = "ZUPIRUS — Institutional Gold (XAU/USD) & Forex Cloud MT5 Quant Trading OS"
    desc = "Zero-VPS Cloud MT5 quantitative trading system for Gold (XAU/USD) & Forex. 4-layer Fail-Closed capital shield engineered for FTMO, The5ers & FundedNext prop firms."
    keywords = "gold trading bot XAUUSD, automated forex trading, cloud MT5 zero VPS, pass FTMO challenge, The5ers, FundedNext, prop firm capital shield, quantitative gold trading"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "SoftwareApplication",
                "name": "ZUPIRUS Cloud MT5 Quant OS",
                "applicationCategory": "FinanceApplication",
                "operatingSystem": "Web, Cloud MT5",
                "url": "https://zupirus.com/en",
                "description": desc,
                "offers": {"@type": "AggregateOffer", "priceCurrency": "USD", "lowPrice": "25", "highPrice": "59", "offerCount": "3"}
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://zupirus.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Global English", "item": canonical},
                ],
            },
        ],
    }
    cards = "".join(
        f"""<div class="card">
          <span class="badge">{html.escape(str(g['badge']))} · {html.escape(str(g['read_time']))}</span>
          <h2><a href="/en/guides/{g['slug']}">{html.escape(str(g['h1']))}</a></h2>
          <p>{html.escape(str(g['meta_description']))}</p>
          <a href="/en/guides/{g['slug']}" style="font-weight:700;font-size:13.5px">Read Full Guide →</a>
        </div>"""
        for g in ENGLISH_GUIDES
    )
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Home</a> / Global English Overview</div>
      <span class="badge">INSTITUTIONAL QUANT OS · ZERO VPS</span>
      <h1>Institutional Gold (XAU/USD) &amp; Forex Quantitative Trading on Cloud MT5</h1>
      <p>Direct broker bridge to London G2 cloud servers. Zero Expert Advisors to configure, zero Windows VPS to rent. 4-layer Fail-Closed capital protection engineered specifically for FTMO, The5ers, and funded prop firm portfolios.</p>

      <div class="grid">
        <div class="card">
          <span class="badge">RISK ARCHITECTURE</span>
          <h2>4-Layer Fail-Closed Shield</h2>
          <p>Every trade order is strictly audited before execution: Idempotency locks, mandatory ATR(14) Stop Loss, ±15m high-impact news filter, and slippage rejection.</p>
        </div>
        <div class="card">
          <span class="badge">PROP FIRM DISCIPLINE</span>
          <h2>Hard 1.0% Risk Cap &amp; Daily DD Shield</h2>
          <p>Automated circuit breaker cuts exposure at 4.0% daily drawdown and caps risk to 1.0% per idea to guarantee 100% compliance with prop firm rules.</p>
        </div>
        <div class="card">
          <span class="badge">ZERO-CUSTODY SECURITY</span>
          <h2>100% Direct Broker Custody</h2>
          <p>ZUPIRUS never takes custody of investor funds. Deposits and withdrawals occur directly through your MT5 broker (FTMO, Exness, ICMarkets).</p>
        </div>
      </div>

      <h2 style="margin-top:48px">Institutional Knowledge Hub &amp; Guides</h2>
      <div class="grid">{cards}</div>

      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:18px">Launch Your Cloud MT5 Quant Terminal</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Connect your MT5 account in under 3 minutes. Instant USDT (TRC20/BEP20) activation.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Launch Terminal →</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, keywords, json_ld, body, lang="en"))


@router.get("/en/guides", response_class=HTMLResponse)
def seo_english_guides(request: Request) -> HTMLResponse:
    canonical = "https://zupirus.com/en/guides"
    title = "Quantitative Trading & Prop Firm Knowledge Hub | ZUPIRUS"
    desc = "Explore in-depth research, quantitative trading architecture, and prop firm risk management guides for FTMO, The5ers, and Cloud MT5."
    keywords = "prop firm trading guides, pass FTMO challenge automated, gold trading bot XAUUSD, cloud MT5 guides"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "name": title,
                "description": desc,
                "url": canonical,
                "publisher": {"@type": "Organization", "name": "ZUPIRUS Quant Lab", "url": "https://zupirus.com/"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://zupirus.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Guides", "item": canonical},
                ],
            },
        ],
    }
    cards = "".join(
        f"""<div class="card">
          <span class="badge">{html.escape(str(g['badge']))} · {html.escape(str(g['read_time']))}</span>
          <h2><a href="/en/guides/{g['slug']}">{html.escape(str(g['h1']))}</a></h2>
          <p>{html.escape(str(g['meta_description']))}</p>
          <a href="/en/guides/{g['slug']}" style="font-weight:700;font-size:13.5px">Read Guide →</a>
        </div>"""
        for g in ENGLISH_GUIDES
    )
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Home</a> / <a href="/en">Global English</a> / Guides</div>
      <span class="badge">QUANT KNOWLEDGE HUB</span>
      <h1>Quantitative Trading &amp; Prop Firm Risk Management Guides</h1>
      <p>Institutional analysis, algorithmic architectures, and disciplined risk guidelines for systematic gold (XAU/USD) traders.</p>
      <div class="grid">{cards}</div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Ready to automate your trading with disciplined risk?</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Connect your MetaTrader 5 account to ZUPIRUS Cloud engine in 3 minutes.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Launch Terminal →</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, keywords, json_ld, body, lang="en"))


@router.get("/en/guides/{slug}", response_class=HTMLResponse)
def seo_english_guide_detail(slug: str, request: Request) -> HTMLResponse:
    g = ENGLISH_GUIDE_BY_SLUG.get(slug)
    if not g:
        raise HTTPException(status_code=404, detail="Guide not found")

    canonical = f"https://zupirus.com/en/guides/{slug}"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": g["h1"],
                "description": g["meta_description"],
                "datePublished": PUBLISHED_DATE,
                "dateModified": PUBLISHED_DATE,
                "author": {"@type": "Organization", "name": "ZUPIRUS Quant Lab"},
                "publisher": {"@type": "Organization", "name": "ZUPIRUS Quant Lab", "url": "https://zupirus.com/"},
                "mainEntityOfPage": canonical,
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://zupirus.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Guides", "item": "https://zupirus.com/en/guides"},
                    {"@type": "ListItem", "position": 3, "name": g["h1"], "item": canonical},
                ],
            },
        ],
    }

    sections_html = "".join(
        f"<h2>{html.escape(heading)}</h2><p>{html.escape(content)}</p>"
        for heading, content in g["sections"]  # type: ignore[misc]
    )
    related_html = "".join(
        f'<li><a href="/en/guides/{other["slug"]}">{html.escape(str(other["h1"]))}</a></li>'
        for other in ENGLISH_GUIDES
        if other["slug"] != slug
    )

    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Home</a> / <a href="/en/guides">Guides</a> / {html.escape(slug)}</div>
      <span class="badge">{html.escape(str(g['badge']))} · {html.escape(str(g['read_time']))}</span>
      <h1>{html.escape(str(g['h1']))}</h1>
      <p style="color:#94a3b8;font-size:13px">Updated: {PUBLISHED_DATE} · Author: ZUPIRUS Quant Lab</p>
      <article class="card">{sections_html}</article>
      <div class="card">
        <h2 style="margin-top:0;font-size:17px">Related Research &amp; Guides</h2>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:2">{related_html}</ul>
      </div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Experience Zero-VPS Cloud MT5 &amp; Prop Firm Guard</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Transparent verified track record · Instant USDT activation.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Launch Terminal →</a>
      </div>
    """
    return HTMLResponse(
        _render_shell(
            str(g["title"]),
            str(g["meta_description"]),
            canonical,
            str(g["keywords"]),
            json_ld,
            body,
            lang="en",
        )
    )

