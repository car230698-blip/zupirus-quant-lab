"""Public educational copy for the quant library. No execution claims."""
from __future__ import annotations

from typing import Dict, List

DISCLAIMER = (
    "ZUPIRUS Quant Lab publishes educational statistical studies as PDF guides. "
    "It does not place orders, copy trades, host a cloud MT5 terminal, or rent a VPS. "
    "Past statistics are not a promise of profit."
)

GUIDES: List[Dict[str, object]] = [
    {
        "slug": "cach-doc-mot-nghien-cuu-thong-ke",
        "title": "Cách đọc một nghiên cứu thống kê thị trường | ZUPIRUS Quant Lab",
        "meta_description": "Hướng dẫn đọc mẫu nến, phiên giao dịch, vùng biến động và phần tuyên bố rủi ro trong ấn phẩm PDF của ZUPIRUS. Không có cam kết lợi nhuận.",
        "keywords": "nghiên cứu định lượng, thống kê XAUUSD, phương pháp giao dịch, ZUPIRUS Quant Lab",
        "h1": "Cách đọc một nghiên cứu thống kê của ZUPIRUS",
        "read_time": "5 phút đọc",
        "badge": "PHƯƠNG PHÁP · PDF",
        "sections": [
            (
                "1. Sản phẩm là tài liệu, không phải lệnh",
                "Mỗi ấn phẩm mô tả một mẫu dữ liệu OHLC đã chọn: phiên nào, khung thời gian nào, và tham số nào. ZUPIRUS không kết nối tài khoản giao dịch và không khớp lệnh giúp bạn.",
            ),
            (
                "2. Số trong bảng là mô tả mẫu",
                "Tỷ lệ phá biên, tự tương quan hay mức sụt giảm của một quy tắc chỉ đúng với mẫu và chi phí đã ghi. Đổi khoảng ngày hoặc đổi spread là phải tính lại.",
            ),
            (
                "3. Tuyên bố rủi ro",
                DISCLAIMER + " Giao dịch vàng, ngoại hối và chỉ số có thể làm mất vốn.",
            ),
        ],
    },
    {
        "slug": "phien-va-bien-do-trong-nghien-cuu",
        "title": "Phiên Á, London, New York trong một nghiên cứu | ZUPIRUS",
        "meta_description": "Giải thích cách ZUPIRUS chia phiên theo giờ UTC và vì sao biên độ phiên không phải tín hiệu vào lệnh.",
        "keywords": "phiên London vàng, phiên Á XAUUSD, nghiên cứu định lượng, ZUPIRUS",
        "h1": "Phiên giao dịch trong nghiên cứu thống kê",
        "read_time": "5 phút đọc",
        "badge": "PHIÊN · UTC",
        "sections": [
            (
                "1. Múi giờ được ghi rõ",
                "Nghiên cứu dùng UTC: Á 00:00–07:00, London 07:00–13:00, New York 13:00–21:00. Nếu bạn đổi múi giờ mà không ghi lại, bảng số không còn so được.",
            ),
            (
                "2. Biên độ không phải lời khuyên",
                "Biên độ trung bình cho biết giá đã đi bao xa trong mẫu. Nó không nói phiên sau sẽ đi cùng một khoảng.",
            ),
            (
                "3. Đọc thử và bản đầy đủ",
                "Bản đọc thử nêu dữ liệu và giới hạn. Bản đầy đủ có bảng, biểu đồ và đường đi lịch sử của quy tắc minh họa, kèm tuyên bố rủi ro.",
            ),
        ],
    },
]

ENGLISH_GUIDES: List[Dict[str, object]] = [
    {
        "slug": "how-to-read-a-statistical-market-study",
        "title": "How to Read a Statistical Market Study | ZUPIRUS Quant Lab",
        "meta_description": "How to read the sample, the session clock, the volatility tables, and the risk disclaimer in a ZUPIRUS PDF. No profit promise.",
        "keywords": "quantitative research, XAUUSD statistics, trading methodology, ZUPIRUS Quant Lab",
        "h1": "How to Read a ZUPIRUS Statistical Study",
        "read_time": "5 min read",
        "badge": "METHOD · PDF",
        "sections": [
            (
                "1. The product is a document, not an order",
                "Each guide describes one OHLC sample: which sessions, which timeframe, and which parameters. ZUPIRUS does not connect to a trading account and does not fill orders.",
            ),
            (
                "2. A table describes that sample",
                "A break rate, an autocorrelation, or a rule's drawdown is true only for the recorded sample and cost. Change the dates or the spread and the numbers must be recomputed.",
            ),
            (
                "3. Risk disclaimer",
                DISCLAIMER + " Trading gold, forex, or indices can lose capital.",
            ),
        ],
    },
    {
        "slug": "sessions-and-ranges-in-a-study",
        "title": "Asia, London, and New York inside a study | ZUPIRUS",
        "meta_description": "Why ZUPIRUS labels sessions in UTC, and why an average range is not a signal to trade.",
        "keywords": "London session gold, Asia range study, quantitative research, ZUPIRUS",
        "h1": "Trading Sessions Inside a Statistical Study",
        "read_time": "5 min read",
        "badge": "SESSIONS · UTC",
        "sections": [
            (
                "1. The clock is written down",
                "Studies use UTC: Asia 00:00–07:00, London 07:00–13:00, New York 13:00–21:00. If you shift the clock and do not record it, the tables are no longer comparable.",
            ),
            (
                "2. A range is not advice",
                "An average range says how far price travelled in the sample. It does not say the next session will travel the same distance.",
            ),
            (
                "3. Preview and full note",
                "The free preview states the data and the limits. The full PDF adds the tables, the charts, and the historical path of one illustrative rule, with the risk disclaimer.",
            ),
        ],
    },
]
