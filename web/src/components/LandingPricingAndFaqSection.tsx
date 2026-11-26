import React, { useState } from 'react';
import type { BillingCycle } from '../utils/quantMath';
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
    q: 'ZUPIRUS có vào lệnh giúp tôi không?',
    a: 'Không. ZUPIRUS xuất bản nghiên cứu thống kê dưới dạng PDF. Bạn tự đọc, tự quyết định và tự chịu rủi ro trên tài khoản của mình nếu bạn giao dịch.',
  },
  {
    q: 'Số liệu trong PDF có phải lợi nhuận tôi sẽ nhận không?',
    a: 'Không. Mọi bảng là mô tả một mẫu dữ liệu quá khứ với tham số được ghi lại. Đổi mẫu hoặc đổi chi phí là số sẽ đổi. Không có cam kết lợi nhuận.',
  },
  {
    q: 'Bản đọc thử và bản đầy đủ khác nhau thế nào?',
    a: 'Bản đọc thử nêu dữ liệu, phạm vi và tuyên bố rủi ro. Bản đầy đủ có bảng, biểu đồ và đường đi lịch sử của quy tắc minh họa.',
  },
  {
    q: 'Thanh toán bằng gì?',
    a: 'Ấn phẩm đã xuất bản thanh toán bằng USDT trên BEP20 hoặc TRC20 tới ví do quản trị viên cấu hình. Sau khi giao dịch được đối soát, thư viện mở liên kết tải có thời hạn.',
  },
  {
    q: 'File tải về có gắn tên người mua không?',
    a: 'Với ấn phẩm bật watermark, bản tải thêm một trang ghi email người mua và phiên bản đã mua. Trang đó dành cho người mua, không dùng để phát tán lại.',
  },
];

const FAQ_ITEMS_EN = [
  {
    q: 'Does ZUPIRUS place trades for me?',
    a: 'No. ZUPIRUS publishes statistical studies as PDFs. You read them, you decide, and you carry the risk if you trade on your own account.',
  },
  {
    q: 'Are the figures in a PDF the profit I will make?',
    a: 'No. Every table describes one historical sample under the parameters that are written down. Change the sample or the cost and the figures change. There is no profit promise.',
  },
  {
    q: 'What is the difference between the preview and the full note?',
    a: 'The preview states the data, the scope, and the risk disclaimer. The full note adds the tables, the charts, and the historical path of the illustrative rule.',
  },
  {
    q: 'How do I pay?',
    a: 'A published guide is paid in USDT on BEP20 or TRC20 to the wallet the administrator configured. After the transfer is matched, the library opens a time-limited download.',
  },
  {
    q: 'Is the download marked with my name?',
    a: 'When watermarking is on, the file you download adds a page with your email and the version you bought. That copy is for you, not for redistribution.',
  },
];

export const LandingPricingAndFaqSection: React.FC<LandingPricingAndFaqSectionProps> = ({
  tiers,
  billingCycle: _billingCycle,
  setBillingCycle: _setBillingCycle,
  currencyMode,
  setCurrencyMode,
  usdVndRate,
  setQrPreviewTier: _setQrPreviewTier,
  onEnterPortal,
}) => {
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const { lang } = useLanguage();
  void _billingCycle;
  void _setBillingCycle;
  void _setQrPreviewTier;

  return (
    <div className="space-y-24">
      {/* SECTION: PRICING MATRIX */}
      <section id="pricing" className="space-y-10">
        <div className="flex flex-col items-center text-center space-y-4">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'TRANSPARENT PRICING · NO HIDDEN FEES' : 'BẢNG PHÍ MINH BẠCH · KHÔNG ẨN PHÍ'}
          </span>
          <h2 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">
            {lang === 'en' ? 'PDF guides, priced one at a time' : 'Ấn phẩm PDF, tính giá từng cuốn'}
          </h2>
          <p className="text-xs sm:text-sm text-[#94A3B8] max-w-xl">
            {lang === 'en'
              ? 'Prices below are examples until the owner publishes a guide. Payment is USDT on BEP20 or TRC20. Nothing here is a profit promise.'
              : 'Mức giá bên dưới là ví dụ cho đến khi chủ sở hữu xuất bản một ấn phẩm. Thanh toán bằng USDT trên BEP20 hoặc TRC20. Không có cam kết lợi nhuận.'}
          </p>

          {/* Currency switcher only — guides are one-time purchases, not subscriptions. */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
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
                        ? `${Math.round(tier.baseUsd * usdVndRate).toLocaleString('vi-VN')} ₫`
                        : `$${tier.baseUsd.toFixed(2)}`}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        / {lang === 'en' ? 'guide' : 'ấn phẩm'}
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

                <div className="mt-8 grid grid-cols-1 gap-3 pt-5 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={onEnterPortal}
                    className={`rounded-xl py-2.5 text-xs font-bold transition cursor-pointer ${
                      isPopular
                        ? 'bg-[#12B5A6] text-[#042F2E] hover:bg-[#14C9B8]'
                        : 'border border-[#12B5A6]/50 bg-[#12B5A6]/10 text-[#12B5A6] hover:bg-[#12B5A6]/20'
                    }`}
                  >
                    {lang === 'en' ? 'Open library →' : 'Mở thư viện →'}
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
              ? 'Studies describe the past. They do not promise a future result.'
              : 'Nghiên cứu mô tả quá khứ. Không hứa một kết quả trong tương lai.'}
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
