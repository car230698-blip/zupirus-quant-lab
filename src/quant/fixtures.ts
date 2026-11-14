import { executeWalkForwardLearningRun } from './researchTeam.ts';
import { cloneRiskLimits } from './riskGate.ts';
import { createBaselinePolicyRecord } from './strategies.ts';
import {
  LearningRunRecord,
  MarketRegime,
  PolicyVersionRecord,
  ShadowCandidateOutcome,
  SimulatedPosition,
  StrategyId,
} from './types.ts';

export interface LearningBranchFixtureResult {
  branchCode: LearningRunRecord['decision'];
  branchNameVi: string;
  passed: boolean;
  previousPolicyId: string;
  resultingPolicyId: string;
  haltNewPositionsTriggered: boolean;
  trainSamplesCount: number;
  validationSamplesCount: number;
  excludedSamplesCount: number;
  decisionReasonVi: string;
}

export interface LearningBranchFixtureSuiteReport {
  executedAtSystemTime: string;
  disclosureVi: string;
  allBranchesPassed: boolean;
  branches: LearningBranchFixtureResult[];
}

function makeFixtureShadowSample(params: {
  shadowId: string;
  cycleId: string;
  regime: MarketRegime;
  strategyId: StrategyId;
  strategyVersion: string;
  entryMarketTime: string;
  closeMarketTime: string;
  netPnlUsd: number;
  totalCostUsd?: number;
  volumeLots?: number;
}): ShadowCandidateOutcome {
  const cost = params.totalCostUsd ?? 2.5;
  const gross = Number((params.netPnlUsd + cost).toFixed(2));
  const net2x = Number((gross - 2 * cost).toFixed(2));
  return {
    shadowId: params.shadowId,
    cycleId: params.cycleId,
    candleId: `FIXTURE-CANDLE-${params.cycleId}`,
    regime: params.regime,
    strategyId: params.strategyId,
    strategyVersion: params.strategyVersion,
    direction: 'BUY',
    entryMarketTime: params.entryMarketTime,
    closeMarketTime: params.closeMarketTime,
    entryCandleIndex: 1,
    closeCandleIndex: 2,
    status: 'CLOSED_RECONCILED',
    source: 'PARALLEL_SHADOW_SIM',
    wasSelectedByActivePolicy: false,
    wasSelectedByBaselinePolicy: false,
    expectedEntryPrice: 2880,
    fillEntryPrice: 2880.1,
    entrySlippagePts: 2,
    riskSizedVolumeLots: params.volumeLots ?? 0.25,
    avgExitPrice: 2882.5,
    grossPnlUsd: gross,
    totalCostUsd: cost,
    netPnlUsd: params.netPnlUsd,
    netPnlAt2xCostUsd: net2x,
    exitReason: params.netPnlUsd >= 0 ? 'TP2_FULL_TARGET' : 'STOP_LOSS_HIT',
    intraBarConflictTriggered: false,
  };
}

/**
 * Runs purposeful deterministic fixtures proving that the Walk-Forward Learner
 * exercises all 5 required software decision branches:
 * 1. KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES (Thiếu mẫu)
 * 2. KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE (Giữ nguyên khi không vượt trội ngoài mẫu)
 * 3. PROMOTE_NEW_POLICY (Tự áp dụng chính sách mới khi đạt chuẩn ngoài mẫu & 2x chi phí)
 * 4. ROLLBACK_TO_PREVIOUS_POLICY (Tự quay lui khi chính sách đang chạy suy giảm)
 * 5. HALT_NEW_POSITIONS_DEGRADED (Dừng mở lệnh mới khi hết phương án dự phòng hợp lệ)
 */
export function runAllLearningBranchFixtures(
  systemTime: string = new Date().toISOString()
): LearningBranchFixtureSuiteReport {
  const cutoffIso = '2026-03-03T00:00:00.000Z';
  const baseline = createBaselinePolicyRecord('2026-03-02T08:00:00.000Z', systemTime);
  const capacity = cloneRiskLimits();
  const branches: LearningBranchFixtureResult[] = [];

  // ==========================================================================
  // Branch 1: KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES
  // ==========================================================================
  const b1Samples: ShadowCandidateOutcome[] = [
    makeFixtureShadowSample({
      shadowId: 'FIX-B1-1',
      cycleId: 'C-01',
      regime: 'TRENDING',
      strategyId: 'STRAT_TREND_FOLLOW',
      strategyVersion: 'v1.3.0',
      entryMarketTime: '2026-03-02T09:00:00.000Z',
      closeMarketTime: '2026-03-02T09:30:00.000Z',
      netPnlUsd: 35,
    }),
  ];
  const res1 = executeWalkForwardLearningRun({
    runId: 'LR-FIXTURE-B1',
    triggerCycleId: 'CYCLE-FIX-B1',
    decisionMarketTime: cutoffIso,
    systemTime,
    triggerReasonVi: 'Fixture kiểm chứng nhánh Thiếu mẫu (Insufficient Samples)',
    allShadowOutcomes: b1Samples,
    reconciledPositions: [],
    activePolicy: baseline,
    baselinePolicy: baseline,
    allPolicies: [baseline],
    minSamplesPerRegime: 3,
    portfolioCapacity: capacity,
  });
  branches.push({
    branchCode: res1.learningRun.decision,
    branchNameVi: '1. Nhánh Thiếu mẫu → Giữ nguyên chính sách hiện tại',
    passed:
      res1.learningRun.decision === 'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES' &&
      !res1.newPolicyToActivate,
    previousPolicyId: res1.learningRun.previousPolicyId,
    resultingPolicyId: res1.learningRun.resultingPolicyId,
    haltNewPositionsTriggered: Boolean(res1.haltNewPositions),
    trainSamplesCount: res1.learningRun.trainingSampleIds?.length ?? 0,
    validationSamplesCount: res1.learningRun.validationSampleIds?.length ?? 0,
    excludedSamplesCount: res1.learningRun.totalExcludedSamples,
    decisionReasonVi: res1.learningRun.decisionReasonVi,
  });

  // Helper to build train + validation sample sets across [09:00..23:30]
  // With earliest = 09:00 and cutoff = 24:00 (15 hours = 900m), splitMs is at 09:00 + 0.65*15h = 18:45 UTC.
  const buildWindowSamples = (
    valCandPnl: number,
    valBasePnl: number
  ): ShadowCandidateOutcome[] => {
    const trainHours = ['09:00', '10:30', '12:00'];
    const valHours = ['19:30', '21:00', '22:30'];
    const list: ShadowCandidateOutcome[] = [];

    trainHours.forEach((hhmm, idx) => {
      const entry = `2026-03-02T${hhmm}:00.000Z`;
      const close = new Date(Date.parse(entry) + 30 * 60_000).toISOString();
      list.push(
        makeFixtureShadowSample({
          shadowId: `TRAIN-BASE-${idx}`,
          cycleId: `C-TR-${idx}`,
          regime: 'TRENDING',
          strategyId: 'STRAT_TREND_FOLLOW',
          strategyVersion: 'v1.2.0',
          entryMarketTime: entry,
          closeMarketTime: close,
          netPnlUsd: 12,
        }),
        makeFixtureShadowSample({
          shadowId: `TRAIN-CAND-${idx}`,
          cycleId: `C-TR-${idx}`,
          regime: 'TRENDING',
          strategyId: 'STRAT_TREND_FOLLOW',
          strategyVersion: 'v1.3.0-H1-M15',
          entryMarketTime: entry,
          closeMarketTime: close,
          netPnlUsd: 42,
        })
      );
    });

    valHours.forEach((hhmm, idx) => {
      const entry = `2026-03-02T${hhmm}:00.000Z`;
      const close = new Date(Date.parse(entry) + 30 * 60_000).toISOString();
      list.push(
        makeFixtureShadowSample({
          shadowId: `VAL-BASE-${idx}`,
          cycleId: `C-VL-${idx}`,
          regime: 'TRENDING',
          strategyId: 'STRAT_TREND_FOLLOW',
          strategyVersion: 'v1.2.0',
          entryMarketTime: entry,
          closeMarketTime: close,
          netPnlUsd: valBasePnl,
        }),
        makeFixtureShadowSample({
          shadowId: `VAL-CAND-${idx}`,
          cycleId: `C-VL-${idx}`,
          regime: 'TRENDING',
          strategyId: 'STRAT_TREND_FOLLOW',
          strategyVersion: 'v1.3.0-H1-M15',
          entryMarketTime: entry,
          closeMarketTime: close,
          netPnlUsd: valCandPnl,
        })
      );
    });

    // Add 1 boundary-straddling sample (18:30 -> 19:00 across 18:45 split) to verify purging
    list.push(
      makeFixtureShadowSample({
        shadowId: 'OVERLAP-BOUNDARY-SAMPLE',
        cycleId: 'C-OVL',
        regime: 'TRENDING',
        strategyId: 'STRAT_TREND_FOLLOW',
        strategyVersion: 'v1.3.0-H1-M15',
        entryMarketTime: '2026-03-02T18:30:00.000Z',
        closeMarketTime: '2026-03-02T19:00:00.000Z',
        netPnlUsd: 100,
      })
    );

    return list;
  };

  // ==========================================================================
  // Branch 2: KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE
  // ==========================================================================
  const res2 = executeWalkForwardLearningRun({
    runId: 'LR-FIXTURE-B2',
    triggerCycleId: 'CYCLE-FIX-B2',
    decisionMarketTime: cutoffIso,
    systemTime,
    triggerReasonVi: 'Fixture kiểm chứng nhánh Giữ nguyên khi ứng viên kém hiệu quả ngoài mẫu',
    allShadowOutcomes: buildWindowSamples(-15, 18),
    reconciledPositions: [],
    activePolicy: baseline,
    baselinePolicy: baseline,
    allPolicies: [baseline],
    minSamplesPerRegime: 2,
    portfolioCapacity: capacity,
  });
  branches.push({
    branchCode: res2.learningRun.decision,
    branchNameVi: '2. Nhánh Không vượt trội ngoài mẫu → Giữ nguyên chính sách',
    passed:
      res2.learningRun.decision === 'KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE' &&
      !res2.newPolicyToActivate,
    previousPolicyId: res2.learningRun.previousPolicyId,
    resultingPolicyId: res2.learningRun.resultingPolicyId,
    haltNewPositionsTriggered: Boolean(res2.haltNewPositions),
    trainSamplesCount: res2.learningRun.trainingSampleIds?.length ?? 0,
    validationSamplesCount: res2.learningRun.validationSampleIds?.length ?? 0,
    excludedSamplesCount: res2.learningRun.totalExcludedSamples,
    decisionReasonVi: res2.learningRun.decisionReasonVi,
  });

  // ==========================================================================
  // Branch 3: PROMOTE_NEW_POLICY
  // ==========================================================================
  const res3 = executeWalkForwardLearningRun({
    runId: 'LR-FIXTURE-B3',
    triggerCycleId: 'CYCLE-FIX-B3',
    decisionMarketTime: cutoffIso,
    systemTime,
    triggerReasonVi: 'Fixture kiểm chứng nhánh Tự áp dụng chính sách mới (Promote Adaptive Policy)',
    allShadowOutcomes: buildWindowSamples(48, 12),
    reconciledPositions: [],
    activePolicy: baseline,
    baselinePolicy: baseline,
    allPolicies: [baseline],
    minSamplesPerRegime: 2,
    portfolioCapacity: capacity,
  });
  const promotedPolicy: PolicyVersionRecord =
    res3.newPolicyToActivate || {
      ...structuredClone(baseline),
      policyId: 'POLICY_ADAPTIVE_V2',
      versionNumber: 2,
      status: 'ACTIVE',
      isBaseline: false,
    };
  branches.push({
    branchCode: res3.learningRun.decision,
    branchNameVi: '3. Nhánh Đạt chuẩn Walk-Forward → Tự áp dụng chính sách mới',
    passed:
      res3.learningRun.decision === 'PROMOTE_NEW_POLICY' &&
      Boolean(res3.newPolicyToActivate) &&
      res3.learningRun.resultingPolicyId === 'POLICY_ADAPTIVE_V2',
    previousPolicyId: res3.learningRun.previousPolicyId,
    resultingPolicyId: res3.learningRun.resultingPolicyId,
    haltNewPositionsTriggered: Boolean(res3.haltNewPositions),
    trainSamplesCount: res3.learningRun.trainingSampleIds?.length ?? 0,
    validationSamplesCount: res3.learningRun.validationSampleIds?.length ?? 0,
    excludedSamplesCount: res3.learningRun.totalExcludedSamples,
    decisionReasonVi: res3.learningRun.decisionReasonVi,
  });

  // ==========================================================================
  // Branch 4: ROLLBACK_TO_PREVIOUS_POLICY
  // ==========================================================================
  const degradedPositionUnderV2 = {
    positionId: 'POS-FIX-DEGRADED-V2',
    openedUnderPolicyId: promotedPolicy.policyId,
    reconciled: true,
    closeMarketTime: '2026-03-02T23:00:00.000Z',
    netPnlUsd: -265,
    grossPnlUsd: -255,
    totalCostUsd: 10,
  } as SimulatedPosition;

  const supersededBaseline: PolicyVersionRecord = {
    ...structuredClone(baseline),
    status: 'SUPERSEDED',
  };

  const res4 = executeWalkForwardLearningRun({
    runId: 'LR-FIXTURE-B4',
    triggerCycleId: 'CYCLE-FIX-B4',
    decisionMarketTime: cutoffIso,
    systemTime,
    triggerReasonVi: 'Fixture kiểm chứng nhánh Tự quay lui (Auto-Rollback) khi suy giảm',
    allShadowOutcomes: buildWindowSamples(10, 12),
    reconciledPositions: [degradedPositionUnderV2],
    activePolicy: promotedPolicy,
    baselinePolicy: supersededBaseline,
    allPolicies: [supersededBaseline, promotedPolicy],
    minSamplesPerRegime: 2,
    degradationLossThresholdUsd: -220,
    portfolioCapacity: capacity,
  });
  branches.push({
    branchCode: res4.learningRun.decision,
    branchNameVi: '4. Nhánh Suy giảm hiệu suất → Tự quay lui về phiên bản hợp lệ trước đó',
    passed:
      res4.learningRun.decision === 'ROLLBACK_TO_PREVIOUS_POLICY' &&
      res4.rolledBackToPolicy?.policyId === baseline.policyId,
    previousPolicyId: res4.learningRun.previousPolicyId,
    resultingPolicyId: res4.learningRun.resultingPolicyId,
    haltNewPositionsTriggered: Boolean(res4.haltNewPositions),
    trainSamplesCount: res4.learningRun.trainingSampleIds?.length ?? 0,
    validationSamplesCount: res4.learningRun.validationSampleIds?.length ?? 0,
    excludedSamplesCount: res4.learningRun.totalExcludedSamples,
    decisionReasonVi: res4.learningRun.decisionReasonVi,
  });

  // ==========================================================================
  // Branch 5: HALT_NEW_POSITIONS_DEGRADED
  // ==========================================================================
  const degradedPositionUnderBaseline = {
    positionId: 'POS-FIX-DEGRADED-BASE',
    openedUnderPolicyId: baseline.policyId,
    reconciled: true,
    closeMarketTime: '2026-03-02T23:30:00.000Z',
    netPnlUsd: -290,
    grossPnlUsd: -280,
    totalCostUsd: 10,
  } as SimulatedPosition;

  const rolledBackV2: PolicyVersionRecord = {
    ...structuredClone(promotedPolicy),
    status: 'ROLLED_BACK',
  };

  const res5 = executeWalkForwardLearningRun({
    runId: 'LR-FIXTURE-B5',
    triggerCycleId: 'CYCLE-FIX-B5',
    decisionMarketTime: cutoffIso,
    systemTime,
    triggerReasonVi: 'Fixture kiểm chứng nhánh Dừng mở vị thế khi hết phương án đạt',
    allShadowOutcomes: buildWindowSamples(-20, -25),
    reconciledPositions: [degradedPositionUnderV2, degradedPositionUnderBaseline],
    activePolicy: baseline,
    baselinePolicy: baseline,
    allPolicies: [baseline, rolledBackV2],
    minSamplesPerRegime: 2,
    degradationLossThresholdUsd: -220,
    portfolioCapacity: capacity,
  });
  branches.push({
    branchCode: res5.learningRun.decision,
    branchNameVi: '5. Nhánh Suy giảm & Hết phương án dự phòng → Dừng mở lệnh mới (Halt)',
    passed:
      res5.learningRun.decision === 'HALT_NEW_POSITIONS_DEGRADED' &&
      res5.haltNewPositions === true,
    previousPolicyId: res5.learningRun.previousPolicyId,
    resultingPolicyId: res5.learningRun.resultingPolicyId,
    haltNewPositionsTriggered: Boolean(res5.haltNewPositions),
    trainSamplesCount: res5.learningRun.trainingSampleIds?.length ?? 0,
    validationSamplesCount: res5.learningRun.validationSampleIds?.length ?? 0,
    excludedSamplesCount: res5.learningRun.totalExcludedSamples,
    decisionReasonVi: res5.learningRun.decisionReasonVi,
  });

  return {
    executedAtSystemTime: systemTime,
    disclosureVi:
      'Bằng chứng hành vi phần mềm từ bộ Fixture có chủ đích: Xác nhận bộ học Walk-Forward thực sự đi qua đủ 5 nhánh quyết định (Thiếu mẫu, Giữ nguyên, Tự áp dụng, Tự quay lui, Dừng mở lệnh). Kết quả này là kiểm định logic phần mềm, tách biệt hoàn toàn với báo cáo hiệu quả chiến lược trên chuỗi dữ liệu thị trường.',
    allBranchesPassed: branches.every((b) => b.passed),
    branches,
  };
}
