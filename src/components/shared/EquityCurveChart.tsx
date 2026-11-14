import React, { useState } from 'react';
import { EquityCurvePoint, REGIME_LABELS_VI } from '../../quant/types.ts';
import {
  formatPct,
  formatSignedUsd,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { EmptyDataNotice } from './UiPrimitives.tsx';

export interface EquityCurveChartProps {
  points: EquityCurvePoint[];
  initialBalance: number;
  lastUpdatedSystemTime?: string | null;
}

export const EquityCurveChart: React.FC<EquityCurveChartProps> = ({
  points,
  initialBalance,
  lastUpdatedSystemTime,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <EmptyDataNotice
        title="Chưa có điểm dữ liệu trên đường cong vốn"
        reasonVi="Đường cong Equity & Balance sẽ tự động vẽ ngay khi nến M15 đầu tiên đóng và được bộ điều phối xử lý."
        lastUpdatedIso={lastUpdatedSystemTime}
      />
    );
  }

  const width = 920;
  const height = 230;
  const padLeft = 68;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 30;

  const allValues = [
    initialBalance,
    ...points.map((p) => p.equityUsd),
    ...points.map((p) => p.balanceUsd),
  ];
  const minVal = Math.min(...allValues) - 18;
  const maxVal = Math.max(...allValues) + 18;
  const range = Math.max(1, maxVal - minVal);

  const toX = (idx: number) => {
    if (points.length <= 1) return padLeft + (width - padLeft - padRight) / 2;
    return padLeft + (idx / (points.length - 1)) * (width - padLeft - padRight);
  };

  const toY = (val: number) => {
    return (
      height -
      padBottom -
      ((val - minVal) / range) * (height - padTop - padBottom)
    );
  };

  const equityPolyline = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(p.equityUsd).toFixed(1)}`)
    .join(' ');

  const balancePolyline = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(p.balanceUsd).toFixed(1)}`)
    .join(' ');

  // Gradient area points for Equity
  const firstX = toX(0).toFixed(1);
  const lastX = toX(points.length - 1).toFixed(1);
  const bottomY = (height - padBottom).toFixed(1);
  const equityAreaPoints = `${firstX},${bottomY} ${equityPolyline} ${lastX},${bottomY}`;

  const baselineY = toY(initialBalance);
  const latestPoint = points[points.length - 1];
  const isNetPositive = latestPoint.equityUsd >= initialBalance;
  const activeIdx =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < points.length
      ? hoveredIdx
      : points.length - 1;
  const inspectedPoint = points[activeIdx];
  const inspectedX = toX(activeIdx);
  const inspectedEquityY = toY(inspectedPoint.equityUsd);

  return (
    <div className="space-y-3">
      {/* Interactive Tooltip / Point Readout Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-[#080d1a] border border-[#1e293b] text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-cyan-400">
            {hoveredIdx !== null ? 'Mốc đang xem:' : 'Mốc mới nhất:'}
          </span>
          <span className="font-mono tabular-nums text-slate-200">
            {formatUtcShort(inspectedPoint.marketTime)}
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-300">
            {REGIME_LABELS_VI[inspectedPoint.regime]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
          <span>
            <span className="text-slate-400">Số dư: </span>
            <span className="text-cyan-400 font-bold">
              {formatUsd(inspectedPoint.balanceUsd)}
            </span>
          </span>
          <span>
            <span className="text-slate-400">Vốn: </span>
            <span
              className={`font-bold ${
                inspectedPoint.equityUsd >= initialBalance
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {formatUsd(inspectedPoint.equityUsd)}
            </span>
          </span>
          <span>
            <span className="text-slate-400">P&amp;L: </span>
            <span
              className={`font-bold ${
                inspectedPoint.equityUsd - initialBalance >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {formatSignedUsd(inspectedPoint.equityUsd - initialBalance)}
            </span>
          </span>
          <span>
            <span className="text-slate-400">Sụt giảm: </span>
            <span className="text-rose-400 font-bold">
              {formatPct(inspectedPoint.drawdownPct)}
            </span>
          </span>
        </div>
      </div>

      {/* SVG Interactive Chart */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[540px] h-60 bg-[#080d1a] rounded-xl border border-[#1e293b] select-none shadow-inner"
          onMouseLeave={() => setHoveredIdx(null)}
          role="img"
          aria-label="Biểu đồ đường cong vốn Equity và Balance theo chu kỳ nến M15"
        >
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.32" />
              <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Grid lines */}
          <line
            x1={padLeft}
            y1={padTop}
            x2={width - padRight}
            y2={padTop}
            stroke="#162035"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={baselineY}
            x2={width - padRight}
            y2={baselineY}
            stroke="#263859"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={height - padBottom}
            x2={width - padRight}
            y2={height - padBottom}
            stroke="#162035"
            strokeWidth="1"
          />

          {/* Y-axis labels */}
          <text
            x={padLeft - 10}
            y={padTop + 4}
            textAnchor="end"
            className="fill-slate-500 text-[10px] font-mono tabular-nums"
          >
            ${maxVal.toFixed(0)}
          </text>
          <text
            x={padLeft - 10}
            y={baselineY + 3}
            textAnchor="end"
            className="fill-slate-400 font-semibold text-[10px] font-mono tabular-nums"
          >
            ${initialBalance.toFixed(0)}
          </text>
          <text
            x={padLeft - 10}
            y={height - padBottom}
            textAnchor="end"
            className="fill-slate-500 text-[10px] font-mono tabular-nums"
          >
            ${minVal.toFixed(0)}
          </text>

          {/* Area under equity curve */}
          <polygon
            points={equityAreaPoints}
            fill="url(#equityFill)"
          />

          {/* Curves */}
          <polyline
            points={balancePolyline}
            fill="none"
            stroke="#0284c7"
            strokeWidth="1.75"
            strokeDasharray="4 3"
          />
          <polyline
            points={equityPolyline}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2.5"
            filter="url(#glow)"
          />

          {/* Crosshair & active point inspection */}
          <line
            x1={inspectedX}
            y1={padTop}
            x2={inspectedX}
            y2={height - padBottom}
            stroke="#06b6d4"
            strokeOpacity="0.4"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          <circle
            cx={inspectedX}
            cy={inspectedEquityY}
            r="4.5"
            fill="#22d3ee"
            stroke="#080d1a"
            strokeWidth="2"
            filter="url(#glow)"
          />

          {/* Invisible interactive hover slices */}
          {points.map((_, i) => {
            const curX = toX(i);
            const sliceW =
              points.length > 1
                ? (width - padLeft - padRight) / (points.length - 1)
                : width;
            return (
              <rect
                key={i}
                x={curX - sliceW / 2}
                y={padTop}
                width={sliceW}
                height={height - padTop - padBottom}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIdx(i)}
              />
            );
          })}
        </svg>
      </div>

      {/* Legend & Instructions */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 pt-1 px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 bg-cyan-400 rounded-full inline-block" />
            <span className="text-slate-300 font-medium">Equity (Vốn thả nổi)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 bg-sky-500 border-t border-dashed border-sky-400 inline-block" />
            <span className="text-slate-300 font-medium">Balance (Số dư đã chốt)</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-500">
          Rê chuột trên biểu đồ để tra cứu từng chu kỳ nến M15
        </div>
      </div>
    </div>
  );
};
