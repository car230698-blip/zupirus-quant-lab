import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { SpotlightBento } from './ui/SpotlightBento';
import { useLanguage } from '../i18n/LanguageContext';

export interface LandingHeroTerminalProps {
  spotPrice?: number;
  askPrice?: number;
  spreadPips?: number;
  onEnterPortal?: () => void;
}

export const LandingHeroTerminal: React.FC<LandingHeroTerminalProps> = ({
  spotPrice = 0,
  onEnterPortal,
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'center center'],
  });

  // Tilted 3D initially (5deg), smoothly flattens to 0deg as user scrolls into view
  const rotateX = useTransform(scrollYProgress, [0, 1], [6, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.985, 1]);
  const opacity = useTransform(scrollYProgress, [0, 1], [0.9, 1]);

  const livePriceStr = spotPrice > 0 ? `$${spotPrice.toFixed(2)}` : 'XAU/USD';

  return (
    <div ref={containerRef} className="perspective-1000 mx-auto w-full max-w-5xl pt-4">
      <motion.div style={{ rotateX, scale, opacity, transformStyle: 'preserve-3d' }}>
        <SpotlightBento borderBeam className="p-0 overflow-hidden shadow-[0_36px_95px_-24px_rgba(0,0,0,0.85)]">
          {/* Top macOS Style Terminal Bar */}
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#070D1C]/90 px-5 py-3.5 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80 inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 inline-block" />
              <span className="ml-2 font-mono text-slate-300">
                app.zupirus.com · Cloud MT5 Bridge
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#12B5A6]">
                <span className="pulse-wrap"><span className="pulse-core" /></span>
                LIVE · 21ms
              </span>
              {onEnterPortal && (
                <button
                  type="button"
                  onClick={onEnterPortal}
                  className="hidden sm:inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-300 hover:text-white transition-colors cursor-pointer ml-2"
                >
                  {t.terminal.enterApp}
                </button>
              )}
            </div>
          </div>

          {/* 4 KPIs Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-white/[0.08] text-left">
            <div className="p-4 sm:p-5 border-r border-b sm:border-b-0 border-white/[0.08] hover:bg-white/[0.02] transition-colors">
              <div className="text-xs text-slate-400 mb-1.5 font-medium">{t.terminal.totalAum}</div>
              <div className="font-mono text-xl sm:text-2xl font-bold text-white tracking-tight tabular-nums">
                $128,450.00
              </div>
              <div className="mt-1 font-mono text-xs text-[#12B5A6]">
                {t.terminal.thirtyDays}
              </div>
            </div>

            <div className="p-4 sm:p-5 border-b sm:border-b-0 lg:border-r border-white/[0.08] hover:bg-white/[0.02] transition-colors">
              <div className="text-xs text-slate-400 mb-1.5 font-medium">{t.terminal.dailyDd}</div>
              <div className="font-mono text-xl sm:text-2xl font-bold text-white tracking-tight tabular-nums">
                0.42% <span className="text-sm font-normal text-slate-400">/ 4.0%</span>
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {t.terminal.safeState}
              </div>
            </div>

            <div className="p-4 sm:p-5 border-r border-white/[0.08] hover:bg-white/[0.02] transition-colors">
              <div className="text-xs text-slate-400 mb-1.5 font-medium">{t.terminal.propShield}</div>
              <div className="font-mono text-xl sm:text-2xl font-bold text-[#12B5A6] tracking-tight tabular-nums">
                1.0% CAP
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {t.terminal.portfolioMax}
              </div>
            </div>

            <div className="p-4 sm:p-5 hover:bg-white/[0.02] transition-colors">
              <div className="text-xs text-slate-400 mb-1.5 font-medium">{t.terminal.scanningAsset}</div>
              <div className="font-mono text-xl sm:text-2xl font-bold text-amber-300 tracking-tight tabular-nums">
                {livePriceStr}
              </div>
              <div className="mt-1 font-mono text-xs text-slate-300">
                EUR · GBP · JPY
              </div>
            </div>
          </div>

          {/* Terminal Body: 2 Columns (1.45fr Chart + 1fr Accounts) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 text-left">
            {/* Left Column: SVG Equity Growth Curve */}
            <div className="lg:col-span-7 p-5 sm:p-6 lg:border-r border-b lg:border-b-0 border-white/[0.08]">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-white">{t.terminal.equityGrowth}</span>
                <span className="font-mono text-xs text-[#12B5A6] font-bold">TABULA RASA · APPROVED</span>
              </div>

              <div className="relative w-full overflow-hidden">
                <svg
                  viewBox="0 0 560 205"
                  className="w-full h-44 sm:h-52"
                  role="img"
                  aria-label={t.terminal.svgAria}
                >
                  <defs>
                    <linearGradient id="heroEqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#12B5A6" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#12B5A6" stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Gridlines */}
                  <line x1="0" y1="45" x2="560" y2="45" stroke="rgba(148,163,184,0.09)" strokeWidth="1" />
                  <line x1="0" y1="100" x2="560" y2="100" stroke="rgba(148,163,184,0.09)" strokeWidth="1" />
                  <line x1="0" y1="155" x2="560" y2="155" stroke="rgba(148,163,184,0.09)" strokeWidth="1" />

                  {/* Area Fill */}
                  <path
                    d="M 10 168 L 75 154 L 140 160 L 205 130 L 270 118 L 335 124 L 405 88 L 475 72 L 548 36 L 548 195 L 10 195 Z"
                    fill="url(#heroEqGrad)"
                  />

                  {/* Bezier Equity Line */}
                  <path
                    d="M 10 168 L 75 154 L 140 160 L 205 130 L 270 118 L 335 124 L 405 88 L 475 72 L 548 36"
                    fill="none"
                    stroke="#12B5A6"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Gold Intermediate Milestones */}
                  <circle cx="205" cy="130" r="4" fill="#F5B700" />
                  <circle cx="405" cy="88" r="4" fill="#F5B700" />

                  {/* Live Endpoint Pulse Dot */}
                  <circle cx="548" cy="36" r="10" fill="rgba(18,181,166,0.22)" />
                  <circle cx="548" cy="36" r="4.5" fill="#12B5A6" stroke="#0B1220" strokeWidth="2" />
                </svg>
              </div>
            </div>

            {/* Right Column: 3 Synced Cloud MT5 Accounts */}
            <div className="lg:col-span-5 p-5 sm:p-6 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between pb-1">
                <span className="text-sm font-semibold text-white">{t.terminal.syncedAccounts}</span>
                <span className="font-mono text-xs text-slate-400">FAIL-CLOSED</span>
              </div>

              <div className="space-y-2.5">
                <div className="group flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#070D1C]/90 p-3.5 transition-all duration-200 hover:border-[#12B5A6]/45 hover:translate-x-1">
                  <div>
                    <div className="text-xs font-bold text-white group-hover:text-[#12B5A6] transition-colors">
                      FTMO $100K · Prop Live
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                      {t.terminal.ftmoRisk}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-[#12B5A6]">0.50 Lot</div>
                    <div className="font-mono text-[10.5px] text-slate-400">21ms</div>
                  </div>
                </div>

                <div className="group flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#070D1C]/90 p-3.5 transition-all duration-200 hover:border-[#12B5A6]/45 hover:translate-x-1">
                  <div>
                    <div className="text-xs font-bold text-white group-hover:text-[#12B5A6] transition-colors">
                      Exness Raw · Standard
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                      {t.terminal.exnessStatus}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-[#12B5A6]">0.25 Lot</div>
                    <div className="font-mono text-[10.5px] text-slate-400">19ms</div>
                  </div>
                </div>

                <div className="group flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#070D1C]/90 p-3.5 transition-all duration-200 hover:border-[#12B5A6]/45 hover:translate-x-1">
                  <div>
                    <div className="text-xs font-bold text-white group-hover:text-[#12B5A6] transition-colors">
                      IC Markets · Cent (USC)
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                      {t.terminal.icMarketsSub}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-[#12B5A6]">0.10 Lot</div>
                    <div className="font-mono text-[10.5px] text-slate-400">24ms</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SpotlightBento>
      </motion.div>
    </div>
  );
};
