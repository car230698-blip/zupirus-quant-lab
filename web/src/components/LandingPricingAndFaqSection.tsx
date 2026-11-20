import React from 'react';
import { calculateSubscriptionPricing, type BillingCycle } from '../utils/quantMath';
import { TiltCard } from './TiltCard';

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

const FAQ_ITEMS = [
  {
    q: 'ZUPIRUS có giữ tiền nạp của tôi không?',
    a: 'Không. Tiền giao dịch nằm 100% trong tài khoản MT5 tại sàn của bạn (Exness, ICMarkets, FTMO...). ZUPIRUS chỉ kết nối qua MetaApi Cloud để truyền tín hiệu và bảo vệ lệnh.',
  },
  {
    q: 'Mật khẩu MT5 của tôi có an toàn không?',
    a: 'Mật khẩu giao dịch được mã hóa AES-256 trước khi lưu và không bao giờ hiển thị lại dưới dạng văn bản thuần trên bất kỳ giao diện hay log nào.',
  },
  {
    q: 'Tôi dùng tài khoản Cent ($50-$100) có chạy được không?',
    a: 'Có. Hệ thống tự động nhận diện loại tài khoản Cent hay Standard để quy đổi contract size (1.0 vs 100.0) và chia Lot đúng rủi ro % số dư.',
  },
  {
    q: 'Nếu gặp biến động mạnh hoặc mất kết nối sàn thì sao?',
    a: 'Mọi lệnh vào đều có Stop Loss cứng ngay trên máy chủ sàn. Khi phát hiện sụt giảm chạm ngưỡng ngày (4% Quỹ / 5% TK thường), hệ thống tự động đóng lệnh và khóa giao dịch trong ngày.',
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
  return (
    <>
      {/* SECTION 6: SEPAY VIETQR PRICING MATRIX */}
      <section id="pricing" className="space-y-8">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
              SEPAY VIETQR INSTANT ACTIVATION
            </div>
            <h2 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white">
              Biểu Phí Hạ Tầng Đám Mây Cloud MT5
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#050914] p-1 font-mono text-xs">
              {(
                [
                  ['MONTHLY', '1 Tháng'],
                  ['QUARTERLY', '3 Tháng (-10%)'],
                  ['ANNUAL', '12 Tháng (-20%)'],
                ] as [BillingCycle, string][]
              ).map(([cycle, label]) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-lg px-3 py-1.5 font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
                    billingCycle === cycle
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#050914] p-1 font-mono text-xs">
              {(['VND', 'USD'] as const).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setCurrencyMode(cur)}
                  className={`rounded-lg px-2.5 py-1.5 font-bold transition cursor-pointer ${
                    currencyMode === cur ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {tiers.map((tier) => {
            const pricing = calculateSubscriptionPricing(tier.baseUsd, tier.slots, billingCycle, usdVndRate);
            return (
              <TiltCard key={tier.id} className="h-full">
                <div
                  className={`quant-panel p-6 sm:p-7 flex flex-col justify-between h-full ${
                    tier.popular ? 'border-amber-400/55 shadow-[0_0_40px_rgba(245,158,11,0.16)]' : ''
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-amber-300 font-bold">{tier.code}</span>
                      <span className="rounded-lg bg-amber-500/15 border border-amber-400/35 px-2.5 py-0.5 text-[10px] font-bold text-amber-200">
                        {tier.badge}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xl font-extrabold text-white">{tier.name}</h3>
                      <div className="mt-2 font-mono text-3xl font-extrabold text-amber-300 tabular-nums">
                        {currencyMode === 'VND'
                          ? `${pricing.totalVnd.toLocaleString('vi-VN')} ₫`
                          : `$${pricing.totalUsd.toFixed(2)}`}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          / {pricing.months} tháng
                        </span>
                      </div>
                    </div>

                    <ul className="space-y-2.5 border-t border-white/10 pt-4 text-xs text-slate-300">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <span className="text-amber-400 font-bold">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-2.5 pt-4 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setQrPreviewTier(tier)}
                      className="quant-btn-secondary py-2.5 text-xs whitespace-nowrap shrink-0"
                    >
                      Xem Báo Giá Gói
                    </button>
                    <button
                      type="button"
                      onClick={onEnterPortal}
                      className="quant-btn-primary py-2.5 text-xs whitespace-nowrap shrink-0"
                    >
                      Kích Hoạt Ngay →
                    </button>
                  </div>
                </div>
              </TiltCard>
            );
          })}
        </div>
      </section>

      {/* SECTION 6: FAQ & CAM KẾT AN TOÀN */}
      <section className="quant-panel p-6 sm:p-10 space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">
              MINH BẠCH &amp; BẢO MẬT
            </span>
            <h2 className="mt-1 text-2xl font-extrabold text-white">Câu Hỏi Thường Gặp</h2>
          </div>
          <span className="font-mono text-xs text-slate-400">Tiền luôn nằm trên sàn MT5 của riêng bạn</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q} className="rounded-xl border border-white/10 bg-[#040710]/70 p-4 space-y-1.5">
              <div className="font-bold text-amber-200">{item.q}</div>
              <p className="text-slate-300 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-4 text-[11px] text-slate-400 leading-relaxed">
          <strong>Lưu ý rủi ro:</strong> Giao dịch ngoại hối và vàng (XAU/USD) sử dụng đòn bẩy có mức độ rủi ro cao. ZUPIRUS cung cấp hạ tầng tự động hóa và lớp giáp quản trị rủi ro kỹ thuật, không cam kết lợi nhuận cố định.
        </div>
      </section>
    </>
  );
};
