import { createShadowOutcomeFromCandidate } from './researchTeam.ts';
import { stepOpenPositionOnCandle } from './simBroker.ts';
import type { DurableQuantStorage } from './storage.ts';
import type {
  CycleTraceRecord,
  LearningRunRecord,
  PolicyVersionRecord,
  QuantSystemState,
  ReconciliationRecord,
  ReplayDataset,
  ShadowCandidateOutcome,
  SimulatedPosition,
} from './types.ts';

export function restoreIngestedCandlesIntoDataset(
  state: QuantSystemState,
  dataset: ReplayDataset
): void {
  const existingIds = new Set(dataset.candles.map((c) => c.candleId));
  for (const trace of state.cycleTraces) {
    if (trace.validation.valid && !existingIds.has(trace.candle.candleId)) {
      dataset.candles.push(trace.candle);
      existingIds.add(trace.candle.candleId);
    }
  }
  dataset.metadata.totalCandles = dataset.candles.length;
  state.totalReplayCandles = Math.max(
    state.totalReplayCandles,
    dataset.candles.length
  );
}

export function updateDailyDrawdown(state: QuantSystemState): void {
  const daily = state.dailyDrawdown;
  if (!daily) return;
  daily.peakEquityUsd = Math.max(daily.peakEquityUsd, state.equityUsd);
  daily.currentPct =
    daily.peakEquityUsd > 0
      ? Number(
          (((daily.peakEquityUsd - state.equityUsd) / daily.peakEquityUsd) * 100).toFixed(2)
        )
      : 0;
}

export function restoreDailyDrawdown(state: QuantSystemState): void {
  if (state.dailyDrawdown || !state.lastProcessedMarketTime) return;
  let previousEquity = state.initialBalanceUsd;
  let marketDateUtc = '';
  let peakEquityUsd = previousEquity;
  for (const point of state.equityCurve) {
    const date = new Date(point.marketTime).toISOString().slice(0, 10);
    peakEquityUsd = Math.max(
      date === marketDateUtc ? peakEquityUsd : previousEquity,
      point.equityUsd
    );
    marketDateUtc = date;
    previousEquity = point.equityUsd;
  }
  const lastDate = new Date(state.lastProcessedMarketTime).toISOString().slice(0, 10);
  state.dailyDrawdown = {
    marketDateUtc: lastDate,
    peakEquityUsd: marketDateUtc === lastDate ? peakEquityUsd : previousEquity,
    currentPct: 0,
  };
  updateDailyDrawdown(state);
}

export function closeShadowOutcome(
  outcome: ShadowCandidateOutcome,
  position: SimulatedPosition,
  candleIndex: number
): void {
  Object.assign(outcome, {
    status: 'CLOSED_RECONCILED',
    closeMarketTime: position.closeMarketTime,
    closeCandleIndex: candleIndex,
    avgExitPrice: position.avgExitFillPrice,
    grossPnlUsd: position.grossPnlUsd,
    totalCostUsd: position.totalCostUsd,
    netPnlUsd: position.netPnlUsd,
    netPnlAt2xCostUsd: position.netPnlAt2xCostUsd,
    exitReason: position.exitReason,
    intraBarConflictTriggered:
      position.exitReason === 'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST',
  });
}

export function restoreOpenShadows(
  state: QuantSystemState,
  storage: DurableQuantStorage
): void {
  if (state.openShadowPositions) return;
  const positions: Record<string, SimulatedPosition> = {};
  const traces = state.cycleTraces;
  for (const outcome of state.shadowOutcomes) {
    if (outcome.status !== 'OPEN') continue;
    const trace = traces.find((item) => item.cycleId === outcome.cycleId);
    const candidate = trace?.coordinatorDecision?.candidatesConsidered.find(
      (item) =>
        item.strategyId === outcome.strategyId && item.version === outcome.strategyVersion
    );
    if (!trace || !candidate) {
      throw new Error(`Thiếu dữ liệu để khôi phục mẫu mô phỏng ${outcome.shadowId}`);
    }
    let { shadowPosition } = createShadowOutcomeFromCandidate({
      cycleId: trace.cycleId,
      candle: trace.candle,
      candleIndex: trace.candleIndex,
      regime: outcome.regime,
      candidate,
      wasSelectedByActivePolicy: outcome.wasSelectedByActivePolicy,
      wasSelectedByBaselinePolicy: outcome.wasSelectedByBaselinePolicy,
      livePositionId: outcome.wasSelectedByActivePolicy ? trace.openedPositionId : undefined,
      volumeLots: outcome.riskSizedVolumeLots ?? 0.5,
    });
    for (const later of traces) {
      if (later.candleIndex <= trace.candleIndex || !later.validation.valid) continue;
      shadowPosition = stepOpenPositionOnCandle(
        shadowPosition,
        later.cycleId,
        later.candle,
        later.coordinatorDecision?.systemTime,
        undefined,
        state.brokerSchedule
      );
      if (shadowPosition.status === 'CLOSED') {
        closeShadowOutcome(outcome, shadowPosition, later.candleIndex);
        break;
      }
    }
    if (shadowPosition.status !== 'CLOSED') positions[outcome.shadowId] = shadowPosition;
  }
  state.openShadowPositions = positions;
  storage.saveState(state);
}

export function recalculateAccountMetrics(state: QuantSystemState): void {
  const closedNetPnl = state.closedPositions.reduce(
    (sum, p) => sum + p.netPnlUsd,
    0
  );
  const openRealizedNetPnl = state.openPositions.reduce((sum, p) => {
    const dealsPnl = p.deals.reduce((dSum, d) => dSum + d.netPnlUsd, 0);
    return sum + dealsPnl;
  }, 0);
  const openUnrealizedPnl = state.openPositions.reduce(
    (sum, p) => sum + p.unrealizedPnlUsd,
    0
  );

  state.balanceUsd = Number(
    (state.initialBalanceUsd + closedNetPnl + openRealizedNetPnl).toFixed(2)
  );
  state.equityUsd = Number(
    (state.balanceUsd + openUnrealizedPnl).toFixed(2)
  );

  updateDailyDrawdown(state);

  if (state.equityUsd > state.highWaterMarkEquityUsd) {
    state.highWaterMarkEquityUsd = state.equityUsd;
  }

  const ddPct =
    state.highWaterMarkEquityUsd > 0
      ? ((state.highWaterMarkEquityUsd - state.equityUsd) /
          state.highWaterMarkEquityUsd) *
        100
      : 0;
  state.currentDrawdownPct = Number(Math.max(0, ddPct).toFixed(2));
  if (state.currentDrawdownPct > state.maxDrawdownPct) {
    state.maxDrawdownPct = state.currentDrawdownPct;
  }
}

export function queryPositionFullTrace(
  state: QuantSystemState,
  positionId: string
): {
  position: SimulatedPosition;
  entryCycleTrace?: CycleTraceRecord;
  closeCycleTrace?: CycleTraceRecord;
  reconciliation?: ReconciliationRecord;
  policyAtEntry?: PolicyVersionRecord;
} | null {
  const position =
    state.closedPositions.find((p) => p.positionId === positionId) ||
    state.openPositions.find((p) => p.positionId === positionId) ||
    state.rejectedOrExpiredOrders.find((p) => p.positionId === positionId);

  if (!position) return null;

  const entryCycleTrace = state.cycleTraces.find(
    (t) => t.cycleId === position.entryCycleId
  );
  const closeCycleTrace = position.closeCycleId
    ? state.cycleTraces.find((t) => t.cycleId === position.closeCycleId)
    : undefined;
  const reconciliation = state.reconciliations.find(
    (r) => r.positionId === position.positionId
  );
  const policyAtEntry = state.policies.find(
    (p) => p.policyId === position.openedUnderPolicyId
  );

  return {
    position,
    entryCycleTrace,
    closeCycleTrace,
    reconciliation,
    policyAtEntry,
  };
}

export function queryLearningRunFullTrace(
  state: QuantSystemState,
  runId: string
): {
  learningRun: LearningRunRecord;
  reconciledPositionsUsed: SimulatedPosition[];
  reconciliationsUsed: ReconciliationRecord[];
  shadowOutcomesUsed: ShadowCandidateOutcome[];
  resultingPolicy?: PolicyVersionRecord;
  previousPolicy?: PolicyVersionRecord;
} | null {
  const learningRun = state.learningRuns.find((r) => r.runId === runId);
  if (!learningRun) return null;

  const reconciledPositionsUsed = state.closedPositions.filter((p) =>
    learningRun.reconciledPositionIdsUsed.includes(p.positionId)
  );
  const reconciliationsUsed = state.reconciliations.filter((r) =>
    learningRun.reconciledPositionIdsUsed.includes(r.positionId)
  );
  const exactSampleIds =
    learningRun.trainingSampleIds && learningRun.validationSampleIds
      ? new Set([
          ...learningRun.trainingSampleIds,
          ...learningRun.validationSampleIds,
        ])
      : undefined;
  const cutoffMs = Date.parse(learningRun.executedAtMarketTime);
  const shadowOutcomesUsed = state.shadowOutcomes.filter((s) =>
    exactSampleIds
      ? exactSampleIds.has(s.shadowId)
      : learningRun.sampleCycleIdsUsed.includes(s.cycleId) &&
        Boolean(s.closeMarketTime) &&
        Date.parse(s.closeMarketTime!) <= cutoffMs
  );
  const resultingPolicy = state.policies.find(
    (p) => p.policyId === learningRun.resultingPolicyId
  );
  const previousPolicy = state.policies.find(
    (p) => p.policyId === learningRun.previousPolicyId
  );

  return {
    learningRun,
    reconciledPositionsUsed,
    reconciliationsUsed,
    shadowOutcomesUsed,
    resultingPolicy,
    previousPolicy,
  };
}
