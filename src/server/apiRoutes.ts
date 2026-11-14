import type express from 'express';
import fs from 'fs';
import type { QuantLabOrchestrator } from '../quant/orchestrator.ts';
import type { ExecutionCostLatencyOptions } from '../quant/simBroker.ts';
import type { createAuthMiddleware } from './authMiddleware.ts';

export interface RegisterApiRoutesOptions {
  app: express.Express;
  orchestrator: QuantLabOrchestrator;
  auth: ReturnType<typeof createAuthMiddleware>;
  liveTicks: boolean;
}

export function registerQuantApiRoutes({
  app,
  orchestrator,
  auth,
  liveTicks,
}: RegisterApiRoutesOptions): void {
  const { resolveRequestRole, requireRoles } = auth;

  const requireReplay: express.RequestHandler = (_req, res, next) => {
    if (liveTicks) {
      res.status(409).json({
        error: 'REPLAY_ONLY',
        messageVi: 'Điều khiển này chỉ dùng cho phiên replay.',
      });
      return;
    }
    next();
  };

  // 0. Session & Hostname Routing discovery endpoint
  app.get('/api/auth/session', (req, res) => {
    const resolved = resolveRequestRole(req);
    res.json({
      authenticated: resolved.authenticated,
      role: resolved.role,
      hostSurface: resolved.hostSurface,
      hostname: resolved.hostname,
      strictAuth: auth.strictAuth,
      localDevTokensEnabled:
        !auth.strictAuth && resolved.hostSurface === 'LOCAL_MULTI_SURFACE',
    });
  });

  // 1. Health check endpoint for Docker Compose & VPS monitoring
  app.get('/api/health', (_req, res) => {
    const state = orchestrator.getState();
    const paths = orchestrator.getStoragePaths();
    res.json({
      status: 'ok',
      service: 'zupirus-quant-lab',
      executionMode: state.executionMode,
      symbol: state.symbol,
      timeframe: state.timeframe,
      replayProgress: `${state.replayCursorIndex}/${state.totalReplayCandles}`,
      isLoopRunning: state.isLoopRunning,
      isReplayComplete: state.isReplayComplete,
      activePolicyId: state.activePolicyId,
      restartCount: state.restartCount,
      lastProcessedMarketTime: state.lastProcessedMarketTime,
      lastUpdatedSystemTime: state.lastUpdatedSystemTime,
      dataSourceTelemetry: state.dataSourceTelemetry,
      lastScheduleEvaluation: state.lastScheduleEvaluation,
      storage: {
        stateFileExists: fs.existsSync(paths.stateFilePath),
        journalFileExists: fs.existsSync(paths.journalFilePath),
      },
    });
  });

  // 2. Authenticated Live Tick Ingestion API (Collector & Admin only, always requires Bearer token)
  app.post(
    '/api/ingest/ticks',
    requireRoles(['COLLECTOR', 'ADMIN'], true),
    async (req, res) => {
      try {
        const ack = await orchestrator.ingestTickBatch(req.body);
        res.status(200).json(ack);
      } catch (err) {
        res.status(400).json({
          error: 'INGEST_ERROR',
          messageVi:
            err instanceof Error
              ? err.message
              : 'Lỗi không xác định khi ghi nhận lô báo giá.',
        });
      }
    }
  );

  app.get(
    '/api/ingest/status',
    requireRoles(['COLLECTOR', 'VIEWER', 'ADMIN']),
    (_req, res) => {
      const state = orchestrator.getState();
      res.json({
        status: 'ok',
        tickIngestionState: state.tickIngestionState,
        dataSourceTelemetry: state.dataSourceTelemetry,
        lastScheduleEvaluation: state.lastScheduleEvaluation,
      });
    }
  );

  // 3. Full application state & dataset metadata (Viewer & Admin only)
  app.get(
    '/api/state',
    requireRoles(['VIEWER', 'ADMIN']),
    async (req, res) => {
      const delayMs = Math.min(3000, Math.max(0, Number(req.query.delayMs || 0)));
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const resolved = resolveRequestRole(req);
      // On USER_HOST (zupirus.com), effective role for UI rendering is capped at VIEWER
      const effectiveRole =
        resolved.hostSurface === 'USER_HOST' ? 'VIEWER' : resolved.role || 'VIEWER';
      res.json({
        state: orchestrator.getState(),
        datasetMetadata: orchestrator.getDatasetMetadata(),
        storagePaths: orchestrator.getStoragePaths(),
        currentRole: effectiveRole,
        hostSurface: resolved.hostSurface,
        agentActivity: orchestrator.getAgentActivitySnapshot(),
      });
    }
  );

  // 3b. Dedicated Agent Activity Snapshot & Event Inspection API
  app.get(
    '/api/agent-activity',
    requireRoles(['VIEWER', 'ADMIN']),
    (_req, res) => {
      res.json(orchestrator.getAgentActivitySnapshot());
    }
  );

  app.get(
    '/api/agent-activity/events/:entryId',
    requireRoles(['VIEWER', 'ADMIN']),
    (req, res) => {
      const detail = orchestrator.getTimelineEventInspection(req.params.entryId);
      if (!detail) {
        res.status(404).json({
          error: 'NOT_FOUND',
          messageVi: `Không tìm thấy sự kiện nhật ký ${req.params.entryId}.`,
        });
        return;
      }
      res.json(detail);
    }
  );

  // 4. Cost & Latency Stress Comparison (Post-Hoc 2x vs Full Re-Simulation 2x + Latency)
  app.get(
    '/api/cost-analysis',
    requireRoles(['VIEWER', 'ADMIN']),
    (_req, res) => {
      res.json(orchestrator.getCostStressComparison());
    }
  );

  app.post(
    '/api/control/cost-replay',
    requireRoles(['ADMIN']),
    (req, res) => {
      const options: Partial<ExecutionCostLatencyOptions> = {
        costMultiplier: Number(req.body?.costMultiplier ?? 2),
        entryLatencyMs: Number(req.body?.entryLatencyMs ?? 250),
        exitLatencyMs: Number(req.body?.exitLatencyMs ?? 250),
        extraSlippagePts: Number(req.body?.extraSlippagePts ?? 4),
      };
      res.json(orchestrator.getCostStressComparison(options));
    }
  );

  // 5. Purposeful Learning Branch Fixtures Proof
  app.get(
    '/api/learning-fixtures',
    requireRoles(['VIEWER', 'ADMIN']),
    (_req, res) => {
      res.json(orchestrator.getLearningBranchFixturesReport());
    }
  );

  // 6. Broker Session 15/15 Schedule Endpoints
  app.get(
    '/api/schedule',
    requireRoles(['VIEWER', 'ADMIN']),
    (_req, res) => {
      const state = orchestrator.getState();
      res.json({
        brokerSchedule: state.brokerSchedule,
        lastScheduleEvaluation: state.lastScheduleEvaluation,
      });
    }
  );

  app.post(
    '/api/control/schedule',
    requireRoles(['ADMIN']),
    (req, res) => {
      const updated = orchestrator.updateBrokerSchedule(req.body || {});
      res.json({
        updated: true,
        brokerSchedule: updated,
        lastScheduleEvaluation: orchestrator.getState().lastScheduleEvaluation,
      });
    }
  );

  // 7. Traceability: Position -> Candle, Regime, Coordinator, Risk, Deals, Reconciliation
  app.get(
    '/api/trace/position/:positionId',
    requireRoles(['VIEWER', 'ADMIN']),
    (req, res) => {
      const trace = orchestrator.getPositionFullTrace(req.params.positionId);
      if (!trace) {
        res.status(404).json({
          error: 'NOT_FOUND',
          messageVi: `Không tìm thấy vị thế với mã ${req.params.positionId}.`,
        });
        return;
      }
      res.json(trace);
    }
  );

  // 8. Traceability: Learning Run -> Reconciled Positions, Shadow Outcomes, Exclusions, Policy
  app.get(
    '/api/research/walk-forward/:runId',
    requireRoles(['ADMIN'], true),
    async (req, res, next) => {
      const run = orchestrator.getState().learningRuns.find((item) => item.runId === req.params.runId);
      if (!run) {
        res.status(404).json({ error: 'LEARNING_RUN_NOT_FOUND' });
        return;
      }
      try {
        const { reviewWalkForwardRun } = await import('../research/walkForwardReview.ts');
        res.set('Cache-Control', 'no-store').json(await reviewWalkForwardRun(run, orchestrator.getState()));
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/api/trace/learning/:runId',
    requireRoles(['VIEWER', 'ADMIN']),
    (req, res) => {
      const trace = orchestrator.getLearningRunFullTrace(req.params.runId);
      if (!trace) {
        res.status(404).json({
          error: 'NOT_FOUND',
          messageVi: `Không tìm thấy kỳ học với mã ${req.params.runId}.`,
        });
        return;
      }
      res.json(trace);
    }
  );

  // 9. Traceability: Cycle ID lookup
  app.get(
    '/api/trace/cycle/:cycleId',
    requireRoles(['VIEWER', 'ADMIN']),
    (req, res) => {
      const state = orchestrator.getState();
      const cycleTrace = state.cycleTraces.find(
        (c) => c.cycleId === req.params.cycleId
      );
      if (!cycleTrace) {
        res.status(404).json({
          error: 'NOT_FOUND',
          messageVi: `Không tìm thấy chu kỳ với mã ${req.params.cycleId}.`,
        });
        return;
      }
      res.json(cycleTrace);
    }
  );

  // 10. Simulation Controls (ADMIN only)
  app.post(
    '/api/control/step',
    requireRoles(['ADMIN']),
    requireReplay,
    (_req, res) => {
      const trace = orchestrator.stepNextReplayCandle();
      res.json({
        stepped: Boolean(trace),
        trace,
        state: orchestrator.getState(),
      });
    }
  );

  app.post(
    '/api/control/toggle-loop',
    requireRoles(['ADMIN']),
    requireReplay,
    (_req, res) => {
      const state = orchestrator.getState();
      if (state.isLoopRunning) {
        orchestrator.stopAutoLoop();
      } else {
        orchestrator.startAutoLoop();
      }
      res.json({
        isLoopRunning: orchestrator.getState().isLoopRunning,
        state: orchestrator.getState(),
      });
    }
  );

  app.post(
    '/api/control/reset',
    requireRoles(['ADMIN']),
    requireReplay,
    (_req, res) => {
      const state = orchestrator.resetSimulation(true);
      res.json({
        reset: true,
        state,
      });
    }
  );
}
