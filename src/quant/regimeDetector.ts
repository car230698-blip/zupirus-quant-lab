import {
  M15Candle,
  MarketRegime,
  REGIME_LABELS_VI,
  RegimeClassification,
  RegimeIndicators,
  RegimeThresholds,
} from './types.ts';

export const DEFAULT_REGIME_THRESHOLDS: RegimeThresholds = {
  minLookbackBars: 15,
  shockAtrRatioMin: 2.35,
  squeezeBbWidthMaxPct: 0.145,
  trendingAdxMin: 18.0,
  trendingEmaSpreadMin: 0.65,
};

function computeEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return Number(ema.toFixed(4));
}

function computeRSI(closes: number[], period: number = 14): number {
  if (closes.length < 2) return 50;
  const start = Math.max(1, closes.length - period);
  let gains = 0;
  let losses = 0;
  let count = 0;
  for (let i = start; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
    count++;
  }
  if (count === 0) return 50;
  const avgGain = gains / count;
  const avgLoss = losses / count;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function computeATR(candles: M15Candle[], period: number = 14): number {
  if (candles.length === 0) return 0;
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      trs.push(c.high - c.low);
    } else {
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
      trs.push(tr);
    }
  }
  const slice = trs.slice(-period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return Number((sum / slice.length).toFixed(4));
}

/**
 * Computes causal technical indicators using ONLY closed candles up to the decision point.
 * Zero look-ahead guarantee: future candles are never passed or accessed.
 */
export function computeCausalIndicators(candlesUpToDecision: M15Candle[]): RegimeIndicators {
  const n = candlesUpToDecision.length;
  if (n === 0) {
    return {
      validLookbackBars: 0,
      emaFast20: 0,
      emaSlow50: 0,
      emaSlope: 0,
      adxProxy: 0,
      rsi14: 50,
      atr14: 0,
      atrRatio: 1,
      bbUpper: 0,
      bbMiddle: 0,
      bbLower: 0,
      bbWidthPct: 0,
      zScore20: 0,
      donchianHigh12: 0,
      donchianLow12: 0,
    };
  }

  const closes = candlesUpToDecision.map((c) => c.close);
  const emaFast20 = computeEMA(closes.slice(-25), 10);
  const emaSlow50 = computeEMA(closes.slice(-45), 24);
  const prevCloses = closes.length > 3 ? closes.slice(0, -3) : closes;
  const prevEmaFast = computeEMA(prevCloses.slice(-25), 10);
  const emaSlope = Number((emaFast20 - prevEmaFast).toFixed(4));

  const rsi14 = computeRSI(closes, 14);
  const atr14 = computeATR(candlesUpToDecision, 14);
  const lastCandle = candlesUpToDecision[n - 1];
  const prevClose = n > 1 ? candlesUpToDecision[n - 2].close : lastCandle.open;
  const currentBarTr = Math.max(
    lastCandle.high - lastCandle.low,
    Math.abs(lastCandle.high - prevClose),
    Math.abs(lastCandle.low - prevClose)
  );
  const baselineAtr = computeATR(candlesUpToDecision.slice(0, -1), 14) || atr14 || 1;
  const atrRatio = Number((currentBarTr / Math.max(0.25, baselineAtr)).toFixed(3));

  // Bollinger Bands (window up to 12 bars for responsive M15 regime detection)
  const bbWindow = closes.slice(-12);
  const bbMiddle = bbWindow.reduce((a, b) => a + b, 0) / bbWindow.length;
  const variance =
    bbWindow.reduce((acc, val) => acc + Math.pow(val - bbMiddle, 2), 0) / bbWindow.length;
  const stdDev = Math.sqrt(variance);
  const bbUpper = Number((bbMiddle + 2 * stdDev).toFixed(2));
  const bbLower = Number((bbMiddle - 2 * stdDev).toFixed(2));
  const bbWidthPct =
    bbMiddle > 0 ? Number((((bbUpper - bbLower) / bbMiddle) * 100).toFixed(4)) : 0;
  const zScore20 =
    stdDev > 1e-5 ? Number(((lastCandle.close - bbMiddle) / stdDev).toFixed(3)) : 0;

  // Directional Efficiency / ADX Proxy (0..100 scale) over recent 10 bars
  const dirSlice = candlesUpToDecision.slice(-10);
  let netMove = 0;
  let totalPath = 0;
  if (dirSlice.length >= 2) {
    netMove = Math.abs(dirSlice[dirSlice.length - 1].close - dirSlice[0].open);
    for (let i = 0; i < dirSlice.length; i++) {
      totalPath += Math.max(0.1, dirSlice[i].high - dirSlice[i].low);
    }
  }
  const efficiency = totalPath > 0 ? netMove / totalPath : 0;
  const adxProxy = Number(Math.min(95, efficiency * 100).toFixed(2));

  // Donchian channel over prior 10 closed bars (excluding current bar for breakout reference)
  const priorSlice =
    candlesUpToDecision.length > 1
      ? candlesUpToDecision.slice(-11, -1)
      : candlesUpToDecision;
  const donchianHigh12 = Number(
    Math.max(...priorSlice.map((c) => c.high)).toFixed(2)
  );
  const donchianLow12 = Number(
    Math.min(...priorSlice.map((c) => c.low)).toFixed(2)
  );

  return {
    validLookbackBars: n,
    emaFast20,
    emaSlow50,
    emaSlope,
    adxProxy,
    rsi14,
    atr14,
    atrRatio,
    bbUpper,
    bbMiddle: Number(bbMiddle.toFixed(2)),
    bbLower,
    bbWidthPct,
    zScore20,
    donchianHigh12,
    donchianLow12,
  };
}

/**
 * Classifies the market regime using ONLY closed candles available at the moment of decision.
 */
export function classifyMarketRegime(
  cycleId: string,
  candlesUpToDecision: M15Candle[],
  hasSevereTimeGap: boolean = false,
  thresholds: RegimeThresholds = DEFAULT_REGIME_THRESHOLDS,
  systemTime: string = new Date().toISOString()
): RegimeClassification {
  const currentCandle = candlesUpToDecision[candlesUpToDecision.length - 1];
  const indicators = computeCausalIndicators(candlesUpToDecision);

  // 1. Check for insufficient data or severe time gap
  if (
    indicators.validLookbackBars < thresholds.minLookbackBars ||
    hasSevereTimeGap
  ) {
    const reasonVi = hasSevereTimeGap
      ? `Phát hiện khoảng trống dữ liệu bất thường trên chuỗi nến M15. Đứng ngoài để chờ ổn định chuỗi chỉ báo.`
      : `Số nến lịch sử hợp lệ (${indicators.validLookbackBars}) nhỏ hơn ngưỡng tối thiểu (${thresholds.minLookbackBars} nến M15). Đứng ngoài chờ đủ dữ liệu.`;
    return {
      cycleId,
      candleId: currentCandle.candleId,
      marketTime: currentCandle.closeTime,
      systemTime,
      regime: 'INSUFFICIENT_DATA',
      regimeLabelVi: REGIME_LABELS_VI.INSUFFICIENT_DATA,
      confidence: 1.0,
      allowTrading: false,
      standAsideReasonVi: reasonVi,
      indicators,
      thresholds,
      reasonVi,
    };
  }

  // 2. Check for Volatility Shock (Biến động sốc)
  const currentRange = currentCandle.high - currentCandle.low;
  if (
    indicators.atrRatio >= thresholds.shockAtrRatioMin ||
    currentRange >= 8.5
  ) {
    const reasonVi = `Biến động sốc: Tỷ lệ ATR thực tế (${indicators.atrRatio}x, biên độ nến ${currentRange.toFixed(
      2
    )} USD) vượt ngưỡng sốc (${thresholds.shockAtrRatioMin}x). Hệ thống tự động đứng ngoài bảo toàn vốn.`;
    return {
      cycleId,
      candleId: currentCandle.candleId,
      marketTime: currentCandle.closeTime,
      systemTime,
      regime: 'VOLATILITY_SHOCK',
      regimeLabelVi: REGIME_LABELS_VI.VOLATILITY_SHOCK,
      confidence: 0.96,
      allowTrading: false,
      standAsideReasonVi: reasonVi,
      indicators,
      thresholds,
      reasonVi,
    };
  }

  // 3. Check for Squeeze Pre-Breakout (Co hẹp trước phá vỡ)
  // Either current BBWidth is compressed OR prior 4 bars had tight range (< 0.55 avg range)
  const recentPrior = candlesUpToDecision.slice(-6, -1);
  const avgPriorRange =
    recentPrior.reduce((acc, c) => acc + (c.high - c.low), 0) /
    Math.max(1, recentPrior.length);
  const isCompressed =
    indicators.bbWidthPct <= thresholds.squeezeBbWidthMaxPct ||
    avgPriorRange <= 0.58;

  if (isCompressed) {
    const reasonVi = `Co hẹp trước phá vỡ: Độ rộng dải Bollinger (${indicators.bbWidthPct.toFixed(
      3
    )}%) <= ngưỡng (${thresholds.squeezeBbWidthMaxPct}%) hoặc biên độ nén trung bình 5 nến trước (${avgPriorRange.toFixed(
      2
    )} USD <= 0.58 USD). Ưu tiên chiến lược phá vỡ biến động.`;
    return {
      cycleId,
      candleId: currentCandle.candleId,
      marketTime: currentCandle.closeTime,
      systemTime,
      regime: 'SQUEEZE_PRE_BREAKOUT',
      regimeLabelVi: REGIME_LABELS_VI.SQUEEZE_PRE_BREAKOUT,
      confidence: 0.88,
      allowTrading: true,
      indicators,
      thresholds,
      reasonVi,
    };
  }

  // 4. Check for Ranging / Mean Reversion vs Trending
  const emaSpread = Math.abs(indicators.emaFast20 - indicators.emaSlow50);
  const isSharpDipInRange =
    indicators.zScore20 <= -1.15 && indicators.emaSlope < 0.35;

  if (
    !isSharpDipInRange &&
    indicators.adxProxy >= thresholds.trendingAdxMin &&
    emaSpread >= thresholds.trendingEmaSpreadMin
  ) {
    const dirText =
      indicators.emaFast20 >= indicators.emaSlow50 ? 'Tăng (Bullish)' : 'Giảm (Bearish)';
    const reasonVi = `Có xu hướng ${dirText}: Chỉ báo cường độ xu hướng ADX-Proxy (${indicators.adxProxy}) >= ${thresholds.trendingAdxMin}, độ lệch EMA20/EMA50 (${emaSpread.toFixed(
      2
    )} USD) >= ${thresholds.trendingEmaSpreadMin} USD.`;
    return {
      cycleId,
      candleId: currentCandle.candleId,
      marketTime: currentCandle.closeTime,
      systemTime,
      regime: 'TRENDING',
      regimeLabelVi: REGIME_LABELS_VI.TRENDING,
      confidence: 0.89,
      allowTrading: true,
      indicators,
      thresholds,
      reasonVi,
    };
  }

  // 5. Otherwise Ranging (Đi ngang)
  const reasonVi = `Đi ngang (Ranging): Độ lệch Z-Score (${indicators.zScore20.toFixed(
    2
  )}), ADX-Proxy (${indicators.adxProxy}) hoặc độ dốc EMA (${indicators.emaSlope.toFixed(
    2
  )}) phản ánh trạng thái dao động quanh vùng cân bằng (${indicators.bbMiddle.toFixed(
    2
  )} USD).`;
  return {
    cycleId,
    candleId: currentCandle.candleId,
    marketTime: currentCandle.closeTime,
    systemTime,
    regime: 'RANGING',
    regimeLabelVi: REGIME_LABELS_VI.RANGING,
    confidence: 0.84,
    allowTrading: true,
    indicators,
    thresholds,
    reasonVi,
  };
}
