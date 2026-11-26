import React from 'react';
import { useLanguage } from '../../i18n/LanguageContext';

export const LandingKnowledgeHub: React.FC = () => {
  const { lang } = useLanguage();

  return (
    <div className="pt-8 border-t border-slate-800/80 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-white">
            {lang === 'en'
              ? 'Quantitative Methodology & Market Microstructure Guides'
              : 'Tài liệu phương pháp & chuyên khảo định lượng chuyên sâu'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {lang === 'en'
              ? 'Institutional whitepapers on Walk-Forward testing, friction drag, and session expectancy.'
              : 'Các bài viết phân tích chi tiết về kiểm định Walk-Forward, chi phí ma sát và phân hóa phiên giao dịch.'}
          </p>
        </div>
        <a
          href={lang === 'en' ? '/en/guides' : '/huong-dan'}
          className="font-mono text-xs font-semibold text-[#12B5A6] hover:underline inline-flex items-center gap-1"
        >
          {lang === 'en' ? 'View Knowledge Hub →' : 'Xem toàn bộ tài liệu →'}
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a
          href={
            lang === 'en'
              ? '/en/guides/quantitative-research-xauusd-m15-breakout-retest'
              : '/huong-dan/nghien-cuu-dinh-luong-vang-xauusd-m15'
          }
          className="group p-4 rounded-xl border border-slate-800/80 bg-[#060A13] hover:border-[#12B5A6]/50 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold text-[#12B5A6] uppercase tracking-wider">
              XAU/USD M15
            </span>
            <span className="text-[11px] text-slate-500 font-mono">6 min</span>
          </div>
          <div className="mt-2 text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
            {lang === 'en'
              ? 'Breakout & Retest XAU/USD M15 Out-of-Sample Quantitative Research'
              : 'Nghiên cứu định lượng Breakout & Retest XAU/USD M15 ngoài mẫu'}
          </div>
          <div className="mt-1 text-xs text-slate-400 line-clamp-2">
            {lang === 'en'
              ? 'Empirical validation across rolling windows and post-cost expectancy breakdown.'
              : 'Kiểm định toán học đa cửa sổ cuốn, loại trừ bẫy thanh khoản và kỳ vọng sau phí.'}
          </div>
        </a>

        <a
          href={
            lang === 'en'
              ? '/en/guides/gold-trading-friction-cost-microstructure-model'
              : '/huong-dan/mo-hinh-chi-phi-giao-dich-vang-friction-cost'
          }
          className="group p-4 rounded-xl border border-slate-800/80 bg-[#060A13] hover:border-[#12B5A6]/50 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold text-amber-300 uppercase tracking-wider">
              MICROSTRUCTURE
            </span>
            <span className="text-[11px] text-slate-500 font-mono">7 min</span>
          </div>
          <div className="mt-2 text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
            {lang === 'en'
              ? 'COMEX Gold Transaction Friction Cost Model (Spread, Slippage & Commission)'
              : 'Mô hình chi phí ma sát giao dịch vàng: Khi nào phí triệt tiêu edge lợi nhuận?'}
          </div>
          <div className="mt-1 text-xs text-slate-400 line-clamp-2">
            {lang === 'en'
              ? 'Sensitivity stress-testing matrix across $1.5/oz, $2.5/oz, and $4.0/oz drag tiers.'
              : 'Độ nhạy của Profit Factor trước 3 cấp độ ma sát thực chiến của thị trường.'}
          </div>
        </a>

        <a
          href={
            lang === 'en'
              ? '/en/guides/walk-forward-oos-validation-methodology-gold'
              : '/huong-dan/kiem-dinh-walk-forward-ngoai-mau-comex-gold'
          }
          className="group p-4 rounded-xl border border-slate-800/80 bg-[#060A13] hover:border-[#12B5A6]/50 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
              METHODOLOGY
            </span>
            <span className="text-[11px] text-slate-500 font-mono">8 min</span>
          </div>
          <div className="mt-2 text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
            {lang === 'en'
              ? 'Walk-Forward Out-of-Sample (OOS) Validation Methodology for COMEX Gold'
              : 'Phương pháp kiểm định Walk-Forward ngoài mẫu: Chuẩn mực nghiên cứu vàng'}
          </div>
          <div className="mt-1 text-xs text-slate-400 line-clamp-2">
            {lang === 'en'
              ? 'Eliminating curve-fitting and selection bias through strict holdout isolation.'
              : 'Cách thức loại bỏ quá khớp tham số và ảo tưởng đường cong vốn trong backtest.'}
          </div>
        </a>

        <a
          href={
            lang === 'en'
              ? '/en/guides/session-expectancy-analysis-comex-gold'
              : '/huong-dan/phan-tich-ky-vong-loi-nhuan-theo-phien-gold'
          }
          className="group p-4 rounded-xl border border-slate-800/80 bg-[#060A13] hover:border-[#12B5A6]/50 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">
              SESSION REGIMES
            </span>
            <span className="text-[11px] text-slate-500 font-mono">6 min</span>
          </div>
          <div className="mt-2 text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
            {lang === 'en'
              ? 'Gold Session Expectancy Analysis: Tokyo, London & New York Hours'
              : 'Phân tích kỳ vọng lợi nhuận XAU/USD: Sự khác biệt giữa các phiên giao dịch'}
          </div>
          <div className="mt-1 text-xs text-slate-400 line-clamp-2">
            {lang === 'en'
              ? 'Comparing volatility clustering and win rates across intraday liquidity regimes.'
              : 'Đặc tính thanh khoản và biến động phân khúc theo thời gian UTC của vàng COMEX.'}
          </div>
        </a>
      </div>
    </div>
  );
};
