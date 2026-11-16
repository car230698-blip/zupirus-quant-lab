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
        <div className="h-72 flex flex-col items-center justify-center text-slate-500 font-mono text-xs rounded-xl bg-[#070b16] border border-slate-800/80">
          <div className="w-8 h-8 rounded-full bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 mb-2">
            📊
          </div>
          <span className="font-semibold text-slate-400">Đang đồng bộ nến {timeframe} từ TimescaleDB...</span>
          <span className="text-[10px] mt-1 text-slate-600">Luồng nến thực tế XAUUSD 24/5 trực tiếp từ máy chủ MetaApi</span>
        </div>
      );
    }

    const minLow = Math.min(...candles.map((c) => c.low));
    const maxHigh = Math.max(...candles.map((c) => c.high));
    const range = Math.max(maxHigh - minLow, 1.0);
    const width = 900;
    const height = 280;
    const padding = 30;
    const chartH = height - padding * 2;
    const barWidth = Math.max(width / (candles.length * 1.6), 5);

    const yOf = (val: number) => height - padding - ((val - minLow) / range) * chartH;

    return (
      <div className="relative rounded-xl bg-[#060a14] border border-cyan-500/15 p-2 overflow-hidden shadow-inner">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-72 overflow-visible font-mono">
          <defs>
            <linearGradient id="bullGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id="bearGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#e11d48" stopOpacity="0.7" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={0} x2={width} y1={yOf(maxHigh)} y2={yOf(maxHigh)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <line x1={0} x2={width} y1={yOf((maxHigh + minLow) / 2)} y2={yOf((maxHigh + minLow) / 2)} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 2" />
          <line x1={0} x2={width} y1={yOf(minLow)} y2={yOf(minLow)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

          {/* Labels */}
          <text x={12} y={yOf(maxHigh) + 12} fill="#06b6d4" fontSize="10" fontWeight="bold">
            High: ${maxHigh.toFixed(2)}
          </text>
          <text x={12} y={yOf(minLow) - 6} fill="#f43f5e" fontSize="10" fontWeight="bold">
            Low: ${minLow.toFixed(2)}
          </text>

          {/* Candles */}
          {candles.map((c, i) => {
            const x = padding + (i / Math.max(candles.length - 1, 1)) * (width - padding * 2);
            const isUp = c.close >= c.open;
            const strokeColor = isUp ? '#10b981' : '#f43f5e';
            const fillGrad = isUp ? 'url(#bullGradient)' : 'url(#bearGradient)';
            const top = yOf(Math.max(c.open, c.close));
            const bot = yOf(Math.min(c.open, c.close));
            const bodyH = Math.max(bot - top, 2);

            return (
              <g key={i} className="hover:opacity-100 opacity-90 transition-opacity">
                <line x1={x} x2={x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={strokeColor} strokeWidth="1.2" />
                <rect x={x - barWidth / 2} y={top} width={barWidth} height={bodyH} fill={fillGrad} rx="1.5" />
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-6 font-mono">
      {/* High-Tech Bento Summary Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Balance */}
        <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-[#0b1222] to-[#080d19] p-4 shadow-lg hover:border-slate-700 transition-all relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">TỔNG SỐ DƯ (BALANCE)</span>
            <span className="text-xs text-slate-500">USD</span>
          </div>
          <div className="text-2xl font-black text-slate-100 mt-1.5 tabular-nums">
            ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span>{displayAccounts.length} Tài khoản MT5 đang kết nối</span>
          </div>
        </div>

        {/* Metric 2: Equity */}
        <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-[#0c162c] to-[#080d19] p-4 shadow-lg shadow-cyan-950/20 hover:border-cyan-500/40 transition-all relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] text-cyan-300 uppercase tracking-wider font-semibold">VỐN THỰC (EQUITY)</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              totalPnl >= 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'
            }`}>
              {totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : `${totalPnl.toFixed(2)}`} $
            </span>
          </div>
          <div className="text-2xl font-black text-cyan-300 mt-1.5 tabular-nums">
            ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>P&L thả nổi thời gian thực</span>
          </div>
        </div>

        {/* Metric 3: Open Positions */}
        <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-[#0b1222] to-[#080d19] p-4 shadow-lg hover:border-slate-700 transition-all relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">VỊ THẾ ĐANG MỞ</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">RUNTIME</span>
          </div>
          <div className="text-2xl font-black text-slate-100 mt-1.5 tabular-nums">
            {totalPositions} <span className="text-xs text-slate-500 font-normal">lệnh</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="text-cyan-400">🛡️ Auto Break-Even (1R)</span>
          </div>
        </div>

        {/* Metric 4: Auto Trade State */}
        <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-[#0b1222] to-[#080d19] p-4 shadow-lg hover:border-slate-700 transition-all relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">SAO CHÉP ĐÁM MÂY</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1.5 tabular-nums">
            {displayAccounts.filter((account: any) => account.enabled).length} / {displayAccounts.length}
          </div>
          <div className="text-[10px] text-emerald-400/80 mt-2 flex items-center gap-1.5">
            <span>✓ MetaApi Direct Bridge kích hoạt</span>
          </div>
        </div>
      </div>

      {/* Runtime Position Watcher & Safety Shield Status HUD */}
      <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-[#091122] via-[#0c162c] to-[#091122] p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-300 text-base">
              🛡️
            </div>
            <div>
              <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                <span>HỆ THỐNG GIÁM SÁT VỊ THẾ & BẢO VỆ VỐN THỜI GIAN THỰC</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                  LIVE RUNTIME
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-3 mt-1">
                <span className="text-cyan-300">⚡ Auto Break-Even (1R) + Chốt 50% TP1</span>
                <span>·</span>
                <span className="text-purple-300">🛡️ Prop Firm Drawdown Breaker 4.5%</span>
                <span>·</span>
                <span className="text-amber-300">⏰ Weekend Close (Thứ Sáu 21:00 UTC)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>4 Màng Lọc An Toàn: <strong>BẢO VỆ 100%</strong></span>
            </span>
          </div>
        </div>
      </div>

      {/* Market Chart Container */}
      <div className="rounded-2xl border border-slate-800 bg-[#0a101d] p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span className="text-cyan-400">📈</span>
              <span>
                {chartMode === 'candles'
                  ? `Biểu Đồ Nến XAU/USD · Khung ${timeframe}`
                  : 'Lịch Sử Tăng Trưởng Vốn (Equity Curve)'}
              </span>
            </span>
            {chartMode === 'candles' && (
              <span className="hidden sm:inline-block rounded bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 text-[10px] text-cyan-300">
                TimescaleDB Live Feed · 24/5 Tick Stream
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {chartMode === 'equity' && displayAccounts.length > 0 && (
              <select
                aria-label="Tài khoản hiển thị"
                className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 outline-none"
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
              <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs">
                {(['M1', 'M5', 'M15', 'H1', 'D1'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => {
                      setTimeframe(tf);
                      loadCandles(tf);
                    }}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      timeframe === tf
                        ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            )}

            <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs">
              <button
                onClick={() => setChartMode('equity')}
                className={`px-3 py-1 rounded-md transition-all ${
                  chartMode === 'equity'
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Vốn (Equity)
              </button>
              <button
                onClick={() => setChartMode('candles')}
                className={`px-3 py-1 rounded-md transition-all ${
                  chartMode === 'candles'
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Nến (XAUUSD)
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
                : 'Đang quan sát';
              return (
                <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3 text-xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-cyan-400 font-bold">Lõi Chiến Lược: {strat.version || 'Tabula Rasa v2.2'}</span>
                    <span className="text-slate-400">
                      Khung: <b className="text-slate-200">{strat.timeframe || timeframe}</b>
                    </span>
                    <span className="text-slate-400">
                      Nến gần nhất: <b className="text-slate-200">{candleTimeStr}</b>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Trạng thái:</span>
                    <span className="text-amber-300 font-semibold max-w-md truncate" title={strat.reason}>
                      {strat.reason || 'Sẵn sàng tiếp nhận tín hiệu'}
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

      {/* Connected Accounts Quick Control Strip */}
      {displayAccounts.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-[#090f1d] p-4">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
            <span className="text-xs font-bold text-slate-300">TÀI KHOẢN MT5 ĐANG CHẠY ({displayAccounts.length})</span>
            <span className="text-[10px] text-cyan-400">Auto-Mapped Symbols: XAUUSD / GOLD / XAUUSDm</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayAccounts.map((acc: any) => (
              <div
                key={acc.id}
                className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-slate-200 flex items-center gap-1.5">
                    <span>#{acc.login}</span>
                    <span className="text-[10px] text-slate-500 font-normal">({acc.server})</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Số dư: <strong className="text-cyan-300">${Number(acc.balance || 0).toLocaleString()}</strong>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    acc.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-900 text-slate-500'
                  }`}>
                    {acc.enabled ? 'ĐANG SAO CHÉP' : 'TẠM DỪNG'}
                  </span>
                  <div className="text-[9px] text-slate-500 mt-1">Direct Cloud</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
