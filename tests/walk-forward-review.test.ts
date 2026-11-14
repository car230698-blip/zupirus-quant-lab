import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { createQuantServer } from '../server.ts';

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
