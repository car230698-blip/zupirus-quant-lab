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
]

GUIDE_BY_SLUG = {str(g["slug"]): g for g in GUIDES}


def _render_shell(title: str, description: str, canonical: str, keywords: str, json_ld: dict, body_html: str) -> str:
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
  <style>
    :root {{ color-scheme: dark; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #020617; color: #e2e8f0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.75; }}
    a {{ color: #fbbf24; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    header {{ position: sticky; top: 0; z-index: 20; background: rgba(2, 6, 23, 0.92); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.08); }}
    .nav {{ max-width: 980px; margin: 0 auto; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }}
    .brand {{ font-weight: 800; letter-spacing: 0.08em; color: #fbbf24; font-size: 16px; }}
    .nav-links {{ display: flex; gap: 18px; align-items: center; font-size: 13px; }}
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
    footer {{ border-top: 1px solid rgba(255,255,255,0.08); padding: 26px 20px; text-align: center; font-size: 12px; color: #64748b; }}
  </style>
</head>
<body>
  <header>
    <div class="nav">
      <a class="brand" href="https://zupirus.com/">⚡ ZUPIRUS QUANT LAB</a>
      <div class="nav-links">
        <a href="https://zupirus.com/#track-record">Hiệu Suất Thực Tế</a>
        <a href="/huong-dan">Kiến Thức &amp; Hướng Dẫn</a>
        <a href="https://discord.gg/yxCx3dVe34" target="_blank" rel="noopener noreferrer">Discord</a>
        <a class="cta" href="https://app.zupirus.com/">Mở Cổng Giao Dịch →</a>
      </div>
    </div>
  </header>
  <main>{body_html}</main>
  <footer>
    © 2026 ZUPIRUS Quant Lab · Hạ tầng Cloud MT5 XAU/USD Zero-VPS &amp; Prop Firm Guard ·
    <a href="https://zupirus.com/">Trang Chủ</a> · <a href="/huong-dan">Hướng Dẫn</a> · <a href="https://app.zupirus.com/">Đăng Nhập</a>
  </footer>
</body>
</html>"""


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
