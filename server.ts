import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { QuantLabOrchestrator } from './src/quant/orchestrator.ts';
import { BrokerSessionScheduleConfig } from './src/quant/marketSchedule.ts';
import { createAuthMiddleware } from './src/server/authMiddleware.ts';
import { registerQuantApiRoutes } from './src/server/apiRoutes.ts';

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
  liveTicks?: boolean;
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

  const adminToken = customOptions?.adminToken || process.env.ADMIN_AUTH_TOKEN;
  const viewerToken = customOptions?.viewerToken || process.env.VIEWER_AUTH_TOKEN;
  const collectorToken = customOptions?.collectorToken || process.env.COLLECTOR_AUTH_TOKEN;

  const hasAnyTokenConfigured = Boolean(adminToken || viewerToken || collectorToken);
  const strictAuth =
    customOptions?.strictAuth ??
    (process.env.ENFORCE_STRICT_AUTH !== undefined
      ? process.env.ENFORCE_STRICT_AUTH !== 'false'
      : hasAnyTokenConfigured);

  const auth = createAuthMiddleware({
    strictAuth,
    adminToken,
    viewerToken,
    collectorToken,
  });

  const liveTicks =
    customOptions?.liveTicks ?? process.env.QUANT_DATA_SOURCE === 'MT5_DEMO_LIVE';

  const orchestrator = new QuantLabOrchestrator({
    dataDir,
    replayFilePath,
    ticksFilePath: customOptions?.ticksFilePath ?? process.env.TICKS_FILE,
    replayIntervalMs,
    autoStart,
    liveTicks,
    brokerSchedule: customOptions?.brokerSchedule,
  });

  registerQuantApiRoutes({
    app,
    orchestrator,
    auth,
    liveTicks,
  });

  if (process.env.ENABLE_COPY_DEMO_PILOT === 'true') {
    const { registerDemoCopyRoutes } = await import('./src/server/demoCopyRoutes.ts');
    registerDemoCopyRoutes(app, dataDir, auth.requireRoles(['ADMIN'], true));
  }

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
