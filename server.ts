import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { QuantLabOrchestrator } from './src/quant/orchestrator.ts';
import { UserRole } from './src/quant/types.ts';
import { ExecutionCostLatencyOptions } from './src/quant/simBroker.ts';
import { BrokerSessionScheduleConfig } from './src/quant/marketSchedule.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerInstance {
  app: express.Express;
  orchestrator: QuantLabOrchestrator;
}

export interface QuantServerOptions {
  dataDir?: string;
  replayFilePath?: string;
  ticksFilePath?: string;
  replayIntervalMs?: number;
  autoStart?: boolean;
  attachFrontend?: boolean;
  strictAuth?: boolean;
  adminToken?: string;
  viewerToken?: string;
  collectorToken?: string;
  brokerSchedule?: BrokerSessionScheduleConfig;
}

export async function createQuantServer(
  customOptions?: QuantServerOptions
): Promise<ServerInstance> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const dataDir =
    customOptions?.dataDir ||
    process.env.DATA_DIR ||
    path.join(__dirname, 'data', 'runtime');
  const replayFilePath =
    customOptions?.replayFilePath ||
    process.env.REPLAY_FILE ||
    path.join(__dirname, 'data', 'xauusd_m15_replay.json');
  const replayIntervalMs =
    customOptions?.replayIntervalMs ??
    Number(process.env.REPLAY_INTERVAL_MS || 800);
  const autoStart =
    customOptions?.autoStart ??
    process.env.AUTO_START_LOOP !== 'false';

  const adminToken =
    customOptions?.adminToken ||
    process.env.ADMIN_AUTH_TOKEN ||
    'zupirus-admin-demo-token';
  const viewerToken =
    customOptions?.viewerToken ||
    process.env.VIEWER_AUTH_TOKEN ||
    'zupirus-viewer-demo-token';
  const collectorToken =
    customOptions?.collectorToken ||
    process.env.COLLECTOR_AUTH_TOKEN ||
    'zupirus-collector-demo-token';
  const strictAuth =
    customOptions?.strictAuth ??
    process.env.ENFORCE_STRICT_AUTH === 'true';

  const orchestrator = new QuantLabOrchestrator({
    dataDir,
    replayFilePath,
    ticksFilePath: customOptions?.ticksFilePath ?? process.env.TICKS_FILE,
    replayIntervalMs,
    autoStart,
    brokerSchedule: customOptions?.brokerSchedule,
  });

  function resolveRequestRole(req: express.Request): {
    authenticated: boolean;
    role: UserRole | null;
    explicitAuthAttempt: boolean;
  } {
    const authHeader = req.headers.authorization;
    const roleHeader = req.headers['x-zupirus-role'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (token === adminToken) {
        return { authenticated: true, role: 'ADMIN', explicitAuthAttempt: true };
      }
      if (token === viewerToken) {
        return { authenticated: true, role: 'VIEWER', explicitAuthAttempt: true };
      }
      if (token === collectorToken) {
        return { authenticated: true, role: 'COLLECTOR', explicitAuthAttempt: true };
      }
      return { authenticated: false, role: null, explicitAuthAttempt: true };
    }

    if (typeof roleHeader === 'string' && roleHeader.trim().length > 0) {
      const normalized = roleHeader.trim().toUpperCase();
      if (
        normalized === 'ADMIN' ||
        normalized === 'VIEWER' ||
        normalized === 'COLLECTOR'
      ) {
        if (strictAuth) {
          return { authenticated: false, role: null, explicitAuthAttempt: true };
        }
        return {
          authenticated: true,
          role: normalized as UserRole,
          explicitAuthAttempt: true,
        };
      }
      return { authenticated: false, role: null, explicitAuthAttempt: true };
    }

    if (strictAuth) {
      return { authenticated: false, role: null, explicitAuthAttempt: false };
    }

    // Default local preview & test compatibility when no auth headers are sent
    return { authenticated: true, role: 'ADMIN', explicitAuthAttempt: false };
  }

  function requireRoles(
    allowedRoles: UserRole[],
    alwaysRequireExplicitToken = false
  ): express.RequestHandler {
    return (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (alwaysRequireExplicitToken) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({
            error: 'UNAUTHORIZED',
            messageVi:
              'Thiếu Bearer Token xác thực. Đầu cuối này bắt buộc xác thực token hợp lệ.',
          });
          return;
        }
      }

      const resolved = resolveRequestRole(req);
      if (!resolved.authenticated || !resolved.role) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          messageVi: 'Thông tin xác thực không hợp lệ hoặc bị từ chối.',
        });
        return;
      }

      if (!allowedRoles.includes(resolved.role)) {
        res.status(403).json({
          error: 'FORBIDDEN',
          role: resolved.role,
          allowedRoles,
          messageVi: `Vai trò ${resolved.role} không có quyền truy cập tài nguyên này (Yêu cầu: ${allowedRoles.join(', ')}).`,
        });
        return;
      }

      next();
    };
  }

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
      const delayMs = Math.min(
        3000,
        Math.max(0, Number(req.query.delayMs || 0))
      );
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const resolved = resolveRequestRole(req);
      res.json({
        state: orchestrator.getState(),
        datasetMetadata: orchestrator.getDatasetMetadata(),
        storagePaths: orchestrator.getStoragePaths(),
        currentRole: resolved.role || 'VIEWER',
      });
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
    (_req, res) => {
      const state = orchestrator.resetSimulation(true);
      res.json({
        reset: true,
        state,
      });
    }
  );

  // 11. Attach Frontend (Static dist in production if available, else Vite middleware)
  if (customOptions?.attachFrontend !== false) {
    const distPath = path.join(__dirname, 'dist');
    const useStaticDist =
      process.env.NODE_ENV === 'production' &&
      fs.existsSync(path.join(distPath, 'index.html'));

    if (useStaticDist) {
      app.use(express.static(distPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  return { app, orchestrator };
}

// Start server when executed directly
const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  createQuantServer().then(({ app }) => {
    app.listen(port, host, () => {
      console.log(
        `[ZUPIRUS Quant Lab] Server đang chạy tại http://${host}:${port} (Chế độ: SIMULATION_ONLY)`
      );
    });
  });
}
