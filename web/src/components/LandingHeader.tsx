import React from 'react';

export interface LandingHeaderProps {
  onEnterPortal: () => void;
  spotPrice?: number;
  askPrice?: number;
  usdVndRate?: number;
  quantTheme?: 'gold' | 'cyber';
  setQuantTheme?: (theme: 'gold' | 'cyber') => void;
}

export const LandingHeader: React.FC<LandingHeaderProps> = ({
  onEnterPortal,
}) => {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-slate-800/60 bg-[#0B1220]/80 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        {/* Left: Clean ZUPIRUS Logo */}
        <a href="#top" className="flex items-center gap-2.5 text-decoration-none group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#12B5A6] font-mono text-base font-extrabold text-[#042F2E] shadow-sm">
            Z
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white group-hover:text-[#12B5A6] transition-colors">
            ZUPIRUS
          </span>
        </a>

        {/* Center: 4 Clean Links */}
        <nav aria-label="Điều hướng chính" className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          <a href="#safety-shield" className="hover:text-white transition-colors">
            4 Lớp Giáp
          </a>
          <a href="#track-record" className="hover:text-white transition-colors">
            Hiệu Suất
          </a>
          <a href="#lot-calc" className="hover:text-white transition-colors">
            Tính Lot
          </a>
          <a href="#pricing" className="hover:text-white transition-colors">
            Bảng Giá
          </a>
        </nav>

        {/* Right: Login link + Primary CTA */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onEnterPortal}
            className="text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={onEnterPortal}
            className="rounded-lg bg-[#12B5A6] px-4 py-2 text-xs sm:text-sm font-bold text-[#042F2E] hover:bg-[#12B5A6]/90 transition-colors shadow-sm whitespace-nowrap cursor-pointer"
          >
            Mở Cổng Giao Dịch →
          </button>
        </div>
      </div>
    </header>
  );
};
