import React from 'react';

export interface FanOutTopologyDiagramProps {
  simSide: 'BUY' | 'SELL' | 'NO_SL';
  simStep: number;
  simRunning: boolean;
  spotPrice: number;
}

export const FanOutTopologyDiagram: React.FC<FanOutTopologyDiagramProps> = ({
  simSide,
  simStep,
  simRunning,
  spotPrice,
}) => {
  const isNoSl = simSide === 'NO_SL';
  const displayPrice = spotPrice > 0 ? `$${spotPrice.toFixed(2)}` : '$2,912.40';

  const strokeColor = isNoSl ? '#F43F5E' : simSide === 'BUY' ? '#12B5A6' : '#06B6D4';
  const pulseFill = isNoSl ? '#F43F5E' : simSide === 'BUY' ? '#F5B700' : '#38BDF8';
  const isStageActive = (step: number) => simStep >= step;

  return (
    <div className="relative flex flex-col justify-between h-full w-full p-4 sm:p-5 bg-[#080E1A] rounded-2xl border border-slate-800/80 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
      {/* Top Telemetry Bar */}
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/60 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isNoSl
                ? 'bg-rose-500 animate-ping'
                : simRunning
                ? 'bg-amber-400 animate-ping'
                : 'bg-[#12B5A6] animate-pulse'
            }`}
          />
          <span className="text-slate-400">SƠ ĐỒ QUẠT LỆNH:</span>
          <strong className={isNoSl ? 'text-rose-400' : 'text-[#12B5A6]'}>
            {isNoSl
              ? 'FAIL-CLOSED · CHẶN TẠI GIÁP #02'
              : simRunning
              ? 'ĐANG PHÂN PHỐI TÍN HIỆU...'
              : 'ĐỒNG BỘ 3 TRẠM CLOUD MT5'}
          </strong>
        </div>
        <span className="text-slate-400 tabular-nums">
          LATENCY: <strong className="text-emerald-400">22ms</strong>
        </span>
      </div>

      {/* Main SVG Topology Canvas */}
      <div className="relative my-2 flex-1 flex items-center justify-center">
        <svg
          viewBox="0 0 520 220"
          className="w-full h-auto max-h-56 select-none"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Glow Filters */}
            <filter id="fanoutTealGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="fanoutRoseGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <linearGradient id="laserGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#F5B700" />
              <stop offset="50%" stopColor="#12B5A6" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
          </defs>

          {/* Background Reference Grid */}
          <line x1="55" y1="110" x2="215" y2="110" stroke="#1E293B" strokeWidth="2" strokeDasharray="4 4" />
          <path d="M 245 100 C 300 100, 310 50, 365 50" stroke="#1E293B" strokeWidth="2" strokeDasharray="4 4" />
          <line x1="245" y1="110" x2="365" y2="110" stroke="#1E293B" strokeWidth="2" strokeDasharray="4 4" />
          <path d="M 245 120 C 300 120, 310 170, 365 170" stroke="#1E293B" strokeWidth="2" strokeDasharray="4 4" />

          {/* Active Flow Line: Ingest to G2 Hub */}
          <line
            x1="80"
            y1="110"
            x2="185"
            y2="110"
            stroke={isNoSl ? '#F43F5E' : 'url(#laserGrad)'}
            strokeWidth="2.5"
            strokeDasharray={simRunning ? '6 3' : 'none'}
            className={simRunning ? 'animate-pulse' : ''}
          />

          {/* Fan-Out Outbound Laser Branches */}
          {!isNoSl ? (
            <>
              {/* Branch 1 to Exness */}
              <path
                d="M 245 100 C 300 100, 310 50, 365 50"
                stroke={strokeColor}
                strokeWidth="2"
                filter="url(#fanoutTealGlow)"
              />
              {/* Branch 2 to FTMO */}
              <line
                x1="245"
                y1="110"
                x2="365"
                y2="110"
                stroke={strokeColor}
                strokeWidth="2"
                filter="url(#fanoutTealGlow)"
              />
              {/* Branch 3 to ICMarkets */}
              <path
                d="M 245 120 C 300 120, 310 170, 365 170"
                stroke={strokeColor}
                strokeWidth="2"
                filter="url(#fanoutTealGlow)"
              />

              {/* Laser Pulses (Animated Moving Orbs) */}
              <circle cx="310" cy="72" r="3" fill={pulseFill} className="animate-ping" />
              <circle cx="305" cy="110" r="3" fill={pulseFill} className="animate-ping" />
              <circle cx="310" cy="148" r="3" fill={pulseFill} className="animate-ping" />
            </>
          ) : (
            <>
              {/* Blocked Barrier Representation */}
              <line x1="245" y1="90" x2="275" y2="90" stroke="#F43F5E" strokeWidth="2" strokeDasharray="3 3" />
              <line x1="245" y1="110" x2="275" y2="110" stroke="#F43F5E" strokeWidth="2" strokeDasharray="3 3" />
              <line x1="245" y1="130" x2="275" y2="130" stroke="#F43F5E" strokeWidth="2" strokeDasharray="3 3" />

              {/* Barrier Wall */}
              <rect
                x="280"
                y="65"
                width="8"
                height="90"
                rx="4"
                fill="#F43F5E"
                filter="url(#fanoutRoseGlow)"
              />
              <text
                x="320"
                y="114"
                fill="#F43F5E"
                fontSize="9"
                fontWeight="800"
                fontFamily="JetBrains Mono, monospace"
              >
                0 DISPATCHED
              </text>
            </>
          )}

          {/* Node 1: Signal Ingest */}
          <g opacity={isStageActive(1) ? 1 : 0.6}>
            <circle cx="55" cy="110" r="26" fill="#0B1220" stroke="#F5B700" strokeWidth="1.5" />
            <circle cx="55" cy="110" r="32" fill="none" stroke="#F5B700" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6" />
            <text x="55" y="105" textAnchor="middle" fill="#F8FAFC" fontSize="8" fontWeight="800" fontFamily="JetBrains Mono, monospace">
              SIGNAL
            </text>
            <text x="55" y="117" textAnchor="middle" fill="#F5B700" fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
              XAU/USD
            </text>
            <text x="55" y="152" textAnchor="middle" fill="#94A3B8" fontSize="8" fontFamily="JetBrains Mono, monospace">
              {displayPrice}
            </text>
          </g>

          {/* Node 2: Central G2 Quantum Shield Hub */}
          <g opacity={isStageActive(2) ? 1 : 0.6}>
            <circle
              cx="215"
              cy="110"
              r="30"
              fill={isNoSl ? '#1A0C14' : '#0A1E26'}
              stroke={isNoSl ? '#F43F5E' : '#12B5A6'}
              strokeWidth="2"
              filter={isNoSl ? 'url(#fanoutRoseGlow)' : 'url(#fanoutTealGlow)'}
            />
            <circle
              cx="215"
              cy="110"
              r="36"
              fill="none"
              stroke={isNoSl ? '#F43F5E' : '#12B5A6'}
              strokeWidth="0.8"
              strokeDasharray="3 3"
              opacity="0.7"
              className="animate-spin-slow"
            />
            <text
              x="215"
              y="105"
              textAnchor="middle"
              fill={isNoSl ? '#FCA5A5' : '#5EEAD4'}
              fontSize="8"
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              {isNoSl ? 'SHIELD #02' : 'LONDON G2'}
            </text>
            <text
              x="215"
              y="117"
              textAnchor="middle"
              fill={isNoSl ? '#F43F5E' : '#12B5A6'}
              fontSize="7"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              {isNoSl ? 'INTERCEPT' : '< 0.8ms AUDIT'}
            </text>
            <text
              x="215"
              y="58"
              textAnchor="middle"
              fill={isNoSl ? '#F43F5E' : '#12B5A6'}
              fontSize="8"
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              {isNoSl ? 'BLOCKED · NO SL' : 'CAPITAL SHIELD PASS'}
            </text>
          </g>

          {/* Broker Target Nodes (Right Side) */}
          {/* Node 3A: Exness Real */}
          <g>
            <rect
              x="365"
              y="32"
              width="145"
              height="36"
              rx="8"
              fill="#0B1220"
              stroke={isNoSl ? 'rgba(244,63,94,0.3)' : 'rgba(18,181,166,0.5)'}
              strokeWidth="1.2"
            />
            <text x="375" y="46" fill="#F8FAFC" fontSize="8.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
              Exness MT5 Real
            </text>
            <text x="375" y="58" fill="#94A3B8" fontSize="7" fontFamily="JetBrains Mono, monospace">
              Standard · 0.25 Lot
            </text>
            <rect
              x="452"
              y="38"
              width="50"
              height="16"
              rx="4"
              fill={isNoSl ? 'rgba(244,63,94,0.15)' : 'rgba(16,185,129,0.15)'}
              stroke={isNoSl ? 'rgba(244,63,94,0.35)' : 'rgba(16,185,129,0.35)'}
              strokeWidth="0.8"
            />
            <text
              x="477"
              y="49"
              textAnchor="middle"
              fill={isNoSl ? '#FCA5A5' : '#6EE7B7'}
              fontSize="6.5"
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              {isNoSl ? 'SAFE' : '22ms · OK'}
            </text>
          </g>

          {/* Node 3B: FTMO Server */}
          <g>
            <rect
              x="365"
              y="92"
              width="145"
              height="36"
              rx="8"
              fill="#0B1220"
              stroke={isNoSl ? 'rgba(244,63,94,0.3)' : 'rgba(18,181,166,0.5)'}
              strokeWidth="1.2"
            />
            <text x="375" y="106" fill="#F8FAFC" fontSize="8.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
              FTMO Server Prop
            </text>
            <text x="375" y="118" fill="#94A3B8" fontSize="7" fontFamily="JetBrains Mono, monospace">
              $100K Live · 0.50 Lot
            </text>
            <rect
              x="452"
              y="98"
              width="50"
              height="16"
              rx="4"
              fill={isNoSl ? 'rgba(244,63,94,0.15)' : 'rgba(16,185,129,0.15)'}
              stroke={isNoSl ? 'rgba(244,63,94,0.35)' : 'rgba(16,185,129,0.35)'}
              strokeWidth="0.8"
            />
            <text
              x="477"
              y="109"
              textAnchor="middle"
              fill={isNoSl ? '#FCA5A5' : '#6EE7B7'}
              fontSize="6.5"
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              {isNoSl ? 'SAFE' : '25ms · OK'}
            </text>
          </g>

          {/* Node 3C: ICMarkets Cent */}
          <g>
            <rect
              x="365"
              y="152"
              width="145"
              height="36"
              rx="8"
              fill="#0B1220"
              stroke={isNoSl ? 'rgba(244,63,94,0.3)' : 'rgba(18,181,166,0.5)'}
              strokeWidth="1.2"
            />
            <text x="375" y="166" fill="#F8FAFC" fontSize="8.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
              ICMarkets SC Cent
            </text>
            <text x="375" y="178" fill="#94A3B8" fontSize="7" fontFamily="JetBrains Mono, monospace">
              Cent USC · 2.50 Cent Lot
            </text>
            <rect
              x="452"
              y="158"
              width="50"
              height="16"
              rx="4"
              fill={isNoSl ? 'rgba(244,63,94,0.15)' : 'rgba(16,185,129,0.15)'}
              stroke={isNoSl ? 'rgba(244,63,94,0.35)' : 'rgba(16,185,129,0.35)'}
              strokeWidth="0.8"
            />
            <text
              x="477"
              y="169"
              textAnchor="middle"
              fill={isNoSl ? '#FCA5A5' : '#6EE7B7'}
              fontSize="6.5"
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              {isNoSl ? 'SAFE' : '24ms · OK'}
            </text>
          </g>
        </svg>
      </div>

      {/* Bottom Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800/60 font-mono text-[10px] text-slate-400">
        <span>CƠ CHẾ: <strong className="text-slate-300">Atomic Fan-Out</strong></span>
        <span>HẠ TẦNG: <strong className="text-slate-300">London Equinix LD4</strong></span>
        <span>ĐỒNG BỘ: <strong className="text-[#12B5A6]">100% Cùng Millisecond</strong></span>
      </div>
    </div>
  );
};
