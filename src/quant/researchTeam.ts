import { openSimulatedPosition } from './simBroker.ts';
import {
  HypothesisRecord,
  LearningRunRecord,
  M15Candle,
  MarketRegime,
  PolicyComparisonMetrics,
  PolicyVersionRecord,
  REGIME_LABELS_VI,
  RegimeComparisonRow,
  RegimePolicyMapping,
  ShadowCandidateOutcome,
  SimulatedPosition,
  StrategyCandidateEvaluation,
  StrategyId,
  StrategyRegimeRanking,
  WalkForwardExclusionLog,
} from './types.ts';

export const LEARNER_VERSION = 'LEARNER_WF_V2.1';
export const RANKING_FORMULA_TEXT =
  'Score = Mean(NetPnL_1xCost) - 0.35 * (MaxDD / N) + 0.25 * Mean(NetPnL_2xCost)';
export const DEFAULT_MIN_SAMPLES_PER_REGIME = 2;
export const DEGRADATION_LOSS_THRESHOLD_USD = -220;

/**
 * Helper to compute max drawdown from a chronological series of trade PnLs.
 */
export function computeMaxDrawdownFromPnls(pnls: number[]): number {
  let cumulative = 0;
  let peak = 0;
  let maxDd = 0;
  for (const pnl of pnls) {
    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(2));
}

export function computeComparisonMetrics(
  opportunitiesCount: number,
  outcomes: ShadowCandidateOutcome[]
): PolicyComparisonMetrics {
  const tradesCount = outcomes.length;
  if (tradesCount === 0) {
    return {
      opportunitiesCount,
      tradesCount: 0,
      winRatePct: 0,
      grossPnlUsd: 0,
      totalCostUsd: 0,
      netPnlAfterCostUsd: 0,
      netPnlAt2xCostUsd: 0,
      maxDrawdownUsd: 0,
    };
  }
  const wins = outcomes.filter((o) => o.netPnlUsd > 0).length;
  const grossPnlUsd = Number(
    outcomes.reduce((s, o) => s + o.grossPnlUsd, 0).toFixed(2)
  );
  const totalCostUsd = Number(
    outcomes.reduce((s, o) => s + o.totalCostUsd, 0).toFixed(2)
  );
  const netPnlAfterCostUsd = Number(
    outcomes.reduce((s, o) => s + o.netPnlUsd, 0).toFixed(2)
  );
  const netPnlAt2xCostUsd = Number(
    outcomes.reduce((s, o) => s + o.netPnlAt2xCostUsd, 0).toFixed(2)
  );
  const maxDrawdownUsd = computeMaxDrawdownFromPnls(
    [...outcomes].sort((a, b) => Date.parse(a.closeMarketTime!) - Date.parse(b.closeMarketTime!))
      .map((o) => o.netPnlUsd)
  );

  return {
    opportunitiesCount,
    tradesCount,
    winRatePct: Number(((wins / tradesCount) * 100).toFixed(1)),
    grossPnlUsd,
    totalCostUsd,
    netPnlAfterCostUsd,
    netPnlAt2xCostUsd,
    maxDrawdownUsd,
  };
}

/**
 * Simulates a single candidate forward on post-decision candles to produce a ShadowCandidateOutcome,
 * or steps an existing open shadow candidate one closed candle forward.
 */
export function createShadowOutcomeFromCandidate(params: {
  cycleId: string;
  candle: M15Candle;
  candleIndex: number;
  regime: MarketRegime;
  candidate: StrategyCandidateEvaluation;
  wasSelectedByActivePolicy: boolean;
  wasSelectedByBaselinePolicy: boolean;
  livePositionId?: string;
  volumeLots: number;
}): { outcome: ShadowCandidateOutcome; shadowPosition: SimulatedPosition } {
  const {
    cycleId,
    candle,
    candleIndex,
    regime,
    candidate,
    wasSelectedByActivePolicy,
    wasSelectedByBaselinePolicy,
    livePositionId,
    volumeLots,
  } = params;

  const shadowId = `SHDW-${cycleId}-${candidate.strategyId}-${candidate.version}`;
  const shadowPos = openSimulatedPosition({
    executionMode: 'SIMULATION_ONLY',
    positionId: livePositionId || shadowId,
    signalId: `SIG-${shadowId}`,
    cycleId,
    candle,
    regime,
    openedUnderPolicyId: 'SHADOW_EVAL',
    candidate,
    volumeLots,
  });

  const outcome: ShadowCandidateOutcome = {
    shadowId,
    cycleId,
    candleId: candle.candleId,
    regime,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.version,
    direction: candidate.direction || 'BUY',
    entryMarketTime: candle.closeTime,
    entryCandleIndex: candleIndex,
    status: 'OPEN',
    source: 'PARALLEL_SHADOW_SIM',
    wasSelectedByActivePolicy,
    wasSelectedByBaselinePolicy,
    expectedEntryPrice: shadowPos.expectedEntryPrice,
    fillEntryPrice: shadowPos.fillEntryPrice,
    entrySlippagePts: shadowPos.deals[0]?.slippagePts,
    riskSizedVolumeLots: volumeLots,
    grossPnlUsd: shadowPos.grossPnlUsd,
    totalCostUsd: shadowPos.totalCostUsd,
    netPnlUsd: shadowPos.netPnlUsd,
    netPnlAt2xCostUsd: shadowPos.netPnlAt2xCostUsd,
    intraBarConflictTriggered: false,
  };

  return { outcome, shadowPosition: shadowPos };
}

/**
 * Executes a full Walk-Forward Research & Validation Run using strictly completed
 * outcomes (`closeMarketTime <= decisionMarketTime`).
 * Purges any sample whose holding interval `[entryMarketTime, closeMarketTime]`
 * straddles the Walk-Forward Train/Validation boundary (`OVERLAPS_WF_BOUNDARY`).
 */
export function executeWalkForwardLearningRun(params: {
  runId: string;
  triggerCycleId: string;
  decisionMarketTime: string;
  systemTime?: string;
  triggerReasonVi: string;
  allShadowOutcomes: ShadowCandidateOutcome[];
  reconciledPositions: SimulatedPosition[];
  activePolicy: PolicyVersionRecord;
  baselinePolicy: PolicyVersionRecord;
  allPolicies: PolicyVersionRecord[];
  minSamplesPerRegime?: number;
  degradationLossThresholdUsd?: number;
}): {
  learningRun: LearningRunRecord;
  newPolicyToActivate?: PolicyVersionRecord;
  rolledBackToPolicy?: PolicyVersionRecord;
  haltNewPositions?: boolean;
} {
  const {
    runId,
    triggerCycleId,
    decisionMarketTime,
    systemTime = new Date().toISOString(),
    triggerReasonVi,
    allShadowOutcomes,
    reconciledPositions,
    activePolicy,
    baselinePolicy,
    allPolicies,
    minSamplesPerRegime = DEFAULT_MIN_SAMPLES_PER_REGIME,
    degradationLossThresholdUsd = DEGRADATION_LOSS_THRESHOLD_USD,
  } = params;

  const cutoffMs = Date.parse(decisionMarketTime);
  const exclusions: WalkForwardExclusionLog[] = [];

  // 1. Filter out any outcome that has NOT closed on or before decisionMarketTime (Zero Look-Ahead)
  const closedBeforeCutoff: ShadowCandidateOutcome[] = [];
  for (const item of allShadowOutcomes) {
    if (
      item.status !== 'CLOSED_RECONCILED' ||
      !item.closeMarketTime ||
      !Number.isFinite(Date.parse(item.entryMarketTime)) ||
      !Number.isFinite(Date.parse(item.closeMarketTime)) ||
      Date.parse(item.closeMarketTime) < Date.parse(item.entryMarketTime) ||
      Date.parse(item.closeMarketTime) > cutoffMs
    ) {
      exclusions.push({
        shadowId: item.shadowId,
        cycleId: item.cycleId,
        strategyId: item.strategyId,
        entryMarketTime: item.entryMarketTime,
        closeMarketTime: item.closeMarketTime || 'UNCLOSED',
        exclusionCode: 'UNCLOSED_AT_CUTOFF',
        reasonVi: `Loại mẫu ${item.shadowId} vì vị thế chưa đóng hoàn tất tại thời điểm cắt dữ liệu học (${decisionMarketTime}). Ngăn nhìn trước tương lai.`,
      });
    } else {
      closedBeforeCutoff.push(item);
    }
  }

  // Determine Walk-Forward Train / Validation Window timestamps
  const sortedByEntry = [...closedBeforeCutoff].sort(
    (a, b) => Date.parse(a.entryMarketTime) - Date.parse(b.entryMarketTime)
  );

  const earliestDecision = allShadowOutcomes
    .map((sample) => Date.parse(sample.entryMarketTime))
    .filter((time) => Number.isFinite(time) && time <= cutoffMs)
    .reduce((earliest, time) => Math.min(earliest, time), Infinity);
  const earliestMs = Number.isFinite(earliestDecision) ? earliestDecision : cutoffMs - 6 * 3600 * 1000;

  // Fix the boundary from the replay clock independently of candidate returns.
  const splitMs = Math.floor(earliestMs + (cutoffMs - earliestMs) * 0.65);

  const trainWindowStartMarketTime = new Date(earliestMs).toISOString();
  const trainWindowEndMarketTime = new Date(splitMs).toISOString();
  const validationWindowStartMarketTime = new Date(splitMs).toISOString();
  const validationWindowEndMarketTime = decisionMarketTime;

  // 2. Purge samples whose holding period [entryMarketTime, closeMarketTime] straddles splitMs
  //Specifically: entryMarketTime < splitMs AND closeMarketTime > splitMs
  const validWalkForwardSamples: ShadowCandidateOutcome[] = [];
  for (const sample of sortedByEntry) {
    const entryMs = Date.parse(sample.entryMarketTime);
    const closeMs = Date.parse(sample.closeMarketTime!);
    if (entryMs < splitMs && closeMs > splitMs) {
      exclusions.push({
        shadowId: sample.shadowId,
        cycleId: sample.cycleId,
        strategyId: sample.strategyId,
        entryMarketTime: sample.entryMarketTime,
        closeMarketTime: sample.closeMarketTime!,
        exclusionCode: 'OVERLAPS_WF_BOUNDARY',
        reasonVi: `Loại mẫu ${sample.shadowId} vì thời gian giữ lệnh [${sample.entryMarketTime} -> ${sample.closeMarketTime}] chồng qua ranh giới Huấn luyện / Kiểm định Walk-Forward (${trainWindowEndMarketTime}).`,
      });
    } else {
      validWalkForwardSamples.push(sample);
    }
  }

  const trainingSamples = validWalkForwardSamples.filter((sample) =>
    Date.parse(sample.entryMarketTime) < splitMs && Date.parse(sample.closeMarketTime!) <= splitMs
  );
  const validationSamples = validWalkForwardSamples.filter((sample) =>
    Date.parse(sample.entryMarketTime) >= splitMs
  );
  const sampleReferences = {
    trainingSampleIds: trainingSamples.map((sample) => sample.shadowId),
    validationSampleIds: validationSamples.map((sample) => sample.shadowId),
  };

  // 3. Check for Active Policy Degradation (Rollback or Halt protection)
  const positionsUnderActivePolicy = reconciledPositions.filter(
    (p) =>
      p.openedUnderPolicyId === activePolicy.policyId &&
      p.reconciled &&
      p.closeMarketTime &&
      Date.parse(p.closeMarketTime) <= cutoffMs
  );
  const activePolicyCumNetPnl = positionsUnderActivePolicy.reduce(
    (sum, p) => sum + p.netPnlUsd,
    0
  );

  const tradeableRegimes: Array<'TRENDING' | 'SQUEEZE_PRE_BREAKOUT' | 'RANGING'> = [
    'TRENDING',
    'SQUEEZE_PRE_BREAKOUT',
    'RANGING',
  ];

  // 4. Rank strategies per regime using validWalkForwardSamples
  const rankingsByRegime: StrategyRegimeRanking[] = [];
  const hypothesesTested: HypothesisRecord[] = [];
  const proposedMapping: RegimePolicyMapping = structuredClone(activePolicy.mapping);
  const proposedRegimes = new Set<MarketRegime>();
  let anyInsufficientSamples = false;

  for (const regime of tradeableRegimes) {
    const regimeSamples = trainingSamples.filter((s) => s.regime === regime);
    const excludedInRegime = exclusions.filter((e) =>
      allShadowOutcomes.find(
        (s) => s.shadowId === e.shadowId && s.regime === regime
      )
    ).length;

    // Group by strategyId + strategyVersion
    const groups = new Map<string, ShadowCandidateOutcome[]>();
    for (const s of regimeSamples) {
      const key = `${s.strategyId}@${s.strategyVersion}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    const regimeRankings: StrategyRegimeRanking[] = [];
    for (const [key, group] of groups.entries()) {
      const [strategyId, strategyVersion] = key.split('@') as [StrategyId, string];
      const n = group.length;
      group.sort((a, b) => Date.parse(a.closeMarketTime!) - Date.parse(b.closeMarketTime!));
      const wins = group.filter((g) => g.netPnlUsd > 0).length;
      const grossPnlUsd = Number(
        group.reduce((sum, g) => sum + g.grossPnlUsd, 0).toFixed(2)
      );
      const totalCostUsd = Number(
        group.reduce((sum, g) => sum + g.totalCostUsd, 0).toFixed(2)
      );
      const netPnlUsd = Number(
        group.reduce((sum, g) => sum + g.netPnlUsd, 0).toFixed(2)
      );
      const netPnlAt2xCostUsd = Number(
        group.reduce((sum, g) => sum + g.netPnlAt2xCostUsd, 0).toFixed(2)
      );
      const maxDrawdownUsd = computeMaxDrawdownFromPnls(
        group.map((g) => g.netPnlUsd)
      );
      const meanNet1x = netPnlUsd / n;
      const meanNet2x = netPnlAt2xCostUsd / n;
      const rankingScore = Number(
        (meanNet1x - 0.35 * (maxDrawdownUsd / n) + 0.25 * meanNet2x).toFixed(2)
      );

      const liveReconciledCount = group.filter(
        (g) => g.source === 'LIVE_SIM_RECONCILED'
      ).length;
      const shadowSimulatedCount = group.filter(
        (g) => g.source === 'PARALLEL_SHADOW_SIM'
      ).length;

      regimeRankings.push({
        regime,
        strategyId,
        strategyVersion,
        sampleCount: n,
        excludedSampleCount: excludedInRegime,
        liveReconciledCount,
        shadowSimulatedCount,
        winRatePct: Number(((wins / n) * 100).toFixed(1)),
        grossPnlUsd,
        totalCostUsd,
        netPnlUsd,
        netPnlAt2xCostUsd,
        maxDrawdownUsd,
        avgSlippagePts: Number((group.reduce((sum, item) => sum + (item.entrySlippagePts ?? 0), 0) / n).toFixed(2)),
        rankingScore,
        meetsMinSamples: n >= minSamplesPerRegime,
        sampleCycleIds: group.map((g) => g.cycleId),
      });
    }

    regimeRankings.sort((a, b) => b.rankingScore - a.rankingScore);
    rankingsByRegime.push(...regimeRankings);

    const currentAssigned = activePolicy.mapping[regime];
    const currentKey =
      currentAssigned === 'STAND_ASIDE'
        ? 'STAND_ASIDE'
        : `${currentAssigned.strategyId}@${currentAssigned.version}`;

    const eligibleRanked = regimeRankings.filter((r) => r.meetsMinSamples);
    if (eligibleRanked.length === 0) {
      anyInsufficientSamples = true;
      hypothesesTested.push({
        hypothesisId: `HYP-${runId}-${regime}`,
        createdAtMarketTime: decisionMarketTime,
        generatorSource: 'DETERMINISTIC_QUANT_ENGINE',
        targetRegime: regime,
        proposedStrategyId:
          currentAssigned === 'STAND_ASIDE'
            ? 'STRAT_TREND_FOLLOW'
            : currentAssigned.strategyId,
        proposedVersion:
          currentAssigned === 'STAND_ASIDE' ? 'v1.2.0' : currentAssigned.version,
        rationaleVi: `Kiểm tra xếp hạng chiến lược cho trạng thái ${REGIME_LABELS_VI[regime]}.`,
        validationStatus: 'REJECTED_INSUFFICIENT_SAMPLES',
        validationNoteVi: `Số mẫu hoàn tất không chồng lấn (${
          regimeRankings[0]?.sampleCount ?? 0
        }) nhỏ hơn ngưỡng tối thiểu (${minSamplesPerRegime} mẫu). Giữ nguyên cấu hình hiện tại (${currentKey}).`,
      });
      continue;
    }

    const best = eligibleRanked[0];
    const bestKey = `${best.strategyId}@${best.strategyVersion}`;
    const currentRankObj = regimeRankings.find(
      (r) => `${r.strategyId}@${r.strategyVersion}` === currentKey
    );

    const beatsCurrent =
      !currentRankObj || best.rankingScore > currentRankObj.rankingScore + 0.5;

    if (
      bestKey !== currentKey &&
      beatsCurrent &&
      best.netPnlUsd > 0 &&
      best.netPnlAt2xCostUsd > -15
    ) {
      proposedMapping[regime] = {
        strategyId: best.strategyId,
        version: best.strategyVersion,
      };
      proposedRegimes.add(regime);
      hypothesesTested.push({
        hypothesisId: `HYP-${runId}-${regime}`,
        createdAtMarketTime: decisionMarketTime,
        generatorSource: 'DETERMINISTIC_QUANT_ENGINE',
        targetRegime: regime,
        proposedStrategyId: best.strategyId,
        proposedVersion: best.strategyVersion,
        rationaleVi: `Ứng viên ${bestKey} đạt điểm xếp hạng cao nhất (${best.rankingScore}) trên ${best.sampleCount} mẫu đối soát trong trạng thái ${REGIME_LABELS_VI[regime]}.`,
        validationStatus: 'TRAINING_SELECTED',
        validationNoteVi: `Kết quả tập huấn luyện: Lãi ròng 1x chi phí = +${best.netPnlUsd.toFixed(
          2
        )} USD, Lãi ròng 2x chi phí = ${best.netPnlAt2xCostUsd.toFixed(
          2
        )} USD, vượt chiến lược hiện tại (${currentKey}: ${
          currentRankObj ? currentRankObj.rankingScore : 'N/A'
        }). Chờ kết quả ngoài mẫu.`,
      });
    } else {
      hypothesesTested.push({
        hypothesisId: `HYP-${runId}-${regime}`,
        createdAtMarketTime: decisionMarketTime,
        generatorSource: 'DETERMINISTIC_QUANT_ENGINE',
        targetRegime: regime,
        proposedStrategyId: best.strategyId,
        proposedVersion: best.strategyVersion,
        rationaleVi: `Đánh giá ứng viên dẫn đầu ${bestKey} (Score=${best.rankingScore}) cho trạng thái ${REGIME_LABELS_VI[regime]}.`,
        validationStatus:
          bestKey === currentKey
            ? 'RETAINED_CURRENT'
            : 'REJECTED_UNDERPERFORMED',
        validationNoteVi:
          bestKey === currentKey
            ? `Chiến lược đang dùng (${currentKey}) tiếp tục giữ vị trí số 1 (Score=${best.rankingScore}, Lãi ròng +${best.netPnlUsd.toFixed(
                2
              )} USD).`
            : `Ứng viên ${bestKey} chưa vượt ngưỡng cải thiện rủi ro/chi phí so với ${currentKey}. Giữ nguyên.`,
      });
    }
  }

  // 5. Build Side-by-Side Comparison (Adaptive Policy vs Fixed Baseline Policy) per regime and overall
  const regimeComparisons: RegimeComparisonRow[] = [];
  const allAdaptiveChosenOutcomes: ShadowCandidateOutcome[] = [];
  const allBaselineChosenOutcomes: ShadowCandidateOutcome[] = [];
  let totalOpportunities = 0;

  for (const regime of tradeableRegimes) {
    const regimeSamples = validationSamples.filter((s) => s.regime === regime);
    const uniqueCyclesInRegime = new Set(regimeSamples.map((s) => s.cycleId)).size;
    totalOpportunities += uniqueCyclesInRegime;

    const adaptiveRule = proposedMapping[regime];
    const baselineRule = baselinePolicy.mapping[regime];

    const adaptiveOutcomes =
      adaptiveRule === 'STAND_ASIDE'
        ? []
        : regimeSamples.filter(
            (s) =>
              s.strategyId === adaptiveRule.strategyId &&
              s.strategyVersion === adaptiveRule.version
          );

    const baselineOutcomes =
      baselineRule === 'STAND_ASIDE'
        ? []
        : regimeSamples.filter(
            (s) =>
              s.strategyId === baselineRule.strategyId &&
              s.strategyVersion === baselineRule.version
          );

    allAdaptiveChosenOutcomes.push(...adaptiveOutcomes);
    allBaselineChosenOutcomes.push(...baselineOutcomes);

    regimeComparisons.push({
      regime,
      regimeLabelVi: REGIME_LABELS_VI[regime],
      adaptiveStrategyLabel:
        adaptiveRule === 'STAND_ASIDE'
          ? 'Đứng ngoài'
          : `${adaptiveRule.strategyId}@${adaptiveRule.version}`,
      baselineStrategyLabel:
        baselineRule === 'STAND_ASIDE'
          ? 'Đứng ngoài'
          : `${baselineRule.strategyId}@${baselineRule.version}`,
      adaptive: computeComparisonMetrics(uniqueCyclesInRegime, adaptiveOutcomes),
      baseline: computeComparisonMetrics(uniqueCyclesInRegime, baselineOutcomes),
    });
  }

  const overallAdaptiveMetrics = computeComparisonMetrics(
    totalOpportunities,
    allAdaptiveChosenOutcomes
  );
  const overallBaselineMetrics = computeComparisonMetrics(
    totalOpportunities,
    allBaselineChosenOutcomes
  );

  const reconciledIdsUsed = reconciledPositions
    .filter(
      (p) =>
        p.reconciled &&
        p.closeMarketTime &&
        Date.parse(p.closeMarketTime) <= cutoffMs
    )
    .map((p) => p.positionId);

  const sampleCycleIdsUsed = Array.from(
    new Set(validWalkForwardSamples.map((s) => s.cycleId))
  );

  // 6. Decide Final Policy Action (Degradation Rollback/Halt vs Promotion vs Retain)
  if (activePolicyCumNetPnl <= degradationLossThresholdUsd) {
    // Active policy degraded past threshold! Look for a previous valid policy to roll back to
    const fallbackCandidate = [...allPolicies]
      .reverse()
      .find(
        (p) =>
          p.policyId !== activePolicy.policyId &&
          p.status !== 'ROLLED_BACK' &&
          p.status !== 'HALTED'
      );

    if (fallbackCandidate) {
      const rolledBackPolicy: PolicyVersionRecord = {
        ...structuredClone(fallbackCandidate),
        status: 'ACTIVE',
      };
      const learningRun: LearningRunRecord = {
        runId,
        triggerCycleId,
        learnerVersion: LEARNER_VERSION,
        executedAtMarketTime: decisionMarketTime,
        executedAtSystemTime: systemTime,
        triggerReasonVi,
        trainWindowStartMarketTime,
        trainWindowEndMarketTime,
        validationWindowStartMarketTime,
        validationWindowEndMarketTime,
        rankingFormula: RANKING_FORMULA_TEXT,
        minSamplesPerRegime,
        intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST',
        totalCompletedSamplesUsed: validWalkForwardSamples.length,
        totalExcludedSamples: exclusions.length,
        exclusions,
        rankingsByRegime,
        regimeComparisons,
        overallAdaptiveMetrics,
        overallBaselineMetrics,
        hypothesesTested,
        decision: 'ROLLBACK_TO_PREVIOUS_POLICY',
        previousPolicyId: activePolicy.policyId,
        resultingPolicyId: rolledBackPolicy.policyId,
        decisionReasonVi: `QUAY LUI CHÍNH SÁCH TỰ ĐỘNG: Chính sách ${
          activePolicy.policyId
        } suy giảm vượt ngưỡng cho phép (Lỗ lũy kế ${activePolicyCumNetPnl.toFixed(
          2
        )} USD <= ${degradationLossThresholdUsd} USD). Hệ thống tự động khôi phục về phiên bản hợp lệ trước đó (${
          rolledBackPolicy.policyId
        }). Các vị thế đang mở tiếp tục dùng quy tắc của phiên bản lúc mở.`,
        reconciledPositionIdsUsed: reconciledIdsUsed,
        sampleCycleIdsUsed,
        ...sampleReferences,
      };
      return {
        learningRun,
        rolledBackToPolicy: rolledBackPolicy,
      };
    } else {
      // No valid fallback version exists -> HALT new simulated positions!
      const learningRun: LearningRunRecord = {
        runId,
        triggerCycleId,
        learnerVersion: LEARNER_VERSION,
        executedAtMarketTime: decisionMarketTime,
        executedAtSystemTime: systemTime,
        triggerReasonVi,
        trainWindowStartMarketTime,
        trainWindowEndMarketTime,
        validationWindowStartMarketTime,
        validationWindowEndMarketTime,
        rankingFormula: RANKING_FORMULA_TEXT,
        minSamplesPerRegime,
        intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST',
        totalCompletedSamplesUsed: validWalkForwardSamples.length,
        totalExcludedSamples: exclusions.length,
        exclusions,
        rankingsByRegime,
        regimeComparisons,
        overallAdaptiveMetrics,
        overallBaselineMetrics,
        hypothesesTested,
        decision: 'HALT_NEW_POSITIONS_DEGRADED',
        previousPolicyId: activePolicy.policyId,
        resultingPolicyId: activePolicy.policyId,
        decisionReasonVi: `NGỪNG MỞ VỊ THẾ MỚI: Kết quả chính sách ${
          activePolicy.policyId
        } suy giảm qua ngưỡng (${activePolicyCumNetPnl.toFixed(
          2
        )} USD <= ${degradationLossThresholdUsd} USD) và không còn phiên bản dự phòng hợp lệ. Đã kích hoạt chốt chặn dừng mở vị thế mới.`,
        reconciledPositionIdsUsed: reconciledIdsUsed,
        sampleCycleIdsUsed,
        ...sampleReferences,
      };
      return {
        learningRun,
        haltNewPositions: true,
      };
    }
  }

  const validationFailures: string[] = [];
  if (proposedRegimes.size === 0) validationFailures.push('Tập huấn luyện chưa chọn thay đổi');
  if (overallAdaptiveMetrics.netPnlAfterCostUsd <= Math.max(0, overallBaselineMetrics.netPnlAfterCostUsd)) {
    validationFailures.push('Lãi ròng toàn kỳ chưa vượt mức yêu cầu');
  }
  if (overallAdaptiveMetrics.netPnlAt2xCostUsd < Math.max(0, overallBaselineMetrics.netPnlAt2xCostUsd)) {
    validationFailures.push('Lãi ròng toàn kỳ ở 2× chi phí thấp hơn mức yêu cầu');
  }
  if (overallAdaptiveMetrics.maxDrawdownUsd > overallBaselineMetrics.maxDrawdownUsd) {
    validationFailures.push('Sụt giảm tối đa toàn kỳ cao hơn cơ sở');
  }
  for (const row of regimeComparisons) {
    if (!proposedRegimes.has(row.regime)) continue;
    if (row.adaptive.tradesCount < minSamplesPerRegime) {
      validationFailures.push(`${row.regimeLabelVi}: chỉ có ${row.adaptive.tradesCount}/${minSamplesPerRegime} giao dịch ngoài mẫu`);
    }
    if (row.adaptive.netPnlAfterCostUsd <= Math.max(0, row.baseline.netPnlAfterCostUsd)) {
      validationFailures.push(`${row.regimeLabelVi}: lãi ròng ${row.adaptive.netPnlAfterCostUsd} USD chưa vượt ${Math.max(0, row.baseline.netPnlAfterCostUsd)} USD`);
    }
  }

  if (validationFailures.length === 0) {
    const nextVersionNum = allPolicies.length + 1;
    const newPolicyId = `POLICY_ADAPTIVE_V${nextVersionNum}`;
    const changedDescriptions: string[] = [];
    for (const r of tradeableRegimes) {
      const before = activePolicy.mapping[r];
      const after = proposedMapping[r];
      const bStr =
        before === 'STAND_ASIDE' ? 'STAND_ASIDE' : `${before.strategyId}@${before.version}`;
      const aStr =
        after === 'STAND_ASIDE' ? 'STAND_ASIDE' : `${after.strategyId}@${after.version}`;
      if (bStr !== aStr) {
        changedDescriptions.push(`${REGIME_LABELS_VI[r]}: ${bStr} -> ${aStr}`);
      }
    }

    const newPolicy: PolicyVersionRecord = {
      policyId: newPolicyId,
      versionNumber: nextVersionNum,
      createdAtMarketTime: decisionMarketTime,
      createdAtSystemTime: systemTime,
      parentPolicyId: activePolicy.policyId,
      sourceRunId: runId,
      learnerVersion: LEARNER_VERSION,
      status: 'ACTIVE',
      isBaseline: false,
      mapping: proposedMapping,
      activationReasonVi: `Tự động kích hoạt từ lần học ${runId}: Vượt đường cơ sở Walk-Forward (Lãi ròng 1x chi phí: +${overallAdaptiveMetrics.netPnlAfterCostUsd.toFixed(
        2
      )} USD so với cơ sở +${overallBaselineMetrics.netPnlAfterCostUsd.toFixed(
        2
      )} USD; 2x chi phí: +${overallAdaptiveMetrics.netPnlAt2xCostUsd.toFixed(
        2
      )} USD). Cập nhật: ${changedDescriptions.join('; ')}.`,
    };

    const learningRun: LearningRunRecord = {
      runId,
      triggerCycleId,
      learnerVersion: LEARNER_VERSION,
      executedAtMarketTime: decisionMarketTime,
      executedAtSystemTime: systemTime,
      triggerReasonVi,
      trainWindowStartMarketTime,
      trainWindowEndMarketTime,
      validationWindowStartMarketTime,
      validationWindowEndMarketTime,
      rankingFormula: RANKING_FORMULA_TEXT,
      minSamplesPerRegime,
      intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST',
      totalCompletedSamplesUsed: validWalkForwardSamples.length,
      totalExcludedSamples: exclusions.length,
      exclusions,
      rankingsByRegime,
      regimeComparisons,
      overallAdaptiveMetrics,
      overallBaselineMetrics,
      hypothesesTested: hypothesesTested.map((hypothesis) =>
        hypothesis.validationStatus === 'TRAINING_SELECTED'
          ? { ...hypothesis, validationStatus: 'PROMOTED',
              validationNoteVi: hypothesis.validationNoteVi.replace(
                'Chờ kết quả ngoài mẫu.', 'Đã qua kiểm định ngoài mẫu.'
              ) }
          : hypothesis
      ),
      decision: 'PROMOTE_NEW_POLICY',
      previousPolicyId: activePolicy.policyId,
      resultingPolicyId: newPolicyId,
      decisionReasonVi: newPolicy.activationReasonVi,
      reconciledPositionIdsUsed: reconciledIdsUsed,
      sampleCycleIdsUsed,
      ...sampleReferences,
    };

    return {
      learningRun,
      newPolicyToActivate: newPolicy,
    };
  }

  // Otherwise keep current valid policy (either due to insufficient samples or current policy is already optimal)
  const isInsufficient =
    validationSamples.length < minSamplesPerRegime || trainingSamples.length < minSamplesPerRegime ||
    (anyInsufficientSamples && validWalkForwardSamples.length < 6);

  const decision = isInsufficient
    ? 'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES'
    : 'KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE';

  const decisionReasonVi = isInsufficient
    ? `Chưa đủ mẫu hoàn tất sau lọc Walk-Forward (${validWalkForwardSamples.length} mẫu hợp lệ, ngưỡng tối thiểu ${minSamplesPerRegime} mẫu/trạng thái). Giữ nguyên chính sách hợp lệ hiện tại (${activePolicy.policyId}).`
    : `Giữ nguyên ${activePolicy.policyId}. Kiểm định ngoài mẫu (${validationSamples.length} mẫu): ${validationFailures.join('; ')}.`;

  const learningRun: LearningRunRecord = {
    runId,
    triggerCycleId,
    learnerVersion: LEARNER_VERSION,
    executedAtMarketTime: decisionMarketTime,
    executedAtSystemTime: systemTime,
    triggerReasonVi,
    trainWindowStartMarketTime,
    trainWindowEndMarketTime,
    validationWindowStartMarketTime,
    validationWindowEndMarketTime,
    rankingFormula: RANKING_FORMULA_TEXT,
    minSamplesPerRegime,
    intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST',
    totalCompletedSamplesUsed: validWalkForwardSamples.length,
    totalExcludedSamples: exclusions.length,
    exclusions,
    rankingsByRegime,
    regimeComparisons,
    overallAdaptiveMetrics,
    overallBaselineMetrics,
    hypothesesTested: hypothesesTested.map((hypothesis) =>
      hypothesis.validationStatus === 'TRAINING_SELECTED'
        ? { ...hypothesis, validationStatus: 'REJECTED_UNDERPERFORMED',
            validationNoteVi: hypothesis.validationNoteVi.replace(
              'Chờ kết quả ngoài mẫu.', 'Chưa đạt tiêu chí kích hoạt ngoài mẫu.'
            ) }
        : hypothesis
    ),
    decision,
    previousPolicyId: activePolicy.policyId,
    resultingPolicyId: activePolicy.policyId,
    decisionReasonVi,
    reconciledPositionIdsUsed: reconciledIdsUsed,
    sampleCycleIdsUsed,
    ...sampleReferences,
  };

  return { learningRun };
}
