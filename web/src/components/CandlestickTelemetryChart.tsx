import React, { useMemo } from 'react';
import { fmtNum } from '../utils/strategyDecision';
import { useLanguage } from '../i18n/LanguageContext';

export interface CandlestickTelemetryChartProps {
  candles: any[];
  symbol: string;
  timeframe: string;
  liveBid: number;
  liveAtr14: number;
  hoveredCandleIdx: number | null;
  setHoveredCandleIdx: (idx: number | null) => void;
  showEmaOverlay: boolean;
  setShowEmaOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  showBbChannel: boolean;
  setShowBbChannel: React.Dispatch<React.SetStateAction<boolean>>;
}

export const CandlestickTelemetryChart: React.FC<CandlestickTelemetryChartProps> = ({
  candles: valid,
  symbol,
  timeframe,
  liveBid,
  liveAtr14,
  hoveredCandleIdx,
  setHoveredCandleIdx,
  showEmaOverlay,
  setShowEmaOverlay,
  showBbChannel,
  setShowBbChannel,
}) => {
  const { lang } = useLanguage();

  if (!valid.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-amber-500/20 bg-[#040710]/90 text-xs font-mono uppercase tracking-[0.2em] text-amber-300">
        {lang === 'en'
          ? `Synchronizing ${symbol} (${timeframe}) candlestick feed...`
          : `Đang đồng bộ luồng nến ${symbol} (${timeframe})...`}
      </div>
    );
  }

  // Check if weekend or market closed (UTC: Saturday, Sunday, or Friday >= 22:00 UTC)
  const isWeekendClosed = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    return day === 0 || day === 6 || (day === 5 && hour >= 22);
  })();

  const flatCandlesCount = valid.filter(
    (c) => Math.abs(Number(c.high) - Number(c.low)) < 0.05
  ).length;
  const isMarketFlat = valid.length > 0 && (flatCandlesCount / valid.length >= 0.7 || isWeekendClosed);

  // Sanitize head outlier if candle 0 is wildly detached from the rest of the stream
  const sanitizedCandles = useMemo(() => {
    if (valid.length < 5) return valid;
    const tailCloses = valid.slice(1).map((c) => Number(c.close)).sort((a, b) => a - b);
    const median = tailCloses[Math.floor(tailCloses.length / 2)];
    const firstClose = Number(valid[0].close);
    if (Math.abs(firstClose - median) / (median || 1) > 0.03) {
      const sanitized0 = {
        ...valid[0],
        open: median,
        high: median,
        low: median,
        close: median,
      };
      return [sanitized0, ...valid.slice(1)];
    }
    return valid;
  }, [valid]);

  const highs = sanitizedCandles.map((c) => Number(c.high));
  const lows = sanitizedCandles.map((c) => Number(c.low));
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const rawSpan = rawMax - rawMin;
  const baseSpan = Math.max(rawSpan, 4.0);
  const pad = baseSpan * 0.08;
  const min = rawMin - pad;
  const max = rawMax + (rawSpan < 0.1 ? 4.0 : pad);
  const span = max - min || 1;
  const lastCandle = sanitizedCandles[sanitizedCandles.length - 1];
  const inspectedCandle =
    hoveredCandleIdx !== null && sanitizedCandles[hoveredCandleIdx]
      ? sanitizedCandles[hoveredCandleIdx]
      : lastCandle;
  const currentPrice = liveBid || Number(lastCandle.close);
  const currentY = 18 + ((max - currentPrice) / span) * 204;

  const emaPoints: string[] = [];
  const upperBandPoints: string[] = [];
  const lowerBandPoints: string[] = [];
  let ema = Number(sanitizedCandles[0].close);
  const k = 2 / (10 + 1);
  const effectiveAtr = liveAtr14 > 0 ? liveAtr14 : span * 0.12;
  const bandOffset = Math.max(4, Math.min(48, (effectiveAtr / span) * 204));
  sanitizedCandles.forEach((c, idx) => {
    const closeVal = Number(c.close);
    ema = idx === 0 ? closeVal : closeVal * k + ema * (1 - k);
    const x = 20 + (idx / Math.max(sanitizedCandles.length - 1, 1)) * 725;
    const y = 18 + ((max - ema) / span) * 204;
    emaPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    upperBandPoints.push(`${x.toFixed(1)},${Math.max(12, y - bandOffset).toFixed(1)}`);
    lowerBandPoints.push(`${x.toFixed(1)},${Math.min(228, y + bandOffset).toFixed(1)}`);
  });

  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-500/25 bg-[#040710]/95 p-3 sm:p-3.5 w-full max-w-full">
      {isMarketFlat && (
        <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="font-medium">
            {lang === 'en'
              ? 'Market Closed (Weekend) · Showing latest session candles'
              : 'Thị trường đóng cửa (Cuối tuần) · Hiển thị nến phiên gần nhất'}
          </span>
        </div>
      )}
      <div className="mb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5 text-xs font-mono">
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar py-0.5">
          <span className="inline-flex items-center gap-1.5 font-bold text-amber-300 shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            {symbol} · {timeframe}
          </span>
          <span className="text-slate-600 shrink-0">·</span>
          <span className="text-slate-400 tabular-nums shrink-0">
            O: <strong className="text-slate-200">{fmtNum(inspectedCandle.open, 2)}</strong>
          </span>
          <span className="text-slate-400 tabular-nums shrink-0">
            H: <strong className="text-emerald-300">{fmtNum(inspectedCandle.high, 2)}</strong>
          </span>
          <span className="text-slate-400 tabular-nums shrink-0">
            L: <strong className="text-rose-300">{fmtNum(inspectedCandle.low, 2)}</strong>
          </span>
          <span className="text-slate-400 tabular-nums shrink-0">
            C: <strong className="text-amber-300">{fmtNum(inspectedCandle.close, 2)}</strong>
          </span>
          <span className="text-slate-400 tabular-nums hidden sm:inline shrink-0">
            {lang === 'en' ? 'Range: ' : 'Biên độ: '}
            <strong className="text-cyan-300">
              {fmtNum((Number(inspectedCandle.high) - Number(inspectedCandle.low)) * 10, 1)} pips
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-2 tabular-nums shrink-0 self-end sm:self-auto">
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
          fill="#0B1220"
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
