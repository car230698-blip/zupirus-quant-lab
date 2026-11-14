import fs from 'fs';
import path from 'path';
import type { ReplayQuote } from './tickReplay.ts';
import {
  BrokerSessionScheduleConfig,
  DEFAULT_BROKER_SCHEDULE,
  evaluateMarketSchedule,
} from './marketSchedule.ts';
import type { M15Candle } from './types.ts';

export interface IngestedTickInput {
  timeMs: number;
  bid: number;
  ask: number;
  seqWithinMs?: number;
  sourceTickId?: string;
  rawSymbol?: string;
}

export interface TickBatchPayload {
  batchId: string;
  collectorId?: string;
  rawSymbol?: string;
  symbol?: string;
  sentAtUtc?: string;
  ticks: IngestedTickInput[];
}

export type DataSourceConnectionState =
  | 'REPLAY_OFFLINE'
  | 'STREAMING_LIVE'
  | 'WAITING_FOR_QUOTES'
  | 'MARKET_CLOSED'
  | 'DISCONNECTED';

export interface InProgressM15Bar {
  bucketStartMs: number;
  bucketEndMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spreadPts: number;
  firstTickTimeMs: number;
  lastTickTimeMs: number;
  quotes: Array<ReplayQuote & { seqWithinMs: number }>;
}

export interface DataSourceTelemetry {
  sourceMode: 'REPLAY_DATASET' | 'MT5_DEMO_LIVE';
  connectionState: DataSourceConnectionState;
  connectionLabelVi: string;
  rawSymbol: string;
  canonicalSymbol: 'XAUUSD';
  collectorId: string | null;
  lastBatchId: string | null;
  lastQuoteMarketTime: string | null;
  lastQuoteSystemTime: string | null;
  lastQuoteBid: number | null;
  lastQuoteAsk: number | null;
  lastQuoteSpreadPts: number | null;
  watermarkTimeMs: number | null;
  watermarkSeqWithinMs: number;
  totalBatchesAccepted: number;
  duplicateBatchesSkipped: number;
  totalValidTicksAccepted: number;
  sameMillisecondTicksAccepted: number;
  duplicateTicksSkipped: number;
  outOfOrderTicksRejected: number;
  invalidTicksRejected: number;
  staleQuotesDetected: number;
  isLatestQuoteStale: boolean;
  gapCount: number;
  lastGapDurationMs: number;
  closedBarsBuiltFromTicks: number;
  inProgressBarOpenTime: string | null;
  inProgressBarTickCount: number;
}

export interface PersistedTickIngestionState {
  telemetry: DataSourceTelemetry;
  inProgressBar: InProgressM15Bar | null;
  processedBatchIds: string[];
  recentAcceptedTickKeys: string[];
  completedBarQuotesByCandleId: Record<string, ReplayQuote[]>;
  firstAfterCloseQuoteByCandleId: Record<string, ReplayQuote>;
}

export interface TickBatchIngestResult {
  acknowledged: boolean;
  idempotentReplay: boolean;
  batchId: string;
  acceptedTicks: number;
  sameMillisecondAccepted: number;
  duplicateTicksSkipped: number;
  outOfOrderRejected: number;
  invalidRejected: number;
  staleDetected: number;
  closedCandlesEmitted: string[];
  watermarkTimeMs: number | null;
  watermarkSeqWithinMs: number;
  connectionState: DataSourceConnectionState;
}

const M15_MS = 15 * 60 * 1000;
const DEFAULT_GAP_THRESHOLD_MS = 60 * 1000;
const DEFAULT_STALE_THRESHOLD_MS = 30 * 1000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 45 * 1000;

export function normalizeXauSymbol(rawSymbol?: string): {
  rawSymbol: string;
  canonicalSymbol: 'XAUUSD';
  valid: boolean;
} {
  const cleaned = (rawSymbol || 'XAUUSD').trim();
  const upper = cleaned.toUpperCase();
  const valid = upper.startsWith('XAUUSD') || upper.startsWith('GOLD');
  return {
    rawSymbol: cleaned || 'XAUUSD',
    canonicalSymbol: 'XAUUSD',
    valid,
  };
}

export function createInitialDataSourceTelemetry(
  sourceMode: 'REPLAY_DATASET' | 'MT5_DEMO_LIVE' = 'REPLAY_DATASET'
): DataSourceTelemetry {
  return {
    sourceMode,
    connectionState: sourceMode === 'REPLAY_DATASET' ? 'REPLAY_OFFLINE' : 'WAITING_FOR_QUOTES',
    connectionLabelVi:
      sourceMode === 'REPLAY_DATASET'
        ? 'Chế độ Phát lại Xác định (Offline Replay)'
        : 'Đang chờ báo giá Bid/Ask từ bộ thu MT5 Demo',
    rawSymbol: 'XAUUSD',
    canonicalSymbol: 'XAUUSD',
    collectorId: null,
    lastBatchId: null,
    lastQuoteMarketTime: null,
    lastQuoteSystemTime: null,
    lastQuoteBid: null,
    lastQuoteAsk: null,
    lastQuoteSpreadPts: null,
    watermarkTimeMs: null,
    watermarkSeqWithinMs: 0,
    totalBatchesAccepted: 0,
    duplicateBatchesSkipped: 0,
    totalValidTicksAccepted: 0,
    sameMillisecondTicksAccepted: 0,
    duplicateTicksSkipped: 0,
    outOfOrderTicksRejected: 0,
    invalidTicksRejected: 0,
    staleQuotesDetected: 0,
    isLatestQuoteStale: false,
    gapCount: 0,
    lastGapDurationMs: 0,
    closedBarsBuiltFromTicks: 0,
    inProgressBarOpenTime: null,
    inProgressBarTickCount: 0,
  };
}

export function createInitialTickIngestionState(
  sourceMode: 'REPLAY_DATASET' | 'MT5_DEMO_LIVE' = 'REPLAY_DATASET'
): PersistedTickIngestionState {
  return {
    telemetry: createInitialDataSourceTelemetry(sourceMode),
    inProgressBar: null,
    processedBatchIds: [],
    recentAcceptedTickKeys: [],
    completedBarQuotesByCandleId: {},
    firstAfterCloseQuoteByCandleId: {},
  };
}

/**
 * Evaluates live source connection status, distinguishing:
 * - MARKET_CLOSED (market closed per broker schedule)
 * - WAITING_FOR_QUOTES (market open, no live quote received yet or quiet)
 * - DISCONNECTED (live stream active previously, but no batch received within disconnect timeout while market is open)
 * - STREAMING_LIVE (receiving quotes normally)
 * - REPLAY_OFFLINE (running deterministic replay dataset)
 */
export function evaluateDataSourceStatus(params: {
  telemetry: DataSourceTelemetry;
  schedule?: BrokerSessionScheduleConfig;
  referenceMarketTimeIso?: string | null;
  nowSystemMs?: number;
  disconnectTimeoutMs?: number;
}): {
  connectionState: DataSourceConnectionState;
  connectionLabelVi: string;
} {
  const {
    telemetry,
    schedule = DEFAULT_BROKER_SCHEDULE,
    referenceMarketTimeIso,
    nowSystemMs = Date.now(),
    disconnectTimeoutMs = DEFAULT_DISCONNECT_TIMEOUT_MS,
  } = params;

  const evalTimeIso =
    telemetry.lastQuoteMarketTime ||
    referenceMarketTimeIso ||
    new Date(nowSystemMs).toISOString();
  const schedEval = evaluateMarketSchedule(evalTimeIso, schedule);

  if (schedEval.sessionState === 'MARKET_CLOSED') {
    return {
      connectionState: 'MARKET_CLOSED',
      connectionLabelVi: `Thị trường đang đóng cửa (${schedEval.reasonVi})`,
    };
  }

  if (telemetry.sourceMode === 'REPLAY_DATASET' && telemetry.totalBatchesAccepted === 0) {
    return {
      connectionState: 'REPLAY_OFFLINE',
      connectionLabelVi: 'Chế độ Phát lại Xác định (Offline Replay)',
    };
  }

  if (!telemetry.lastQuoteSystemTime) {
    return {
      connectionState: 'WAITING_FOR_QUOTES',
      connectionLabelVi: 'Phiên mở — Đang chờ báo giá Bid/Ask đầu tiên từ MT5 Demo',
    };
  }

  const silenceMs = nowSystemMs - Date.parse(telemetry.lastQuoteSystemTime);
  if (silenceMs > disconnectTimeoutMs) {
    return {
      connectionState: 'DISCONNECTED',
      connectionLabelVi: `Mất kết nối nguồn báo giá MT5 (${Math.round(
        silenceMs / 1000
      )}s chưa nhận lô mới khi thị trường đang mở)`,
    };
  }

  if (silenceMs > 10_000) {
    return {
      connectionState: 'WAITING_FOR_QUOTES',
      connectionLabelVi: `Đang chờ báo giá tiếp theo từ MT5 Demo (${Math.round(
        silenceMs / 1000
      )}s kể từ tick gần nhất)`,
    };
  }

  return {
    connectionState: 'STREAMING_LIVE',
    connectionLabelVi: `Đang nhận báo giá trực tiếp MT5 Demo (${telemetry.rawSymbol} → ${telemetry.canonicalSymbol})`,
  };
}

export class DurableTickIngestor {
  private readonly batchLogPath: string;
  private mutex: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    const resolvedDir = path.resolve(dataDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }
    this.batchLogPath = path.join(resolvedDir, 'ticks-batches.ndjson');
  }

  public getBatchLogPath(): string {
    return this.batchLogPath;
  }

  /**
   * Serializes concurrent batch ingestion requests so simultaneous retries or batches
   * never race or produce duplicate candles/positions.
   */
  public enqueueIngest(
    task: () => Promise<TickBatchIngestResult> | TickBatchIngestResult
  ): Promise<TickBatchIngestResult> {
    const next = this.mutex.then(() => task());
    this.mutex = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Persists a raw batch record to disk with fsync BEFORE acknowledging the request.
   */
  public persistBatchDurablyToDisk(record: {
    batchId: string;
    collectorId: string;
    rawSymbol: string;
    receivedAtSystemTime: string;
    ticks: IngestedTickInput[];
  }): void {
    const line = JSON.stringify(record) + '\n';
    const fd = fs.openSync(this.batchLogPath, 'a');
    try {
      fs.writeSync(fd, line, undefined, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Processes a batch of Bid/Ask ticks into `state`, building closed M15 candles
   * in strict market chronological order and invoking callbacks for closed candles
   * and live intra-bar quotes.
   */
  public processBatch(params: {
    payload: TickBatchPayload;
    ingestionState: PersistedTickIngestionState;
    schedule: BrokerSessionScheduleConfig;
    systemTime?: string;
    onLiveQuoteAccepted?: (quote: ReplayQuote, rawSymbol: string, systemTime: string) => void;
    onClosedCandleBuilt: (
      candle: M15Candle,
      barQuotes: ReplayQuote[],
      firstQuoteAfterClose: ReplayQuote | undefined,
      systemTime: string
    ) => void;
  }): TickBatchIngestResult {
    const {
      payload,
      ingestionState,
      schedule,
      systemTime = new Date().toISOString(),
      onLiveQuoteAccepted,
      onClosedCandleBuilt,
    } = params;

    const batchId = (payload.batchId || '').trim();
    if (!batchId) {
      throw new Error('Thiếu mã định danh lô dữ liệu (batchId).');
    }

    const { telemetry } = ingestionState;
    const symbolNorm = normalizeXauSymbol(payload.rawSymbol || payload.symbol);
    if (!symbolNorm.valid) {
      throw new Error(`Mã giao dịch không được hỗ trợ: ${symbolNorm.rawSymbol}`);
    }

    // 1. Idempotency check at batch level: if batchId was already processed, return identical result
    if (ingestionState.processedBatchIds.includes(batchId)) {
      telemetry.duplicateBatchesSkipped += 1;
      const status = evaluateDataSourceStatus({
        telemetry,
        schedule,
        nowSystemMs: Date.parse(systemTime),
      });
      telemetry.connectionState = status.connectionState;
      telemetry.connectionLabelVi = status.connectionLabelVi;

      return {
        acknowledged: true,
        idempotentReplay: true,
        batchId,
        acceptedTicks: 0,
        sameMillisecondAccepted: 0,
        duplicateTicksSkipped: Array.isArray(payload.ticks) ? payload.ticks.length : 0,
        outOfOrderRejected: 0,
        invalidRejected: 0,
        staleDetected: 0,
        closedCandlesEmitted: [],
        watermarkTimeMs: telemetry.watermarkTimeMs,
        watermarkSeqWithinMs: telemetry.watermarkSeqWithinMs,
        connectionState: telemetry.connectionState,
      };
    }

    // 2. Durable write to disk BEFORE mutating state or acknowledging
    this.persistBatchDurablyToDisk({
      batchId,
      collectorId: payload.collectorId || 'MT5-COLLECTOR',
      rawSymbol: symbolNorm.rawSymbol,
      receivedAtSystemTime: systemTime,
      ticks: Array.isArray(payload.ticks) ? payload.ticks : [],
    });

    ingestionState.processedBatchIds.push(batchId);
    if (ingestionState.processedBatchIds.length > 2000) {
      ingestionState.processedBatchIds.splice(
        0,
        ingestionState.processedBatchIds.length - 2000
      );
    }

    telemetry.sourceMode = 'MT5_DEMO_LIVE';
    telemetry.rawSymbol = symbolNorm.rawSymbol;
    telemetry.canonicalSymbol = symbolNorm.canonicalSymbol;
    telemetry.collectorId = payload.collectorId || telemetry.collectorId || 'MT5-COLLECTOR';
    telemetry.lastBatchId = batchId;
    telemetry.totalBatchesAccepted += 1;

    const knownKeys = new Set(ingestionState.recentAcceptedTickKeys);
    const systemMs = Date.parse(systemTime);

    let acceptedTicks = 0;
    let sameMillisecondAccepted = 0;
    let duplicateTicksSkipped = 0;
    let outOfOrderRejected = 0;
    let invalidRejected = 0;
    let staleDetected = 0;
    const closedCandlesEmitted: string[] = [];

    const rawTicks = Array.isArray(payload.ticks) ? payload.ticks : [];

    for (const rawTick of rawTicks) {
      const timeMs = Number(rawTick?.timeMs);
      const bid = Number(rawTick?.bid);
      const ask = Number(rawTick?.ask);
      const tickSymbol = normalizeXauSymbol(rawTick?.rawSymbol || symbolNorm.rawSymbol);

      if (
        !tickSymbol.valid ||
        !Number.isSafeInteger(timeMs) ||
        timeMs <= 0 ||
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask < bid
      ) {
        invalidRejected += 1;
        telemetry.invalidTicksRejected += 1;
        continue;
      }

      const bidFixed = Number(bid.toFixed(5));
      const askFixed = Number(ask.toFixed(5));
      const explicitSeq =
        rawTick.seqWithinMs !== undefined && Number.isInteger(Number(rawTick.seqWithinMs))
          ? Number(rawTick.seqWithinMs)
          : undefined;
      const explicitSourceId = rawTick.sourceTickId?.trim();

      // Check explicit sourceTickId deduplication
      if (explicitSourceId && knownKeys.has(`ID:${explicitSourceId}`)) {
        duplicateTicksSkipped += 1;
        telemetry.duplicateTicksSkipped += 1;
        continue;
      }

      const wmTime = telemetry.watermarkTimeMs;
      const wmSeq = telemetry.watermarkSeqWithinMs;

      // Check chronological order against watermark
      if (wmTime !== null && timeMs < wmTime) {
        const candidateKey = `T:${timeMs}:${explicitSeq ?? 0}:${bidFixed}:${askFixed}`;
        if (knownKeys.has(candidateKey)) {
          duplicateTicksSkipped += 1;
          telemetry.duplicateTicksSkipped += 1;
        } else {
          outOfOrderRejected += 1;
          telemetry.outOfOrderTicksRejected += 1;
        }
        continue;
      }

      let resolvedSeq = 0;
      let isSameMillisecondValid = false;

      if (wmTime !== null && timeMs === wmTime) {
        if (explicitSeq !== undefined) {
          const candidateKey = `T:${timeMs}:${explicitSeq}:${bidFixed}:${askFixed}`;
          if (knownKeys.has(candidateKey) || explicitSeq <= wmSeq) {
            duplicateTicksSkipped += 1;
            telemetry.duplicateTicksSkipped += 1;
            continue;
          }
          resolvedSeq = explicitSeq;
          isSameMillisecondValid = true;
        } else {
          // No explicit seqWithinMs: distinguish exact duplicate quote from valid new quote in same ms
          const isIdenticalQuote =
            telemetry.lastQuoteBid !== null &&
            telemetry.lastQuoteAsk !== null &&
            Math.abs(bidFixed - telemetry.lastQuoteBid) < 1e-8 &&
            Math.abs(askFixed - telemetry.lastQuoteAsk) < 1e-8;
          if (isIdenticalQuote) {
            duplicateTicksSkipped += 1;
            telemetry.duplicateTicksSkipped += 1;
            continue;
          }
          resolvedSeq = wmSeq + 1;
          isSameMillisecondValid = true;
        }
      } else {
        resolvedSeq = explicitSeq ?? 0;
      }

      // Check unexpected time gap (> 60s when market is open)
      if (wmTime !== null && timeMs - wmTime > DEFAULT_GAP_THRESHOLD_MS) {
        const schedAtTick = evaluateMarketSchedule(new Date(timeMs).toISOString(), schedule);
        if (schedAtTick.sessionState !== 'MARKET_CLOSED') {
          telemetry.gapCount += 1;
          telemetry.lastGapDurationMs = timeMs - wmTime;
        }
      }

      // Check stale quote relative to system clock
      const isStale =
        Number.isFinite(systemMs) && systemMs - timeMs > DEFAULT_STALE_THRESHOLD_MS;
      if (isStale) {
        staleDetected += 1;
        telemetry.staleQuotesDetected += 1;
      }
      telemetry.isLatestQuoteStale = isStale;

      // Record accepted tick key for idempotency
      const tickKey = `T:${timeMs}:${resolvedSeq}:${bidFixed}:${askFixed}`;
      knownKeys.add(tickKey);
      ingestionState.recentAcceptedTickKeys.push(tickKey);
      if (explicitSourceId) {
        const idKey = `ID:${explicitSourceId}`;
        knownKeys.add(idKey);
        ingestionState.recentAcceptedTickKeys.push(idKey);
      }
      if (ingestionState.recentAcceptedTickKeys.length > 5000) {
        ingestionState.recentAcceptedTickKeys.splice(
          0,
          ingestionState.recentAcceptedTickKeys.length - 5000
        );
      }

      // Update watermark and latest quote telemetry
      const spreadPts = Math.max(1, Math.round((askFixed - bidFixed) * 100));
      telemetry.watermarkTimeMs = timeMs;
      telemetry.watermarkSeqWithinMs = resolvedSeq;
      telemetry.lastQuoteMarketTime = new Date(timeMs).toISOString();
      telemetry.lastQuoteSystemTime = systemTime;
      telemetry.lastQuoteBid = bidFixed;
      telemetry.lastQuoteAsk = askFixed;
      telemetry.lastQuoteSpreadPts = spreadPts;
      telemetry.totalValidTicksAccepted += 1;
      acceptedTicks += 1;

      if (isSameMillisecondValid) {
        sameMillisecondAccepted += 1;
        telemetry.sameMillisecondTicksAccepted += 1;
      }

      const quoteObj: ReplayQuote = {
        time: timeMs,
        bid: bidFixed,
        ask: askFixed,
      };

      // Step 2a: Check if this tick closes the previous in-progress M15 bar
      const bucketStartMs = Math.floor(timeMs / M15_MS) * M15_MS;
      const bucketEndMs = bucketStartMs + M15_MS;

      if (
        ingestionState.inProgressBar &&
        bucketStartMs > ingestionState.inProgressBar.bucketStartMs
      ) {
        const finishedBar = ingestionState.inProgressBar;
        const closedCandle: M15Candle = {
          candleId: `MT5-XAU-M15-${finishedBar.bucketStartMs}`,
          symbol: 'XAUUSD',
          timeframe: 'M15',
          openTime: new Date(finishedBar.bucketStartMs).toISOString(),
          closeTime: new Date(finishedBar.bucketEndMs).toISOString(),
          open: finishedBar.open,
          high: finishedBar.high,
          low: finishedBar.low,
          close: finishedBar.close,
          volume: finishedBar.volume,
          spreadPts: finishedBar.spreadPts,
          isClosed: true,
          syntheticNote: `Tổng hợp từ ${finishedBar.volume} báo giá Bid/Ask MT5 (${telemetry.rawSymbol})`,
        };

        const barQuotes: ReplayQuote[] = finishedBar.quotes.map((q) => ({
          time: q.time,
          bid: q.bid,
          ask: q.ask,
        }));
        const firstAfterClose =
          timeMs - finishedBar.bucketEndMs <= 5000 ? quoteObj : undefined;

        ingestionState.completedBarQuotesByCandleId[closedCandle.candleId] = barQuotes;
        if (firstAfterClose) {
          ingestionState.firstAfterCloseQuoteByCandleId[closedCandle.candleId] =
            firstAfterClose;
        }

        // Clear inProgressBar before callback in case callback inspects state
        ingestionState.inProgressBar = null;
        telemetry.closedBarsBuiltFromTicks += 1;
        closedCandlesEmitted.push(closedCandle.candleId);

        onClosedCandleBuilt(closedCandle, barQuotes, firstAfterClose, systemTime);
      }

      // Step 2b: Add quote to current M15 bar (only if market is not closed at this tick)
      const priceRef = Number(bidFixed.toFixed(2));
      if (
        !ingestionState.inProgressBar ||
        ingestionState.inProgressBar.bucketStartMs !== bucketStartMs
      ) {
        ingestionState.inProgressBar = {
          bucketStartMs,
          bucketEndMs,
          open: priceRef,
          high: priceRef,
          low: priceRef,
          close: priceRef,
          volume: 1,
          spreadPts,
          firstTickTimeMs: timeMs,
          lastTickTimeMs: timeMs,
          quotes: [{ ...quoteObj, seqWithinMs: resolvedSeq }],
        };
      } else {
        const bar = ingestionState.inProgressBar;
        bar.high = Number(Math.max(bar.high, priceRef).toFixed(2));
        bar.low = Number(Math.min(bar.low, priceRef).toFixed(2));
        bar.close = priceRef;
        bar.volume += 1;
        bar.spreadPts = spreadPts;
        bar.lastTickTimeMs = timeMs;
        bar.quotes.push({ ...quoteObj, seqWithinMs: resolvedSeq });
      }

      telemetry.inProgressBarOpenTime = new Date(
        ingestionState.inProgressBar.bucketStartMs
      ).toISOString();
      telemetry.inProgressBarTickCount = ingestionState.inProgressBar.volume;

      if (onLiveQuoteAccepted) {
        onLiveQuoteAccepted(quoteObj, symbolNorm.rawSymbol, systemTime);
      }
    }

    const status = evaluateDataSourceStatus({
      telemetry,
      schedule,
      nowSystemMs: Number.isFinite(systemMs) ? systemMs : Date.now(),
    });
    telemetry.connectionState = status.connectionState;
    telemetry.connectionLabelVi = status.connectionLabelVi;

    return {
      acknowledged: true,
      idempotentReplay: false,
      batchId,
      acceptedTicks,
      sameMillisecondAccepted,
      duplicateTicksSkipped,
      outOfOrderRejected,
      invalidRejected,
      staleDetected,
      closedCandlesEmitted,
      watermarkTimeMs: telemetry.watermarkTimeMs,
      watermarkSeqWithinMs: telemetry.watermarkSeqWithinMs,
      connectionState: telemetry.connectionState,
    };
  }
}
