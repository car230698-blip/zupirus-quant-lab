import { applyValidationCapacity, computeComparisonMetrics } from '../quant/researchTeam.ts';
import type { LearningRunRecord, MarketRegime, QuantSystemState } from '../quant/types.ts';

const WINDOW_MS = 24 * 60 * 60_000;

export function compareForwardCandidates(
  run: LearningRunRecord,
  state: Pick<QuantSystemState, 'lastProcessedMarketTime' | 'shadowOutcomes' | 'policies' | 'riskLimits'>,
  candidates: { regime: string; strategyId: string; strategyVersion: string }[]
) {
  const start = Date.parse(run.executedAtMarketTime);
  const end = start + WINDOW_MS;
  const latest = Date.parse(state.lastProcessedMarketTime ?? '');
  const cutoff = Math.min(end, latest);
  const complete = latest >= end;
  const baseline = state.policies.find(policy => policy.policyId === run.resultingPolicyId);
  const samples = state.shadowOutcomes.filter(sample => {
    const entry = Date.parse(sample.entryMarketTime);
    const close = Date.parse(sample.closeMarketTime ?? '');
    return sample.status === 'CLOSED_RECONCILED' &&
      Number.isFinite(sample.riskSizedVolumeLots) && sample.riskSizedVolumeLots! > 0 &&
      entry > start && close >= entry && close <= cutoff;
  });

  const comparisons = candidates.map(candidate => {
    const rows = samples.filter(sample => sample.regime === candidate.regime);
    const opportunities = new Set(rows.map(sample => sample.cycleId)).size;
    const measure = (strategyId: string, version: string) => computeComparisonMetrics(
      opportunities,
      applyValidationCapacity(rows.filter(row => row.strategyId === strategyId &&
        row.strategyVersion === version), state.riskLimits)
    );
    const metrics = measure(candidate.strategyId, candidate.strategyVersion);
    const rule = baseline?.mapping[candidate.regime as MarketRegime];
    const policyMetrics = rule === 'STAND_ASIDE' ? computeComparisonMetrics(opportunities, []) :
      rule ? measure(rule.strategyId, rule.version) : null;
    return {
      ...candidate,
      metrics,
      policyMetrics,
      status: !rule ? 'MISSING_POLICY' : !complete ? 'WINDOW_IN_PROGRESS' :
        rule !== 'STAND_ASIDE' && rule.strategyId === candidate.strategyId &&
          rule.version === candidate.strategyVersion ? 'SAME_STRATEGY' :
        metrics.tradesCount < run.minSamplesPerRegime ||
          (rule !== 'STAND_ASIDE' && policyMetrics!.tradesCount < run.minSamplesPerRegime) ? 'INSUFFICIENT_SAMPLES' :
        metrics.netPnlAfterCostUsd > policyMetrics!.netPnlAfterCostUsd &&
          metrics.netPnlAt2xCostUsd > policyMetrics!.netPnlAt2xCostUsd &&
          metrics.maxDrawdownUsd <= policyMetrics!.maxDrawdownUsd ? 'OUTPERFORMED' : 'DID_NOT_OUTPERFORM',
    } as const;
  });
  return {
    startMarketTime: run.executedAtMarketTime,
    endMarketTime: new Date(end).toISOString(),
    observedThrough: Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null,
    complete,
    referencePolicyId: run.resultingPolicyId,
    comparisons,
  };
}
