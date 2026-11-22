import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

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
  spotPrice = 0,
}) => {
  const { lang, toggleLang, t } = useLanguage();

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-slate-800/80 bg-[#070c18]/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        {/* Left: Logo & Live Price Ticker */}
        <div className="flex items-center gap-4">
          <a href="#top" className="flex items-center gap-2.5 text-decoration-none group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#12B5A6] font-mono text-base font-extrabold text-[#042F2E] shadow-sm">
              Z
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-white group-hover:text-[#12B5A6] transition-colors">
              ZUPIRUS
            </span>
          </a>

          {spotPrice > 0 && (
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-800 bg-[#040814] px-3 py-1 font-mono text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">XAU/USD:</span>
              <strong className="text-amber-300 tabular-nums">${spotPrice.toFixed(2)}</strong>
            </div>
          )}
        </div>

        {/* Center: Clean Navigation Links */}
        <nav aria-label="Điều hướng chính" className="hidden lg:flex items-center gap-7 text-xs font-medium text-slate-300">
          <a href="#pipeline" className="hover:text-white transition-colors">
            {t.nav.shields}
          </a>
          <a href="#track-record" className="hover:text-white transition-colors">
            {t.nav.performance}
          </a>
          <a href="#lot-calculator" className="hover:text-white transition-colors">
            {t.nav.lotCalculator}
          </a>
          <a href="#pricing" className="hover:text-white transition-colors">
            {t.nav.pricing}
          </a>
        </nav>

        {/* Right: Language Switcher + Discord + Login + Primary CTA */}
        <div className="flex items-center gap-2.5">
          {/* Language Toggle Button */}
          <button
            type="button"
            onClick={toggleLang}
            className="flex items-center gap-1 rounded-lg border border-slate-700/80 bg-[#090e1d] px-2.5 py-1.5 font-mono text-[11px] font-bold text-slate-300 hover:border-amber-400/50 hover:text-amber-300 transition cursor-pointer"
            title="Chuyển đổi ngôn ngữ / Switch Language (VI / EN)"
          >
            <span>{lang === 'vi' ? '🇻🇳 VI' : '🇬🇧 EN'}</span>
          </button>

          <a
            href="https://discord.gg/yxCx3dVe34"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[#3b4b7a] bg-[#0c1326] px-3.5 py-2 text-xs font-mono font-bold text-[#8EA1FF] hover:bg-[#5865F2]/20 hover:border-[#5865F2]/50 transition"
            title="Tham gia cộng đồng ZUPIRUS Quant Lab trên Discord"
          >
            <span>{t.nav.discord}</span>
            <span className="text-[11px]">↗</span>
          </a>

          <button
            type="button"
            onClick={onEnterPortal}
            className="text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer px-2"
          >
            {t.nav.login}
          </button>
          <button
            type="button"
            onClick={onEnterPortal}
            className="rounded-lg bg-[#12B5A6] px-3 sm:px-4 py-2 text-xs font-bold text-[#042F2E] hover:bg-[#14C9B8] transition-colors shadow-sm whitespace-nowrap cursor-pointer"
          >
            <span className="hidden sm:inline">{t.nav.launchPortal}</span>
            <span className="sm:hidden">{t.nav.shortPortal}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
