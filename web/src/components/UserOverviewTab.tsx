import React, { useState } from 'react';
import { EquityHistory } from './EquityHistory';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';

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

import { SHIELD_LAYERS } from '../data/quantConstants';

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
  const [chartDays, setChartDays] = useState(30);
  const [localChartMode, setLocalChartMode] = useState<'candles' | 'equity'>('candles');
  const [showEmaOverlay, setShowEmaOverlay] = useState(true);
  const [showBbChannel, setShowBbChannel] = useState(true);
  const [hoveredCandleIdx, setHoveredCandleIdx] = useState<number | null>(null);
  const [activeShieldIdx, setActiveShieldIdx] = useState<number>(0);
  const [subInfo, setSubInfo] = useState<any>(null);

  React.useEffect(() => {
    fetch('/api/v1/billing/subscription', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
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
    if (telemetryData?.shields && telemetryData.shields.length === 4) {
      return telemetryData.shields.map((s, i) => ({
        id: `0${i + 1}`,
        code: SHIELD_LAYERS[i]?.code || s.layer,
        title: s.name || SHIELD_LAYERS[i]?.title,
        status: s.status || SHIELD_LAYERS[i]?.status,
        latency: `${Number(s.latency_ms ?? 0).toFixed(1)} ms`,
        detail: s.detail || SHIELD_LAYERS[i]?.detail,
      }));
    }
    return SHIELD_LAYERS;
  }, [telemetryData]);

  const renderCandlestickSvg = () => {
    const valid = validCandlesForAtr;
    if (!valid.length) {
      return (
        <div className="flex h-72 items-center justify-center rounded-xl border border-amber-500/20 bg-[#040710]/90 text-xs font-mono uppercase tracking-[0.2em] text-amber-300">
          Đang đồng bộ luồng nến {symbol} ({timeframe})...
        </div>
      );
    }

    const highs = valid.map((c) => Number(c.high));
    const lows = valid.map((c) => Number(c.low));
    const rawMin = Math.min(...lows);
    const rawMax = Math.max(...highs);
    const rawSpan = rawMax - rawMin || 1;
    const pad = rawSpan * 0.08;
    const min = rawMin - pad;
    const max = rawMax + pad;
    const span = max - min || 1;
    const lastCandle = valid[valid.length - 1];
    const inspectedCandle =
      hoveredCandleIdx !== null && valid[hoveredCandleIdx] ? valid[hoveredCandleIdx] : lastCandle;
    const currentPrice = liveBid || Number(lastCandle.close);
    const currentY = 18 + ((max - currentPrice) / span) * 204;

    // Calculate EMA-10 smooth overlay points & real ATR(14) Volatility Band
    const emaPoints: string[] = [];
    const upperBandPoints: string[] = [];
    const lowerBandPoints: string[] = [];
    let ema = Number(valid[0].close);
    const k = 2 / (10 + 1);
    const effectiveAtr = liveAtr14 > 0 ? liveAtr14 : span * 0.12;
    const bandOffset = Math.max(4, Math.min(48, (effectiveAtr / span) * 204));
    valid.forEach((c, idx) => {
      const closeVal = Number(c.close);
      ema = idx === 0 ? closeVal : closeVal * k + ema * (1 - k);
      const x = 20 + (idx / Math.max(valid.length - 1, 1)) * 725;
      const y = 18 + ((max - ema) / span) * 204;
      emaPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      upperBandPoints.push(`${x.toFixed(1)},${Math.max(12, y - bandOffset).toFixed(1)}`);
      lowerBandPoints.push(`${x.toFixed(1)},${Math.min(228, y + bandOffset).toFixed(1)}`);
    });

    return (
      <div className="relative overflow-hidden rounded-xl border border-amber-500/25 bg-[#040710]/95 p-3.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {symbol} · {timeframe}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400 tabular-nums">
              O: <strong className="text-slate-200">{fmtNum(inspectedCandle.open, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums">
              H: <strong className="text-emerald-300">{fmtNum(inspectedCandle.high, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums">
              L: <strong className="text-rose-300">{fmtNum(inspectedCandle.low, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums">
              C: <strong className="text-amber-300">{fmtNum(inspectedCandle.close, 2)}</strong>
            </span>
            <span className="text-slate-400 tabular-nums hidden sm:inline">
              Biên độ:{' '}
              <strong className="text-cyan-300">
                {fmtNum((Number(inspectedCandle.high) - Number(inspectedCandle.low)) * 10, 1)} pips
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2 tabular-nums">
            <button
              type="button"
              onClick={() => setShowEmaOverlay((v) => !v)}
              className={`rounded-md px-2 py-0.5 text-[11px] border transition cursor-pointer ${
                showEmaOverlay
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-200 font-bold'
                  : 'border-white/10 text-slate-500 hover:text-slate-300'
              }`}
            >
              EMA-10 {showEmaOverlay ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setShowBbChannel((v) => !v)}
              className={`rounded-md px-2 py-0.5 text-[11px] border transition cursor-pointer ${
                showBbChannel
                  ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200 font-bold'
                  : 'border-white/10 text-slate-500 hover:text-slate-300'
              }`}
            >
              ATR BAND {showBbChannel ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <svg
          viewBox="0 0 820 240"
          className="h-64 w-full select-none"
          data-testid="candlestick-svg"
          onMouseLeave={() => setHoveredCandleIdx(null)}
        >
          {[24, 78, 132, 186, 220].map((y, idx) => {
            const priceLabel = max - (idx / 4) * span;
            return (
              <g key={y}>
                <line
                  x1="12"
                  y1={y}
                  x2="758"
                  y2={y}
                  stroke="rgba(245, 158, 11, 0.08)"
                  strokeDasharray="3 4"
                />
                <text
                  x="812"
                  y={y + 3}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {fmtNum(priceLabel, 2)}
                </text>
              </g>
            );
          })}

          {showBbChannel && upperBandPoints.length > 1 && (
            <>
              <polyline
                fill="none"
                stroke="rgba(6, 182, 212, 0.32)"
                strokeWidth="1"
                strokeDasharray="3 3"
                points={upperBandPoints.join(' ')}
              />
              <polyline
                fill="none"
                stroke="rgba(6, 182, 212, 0.32)"
                strokeWidth="1"
                strokeDasharray="3 3"
                points={lowerBandPoints.join(' ')}
              />
            </>
          )}

          {showEmaOverlay && emaPoints.length > 1 && (
            <polyline
              fill="none"
              stroke="rgba(251, 191, 36, 0.85)"
              strokeWidth="1.8"
              points={emaPoints.join(' ')}
            />
          )}

          {valid.map((c, idx) => {
            const x = 20 + (idx / Math.max(valid.length - 1, 1)) * 725;
            const openY = 18 + ((max - Number(c.open)) / span) * 204;
            const closeY = 18 + ((max - Number(c.close)) / span) * 204;
            const highY = 18 + ((max - Number(c.high)) / span) * 204;
            const lowY = 18 + ((max - Number(c.low)) / span) * 204;
            const bull = Number(c.close) >= Number(c.open);
            const color = bull ? '#10b981' : '#f43f5e';
            const isHovered = hoveredCandleIdx === idx;
            return (
              <g
                key={c.timestamp || c.time || idx}
                onMouseEnter={() => setHoveredCandleIdx(idx)}
                className="cursor-crosshair"
              >
                {isHovered && (
                  <line
                    x1={x}
                    x2={x}
                    y1={12}
                    y2={228}
                    stroke="rgba(251, 191, 36, 0.55)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}
                <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1.4" strokeOpacity="0.88" />
                <rect
                  x={x - 4.5}
                  y={Math.min(openY, closeY)}
                  width="9"
                  height={Math.max(Math.abs(closeY - openY), 2.5)}
                  fill={color}
                  rx="1.5"
                  stroke={isHovered ? '#fde68a' : 'none'}
                  strokeWidth={isHovered ? '1' : '0'}
                />
                <rect x={x - 7} y={12} width="14" height={216} fill="transparent" />
              </g>
            );
          })}

          <line
            x1="12"
            y1={currentY}
            x2="758"
            y2={currentY}
            stroke="#fbbf24"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          <rect x="760" y={currentY - 8} width="56" height="16" rx="3" fill="#fbbf24" />
          <text
            x="788"
            y={currentY + 3}
            textAnchor="middle"
            fill="#020617"
            fontSize="9"
            fontWeight="800"
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
  const activeShield = dynamicShieldLayers[activeShieldIdx] || dynamicShieldLayers[0];

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
                {isActive ? `GÓI ${tierLabel}` : expTs > 0 ? `GÓI ${tierLabel} · HẾT HẠN` : 'CHƯA CÓ GÓI'}
              </span>
              <span className="text-slate-200 font-medium">
                {isActive
                  ? `Còn hiệu lực ${daysLeft} ngày ${hoursLeft} giờ${expStr ? ` (đến ${expStr})` : ''} · ${Number(subInfo.max_cloud_accounts || 1)} khe cắm Cloud MT5`
                  : expTs > 0
                  ? `Gói đã hết hạn ngày ${expStr}. Gia hạn để tiếp tục nhận lệnh tự động.`
                  : 'Bạn chưa kích hoạt gói Cloud MT5 nào.'}
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
                {!isActive ? (expTs > 0 ? 'Gia Hạn Gói Ngay →' : 'Mua Gói Ngay →') : isExpiringSoon ? 'Gia Hạn Thêm →' : 'Quản Lý / Gia Hạn Gói'}
              </button>
            )}
          </div>
        );
      })()}

      {/* Row 1: 4 Executive Quantum Portfolio HUD Cards with Sparklines */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-amber-300">
              01 // TỔNG VỐN & EQUITY
            </span>
            <span className="rounded bg-amber-500/15 border border-amber-400/35 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
              USD LIVE
            </span>
          </div>
          <div className="mt-2.5 flex items-end justify-between gap-2">
            <div className="font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
              ${fmtNum(totalBalance, 2)}
            </div>
            <svg viewBox="0 0 80 26" className="h-6 w-20 overflow-visible">
              <polyline
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
                points={
                  series && series.length > 1
                    ? series
                        .slice(-10)
                        .map((s: any, idx: number, arr: any[]) => {
                          const x = (idx / (arr.length - 1)) * 80;
                          const minEq = Math.min(...arr.map((p: any) => Number(p.equity || p.balance || 0)));
                          const maxEq = Math.max(...arr.map((p: any) => Number(p.equity || p.balance || 0)));
                          const range = Math.max(maxEq - minEq, 1);
                          const val = Number(s.equity || s.balance || 0);
                          const y = 22 - ((val - minEq) / range) * 18;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        })
                        .join(' ')
                    : '0,13 80,13'
                }
              />
            </svg>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-2.5 text-xs text-slate-300">
            <span>Equity khả dụng</span>
            <strong className="font-mono text-amber-300 tabular-nums">${fmtNum(totalEquity, 2)}</strong>
          </div>
        </div>

        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-cyan-300">
              02 // FLOATING PNL
            </span>
            <span className="font-mono text-[10px] font-bold text-emerald-400">
              {totalPositions} VỊ THẾ MỞ
            </span>
          </div>
          <div
            className={`mt-2.5 font-mono text-2xl font-extrabold tracking-tight tabular-nums ${
              computedOpenPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {fmtPnL(computedOpenPnl)}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-2.5 text-xs text-slate-300">
            <span>Biến động phiên</span>
            <strong className="font-mono text-white tabular-nums">
              {totalBalance > 0
                ? `${computedOpenPnl >= 0 ? '+' : ''}${fmtNum((computedOpenPnl / totalBalance) * 100, 2)}%`
                : '0.00%'}
            </strong>
          </div>
        </div>

        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-amber-300">
              03 // PROP DAILY DD
            </span>
            <span className="font-mono text-[10px] font-bold text-emerald-400">SAFE ZONE</span>
          </div>
          <div
            className={`mt-2.5 font-mono text-2xl font-extrabold tracking-tight tabular-nums ${
              ddDanger ? 'text-rose-400' : 'text-amber-300'
            }`}
          >
            {fmtNum(computedDailyDd, 2)}%
          </div>
          <div className="mt-3 space-y-1.5 border-t border-white/[0.08] pt-2.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Trần bảo vệ ngày</span>
              <strong className="font-mono text-amber-200 tabular-nums">{fmtNum(maxDdLimitPct, 1)}%</strong>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/90">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  ddDanger
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-gradient-to-r from-amber-400 to-emerald-400'
                }`}
                style={{ width: `${Math.max(ddProgressPct, 6)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-emerald-400">
              04 // TRẠM CLOUD MT5
            </span>
            <span className="font-mono text-[10px] font-bold text-amber-300">
              {liveLatencyMs > 0 ? `${liveLatencyMs}ms` : 'LIVE'} LONDON G2
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
              {computedActiveAccounts} / {computedTotalAccounts}
            </span>
            <span className="text-xs font-medium text-slate-400">trạm trực tuyến</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-2.5 text-xs text-slate-300">
            <span className="truncate">{runtimeModeLabel}</span>
            <span className="inline-flex items-center gap-1.5 font-mono font-bold text-emerald-300 shrink-0">
              <span className={`h-2 w-2 rounded-full ${isMt5Connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              {isMt5Connected ? 'ĐÃ KẾT NỐI' : 'CHỜ ĐỒNG BỘ'}
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: Interactive 4-Layer Fail-Closed Capital Shield Matrix */}
      <div className="quant-panel p-5 sm:p-6 space-y-4">
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
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-300">
                <span className="font-bold uppercase tracking-wider text-amber-300">
                  LÁ CHẮN BẢO VỆ VỐN 4 LỚP (FAIL-CLOSED)
                </span>
                <span>·</span>
                <span className="font-semibold text-emerald-400">{safetyLockLabel}</span>
                <span>·</span>
                <span className="tabular-nums">
                  Khuyến nghị AI: <strong className="text-cyan-300">{latestAction}</strong>
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
                ⚙ Cấu Hình Giáp Vốn
              </button>
              <button
                type="button"
                onClick={() => activeTabSetter('orders')}
                className="quant-btn-primary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
              >
                ✦ Sổ Lệnh AI
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-white/[0.08] font-mono text-xs">
          {dynamicShieldLayers.map((layer, idx) => {
            const isSelected = activeShieldIdx === idx;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => setActiveShieldIdx(idx)}
                className={`rounded-xl border p-3.5 text-left transition flex items-center justify-between cursor-pointer ${
                  isSelected
                    ? 'border-amber-400/55 bg-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.14)]'
                    : 'border-white/[0.08] bg-[#040710]/85 hover:border-amber-500/30'
                }`}
              >
                <div>
                  <div className="text-[10px] text-amber-300 font-bold">
                    {layer.id}. {layer.code}
                  </div>
                  <div className="text-white font-bold mt-0.5">{layer.title}</div>
                </div>
                <div className="text-right">
                  <span className="text-emerald-400 font-bold block">{layer.status}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">{layer.latency}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: Primary Quantitative Chart Workstation + Connected MT5 Terminals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="quant-panel p-5 sm:p-6 lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300 font-bold">
                QUANTUM CHARTING & ORDERFLOW WORKSTATION
              </div>
              <h3 className="mt-0.5 text-base font-bold text-white">
                {chartMode === 'candles'
                  ? `Biểu Đồ Nến Định Lượng ${symbol} (${timeframe})`
                  : `Đường Cong Tăng Trưởng Equity (${chartDays} Ngày)`}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-amber-500/25 bg-[#040710] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setChartMode('candles');
                    if (loadCandles) loadCandles(timeframe);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-mono font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
                    chartMode === 'candles'
                      ? 'bg-amber-500/25 text-amber-200 border border-amber-400/45'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Nến {symbol}
                </button>
                <button
                  type="button"
                  onClick={() => setChartMode('equity')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-mono font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
                    chartMode === 'equity'
                      ? 'bg-amber-500/25 text-amber-200 border border-amber-400/45'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Lịch Sử Equity
                </button>
              </div>

              {chartMode === 'candles' && setTimeframe && (
                <div className="flex rounded-xl border border-white/10 bg-[#040710] p-1">
                  {(['M5', 'M15', 'H1'] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => {
                        setTimeframe(tf);
                        if (loadCandles) loadCandles(tf);
                      }}
                      className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
                        timeframe === tf
                          ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              )}

              {chartMode === 'equity' && (
                <div className="flex rounded-xl border border-white/10 bg-[#040710] p-1">
                  {[7, 30, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setChartDays(d)}
                      className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-bold transition whitespace-nowrap shrink-0 tabular-nums cursor-pointer ${
                        chartDays === d
                          ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
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

          {/* Bottom Execution Telemetry Micro-Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 font-mono text-xs tabular-nums">
            <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-3">
              <div className="text-[10px] text-slate-400">CHẾ ĐỘ THỊ TRƯỜNG</div>
              <div className="mt-0.5 font-bold text-amber-300">TREND EXPANSION</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-3">
              <div className="text-[10px] text-slate-400">BIÊN ĐỘ ATR(14)</div>
              <div className="mt-0.5 font-bold text-cyan-300">
                {liveAtr14 > 0 ? `${fmtNum(liveAtr14, 2)} USD (${fmtNum(liveAtr14 * 10, 1)}p)` : 'Đang đo ATR(14)...'}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-3">
              <div className="text-[10px] text-slate-400">AUTO BREAK-EVEN</div>
              <div className="mt-0.5 font-bold text-emerald-400">ARMED @ +1.0R</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#040710]/90 p-3">
              <div className="text-[10px] text-slate-400">ĐỘ TRỄ KHỚP LỆNH</div>
              <div className="mt-0.5 font-bold text-white">
                {liveLatencyMs > 0 ? `~${fmtNum(liveLatencyMs, 1)} ms G2` : 'G2 READY'}
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 Columns: Connected Cloud MT5 Nodes */}
        <div className="quant-panel flex flex-col justify-between p-5 sm:p-6 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300 font-bold">
                  CLOUD MT5 NODES
                </div>
                <h3 className="mt-0.5 text-base font-bold text-white">Tài Khoản MT5 Đang Ghép Nối</h3>
              </div>
              {activeTabSetter && (
                <button
                  type="button"
                  onClick={() => activeTabSetter('accounts')}
                  className="text-xs font-mono font-bold text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Quản lý ({accounts.length}) →
                </button>
              )}
            </div>

            {accounts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-amber-500/25 bg-[#040710]/60 p-6 text-center">
                <p className="text-sm font-semibold text-slate-200">Chưa có tài khoản MT5 nào được kết nối</p>
                <p className="mt-1 text-xs text-slate-400">
                  Kết nối tài khoản MetaTrader 5 để bắt đầu nhận tín hiệu định lượng XAU/USD tự động.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {accounts.slice(0, 4).map((acc: any) => {
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
                  return (
                    <div
                      key={accId}
                      className="rounded-xl border border-amber-500/20 bg-[#040710]/90 p-3.5 transition hover:border-amber-400/45"
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
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-slate-400 truncate">
                            #{accId} · {acc.broker_server || acc.server || 'MT5 Cloud'} · x
                            {fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)}
                          </div>
                        </div>
                        <span className="rounded bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300 shrink-0">
                          {isActive ? 'ONLINE' : 'PAUSED'}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-2.5 font-mono text-xs tabular-nums">
                        <div>
                          <div className="text-[10px] text-slate-500">BALANCE</div>
                          <div className="font-bold text-white">${fmtNum(acc.balance, 0)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">EQUITY</div>
                          <div className="font-bold text-amber-300">${fmtNum(acc.equity, 0)}</div>
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

          <div className="mt-4 border-t border-white/[0.08] pt-3.5 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Cầu nối MetaAPI London G2</span>
            <span className="text-amber-300 font-bold">
              {liveLatencyMs > 0 ? `${liveLatencyMs}ms` : 'LIVE'} · ZERO-VPS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
