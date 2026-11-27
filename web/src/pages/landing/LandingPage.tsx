import React, { useState } from 'react';
import { LandingLayout } from '../../layouts/LandingLayout';
import { QuantReportCatalogAndLibrary } from '../../components/reports/QuantReportCatalogAndLibrary';
import { useLanguage } from '../../i18n/LanguageContext';
import { LandingKnowledgeHub } from './LandingKnowledgeHub';
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
            title: 'Asia Range Definition (00:00–05:00 UTC)',
            desc: 'Calculate high/low boundaries across exactly 20 M15 bars on COMEX Gold Futures (GC=F) continuous contracts.',
          },
          {
            step: '02',
            title: 'Breakout & Retest Confirmation',
            desc: 'Require bar close outside the Asia range, detect valid retest within 1–8 subsequent bars, and enter on the next open.',
          },
          {
            step: '03',
            title: 'Fixed-Rule Sub-Period Evaluation',
            desc: 'Evaluate performance across independent time periods with 1.5R profit target, opposite-boundary SL, and 32-bar time stop.',
          },
          {
            step: '04',
            title: 'Full Suite Delivery',
            desc: 'Package comprehensive PDF documentation, empirical trade ledger CSV, and standalone CLI replay engine for local verification.',
          },
        ]
      : [
          {
            step: '01',
            title: 'Xác Định Biên Độ Phiên Á (00:00–05:00 UTC)',
            desc: 'Đo khung biên độ dao động gồm đúng 20 nến M15 trên hợp đồng tương lai vàng COMEX (GC=F) theo giờ UTC.',
          },
          {
            step: '02',
            title: 'Xác Nhận Breakout & Retest',
            desc: 'Chỉ xác nhận phá vỡ khi nến đóng ngoài biên, tìm nhịp retest trong 1–8 nến tiếp theo và vào lệnh tại giá mở nến sau retest.',
          },
          {
            step: '03',
            title: 'Kiểm Định Phân Tách Giai Đoạn',
            desc: 'Đánh giá khách quan theo các giai đoạn thời gian độc lập với TP 1,5R, cắt lỗ biên đối diện và giới hạn tối đa 32 nến.',
          },
          {
            step: '04',
            title: 'Bàn Giao Trọn Bộ Sản Phẩm',
            desc: 'Đóng gói báo cáo PDF chuyên sâu, nhật ký giao dịch ledger CSV và công cụ CLI Replay độc lập để tự kiểm tra nội bộ.',
          },
        ];

  const faqs =
    lang === 'en'
      ? [
          {
            q: 'What is ZUPIRUS Gold Research Suite v1?',
            a: 'It is an independent quantitative research package focused on the M15 Breakout & Retest strategy on COMEX Gold Futures (GC=F). It includes full research documentation in PDF, empirical trade ledger CSV, and an offline CLI replay engine. We do not connect to broker accounts, manage funds, or execute trades.',
          },
          {
            q: 'How can I review the methodology before requesting trial access?',
            a: 'You can read the free Sample PDF and inspect the dataset identity and performance metrics directly on our public portal. Qualified institutional teams can sign in or request evaluation access.',
          },
          {
            q: 'Are there recurring monthly subscription fees?',
            a: 'No. ZUPIRUS does not charge recurring subscriptions or sell trading signal channels. The product is licensed as a single versioned research suite for an institutional research team.',
          },
          {
            q: 'How does the standalone CLI Replay tool work?',
            a: 'The Replay CLI runs locally with reproducible rules, realistic tick/pip friction models, and strict Asia candle validation. It enables teams to verify results on their internal data without sending proprietary feeds outside.',
          },
        ]
      : [
          {
            q: 'ZUPIRUS Gold Research Suite v1 là gì và cung cấp những gì?',
            a: 'Đây là bộ sản phẩm nghiên cứu định lượng độc lập chuyên sâu về Breakout & Retest vàng COMEX (GC=F) khung M15. Bàn giao gồm báo cáo nghiên cứu PDF, nhật ký giao dịch ledger CSV và bộ công cụ Replay CLI độc lập để tự kiểm định. ZUPIRUS không kết nối tài khoản sàn, không giữ tiền và không giao dịch thay.',
          },
          {
            q: 'Tôi có thể đọc thử tài liệu trước không?',
            a: 'Có. Mỗi ấn phẩm đều có bản đọc thử PDF miễn phí và dữ liệu nghiên cứu công khai. Khách hàng tổ chức có thể đăng nhập hoặc nhận quyền dùng thử độc lập để tự chạy kiểm tra.',
          },
          {
            q: 'Có phải trả phí duy trì hàng tháng không?',
            a: 'Không. ZUPIRUS không thu phí thuê bao định kỳ và không vận hành kênh tín hiệu. Sản phẩm được định vị chuyển giao theo giấy phép nghiên cứu trọn gói cho từng đội ngũ.',
          },
          {
            q: 'Bộ công cụ Replay CLI hoạt động như thế nào?',
            a: 'Công cụ Replay CLI chạy hoàn toàn độc lập trên môi trường của khách hàng, tích hợp đầy đủ mô hình chi phí spread, trượt giá và kiểm tra 20 nến phiên Á. Khách hàng có thể tự do kiểm chứng trên dữ liệu nội bộ mà không cần truyền dữ liệu ra ngoài.',
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
                <div className="font-mono text-xl sm:text-2xl font-bold text-white tabular-nums">GC=F</div>
                <div className="mt-0.5 text-xs text-slate-400">{t.hero.statAum}</div>
              </div>
              <div>
                <div className="font-mono text-xl sm:text-2xl font-bold text-[#12B5A6] tabular-nums">00:00–05:00 UTC</div>
                <div className="mt-0.5 text-xs text-slate-400">{t.hero.statLatency}</div>
              </div>
              <div>
                <div className="font-mono text-xl sm:text-2xl font-bold text-amber-300 tabular-nums">1.5R / 32 Bars</div>
                <div className="mt-0.5 text-xs text-slate-400">{t.hero.statShield}</div>
              </div>
            </div>
          </div>

          {/* Right Framed Hero Visual - Institutional Vector Quant Terminal */}
          <div className="lg:col-span-6 space-y-3">
            <div className="aspect-[16/10] w-full rounded-2xl border border-slate-700/70 bg-gradient-to-br from-[#0B1528] via-[#060B16] to-[#02050A] overflow-hidden shadow-[0_0_50px_-12px_rgba(18,181,166,0.18)] relative flex flex-col justify-between p-4 sm:p-5 select-none">
              {!heroImgFailed && (
                <img
                  src="/images/quant-lab-hero.jpg"
                  alt="ZUPIRUS Quant Lab COMEX Gold Microstructure Research"
                  onError={() => setHeroImgFailed(true)}
                  className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity pointer-events-none"
                />
              )}

              {/* Top Terminal Chrome Bar */}
              <div className="relative z-10 flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                  <span className="ml-2 font-mono text-[11px] font-semibold text-slate-300">
                    COMEX GC=F · M15 · BREAKOUT &amp; RETEST
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#12B5A6]/30 bg-[#12B5A6]/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-[#12B5A6]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#12B5A6] animate-pulse" />
                  EVALUATION SUITE
                </span>
              </div>

              {/* Middle SVG Candlestick & Equity Curve Area */}
              <div className="relative z-10 my-auto py-1">
                <svg className="w-full h-36 sm:h-44 overflow-visible" viewBox="0 0 540 180">
                  <defs>
                    <linearGradient id="heroEquityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#12B5A6" stopOpacity="0.30" />
                      <stop offset="100%" stopColor="#12B5A6" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Grid lines */}
                  <line x1="20" y1="30" x2="520" y2="30" stroke="#1E293B" strokeDasharray="3,3" strokeWidth="1" />
                  <line x1="20" y1="75" x2="520" y2="75" stroke="#1E293B" strokeDasharray="3,3" strokeWidth="1" />
                  <line x1="20" y1="120" x2="520" y2="120" stroke="#1E293B" strokeDasharray="3,3" strokeWidth="1" />

                  {/* Session shading boxes */}
                  <rect x="30" y="50" width="120" height="90" fill="#F59E0B" fillOpacity="0.06" rx="4" />
                  <text x="35" y="44" fill="#F59E0B" fontSize="9" fontFamily="monospace" fontWeight="600">00:00–05:00 UTC ASIA RANGE</text>

                  <rect x="170" y="30" width="160" height="110" fill="#0EA5E9" fillOpacity="0.07" rx="4" />
                  <text x="175" y="24" fill="#38BDF8" fontSize="9" fontFamily="monospace" fontWeight="600">BREAKOUT &amp; RETEST CONFIRMATION</text>

                  <rect x="350" y="20" width="160" height="120" fill="#12B5A6" fillOpacity="0.08" rx="4" />
                  <text x="355" y="14" fill="#12B5A6" fontSize="9" fontFamily="monospace" fontWeight="600">1.5R TARGET / 32-BAR EXIT</text>

                  {/* Stylized candlesticks */}
                  <line x1="50" y1="70" x2="50" y2="110" stroke="#475569" strokeWidth="1" />
                  <rect x="46" y="80" width="8" height="20" fill="#334155" rx="1" />
                  <line x1="75" y1="65" x2="75" y2="115" stroke="#475569" strokeWidth="1" />
                  <rect x="71" y="75" width="8" height="25" fill="#334155" rx="1" />
                  <line x1="100" y1="60" x2="100" y2="120" stroke="#475569" strokeWidth="1" />
                  <rect x="96" y="70" width="8" height="30" fill="#334155" rx="1" />
                  <line x1="125" y1="80" x2="125" y2="135" stroke="#F43F5E" strokeWidth="1" />
                  <rect x="121" y="90" width="8" height="35" fill="#F43F5E" rx="1" />

                  <line x1="190" y1="120" x2="190" y2="160" stroke="#F43F5E" strokeWidth="1.2" />
                  <rect x="186" y="125" width="8" height="20" fill="#F43F5E" rx="1" />
                  <line x1="220" y1="70" x2="220" y2="165" stroke="#12B5A6" strokeWidth="1.5" />
                  <rect x="216" y="70" width="8" height="30" fill="#12B5A6" rx="1" />
                  <polygon points="220,172 216,164 224,164" fill="#38BDF8" />

                  <line x1="250" y1="55" x2="250" y2="105" stroke="#12B5A6" strokeWidth="1.2" />
                  <rect x="246" y="55" width="8" height="35" fill="#12B5A6" rx="1" />
                  <line x1="280" y1="45" x2="280" y2="90" stroke="#12B5A6" strokeWidth="1.2" />
                  <rect x="276" y="45" width="8" height="30" fill="#12B5A6" rx="1" />

                  <line x1="370" y1="35" x2="370" y2="80" stroke="#12B5A6" strokeWidth="1.2" />
                  <rect x="366" y="35" width="8" height="35" fill="#12B5A6" rx="1" />
                  <line x1="400" y1="25" x2="400" y2="70" stroke="#12B5A6" strokeWidth="1.2" />
                  <rect x="396" y="25" width="8" height="35" fill="#12B5A6" rx="1" />
                  <line x1="435" y1="20" x2="435" y2="60" stroke="#12B5A6" strokeWidth="1.5" />
                  <rect x="431" y="20" width="8" height="30" fill="#12B5A6" rx="1" />
                  <line x1="470" y1="15" x2="470" y2="55" stroke="#12B5A6" strokeWidth="1.5" />
                  <rect x="466" y="15" width="8" height="30" fill="#12B5A6" rx="1" />

                  <polygon
                    points="30,170 80,165 140,168 200,162 230,135 290,105 380,65 440,40 500,25 500,170"
                    fill="url(#heroEquityGrad)"
                  />
                  <polyline
                    fill="none"
                    stroke="#12B5A6"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points="30,170 80,165 140,168 200,162 230,135 290,105 380,65 440,40 500,25"
                  />
                  <circle cx="500" cy="25" r="4.5" fill="#12B5A6" stroke="#060A13" strokeWidth="2" />
                </svg>
              </div>

              {/* Bottom Stats Footer inside Terminal */}
              <div className="relative z-10 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-3 text-[11px] font-mono">
                <div>
                  <div className="text-slate-400">TÀI SẢN</div>
                  <div className="text-sm font-bold text-[#12B5A6]">COMEX Gold (GC=F)</div>
                </div>
                <div>
                  <div className="text-slate-400">KHUNG GIỜ</div>
                  <div className="text-sm font-bold text-amber-300">M15 (20 Nến Á)</div>
                </div>
                <div>
                  <div className="text-slate-400">BÀN GIAO</div>
                  <div className="text-sm font-bold text-emerald-400">PDF + Ledger + Replay</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400 font-mono">
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <ShieldCheck className="h-4 w-4 text-[#12B5A6]" />
                {lang === 'en' ? 'Independent Research Suite Delivery' : 'Bàn giao bộ nghiên cứu độc lập'}
              </span>
              <span>No MT5 · Single-Team License</span>
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

          {/* Research & Methodology Articles Knowledge Hub */}
          <LandingKnowledgeHub />
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
