import { readStrategyDecision } from '../utils/strategyDecision.ts';
import React from 'react';
import { EquityHistory } from './EquityHistory.tsx';

interface UserOverviewTabProps {
  totalBalance: number;
  totalEquity: number;
  totalPositions: number;
  totalPnl: number;
  accounts: any[];
  chartMode: 'equity' | 'candles';
  setChartMode: (mode: 'equity' | 'candles') => void;
  timeframe: 'M1' | 'M5' | 'M15' | 'H1' | 'D1';
  setTimeframe: (tf: 'M1' | 'M5' | 'M15' | 'H1' | 'D1') => void;
  loadCandles: (tf: string) => void;
  selectedAccount: string;
  setSelectedAccount: (accId: string) => void;
  candles: any[];
  series: any[];
  health: any;
}

export const UserOverviewTab: React.FC<UserOverviewTabProps> = ({
  totalBalance,
  totalEquity,
  totalPositions,
  totalPnl,
  accounts,
  chartMode,
  setChartMode,
  timeframe,
  setTimeframe,
  loadCandles,
  selectedAccount,
  setSelectedAccount,
  candles,
  series,
  health,
}) => {
  const liveAccounts = accounts.filter((a: any) => a.server !== 'ZUPIRUS-SYNTHETIC' && a.mode !== 'REPLAY');
  const displayAccounts = liveAccounts.length > 0 ? liveAccounts : accounts;

  const renderCandlestickSvg = () => {
    if (!candles || candles.length === 0) {
      return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-500 font-mono text-xs">
          <span>Chưa có dữ liệu nến cho khung {timeframe}</span>
          <span className="text-[10px] mt-1 text-slate-600">Nguồn: PostgreSQL/TimescaleDB hypertable</span>
        </div>
      );
    }

    const minLow = Math.min(...candles.map((c) => c.low));
    const maxHigh = Math.max(...candles.map((c) => c.high));
    const range = Math.max(maxHigh - minLow, 1.0);
    const width = 800;
    const height = 240;
    const padding = 25;
    const chartH = height - padding * 2;
    const barWidth = Math.max(width / (candles.length * 1.5), 6);

    const yOf = (val: number) => height - padding - ((val - minLow) / range) * chartH;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64 overflow-visible font-mono">
        <line x1={0} x2={width} y1={yOf(maxHigh)} y2={yOf(maxHigh)} stroke="#334155" strokeDasharray="3 3" />
        <line x1={0} x2={width} y1={yOf(minLow)} y2={yOf(minLow)} stroke="#334155" strokeDasharray="3 3" />
        <text x={10} y={yOf(maxHigh) - 4} fill="#64748b" fontSize="10">
          High: ${maxHigh.toFixed(2)}
        </text>
        <text x={10} y={yOf(minLow) + 12} fill="#64748b" fontSize="10">
          Low: ${minLow.toFixed(2)}
        </text>

        {candles.map((c, i) => {
          const x = padding + (i / Math.max(candles.length - 1, 1)) * (width - padding * 2);
          const isUp = c.close >= c.open;
          const color = isUp ? '#10b981' : '#f43f5e';
          const top = yOf(Math.max(c.open, c.close));
          const bot = yOf(Math.min(c.open, c.close));
          const bodyH = Math.max(bot - top, 2);

          return (
            <g key={i} className="hover:opacity-80 transition-opacity">
              <line x1={x} x2={x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={color} strokeWidth="1.2" />
              <rect x={x - barWidth / 2} y={top} width={barWidth} height={bodyH} fill={color} rx="1" />
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      {/* Metric Summary Cards */}
      <div className="quant-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
          <div className="text-[11px] text-slate-500">Tổng số dư</div>
          <div className="text-xl font-bold text-slate-100 mt-1">${totalBalance.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500 mt-1">{displayAccounts.length} tài khoản thực tế</div>
        </div>

        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
          <div className="text-[11px] text-slate-500">Vốn thả nổi</div>
          <div className="text-xl font-bold text-cyan-300 mt-1">${totalEquity.toLocaleString()}</div>
          <div className={`text-[10px] mt-1 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : `${totalPnl.toFixed(2)}`} P&L thả nổi
          </div>
        </div>

        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
          <div className="text-[11px] text-slate-500">Vị thế đang mở</div>
          <div className="text-xl font-bold text-slate-100 mt-1">{totalPositions}</div>
          <div className="text-[10px] text-slate-400 mt-1">Trên các tài khoản MT5 kết nối</div>
        </div>

        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
          <div className="text-[11px] text-slate-500">Đang bật sao chép</div>
          <div className="text-xl font-bold text-cyan-300 mt-1">{displayAccounts.filter((account: any) => account.enabled).length}</div>
          <div className="text-[10px] text-slate-400 mt-1">Tài khoản đã kích hoạt</div>
        </div>
      </div>

      {/* Market Chart */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-200">
              {chartMode === 'candles'
                ? `Biểu đồ nến XAU/USD · Khung ${timeframe} (${
                    timeframe === 'M15' ? '15 phút' : timeframe === 'M1' ? '1 phút' : timeframe === 'M5' ? '5 phút' : timeframe === 'H1' ? '1 giờ' : '1 ngày'
                  })`
                : 'Lịch sử vốn'}
            </span>
            {chartMode === 'candles' && (
              <span className="rounded bg-slate-800/90 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                Nguồn dữ liệu: TimescaleDB Live Hypertable (XAU/USD Real-Time Market Feed)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {chartMode === 'equity' && displayAccounts.length > 0 && (
              <select
                aria-label="Tài khoản hiển thị"
                className="quant-chart-select"
                value={selectedAccount}
                onChange={(event) => setSelectedAccount(event.target.value)}
              >
                {displayAccounts.map((account: any) => (
                  <option key={account.id} value={account.id}>
                    #{account.login} · {account.server}
                  </option>
                ))}
              </select>
            )}
            {chartMode === 'candles' && (
              <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
                {(['M1', 'M5', 'M15', 'H1', 'D1'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => {
                      setTimeframe(tf);
                      loadCandles(tf);
                    }}
                    className={`px-2 py-0.5 rounded ${
                      timeframe === tf ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            )}

            <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
              <button
                onClick={() => setChartMode('equity')}
                className={`px-2 py-0.5 rounded ${
                  chartMode === 'equity' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Vốn
              </button>
              <button
                onClick={() => setChartMode('candles')}
                className={`px-2 py-0.5 rounded ${
                  chartMode === 'candles' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Nến
              </button>
            </div>
          </div>
        </div>

        {chartMode === 'candles' ? (
          <div className="space-y-3">
            {renderCandlestickSvg()}
            {(() => {
                const strat = readStrategyDecision(health?.strategy_last_decision);
                if (!strat) return null;
                const candleTimeStr = strat.candle_time
                  ? new Date(strat.candle_time * 1000).toLocaleTimeString('vi-VN')
                  : 'Chưa ghi nhận';
                return (
                  <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-3 font-mono text-xs flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-cyan-400 font-bold">Phiên bản: {strat.version || 'Chưa ghi nhận'}</span>
                      <span className="text-slate-400">
                        Khung đánh giá: <b className="text-slate-200">{strat.timeframe || timeframe}</b>
                      </span>
                      <span className="text-slate-400">
                        Thời điểm dữ liệu: <b className="text-slate-200">{candleTimeStr}</b>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Lý do:</span>
                      <span className="text-amber-300 font-semibold max-w-md truncate" title={strat.reason}>
                        {strat.reason || 'Chưa ghi nhận'}
                      </span>
                    </div>
                  </div>
                );
              })()}
          </div>
        ) : (
          <EquityHistory samples={series.filter((point: { account_id: string }) => point.account_id === selectedAccount)} />
        )}
      </div>
    </div>
  );
};
