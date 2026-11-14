import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { z } from 'zod/v4';
import type { LearningRunRecord } from '../quant/types.ts';

const evidenceSchema = z.object({
  regime: z.string(),
  strategyId: z.string(),
  strategyVersion: z.string(),
  samples: z.number(),
  netPnlUsd: z.number(),
  netPnlAt2xCostUsd: z.number(),
  maxDrawdownUsd: z.number(),
  rankingScore: z.number(),
});

const ReviewState = new StateSchema({
  marketTime: z.string(),
  minSamples: z.number(),
  rankings: z.array(evidenceSchema),
  eligible: z.array(evidenceSchema).default([]),
  candidates: z.array(evidenceSchema).default([]),
});

const reviewGraph = new StateGraph(ReviewState)
  .addNode('screen_training_evidence', ({ rankings, minSamples }) => ({
    eligible: rankings.filter((row) => row.samples >= minSamples &&
      row.netPnlUsd > 0 && row.netPnlAt2xCostUsd > 0 &&
      Number.isFinite(row.rankingScore)),
  }))
  .addNode('shortlist_by_regime', ({ eligible }) => {
    const best = new Map<string, (typeof eligible)[number]>();
    for (const row of eligible) {
      const current = best.get(row.regime);
      if (!current || row.rankingScore > current.rankingScore) best.set(row.regime, row);
    }
    return { candidates: [...best.values()] };
  })
  .addEdge(START, 'screen_training_evidence')
  .addEdge('screen_training_evidence', 'shortlist_by_regime')
  .addEdge('shortlist_by_regime', END)
  .compile();

export async function reviewWalkForwardRun(run: LearningRunRecord) {
  const result = await reviewGraph.invoke({
    marketTime: run.executedAtMarketTime,
    minSamples: run.minSamplesPerRegime,
    rankings: run.rankingsByRegime.map(({ sampleCount, ...row }) => ({
      regime: row.regime,
      strategyId: row.strategyId,
      strategyVersion: row.strategyVersion,
      samples: sampleCount,
      netPnlUsd: row.netPnlUsd,
      netPnlAt2xCostUsd: row.netPnlAt2xCostUsd,
      maxDrawdownUsd: row.maxDrawdownUsd,
      rankingScore: row.rankingScore,
    })),
  });

  return {
    runId: run.runId,
    asOfMarketTime: result.marketTime,
    minSamplesPerRegime: result.minSamples,
    screenedCount: result.rankings.length,
    eligibleCount: result.eligible.length,
    candidates: result.candidates,
    engineDecision: run.decision,
    resultingPolicyId: run.resultingPolicyId,
  };
}

export type WalkForwardReview = Awaited<ReturnType<typeof reviewWalkForwardRun>>;
