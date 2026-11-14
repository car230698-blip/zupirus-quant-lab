import type { ReplayQuote } from './tickReplay.ts';
import {
  BrokerSessionScheduleConfig,
  checkMandatoryCutoffClose,
} from './marketSchedule.ts';
import {
  ExecutionMode,
  M15Candle,
  MarketRegime,
  PartialDealEvent,
  PositionExitReason,
  SimulatedPosition,
  StrategyCandidateEvaluation,
} from './types.ts';

export const CONTRACT_SIZE_OZ = 100; // 1 lot XAUUSD = 100 oz
export const COMMISSION_PER_LOT_SIDE_USD = 3.5; // $7.00 round-turn per 1.0 lot

export interface ExecutionCostLatencyOptions {
  costMultiplier?: number; // e.g. 1.0 (default) or 2.0 (stress replay)
  entryLatencyMs?: number; // Delay in ms when selecting first quote after signal close
  exitLatencyMs?: number;  // Delay in ms when filling exit on tick stream
  extraSlippagePts?: number; // Additional slippage points induced by latency in bar mode
}

export const EXIT_REASON_LABELS_VI: Record<PositionExitReason, string> = {
  TP2_FULL_TARGET: 'Chốt lời toàn bộ tại mục tiêu TP2',
  SL_AFTER_PARTIAL_TP1: 'Đã chốt lời 50% tại TP1, phần còn lại chạm SL dời hòa vốn',
  STOP_LOSS_HIT: 'Chạm mức dừng lỗ (Stop Loss)',
  INTRA_BAR_SL_TP_CONFLICT_SL_FIRST:
    'SL và TP cùng chạm trong 1 nến M15 -> Áp dụng quy tắc thận trọng ưu tiên khớp SL trước (CONSERVATIVE_SL_FIRST)',
  TIME_EXPIRED: 'Hết thời hạn giữ lệnh tối đa (Time Expiry)',
  FRIDAY_15_15_CUTOFF:
    'Tất toán vị thế trước giờ đóng phiên theo quy tắc 15/15 (15 phút trước đóng phiên)',
  MISSED_CUTOFF_FIRST_VALID_QUOTE:
    'Đã lỡ giờ đóng phiên 15/15 — Đóng bắt buộc tại báo giá hợp lệ đầu tiên cho phép đóng',
  REJECTED_AT_ENTRY: 'Broker mô phỏng từ chối lệnh (Spread/Thanh khoản vượt ngưỡng)',
  ORDER_EXPIRED_UNFILLED: 'Lệnh chờ hết hạn chưa khớp (Order Expired)',
  OPEN: 'Vị thế đang mở',
};

export function assertSimulationOnlyBroker(mode: ExecutionMode): void {
  if (mode !== 'SIMULATION_ONLY') {
    throw new Error(
      `FATAL_BROKER_GUARD: Bản nghiệm thu chỉ cho phép gửi lệnh tới broker mô phỏng (SIMULATION_ONLY). Phát hiện chế độ: ${String(
        mode
      )}`
    );
  }
}

export function computeDeterministicSlippagePts(candle: M15Candle): number {
  const raw = 2 + Math.floor((candle.volume % 700) / 250);
  return Math.max(1, Math.min(6, raw));
}

/**
 * Opens a simulated position on the Simulated Broker at the close of the signal candle.
 * Enforces idempotency via processedSignalIds in the orchestrator.
 */
export function openSimulatedPosition(params: {
  executionMode: ExecutionMode;
  positionId: string;
  signalId: string;
  cycleId: string;
  candle: M15Candle;
  regime: MarketRegime;
  openedUnderPolicyId: string;
  candidate: StrategyCandidateEvaluation;
  volumeLots: number;
  systemTime?: string;
  forceBrokerRejectReasonVi?: string;
  forceOrderExpired?: boolean;
  quote?: ReplayQuote;
  costOptions?: ExecutionCostLatencyOptions;
}): SimulatedPosition {
  const {
    executionMode,
    positionId,
    signalId,
    cycleId,
    candle,
    regime,
    openedUnderPolicyId,
    candidate,
    volumeLots,
    systemTime = new Date().toISOString(),
    forceBrokerRejectReasonVi,
    forceOrderExpired,
    quote,
    costOptions,
  } = params;

  assertSimulationOnlyBroker(executionMode);

  const direction = candidate.direction || 'BUY';
  const expectedEntryPrice = Number((candidate.entryPrice ?? candle.close).toFixed(2));
  const stopLoss = Number((candidate.stopLoss ?? expectedEntryPrice - 1.5).toFixed(2));
  const takeProfit1 = Number((candidate.takeProfit1 ?? expectedEntryPrice + 1.5).toFixed(2));
  const takeProfit2 = Number((candidate.takeProfit2 ?? expectedEntryPrice + 3.0).toFixed(2));

  const managementRulesSnapshot = {
    policyId: openedUnderPolicyId,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.version,
    stopLoss,
    takeProfit1,
    takeProfit2,
    partialCloseRatio: candidate.partialCloseRatio || 0.5,
    expiryBars: candidate.expiryBars || 6,
    intraCandleRule: 'CONSERVATIVE_SL_FIRST' as const,
  };

  // Handle explicit broker rejection or order expiration simulation
  if (forceBrokerRejectReasonVi || forceOrderExpired) {
    const isExpired = Boolean(forceOrderExpired);
    const exitReason: PositionExitReason = isExpired
      ? 'ORDER_EXPIRED_UNFILLED'
      : 'REJECTED_AT_ENTRY';
    return {
      positionId,
      signalId,
      entryCycleId: cycleId,
      entryCandleId: candle.candleId,
      closeCycleId: cycleId,
      closeCandleId: candle.candleId,
      symbol: 'XAUUSD',
      timeframe: 'M15',
      regimeAtEntry: regime,
      openedUnderPolicyId,
      strategyId: candidate.strategyId,
      strategyNameVi: candidate.strategyNameVi,
      strategyVersion: candidate.version,
      direction,
      status: isExpired ? 'EXPIRED' : 'REJECTED',
      entryMarketTime: candle.closeTime,
      entrySystemTime: systemTime,
      closeMarketTime: candle.closeTime,
      closeSystemTime: systemTime,
      expectedEntryPrice,
      fillEntryPrice: expectedEntryPrice,
      entrySlippagePts: 0,
      entrySpreadPts: candle.spreadPts,
      stopLoss,
      takeProfit1,
      takeProfit2,
      requestedVolumeLots: volumeLots,
      filledVolumeLots: 0,
      closedVolumeLots: 0,
      remainingVolumeLots: 0,
      partialTp1Hit: false,
      barsHeld: 0,
      maxBarsAllowed: managementRulesSnapshot.expiryBars,
      exitSlippagePts: 0,
      totalSpreadCostUsd: 0,
      totalSlippageCostUsd: 0,
      totalCommissionUsd: 0,
      totalCostUsd: 0,
      grossPnlUsd: 0,
      netPnlUsd: 0,
      netPnlAt2xCostUsd: 0,
      unrealizedPnlUsd: 0,
      exitReason,
      exitReasonVi:
        forceBrokerRejectReasonVi || EXIT_REASON_LABELS_VI[exitReason],
      managementRulesSnapshot,
      deals: [],
      reconciled: true,
    };
  }

  const costMult = costOptions?.costMultiplier ?? 1;
  const extraSlipPts = costOptions?.extraSlippagePts ?? 0;
  const baseSlippagePts = quote
    ? extraSlipPts
    : computeDeterministicSlippagePts(candle) + extraSlipPts;
  const slippagePts = Math.round(baseSlippagePts * costMult);
  const rawHalfSpreadUsd = quote
    ? (quote.ask - quote.bid) / 2
    : (candle.spreadPts * 0.01) / 2;
  const halfSpreadUsd = rawHalfSpreadUsd * costMult;
  const entryReference = quote ? (quote.ask + quote.bid) / 2 : expectedEntryPrice;
  const slippageUsdPerOz = slippagePts * 0.01;
  const sign = direction === 'BUY' ? 1 : -1;

  const fillEntryPrice =
    quote && costMult === 1 && extraSlipPts === 0
      ? direction === 'BUY'
        ? quote.ask
        : quote.bid
      : Number(
          (entryReference + sign * (halfSpreadUsd + slippageUsdPerOz)).toFixed(2)
        );

  const entryCommissionUsd = Number(
    (volumeLots * COMMISSION_PER_LOT_SIDE_USD * costMult).toFixed(2)
  );
  const entrySpreadCostUsd = Number(
    (volumeLots * CONTRACT_SIZE_OZ * halfSpreadUsd).toFixed(2)
  );
  const entrySlippageCostUsd = Number(
    (volumeLots * CONTRACT_SIZE_OZ * slippageUsdPerOz).toFixed(2)
  );
  const initialTotalCostUsd = Number(
    (entryCommissionUsd + entrySpreadCostUsd + entrySlippageCostUsd).toFixed(2)
  );

  const entryDeal: PartialDealEvent = {
    dealId: `${positionId}-DEAL-ENTRY`,
    cycleId,
    candleId: candle.candleId,
    marketTime: quote ? new Date(quote.time).toISOString() : candle.closeTime,
    systemTime,
    eventType: 'ENTRY_FILL',
    volumeLots,
    expectedPrice: expectedEntryPrice,
    fillPrice: fillEntryPrice,
    slippagePts,
    spreadPts: quote ? Math.round(halfSpreadUsd * 200) : Math.round(candle.spreadPts * costMult),
    commissionUsd: entryCommissionUsd,
    grossPnlUsd: 0,
    netPnlUsd: Number((-initialTotalCostUsd).toFixed(2)),
    noteVi: `Khớp mở vị thế ${direction} ${volumeLots} lot tại ${fillEntryPrice.toFixed(
      2
    )} (Dự kiến ${expectedEntryPrice.toFixed(2)}, Spread ${
      candle.spreadPts
    } pts, Trượt giá ${slippagePts} pts).`,
  };

  return {
    positionId,
    signalId,
    entryCycleId: cycleId,
    entryCandleId: candle.candleId,
    symbol: 'XAUUSD',
    timeframe: 'M15',
    regimeAtEntry: regime,
    openedUnderPolicyId,
    strategyId: candidate.strategyId,
    strategyNameVi: candidate.strategyNameVi,
    strategyVersion: candidate.version,
    direction,
    status: 'FILLED',
    entryMarketTime: entryDeal.marketTime,
    tickEntryReference: quote ? entryReference : undefined,
    entrySystemTime: systemTime,
    expectedEntryPrice,
    fillEntryPrice,
    entrySlippagePts: slippagePts,
    entrySpreadPts: entryDeal.spreadPts,
    stopLoss,
    takeProfit1,
    takeProfit2,
    requestedVolumeLots: volumeLots,
    filledVolumeLots: volumeLots,
    closedVolumeLots: 0,
    remainingVolumeLots: volumeLots,
    partialTp1Hit: false,
    barsHeld: 0,
    maxBarsAllowed: managementRulesSnapshot.expiryBars,
    exitSlippagePts: 0,
    totalSpreadCostUsd: entrySpreadCostUsd,
    totalSlippageCostUsd: entrySlippageCostUsd,
    totalCommissionUsd: entryCommissionUsd,
    totalCostUsd: initialTotalCostUsd,
    grossPnlUsd: 0,
    netPnlUsd: Number((-initialTotalCostUsd).toFixed(2)),
    netPnlAt2xCostUsd: Number((-2 * initialTotalCostUsd).toFixed(2)),
    unrealizedPnlUsd: 0,
    exitReason: 'OPEN',
    exitReasonVi: EXIT_REASON_LABELS_VI.OPEN,
    managementRulesSnapshot,
    deals: [entryDeal],
    reconciled: false,
  };
}

/**
 * Steps an open position forward using a newly closed post-decision candle.
 * Uses strictly the position's `managementRulesSnapshot` captured when the position was opened,
 * so policy changes or rollbacks never alter the management rules of already-open positions.
 * Enforces CONSERVATIVE_SL_FIRST when both SL and TP are touched in the same candle,
 * and supports 15/15 Friday / Early-Close cutoff and missed cutoff closure on first valid quote.
 */
export function stepOpenPositionOnCandle(
  position: SimulatedPosition,
  cycleId: string,
  candle: M15Candle,
  systemTime: string = new Date().toISOString(),
  quotes?: Iterable<ReplayQuote>,
  schedule?: BrokerSessionScheduleConfig,
  costOptions?: ExecutionCostLatencyOptions
): SimulatedPosition {
  if (
    position.status === 'CLOSED' ||
    position.status === 'REJECTED' ||
    position.status === 'EXPIRED'
  ) {
    return position;
  }

  const pos = structuredClone(position);
  const rules = pos.managementRulesSnapshot;
  pos.barsHeld += 1;

  const isBuy = pos.direction === 'BUY';
  const sign = isBuy ? 1 : -1;
  const costMult = costOptions?.costMultiplier ?? 1;
  const extraSlipPts = costOptions?.extraSlippagePts ?? 0;
  const exitSlippagePts = Math.round(
    (computeDeterministicSlippagePts(candle) + extraSlipPts) * costMult
  );
  const halfSpreadUsd = ((candle.spreadPts * 0.01) / 2) * costMult;
  const slippageUsdPerOz = exitSlippagePts * 0.01;

  const activeSl = pos.partialTp1Hit ? pos.fillEntryPrice : rules.stopLoss;
  const slTouched = isBuy ? candle.low <= activeSl : candle.high >= activeSl;
  const tp1Touched =
    !pos.partialTp1Hit &&
    (isBuy ? candle.high >= rules.takeProfit1 : candle.low <= rules.takeProfit1);
  const tp2Touched = isBuy
    ? candle.high >= rules.takeProfit2
    : candle.low <= rules.takeProfit2;

  const closePortion = (
    lotsToClose: number,
    expectedExit: number,
    eventType: 'PARTIAL_CLOSE_TP1' | 'FINAL_CLOSE',
    dealSuffix: string,
    notePrefixVi: string,
    quote?: ReplayQuote
  ) => {
    const spreadUsd = quote
      ? ((quote.ask - quote.bid) / 2) * costMult
      : halfSpreadUsd;
    const slipUsd = quote ? extraSlipPts * 0.01 * costMult : slippageUsdPerOz;
    const fillExitPrice =
      quote && costMult === 1 && extraSlipPts === 0
        ? expectedExit - sign * spreadUsd
        : Number((expectedExit - sign * (spreadUsd + slipUsd)).toFixed(2));
    // Gross PnL is measured from expectedEntryPrice to expectedExit so totalCostUsd captures all spread + slippage + commission
    const priceDiffExpected =
      (expectedExit - (pos.tickEntryReference ?? pos.expectedEntryPrice)) * sign;
    const grossPnlPiece = Number(
      (lotsToClose * CONTRACT_SIZE_OZ * priceDiffExpected).toFixed(2)
    );
    const commPiece = Number(
      (lotsToClose * COMMISSION_PER_LOT_SIDE_USD * costMult).toFixed(2)
    );
    const spreadPiece = Number(
      (lotsToClose * CONTRACT_SIZE_OZ * spreadUsd).toFixed(2)
    );
    const slipPiece = Number(
      (lotsToClose * CONTRACT_SIZE_OZ * slipUsd).toFixed(2)
    );
    const sideCost = Number((commPiece + spreadPiece + slipPiece).toFixed(2));

    pos.totalCommissionUsd = Number((pos.totalCommissionUsd + commPiece).toFixed(2));
    pos.totalSpreadCostUsd = Number((pos.totalSpreadCostUsd + spreadPiece).toFixed(2));
    pos.totalSlippageCostUsd = Number((pos.totalSlippageCostUsd + slipPiece).toFixed(2));
    pos.totalCostUsd = Number(
      (
        pos.totalCommissionUsd +
        pos.totalSpreadCostUsd +
        pos.totalSlippageCostUsd
      ).toFixed(2)
    );

    pos.grossPnlUsd = Number((pos.grossPnlUsd + grossPnlPiece).toFixed(2));
    pos.closedVolumeLots = Number((pos.closedVolumeLots + lotsToClose).toFixed(4));
    pos.remainingVolumeLots = Number(
      Math.max(0, pos.filledVolumeLots - pos.closedVolumeLots).toFixed(4)
    );
    pos.exitSlippagePts = quote
      ? Math.round(extraSlipPts * costMult)
      : exitSlippagePts;
    pos.expectedExitPrice = expectedExit;
    pos.avgExitFillPrice = fillExitPrice;

    const dealNetPnl = Number((grossPnlPiece - sideCost).toFixed(2));
    pos.deals.push({
      dealId: `${pos.positionId}-DEAL-${dealSuffix}`,
      cycleId,
      candleId: candle.candleId,
      marketTime: quote ? new Date(quote.time).toISOString() : candle.closeTime,
      systemTime,
      eventType,
      volumeLots: lotsToClose,
      expectedPrice: expectedExit,
      fillPrice: fillExitPrice,
      slippagePts: pos.exitSlippagePts,
      spreadPts: quote ? Math.round(spreadUsd * 200) : Math.round(candle.spreadPts * costMult),
      commissionUsd: commPiece,
      grossPnlUsd: grossPnlPiece,
      netPnlUsd: dealNetPnl,
      noteVi: `${notePrefixVi}: Đóng ${lotsToClose} lot tại ${fillExitPrice.toFixed(
        2
      )} (Dự kiến ${expectedExit.toFixed(2)}, Trượt giá ${pos.exitSlippagePts} pts).`,
    });
  };

  const finishAtQuote = (
    quote: ReplayQuote,
    exitPrice: number,
    reason: PositionExitReason,
    customReasonVi?: string
  ) => {
    const slBeforeClose = pos.stopLoss;
    const reference = exitPrice + sign * (quote.ask - quote.bid) / 2;
    closePortion(
      pos.remainingVolumeLots,
      reference,
      'FINAL_CLOSE',
      `TICK-${pos.deals.length}`,
      customReasonVi || EXIT_REASON_LABELS_VI[reason],
      quote
    );
    if (reason === 'STOP_LOSS_HIT' || reason === 'SL_AFTER_PARTIAL_TP1') {
      const fillPrice = pos.avgExitFillPrice ?? exitPrice;
      pos.slOvershootUsdPerOz = Number(
        Math.max(0, (slBeforeClose - fillPrice) * sign).toFixed(4)
      );
    }
    pos.exitReason = reason;
    pos.exitReasonVi = customReasonVi || EXIT_REASON_LABELS_VI[reason];
    pos.closeCycleId = cycleId;
    pos.closeCandleId = candle.candleId;
    pos.closeMarketTime = new Date(quote.time).toISOString();
    pos.closeSystemTime = systemTime;
    pos.status = 'CLOSED';
  };

  let lastQuote: ReplayQuote | undefined;
  if (quotes) {
    const quoteList = Array.from(quotes);
    const entryTime = Date.parse(pos.entryMarketTime);
    const exitLatencyMs = costOptions?.exitLatencyMs ?? 0;

    for (let qi = 0; qi < quoteList.length; qi++) {
      const quote = quoteList[qi];
      if (quote.time < entryTime) continue;
      lastQuote = quote;

      const resolveDelayedQuote = (triggerQuote: ReplayQuote): ReplayQuote => {
        if (exitLatencyMs <= 0) return triggerQuote;
        const targetTime = triggerQuote.time + exitLatencyMs;
        for (let k = qi; k < quoteList.length; k++) {
          if (quoteList[k].time >= targetTime) return quoteList[k];
        }
        return quoteList[quoteList.length - 1];
      };

      // Check 15/15 Friday or Early-Close Cutoff or Missed Cutoff on this quote
      if (schedule && schedule.enabled) {
        const cutoffCheck = checkMandatoryCutoffClose({
          entryMarketTimeUtc: pos.entryMarketTime,
          currentQuoteTimeUtc: new Date(quote.time).toISOString(),
          schedule,
        });
        if (cutoffCheck.mustClose) {
          const execQ = resolveDelayedQuote(quote);
          const exitPx = isBuy ? execQ.bid : execQ.ask;
          const reasonCode: PositionExitReason = cutoffCheck.missedScheduledCutoff
            ? 'MISSED_CUTOFF_FIRST_VALID_QUOTE'
            : 'FRIDAY_15_15_CUTOFF';
          finishAtQuote(execQ, exitPx, reasonCode, cutoffCheck.reasonVi);
          break;
        }
      }

      const price = isBuy ? quote.bid : quote.ask;
      if (sign * (price - pos.stopLoss) <= 0) {
        const execQ = resolveDelayedQuote(quote);
        const execPrice = isBuy ? execQ.bid : execQ.ask;
        finishAtQuote(
          execQ,
          execPrice,
          pos.partialTp1Hit ? 'SL_AFTER_PARTIAL_TP1' : 'STOP_LOSS_HIT'
        );
        break;
      }
      if (!pos.partialTp1Hit && sign * (price - rules.takeProfit1) >= 0) {
        const lots =
          Math.floor((pos.filledVolumeLots * rules.partialCloseRatio + 1e-10) * 100) /
          100;
        if (lots >= 0.01 && lots < pos.remainingVolumeLots) {
          const execQ = resolveDelayedQuote(quote);
          closePortion(
            lots,
            rules.takeProfit1 + sign * (execQ.ask - execQ.bid) / 2,
            'PARTIAL_CLOSE_TP1',
            'TP1',
            'Đóng một phần tại TP1',
            execQ
          );
          pos.partialTp1Hit = true;
          pos.status = 'PARTIAL_CLOSED';
          pos.stopLoss = pos.fillEntryPrice;
          pos.exitReasonVi = 'Đã chốt một phần tại TP1 và dời dừng lỗ về giá vào.';
        }
      }
      if (sign * (price - rules.takeProfit2) >= 0) {
        const execQ = resolveDelayedQuote(quote);
        finishAtQuote(execQ, rules.takeProfit2, 'TP2_FULL_TARGET');
        break;
      }
    }
    if (lastQuote && pos.remainingVolumeLots > 0 && pos.barsHeld >= rules.expiryBars) {
      finishAtQuote(
        lastQuote,
        isBuy ? lastQuote.bid : lastQuote.ask,
        'TIME_EXPIRED'
      );
    }
  } else {
    // Bar-mode simulation
    // First check if candle open or close triggers 15/15 cutoff or missed cutoff
    if (schedule && schedule.enabled && pos.remainingVolumeLots > 0) {
      const openCutoff = checkMandatoryCutoffClose({
        entryMarketTimeUtc: pos.entryMarketTime,
        currentQuoteTimeUtc: candle.openTime,
        schedule,
      });
      const closeCutoff = !openCutoff.mustClose
        ? checkMandatoryCutoffClose({
            entryMarketTimeUtc: pos.entryMarketTime,
            currentQuoteTimeUtc: candle.closeTime,
            schedule,
          })
        : openCutoff;

      if (openCutoff.mustClose || closeCutoff.mustClose) {
        const activeCutoff = openCutoff.mustClose ? openCutoff : closeCutoff;
        const exitPx = openCutoff.mustClose ? candle.open : candle.close;
        const exitTime = openCutoff.mustClose ? candle.openTime : candle.closeTime;
        const reasonCode: PositionExitReason = activeCutoff.missedScheduledCutoff
          ? 'MISSED_CUTOFF_FIRST_VALID_QUOTE'
          : 'FRIDAY_15_15_CUTOFF';

        closePortion(
          pos.remainingVolumeLots,
          exitPx,
          'FINAL_CLOSE',
          `CUTOFF-${pos.deals.length}`,
          activeCutoff.reasonVi
        );
        pos.exitReason = reasonCode;
        pos.exitReasonVi = activeCutoff.reasonVi;
        pos.closeCycleId = cycleId;
        pos.closeCandleId = candle.candleId;
        pos.closeMarketTime = exitTime;
        pos.closeSystemTime = systemTime;
        pos.status = 'CLOSED';
      }
    }

    if (pos.status !== 'CLOSED') {
      // Check if bar gapped past activeSl at open
      const gapSlExitPrice = isBuy
        ? Math.min(activeSl, candle.open)
        : Math.max(activeSl, candle.open);

      if (slTouched && (tp1Touched || tp2Touched)) {
        const lots = pos.remainingVolumeLots;
        closePortion(
          lots,
          gapSlExitPrice,
          'FINAL_CLOSE',
          `CONFLICT-SL-${pos.deals.length}`,
          'Xung đột SL/TP trong cùng nến (CONSERVATIVE_SL_FIRST)'
        );
        pos.slOvershootUsdPerOz = Number(
          Math.max(0, (activeSl - (pos.avgExitFillPrice ?? gapSlExitPrice)) * sign).toFixed(4)
        );
        pos.exitReason = 'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST';
        pos.exitReasonVi = EXIT_REASON_LABELS_VI.INTRA_BAR_SL_TP_CONFLICT_SL_FIRST;
        pos.closeCycleId = cycleId;
        pos.closeCandleId = candle.candleId;
        pos.closeMarketTime = candle.closeTime;
        pos.closeSystemTime = systemTime;
        pos.status = 'CLOSED';
      } else if (slTouched) {
        // 2. Stop Loss hit cleanly (including open price gap beyond SL if any)
        const lots = pos.remainingVolumeLots;
        const reason: PositionExitReason = pos.partialTp1Hit
          ? 'SL_AFTER_PARTIAL_TP1'
          : 'STOP_LOSS_HIT';
        closePortion(
          lots,
          gapSlExitPrice,
          'FINAL_CLOSE',
          `SL-${pos.deals.length}`,
          EXIT_REASON_LABELS_VI[reason]
        );
        pos.slOvershootUsdPerOz = Number(
          Math.max(0, (activeSl - (pos.avgExitFillPrice ?? gapSlExitPrice)) * sign).toFixed(4)
        );
        pos.exitReason = reason;
        pos.exitReasonVi = EXIT_REASON_LABELS_VI[reason];
        pos.closeCycleId = cycleId;
        pos.closeCandleId = candle.candleId;
        pos.closeMarketTime = candle.closeTime;
        pos.closeSystemTime = systemTime;
        pos.status = 'CLOSED';
      } else {
        // 3. Check Partial Close TP1 first if not yet hit
        if (tp1Touched && pos.remainingVolumeLots > 0) {
          const partialLots = Number(
            (pos.filledVolumeLots * rules.partialCloseRatio).toFixed(2)
          );
          const lotsToClose = Math.min(pos.remainingVolumeLots, partialLots);
          if (lotsToClose > 0) {
            closePortion(
              lotsToClose,
              rules.takeProfit1,
              'PARTIAL_CLOSE_TP1',
              'TP1',
              'Đóng một phần (50%) tại TP1'
            );
            pos.partialTp1Hit = true;
            pos.status = 'PARTIAL_CLOSED';
            pos.stopLoss = pos.fillEntryPrice; // Move SL to breakeven after TP1
            pos.exitReasonVi =
              'Đã đóng một phần (50% khối lượng) tại TP1; phần còn lại đang giữ với SL dời về giá vào.';
          }
        }

        // 4. Check Full Close TP2 if touched
        if (tp2Touched && pos.remainingVolumeLots > 0) {
          const lots = pos.remainingVolumeLots;
          closePortion(
            lots,
            rules.takeProfit2,
            'FINAL_CLOSE',
            'TP2',
            'Đóng toàn bộ phần còn lại tại TP2'
          );
          pos.exitReason = 'TP2_FULL_TARGET';
          pos.exitReasonVi = EXIT_REASON_LABELS_VI.TP2_FULL_TARGET;
          pos.closeCycleId = cycleId;
          pos.closeCandleId = candle.candleId;
          pos.closeMarketTime = candle.closeTime;
          pos.closeSystemTime = systemTime;
          pos.status = 'CLOSED';
        } else if (pos.barsHeld >= rules.expiryBars && pos.remainingVolumeLots > 0) {
          // 5. Check Time Expiration
          const lots = pos.remainingVolumeLots;
          closePortion(
            lots,
            candle.close,
            'FINAL_CLOSE',
            'EXPIRY',
            `Đóng hết do chạm giới hạn thời gian giữ lệnh (${rules.expiryBars} nến M15)`
          );
          pos.exitReason = 'TIME_EXPIRED';
          pos.exitReasonVi = EXIT_REASON_LABELS_VI.TIME_EXPIRED;
          pos.closeCycleId = cycleId;
          pos.closeCandleId = candle.candleId;
          pos.closeMarketTime = candle.closeTime;
          pos.closeSystemTime = systemTime;
          pos.status = 'CLOSED';
        }
      }
    }
  }

  // Update net PnL & unrealized PnL
  pos.netPnlUsd = Number((pos.grossPnlUsd - pos.totalCostUsd).toFixed(2));
  pos.netPnlAt2xCostUsd = Number(
    (pos.grossPnlUsd - 2 * pos.totalCostUsd).toFixed(2)
  );

  if (pos.remainingVolumeLots > 0) {
    if (quotes && !lastQuote) return pos;
    const mark = lastQuote ? (isBuy ? lastQuote.bid : lastQuote.ask) : candle.close;
    const markMove = (mark - pos.fillEntryPrice) * sign;
    pos.unrealizedPnlUsd = Number(
      (pos.remainingVolumeLots * CONTRACT_SIZE_OZ * markMove).toFixed(2)
    );
  } else {
    pos.unrealizedPnlUsd = 0;
  }

  return pos;
}
