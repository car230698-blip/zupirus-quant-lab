import React, { useMemo } from 'react';
import { useEquityHistory } from '../hooks/useQuantData';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';

export interface EquityHistoryProps {
  days?: number;
  series?: any[];
}

export const EquityHistory: React.FC<EquityHistoryProps> = ({ days = 30, series }) => {
  const { data: fetchedData = [], isLoading } = useEquityHistory(days);
  const data = series && series.length > 0 ? series : fetchedData;

  const chartStats = useMemo(() => {
    const valid = data.filter(
      (p) => Number.isFinite(Number(p.equity ?? p.balance)) && Number.isFinite(Number(p.balance ?? p.equity))
    );
    if (valid.length < 2) return null;

    const equities = valid.map((p) => Number(p.equity ?? p.balance));
    const balances = valid.map((p) => Number(p.balance ?? p.equity));
    const allVals = [...equities, ...balances];
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const span = max - min || 1;

    const firstEq = equities[0];
    const lastEq = equities[equities.length - 1];
    const delta = lastEq - firstEq;
    const deltaPct = firstEq > 0 ? (delta / firstEq) * 100 : 0;

    let peak = equities[0];
    let maxDdPct = 0;
    for (const eq of equities) {
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDdPct) maxDdPct = dd;
    }

    const eqCoords = valid.map((p, idx) => {
      const x = 48 + (idx / Math.max(valid.length - 1, 1)) * 736;
      const y = 192 - ((Number(p.equity ?? p.balance) - min) / span) * 156;
      return { x, y, point: p };
    });

    const balCoords = valid.map((p, idx) => {
      const x = 48 + (idx / Math.max(valid.length - 1, 1)) * 736;
      const y = 192 - ((Number(p.balance ?? p.equity) - min) / span) * 156;
      return { x, y };
    });

    const polyPoints = eqCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const balPolyPoints = balCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPoints = `48,204 ${polyPoints} 784,204`;

    return {
      min,
      max,
      firstEq,
      lastEq,
      delta,
      deltaPct,
      maxDdPct,
      eqCoords,
      polyPoints,
      balPolyPoints,
      areaPoints,
      count: valid.length,
    };
  }, [data]);

  if (isLoading && (!series || series.length === 0)) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-white/[0.06] bg-[#040710]/80 text-xs font-mono uppercase tracking-[0.2em] text-slate-400">
        <span className="inline-block h-2 w-2 rounded-full bg-cyan-400 animate-ping mr-2.5" />
        Đang tải dữ liệu Equity TimescaleDB...
      </div>
    );
  }

  if (!chartStats) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-[#040710]/80 p-6 text-center">
        <div className="text-sm font-semibold text-slate-300">Chưa đủ mẫu dữ liệu Equity ({days} ngày)</div>
        <p className="max-w-md text-xs text-slate-500">
          Hệ thống cần tối thiểu 2 điểm snapshot từ tài khoản MT5 đang hoạt động để dựng đồ thị tăng trưởng.
        </p>
      </div>
    );
  }

  const isPositive = chartStats.delta >= 0;
  const strokeColor = isPositive ? '#06b6d4' : '#f43f5e';
  const lastCoord = chartStats.eqCoords[chartStats.eqCoords.length - 1];

  return (
    <div className="space-y-4" data-testid="equity-chart">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/[0.06] bg-[#040710]/70 px-3.5 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">Equity Hiện Tại</div>
          <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
            ${fmtNum(chartStats.lastEq, 2)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#040710]/70 px-3.5 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">Tăng Trưởng ({days}D)</div>
          <div className={`mt-1 font-mono text-base font-bold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtPnL(chartStats.delta)} ({isPositive ? '+' : ''}{fmtNum(chartStats.deltaPct, 2)}%)
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#040710]/70 px-3.5 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">Biên Độ Cao / Thấp</div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-200 tabular-nums">
            ${fmtNum(chartStats.max, 0)} <span className="text-slate-600">/</span> ${fmtNum(chartStats.min, 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#040710]/70 px-3.5 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">Max Drawdown Kỳ</div>
          <div className="mt-1 font-mono text-base font-bold text-amber-300 tabular-nums">
            -{fmtNum(chartStats.maxDdPct, 2)}%
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#040710]/90 p-3">
        <svg viewBox="0 0 800 225" className="h-60 w-full select-none">
          <defs>
            <linearGradient id="equityAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.32" />
              <stop offset="65%" stopColor={strokeColor} stopOpacity="0.08" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
            <filter id="equityGlow" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {[36, 88, 140, 192].map((y, idx) => {
            const val = chartStats.max - (idx / 3) * (chartStats.max - chartStats.min);
            return (
              <g key={y}>
                <line
                  x1="48"
                  y1={y}
                  x2="784"
                  y2={y}
                  stroke="rgba(148,163,184,0.08)"
                  strokeDasharray="4 4"
                />
                <text
                  x="42"
                  y={y + 3}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  ${fmtNum(val, 0)}
                </text>
              </g>
            );
          })}

          <polygon points={chartStats.areaPoints} fill="url(#equityAreaGrad)" />

          <polyline
            fill="none"
            stroke="rgba(16, 185, 129, 0.45)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            points={chartStats.balPolyPoints}
          />

          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#equityGlow)"
            points={chartStats.polyPoints}
          />

          {lastCoord && (
            <g>
              <circle cx={lastCoord.x} cy={lastCoord.y} r="6" fill={strokeColor} fillOpacity="0.25" />
              <circle cx={lastCoord.x} cy={lastCoord.y} r="3.5" fill={strokeColor} stroke="#03050a" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              Đường Equity Thời Gian Thực
            </span>
            <span className="inline-flex items-center gap-1.5 text-emerald-300/80">
              <span className="h-0.5 w-3 border-b border-dashed border-emerald-400" />
              Đường Balance Cơ Sở
            </span>
          </div>
          <span className="tabular-nums text-slate-500">
            {chartStats.count} mẫu dữ liệu · Khung {days} ngày
          </span>
        </div>
      </div>
    </div>
  );
};
