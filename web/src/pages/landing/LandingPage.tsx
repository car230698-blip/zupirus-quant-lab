import React, { useState } from 'react';
import { LandingLayout } from '../../layouts/LandingLayout';
import { QuantReportCatalogAndLibrary } from '../../components/reports/QuantReportCatalogAndLibrary';
import { useLanguage } from '../../i18n/LanguageContext';
import { ArrowRight, ChevronDown, FileText, ShieldCheck, CheckCircle2 } from 'lucide-react';

export interface LandingPageProps {
  onNavigate: (to: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  const { lang, t } = useLanguage();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const methodSteps =
    lang === 'en'
      ? [
          {
            step: '01',
            title: 'Session Microstructure Profiling',
            desc: 'Decompose XAU/USD liquidity sweeps and volatility across Asia, London, and New York overlaps on M15 and H1 bars.',
          },
          {
            step: '02',
            title: 'Rolling Walk-Forward Validation',
            desc: 'Test parameters on strict out-of-sample 120/60 rolling blocks with explicit round-trip cost assumptions.',
          },
          {
            step: '03',
            title: 'Audit-Ready PDF Publication',
            desc: 'Package statistical tables, hazard filters, and drawdowns into versioned PDF publications with free public previews.',
          },
          {
            step: '04',
            title: 'Direct USDT Unlock & Library',
            desc: 'Purchase individual issues via USDT BEP20 or TRC20 and keep permanent access to downloaded PDFs in your portal.',
          },
        ]
      : [
          {
            step: '01',
            title: 'Phân Tích Vi Cấu Trúc Theo Phiên',
            desc: 'Tách bạch đặc tính quét thanh khoản XAU/USD qua từng phiên Asia, London và London/New York trên dữ liệu M15/H1.',
          },
          {
            step: '02',
            title: 'Kiểm Định Cuốn Chiếu Walk-Forward',
            desc: 'Thử nghiệm nghiêm ngặt ngoài mẫu (120 nến huấn luyện / 60 nến kiểm thử) kèm chi phí trượt giá giả định minh bạch.',
          },
          {
            step: '03',
            title: 'Đóng Gói Ấn Phẩm PDF Chuẩn Mực',
            desc: 'Tổng hợp bảng phân rã kỳ vọng, ngưỡng chịu drawdown và quy tắc lọc nhiễu thành ấn phẩm PDF có bản đọc thử miễn phí.',
          },
          {
            step: '04',
            title: 'Thanh Toán USDT & Lưu Thư Viện',
            desc: 'Mua lẻ từng báo cáo bằng USDT BEP20 hoặc TRC20 và tải bản đầy đủ vĩnh viễn trong Cổng Khách Hàng.',
          },
        ];

  const faqs =
    lang === 'en'
      ? [
          {
            q: 'What does ZUPIRUS Quant Lab deliver?',
            a: 'ZUPIRUS Quant Lab publishes independent statistical research studies and PDF reports on XAU/USD market microstructure. We do not connect to broker accounts, manage funds, or execute trades.',
          },
          {
            q: 'Can I preview a report before purchasing?',
            a: 'Yes. Every published report includes a free Sample PDF link and full out-of-sample Walk-Forward tables visible before purchase.',
          },
          {
            q: 'Are there recurring monthly subscriptions?',
            a: 'No. Reports are licensed individually per issue with a single one-time payment in USDT (BEP20 or TRC20).',
          },
          {
            q: 'Where do I download my purchased PDFs?',
            a: 'Sign in to the Customer Portal at /portal/library. Every verified order unlocks instant PDF downloads for that exact version.',
          },
        ]
      : [
          {
            q: 'ZUPIRUS Quant Lab là gì và cung cấp sản phẩm nào?',
            a: 'ZUPIRUS Quant Lab là phòng nghiên cứu định lượng độc lập phát hành ấn phẩm báo cáo PDF chuyên sâu về cấu trúc thị trường Vàng (XAU/USD). Hệ thống không kết nối MT5, không giữ tiền và không đặt lệnh giao dịch thay khách hàng.',
          },
          {
            q: 'Tôi có thể đọc thử trước khi mua không?',
            a: 'Có. Mỗi báo cáo đều có nút mở bản đọc thử PDF miễn phí và bảng phân rã Walk-Forward minh bạch để bạn kiểm tra phương pháp trước khi thanh toán.',
          },
          {
            q: 'Có phải đóng phí duy trì hàng tháng không?',
            a: 'Không. Bạn chỉ mua lẻ từng số báo cáo bạn cần qua USDT (BEP20 hoặc TRC20) và sở hữu vĩnh viễn phiên bản PDF đó.',
          },
          {
            q: 'Sau khi thanh toán xong, tôi tải báo cáo ở đâu?',
            a: 'Ngay khi giao dịch USDT được xác nhận, bản PDF đầy đủ sẽ tự động mở khóa trong mục "Thư viện PDF của tôi" tại Cổng Khách Hàng (/portal/library).',
          },
        ];

  return (
    <LandingLayout onNavigate={onNavigate}>
      {/* SECTION 1: HERO SPLIT */}
      <section id="overview" className="border-b border-slate-800/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Editorial Column */}
          <div className="lg:col-span-6 space-y-6">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
              {t.hero.badge}
            </div>

            <h1 className="text-[clamp(2.15rem,4vw,3.35rem)] font-bold leading-[1.12] tracking-tight text-white">
              {t.hero.title}
            </h1>

            <p className="text-base text-slate-300 leading-relaxed max-w-xl">
              {t.hero.subtitle}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('/portal')}
                className="quant-btn-primary text-sm px-5 py-3"
              >
                <span>{t.hero.ctaPrimary}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <a href="#reports" className="quant-btn-secondary text-sm px-5 py-3">
                <FileText className="h-4 w-4" />
                <span>{t.hero.ctaSecondary}</span>
              </a>
            </div>

            {/* Clean Unboxed Stats Strip */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-slate-800/80">
              <div>
                <div className="font-mono text-xl sm:text-2xl font-bold text-white tabular-nums">142+</div>
                <div className="mt-0.5 text-xs text-slate-400">{t.hero.statAum}</div>
              </div>
              <div>
                <div className="font-mono text-xl sm:text-2xl font-bold text-[#12B5A6] tabular-nums">M15 / H1</div>
                <div className="mt-0.5 text-xs text-slate-400">{t.hero.statLatency}</div>
              </div>
              <div>
                <div className="font-mono text-xl sm:text-2xl font-bold text-amber-300 tabular-nums">120 / 60</div>
                <div className="mt-0.5 text-xs text-slate-400">{t.hero.statShield}</div>
              </div>
            </div>
          </div>

          {/* Right Framed Hero Visual */}
          <div className="lg:col-span-6 space-y-3">
            <div className="aspect-[16/10] w-full rounded-2xl border border-slate-800 bg-[#0B1220] overflow-hidden shadow-2xl relative">
              {!heroImgFailed ? (
                <img
                  src="/images/quant-lab-hero.jpg"
                  alt="ZUPIRUS Quant Lab XAU/USD Microstructure Research"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-[#0B1220]">
                  <div className="font-mono text-xs uppercase tracking-widest text-[#12B5A6]">
                    ZUPIRUS RESEARCH DESK
                  </div>
                  <div className="mt-2 text-lg font-bold text-white">
                    XAU/USD Walk-Forward Quantitative Studies
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400 font-mono">
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <ShieldCheck className="h-4 w-4 text-[#12B5A6]" />
                {lang === 'en' ? 'Independent Web-Only PDF Delivery' : 'Phân phối tài liệu PDF độc lập'}
              </span>
              <span>No MT5 · No Automated Orders</span>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: PUBLISHED RESEARCH CATALOG SHOWCASE */}
      <section id="reports" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 space-y-8">
        <div className="max-w-2xl space-y-2">
          <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'PUBLISHED PUBLICATIONS' : 'ẤN PHẨM ĐÃ PHÁT HÀNH'}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {lang === 'en'
              ? 'Featured Quantitative Research Reports'
              : 'Danh mục báo cáo nghiên cứu định lượng XAU/USD'}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            {lang === 'en'
              ? 'Inspect Walk-Forward out-of-sample metrics and read the public sample PDF below. Sign in to the Customer Portal to purchase and store full editions.'
              : 'Xem trước số liệu kiểm định ngoài mẫu và đọc bản mẫu PDF miễn phí. Đăng nhập Cổng Khách Hàng để mua và lưu trữ bản đầy đủ.'}
          </p>
        </div>

        <QuantReportCatalogAndLibrary
          mode="public"
          onRequireAuth={() => onNavigate('/login')}
        />
      </section>

      {/* SECTION 3: 4-STEP QUANTITATIVE METHODOLOGY */}
      <section id="method" className="border-y border-slate-800/70 bg-[#080D18]/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 space-y-10">
          <div className="max-w-2xl space-y-2">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-amber-300">
              {lang === 'en' ? 'METHODOLOGY' : 'QUY TRÌNH NGHIÊN CỨU'}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {lang === 'en'
                ? 'From raw price microstructure to auditable research PDFs'
                : 'Từ dữ liệu vi cấu trúc đến ấn phẩm định lượng chuẩn hóa'}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {methodSteps.map((item) => (
              <div key={item.step} className="quant-panel p-6 flex flex-col gap-3">
                <span className="font-mono text-sm font-bold text-[#12B5A6]">{item.step}</span>
                <h3 className="text-base font-bold text-white leading-snug">{item.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 4: TRANSPARENT LICENSING & FAQ */}
      <section id="faq" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 space-y-12">
        <div className="quant-panel p-7 sm:p-9 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-2.5">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
              {t.pricing.badge}
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">{t.pricing.title}</h2>
            <p className="text-sm text-slate-300 leading-relaxed">{t.pricing.subtitle}</p>
            <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {lang === 'en' ? 'Free Sample PDF on every study' : 'Bản đọc thử miễn phí cho mọi báo cáo'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {lang === 'en' ? 'Direct USDT (BEP20 / TRC20)' : 'Thanh toán USDT trực tiếp (BEP20 / TRC20)'}
              </span>
            </div>
          </div>
          <div className="lg:col-span-4 flex lg:justify-end">
            <button
              type="button"
              onClick={() => onNavigate('/portal')}
              className="quant-btn-primary text-sm px-6 py-3"
            >
              <span>{t.nav.launchPortal}</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white tracking-tight">{t.pricing.faqTitle}</h2>
          <div className="space-y-3">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="quant-panel overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left cursor-pointer hover:bg-white/[0.02]"
                  >
                    <span className="text-sm font-semibold text-white">{item.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                        isOpen ? 'rotate-180 text-[#12B5A6]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-4 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-slate-800/80 pt-3">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </LandingLayout>
  );
};
