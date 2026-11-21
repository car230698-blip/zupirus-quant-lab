import React from 'react';

export interface LandingHeaderProps {
  onEnterPortal: () => void;
  spotPrice: number;
  askPrice: number;
  usdVndRate: number;
  quantTheme: 'gold' | 'cyber';
  setQuantTheme: (theme: 'gold' | 'cyber') => void;
}

export const LandingHeader: React.FC<LandingHeaderProps> = ({
  onEnterPortal,
  spotPrice,
  askPrice,
  usdVndRate,
  quantTheme,
  setQuantTheme,
}) => {
  return (
    <>
      {/* Zone 1-3 Strict Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-amber-500/20 bg-[#0B1220]/95 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          {/* Zone 1: Brand Identity */}
          <a href="#top" className="flex items-center gap-3 text-decoration-none group shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-[#12B5A6] p-[1.5px] shadow-[0_0_24px_rgba(245,183,0,0.35)]">
              <div className="flex h-full w-full items-center justify-center rounded-[10.5px] bg-[#040711] font-mono text-lg font-extrabold text-[#F5B700]">
                Z
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-extrabold tracking-tight text-white">
                  ZUPIRUS
                </span>
                <span className="rounded bg-amber-500/20 border border-amber-400/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                  QUANT OS v4.0
                </span>
              </div>
              <span className="block font-mono text-[10px] tracking-widest text-[#F5B700]/80 uppercase">
                Sovereign XAU/USD &amp; Forex Cloud Engine
              </span>
            </div>
          </a>

          {/* Zone 2: Primary Section Navigation */}
          <nav aria-label="Điều hướng trang chủ" className="hidden lg:flex items-center justify-center gap-4 xl:gap-6 text-[13px] font-medium text-slate-300 min-w-0">
            <a href="#safety-shield" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              4 Lớp Giáp
            </a>
            <a href="#track-record" className="hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0">
              Hiệu Suất
            </a>
            <a href="#pricing" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              Bảng Giá
            </a>
            <a href="/cong-cu/tinh-lot-size-xauusd" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              Tính Lot
            </a>
            <a href="/huong-dan" className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0">
              Hướng Dẫn
            </a>
            <a
              href="https://www.youtube.com/@ZupirusTradingAcademy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-rose-300 hover:text-rose-200 transition-colors whitespace-nowrap shrink-0"
            >
              YouTube ↗
            </a>
            <a
              href="https://discord.gg/yxCx3dVe34"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors whitespace-nowrap shrink-0"
            >
              Discord ↗
            </a>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <button
            type="button"
            onClick={onEnterPortal}
            className="quant-btn-primary px-5 py-2.5 text-xs sm:text-sm whitespace-nowrap shrink-0"
          >
            Mở Cổng Giao Dịch →
          </button>
        </div>
      </header>

      {/* Interactive Multi-Portal Launchpad & Live Telemetry Bar */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 pt-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-[#0B1220]/95 via-[#0d1627]/95 to-[#0B1220]/95 px-4 py-3 font-mono text-xs shadow-[0_12px_36px_rgba(0,0,0,0.6)]">
          <div className="flex flex-wrap items-center gap-3 text-slate-300 tabular-nums">
            <span className="inline-flex items-center gap-2 rounded-lg bg-amber-500/15 border border-amber-400/35 px-2.5 py-1 font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              XAU/USD SPOT: {spotPrice > 0 ? `$${spotPrice.toFixed(2)} / $${askPrice.toFixed(2)}` : 'Đang kết nối...'}
            </span>
            <span className="hidden sm:inline text-emerald-400 font-semibold">
              London G2 Bridge: 24ms
            </span>
            <span aria-hidden="true" className="hidden md:inline text-slate-600">·</span>
            <span className="hidden md:inline text-slate-300">
              Tỷ giá SePay: <strong className="text-amber-300">{usdVndRate.toLocaleString('vi-VN')}₫/USD</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#040711] p-1 text-[10px]">
              <button
                type="button"
                onClick={() => setQuantTheme('gold')}
                className={`rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
                  quantTheme === 'gold' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                SOVEREIGN GOLD
              </button>
              <button
                type="button"
                onClick={() => setQuantTheme('cyber')}
                className={`rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
                  quantTheme === 'cyber' ? 'bg-[#12B5A6] text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                CYBER MATRIX
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
