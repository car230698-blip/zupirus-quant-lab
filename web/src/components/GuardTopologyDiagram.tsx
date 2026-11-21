import React from 'react';
import { GUARD_LAYERS } from '../data/landingData';

export interface GuardTopologyDiagramProps {
  selectedLayerIdx: number;
  onSelectLayer: (idx: number) => void;
  scenario?: 'BUY' | 'SELL' | 'NO_SL' | 'PROP_OVER';
}

export const GuardTopologyDiagram: React.FC<GuardTopologyDiagramProps> = ({
  selectedLayerIdx,
  onSelectLayer,
  scenario = 'BUY',
}) => {
  const isNoSl = scenario === 'NO_SL';
  const isPropOver = scenario === 'PROP_OVER';
  const isBlocked = isNoSl || isPropOver;

  const flowEndX = isNoSl ? 230 : isPropOver ? 460 : 540;
  const flowColor = isNoSl ? '#F43F5E' : isPropOver ? '#F5B700' : '#12B5A6';

  return (
    <div className="relative flex flex-col justify-between h-full w-full p-4 sm:p-6 bg-[#080E1A]/90 rounded-2xl border border-white/10 backdrop-blur-xl">
      {/* Top Status Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.08] font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isBlocked ? 'bg-rose-500 animate-ping' : 'bg-[#12B5A6] animate-pulse'}`} />
          <span className="text-slate-400">TRẠNG THÁI KIỂM TOÁN:</span>
          <strong className={isNoSl ? 'text-rose-400' : isPropOver ? 'text-amber-400' : 'text-[#12B5A6]'}>
            {isNoSl
              ? 'BLOCKED (L2) · THIẾU STOP-LOSS CỨNG'
              : isPropOver
              ? 'BLOCKED (L4) · VƯỢT TRẦN RỦI RO PROP 1.0%'
              : 'PASS · SẴN SÀNG QUẠT LỆNH CLOUD MT5'}
          </strong>
        </div>
        <span className="text-[11px] text-[#12B5A6] font-bold tabular-nums">
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

          {/* Active Animated Flow Line */}
          <line
            x1="60"
            y1="120"
            x2={flowEndX}
            y2="120"
            stroke={flowColor}
            strokeWidth="2.5"
            className="transition-all duration-300 flow-anim"
          />

          {/* 4 Inspection Nodes */}
          {GUARD_LAYERS.map((guard, idx) => {
            const cx = 90 + idx * 140;
            const cy = 120;
            const isSelected = selectedLayerIdx === idx;
            const nodeBlocked = (isNoSl && idx === 1) || (isPropOver && idx === 3);
            const nodePassed = !isBlocked || (isNoSl && idx < 1) || (isPropOver && idx < 3);

            const nodeColor = nodeBlocked ? '#F43F5E' : nodePassed ? '#12B5A6' : '#64748B';

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
                    fill={nodeBlocked ? 'rgba(244, 63, 94, 0.14)' : 'rgba(18, 181, 166, 0.14)'}
                    stroke={nodeBlocked ? '#F43F5E' : '#12B5A6'}
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Node Outer Circle */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="24"
                  fill="#060A13"
                  stroke={isSelected ? (nodeBlocked ? '#F43F5E' : '#12B5A6') : 'rgba(255,255,255,0.12)'}
                  strokeWidth="2"
                />

                {/* Node Center State Dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="8"
                  fill={nodeColor}
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
                    nodeBlocked ? 'fill-rose-400' : nodePassed ? 'fill-emerald-400' : 'fill-slate-500'
                  }`}
                >
                  {nodeBlocked ? 'BLOCKED' : nodePassed ? 'PASS' : 'STANDBY'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.08] font-mono text-xs">
        <div className="text-slate-400">
          Chốt kiểm toán:{' '}
          <span className="text-white font-bold">
            {GUARD_LAYERS[selectedLayerIdx]?.title || '4 Lớp Giáp'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">Quy tắc:</span>
          <code className="text-[#F5B700] bg-[#10192B] px-2 py-0.5 rounded border border-white/10">
            {GUARD_LAYERS[selectedLayerIdx]?.rule}
          </code>
        </div>
      </div>
    </div>
  );
};
