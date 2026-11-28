import React, { useState } from 'react';
import { LandingLayout } from '../../layouts/LandingLayout';
import { useLanguage } from '../../i18n/LanguageContext';
import { LandingKnowledgeHub } from './LandingKnowledgeHub';
import { ArrowRight, ChevronDown, FileText, ShieldCheck, CheckCircle2, Sparkles, Layers } from 'lucide-react';

export interface LandingPageProps {
  onNavigate: (to: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  const { lang, t } = useLanguage();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const methodSteps = lang === 'en' ? [
    { step: '01', title: 'Asia Range Definition (00:00–05:00 UTC)', desc: 'Calculate high/low boundaries across exactly 20 M15 bars on COMEX Gold Futures (GC=F).' },
    { step: '02', title: 'Breakout & Retest Confirmation', desc: 'Bar close outside Asia range, valid retest within 1–8 subsequent bars, entry on next open.' },
    { step: '03', title: 'Fixed-Rule Evaluation', desc: 'Evaluate performance across independent periods with 1.5R profit target, opposite-boundary SL, 32-bar time stop.' },
    { step: '04', title: 'Full Suite Delivery', desc: 'Package comprehensive PDF documentation, empirical trade ledger CSV, and standalone CLI replay engine.' },
  ] : [
    { step: '01', title: 'Xác Định Biên Độ Phiên Á (00:00–05:00 UTC)', desc: 'Đo khung dao động gồm đúng 20 nến M15 trên hợp đồng tương lai vàng COMEX (GC=F).' },
    { step: '02', title: 'Xác Nhận Breakout & Retest', desc: 'Nến đóng ngoài biên, tìm nhịp retest trong 1–8 nến tiếp theo và vào lệnh tại giá mở nến sau retest.' },
    { step: '03', title: 'Kiểm Định Phân Tách Giai Đoạn', desc: 'Đánh giá khách quan theo các giai đoạn độc lập với TP 1,5R, cắt lỗ biên đối diện và tối đa 32 nến.' },
    { step: '04', title: 'Bàn Giao Trọn Bộ Sản Phẩm', desc: 'Báo cáo PDF chuyên sâu, nhật ký giao dịch ledger CSV và công cụ CLI Replay độc lập.' },
  ];

  const faqs = lang === 'en' ? [
    { q: 'What is ZUPIRUS Quant Lab?', a: 'An independent quantitative research platform delivering on-demand retail technical analysis notes and bespoke institutional studies with verifiable trade ledgers.' },
    { q: 'How does bespoke institutional research work?', a: 'You submit a problem or hypothesis. Admin scopes and quotes, worker executes empirical analysis, and deliverables are handed over privately.' },
    { q: 'Are there recurring subscriptions?', a: 'No recurring subscriptions or trading signal channels. Everything is scoped and billed per on-demand delivery.' },
    { q: 'What deliverables are included?', a: 'Institutional orders include comprehensive PDF report, empirical CSV ledger, execution replay scripts, and SHA-256 validation hashes.' },
  ] : [
    { q: 'ZUPIRUS Quant Lab là gì và cung cấp những gì?', a: 'Nền tảng nghiên cứu định lượng độc lập, cung cấp bản phân tích kỹ thuật chuẩn hóa cá nhân và nghiên cứu chuyên sâu theo yêu cầu cho tổ chức.' },
    { q: 'Nghiên cứu riêng cho tổ chức hoạt động thế nào?', a: 'Khách hàng mô tả bài toán, Admin chốt phạm vi và báo giá, hệ thống chạy mô hình định lượng và bàn giao riêng tư gồm PDF, CSV ledger và Replay CLI.' },
    { q: 'Có thu phí thuê bao định kỳ không?', a: 'Không thu phí thuê bao hàng tháng và không vận hành kênh tín hiệu. Chi phí được tính rõ ràng theo từng gói nghiên cứu theo đơn.' },
    { q: 'Khách hàng nhận được những tài liệu nào?', a: 'Bản cá nhân nhận PDF 2-4 trang tối ưu di động. Bản tổ chức nhận báo cáo chuyên sâu 20+ trang, CSV ledger mô phỏng, CLI replay và mã băm SHA-256.' },
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
                onClick={() => onNavigate('/portal?tab=retail')}
                className="quant-btn-primary text-sm px-5 py-3"
              >
                <span>{lang === 'en' ? 'Create Technical Analysis Note' : 'Tạo báo cáo kỹ thuật'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/portal?tab=institutional')}
                className="quant-btn-secondary text-sm px-5 py-3 border border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
              >
                <FileText className="h-4 w-4 text-amber-300" />
                <span>{lang === 'en' ? 'Discuss Bespoke Research Needs' : 'Trao đổi về nhu cầu nghiên cứu'}</span>
              </button>
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
                  {lang === 'en' ? 'REFERENCE SAMPLE STUDY' : 'BẢN MẪU THAM KHẢO'}
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
                  <g stroke="#475569" strokeWidth="1">
                    <line x1="50" y1="70" x2="50" y2="110" /><rect x="46" y="80" width="8" height="20" fill="#334155" rx="1" />
                    <line x1="75" y1="65" x2="75" y2="115" /><rect x="71" y="75" width="8" height="25" fill="#334155" rx="1" />
                    <line x1="100" y1="60" x2="100" y2="120" /><rect x="96" y="70" width="8" height="30" fill="#334155" rx="1" />
                    <line x1="125" y1="80" x2="125" y2="135" stroke="#F43F5E" /><rect x="121" y="90" width="8" height="35" fill="#F43F5E" rx="1" />
                  </g>
                  <g stroke="#12B5A6" strokeWidth="1.2">
                    <line x1="190" y1="120" x2="190" y2="160" stroke="#F43F5E" /><rect x="186" y="125" width="8" height="20" fill="#F43F5E" rx="1" />
                    <line x1="220" y1="70" x2="220" y2="165" strokeWidth="1.5" /><rect x="216" y="70" width="8" height="30" fill="#12B5A6" rx="1" />
                    <polygon points="220,172 216,164 224,164" fill="#38BDF8" />
                    <line x1="250" y1="55" x2="250" y2="105" /><rect x="246" y="55" width="8" height="35" fill="#12B5A6" rx="1" />
                    <line x1="280" y1="45" x2="280" y2="90" /><rect x="276" y="45" width="8" height="30" fill="#12B5A6" rx="1" />
                    <line x1="370" y1="35" x2="370" y2="80" /><rect x="366" y="35" width="8" height="35" fill="#12B5A6" rx="1" />
                    <line x1="400" y1="25" x2="400" y2="70" /><rect x="396" y="25" width="8" height="35" fill="#12B5A6" rx="1" />
                    <line x1="435" y1="20" x2="435" y2="60" strokeWidth="1.5" /><rect x="431" y="20" width="8" height="30" fill="#12B5A6" rx="1" />
                    <line x1="470" y1="15" x2="470" y2="55" strokeWidth="1.5" /><rect x="466" y="15" width="8" height="30" fill="#12B5A6" rx="1" />
                  </g>
                  <polygon points="30,170 80,165 140,168 200,162 230,135 290,105 380,65 440,40 500,25 500,170" fill="url(#heroEquityGrad)" />
                  <polyline fill="none" stroke="#12B5A6" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" points="30,170 80,165 140,168 200,162 230,135 290,105 380,65 440,40 500,25" />
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

      {/* SECTION: VALUE PROPOSITION - KHÁCH CUNG CẤP GÌ, NHẬN ĐƯỢC GÌ, BƯỚC TIẾP THEO */}
      <section className="border-b border-slate-800/70 bg-slate-900/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="text-center max-w-2xl mx-auto mb-8 space-y-2">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
              {lang === 'en' ? 'ON-DEMAND RESEARCH FRAMEWORK' : 'MÔ HÌNH NGHIÊN CỨU THEO YÊU CẦU'}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {lang === 'en' ? 'Clear Inputs, Empirical Deliverables & Private Handoff' : 'Khách cung cấp gì · Nhận được gì · Bước tiếp theo'}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1: Khách cung cấp gì */}
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="w-8 h-8 rounded-lg bg-[#12B5A6]/10 text-[#12B5A6] font-mono font-bold flex items-center justify-center text-sm border border-[#12B5A6]/20">01</div>
              <h3 className="text-base font-bold text-white">Khách hàng cung cấp gì?</h3>
              <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                <li className="flex items-start gap-1.5">
                  <span className="text-[#12B5A6] font-bold">•</span>
                  <span><strong>Khách cá nhân:</strong> Chọn cặp tài sản (XAUUSD, EURUSD, USDJPY), khung nến (H1/H4) và kỳ quan sát.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-amber-400 font-bold">•</span>
                  <span><strong>Khách tổ chức:</strong> Chỉ cần mô tả bài toán cần ra quyết định hoặc rủi ro đang lo ngại. Không cần chọn mã hay phương pháp kỹ thuật.</span>
                </li>
              </ul>
            </div>

            {/* Card 2: Nhận được gì */}
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-300 font-mono font-bold flex items-center justify-center text-sm border border-amber-500/20">02</div>
              <h3 className="text-base font-bold text-white">Nhận được sản phẩm gì?</h3>
              <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                <li className="flex items-start gap-1.5">
                  <span className="text-[#12B5A6] font-bold">•</span>
                  <span><strong>Bản cá nhân:</strong> PDF 2–4 trang tối ưu di động, chốt hướng BUY/SELL/ĐỨNG NGOÀI, vùng S/R, mốc hủy.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-amber-400 font-bold">•</span>
                  <span><strong>Nghiên cứu tổ chức:</strong> PDF chuyên sâu 20+ trang, nhật ký mô phỏng ledger CSV, bộ số liệu metrics JSON, công cụ Replay CLI và mã băm SHA-256.</span>
                </li>
              </ul>
            </div>

            {/* Card 3: Bước tiếp theo */}
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 font-mono font-bold flex items-center justify-center text-sm border border-emerald-500/20">03</div>
              <h3 className="text-base font-bold text-white">Bước tiếp theo & Bàn giao</h3>
              <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Trao đổi & Đính kèm:</strong> Chat hai chiều, gửi ảnh, PDF hoặc CSV trực tiếp với desk nghiên cứu.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Bàn giao riêng tư:</strong> Khách xác nhận đề xuất theo phiên bản, Admin duyệt bàn giao vào thư viện tài khoản, hoàn toàn bảo mật.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: DUAL RESEARCH PRODUCT LANES */}
      <section id="services" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 space-y-8">
        <div className="max-w-2xl space-y-2">
          <div className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'OUR TWO RESEARCH LINES' : 'HAI DÒNG SẢN PHẨM NGHIÊN CỨU'}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {lang === 'en'
              ? 'On-Demand Quantitative Intelligence for Traders & Institutions'
              : 'Nghiên cứu định lượng theo yêu cầu cho cá nhân & tổ chức'}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            {lang === 'en'
              ? 'We do not sell pre-made static PDFs or trading signals. Every report is generated on-demand from real market microstructure and verified empirical engines.'
              : 'ZUPIRUS không bán ấn phẩm PDF tĩnh làm sẵn hay kênh tín hiệu. Mọi báo cáo đều được khởi tạo theo yêu cầu thực tế từ dữ liệu vi cấu trúc và engine kiểm định độc lập.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card A: Phân tích kỹ thuật cá nhân */}
          <div className="p-7 rounded-2xl border border-slate-800 bg-[#0B1220]/80 hover:border-cyan-500/40 transition space-y-5 flex flex-col justify-between shadow-lg">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 text-xs font-mono font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>SẢN PHẨM A · KHÁCH CÁ NHÂN</span>
              </div>
              <h3 className="text-xl font-bold text-white">Bản Phân Tích Kỹ Thuật Chuẩn Hóa</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {lang === 'en'
                  ? 'Select an asset (XAU/USD, EUR/USD), timeframe, and lookback window. The engine generates a clean 2–4 page mobile-optimized PDF note.'
                  : 'Khách hàng tự chọn một mã tài sản (XAU/USD, EUR/USD), một khung nến và kỳ quan sát. Engine tự động phân tích và xuất bản file PDF 2–4 trang tối ưu hiển thị di động.'}
              </p>
              <ul className="text-xs text-slate-400 space-y-2 font-mono">
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Xác định rõ ràng hướng BUY / SELL / ĐỨNG NGOÀI</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Vùng hỗ trợ / kháng cự và mốc hủy kịch bản</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Khởi tạo tự động & Tải về ngay lập tức</span>
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/portal?tab=retail')}
              className="quant-button quant-button-primary w-full py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <span>Tạo Bản Phân Tích Kỹ Thuật</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Card B: Nghiên cứu riêng cho tổ chức */}
          <div className="p-7 rounded-2xl border border-slate-800 bg-[#0B1220]/80 hover:border-amber-500/40 transition space-y-5 flex flex-col justify-between shadow-lg">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 text-xs font-mono font-semibold">
                <Layers className="w-3.5 h-3.5" />
                <span>SẢN PHẨM B · KHÁCH TỔ CHỨC</span>
              </div>
              <h3 className="text-xl font-bold text-white">Nghiên Cứu Định Lượng Theo Yêu Cầu</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Khách hàng mô tả bài toán cần ra quyết định hoặc rủi ro quan tâm. ZUPIRUS đề xuất phạm vi, báo giá hợp đồng, worker tự động chạy và admin duyệt bàn giao bảo mật riêng.
              </p>
              <ul className="text-xs text-slate-400 space-y-2 font-mono">
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Báo cáo PDF chuyên sâu 20+ trang & Ledger CSV</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Công cụ CLI Replay độc lập & Mã băm SHA-256</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Báo giá theo phạm vi từng đơn</span>
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/portal?tab=institutional')}
              className="quant-button quant-button-secondary border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 w-full py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <span>Gửi Bài Toán Nghiên Cứu Tổ Chức</span>
              <ArrowRight className="w-4 h-4 text-amber-400" />
            </button>
          </div>
        </div>
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
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-[#12B5A6]' : ''
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
