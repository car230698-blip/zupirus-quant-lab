import React, { useState } from 'react';
import { calculateSubscriptionPricing, type BillingCycle } from '../utils/quantMath';
import { SpotlightBento } from './ui/SpotlightBento';
import { useLanguage } from '../i18n/LanguageContext';

export interface LandingPricingTier {
  id: string;
  code: string;
  name: string;
  badge: string;
  baseUsd: number;
  slots: number;
  popular?: boolean;
  features: string[];
}

export interface LandingPricingAndFaqSectionProps {
  tiers: LandingPricingTier[];
  billingCycle: BillingCycle;
  setBillingCycle: (cycle: BillingCycle) => void;
  currencyMode: 'VND' | 'USD';
  setCurrencyMode: (cur: 'VND' | 'USD') => void;
  usdVndRate: number;
  setQrPreviewTier: (tier: any) => void;
  onEnterPortal: () => void;
}

const FAQ_ITEMS_VI = [
  {
    q: 'ZUPIRUS Quant Lab là gì?',
    a: 'ZUPIRUS Quant Lab là phòng nghiên cứu định lượng độc lập chuyên sâu về vi cấu trúc thị trường Vàng XAU/USD và COMEX Gold. Chúng tôi cung cấp các báo cáo nghiên cứu kiểm định Walk-Forward ngoài mẫu và dữ liệu định lượng chuyên sâu dưới định dạng PDF.',
  },
  {
    q: 'Báo cáo nghiên cứu định lượng có những nội dung gì?',
    a: 'Mỗi ấn phẩm bao gồm giả thuyết thị trường, mô hình chi phí ma sát thực tế (Spread, Commission, Slippage), phân phối lợi nhuận theo phiên Âu/Mỹ, kiểm định Walk-Forward ngoài mẫu đa chu kỳ và đối soát số liệu minh bạch.',
  },
  {
    q: 'Tôi có cần kết nối MT5, thuê VPS hay chia sẻ mật khẩu môi giới không?',
    a: 'Tuyệt đối không. ZUPIRUS Quant Lab hoạt động hoàn toàn trên nền tảng web. Khách hàng xem danh mục, đọc thử bản Sample miễn phí, đặt mua báo cáo và tải file PDF về thư viện cá nhân mà không cần MT5 hay broker.',
  },
  {
    q: 'Phương thức thanh toán được hỗ trợ là gì?',
    a: 'Hệ thống hỗ trợ thanh toán trực tiếp qua USDT On-Chain (TRC20 & BEP20) về thẳng địa chỉ ví của hệ thống. Giao dịch được xác minh tự động trên smart contract và cấp quyền tải PDF ngay lập tức.',
  },
  {
    q: 'Tôi có thể đọc thử trước khi mua không?',
    a: 'Có. Mỗi ấn phẩm nghiên cứu đều phát hành bản tóm tắt điều hành và bản đọc thử (Sample Preview PDF) miễn phí để bạn kiểm tra phương pháp luận và số liệu trước khi quyết định mua.',
  },
];

const FAQ_ITEMS_EN = [
  {
    q: 'What is ZUPIRUS Quant Lab?',
    a: 'ZUPIRUS Quant Lab is an independent quantitative research lab specializing in XAU/USD and COMEX Gold market microstructure, Walk-Forward statistical optimization, and institutional PDF research publications.',
  },
  {
    q: 'What is included in each quantitative research report?',
    a: 'Each publication contains actionable hypotheses, realistic friction cost models (spread, commission, slippage), session-by-session PnL breakdown (London vs NY), multi-fold Walk-Forward out-of-sample evidence, and complete audit tables.',
  },
  {
    q: 'Do I need MT5, a VPS, or broker credentials?',
    a: 'Never. ZUPIRUS Quant Lab operates entirely via our web platform. You browse research publications, read free sample previews, purchase individual reports, and download versioned PDFs to your personal library.',
  },
  {
    q: 'What payment methods are supported?',
    a: 'Direct on-chain USDT (TRC20 & BEP20) payments are supported. Transactions are automatically verified on official smart contracts with instant digital entitlement unlocking.',
  },
  {
    q: 'Can I preview a report before purchasing?',
    a: 'Yes. Every research publication includes an executive summary and a free downloadable Sample Preview PDF so you can inspect methodologies and evidence before purchasing.',
  },
];

export const LandingPricingAndFaqSection: React.FC<LandingPricingAndFaqSectionProps> = ({
  tiers,
  billingCycle,
  setBillingCycle,
  currencyMode,
  setCurrencyMode,
  usdVndRate,
  setQrPreviewTier,
  onEnterPortal,
}) => {
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const { lang } = useLanguage();

  return (
    <div className="space-y-24">
      {/* SECTION: PRICING MATRIX */}
      <section id="pricing" className="space-y-10">
        <div className="flex flex-col items-center text-center space-y-4">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'TRANSPARENT PRICING · NO HIDDEN FEES' : 'BẢNG PHÍ MINH BẠCH · KHÔNG ẨN PHÍ'}
          </span>
          <h2 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">
            {lang === 'en' ? 'Institutional Quant Publications & Pricing' : 'Ấn Phẩm Nghiên Cứu Định Lượng & Biểu Phí'}
          </h2>
          <p className="text-xs sm:text-sm text-[#94A3B8] max-w-xl">
            {lang === 'en'
              ? 'Purchase individual quantitative research publications with lifetime access and instant versioned PDF downloads.'
              : 'Mua từng ấn phẩm nghiên cứu định lượng với quyền tải vĩnh viễn PDF và dữ liệu kiểm định ngoài mẫu.'}
          </p>

          {/* Billing Cycle & Currency Switcher */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-[#080E1A] p-1 font-mono text-xs">
              {(
                [
                  ['MONTHLY', lang === 'en' ? 'Monthly' : 'Tháng'],
                  ['QUARTERLY', lang === 'en' ? 'Quarterly (-10%)' : 'Quý (-10%)'],
                  ['ANNUAL', lang === 'en' ? 'Annual (-20%)' : 'Năm (-20%)'],
                ] as [BillingCycle, string][]
              ).map(([cycle, label]) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-lg px-3.5 py-1.5 font-medium transition cursor-pointer ${
                    billingCycle === cycle
                      ? 'bg-[#12B5A6] text-[#042F2E] font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-[#080E1A] p-1 font-mono text-xs">
              {(['VND', 'USD'] as const).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setCurrencyMode(cur)}
                  className={`rounded-lg px-3 py-1.5 font-medium transition cursor-pointer ${
                    currencyMode === cur
                      ? 'bg-slate-700 text-white font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3 Tier Cards */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-stretch">
          {tiers.map((tier) => {
            const pricing = calculateSubscriptionPricing(tier.baseUsd, tier.slots, billingCycle, usdVndRate);
            const isPopular = tier.popular;
            return (
              <SpotlightBento
                key={tier.id}
                borderBeam={isPopular}
                className={`p-7 flex flex-col justify-between h-full transition-all ${
                  isPopular
                    ? 'border-[#12B5A6]/80 relative shadow-[0_0_35px_rgba(18,181,166,0.18)]'
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                {isPopular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[#12B5A6] bg-[#060A13] px-3.5 py-0.5 font-mono text-[11px] font-bold text-[#12B5A6] shadow-[0_0_12px_rgba(18,181,166,0.4)]">
                    {lang === 'en' ? 'Most Popular' : 'Phổ Biến Nhất'}
                  </span>
                )}

                <div className="space-y-5">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-[#12B5A6] font-bold">{tier.code}</span>
                    <span className="rounded-md border border-slate-700 bg-[#080E1A] px-2 py-0.5 text-[11px] text-slate-300">
                      {tier.badge}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xl font-bold text-white">{tier.name}</h3>
                    <div className="mt-3 font-mono text-3xl font-extrabold text-white tabular-nums">
                      {currencyMode === 'VND'
                        ? `${pricing.totalVnd.toLocaleString('vi-VN')} ₫`
                        : `$${pricing.totalUsd.toFixed(2)}`}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        / {pricing.months} {lang === 'en' ? (pricing.months > 1 ? 'months' : 'month') : 'tháng'}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-3 border-t border-slate-800/80 pt-5 text-xs text-slate-300">
                    {tier.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                        <span className="text-slate-300 leading-relaxed">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-3 pt-5 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setQrPreviewTier(tier)}
                    className="rounded-xl border border-slate-700 hover:border-slate-500 bg-[#080E1A] py-2.5 text-xs font-medium text-slate-300 hover:text-white transition cursor-pointer"
                  >
                    {lang === 'en' ? 'Payment Preview' : 'Xem Cổng Thanh Toán'}
                  </button>
                  <button
                    type="button"
                    onClick={onEnterPortal}
                    className={`rounded-xl py-2.5 text-xs font-bold transition cursor-pointer ${
                      isPopular
                        ? 'bg-[#12B5A6] text-[#042F2E] hover:bg-[#14C9B8]'
                        : 'border border-[#12B5A6]/50 bg-[#12B5A6]/10 text-[#12B5A6] hover:bg-[#12B5A6]/20'
                    }`}
                  >
                    {lang === 'en' ? 'Activate Now →' : 'Kích Hoạt →'}
                  </button>
                </div>
              </SpotlightBento>
            );
          })}
        </div>
      </section>

      {/* SECTION: ACCORDION FAQ */}
      <section className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 sm:p-10 space-y-8 max-w-3xl mx-auto">
        <div className="text-center space-y-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'TRANSPARENCY & SECURITY' : 'MINH BẠCH & BẢO MẬT'}
          </span>
          <h2 className="text-2xl font-bold text-white">
            {lang === 'en' ? 'Frequently Asked Questions' : 'Câu Hỏi Thường Gặp'}
          </h2>
          <p className="text-xs text-slate-400">
            {lang === 'en'
              ? 'Institutional research methodology with verifiable out-of-sample data.'
              : 'Phương pháp luận nghiên cứu định lượng độc lập với dữ liệu kiểm chứng minh bạch.'}
          </p>
        </div>

        <div className="divide-y divide-slate-800 border-t border-b border-slate-800">
          {(lang === 'en' ? FAQ_ITEMS_EN : FAQ_ITEMS_VI).map((item, idx) => {
            const isOpen = openFaqIdx === idx;
            return (
              <div key={idx} className="py-4">
                <button
                  type="button"
                  onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between text-left text-sm font-semibold text-white hover:text-[#12B5A6] transition cursor-pointer"
                >
                  <span>{item.q}</span>
                  <span className="ml-4 font-mono text-base text-slate-400">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <p className="mt-3 text-xs leading-relaxed text-[#94A3B8] pr-6">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
