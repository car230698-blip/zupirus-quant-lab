import React, { useState } from 'react';
import { EquityHistory } from './EquityHistory';
import { CandlestickTelemetryChart } from './CandlestickTelemetryChart';
import { PropCertificateModal } from './PropCertificateModal';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';
import { apiGet } from '../api/client.ts';
import { formatAccountMoney } from '../utils/currencyFormat.ts';
import { SpotlightBento } from './ui/SpotlightBento';
import { RadialRiskGauge } from './ui/RadialRiskGauge';
import { useLanguage } from '../i18n/LanguageContext';
import { getShieldLayers } from '../data/quantConstants';
import { IconSettings, IconSpark } from './Icons';

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
  mt5Connected,
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
  const { lang } = useLanguage();
  const [chartDays, setChartDays] = useState(30);
  const [localChartMode, setLocalChartMode] = useState<'candles' | 'equity'>('candles');
  const [showEmaOverlay, setShowEmaOverlay] = useState(true);
  const [showBbChannel, setShowBbChannel] = useState(true);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [hoveredCandleIdx, setHoveredCandleIdx] = useState<number | null>(null);
  const [activeShieldIdx, setActiveShieldIdx] = useState<number>(0);
  const [subInfo, setSubInfo] = useState<any>(null);

  React.useEffect(() => {
    apiGet('/api/v1/billing/subscription')
      .then((d) => {
        if (d) setSubInfo(d);
      })
      .catch(() => {});
  }, []);

  const chartMode = externalChartMode ?? localChartMode;
  const setChartMode = externalSetChartMode ?? setLocalChartMode;

  const { data: telemetryData } = useLiveTopbarTelemetry();
  const liveBid = Number(telemetryData?.xauusd?.bid || 0);
  const liveLatencyMs = Number(telemetryData?.metaapi_latency_ms || 0);

  const computedOpenPnl = openPnl ?? totalPnl ?? totalEquity - totalBalance;
  const computedTotalAccounts = totalAccountsCount ?? accounts.length;
  const computedActiveAccounts =
    activeAccountsCount ??
    accounts.filter((a) => a.is_active !== false && a.copy_enabled !== false && Number(a.auto_trade ?? 1) !== 0).length;
  const isMt5Connected =
    mt5Connected ??
    (accounts.length > 0 &&
      accounts.some((a) => a.deployment_state === 'DEPLOYED' || a.enabled || Number(a.auto_trade ?? 0) === 1));
  const computedDailyDd =
    dailyDdPct ??
    (totalBalance > 0 && totalEquity < totalBalance
      ? Math.max(0, ((totalBalance - totalEquity) / totalBalance) * 100)
      : 0.0);

  // Compute real ATR(14) from OHLC candles (sanitizing extreme >10% outlier spikes)
  const validCandlesForAtr = React.useMemo(() => {
    const raw = candles
      .slice(-48)
      .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(Number(v)) && Number(v) > 0));
    if (raw.length < 3) return raw;
    const sortedCloses = raw.map((c) => Number(c.close)).sort((a, b) => a - b);
    const med = sortedCloses[Math.floor(sortedCloses.length / 2)];
    if (!med) return raw;
    const loBound = med * 0.9;
    const hiBound = med * 1.1;
    return raw
      .filter((c) => {
        const o = Number(c.open);
        const cl = Number(c.close);
        return o >= loBound && o <= hiBound && cl >= loBound && cl <= hiBound;
      })
      .map((c) => {
        const o = Number(c.open);
        const cl = Number(c.close);
        const h = Number(c.high);
        const l = Number(c.low);
        return {
          ...c,
          high: h > hiBound ? Math.max(o, cl) : h,
          low: l < loBound ? Math.min(o, cl) : l,
        };
      });
  }, [candles]);
  const liveAtr14 = React.useMemo(() => {
    if (validCandlesForAtr.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < validCandlesForAtr.length; i++) {
      const h = Number(validCandlesForAtr[i].high);
      const l = Number(validCandlesForAtr[i].low);
      const prevC = Number(validCandlesForAtr[i - 1].close);
      const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
      trs.push(tr);
    }
    const recent = trs.slice(-14);
    return recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  }, [validCandlesForAtr]);

  const dynamicShieldLayers = React.useMemo(() => {
    const baseLayers = getShieldLayers(lang);
    if (telemetryData?.shields && telemetryData.shields.length === 4) {
      return telemetryData.shields.map((s: any, i: number) => ({
        id: `0${i + 1}`,
        code: baseLayers[i]?.code || s.layer,
        title: lang === 'en' ? (baseLayers[i]?.title || s.name) : (s.name || baseLayers[i]?.title),
        status: s.status || baseLayers[i]?.status,
        latency: `${Number(s.latency_ms ?? 0).toFixed(1)} ms`,
        detail: lang === 'en' ? (baseLayers[i]?.detail || s.detail) : (s.detail || baseLayers[i]?.detail),
      }));
    }
    return baseLayers;
  }, [telemetryData, lang]);

  const ddDanger = computedDailyDd >= maxDdLimitPct * 0.8;
  const activeShield = dynamicShieldLayers[activeShieldIdx] || dynamicShieldLayers[0];

  const propAccounts = React.useMemo(() => {
    return accounts.filter((a: any) => {
      const type = String(a.account_type || '').toUpperCase();
      const name = String(a.account_name || a.server || a.broker_server || '').toUpperCase();
      return (
        type.includes('PROP') ||
        name.includes('FTMO') ||
        name.includes('PROP') ||
        name.includes('THE5ERS') ||
        name.includes('FUNDED') ||
        Boolean(a.prop_firm_profile)
      );
    });
  }, [accounts]);

  const hasPropAccount = propAccounts.length > 0;
  const propBal = propAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const propEq = propAccounts.reduce((sum, a) => sum + Number(a.equity || a.balance || 0), 0);
  const propPnlPct = propBal > 0 ? ((propEq - propBal) / propBal) * 100 : 0;
  const targetPct = 8.0;
  const isTargetPassed = propPnlPct >= targetPct;

  return (
    <div className="space-y-6">
      {/* Subscription Status & Renewal Banner */}
      {subInfo && (() => {
        const expTs = Number(subInfo.service_expires_at || 0);
        const remSec = expTs - Date.now() / 1000;
        const isActive = Boolean(subInfo.is_active && remSec > 0);
        const daysLeft = isActive ? Math.floor(remSec / 86400) : 0;
        const hoursLeft = isActive ? Math.floor((remSec % 86400) / 3600) : 0;
        const isExpiringSoon = isActive && remSec <= 7 * 86400;
        const expStr = expTs > 0 ? new Date(expTs * 1000).toLocaleDateString('vi-VN') : null;
        const tierLabel = String(subInfo.plan_tier || 'STARTER').toUpperCase();

        return (
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 ${
              !isActive
                ? 'border-rose-500/40 bg-rose-500/10'
                : isExpiringSoon
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-emerald-500/30 bg-emerald-500/5'
            }`}
          >
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span
                className={`rounded-lg px-2.5 py-1 font-mono font-bold uppercase ${
                  !isActive
                    ? 'bg-rose-500/20 text-rose-300'
                    : isExpiringSoon
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-emerald-500/20 text-emerald-300'
                }`}
              >
                {isActive
                  ? (lang === 'en' ? `${tierLabel} PLAN` : `GÓI ${tierLabel}`)
                  : expTs > 0
                  ? (lang === 'en' ? `${tierLabel} PLAN · EXPIRED` : `GÓI ${tierLabel} · HẾT HẠN`)
                  : (lang === 'en' ? 'NO ACTIVE PLAN' : 'CHƯA CÓ GÓI')}
              </span>
              <span className="text-slate-200 font-medium">
                {isActive
                  ? (lang === 'en'
                      ? `Valid for ${daysLeft}d ${hoursLeft}h${expStr ? ` (until ${expStr})` : ''} · ${Number(subInfo.max_cloud_accounts || 1)} Cloud MT5 slots`
                      : `Còn hiệu lực ${daysLeft} ngày ${hoursLeft} giờ${expStr ? ` (đến ${expStr})` : ''} · ${Number(subInfo.max_cloud_accounts || 1)} khe cắm Cloud MT5`)
                  : expTs > 0
                  ? (lang === 'en'
                      ? `Plan expired on ${expStr}. Renew to resume autonomous execution.`
                      : `Gói đã hết hạn ngày ${expStr}. Gia hạn để tiếp tục nhận lệnh tự động.`)
                  : (lang === 'en'
                      ? 'No active Cloud MT5 subscription found.'
                      : 'Bạn chưa kích hoạt gói Cloud MT5 nào.')}
              </span>
            </div>
            {activeTabSetter && (
              <button
                type="button"
                onClick={() => activeTabSetter('accounts')}
                className={`rounded-xl px-4 py-1.5 text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                  !isActive || isExpiringSoon
                    ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                    : 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                }`}
              >
                {!isActive
                  ? (expTs > 0
                      ? (lang === 'en' ? 'Renew Plan Now →' : 'Gia Hạn Gói Ngay →')
                      : (lang === 'en' ? 'Subscribe Now →' : 'Mua Gói Ngay →'))
                  : isExpiringSoon
                  ? (lang === 'en' ? 'Extend Plan →' : 'Gia Hạn Thêm →')
                  : (lang === 'en' ? 'Manage / Renew Plan' : 'Quản Lý / Gia Hạn Gói')}
              </button>
            )}
          </div>
        );
      })()}

      {/* BENTO GRID 12 CỘT: 8 CỘT CHART + 4 CỘT GAUGE RỦI RO */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-stretch">
        {/* Left 8 Cols: Large Chart Workstation with USD Balance & PnL HUD */}
        <div className="lg:col-span-8 min-w-0 w-full">
          <SpotlightBento borderBeam className="p-4 sm:p-6 space-y-4 h-full flex flex-col justify-between">
            {/* Top Bar: Balance, Equity, PnL & Mode Toggles */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300 font-bold">
                    {lang === 'en' ? '01 // AGGREGATED CAPITAL & COCKPIT' : '01 // TỔNG VỐN & BUỒNG LÁI ĐỊNH LƯỢNG'}
                  </span>
                  <span className="rounded bg-amber-500/15 border border-amber-400/35 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-amber-300">
                    USD LIVE
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="font-mono text-2xl sm:text-3xl font-extrabold text-white tracking-tight tabular-nums">
                    ${fmtNum(totalBalance, 2)}
                  </span>
                  <span className="text-xs text-slate-400">
                    Equity: <strong className="text-amber-300 font-mono tabular-nums">${fmtNum(totalEquity, 2)}</strong>
                  </span>
                  <span
                    className={`rounded-lg px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${
                      computedOpenPnl >= 0 ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {fmtPnL(computedOpenPnl)} ({totalBalance > 0 ? `${computedOpenPnl >= 0 ? '+' : ''}${fmtNum((computedOpenPnl / totalBalance) * 100, 2)}%` : '0%'})
                  </span>
                  {totalPositions > 0 && (
                    <span className="text-xs text-slate-400">
                      · <span className="font-mono tabular-nums">{totalPositions}</span> {lang === 'en' ? 'open positions' : 'lệnh mở'}
                    </span>
                  )}
                </div>
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {(totalAccountsCount ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setCertModalOpen(true)}
                    className="rounded-xl border border-amber-400/45 bg-amber-500/15 px-3 py-1.5 font-mono text-xs font-bold text-amber-200 hover:bg-amber-500/25 transition whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {lang === 'en' ? '🏆 Prop Pass' : '🏆 Pass Quỹ'}
                  </button>
                )}
                <div className="flex rounded-xl border border-white/10 bg-[#040710] p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setChartMode('candles');
                      if (loadCandles) loadCandles(timeframe);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-mono font-bold transition whitespace-nowrap cursor-pointer ${
                      chartMode === 'candles'
                        ? 'bg-[#12B5A6] text-[#042422]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {lang === 'en' ? `${symbol} Candles` : `Nến ${symbol}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('equity')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-mono font-bold transition whitespace-nowrap cursor-pointer ${
                      chartMode === 'equity'
                        ? 'bg-[#12B5A6] text-[#042422]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {lang === 'en' ? 'Equity Curve' : 'Đường Vốn'}
                  </button>
                </div>

                {chartMode === 'candles' && setTimeframe && (
                  <div className="flex rounded-xl border border-white/10 bg-[#040710] p-0.5">
                    {(['M5', 'M15', 'H1'] as const).map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => {
                          setTimeframe(tf);
                          if (loadCandles) loadCandles(tf);
                        }}
                        className={`rounded-lg px-2 py-1 font-mono text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                          timeframe === tf
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                )}

                {chartMode === 'equity' && (
                  <div className="flex rounded-xl border border-white/10 bg-[#040710] p-0.5">
                    {[7, 30, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setChartDays(d)}
                        className={`rounded-lg px-2 py-1 font-mono text-xs font-bold transition whitespace-nowrap tabular-nums cursor-pointer ${
                          chartDays === d
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
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

            {/* Chart Area */}
            <div className="flex-1 min-h-[300px]">
              {chartMode === 'candles' ? (
                <CandlestickTelemetryChart
                  candles={validCandlesForAtr}
                  symbol={symbol}
                  timeframe={timeframe}
                  liveBid={liveBid}
                  liveAtr14={liveAtr14}
                  hoveredCandleIdx={hoveredCandleIdx}
                  setHoveredCandleIdx={setHoveredCandleIdx}
                  showEmaOverlay={showEmaOverlay}
                  setShowEmaOverlay={setShowEmaOverlay}
                  showBbChannel={showBbChannel}
                  setShowBbChannel={setShowBbChannel}
                />
              ) : (
                <EquityHistory days={chartDays} series={series} />
              )}
            </div>

            {/* Bottom Execution Telemetry Micro-Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 font-mono text-xs tabular-nums border-t border-white/[0.08]">
              <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-2.5">
                <div className="text-[10px] text-slate-400">{lang === 'en' ? 'MARKET REGIME' : 'CHẾ ĐỘ THỊ TRƯỜNG'}</div>
                <div className="mt-0.5 font-bold text-amber-300">EXPANSION M15</div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-2.5">
                <div className="text-[10px] text-slate-400">{lang === 'en' ? 'ATR(14) RANGE' : 'BIÊN ĐỘ ATR(14)'}</div>
                <div className="mt-0.5 font-bold text-cyan-300">
                  {liveAtr14 > 0 ? `${fmtNum(liveAtr14, 2)} USD` : (lang === 'en' ? 'Measuring ATR(14)...' : 'Đo ATR(14)...')}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-2.5">
                <div className="text-[10px] text-slate-400">AUTO BREAK-EVEN</div>
                <div className="mt-0.5 font-bold text-emerald-400">ARMED @ +1.0R</div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-2.5">
                <div className="text-[10px] text-slate-400">{lang === 'en' ? 'PROTECTION REGIME' : 'CHẾ ĐỘ BẢO VỆ'}</div>
                <div className="mt-0.5 font-bold text-emerald-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Fail-Closed 4/4</span>
                </div>
              </div>
            </div>
          </SpotlightBento>
        </div>

        {/* Right 4 Cols: 2 RadialRiskGauges (Daily DD + Prop Target / Latency) */}
        <div className="lg:col-span-4 min-w-0 w-full flex flex-col justify-between gap-5">
          {/* Mobile: 2-column grid side-by-side (grid-cols-2); Desktop: stacked 2 cards */}
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 sm:gap-5 h-full">
            {/* Gauge 1: Khiên Sụt Giảm Ngày */}
            <SpotlightBento className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
              <RadialRiskGauge
                title={lang === 'en' ? 'Daily Drawdown Shield' : 'Khiên Sụt Giảm Ngày'}
                value={computedDailyDd}
                max={maxDdLimitPct}
                tone={ddDanger ? 'rose' : 'teal'}
                badgeLabel={ddDanger ? (lang === 'en' ? 'DANGER' : 'NGUY HIỂM') : (lang === 'en' ? 'SAFE' : 'AN TOÀN')}
                badgeTone={ddDanger ? 'rose' : 'teal'}
                subtitle={
                  <div className="space-y-1 text-[11px] text-slate-300 font-sans">
                    <div>{lang === 'en' ? 'Drawdown Cap: ' : 'Trần bảo vệ: '}<strong className="text-amber-300 font-mono tabular-nums">{fmtNum(maxDdLimitPct, 1)}%</strong></div>
                    <div>{lang === 'en' ? 'Mechanism: ' : 'Cơ chế: '}<strong className="text-emerald-300">Fail-Closed 100%</strong></div>
                  </div>
                }
              />
            </SpotlightBento>

            {/* Gauge 2: Tiến Độ Mục Tiêu Quỹ Prop / Hạ Tầng G2 */}
            <SpotlightBento className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
              {hasPropAccount ? (
                <div className="space-y-2 h-full flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                    <span className="text-amber-300 font-bold truncate max-w-[130px]" title={propAccounts[0]?.broker_server}>
                      {propAccounts[0]?.broker_server || 'PROP CHALLENGE'}
                    </span>
                    {isTargetPassed && (
                      <button
                        type="button"
                        onClick={() => setCertModalOpen(true)}
                        className="rounded-lg border border-amber-400/50 bg-amber-500/20 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-300 hover:bg-amber-500/30 transition shrink-0 cursor-pointer font-sans"
                      >
                        {lang === 'en' ? '🏆 Certificate' : '🏆 Xuất Chứng Chỉ'}
                      </button>
                    )}
                  </div>
                  <RadialRiskGauge
                    title={lang === 'en' ? 'Prop Target (8%)' : 'Mục Tiêu Pass Quỹ (8%)'}
                    value={Math.max(0, propPnlPct)}
                    max={8.0}
                    tone="gold"
                    badgeLabel={isTargetPassed ? (lang === 'en' ? 'TARGET PASSED' : 'ĐÃ ĐẠT TARGET') : 'PROP LIVE'}
                    badgeTone="gold"
                    subtitle={
                      <div className="space-y-1 text-[11px] text-slate-300 font-sans">
                        <div>{lang === 'en' ? 'Progress: ' : 'Tiến độ: '}<strong className="text-emerald-300 font-mono tabular-nums">+{fmtNum(Math.max(0, propPnlPct), 2)}%</strong> / 8.0%</div>
                        <div>{lang === 'en' ? 'Accounts: ' : 'Tài khoản: '}<strong className="text-cyan-300">{propAccounts.length} {lang === 'en' ? 'Prop Live' : 'Quỹ Live'}</strong></div>
                      </div>
                    }
                  />
                </div>
              ) : (
                <RadialRiskGauge
                  title={lang === 'en' ? 'London G2 Cloud Node' : 'Hạ Tầng London G2'}
                  value={liveLatencyMs > 0 ? liveLatencyMs : 0}
                  max={100}
                  tone="teal"
                  suffix="ms"
                  badgeLabel={liveLatencyMs > 0 ? 'ONLINE' : 'CONNECTING'}
                  badgeTone="teal"
                  subtitle={
                    <div className="space-y-1 text-[11px] text-slate-300 font-sans">
                      <div>{lang === 'en' ? 'Connection: ' : 'Kết nối: '}<strong className="text-emerald-300">Cloud MetaAPI</strong></div>
                      <div>{lang === 'en' ? 'Latency: ' : 'Độ trễ: '}<strong className="text-cyan-300 font-mono tabular-nums">{liveLatencyMs > 0 ? `${fmtNum(liveLatencyMs, 1)}ms` : (lang === 'en' ? 'Measuring...' : 'Đang đo...')}</strong></div>
                    </div>
                  }
                />
              )}
            </SpotlightBento>
          </div>
        </div>
      </div>

      {/* Row 2: Interactive 4-Layer Fail-Closed Capital Shield Matrix */}
      <SpotlightBento className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3.5 sm:items-center">
            <div
              className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border font-mono text-sm font-extrabold sm:mt-0 ${
                safetyTone === 'emerald'
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                  : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
              }`}
            >
              4L
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-bold uppercase tracking-wider text-amber-300">
                  {lang === 'en' ? '4-LAYER CAPITAL DEFENSE SHIELD (FAIL-CLOSED)' : 'LÁ CHẮN BẢO VỆ VỐN 4 LỚP (FAIL-CLOSED)'}
                </span>
                <span>·</span>
                <span className="font-semibold text-emerald-400">
                  {lang === 'en' ? '4 Layers Active' : safetyLockLabel}
                </span>
                <span>·</span>
                <span className="tabular-nums">
                  {lang === 'en' ? 'AI Recommendation: ' : 'Khuyến nghị AI: '}<strong className="text-cyan-300">{latestAction}</strong>
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                {activeShield.detail}
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
                <IconSettings className="w-3.5 h-3.5" />
                {lang === 'en' ? 'Capital Shield Config' : 'Cấu Hình Giáp Vốn'}
              </button>
              <button
                type="button"
                onClick={() => activeTabSetter('orders')}
                className="quant-btn-primary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <IconSpark className="w-3.5 h-3.5" />
                {lang === 'en' ? 'AI Order Ledger' : 'Sổ Lệnh AI'}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 pt-2 border-t border-white/[0.08] text-xs">
          {dynamicShieldLayers.map((layer: any, idx: number) => {
            const isSelected = activeShieldIdx === idx;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => setActiveShieldIdx(idx)}
                className={`rounded-xl border p-3 sm:p-3.5 text-left transition flex items-center justify-between gap-2 min-w-0 w-full cursor-pointer ${
                  isSelected
                    ? 'border-amber-400/55 bg-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.14)]'
                    : 'border-white/[0.08] bg-[#040710]/85 hover:border-amber-500/30'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-amber-300 font-bold truncate">
                    {layer.id}. {layer.code}
                  </div>
                  <div className="text-white font-bold mt-0.5 text-xs truncate" title={layer.title}>
                    {layer.title}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-emerald-400 font-bold block text-xs">{layer.status}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">{layer.latency}</span>
                </div>
              </button>
            );
          })}
        </div>
      </SpotlightBento>

      {/* Row 3: Connected Cloud MT5 Terminals (12 Columns) */}
      <SpotlightBento className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300 font-bold font-mono">
              CLOUD MT5 NODES
            </div>
            <h3 className="mt-0.5 text-base font-bold text-white">
              {lang === 'en' ? 'MT5 Terminals Synchronized with London G2 Cloud Node' : 'Tài Khoản MT5 Đang Ghép Nối Với Trạm Đám Mây London G2'}
            </h3>
          </div>
          {activeTabSetter && (
            <button
              type="button"
              onClick={() => activeTabSetter('accounts')}
              className="text-xs font-mono font-bold text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {lang === 'en' ? `Manage (${accounts.length}) →` : `Quản lý (${accounts.length}) →`}
            </button>
          )}
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-amber-500/25 bg-[#040710]/60 p-6 text-center">
            <p className="text-sm font-semibold text-slate-200">
              {lang === 'en' ? 'No MT5 accounts connected yet' : 'Chưa có tài khoản MT5 nào được kết nối'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {lang === 'en'
                ? 'Connect your MetaTrader 5 account to begin autonomous quantitative execution on XAU/USD.'
                : 'Kết nối tài khoản MetaTrader 5 để bắt đầu nhận tín hiệu định lượng XAU/USD tự động.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {accounts.map((acc: any) => {
              const isActive = acc.is_active !== false && acc.copy_enabled !== false && Number(acc.auto_trade ?? 1) !== 0;
              const accBal = Number(acc.balance ?? 0);
              const accEq = Number(acc.equity ?? accBal);
              const accDd =
                acc.daily_dd_pct !== undefined
                  ? Number(acc.daily_dd_pct)
                  : accBal > 0 && accEq < accBal
                  ? Math.max(0, ((accBal - accEq) / accBal) * 100)
                  : 0.0;
              const accMaxDd = Number(acc.max_daily_dd_pct ?? acc.prop_daily_dd_limit_pct ?? 4.0);
              const accId = acc.account_id || acc.login || acc.id;
              const isProp = String(acc.account_type || '').toUpperCase().includes('PROP') ||
                String(acc.server || '').toUpperCase().includes('FTMO') ||
                Boolean(acc.prop_firm_profile);
              const isCent = String(acc.account_type || '').toUpperCase().includes('CENT') ||
                String(acc.server || '').toUpperCase().includes('CENT');

              return (
                <div
                  key={accId}
                  className="rounded-xl border border-white/10 bg-[#040710]/90 p-4 transition hover:border-amber-400/45 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                          }`}
                        />
                        <span className="truncate font-bold text-sm text-white">
                          {acc.account_name || acc.login || accId}
                        </span>
                        {isProp ? (
                          <span className="rounded bg-amber-500/20 border border-amber-400/35 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300">
                            PROP LIVE
                          </span>
                        ) : isCent ? (
                          <span className="rounded bg-cyan-500/20 border border-cyan-400/35 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300">
                            CENT USC
                          </span>
                        ) : (
                          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">
                            STANDARD
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-slate-400 truncate">
                        #{accId} · {acc.broker_server || acc.server || 'MT5 Cloud'} · x{fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)}
                      </div>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold shrink-0 border ${
                        isActive
                          ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                          : 'bg-slate-800/80 border-slate-600/50 text-slate-400'
                      }`}
                    >
                      {isActive ? 'ONLINE' : 'PAUSED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-2.5 font-mono text-xs tabular-nums">
                    <div>
                      <div className="text-[10px] text-slate-500">BALANCE</div>
                      <div className="font-bold text-white">{formatAccountMoney(acc.balance, acc)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">EQUITY</div>
                      <div className="font-bold text-amber-300">{formatAccountMoney(acc.equity, acc)}</div>
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

        <div className="border-t border-white/[0.08] pt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isMt5Connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>{runtimeModeLabel} · {computedActiveAccounts}/{computedTotalAccounts} Online</span>
          </div>
          <span className="text-amber-300 font-bold">
            {liveLatencyMs > 0 ? `${liveLatencyMs}ms` : (lang === 'en' ? 'Measuring...' : 'Đang đo...')} G2 · {isMt5Connected ? (lang === 'en' ? 'SYNCHRONIZED' : 'ĐÃ ĐỒNG BỘ') : (lang === 'en' ? 'AWAITING SYNC' : 'CHỜ ĐỒNG BỘ')}
          </span>
        </div>
      </SpotlightBento>
      <PropCertificateModal
        open={certModalOpen}
        onClose={() => setCertModalOpen(false)}
        totalEquity={totalEquity ?? totalBalance ?? 0}
        netPnl={totalPnl ?? 0}
        accountsCount={totalAccountsCount ?? 0}
      />
    </div>
  );
};
