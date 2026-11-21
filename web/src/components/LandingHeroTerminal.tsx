import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { SpotlightBento } from './ui/SpotlightBento';
import { Activity, ShieldCheck, Zap, Lock } from 'lucide-react';

export interface LandingHeroTerminalProps {
  spotPrice: number;
  askPrice: number;
  spreadPips: number;
  onEnterPortal: () => void;
}

export const LandingHeroTerminal: React.FC<LandingHeroTerminalProps> = ({
  spotPrice,
  askPrice,
  spreadPips,
  onEnterPortal,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'center center'],
  });

  // Tilted 3D initially (5deg), smoothly flattens to 0deg as user scrolls into view
  const rotateX = useTransform(scrollYProgress, [0, 1], [6, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.97, 1]);
  const opacity = useTransform(scrollYProgress, [0, 1], [0.85, 1]);

  const liveBid = spotPrice > 0 ? spotPrice.toFixed(2) : '3,538.86';
  const liveAsk = askPrice > 0 ? askPrice.toFixed(2) : '3,539.14';
  const liveSpread = spreadPips > 0 ? spreadPips.toFixed(1) : '2.8';

  return (
    <div ref={containerRef} className="perspective-1000 mx-auto w-full max-w-5xl pt-4">
      <motion.div style={{ rotateX, scale, opacity, transformStyle: 'preserve-3d' }}>
        <SpotlightBento borderBeam className="p-4 sm:p-7 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)]">
          {/* Top Terminal macOS Chrome Bar */}
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-4 mb-5">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-500/80 inline-block" />
              <span className="h-3 w-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80 inline-block" />
              <span className="ml-2 font-mono text-xs font-semibold text-slate-400">
                ZUPIRUS QUANTUM ORDERFLOW COCKPIT · XAU/USD (M15)
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#12B5A6] bg-[#12B5A6]/10 border border-[#12B5A6]/25 px-2.5 py-0.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-[#12B5A6] animate-pulse" />
                LONDON G2 · 19ms
              </span>
              <button
                type="button"
                onClick={onEnterPortal}
                className="hidden sm:inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-300 hover:text-white transition-colors cursor-pointer"
              >
                Vào Cổng App ↗
              </button>
            </div>
          </div>

          {/* 4 KPIs Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="rounded-xl border border-white/[0.06] bg-[#070D1C]/80 p-3.5">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10.5px]">
                <span>SPOT BID / ASK</span>
                <Activity className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
              </div>
              <div className="mt-2 font-mono text-lg sm:text-xl font-extrabold text-white tabular-nums">
                ${liveBid} <span className="text-xs text-slate-400 font-normal">/ ${liveAsk}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#12B5A6]">
                Spread {liveSpread}p · Overlap Active
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-[#070D1C]/80 p-3.5">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10.5px]">
                <span>4 LỚP GIÁP BẢO VỆ</span>
                <ShieldCheck className="w-3.5 h-3.5 text-[#12B5A6]" strokeWidth={1.75} />
              </div>
              <div className="mt-2 font-mono text-lg sm:text-xl font-extrabold text-[#12B5A6] tabular-nums">
                FAIL-CLOSED
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-400">
                Auto-SL ATR(14) · News Shield
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-[#070D1C]/80 p-3.5">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10.5px]">
                <span>WIN RATE OOS</span>
                <Zap className="w-3.5 h-3.5 text-cyan-400" strokeWidth={1.75} />
              </div>
              <div className="mt-2 font-mono text-lg sm:text-xl font-extrabold text-cyan-300 tabular-nums">
                71.4%
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-400">
                Kiểm định Walk-Forward
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-[#070D1C]/80 p-3.5">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10.5px]">
                <span>TRẦN RỦI RO / Ý TƯỞNG</span>
                <Lock className="w-3.5 h-3.5 text-[#F5B700]" strokeWidth={1.75} />
              </div>
              <div className="mt-2 font-mono text-lg sm:text-xl font-extrabold text-[#F5B700] tabular-nums">
                1.0% MAX
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-400">
                Khóa Redis Idempotency
              </div>
            </div>
          </div>

          {/* SVG Equity Growth Curve + Candlestick Micro-Visualization */}
          <div className="relative rounded-xl border border-white/[0.06] bg-[#040814]/90 p-4 mb-6 overflow-hidden">
            <div className="flex items-center justify-between mb-3 text-xs font-mono">
              <span className="text-slate-300 font-bold flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#12B5A6] animate-pulse" />
                ĐƯỜNG CONG TĂNG TRƯỞNG EQUITY QUỸ PROP (SIMULATED OOS)
              </span>
              <span className="text-emerald-400 font-bold">+14.2% WFO NET</span>
            </div>

            <svg viewBox="0 0 700 130" className="w-full h-28 sm:h-36">
              <defs>
                <linearGradient id="termGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#12B5A6" stop-opacity="0.32" />
                  <stop offset="100%" stop-color="#12B5A6" stop-opacity="0" />
                </linearGradient>
              </defs>

              {/* Grid lines */}
              <line x1="0" y1="30" x2="700" y2="30" stroke="rgba(255,255,255,0.05)" />
              <line x1="0" y1="65" x2="700" y2="65" stroke="rgba(255,255,255,0.05)" />
              <line x1="0" y1="100" x2="700" y2="100" stroke="rgba(255,255,255,0.05)" />

              {/* Shaded Area */}
              <path
                d="M 10 110 L 80 102 L 150 96 L 230 82 L 310 88 L 390 64 L 470 52 L 550 56 L 620 32 L 690 18 L 690 125 L 10 125 Z"
                fill="url(#termGrad)"
              />

              {/* Equity Stroke Line */}
              <path
                d="M 10 110 L 80 102 L 150 96 L 230 82 L 310 88 L 390 64 L 470 52 L 550 56 L 620 32 L 690 18"
                fill="none"
                stroke="#12B5A6"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* End Pulse Dot */}
              <circle cx="690" cy="18" r="8" fill="rgba(18,181,166,0.25)" />
              <circle cx="690" cy="18" r="4" fill="#12B5A6" stroke="#040814" strokeWidth="1.5" />
            </svg>
          </div>

          {/* 3 Synced Cloud MT5 Nodes */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2.5">
              <span>TRẠM CLOUD MT5 ĐỒNG BỘ ĐA TÀI KHOẢN (FAN-OUT ZERO EA)</span>
              <span className="text-[#12B5A6] font-bold">3/3 ACTIVE</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
              <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-[#070D1C] p-3">
                <div>
                  <div className="font-bold text-amber-300">FTMO Prop Live $100K</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">0.50 Lot · Hard SL 35p</div>
                </div>
                <span className="rounded bg-amber-500/15 text-amber-300 px-2 py-0.5 text-[10px] font-bold">
                  25ms
                </span>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-emerald-500/25 bg-[#070D1C] p-3">
                <div>
                  <div className="font-bold text-emerald-300">Exness Raw Spread</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">0.25 Lot · Dynamic BE</div>
                </div>
                <span className="rounded bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                  18ms
                </span>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-cyan-500/25 bg-[#070D1C] p-3">
                <div>
                  <div className="font-bold text-cyan-300">IC Markets Cent Account</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">2.50 Cent Lot · Scale 100x</div>
                </div>
                <span className="rounded bg-cyan-500/15 text-cyan-300 px-2 py-0.5 text-[10px] font-bold">
                  22ms
                </span>
              </div>
            </div>
          </div>
        </SpotlightBento>
      </motion.div>
    </div>
  );
};
