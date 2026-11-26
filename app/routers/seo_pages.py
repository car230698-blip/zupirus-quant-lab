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

from app.domains.quant.public_copy import ENGLISH_GUIDES, GUIDES

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
    nav_cta = "Open the library →" if is_en else "Mở thư viện PDF →"

    footer_home = "Home" if is_en else "Trang Chủ"
    footer_guides = "Guides" if is_en else "Hướng Dẫn"
    footer_login = "Login" if is_en else "Đăng Nhập"
    footer_tagline = (
        "Educational statistical studies as PDF guides. No automated execution."
        if is_en
        else "Nghiên cứu thống kê dạng PDF. Không thực thi lệnh tự động."
    )
    banner = (
        "<p class=\"card\"><strong>ZUPIRUS Quant Lab</strong> publishes educational market studies as PDF guides. "
        "It does not place orders, copy trades, host cloud MT5, or rent a VPS. Past statistics are not a promise of profit.</p>"
        if is_en
        else "<p class=\"card\"><strong>ZUPIRUS Quant Lab</strong> xuất bản nghiên cứu thống kê thị trường dưới dạng PDF. "
        "Không đặt lệnh, không copy-trade, không cung cấp Cloud MT5 hay VPS. Thống kê quá khứ không phải cam kết lợi nhuận.</p>"
    )
    body_html = banner + body_html

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
        <a href="/cong-cu/tinh-lot-size-xauusd">{nav_lot}</a>
        <a href="/cong-cu/tinh-drawdown-quy-prop-firm">{nav_dd}</a>
        <a href="/huong-dan">{nav_guide}</a>
        <a class="cta" href="https://app.zupirus.com/">{nav_cta}</a>
      </div>
    </div>
  </header>
  <main>{body_html}</main>
  <footer>
    © 2026 ZUPIRUS Quant Lab · {footer_tagline} ·
    <a href="https://zupirus.com/">{footer_home}</a> · <a href="/cong-cu/tinh-lot-size-xauusd">{nav_lot}</a> · <a href="/cong-cu/tinh-drawdown-quy-prop-firm">{nav_dd}</a> · <a href="/huong-dan">{footer_guides}</a> · <a href="https://app.zupirus.com/">{footer_login}</a>
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
          <strong style="color:#fff;font-size:17px">Công thức này chỉ để tự tính. ZUPIRUS không vào lệnh giúp bạn.</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Đọc thêm nghiên cứu thống kê dạng PDF trong thư viện. Không copy-trade, không Cloud MT5.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Mở thư viện PDF →</a>
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
          <strong style="color:#fff;font-size:17px">Đọc nghiên cứu trong thư viện PDF. Không có lệnh tự động.</strong>
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
        "How to read a ZUPIRUS study | ZUPIRUS Quant Lab"
        if effective_lang == "en"
        else "Cách đọc nghiên cứu ZUPIRUS | ZUPIRUS Quant Lab"
    )
    desc = (
        "Notes on reading a statistical study of XAU/USD. Educational PDFs only, with no automated orders."
        if effective_lang == "en"
        else "Ghi chú cách đọc một nghiên cứu thống kê XAU/USD. Chỉ là PDF giáo dục, không có lệnh tự động."
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
        "How to read a ZUPIRUS quantitative study"
        if effective_lang == "en"
        else "Cách đọc một nghiên cứu định lượng của ZUPIRUS"
    )
    sub_text = (
        "Notes on samples, session clocks, and what a historical table does not claim."
        if effective_lang == "en"
        else "Ghi chú về mẫu dữ liệu, múi giờ phiên, và những gì một bảng lịch sử không khẳng định."
    )
    cta_title = "Open the PDF library" if effective_lang == "en" else "Mở thư viện PDF"
    cta_sub = "Free preview, then USDT (BEP20/TRC20) if you want the full note." if effective_lang == "en" else "Đọc thử miễn phí, rồi thanh toán USDT (BEP20/TRC20) nếu bạn muốn bản đầy đủ."
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
    return HTMLResponse(_render_shell(title, desc, canonical, "nghiên cứu định lượng XAUUSD, PDF phương pháp, ZUPIRUS Quant Lab", json_ld, body, lang=effective_lang))


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
          <strong style="color:#fff;font-size:17px">Mở thư viện PDF và đọc bản xem thử</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Ấn phẩm đã xuất bản thanh toán bằng USDT trên BEP20 hoặc TRC20. Không cam kết lợi nhuận.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Mở thư viện PDF →</a>
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


ENGLISH_GUIDE_BY_SLUG: Dict[str, Dict[str, object]] = {g["slug"]: g for g in ENGLISH_GUIDES}  # type: ignore[misc]


@router.get("/en", response_class=HTMLResponse)
def seo_english_landing(request: Request) -> HTMLResponse:
    canonical = "https://zupirus.com/en"
    title = "ZUPIRUS — Statistical Studies of Gold (XAU/USD) and Forex"
    desc = "Educational quantitative studies of gold, forex, and indices, published as PDF guides with a free preview. No automated execution and no profit promise."
    keywords = "ZUPIRUS Quant Lab, XAUUSD statistical study, forex research PDF, quantitative methodology"
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "SoftwareApplication",
                "name": "ZUPIRUS Quant Lab PDF guides",
                "applicationCategory": "EducationalApplication",
                "operatingSystem": "Web",
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
      <span class="badge">QUANT LAB · PDF STUDIES</span>
      <h1>Statistical studies of gold, forex, and indices</h1>
      <p>Read a free preview, then buy the full methodology as a PDF. The figures describe a named historical sample. They are not a forecast and not a promise of profit.</p>

      <div class="grid">
        <div class="card">
          <span class="badge">WHAT YOU GET</span>
          <h2>Documented methodology</h2>
          <p>Session behaviour, volatility regimes, seasonality, and the historical path of one rule, with the parameters written down so the study can be recomputed.</p>
        </div>
        <div class="card">
          <span class="badge">WHAT THIS IS NOT</span>
          <h2>No automated execution</h2>
          <p>ZUPIRUS does not connect an MT5 account, copy trades, or host a trading server. You keep your own broker account, if you have one.</p>
        </div>
        <div class="card">
          <span class="badge">PAYMENT</span>
          <h2>USDT on BEP20 or TRC20</h2>
          <p>A published guide can be bought with on-chain USDT. After payment clears, the library gives you a time-limited download of the version you bought.</p>
        </div>
      </div>

      <h2 style="margin-top:48px">Institutional Knowledge Hub &amp; Guides</h2>
      <div class="grid">{cards}</div>

      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:18px">Browse the PDF library</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Preview a study, then pay with USDT (TRC20/BEP20) if you want the full note.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Open the library →</a>
      </div>
    """
    return HTMLResponse(_render_shell(title, desc, canonical, keywords, json_ld, body, lang="en"))


@router.get("/en/guides", response_class=HTMLResponse)
def seo_english_guides(request: Request) -> HTMLResponse:
    canonical = "https://zupirus.com/en/guides"
    title = "Quantitative Trading & Prop Firm Knowledge Hub | ZUPIRUS"
    desc = "Notes on how to read a ZUPIRUS statistical study. Educational PDFs only."
    keywords = "prop firm education, XAUUSD statistical studies, EURUSD session research PDF, ZUPIRUS quant library"
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
      <h1>How to read a quantitative study</h1>
      <p>Notes on samples, session clocks, and what a historical table does not claim.</p>
      <div class="grid">{cards}</div>
      <div class="cta-box">
        <div>
          <strong style="color:#fff;font-size:17px">The library is on the website</strong>
          <p style="margin:4px 0 0;font-size:13.5px">No terminal to install. A purchase unlocks the PDF you bought.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Open the library →</a>
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
          <strong style="color:#fff;font-size:17px">Open the PDF library and read a free preview</strong>
          <p style="margin:4px 0 0;font-size:13.5px">Published guides are paid in USDT on BEP20 or TRC20. Past statistics are not a profit promise.</p>
        </div>
        <a class="cta" href="https://app.zupirus.com/">Open PDF library →</a>
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

