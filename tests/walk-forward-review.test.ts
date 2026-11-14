import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { createQuantServer } from '../server.ts';
import type { LearningRunRecord, PolicyVersionRecord, QuantSystemState, ShadowCandidateOutcome } from '../src/quant/types.ts';

it('screens a replay learning run via admin API without changing positions or policy', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zup-review-'));
  const { app, orchestrator } = await createQuantServer({
    dataDir: directory,
    autoStart: false,
    attachFrontend: false,
    strictAuth: true,
    adminToken: 'review-fixture-admin',
    viewerToken: 'review-fixture-viewer',
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    while (!orchestrator.getState().isReplayComplete) orchestrator.stepNextReplayCandle();

    const before = structuredClone(orchestrator.getState());
    const run = before.learningRuns.at(-1);
    assert.ok(run?.rankingsByRegime.length);
    const url = 'http://127.0.0.1:' + address.port + '/api/research/walk-forward/';
    const get = (id: string, token: string) => fetch(url + id, {
      headers: { Authorization: 'Bearer ' + token },
    });

    assert.equal((await fetch(url + run.runId)).status, 401);
    assert.equal((await get(run.runId, 'review-fixture-viewer')).status, 403);
    assert.equal((await get('missing', 'review-fixture-admin')).status, 404);
    const result = await get(run.runId, 'review-fixture-admin');
    assert.equal(result.status, 200);
    const review = await result.json();
    assert.equal(review.runId, run.runId);
    assert.equal(review.engineDecision, run.decision);
    assert.equal(review.screenedCount, run.rankingsByRegime.length);
    const eligible = run.rankingsByRegime.filter(row =>
      row.sampleCount >= run.minSamplesPerRegime && row.netPnlUsd > 0 &&
      row.netPnlAt2xCostUsd > 0 && Number.isFinite(row.rankingScore));
    assert.equal(review.eligibleCount, eligible.length);
    assert.equal(review.candidates.length, new Set(eligible.map(row => row.regime)).size);
    for (const candidate of review.candidates) {
      assert.equal(candidate.rankingScore, Math.max(...eligible
        .filter(row => row.regime === candidate.regime).map(row => row.rankingScore)));
    }
    const after = orchestrator.getState();
    for (const key of ['activePolicyId', 'policies', 'riskLimits', 'openPositions', 'closedPositions', 'learningRuns'] as const) {
      assert.deepEqual(after[key], before[key]);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

it('excludes pre-selection and late exits and distinguishes preliminary forward results', async () => {
  const { compareForwardCandidates } = await import('../src/research/forwardComparison.ts');
  const start = Date.parse('2026-03-02T00:00:00Z');
  const time = (hour: number) => new Date(start + hour * 3_600_000).toISOString();
  const run = { executedAtMarketTime: time(0), resultingPolicyId: 'baseline',
    minSamplesPerRegime: 1 } as LearningRunRecord;
  const rule = { strategyId: 'STRAT_TREND_FOLLOW', version: 'base' } as const;
  const candidate = { regime: 'TRENDING', strategyId: rule.strategyId, strategyVersion: 'candidate' };
  const sample = (id: string, version: string, entry: number, close: number, pnl: number) => ({
    shadowId: id, cycleId: id, regime: 'TRENDING', strategyId: rule.strategyId, strategyVersion: version,
    status: 'CLOSED_RECONCILED', entryMarketTime: time(entry), closeMarketTime: time(close),
    riskSizedVolumeLots: 0.1, grossPnlUsd: pnl + 1, totalCostUsd: 1,
    netPnlUsd: pnl, netPnlAt2xCostUsd: pnl - 1,
  }) as ShadowCandidateOutcome;
  const state = {
    lastProcessedMarketTime: time(24),
    riskLimits: { maxOpenPositions: 1, maxTotalExposureLots: 1 } as QuantSystemState['riskLimits'],
    policies: [{ policyId: 'baseline', mapping: { TRENDING: rule } }] as PolicyVersionRecord[],
    shadowOutcomes: [
      sample('old', 'candidate', 0, 2, 100),
      sample('candidate', 'candidate', 1, 2, 5),
      sample('base', 'base', 1, 2, 2),
      sample('late', 'candidate', 23, 25, 100),
    ],
  };
  const final = compareForwardCandidates(run, state, [candidate]).comparisons[0];
  assert.equal(final.metrics.tradesCount, 1);
  assert.equal(final.metrics.netPnlAfterCostUsd, 5);
  assert.equal(final.status, 'OUTPERFORMED');
  const live = compareForwardCandidates(run, { ...state, lastProcessedMarketTime: time(1.5) }, [candidate]);
  assert.equal(live.comparisons[0].metrics.tradesCount, 0);
  assert.equal(live.comparisons[0].status, 'WINDOW_IN_PROGRESS');
});
