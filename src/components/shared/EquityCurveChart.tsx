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
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-md bg-slate-950/90 border border-slate-800 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-cyan-300">
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
            <span className="text-cyan-300 font-semibold">
              {formatUsd(inspectedPoint.balanceUsd)}
            </span>
          </span>
          <span>
            <span className="text-slate-400">Vốn: </span>
            <span
              className={`font-semibold ${
                inspectedPoint.equityUsd >= initialBalance
                  ? 'text-emerald-300'
                  : 'text-rose-300'
              }`}
            >
              {formatUsd(inspectedPoint.equityUsd)}
            </span>
          </span>
          <span>
            <span className="text-slate-400">P&amp;L: </span>
            <span
              className={
                inspectedPoint.equityUsd - initialBalance >= 0
                  ? 'text-emerald-300'
                  : 'text-rose-300'
              }
            >
              {formatSignedUsd(inspectedPoint.equityUsd - initialBalance)}
            </span>
          </span>
          <span>
            <span className="text-slate-400">Sụt giảm: </span>
            <span className="text-rose-300">
              {formatPct(inspectedPoint.drawdownPct)}
            </span>
          </span>
        </div>
      </div>

      {/* SVG Interactive Chart */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[540px] h-56 bg-slate-950/80 rounded-lg border border-slate-800/90 select-none"
          onMouseLeave={() => setHoveredIdx(null)}
          role="img"
          aria-label="Biểu đồ đường cong vốn Equity và Balance theo chu kỳ nến M15"
        >
          {/* Horizontal reference lines */}
          <line
            x1={padLeft}
            y1={padTop}
            x2={width - padRight}
            y2={padTop}
            stroke="#1e293b"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={baselineY}
            x2={width - padRight}
            y2={baselineY}
            stroke="#475569"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={height - padBottom}
            x2={width - padRight}
            y2={height - padBottom}
            stroke="#1e293b"
            strokeWidth="1"
          />

          {/* Y-axis labels */}
          <text
            x={padLeft - 8}
            y={padTop + 4}
            textAnchor="end"
            className="fill-slate-400 text-[10px] font-mono"
          >
            ${maxVal.toFixed(0)}
          </text>
          <text
            x={padLeft - 8}
            y={baselineY + 3}
            textAnchor="end"
            className="fill-slate-300 text-[10px] font-mono"
          >
            ${initialBalance.toFixed(0)}
          </text>
          <text
            x={padLeft - 8}
            y={height - padBottom}
            textAnchor="end"
            className="fill-slate-400 text-[10px] font-mono"
          >
            ${minVal.toFixed(0)}
          </text>

          {/* Balance line (cyan dashed) */}
          {points.length > 1 && (
            <polyline
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.75"
              strokeDasharray="3 3"
              points={balancePolyline}
            />
          )}

          {/* Equity line (emerald or rose solid) */}
          {points.length > 1 && (
            <polyline
              fill="none"
              stroke={isNetPositive ? '#10b981' : '#f43f5e'}
              strokeWidth="2.4"
              points={equityPolyline}
            />
          )}

          {/* Active crosshair vertical line & point marker */}
          <line
            x1={inspectedX}
            y1={padTop}
            x2={inspectedX}
            y2={height - padBottom}
            stroke="#38bdf8"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <circle
            cx={inspectedX}
            cy={inspectedEquityY}
            r={4.5}
            fill={
              inspectedPoint.equityUsd >= initialBalance ? '#10b981' : '#f43f5e'
            }
            stroke="#0f172a"
            strokeWidth="1.5"
          />

          {/* Invisible hover hit targets per point */}
          {points.map((pt, idx) => {
            const x = toX(idx);
            const sliceWidth =
              points.length > 1
                ? (width - padLeft - padRight) / points.length
                : width - padLeft - padRight;
            return (
              <rect
                key={pt.cycleId}
                x={x - sliceWidth / 2}
                y={padTop}
                width={Math.max(8, sliceWidth)}
                height={height - padTop - padBottom}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIdx(idx)}
              />
            );
          })}

          {/* Legend */}
          <g transform={`translate(${padLeft + 10}, ${height - 10})`}>
            <text className="fill-emerald-400 text-[10px] font-mono">
              ── Equity (Vốn thả nổi)
            </text>
            <text x={155} className="fill-cyan-300 text-[10px] font-mono">
              --- Balance (Số dư đã chốt)
            </text>
            <text x={335} className="fill-slate-400 text-[10px] font-mono">
              Rê chuột trên biểu đồ để tra cứu từng chu kỳ nến M15
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
};
