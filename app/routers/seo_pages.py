"""Server-Side Rendered (SSR) SEO Knowledge Hub & Guide Pages for Google Top-1 Ranking.

Serves lightning-fast (<10ms TTFB), mobile-first, Sovereign-styled HTML pages with:
- Unique <title>, <meta name="description">, <link rel="canonical">, Open Graph & Twitter Cards
- Valid JSON-LD (Article, BreadcrumbList, CollectionPage)
- Strong semantic H1/H2/H3 hierarchy and internal links back to https://zupirus.com/ & https://app.zupirus.com/
"""
from __future__ import annotations

import html
import json
from typing import Dict, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["SEO Pages"])

PUBLISHED_DATE = "2026-11-19"

GUIDES: List[Dict[str, object]] = [
    {
        "slug": "bot-trade-vang-xauusd-cloud-mt5",
        "title": "Bot Trade Vàng XAU/USD Cloud MT5 Không Cần VPS — Chuẩn Định Lượng 2026",
        "meta_description": "Tìm hiểu cách bot trade vàng XAU/USD chạy trực tiếp trên Cloud MT5 Zero-VPS với 4 lớp giáp bảo vệ vốn Fail-Closed, Auto-SL ATR(14) và News Shield ±15 phút.",
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
        "title": "Cách Pass Quỹ FTMO, The5ers & FundedNext Tự Động An Toàn Bằng Prop Firm Guard",
        "meta_description": "Hướng dẫn chiến lược pass quỹ FTMO, The5ers và FundedNext bền vững bằng hệ thống tự động Prop Firm Guard: khóa Daily DD 4.0%, HWM 8.0% và chia lot chuẩn 0.75%-1.0%.",
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
) -> str:
    esc_title = html.escape(title)
    esc_desc = html.escape(description)
    esc_kw = html.escape(keywords)
    esc_canon = html.escape(canonical)
    ld_str = json.dumps(json_ld, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc_title}</title>
  <meta name="description" content="{esc_desc}" />
  <meta name="keywords" content="{esc_kw}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <link rel="canonical" href="{esc_canon}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="ZUPIRUS Quant Lab" />
  <meta property="og:locale" content="vi_VN" />
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
        <a href="https://zupirus.com/#track-record">Hiệu Suất Thực Tế</a>
        <a href="/cong-cu/tinh-lot-size-xauusd">Tính Lot XAU/USD</a>
        <a href="/huong-dan">Kiến Thức &amp; Hướng Dẫn</a>
        <a href="https://discord.gg/yxCx3dVe34" target="_blank" rel="noopener noreferrer">Discord</a>
        <a class="cta" href="https://app.zupirus.com/">Mở Cổng Giao Dịch →</a>
      </div>
    </div>
  </header>
  <main>{body_html}</main>
  <footer>
    © 2026 ZUPIRUS Quant Lab · Hạ tầng Cloud MT5 XAU/USD Zero-VPS &amp; Prop Firm Guard ·
    <a href="https://zupirus.com/">Trang Chủ</a> · <a href="/cong-cu/tinh-lot-size-xauusd">Tính Lot XAU/USD</a> · <a href="/huong-dan">Hướng Dẫn</a> · <a href="https://app.zupirus.com/">Đăng Nhập</a>
  </footer>
</body>
</html>"""


@router.get("/cong-cu/tinh-lot-size-xauusd", response_class=HTMLResponse)
def seo_lot_calculator_page() -> HTMLResponse:
    canonical = "https://zupirus.com/cong-cu/tinh-lot-size-xauusd"
    title = "Công Cụ Tính Lot Size Vàng XAU/USD & Daily Drawdown Quỹ Prop Firm Miễn Phí | ZUPIRUS"
    desc = "Máy tính khối lượng Lot Size XAU/USD chuẩn xác cho tài khoản Standard, Cent (USC) và Quỹ FTMO, The5ers, FundedNext. Tự động tính số lệnh thua tối đa theo Daily Drawdown 4%-5%."
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
            extra_head_html='<script src="/lot-calculator.js" defer></script>',
        )
    )


@router.get("/huong-dan", response_class=HTMLResponse)
def seo_guides_hub() -> HTMLResponse:
    canonical = "https://zupirus.com/huong-dan"
    title = "Kiến Thức Bot Trade Vàng XAU/USD, Cloud MT5 & Pass Quỹ Prop Firm | ZUPIRUS"
    desc = "Tổng hợp hướng dẫn chuyên sâu về bot trade vàng XAU/USD trên Cloud MT5 Zero-VPS, công thức tính lot chuẩn quỹ và cách pass FTMO, The5ers, FundedNext an toàn."
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
              <a href="/huong-dan/{g['slug']}" style="font-size:13px;font-weight:700">Đọc chi tiết ({g['read_time']}) →</a>
            </article>"""
        )
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Trang chủ</a> / Kiến Thức &amp; Hướng Dẫn</div>
      <span class="badge">ZUPIRUS KNOWLEDGE HUB · SEO</span>
      <h1>Kiến Thức Giao Dịch Định Lượng XAU/USD, Cloud MT5 &amp; Pass Quỹ Prop Firm</h1>
      <p>Hệ thống tài liệu kỹ thuật giúp trader triển khai hạ tầng tự động hóa XAU/USD không cần VPS và bảo vệ tài khoản quỹ FTMO, The5ers, FundedNext bằng 4 lớp giáp Fail-Closed.</p>
      <div class="grid">{''.join(cards)}</div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Sẵn sàng kết nối tài khoản MT5 lên Cloud London G2?</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Xem hiệu suất thực tế đã xác thực hoặc kích hoạt ngay qua SePay VietQR 24/7.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Bắt Đầu Ngay →</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, "bot trade vàng XAUUSD, pass quỹ FTMO, Cloud MT5 Zero-VPS, ZUPIRUS", json_ld, body))


@router.get("/huong-dan/{slug}", response_class=HTMLResponse)
def seo_guide_detail(slug: str) -> HTMLResponse:
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
        )
    )
