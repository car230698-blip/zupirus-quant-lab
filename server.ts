import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { QuantLabOrchestrator } from './src/quant/orchestrator.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerInstance {
  app: express.Express;
  orchestrator: QuantLabOrchestrator;
}

export async function createQuantServer(customOptions?: {
  dataDir?: string;
  replayFilePath?: string;
  ticksFilePath?: string;
  replayIntervalMs?: number;
  autoStart?: boolean;
  attachFrontend?: boolean;
}): Promise<ServerInstance> {
  const app = express();
  app.use(express.json());

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

  const orchestrator = new QuantLabOrchestrator({
    dataDir,
    replayFilePath,
    ticksFilePath: customOptions?.ticksFilePath ?? process.env.TICKS_FILE,
    replayIntervalMs,
    autoStart,
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
      storage: {
        stateFileExists: fs.existsSync(paths.stateFilePath),
        journalFileExists: fs.existsSync(paths.journalFilePath),
      },
    });
  });

  // 2. Full application state & dataset metadata
  app.get('/api/state', (_req, res) => {
    res.json({
      state: orchestrator.getState(),
      datasetMetadata: orchestrator.getDatasetMetadata(),
      storagePaths: orchestrator.getStoragePaths(),
    });
  });

  // 3. Traceability: Position -> Candle, Regime, Coordinator, Risk, Deals, Reconciliation
  app.get('/api/trace/position/:positionId', (req, res) => {
    const trace = orchestrator.getPositionFullTrace(req.params.positionId);
    if (!trace) {
      res.status(404).json({
        error: 'NOT_FOUND',
        messageVi: `Không tìm thấy vị thế với mã ${req.params.positionId}.`,
      });
      return;
    }
    res.json(trace);
  });

  // 4. Traceability: Learning Run -> Reconciled Positions, Shadow Outcomes, Exclusions, Policy
  app.get('/api/trace/learning/:runId', (req, res) => {
    const trace = orchestrator.getLearningRunFullTrace(req.params.runId);
    if (!trace) {
      res.status(404).json({
        error: 'NOT_FOUND',
        messageVi: `Không tìm thấy kỳ học với mã ${req.params.runId}.`,
      });
      return;
    }
    res.json(trace);
  });

  // 5. Traceability: Cycle ID lookup
  app.get('/api/trace/cycle/:cycleId', (req, res) => {
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
  });

  // 6. Optional Simulation Controls (while automatic loop runs by default without needing clicks)
  app.post('/api/control/step', (_req, res) => {
    const trace = orchestrator.stepNextReplayCandle();
    res.json({
      stepped: Boolean(trace),
      trace,
      state: orchestrator.getState(),
    });
  });

  app.post('/api/control/toggle-loop', (_req, res) => {
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
  });

  app.post('/api/control/reset', (_req, res) => {
    const state = orchestrator.resetSimulation(true);
    res.json({
      reset: true,
      state,
    });
  });

  // 7. Attach Frontend (Static dist in production if available, else Vite middleware)
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
