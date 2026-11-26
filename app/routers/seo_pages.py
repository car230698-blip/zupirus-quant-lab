"""Server-Side Rendered (SSR) SEO Knowledge Hub & Research Guide Pages for ZUPIRUS Quant Lab.

Serves lightning-fast (<10ms TTFB), mobile-first HTML pages with:
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

PUBLISHED_DATE = "2026-11-26"

GUIDES: List[Dict[str, object]] = [
    {
        "slug": "nghien-cuu-dinh-luong-vang-xauusd-m15",
        "title": "Nghiên Cứu Định Lượng XAU/USD M15: Breakout & Retest Ngoài Mẫu | ZUPIRUS Quant Lab",
        "meta_description": "Báo cáo phân tích định lượng chiến lược Breakout & Retest khung M15 vàng COMEX. Kiểm định Walk-Forward ngoài mẫu và ma trận phân phiên London - New York.",
        "keywords": "nghiên cứu định lượng XAUUSD, breakout retest vàng m15, báo cáo định lượng vàng, walk-forward optimization gold",
        "h1": "Nghiên Cứu Định Lượng Breakout & Retest XAU/USD M15: Kỳ Vọng Sau Chi Phí & Ma Trận Phân Phiên",
        "read_time": "6 phút đọc",
        "badge": "QUANT RESEARCH · XAU/USD M15",
        "sections": [
            (
                "1. Bản chất vi cấu trúc thị trường vàng COMEX và hiện tượng Breakout & Retest khung M15",
                "Vàng (XAU/USD) là một trong những tài sản có tính thanh khoản và biến động phân khúc thời gian cao nhất thế giới. Mô hình Breakout & Retest kinh điển thường được giả định là mang lại lợi nhuận cao. Tuy nhiên, việc kiểm định toán học trên dữ liệu tick và nến M15 chuẩn sàn tương lai COMEX cho thấy nhiều đợt bứt phá biên độ là bẫy thanh khoản (liquidity sweeps) nếu không kết hợp bộ lọc động lượng và khối lượng tham chiếu."
            ),
            (
                "2. Phương pháp kiểm định ngoài mẫu Walk-Forward Optimization (WFO) và mô hình chi phí ma sát",
                "Tại ZUPIRUS Quant Lab, mọi giả thuyết nghiên cứu đều phải trải qua quy trình kiểm định Walk-Forward ngoài mẫu (Out-of-Sample - OOS) nghiêm ngặt với các cửa sổ cuốn độc lập. Chúng tôi đưa trực tiếp mô hình chi phí ma sát ba thành phần (Friction Cost: Half-spread thực tế, trượt giá thực thi và phí môi giới) vào hàm mục tiêu thay vì chỉ nhìn vào đường cong lợi nhuận thô."
            ),
            (
                "3. Phân hóa kỳ vọng lợi nhuận (Expectancy) và Profit Factor theo từng phiên giao dịch",
                "Kết quả kiểm định trên tập mẫu mở rộng và tập holdout cho thấy sự phân hóa rõ rệt: các khung giờ giao dịch phiên Âu và giao thoa London - New York duy trì kỳ vọng dương ổn định hơn đáng kể so với phiên Á. Báo cáo nghiên cứu định lượng độc lập của ZUPIRUS cung cấp toàn bộ bảng phân tích chi tiết từng khung giờ UTC để nhà đầu tư có cơ sở dữ liệu khách quan."
            ),
        ],
    },
    {
        "slug": "mo-hinh-chi-phi-giao-dich-vang-friction-cost",
        "title": "Mô Hình Chi Phí Ma Sát Giao Dịch Vàng COMEX (Spread, Slippage, Commission) | ZUPIRUS Quant Lab",
        "meta_description": "Nghiên cứu định lượng về tác động của spread, trượt giá (slippage) và commission lên kỳ vọng toán học của các chiến lược giao dịch vàng tần suất trung bình M15.",
        "keywords": "chi phí giao dịch vàng xauusd, spread vàng, slippage comex gold, mô hình chi phí ma sát định lượng",
        "h1": "Mô Hình Chi Phí Ma Sát Giao Dịch Vàng: Khi Nào Phí Triệt Tiêu Edge Lợi Nhuận?",
        "read_time": "7 phút đọc",
        "badge": "MICROSTRUCTURE · FRICTION COST",
        "sections": [
            (
                "1. Ba thành phần cốt lõi của chi phí ma sát trong giao dịch vàng",
                "Nhiều backtest thông thường thất bại trên thực tế vì giả định chi phí bằng 0 hoặc chỉ tính spread cố định. Chi phí ma sát thực tế gồm 3 thành phần biến thiên: (1) Half-Spread theo thanh khoản phiên, (2) Execution Slippage trong các thời điểm biến động nhanh hoặc tin tức kinh tế, và (3) Phí hoa hồng sàn (Commission) quy đổi trên mỗi ounce."
            ),
            (
                "2. Độ nhạy của Profit Factor trước các mức chi phí ma sát thực tế ($1.5/oz, $2.5/oz, $4.0/oz)",
                "Bằng cách lập bảng phân tích độ nhạy (Stress Testing Matrix) tại 3 kịch bản chi phí ma sát khác nhau, nghiên cứu chỉ ra rằng ở mức chi phí $4.0/oz, một số khung giờ giao dịch có tỷ lệ thắng danh nghĩa cao vẫn bị kéo về mức kỳ vọng âm. Điều này nhấn mạnh tầm quan trọng của việc chỉ chọn các thiết lập có biên an toàn (Safety Margin) vượt trội."
            ),
            (
                "3. Khuyến nghị định lượng cho việc kiểm thử mô hình trước khi ứng dụng thực tế",
                "Một chiến lược định lượng chỉ được xem là đạt chuẩn nếu Profit Factor ngoài mẫu (OOS) duy trì trên 1.25 sau khi đã trừ toàn bộ chi phí ma sát ở kịch bản thận trọng ($2.50/oz). Các báo cáo chuyên khảo của ZUPIRUS Quant Lab luôn cung cấp dữ liệu minh bạch ở cả 3 cấp độ chi phí này."
            ),
        ],
    },
    {
        "slug": "kiem-dinh-walk-forward-ngoai-mau-comex-gold",
        "title": "Phương Pháp Kiểm Định Walk-Forward Ngoài Mẫu (OOS) Cho Dữ Liệu Vàng | ZUPIRUS Quant Lab",
        "meta_description": "Cách loại bỏ hiện tượng quá khớp (overfitting) và sai lệch chọn mẫu (selection bias) khi nghiên cứu chiến lược định lượng XAU/USD bằng Walk-Forward Analysis.",
        "keywords": "walk forward analysis xauusd, kiểm định ngoài mẫu oos, chống quá khớp định lượng, backtest vàng chuẩn mực",
        "h1": "Phương Pháp Kiểm Định Walk-Forward Ngoài Mẫu: Chuẩn Mực Nghiên Cứu Định Lượng Vàng",
        "read_time": "8 phút đọc",
        "badge": "METHODOLOGY · WALK-FORWARD OOS",
        "sections": [
            (
                "1. Cạm bẫy overfitting trong backtest truyền thống và ảo tưởng đường cong vốn dốc đứng",
                "Quá khớp tham số (Overfitting) là lý do lớn nhất khiến 95% mô hình hoạt động xuất sắc trên lịch sử quá khứ nhưng lập tức thua lỗ khi triển khai ngoài đời thực. Khi tinh chỉnh hàng chục tham số trên cùng một bộ dữ liệu, nhà phân tích thực chất chỉ đang học thuộc lòng độ nhiễu ngẫu nhiên (noise)."
            ),
            (
                "2. Cấu trúc cửa sổ cuốn (Rolling Windows) và tỷ lệ Train / Validation / Holdout trong phân tích định lượng",
                "Quy trình Walk-Forward Optimization (WFO) chia dòng thời gian thành nhiều cửa sổ cuốn liên tiếp: huấn luyện tham số trên tập In-Sample (IS), kiểm thử tức thời trên tập Out-of-Sample (OOS), và khóa kín tập Holdout hoàn toàn độc lập cho đến vòng nghiệm thu cuối cùng. Điều này tái lập chính xác điều kiện thị trường tương lai mà mô hình phải đối mặt."
            ),
            (
                "3. Thẩm định báo cáo định lượng độc lập trước khi đưa ra quyết định phân bổ vốn",
                "Nhà đầu tư định lượng cần tiếp cận dữ liệu có tính phản biện cao. Việc đọc các báo cáo nghiên cứu có đầy đủ thông số OOS Degradation Ratio (tỷ lệ suy giảm ngoài mẫu) và kiểm định Monte Carlo giúp xác định độ vững (Robustness) của chiến lược một cách khoa học."
            ),
        ],
    },
    {
        "slug": "phan-tich-ky-vong-loi-nhuan-theo-phien-gold",
        "title": "Phân Tích Kỳ Vọng Lợi Nhuận XAU/USD Theo Từng Phiên Giao Dịch | ZUPIRUS Quant Lab",
        "meta_description": "So sánh biến động, thanh khoản và kỳ vọng toán học của vàng COMEX qua các phiên Á (Tokyo), Âu (London) và Mỹ (New York).",
        "keywords": "phiên giao dịch vàng, thanh khoản xauusd phiên âu mỹ, london ny overlap gold, kỳ vọng lợi nhuận theo phiên",
        "h1": "Phân Tích Kỳ Vọng Lợi Nhuận Vàng XAU/USD: Sự Khác Biệt Giữa Các Phiên Giao Dịch",
        "read_time": "6 phút đọc",
        "badge": "SESSION ANALYSIS · MARKET REGIME",
        "sections": [
            (
                "1. Đặc tính thanh khoản và biến động phân khúc theo thời gian UTC của vàng",
                "Biến động giá vàng không phân bổ đồng đều trong 24 giờ. Phiên Á (Tokyo/Singapore) thường có biên độ hẹp và khối lượng mỏng, trong khi phiên Âu (London Open lúc 07:00–08:00 UTC) và phiên Mỹ (New York Open lúc 12:00–13:30 UTC) chứng kiến khối lượng hợp đồng tương lai và quyền chọn tăng vọt."
            ),
            (
                "2. Hiệu ứng phiên Âu (London Open) và phiên Mỹ (New York Open) lên cấu trúc nến M15",
                "Các mô hình phá vỡ biên độ (Breakout) trong phiên Á thường có tỷ lệ thất bại cao do thiếu dòng tiền tổ chức. Ngược lại, vào thời điểm giao thoa London - New York, các đợt breakout có xác suất tiếp diễn động lượng (Momentum Continuation) cao hơn nhiều, tạo ra Profit Factor khả quan khi có Stop Loss và Take Profit hợp lý."
            ),
            (
                "3. Lựa chọn khung giờ tối ưu cho các nghiên cứu định lượng chuyên sâu",
                "Thông qua các bảng số liệu trích xuất từ dữ liệu tick thực tế, ZUPIRUS Quant Lab làm rõ từng khung giờ nào có kỳ vọng dương thực sự sau chi phí và khung giờ nào mang lại rủi ro cao, giúp các nhà nghiên cứu định lượng tiết kiệm hàng trăm giờ kiểm nghiệm."
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

    nav_reports = "PDF Reports" if is_en else "Báo Cáo PDF"
    nav_guide = "Research Guides" if is_en else "Tài Liệu Nghiên Cứu"
    nav_cta = "Client Portal →" if is_en else "Cổng Nghiên Cứu →"

    footer_home = "Home" if is_en else "Trang Chủ"
    footer_guides = "Research Guides" if is_en else "Tài Liệu Nghiên Cứu"
    footer_login = "Login" if is_en else "Đăng Nhập"
    footer_tagline = (
        "XAU/USD Quantitative Research & Walk-Forward Verification Lab"
        if is_en
        else "Phòng Nghiên Cứu Định Lượng Vàng XAU/USD & Kiểm Định Walk-Forward"
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
        <a href="/#reports">{nav_reports}</a>
        <a href="/huong-dan">{nav_guide}</a>
        <a class="cta" href="https://app.zupirus.com/">{nav_cta}</a>
      </div>
    </div>
  </header>
  <main>{body_html}</main>
  <footer>
    © 2026 ZUPIRUS Quant Lab · {footer_tagline} ·
    <a href="https://zupirus.com/">{footer_home}</a> · <a href="/#reports">{nav_reports}</a> · <a href="/huong-dan">{footer_guides}</a> · <a href="https://app.zupirus.com/">{footer_login}</a>
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


@router.get("/huong-dan", response_class=HTMLResponse)
def seo_guides_hub(request: Request, lang: Optional[str] = Query(None)) -> HTMLResponse:
    effective_lang = _resolve_lang(request, lang)
    canonical = "https://zupirus.com/huong-dan"
    title = (
        "XAU/USD Quantitative Research & Methodology Knowledge Hub | ZUPIRUS Quant Lab"
        if effective_lang == "en"
        else "Trung Tâm Tài Liệu & Phương Pháp Nghiên Cứu Định Lượng Vàng XAU/USD | ZUPIRUS"
    )
    desc = (
        "Comprehensive quantitative research articles, Walk-Forward Optimization methodologies, and friction cost models for XAU/USD gold markets."
        if effective_lang == "en"
        else "Tổng hợp các bài nghiên cứu định lượng chuyên sâu, phương pháp kiểm định Walk-Forward ngoài mẫu và mô hình chi phí ma sát cho thị trường vàng XAU/USD."
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
    crumb_guides = "Research Guides" if effective_lang == "en" else "Tài Liệu Nghiên Cứu"
    h1_text = (
        "XAU/USD Quantitative Research & Verification Methodology Hub"
        if effective_lang == "en"
        else "Trung Tâm Nghiên Cứu Định Lượng &amp; Kiểm Định Vàng XAU/USD"
    )
    sub_text = (
        "In-depth research papers, Walk-Forward Optimization (WFO) analyses, and realistic transaction friction cost models for professional gold quantitative research."
        if effective_lang == "en"
        else "Hệ thống tài liệu nghiên cứu chuyên khảo, phương pháp kiểm định ngoài mẫu Walk-Forward và mô hình chi phí ma sát thực tế phục vụ nghiên cứu định lượng vàng chuyên nghiệp."
    )
    cta_title = "Explore Our Published Quantitative PDF Reports" if effective_lang == "en" else "Khám Phá Các Báo Cáo Nghiên Cứu Định Lượng PDF"
    cta_sub = "Read free sample previews and download full institutional research reports." if effective_lang == "en" else "Xem bản đọc thử miễn phí và tải báo cáo đầy đủ trực tiếp từ thư viện cá nhân."
    cta_btn = "Explore Catalog →" if effective_lang == "en" else "Xem Danh Mục Báo Cáo →"
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">{crumb_home}</a> / {crumb_guides}</div>
      <span class="badge">ZUPIRUS QUANT LAB · METHODOLOGY HUB</span>
      <h1>{h1_text}</h1>
      <p>{sub_text}</p>
      <div class="grid">{''.join(cards)}</div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">{cta_title}</strong>
          <p style="margin:4px 0 0;font-size:13.5px">{cta_sub}</p>
        </div>
        <a class="cta" href="https://zupirus.com/#reports">{cta_btn}</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, "nghiên cứu định lượng vàng xauusd, walk-forward optimization, báo cáo pdf vàng", json_ld, body, lang=effective_lang))


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
                    {"@type": "ListItem", "position": 2, "name": "Tài liệu", "item": "https://zupirus.com/huong-dan"},
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
      <div class="crumb"><a href="https://zupirus.com/">Trang chủ</a> / <a href="/huong-dan">Tài liệu</a> / {html.escape(slug)}</div>
      <span class="badge">{html.escape(str(g['badge']))} · {html.escape(str(g['read_time']))}</span>
      <h1>{html.escape(str(g['h1']))}</h1>
      <p style="color:#94a3b8;font-size:13px">Cập nhật: {PUBLISHED_DATE} · Tác giả: ZUPIRUS Quant Lab</p>
      <article class="card">{sections_html}</article>
      <div class="card">
        <h2 style="margin-top:0;font-size:17px">Nghiên cứu &amp; Chuyên khảo liên quan</h2>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:2">{related_html}</ul>
      </div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Xem báo cáo nghiên cứu định lượng độc lập</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Đọc thử miễn phí · Mua và tải ấn bản PDF đầy đủ từ thư viện tài khoản.</p>
        </div>
        <a class="cta" href="https://zupirus.com/#reports">Xem Danh Mục Báo Cáo →</a>
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
        "slug": "xauusd-m15-breakout-retest-quantitative-research",
        "title": "Breakout & Retest XAU/USD M15 Out-of-Sample Quantitative Research | ZUPIRUS Quant Lab",
        "meta_description": "Rigorous quantitative research on Breakout & Retest on COMEX Gold M15. Walk-Forward out-of-sample testing, realistic friction costs, and session expectancy matrices.",
        "keywords": "XAUUSD quantitative research, breakout retest gold M15, walk forward optimization gold, gold quant report",
        "h1": "Quantitative Research: Does Breakout & Retest on XAU/USD M15 Retain Positive Edge After Friction Costs?",
        "read_time": "6 min read",
        "badge": "QUANT RESEARCH · XAU/USD M15",
        "sections": [
            (
                "1. Microstructure of COMEX Gold & Breakout Retest Mechanics on M15",
                "COMEX Gold (XAU/USD) displays extreme intraday liquidity concentration. While textbook Breakout & Retest patterns promise attractive risk-to-reward ratios, rigorous tick-level evaluation demonstrates that many nominal breakouts are liquidity sweeps lacking momentum continuation."
            ),
            (
                "2. Walk-Forward Out-of-Sample (OOS) Testing & Realistic Friction Cost Models",
                "At ZUPIRUS Quant Lab, all quantitative hypotheses undergo multi-window rolling Walk-Forward Optimization (WFO). We embed a three-tier transaction friction model (spread, execution slippage, and exchange fees) directly into evaluation functions."
            ),
            (
                "3. Session-Specific Expectancy & Profit Factor Breakdown",
                "Empirical holdout and full-period data reveal pronounced session differences: European morning and London/New York overlap hours sustain positive mathematical expectancy significantly better than Asian low-liquidity sessions."
            ),
        ],
    },
    {
        "slug": "gold-trading-friction-cost-microstructure-model",
        "title": "COMEX Gold Transaction Friction Cost Model (Spread, Slippage & Commission) | ZUPIRUS Quant Lab",
        "meta_description": "Quantitative analysis of the impact of spreads, execution slippage, and brokerage commissions on the statistical edge of medium-frequency M15 gold strategies.",
        "keywords": "gold transaction friction cost, XAUUSD spread model, COMEX gold slippage, quantitative friction model",
        "h1": "Microstructure Friction Costs in Gold Trading: When Does Drag Eliminate Strategy Edge?",
        "read_time": "7 min read",
        "badge": "MICROSTRUCTURE · FRICTION COST",
        "sections": [
            (
                "1. The Three Components of Execution Friction in Gold Markets",
                "Most backtests fail in live markets because they assume zero transaction drag or constant fixed spreads. Real execution involves three dynamic elements: half-spread based on session liquidity, execution slippage during volatility shocks, and clearing commissions."
            ),
            (
                "2. Sensitivity Analysis Across Realistic Cost Scenarios ($1.5/oz, $2.5/oz, $4.0/oz)",
                "By stress-testing models across multiple friction regimes, research reveals that at higher drag levels ($4.0/oz), nominal edge is rapidly eroded in off-peak trading hours. This mandates an adequate statistical safety margin before deployment."
            ),
            (
                "3. Standards for Robust Model Verification",
                "Quantitative strategies must demonstrate out-of-sample profit factors above 1.25 under conservative friction assumptions ($2.50/oz). ZUPIRUS research reports publish verified results across all three friction thresholds."
            ),
        ],
    },
    {
        "slug": "walk-forward-oos-validation-methodology-gold",
        "title": "Walk-Forward Out-of-Sample (OOS) Validation Methodology for COMEX Gold | ZUPIRUS Quant Lab",
        "meta_description": "Preventing overfitting and data snooping in gold algorithmic research through anchored and rolling Walk-Forward Optimization and strict holdout isolation.",
        "keywords": "walk forward analysis gold, out of sample validation xauusd, anti overfitting quant, gold backtest methodology",
        "h1": "Walk-Forward Out-of-Sample Validation Methodology: Institutional Standards for Gold Research",
        "read_time": "8 min read",
        "badge": "METHODOLOGY · WALK-FORWARD OOS",
        "sections": [
            (
                "1. The Perils of Overfitting in Traditional Historical Backtests",
                "Overfitting is the primary reason behind strategy decay in live markets. When parameters are repeatedly tuned on historical data, analysts inadvertently model market noise rather than persistent structural dynamics."
            ),
            (
                "2. Rolling Windows and Train / Validation / Holdout Partitioning",
                "Walk-Forward Optimization segments historical data into progressive train and test windows, preserving chronological sequencing and isolating a pristine holdout sample that remains unexamined until final acceptance."
            ),
            (
                "3. Independent Quantitative Research Reports for Decision Making",
                "Professional market participants require objective, un-hyped research. Independent verification, OOS degradation metrics, and stress-tested expectancy matrices provide an empirical foundation for capital allocation."
            ),
        ],
    },
]
ENGLISH_GUIDE_BY_SLUG: Dict[str, Dict[str, object]] = {g["slug"]: g for g in ENGLISH_GUIDES}  # type: ignore[misc]


@router.get("/en", response_class=HTMLResponse)
def seo_english_landing(request: Request) -> HTMLResponse:
    canonical = "https://zupirus.com/en"
    title = "ZUPIRUS — Institutional Gold (XAU/USD) Quantitative Research Lab"
    desc = "Independent quantitative research laboratory specializing in COMEX Gold (XAU/USD) market microstructure, Walk-Forward Optimization, and published PDF reports."
    keywords = "gold quantitative research, XAUUSD quant lab, walk forward optimization, COMEX gold research, quant PDF reports"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "name": "ZUPIRUS Quant Lab",
                "url": "https://zupirus.com/en",
                "description": desc,
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
          <a href="/en/guides/{g['slug']}" style="font-weight:700;font-size:13.5px">Read Full Research →</a>
        </div>"""
        for g in ENGLISH_GUIDES
    )
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Home</a> / Global English Overview</div>
      <span class="badge">ZUPIRUS QUANT LAB · INDEPENDENT RESEARCH</span>
      <h1>Institutional Gold (XAU/USD) Quantitative Research &amp; Walk-Forward Laboratory</h1>
      <p>Empirical market microstructure analysis, rolling Walk-Forward Optimization (WFO), and rigorous transaction friction cost modeling. Browse research catalog, read free sample previews, and purchase institutional PDF reports.</p>

      <div class="grid">
        <div class="card">
          <span class="badge">METHODOLOGY</span>
          <h2>Walk-Forward OOS Verification</h2>
          <p>Strict chronological separation of training, validation, and holdout datasets to eliminate overfitting and selection bias.</p>
        </div>
        <div class="card">
          <span class="badge">MICROSTRUCTURE</span>
          <h2>Realistic Friction Cost Models</h2>
          <p>Every finding is evaluated across half-spread, execution slippage, and brokerage fees ($1.5/oz, $2.5/oz, $4.0/oz).</p>
        </div>
        <div class="card">
          <span class="badge">DIGITAL DELIVERY</span>
          <h2>Versioned PDF Reports Library</h2>
          <p>Direct USDT (TRC20/BEP20) checkout, automatic cryptographic verification, and instant access to your account library.</p>
        </div>
      </div>

      <h2 style="margin-top:48px">Quantitative Research &amp; Methodology Guides</h2>
      <div class="grid">{cards}</div>

      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:18px">Explore Our Published Quantitative Research</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Read free sample previews and download full reports from your account library.</p>
        </div>
        <a class="cta" href="https://zupirus.com/#reports">View Report Catalog →</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, keywords, json_ld, body, lang="en"))


@router.get("/en/guides", response_class=HTMLResponse)
def seo_english_guides(request: Request) -> HTMLResponse:
    canonical = "https://zupirus.com/en/guides"
    title = "Quantitative Research & Methodology Knowledge Hub | ZUPIRUS Quant Lab"
    desc = "Explore in-depth quantitative research, Walk-Forward Optimization methodologies, and realistic friction cost modeling for COMEX Gold (XAU/USD)."
    keywords = "gold quant research, walk forward optimization, market microstructure, gold quant reports"
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
          <a href="/en/guides/{g['slug']}" style="font-weight:700;font-size:13.5px">Read Research →</a>
        </div>"""
        for g in ENGLISH_GUIDES
    )
    body = f"""
      <div class="crumb"><a href="https://zupirus.com/">Home</a> / <a href="/en">Global English</a> / Guides</div>
      <span class="badge">QUANT KNOWLEDGE HUB</span>
      <h1>Quantitative Research &amp; Methodology Guides</h1>
      <p>Institutional analysis, algorithmic architectures, and disciplined risk guidelines for systematic gold (XAU/USD) traders.</p>
      <div class="grid">{cards}</div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">Ready to explore our research catalog?</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Access comprehensive PDF reports with full data tables and out-of-sample matrices.</p>
        </div>
        <a class="cta" href="https://zupirus.com/#reports">View Report Catalog →</a>
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
          <strong style="color:#fff;font-size:17px">Access Institutional Research Reports</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Examine sample previews and purchase verified PDF publications with direct USDT checkout.</p>
        </div>
        <a class="cta" href="https://zupirus.com/#reports">View Report Catalog →</a>
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
