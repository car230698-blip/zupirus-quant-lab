import React from 'react';
import { GUARD_LAYERS } from '../data/landingData';

export interface GuardTopologyDiagramProps {
  selectedLayerIdx: number;
  onSelectLayer: (idx: number) => void;
  scenario?: 'BUY' | 'SELL' | 'NO_SL';
}

export const GuardTopologyDiagram: React.FC<GuardTopologyDiagramProps> = ({
  selectedLayerIdx,
  onSelectLayer,
  scenario = 'BUY',
}) => {
  const isNoSl = scenario === 'NO_SL';

  return (
    <div className="relative flex flex-col justify-between h-full w-full p-4 sm:p-6 bg-[#080E1A] rounded-xl border border-slate-800/80">
      {/* Top Status Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/60 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isNoSl ? 'bg-rose-500 animate-ping' : 'bg-[#12B5A6] animate-pulse'}`} />
          <span className="text-slate-400">TRẠNG THÁI KIỂM TOÁN:</span>
          <strong className={isNoSl ? 'text-rose-400' : 'text-[#12B5A6]'}>
            {isNoSl ? 'BLOCKED · BẢO TOÀN 100% VỐN' : 'PASS · SẴN SÀNG PHÂN PHỐI'}
          </strong>
        </div>
        <span className="text-[11px] text-slate-500 tabular-nums">
          LATENCY: &lt; 0.8ms
        </span>
      </div>

      {/* SVG Topology Pipeline Canvas */}
      <div className="relative my-4 flex-1 flex items-center justify-center">
        <svg
          viewBox="0 0 600 240"
          className="w-full h-auto max-h-56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background Connecting Bus Line */}
          <line
            x1="60"
            y1="120"
            x2="540"
            y2="120"
            stroke="rgba(148, 163, 184, 0.15)"
            strokeWidth="2"
            strokeDasharray="4 4"
          />

          {/* Active Flow Line */}
          <line
            x1="60"
            y1="120"
            x2={isNoSl ? '220' : '540'}
            y2="120"
            stroke={isNoSl ? '#F43F5E' : '#12B5A6'}
            strokeWidth="2"
            className="transition-all duration-300"
          />

          {/* 4 Inspection Nodes */}
          {GUARD_LAYERS.map((guard, idx) => {
            const cx = 90 + idx * 140;
            const cy = 120;
            const isSelected = selectedLayerIdx === idx;
            const isBlocked = isNoSl && idx === 1; // Layer 2 blocks missing SL
            const isPassed = !isNoSl || idx < 1;

            return (
              <g
                key={guard.id}
                onClick={() => onSelectLayer(idx)}
                className="cursor-pointer transition-transform duration-200 hover:scale-105"
              >
                {/* Outer Glow Halo for Selected Node */}
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r="34"
                    fill={isBlocked ? 'rgba(244, 63, 94, 0.12)' : 'rgba(18, 181, 166, 0.12)'}
                    stroke={isBlocked ? '#F43F5E' : '#12B5A6'}
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    className="animate-spin-slow"
                  />
                )}

                {/* Node Outer Circle */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="24"
                  fill="#0B1220"
                  stroke={
                    isSelected
                      ? isBlocked
                        ? '#F43F5E'
                        : '#12B5A6'
                      : isBlocked
                      ? '#F43F5E'
                      : isPassed
                      ? 'rgba(18, 181, 166, 0.4)'
                      : 'rgba(148, 163, 184, 0.2)'
                  }
                  strokeWidth="2"
                />

                {/* Node Center State Dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="8"
                  fill={isBlocked ? '#F43F5E' : isPassed ? '#12B5A6' : '#64748B'}
                />

                {/* Top Badge: Layer ID */}
                <text
                  x={cx}
                  y={cy - 36}
                  textAnchor="middle"
                  className={`font-mono text-[11px] font-bold ${
                    isSelected ? 'fill-white' : 'fill-slate-400'
                  }`}
                >
                  LỚP {guard.id}
                </text>

                {/* Bottom Label: Code */}
                <text
                  x={cx}
                  y={cy + 42}
                  textAnchor="middle"
                  className="font-mono text-[9px] fill-slate-500 uppercase tracking-wider"
                >
                  {guard.code.split('_')[0]}
                </text>

                {/* Sub status tag */}
                <text
                  x={cx}
                  y={cy + 55}
                  textAnchor="middle"
                  className={`font-mono text-[9px] font-bold ${
                    isBlocked ? 'fill-rose-400' : isPassed ? 'fill-emerald-400' : 'fill-slate-500'
                  }`}
                >
                  {isBlocked ? 'BLOCKED' : isPassed ? 'PASS' : 'STANDBY'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800/60 font-mono text-xs">
        <div className="text-slate-400">
          Chốt kiểm toán:{' '}
          <span className="text-white font-bold">
            {GUARD_LAYERS[selectedLayerIdx]?.title || '4 Lớp Giáp'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">Quy tắc:</span>
          <code className="text-[#F5B700] bg-[#10192B] px-2 py-0.5 rounded border border-slate-800">
            {GUARD_LAYERS[selectedLayerIdx]?.rule}
          </code>
        </div>
      </div>
    </div>
  );
};
