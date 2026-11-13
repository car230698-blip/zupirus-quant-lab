import fs from 'fs';
import path from 'path';
import {
  CandleValidationResult,
  M15Candle,
  ReplayDataset,
} from './types.ts';

/**
 * Generates the deterministic XAUUSD M15 replay dataset used for acceptance verification.
 * All prices are realistic Gold spot prices (USD/oz around 2860.00 - 2915.00).
 * Every candle is deterministic so clean-clone runs, restarts, and walk-forward checks
 * produce 100% reproducible results.
 */
export function buildDeterministicReplayDataset(): ReplayDataset {
  const startMs = Date.parse('2026-03-02T08:00:00.000Z');
  const m15Ms = 15 * 60 * 1000;
  const candles: M15Candle[] = [];

  // Crafted price path segments (72 bars = 18 hours of XAUUSD M15 action)
  // Phase 1 (0..13): Initial lookback warmup (14 bars, 2860 -> 2866)
  // Phase 2 (14..31): Strong bullish trend with pullbacks & momentum bursts (TRENDING)
  // Phase 3 (32..43): Tight consolidation squeeze followed by breakout bursts (SQUEEZE_PRE_BREAKOUT)
  // Phase 4 (44..57): Mean-reverting range oscillation (RANGING) + 1 high-spread risk veto bar
  // Phase 5 (58..61): Macro volatility shock bar (VOLATILITY_SHOCK -> Stand Aside)
  // Phase 6 (62..71): Post-shock trending continuation under promoted adaptive policy
  const priceDeltas: Array<{
    deltaClose: number;
    highWick: number;
    lowWick: number;
    volume: number;
    spreadPts: number;
    note: string;
  }> = [
    // 1..14: Warmup bars (INSUFFICIENT_DATA for first 14 bars since minLookbackBars = 15)
    { deltaClose: 0.45, highWick: 0.60, lowWick: 0.40, volume: 920, spreadPts: 16, note: 'Warmup bar 1' },
    { deltaClose: -0.25, highWick: 0.50, lowWick: 0.55, volume: 880, spreadPts: 16, note: 'Warmup bar 2' },
    { deltaClose: 0.65, highWick: 0.70, lowWick: 0.35, volume: 950, spreadPts: 17, note: 'Warmup bar 3' },
    { deltaClose: 0.50, highWick: 0.55, lowWick: 0.30, volume: 1010, spreadPts: 16, note: 'Warmup bar 4' },
    { deltaClose: -0.30, highWick: 0.45, lowWick: 0.60, volume: 890, spreadPts: 18, note: 'Warmup bar 5' },
    { deltaClose: 0.80, highWick: 0.65, lowWick: 0.25, volume: 1120, spreadPts: 16, note: 'Warmup bar 6' },
    { deltaClose: 0.70, highWick: 0.60, lowWick: 0.30, volume: 1150, spreadPts: 15, note: 'Warmup bar 7' },
    { deltaClose: 0.40, highWick: 0.50, lowWick: 0.40, volume: 980, spreadPts: 16, note: 'Warmup bar 8' },
    { deltaClose: 0.90, highWick: 0.75, lowWick: 0.20, volume: 1240, spreadPts: 16, note: 'Warmup bar 9' },
    { deltaClose: 0.60, highWick: 0.55, lowWick: 0.35, volume: 1180, spreadPts: 17, note: 'Warmup bar 10' },
    { deltaClose: 0.85, highWick: 0.70, lowWick: 0.25, volume: 1300, spreadPts: 16, note: 'Warmup bar 11' },
    { deltaClose: 0.75, highWick: 0.65, lowWick: 0.30, volume: 1280, spreadPts: 16, note: 'Warmup bar 12' },
    { deltaClose: 1.10, highWick: 0.80, lowWick: 0.20, volume: 1420, spreadPts: 16, note: 'Warmup bar 13' },
    { deltaClose: 0.95, highWick: 0.70, lowWick: 0.25, volume: 1390, spreadPts: 16, note: 'Warmup bar 14 (End of warmup)' },

    // 15..30: Trending phase 1 (Strong uptrend with pullbacks & continuation)
    { deltaClose: 1.45, highWick: 0.85, lowWick: 0.25, volume: 1650, spreadPts: 16, note: 'Trending impulse 1 - Entry opportunity' },
    { deltaClose: 2.10, highWick: 1.10, lowWick: 0.20, volume: 1890, spreadPts: 16, note: 'Trending follow-through TP1 hit' },
    { deltaClose: 2.40, highWick: 1.25, lowWick: 0.15, volume: 2100, spreadPts: 15, note: 'Trending extension TP2 hit' },
    { deltaClose: -0.60, highWick: 0.45, lowWick: 0.65, volume: 1250, spreadPts: 17, note: 'Trending shallow pullback' },
    { deltaClose: 1.65, highWick: 0.90, lowWick: 0.20, volume: 1720, spreadPts: 16, note: 'Trending continuation entry 2' },
    { deltaClose: 1.95, highWick: 1.15, lowWick: 0.20, volume: 1940, spreadPts: 16, note: 'Trending rally TP1' },
    { deltaClose: 2.25, highWick: 1.30, lowWick: 0.25, volume: 2050, spreadPts: 16, note: 'Trending rally TP2' },
    { deltaClose: 1.40, highWick: 0.80, lowWick: 0.30, volume: 1680, spreadPts: 48, note: 'High spread bar (48 pts > 40 limit) -> Risk Veto test' },
    { deltaClose: 1.55, highWick: 0.95, lowWick: 0.20, volume: 1750, spreadPts: 16, note: 'Normal spread trend entry 3' },
    { deltaClose: 2.05, highWick: 1.10, lowWick: 0.20, volume: 1980, spreadPts: 16, note: 'Trend rally TP1' },
    { deltaClose: 2.30, highWick: 1.20, lowWick: 0.15, volume: 2120, spreadPts: 15, note: 'Trend rally TP2' },
    { deltaClose: -0.45, highWick: 0.40, lowWick: 0.55, volume: 1190, spreadPts: 16, note: 'Trend breather' },
    { deltaClose: 1.60, highWick: 0.90, lowWick: 0.25, volume: 1790, spreadPts: 16, note: 'Trend entry 4' },
    { deltaClose: 1.90, highWick: 1.05, lowWick: 0.20, volume: 1910, spreadPts: 16, note: 'Trend follow-through TP1' },
    { deltaClose: 2.20, highWick: 1.25, lowWick: 0.20, volume: 2080, spreadPts: 16, note: 'Trend completion TP2' },
    { deltaClose: 0.30, highWick: 0.40, lowWick: 0.35, volume: 1100, spreadPts: 16, note: 'Trend deceleration into squeeze' },

    // 31..44: Squeeze Pre-Breakout & Volatility Expansion bars
    { deltaClose: 0.12, highWick: 0.22, lowWick: 0.20, volume: 780, spreadPts: 15, note: 'Tight compression bar 1' },
    { deltaClose: -0.10, highWick: 0.18, lowWick: 0.22, volume: 740, spreadPts: 15, note: 'Tight compression bar 2' },
    { deltaClose: 0.08, highWick: 0.20, lowWick: 0.18, volume: 710, spreadPts: 15, note: 'Tight compression bar 3' },
    { deltaClose: -0.06, highWick: 0.16, lowWick: 0.19, volume: 690, spreadPts: 15, note: 'Tight compression bar 4' },
    { deltaClose: 0.10, highWick: 0.19, lowWick: 0.15, volume: 720, spreadPts: 15, note: 'Tight compression bar 5' },
    { deltaClose: -0.05, highWick: 0.17, lowWick: 0.17, volume: 680, spreadPts: 14, note: 'Tight compression bar 6' },
    { deltaClose: 0.14, highWick: 0.21, lowWick: 0.16, volume: 750, spreadPts: 15, note: 'Squeeze breakout trigger 1' },
    { deltaClose: 1.95, highWick: 1.15, lowWick: 0.15, volume: 2240, spreadPts: 16, note: 'Breakout expansion bar 1' },
    { deltaClose: 2.35, highWick: 1.30, lowWick: 0.15, volume: 2410, spreadPts: 16, note: 'Breakout expansion bar 2 (TP2)' },
    { deltaClose: 0.05, highWick: 0.18, lowWick: 0.18, volume: 760, spreadPts: 15, note: 'Secondary tight compression' },
    { deltaClose: -0.08, highWick: 0.16, lowWick: 0.18, volume: 730, spreadPts: 15, note: 'Secondary tight compression 2' },
    { deltaClose: 0.15, highWick: 0.22, lowWick: 0.15, volume: 810, spreadPts: 15, note: 'Squeeze breakout trigger 2' },
    { deltaClose: 1.85, highWick: 1.10, lowWick: 0.15, volume: 2150, spreadPts: 16, note: 'Breakout follow-through 1' },
    { deltaClose: 2.15, highWick: 1.25, lowWick: 0.15, volume: 2300, spreadPts: 16, note: 'Breakout follow-through 2' },

    // 45..58: Ranging / Mean Reversion Regime
    { deltaClose: -2.10, highWick: 0.30, lowWick: 0.85, volume: 1540, spreadPts: 16, note: 'Range lower extreme dip 1 -> Mean revert BUY' },
    { deltaClose: 1.35, highWick: 0.75, lowWick: 0.20, volume: 1480, spreadPts: 16, note: 'Range reversion bounce 1 (TP1)' },
    { deltaClose: 1.50, highWick: 0.85, lowWick: 0.20, volume: 1520, spreadPts: 16, note: 'Range reversion target 1 (TP2)' },
    { deltaClose: -2.20, highWick: 0.25, lowWick: 0.90, volume: 1610, spreadPts: 16, note: 'Range lower extreme dip 2 -> Mean revert BUY' },
    { deltaClose: 1.40, highWick: 0.80, lowWick: 0.20, volume: 1490, spreadPts: 16, note: 'Range reversion bounce 2 (TP1)' },
    { deltaClose: 1.60, highWick: 0.90, lowWick: 0.20, volume: 1560, spreadPts: 16, note: 'Range reversion target 2 (TP2)' },
    { deltaClose: -2.05, highWick: 0.25, lowWick: 0.80, volume: 1580, spreadPts: 16, note: 'Range lower extreme dip 3 -> Mean revert BUY' },
    { deltaClose: 1.30, highWick: 0.70, lowWick: 0.20, volume: 1440, spreadPts: 16, note: 'Range reversion bounce 3 (TP1)' },
    { deltaClose: 1.55, highWick: 0.85, lowWick: 0.20, volume: 1510, spreadPts: 16, note: 'Range reversion target 3 (TP2)' },
    { deltaClose: -1.95, highWick: 0.30, lowWick: 0.75, volume: 1490, spreadPts: 16, note: 'Range lower extreme dip 4' },
    { deltaClose: 1.25, highWick: 0.70, lowWick: 0.25, volume: 1420, spreadPts: 16, note: 'Range bounce 4' },
    { deltaClose: 1.45, highWick: 0.80, lowWick: 0.20, volume: 1470, spreadPts: 16, note: 'Range completion 4' },
    { deltaClose: -0.20, highWick: 0.45, lowWick: 0.45, volume: 1120, spreadPts: 16, note: 'Range equilibrium' },
    { deltaClose: 0.25, highWick: 0.50, lowWick: 0.40, volume: 1150, spreadPts: 16, note: 'Range equilibrium 2' },

    // 59..61: Macro Volatility Shock (VOLATILITY_SHOCK -> Stand Aside)
    { deltaClose: 6.80, highWick: 4.50, lowWick: 3.90, volume: 4850, spreadPts: 34, note: 'Macro news shock spike (Range > 15 USD in 15m) -> VOLATILITY_SHOCK Stand Aside' },
    { deltaClose: -3.40, highWick: 3.80, lowWick: 3.60, volume: 4120, spreadPts: 30, note: 'Post-shock whipsaw bar -> VOLATILITY_SHOCK Stand Aside' },
    { deltaClose: 1.20, highWick: 0.90, lowWick: 0.75, volume: 1850, spreadPts: 18, note: 'Shock stabilization bar' },

    // 62..72: Post-shock Trend Resumption under Adaptive Policy
    { deltaClose: 1.70, highWick: 0.95, lowWick: 0.20, volume: 1820, spreadPts: 16, note: 'Post-shock trend resumption entry 1' },
    { deltaClose: 2.15, highWick: 1.15, lowWick: 0.20, volume: 1960, spreadPts: 16, note: 'Post-shock trend TP1' },
    { deltaClose: 2.45, highWick: 1.25, lowWick: 0.15, volume: 2140, spreadPts: 16, note: 'Post-shock trend TP2' },
    { deltaClose: -0.40, highWick: 0.45, lowWick: 0.50, volume: 1320, spreadPts: 16, note: 'Post-shock pullback' },
    { deltaClose: 1.80, highWick: 1.00, lowWick: 0.20, volume: 1890, spreadPts: 16, note: 'Adaptive policy trend entry 2' },
    { deltaClose: 2.10, highWick: 1.10, lowWick: 0.20, volume: 2010, spreadPts: 16, note: 'Adaptive policy trend TP1' },
    { deltaClose: 2.35, highWick: 1.25, lowWick: 0.15, volume: 2180, spreadPts: 16, note: 'Adaptive policy trend TP2' },
    { deltaClose: 1.60, highWick: 0.90, lowWick: 0.25, volume: 1760, spreadPts: 16, note: 'Adaptive policy trend entry 3' },
    { deltaClose: 2.00, highWick: 1.10, lowWick: 0.20, volume: 1920, spreadPts: 16, note: 'Adaptive policy trend TP1' },
    { deltaClose: 2.30, highWick: 1.20, lowWick: 0.20, volume: 2090, spreadPts: 16, note: 'Adaptive policy trend TP2 & Final bar' },
    { deltaClose: 0.85, highWick: 0.60, lowWick: 0.30, volume: 1540, spreadPts: 16, note: 'Closing settlement bar 72' },
  ];

  let currentPrice = 2860.0;
  for (let i = 0; i < priceDeltas.length; i++) {
    const spec = priceDeltas[i];
    const openTimeMs = startMs + i * m15Ms;
    const closeTimeMs = openTimeMs + m15Ms;
    const open = Number(currentPrice.toFixed(2));
    const close = Number((open + spec.deltaClose).toFixed(2));
    const maxOC = Math.max(open, close);
    const minOC = Math.min(open, close);
    const high = Number((maxOC + spec.highWick).toFixed(2));
    const low = Number((minOC - spec.lowWick).toFixed(2));

    candles.push({
      candleId: `XAU-M15-${String(i + 1).padStart(4, '0')}`,
      symbol: 'XAUUSD',
      timeframe: 'M15',
      openTime: new Date(openTimeMs).toISOString(),
      closeTime: new Date(closeTimeMs).toISOString(),
      open,
      high,
      low,
      close,
      volume: spec.volume,
      spreadPts: spec.spreadPts,
      isClosed: true,
      syntheticNote: spec.note,
    });

    currentPrice = close;
  }

  return {
    metadata: {
      datasetId: 'ZUPIRUS-XAUUSD-M15-ACCEPTANCE-V1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      sourceDescription:
        'Bộ dữ liệu phát lại XAUUSD M15 xác định (Deterministic Replay Dataset) phục vụ nghiệm thu vòng đời tự vận hành.',
      syntheticDisclosure:
        'Dữ liệu tổng hợp có kiểm soát (72 nến M15 = 18 giờ thị trường), hiệu chuẩn theo biên độ giá vàng giao ngay (2860–2915 USD/oz) để bao phủ đủ 5 trạng thái thị trường (Thiếu dữ liệu, Có xu hướng, Co hẹp trước phá vỡ, Đi ngang, Biến động sốc), kiểm tra phủ quyết rủi ro và kích hoạt học Walk-Forward trong một phiên nghiệm thu ngắn.',
      expectedFirstPolicyUpdateCycle: 32,
      expectedFirstPolicyUpdateSecondsAtDefaultSpeed: 26,
      intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST',
      totalCandles: candles.length,
    },
    candles,
  };
}

export function ensureReplayDatasetFile(filePath: string): ReplayDataset {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(resolved)) {
    const dataset = buildDeterministicReplayDataset();
    fs.writeFileSync(resolved, JSON.stringify(dataset, null, 2), 'utf-8');
    return dataset;
  }
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as ReplayDataset;
}

/**
 * Validates an incoming closed M15 candle:
 * - Verifies closed status (isClosed === true)
 * - Deduplicates against processedCandleIds
 * - Checks strict chronological order against lastProcessedMarketTime
 * - Detects unexpected M15 time gaps (> 15 minutes)
 * - Validates OHLC integrity and finite positive numbers
 * - Distinguishes Market Time (closeTime) from System Time (systemReceivedTime)
 */
export function validateIncomingCandle(
  candle: M15Candle,
  lastProcessedMarketTime: string | null,
  processedCandleIds: Set<string>,
  systemReceivedTime: string = new Date().toISOString()
): CandleValidationResult {
  // 1. Check closed status
  if (!candle.isClosed) {
    return {
      valid: false,
      candleId: candle.candleId,
      marketCloseTime: candle.closeTime,
      systemReceivedTime,
      isDuplicate: false,
      hasTimeGap: false,
      gapMinutes: 0,
      errorCode: 'NOT_CLOSED',
      reasonVi: `Bỏ qua nến ${candle.candleId} vì chưa đóng (isClosed = false). Chỉ xử lý nến M15 đã đóng hoàn tất.`,
    };
  }

  // 2. Check duplicate ID
  if (processedCandleIds.has(candle.candleId)) {
    return {
      valid: false,
      candleId: candle.candleId,
      marketCloseTime: candle.closeTime,
      systemReceivedTime,
      isDuplicate: true,
      hasTimeGap: false,
      gapMinutes: 0,
      errorCode: 'DUPLICATE_CANDLE',
      reasonVi: `Nến trùng lặp (${candle.candleId}) đã được xử lý trước đó. Giữ nguyên trạng thái (Idempotent).`,
    };
  }

  // 3. Check finite numbers
  const nums = [candle.open, candle.high, candle.low, candle.close, candle.volume, candle.spreadPts];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return {
      valid: false,
      candleId: candle.candleId,
      marketCloseTime: candle.closeTime,
      systemReceivedTime,
      isDuplicate: false,
      hasTimeGap: false,
      gapMinutes: 0,
      errorCode: 'NON_FINITE_VALUES',
      reasonVi: `Nến ${candle.candleId} chứa giá trị không hợp lệ (NaN/Infinity).`,
    };
  }

  // 4. Check volume
  if (candle.volume < 0 || candle.open <= 0 || candle.low <= 0) {
    return {
      valid: false,
      candleId: candle.candleId,
      marketCloseTime: candle.closeTime,
      systemReceivedTime,
      isDuplicate: false,
      hasTimeGap: false,
      gapMinutes: 0,
      errorCode: 'NEGATIVE_VOLUME',
      reasonVi: `Nến ${candle.candleId} có khối lượng hoặc mức giá âm/bằng 0 không hợp lệ.`,
    };
  }

  // 5. Check OHLC integrity
  const maxOC = Math.max(candle.open, candle.close);
  const minOC = Math.min(candle.open, candle.close);
  if (candle.high < maxOC - 1e-6 || candle.low > minOC + 1e-6 || candle.high < candle.low) {
    return {
      valid: false,
      candleId: candle.candleId,
      marketCloseTime: candle.closeTime,
      systemReceivedTime,
      isDuplicate: false,
      hasTimeGap: false,
      gapMinutes: 0,
      errorCode: 'INVALID_OHLC',
      reasonVi: `Nến ${candle.candleId} vi phạm cấu trúc OHLC (High=${candle.high}, Low=${candle.low}, Open=${candle.open}, Close=${candle.close}).`,
    };
  }

  // 6. Check chronological order and time gap
  const closeMs = Date.parse(candle.closeTime);
  if (Number.isNaN(closeMs)) {
    return {
      valid: false,
      candleId: candle.candleId,
      marketCloseTime: candle.closeTime,
      systemReceivedTime,
      isDuplicate: false,
      hasTimeGap: false,
      gapMinutes: 0,
      errorCode: 'INVALID_OHLC',
      reasonVi: `Thời gian đóng nến (${candle.closeTime}) không đúng định dạng ISO-8601.`,
    };
  }

  let hasTimeGap = false;
  let gapMinutes = 0;

  if (lastProcessedMarketTime) {
    const prevMs = Date.parse(lastProcessedMarketTime);
    if (closeMs <= prevMs) {
      return {
        valid: false,
        candleId: candle.candleId,
        marketCloseTime: candle.closeTime,
        systemReceivedTime,
        isDuplicate: closeMs === prevMs,
        hasTimeGap: false,
        gapMinutes: 0,
        errorCode: 'OUT_OF_ORDER',
        reasonVi: `Nến ${candle.candleId} (${candle.closeTime}) có thời gian thị trường nhỏ hơn hoặc bằng nến trước (${lastProcessedMarketTime}).`,
      };
    }
    gapMinutes = Math.round((closeMs - prevMs) / 60000);
    if (gapMinutes > 15) {
      hasTimeGap = true;
    }
  }

  return {
    valid: true,
    candleId: candle.candleId,
    marketCloseTime: candle.closeTime,
    systemReceivedTime,
    isDuplicate: false,
    hasTimeGap,
    gapMinutes,
    reasonVi: hasTimeGap
      ? `Nến hợp lệ nhưng phát hiện khoảng trống thời gian ${gapMinutes} phút (vượt chu kỳ chuẩn 15 phút).`
      : 'Nến M15 đã đóng hợp lệ, đúng thứ tự thời gian thị trường.',
  };
}
