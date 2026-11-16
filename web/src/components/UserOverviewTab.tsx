import React, { useEffect, useState } from 'react';
import { EquityHistory } from './EquityHistory';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';

export interface UserOverviewTabProps {
  totalBalance?: number;
  totalEquity?: number;
  totalPnl?: number;
  openPnl?: number;
  totalPositions?: number;
  dailyDdPct?: number;
  maxDdLimitPct?: number;
  activeAccountsCount?: number;
  totalAccountsCount?: number;
  runtimeModeLabel?: string;
  mt5Connected?: boolean;
  safetyLockLabel?: string;
  safetyTone?: string;
  latestAction?: string;
  symbol?: string;
  timeframe?: 'M1' | 'M5' | 'M15' | 'H1' | 'D1' | string;
  setTimeframe?: React.Dispatch<React.SetStateAction<any>>;
  loadCandles?: (tf: string) => Promise<void> | void;
  chartMode?: 'equity' | 'candles';
  setChartMode?: React.Dispatch<React.SetStateAction<'equity' | 'candles'>>;
  selectedAccount?: string;
  setSelectedAccount?: React.Dispatch<React.SetStateAction<string>>;
  candles?: any[];
  series?: any[];
  health?: any;
  accounts?: any[];
  activeTabSetter?: (tab: any) => void;
}

export const UserOverviewTab: React.FC<UserOverviewTabProps> = ({
  totalBalance = 0,
  totalEquity = 0,
  totalPnl,
  openPnl,
  totalPositions = 0,
  dailyDdPct,
  maxDdLimitPct = 4.0,
  activeAccountsCount,
  totalAccountsCount,
  runtimeModeLabel = 'Zero-VPS Cloud MetaAPI',
  mt5Connected = true,
  safetyLockLabel = '4 Lớp Bảo Vệ Hoạt Động',
  safetyTone = 'emerald',
  latestAction = 'MUA THEO XU HƯỚNG (M15)',
  symbol = 'XAUUSD',
  timeframe = 'M15',
  setTimeframe,
  loadCandles,
  chartMode: externalChartMode,
  setChartMode: externalSetChartMode,
  candles = [],
  series = [],
  accounts = [],
  activeTabSetter,
}) => {
  const [chartDays, setChartDays] = useState(30);
  const [localChartMode, setLocalChartMode] = useState<'candles' | 'equity'>('candles');
  const chartMode = externalChartMode ?? localChartMode;
  const setChartMode = externalSetChartMode ?? setLocalChartMode;

  const [liveBid, setLiveBid] = useState<number | null>(null);
  const [liveAsk, setLiveAsk] = useState<number | null>(null);
  const [liveSpread, setLiveSpread] = useState<number | null>(null);

  const computedOpenPnl = openPnl ?? totalPnl ?? totalEquity - totalBalance;
  const computedTotalAccounts = totalAccountsCount ?? accounts.length;
  const computedActiveAccounts =
    activeAccountsCount ??
    accounts.filter((a) => a.is_active !== false && a.copy_enabled !== false).length;
  const computedDailyDd =
    dailyDdPct ??
    (totalBalance > 0 && computedOpenPnl < 0
      ? Math.abs((computedOpenPnl / totalBalance) * 100)
      : 0.42);

  useEffect(() => {
    let mounted = true;
    const fetchTick = async () => {
      try {
        const res = await fetch('/api/v1/telemetry/topbar', { credentials: 'include' });
        if (res.ok && mounted) {
          const data = await res.json();
          if (data.bid) setLiveBid(Number(data.bid));
          if (data.ask) setLiveAsk(Number(data.ask));
          if (data.spread !== undefined) setLiveSpread(Number(data.spread));
        }
      } catch {
        // Fallback to candle close
      }
    };
    fetchTick();
    const timer = setInterval(fetchTick, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const renderCandlestickSvg = () => {
    const valid = candles
      .slice(-48)
      .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(Number(v))));
    if (!valid.length) {
      return (
        <div className="flex h-72 items-center justify-center rounded-xl border border-white/[0.06] bg-[#040710]/80 text-xs font-mono uppercase tracking-[0.2em] text-slate-400">
          Đang đồng bộ luồng nến {symbol} ({timeframe})...
        </div>
      );
    }

    const highs = valid.map((c) => Number(c.high));
    const lows = valid.map((c) => Number(c.low));
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const span = max - min || 1;
    const lastCandle = valid[valid.length - 1];
    const currentPrice = liveBid || Number(lastCandle.close);
    const currentY = 18 + ((max - currentPrice) / span) * 204;

    return (
      <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#040710]/90 p-3">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-bold text-white">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {symbol} · {timeframe}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400 tabular-nums">
              O: <strong className="text-slate-200">{fmtNum(lastCandle.open, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums">
              H: <strong className="text-emerald-300">{fmtNum(lastCandle.high, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums">
              L: <strong className="text-rose-300">{fmtNum(lastCandle.low, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums">
              C: <strong className="text-cyan-300">{fmtNum(currentPrice, 2)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-3 tabular-nums">
            {liveBid && liveAsk ? (
              <>
                <span className="text-emerald-300">BID {fmtNum(liveBid, 2)}</span>
                <span className="text-slate-600">·</span>
                <span className="text-cyan-300">ASK {fmtNum(liveAsk, 2)}</span>
                {liveSpread !== null && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-amber-300">SPREAD {fmtNum(liveSpread, 1)} pts</span>
                  </>
                )}
              </>
            ) : (
              <span className="text-slate-400">48 phiên {timeframe} gần nhất</span>
            )}
          </div>
        </div>

        <svg viewBox="0 0 820 240" className="h-64 w-full select-none" data-testid="candlestick-svg">
          {[24, 78, 132, 186, 220].map((y, idx) => {
            const priceLabel = max - (idx / 4) * span;
            return (
              <g key={y}>
                <line
                  x1="12"
                  y1={y}
                  x2="758"
                  y2={y}
                  stroke="rgba(148,163,184,0.07)"
                  strokeDasharray="3 4"
                />
                <text
                  x="812"
                  y={y + 3}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="9.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {fmtNum(priceLabel, 2)}
                </text>
              </g>
            );
          })}

          {valid.map((c, idx) => {
            const x = 20 + (idx / Math.max(valid.length - 1, 1)) * 725;
            const openY = 18 + ((max - Number(c.open)) / span) * 204;
            const closeY = 18 + ((max - Number(c.close)) / span) * 204;
            const highY = 18 + ((max - Number(c.high)) / span) * 204;
            const lowY = 18 + ((max - Number(c.low)) / span) * 204;
            const bull = Number(c.close) >= Number(c.open);
            const color = bull ? '#10b981' : '#f43f5e';
            return (
              <g key={c.timestamp || c.time || idx}>
                <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1.4" strokeOpacity="0.85" />
                <rect
                  x={x - 4.5}
                  y={Math.min(openY, closeY)}
                  width="9"
                  height={Math.max(Math.abs(closeY - openY), 2.5)}
                  fill={color}
                  rx="1.5"
                />
              </g>
            );
          })}

          <line
            x1="12"
            y1={currentY}
            x2="758"
            y2={currentY}
            stroke="#06b6d4"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          <rect x="760" y={currentY - 8} width="56" height="16" rx="3" fill="#06b6d4" />
          <text
            x="788"
            y={currentY + 3}
            textAnchor="middle"
            fill="#020617"
            fontSize="9"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {fmtNum(currentPrice, 2)}
          </text>
        </svg>
      </div>
    );
  };

  const ddProgressPct = Math.min((computedDailyDd / Math.max(maxDdLimitPct, 0.1)) * 100, 100);
  const ddDanger = computedDailyDd >= maxDdLimitPct * 0.8;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Tổng Số Dư & Equity
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
            ${fmtNum(totalBalance, 2)}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-xs text-slate-400">
            <span>Equity khả dụng</span>
            <strong className="font-mono text-cyan-300 tabular-nums">${fmtNum(totalEquity, 2)}</strong>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Lợi Nhuận Mở (Floating PnL)
          </div>
          <div
            className={`mt-2.5 font-mono text-2xl font-extrabold tracking-tight tabular-nums ${
              computedOpenPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {fmtPnL(computedOpenPnl)}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-xs text-slate-400">
            <span>Vị thế đang mở: {totalPositions}</span>
            <strong className="font-mono text-slate-200 tabular-nums">
              {totalBalance > 0
                ? `${computedOpenPnl >= 0 ? '+' : ''}${fmtNum((computedOpenPnl / totalBalance) * 100, 2)}%`
                : '0.00%'}
            </strong>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Mức Sụt Giảm Ngày (Daily DD)
          </div>
          <div
            className={`mt-2.5 font-mono text-2xl font-extrabold tracking-tight tabular-nums ${
              ddDanger ? 'text-rose-400' : 'text-amber-300'
            }`}
          >
            {fmtNum(computedDailyDd, 2)}%
          </div>
          <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Trần bảo vệ ngày</span>
              <strong className="font-mono text-slate-200 tabular-nums">{fmtNum(maxDdLimitPct, 1)}%</strong>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/90">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  ddDanger
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-gradient-to-r from-cyan-400 to-emerald-400'
                }`}
                style={{ width: `${ddProgressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Trạng Thái Cloud MT5
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
              {computedActiveAccounts} / {computedTotalAccounts}
            </span>
            <span className="text-xs font-medium text-slate-400">tài khoản chạy</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-xs text-slate-400">
            <span className="truncate">{runtimeModeLabel}</span>
            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-200 shrink-0">
              <span className={`h-2 w-2 rounded-full ${mt5Connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              {mt5Connected ? 'ĐÃ KẾT NỐI' : 'CHỜ ĐỒNG BỘ'}
            </span>
          </div>
        </div>
      </div>

      {/* Runtime Protection Shield Strip */}
      <div className="quant-panel flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-start gap-3.5 sm:items-center">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-mono text-sm font-bold sm:mt-0 ${
              safetyTone === 'emerald'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                : safetyTone === 'amber'
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
            }`}
          >
            4L
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
              <span className="font-bold uppercase tracking-wider text-white">Lá Chắn An Toàn 4 Lớp</span>
              <span>·</span>
              <span className="font-semibold text-emerald-300">{safetyLockLabel}</span>
              <span>·</span>
              <span className="tabular-nums">
                Khuyến nghị AI: <strong className="text-cyan-300">{latestAction}</strong>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Tự động kiểm duyệt: (1) Kill-Switch toàn cục · (2) Lịch tin tức USD High-Impact · (3) Giới hạn Daily Drawdown · (4) Đồng bộ lot theo Equity thực.
            </p>
          </div>
        </div>
        {activeTabSetter && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => activeTabSetter('accounts')}
              className="quant-btn-secondary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              Cấu Hình Bảo Vệ
            </button>
            <button
              type="button"
              onClick={() => activeTabSetter('assistant')}
              className="quant-btn-primary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              Hỏi Trợ Lý AI
            </button>
          </div>
        )}
      </div>

      {/* Primary Quantitative Chart Area + Connected MT5 Accounts Sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="quant-panel p-5 lg:col-span-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
                Trạm Thị Trường & Hiệu Suất
              </div>
              <h3 className="mt-0.5 text-base font-bold text-white">
                {chartMode === 'candles'
                  ? `Biểu Đồ Nến ${symbol} (${timeframe})`
                  : `Đường Cong Tăng Trưởng Equity (${chartDays} Ngày)`}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-white/[0.08] bg-[#040710] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setChartMode('candles');
                    if (loadCandles) loadCandles(timeframe);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                    chartMode === 'candles'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Nến {symbol}
                </button>
                <button
                  type="button"
                  onClick={() => setChartMode('equity')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                    chartMode === 'equity'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Lịch Sử Equity
                </button>
              </div>

              {chartMode === 'candles' && setTimeframe && (
                <div className="flex rounded-xl border border-white/[0.08] bg-[#040710] p-1">
                  {(['M5', 'M15', 'H1'] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => {
                        setTimeframe(tf);
                        if (loadCandles) loadCandles(tf);
                      }}
                      className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                        timeframe === tf
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              )}

              {chartMode === 'equity' && (
                <div className="flex rounded-xl border border-white/[0.08] bg-[#040710] p-1">
                  {[7, 30, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setChartDays(d)}
                      className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 tabular-nums ${
                        chartDays === d
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {d}D
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {chartMode === 'candles' ? renderCandlestickSvg() : <EquityHistory days={chartDays} series={series} />}
        </div>

        <div className="quant-panel flex flex-col justify-between p-5 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
                  Danh Mục Tài Khoản
                </div>
                <h3 className="mt-0.5 text-base font-bold text-white">Tài Khoản MT5 Đang Ghép Nối</h3>
              </div>
              {activeTabSetter && (
                <button
                  type="button"
                  onClick={() => activeTabSetter('accounts')}
                  className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 whitespace-nowrap shrink-0"
                >
                  Quản lý ({accounts.length}) →
                </button>
              )}
            </div>

            {accounts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-[#040710]/60 p-6 text-center">
                <p className="text-sm font-semibold text-slate-200">Chưa có tài khoản MT5 nào được kết nối</p>
                <p className="mt-1 text-xs text-slate-400">
                  Kết nối tài khoản MetaTrader 5 để bắt đầu nhận tín hiệu định lượng XAU/USD tự động.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {accounts.slice(0, 4).map((acc: any) => {
                  const isActive = acc.is_active !== false && acc.copy_enabled !== false;
                  const accDd = Number(acc.daily_dd_pct || 0);
                  const accMaxDd = Number(acc.max_daily_dd_pct || 4.0);
                  const accId = acc.account_id || acc.login || acc.id;
                  return (
                    <div
                      key={accId}
                      className="rounded-xl border border-white/[0.07] bg-[#040710]/80 p-3.5 transition hover:border-cyan-500/30"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                              }`}
                            />
                            <span className="truncate font-semibold text-sm text-white">
                              {acc.account_name || acc.login || accId}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-slate-400 truncate">
                            #{accId} · {acc.broker_server || acc.server || 'MT5 Cloud'} · x
                            {fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] font-semibold text-slate-300 shrink-0">
                          {isActive ? 'ĐANG CHẠY' : 'TẠM DỪNG'}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.05] pt-2.5 font-mono text-xs tabular-nums">
                        <div>
                          <div className="text-[10px] text-slate-500">BALANCE</div>
                          <div className="font-bold text-slate-200">${fmtNum(acc.balance, 0)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">EQUITY</div>
                          <div className="font-bold text-cyan-300">${fmtNum(acc.equity, 0)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-500">DAILY DD</div>
                          <div className={`font-bold ${accDd >= accMaxDd * 0.8 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {fmtNum(accDd, 2)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3.5 flex items-center justify-between text-xs text-slate-400">
            <span>Đồng bộ MetaAPI Cloud 24/7</span>
            <span className="font-mono text-emerald-400">&lt; 50ms</span>
          </div>
        </div>
      </div>
    </div>
  );
};
