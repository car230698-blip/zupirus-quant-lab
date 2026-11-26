import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface ReplayBar {
  ts?: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
}

function loadReplayBars(): ReplayBar[] {
  try {
    const p = path.resolve(process.cwd(), 'data/replay.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (Array.isArray(raw) && raw.length > 0) return raw;
  } catch {
    // Fallback synthetic bars
  }
  const bars: ReplayBar[] = [];
  let price = 2650;
  for (let i = 0; i < 900; i++) {
    price += Math.sin(i / 8) * 1.8 + (i % 7 === 0 ? 1.2 : -0.45);
    bars.push({ close: Math.round(price * 100) / 100 });
  }
  return bars;
}

function strategySignal(prices: number[], fastN = 5, slowN = 20): 'BUY' | 'SELL' | null {
  if (prices.length < slowN + 1) return null;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const fast = avg(prices.slice(-fastN));
  const slow = avg(prices.slice(-slowN));
  const prevFast = avg(prices.slice(-fastN - 1, -1));
  const prevSlow = avg(prices.slice(-slowN - 1, -1));
  if (prevFast <= prevSlow && fast > slow) return 'BUY';
  if (prevFast >= prevSlow && fast < slow) return 'SELL';
  return null;
}

function scorePrices(prices: number[], period: number): [number, number[]] {
  const SL = 6.0;
  const TP = 12.0;
  const returns: number[] = [];
  let pos: [number, number] | null = null;
  for (let t = 20; t < prices.length - 1; t++) {
    if (pos) {
      const [entry, dir] = pos;
      const pnl = (prices[t] - entry) * dir;
      if (pnl <= -SL || pnl >= TP) {
        returns.push(pnl - 0.37);
        pos = null;
      } else {
        continue;
      }
    }
    const side = strategySignal(prices.slice(0, t + 1), period, 20);
    if (side) {
      pos = [prices[t + 1], side === 'BUY' ? 1 : -1];
    }
  }
  if (pos) {
    const [entry, dir] = pos;
    returns.push((prices[prices.length - 1] - entry) * dir - 0.37);
  }
  const sum = returns.reduce((a, b) => a + b, 0);
  return [sum, returns];
}

function runWalkForward(prices: number[]) {
  const folds: Array<{
    train: [number, number];
    test: [number, number];
    period: number;
    oos_net_price_units: number;
    trades: number;
  }> = [];
  const allReturns: number[] = [];

  for (let start = 0; start <= prices.length - 180; start += 60) {
    const train = prices.slice(start, start + 120);
    const test = prices.slice(start + 120, start + 180);
    let bestPeriod = 3;
    let bestScore = -Infinity;
    for (const p of [3, 5, 8]) {
      const [s] = scorePrices(train, p);
      if (s > bestScore) {
        bestScore = s;
        bestPeriod = p;
      }
    }
    const [pnl, rets] = scorePrices(test, bestPeriod);
    allReturns.push(...rets);
    folds.push({
      train: [start, start + 119],
      test: [start + 120, start + 179],
      period: bestPeriod,
      oos_net_price_units: Number(pnl.toFixed(4)),
      trades: rets.length,
    });
  }

  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const v of allReturns) {
    equity += v;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  const totalNet = allReturns.reduce((a, b) => a + b, 0);

  return {
    data: 'SYNTHETIC_REPLAY_NOT_BROKER',
    method: 'rolling 120 train / 60 OOS, no overlapping test blocks',
    strategy: 'SMA crossover, slow=20, train-selected fast in [3,5,8], SL=6, TP=12, next-bar fill, close-only exits',
    cost_price_units: 0.37,
    folds,
    oos_net_price_units: Number(totalNet.toFixed(4)),
    max_drawdown_price_units: Number(dd.toFixed(4)),
    trades: allReturns.length,
    production_qualified: false,
  };
}

export function zupirusApiPlugin(): Plugin {
  const replayBars = loadReplayBars();
  const prices = replayBars.map((b) => b.close);
  const nowSec = () => Date.now() / 1000;

  let replayIdx = 42;
  let halted = false;
  let devSession: { email: string; role: string } | null = null;

  const accounts: Array<Record<string, any>> = [
    {
      id: 'acc_replay_01',
      user_id: 'usr_admin',
      email: 'admin@zupirus.local',
      login: '880192834',
      server: 'ZUPIRUS-SYNTHETIC',
      mode: 'REPLAY',
      enabled: 1,
      risk: 0.25,
      max_spread: 0.8,
      max_positions: 2,
      max_dd: 10,
      balance: 10245.8,
      equity: 10318.4,
      peak: 10340.0,
      seen: nowSec() - 2,
      positions: 1,
      cached_heartbeat: {
        login: '880192834',
        server: 'ZUPIRUS-SYNTHETIC',
        balance: 10245.8,
        equity: 10318.4,
        positions: 1,
        cached_at: nowSec() - 2,
      },
    },
    {
      id: 'acc_demo_02',
      user_id: 'usr_admin',
      email: 'admin@zupirus.local',
      login: '50918273',
      server: 'ICMarketsSC-Demo',
      mode: 'DEMO',
      enabled: 1,
      risk: 0.25,
      max_spread: 0.6,
      max_positions: 1,
      max_dd: 8,
      balance: 25000.0,
      equity: 25142.5,
      peak: 25190.0,
      seen: nowSec() - 4,
      positions: 1,
      cached_heartbeat: {
        login: '50918273',
        server: 'ICMarketsSC-Demo',
        balance: 25000.0,
        equity: 25142.5,
        positions: 1,
        cached_at: nowSec() - 4,
      },
    },
  ];

  const series: Array<Record<string, any>> = [];
  const baseTs = nowSec() - 36 * 60;
  for (let i = 0; i < 36; i++) {
    const t = baseTs + i * 60;
    const wave1 = Math.sin(i / 4) * 45 + i * 7.2;
    const wave2 = Math.cos(i / 5) * 60 + i * 4.1;
    series.push({
      id: i * 2 + 1,
      account_id: 'acc_replay_01',
      ts: t,
      balance: Number((10000 + i * 6.8).toFixed(2)),
      equity: Number((10000 + wave1).toFixed(2)),
    });
    series.push({
      id: i * 2 + 2,
      account_id: 'acc_demo_02',
      ts: t,
      balance: Number((25000 + (i > 18 ? 85 : 0)).toFixed(2)),
      equity: Number((25000 + wave2).toFixed(2)),
    });
  }

  const orders: Array<Record<string, any>> = [
    {
      id: 104,
      account_id: 'acc_demo_02',
      signal_id: 'sig_demo_9941a',
      source: 'DEMO',
      side: 'BUY',
      lot: 0.25,
      price: 2658.4,
      sl: 2652.4,
      tp: 2670.4,
      pnl: 142.5,
      state: 'filled',
      ticket: '7089124',
      deal: '8094112',
      reason: '',
      created: nowSec() - 420,
      updated: nowSec() - 418,
    },
    {
      id: 103,
      account_id: 'acc_replay_01',
      signal_id: 'sig_rep_8820b',
      source: 'REPLAY',
      side: 'BUY',
      lot: 0.15,
      price: 2654.15,
      sl: 2648.15,
      tp: 2666.15,
      pnl: 88.2,
      state: 'filled',
      ticket: 'SIM-103',
      deal: 'SIM-103',
      reason: '',
      created: nowSec() - 1250,
      updated: nowSec() - 1249,
    },
    {
      id: 102,
      account_id: 'acc_demo_02',
      signal_id: 'sig_demo_7712c',
      source: 'DEMO',
      side: 'SELL',
      lot: 0.1,
      price: 2661.8,
      sl: 2667.8,
      tp: 2649.8,
      pnl: -41.0,
      state: 'filled',
      ticket: '7088901',
      deal: '8093880',
      reason: '',
      created: nowSec() - 3600,
      updated: nowSec() - 3598,
    },
    {
      id: 101,
      account_id: 'acc_replay_01',
      signal_id: 'sig_rep_6610d',
      source: 'REPLAY',
      side: 'SELL',
      lot: 0.25,
      price: 2649.2,
      sl: 2655.2,
      tp: 2637.2,
      pnl: 194.8,
      state: 'filled',
      ticket: 'SIM-101',
      deal: 'SIM-101',
      reason: '',
      created: nowSec() - 5400,
      updated: nowSec() - 5399,
    },
  ];

  const initialReport = runWalkForward(prices);
  const jobs: Array<Record<string, any>> = [
    {
      id: 'wfo_cand_9a8f7e6d5c4b3a21',
      state: 'waiting_approval',
      decision: null,
      result: JSON.stringify({ report: initialReport }),
      error: null,
      created: nowSec() - 180,
    },
    {
      id: 'wfo_arch_1f2e3d4c5b6a7980',
      state: 'completed',
      decision: 1,
      result: JSON.stringify({
        report: initialReport,
        approved: true,
        disposition: 'approved_for_demo_review',
      }),
      error: null,
      created: nowSec() - 7200,
    },
  ];

  const news: Array<Record<string, any>> = [
    {
      id: 'news_cpi_01',
      title: 'US Core CPI (MoM) & Non-Farm Payrolls',
      currency: 'USD',
      impact: 'high',
      ts: nowSec() + 3600 * 4,
    },
    {
      id: 'news_fomc_02',
      title: 'FOMC Interest Rate Decision & Statement',
      currency: 'USD',
      impact: 'high',
      ts: nowSec() + 3600 * 28,
    },
  ];

  const mockAdminUsers: Array<Record<string, any>> = [
    { id: 'usr_admin', email: 'admin@zupirus.local', role: 'admin', active: true, created: '2026-03-01T00:00:00Z', last_login: '2026-11-15T12:00:00Z' },
    { id: 'usr_customer_demo', email: 'trader@client.org', role: 'customer', active: true, created: '2026-03-05T08:00:00Z', last_login: null }
  ];

  const mockGeminiKeys: Array<Record<string, any>> = [
    { id: 'gem_1', name: 'Primary Gemini Flash #1', key_masked: 'AQ.Ab8...XVA', is_active: true, requests_count: 42, last_used: '2026-11-15T14:00:00Z', created: '2026-11-15T00:00:00Z' },
    { id: 'gem_2', name: 'Gemini Flash Failover #2', key_masked: 'AQ.Ab8...s_A', is_active: true, requests_count: 18, last_used: '2026-11-15T13:45:00Z', created: '2026-11-15T00:00:00Z' },
    { id: 'gem_3', name: 'Gemini Reserve #3', key_masked: 'AQ.Ab8...rViIw', is_active: true, requests_count: 5, last_used: '2026-11-15T11:20:00Z', created: '2026-11-15T00:00:00Z' },
    { id: 'gem_4', name: 'Gemini Reserve #4', key_masked: 'AQ.Ab8...1yFfA', is_active: true, requests_count: 2, last_used: '2026-11-15T09:10:00Z', created: '2026-11-15T00:00:00Z' },
    { id: 'gem_5', name: 'Gemini Reserve #5', key_masked: 'AQ.Ab8...jihSAA', is_active: true, requests_count: 0, last_used: null, created: '2026-11-15T00:00:00Z' }
  ];

  const mockHindsightMemories: Array<Record<string, any>> = [
    { id: 'mem_sem_risk', category: 'semantic', content: 'Chiến lược XAUUSD M15 yêu cầu tỷ lệ R:R tối thiểu 1:2.0 (SL=6.0, TP=12.0) với điều kiện lọc biến động ATR và chặn vào lệnh ±15 phút quanh tin tức kinh tế quan trọng.', metadata: { domain: 'risk_management' }, created: '2026-11-15T08:00:00Z' },
    { id: 'mem_sem_wfo', category: 'semantic', content: 'Quy trình Walk-Forward Optimization (WFO) yêu cầu kiểm định Rolling Folds với Out-of-Sample (OOS) tối thiểu 3 fold, Sharpe > 1.0 và max drawdown dưới 5%.', metadata: { domain: 'wfo_standard' }, created: '2026-11-15T08:00:00Z' },
    { id: 'mem_ref_cand', category: 'reflective', content: 'Chiến lược Mean Reversion có hiệu quả vượt trội trong các phiên Tokyo và đầu London, trong khi Breakout hiệu quả cao nhất vào phiên New York sau 13:30 UTC.', metadata: { source: 'post_mortem_analysis' }, created: '2026-11-15T09:30:00Z' }
  ];

  const auditLogs: Array<Record<string, any>> = [
    {
      id: 4,
      ts: nowSec() - 180,
      actor: 'usr_admin',
      event: 'research_requested',
      detail: JSON.stringify({ job: 'wfo_cand_9a8f7e6d5c4b3a21', method: 'WFO 120/60' }),
    },
    {
      id: 3,
      ts: nowSec() - 418,
      actor: 'acc_demo_02',
      event: 'execution_receipt',
      detail: JSON.stringify({ dispatch: 104, state: 'filled', ticket: '7089124', deal: '8094112' }),
    },
    {
      id: 2,
      ts: nowSec() - 420,
      actor: 'acc_demo_02',
      event: 'send_authorized',
      detail: JSON.stringify({ dispatch: 104, lock: 'lock:dispatch:acc_demo_02:sig_demo_9941a' }),
    },
    {
      id: 1,
      ts: nowSec() - 1800,
      actor: 'usr_admin',
      event: 'account_created',
      detail: JSON.stringify({ id: 'acc_demo_02', mode: 'DEMO', server: 'ICMarketsSC-Demo' }),
    },
  ];

  const traces: Array<Record<string, any>> = [
    {
      id: crypto.randomUUID(),
      name: 'langgraph:walk_forward',
      run_type: 'chain',
      timestamp: nowSec() - 180,
      latency_ms: 142.8,
      inputs: { data_len: prices.length, train_window: 120, oos_window: 60 },
      outputs: {
        oos_net_price_units: initialReport.oos_net_price_units,
        max_drawdown_price_units: initialReport.max_drawdown_price_units,
        folds: initialReport.folds.length,
      },
      error: null,
      metadata: { framework: 'langgraph', node: 'walk_forward' },
      tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      langsmith_synced: Boolean(process.env.LANGSMITH_API_KEY),
    },
    {
      id: crypto.randomUUID(),
      name: 'ai_completion:gpt-4.1-mini',
      run_type: 'llm',
      timestamp: nowSec() - 95,
      latency_ms: 218.4,
      inputs: { prompt: 'Kiểm tra trạng thái danh mục và khóa phân tán Redis' },
      outputs: { response: 'Danh mục có 2 tài khoản hoạt động, khóa phân tán bảo vệ chống gửi trùng.' },
      error: null,
      metadata: { model: 'gpt-4.1-mini', tool_calls_count: 1 },
      tokens: { prompt_tokens: 68, completion_tokens: 42, total_tokens: 110 },
      langsmith_synced: Boolean(process.env.LANGSMITH_API_KEY),
    },
  ];

  function recordTrace(
    name: string,
    runType: string,
    inputs: Record<string, any>,
    outputs: Record<string, any>,
    latencyMs = 95.2,
    tokens = { prompt_tokens: 48, completion_tokens: 36, total_tokens: 84 }
  ) {
    traces.push({
      id: crypto.randomUUID(),
      name,
      run_type: runType,
      timestamp: nowSec(),
      latency_ms: Number(latencyMs.toFixed(2)),
      inputs,
      outputs,
      error: null,
      metadata: { project: process.env.LANGSMITH_PROJECT || 'zupirus-quant-lab' },
      tokens,
      langsmith_synced: Boolean(process.env.LANGSMITH_API_KEY),
    });
    if (traces.length > 100) traces.shift();
  }

  function advanceReplaySimulation() {
    if (halted) return;
    replayIdx = (replayIdx + 1) % prices.length;
    const price = prices[replayIdx];
    const ts = nowSec();
    for (const acc of accounts) {
      acc.seen = ts;
      if (acc.enabled) {
        const delta = Math.sin(replayIdx / 3 + (acc.mode === 'DEMO' ? 1 : 0)) * 8.5;
        acc.equity = Number((acc.balance + delta).toFixed(2));
        acc.peak = Math.max(acc.peak, acc.equity);
        acc.cached_heartbeat = {
          login: acc.login,
          server: acc.server,
          balance: acc.balance,
          equity: acc.equity,
          positions: acc.positions,
          cached_at: ts,
        };
        series.push({
          id: series.length + 1,
          account_id: acc.id,
          ts,
          balance: acc.balance,
          equity: acc.equity,
        });
      }
    }
    if (series.length > 300) series.splice(0, series.length - 300);
    return price;
  }

  function readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  }

  function sendJson(res: ServerResponse, status: number, payload: any) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  const apiMiddleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, 'http://localhost:3000');
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (pathname === '/healthz' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        real_trading: false,
        database: 'postgresql',
        database_status: 'up',
        redis_stream: true,
        langsmith_tracing: true,
      });
    }

    if ((pathname === '/readyz' || pathname === '/api/health') && method === 'GET') {
      return sendJson(res, 200, {
        status: 'ready',
        database: {
          configured_as_postgres: true,
          engine: 'postgresql',
          connected: true,
          details: { status: 'up', engine: 'postgresql', is_postgres: true },
        },
        timescaledb: {
          timescaledb_available: true,
          extension_version: '2.17.2',
          hypertables: [
            { schema: 'public', table: 'candles', num_dimensions: 1, num_chunks: 6, compression_enabled: true },
            { schema: 'public', table: 'quotes', num_dimensions: 1, num_chunks: 12, compression_enabled: true },
            { schema: 'public', table: 'snapshots', num_dimensions: 1, num_chunks: 8, compression_enabled: false },
          ],
        },
        redis: {
          connected: true,
          error: null,
        },
        execution_worker: {
          heartbeat_active: true,
        },
        langsmith: {
          enabled: true,
        },
      });
    }

    if (!pathname.startsWith('/api/')) {
      return next();
    }

    // Auth & Session endpoints
    if (pathname === '/api/me' && method === 'GET') {
      if (!devSession) {
        return sendJson(res, 401, { detail: 'Authentication required' });
      }
      return sendJson(res, 200, devSession);
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJsonBody(req);
      const email = String(body.email || 'user@example.com');
      const role = email.includes('admin') ? 'admin' : 'customer';
      devSession = { email, role };
      return sendJson(res, 200, devSession);
    }
    if (pathname === '/api/register' && method === 'POST') {
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && method === 'POST') {
      devSession = null;
      return sendJson(res, 200, { ok: true });
    }
    if (
      (pathname === '/api/auth/forgot-password' ||
        pathname === '/api/auth/reset-password' ||
        pathname === '/api/auth/change-password') &&
      method === 'POST'
    ) {
      return sendJson(res, 200, { ok: true, message: 'OK' });
    }

    // Dashboard
    if (pathname === '/api/dashboard' && method === 'GET') {
      const latestPrice = advanceReplaySimulation() || prices[replayIdx] || 2655.2;
      const now = nowSec();
      return sendJson(res, 200, {
        accounts,
        orders,
        series,
        health: {
          execution_heartbeat: String(now - 1),
          research_heartbeat: String(now - 2),
          replay_price: String(latestPrice),
          halted: halted ? '1' : '0',
        },
        real_trading: false,
      });
    }

    // Admin Orders
    if (pathname === '/api/admin/orders' && method === 'GET') {
      const accountId = parsedUrl.searchParams.get('account_id');
      const state = parsedUrl.searchParams.get('state');
      const search = (parsedUrl.searchParams.get('search') || '').toLowerCase().trim();
      const limit = Number(parsedUrl.searchParams.get('limit') || 50);
      const offset = Number(parsedUrl.searchParams.get('offset') || 0);

      let matched = orders.slice();
      if (accountId && accountId !== 'all') {
        matched = matched.filter((o) => o.account_id === accountId);
      }
      if (state && state !== 'all') {
        matched = matched.filter((o) => o.state === state);
      }
      if (search) {
        matched = matched.filter(
          (o) =>
            String(o.signal_id).toLowerCase().includes(search) ||
            String(o.ticket || '').toLowerCase().includes(search) ||
            String(o.deal || '').toLowerCase().includes(search) ||
            String(o.reason || '').toLowerCase().includes(search)
        );
      }
      return sendJson(res, 200, {
        orders: matched.slice(offset, offset + limit),
        total: matched.length,
      });
    }

    // Create Replay Account
    if (pathname === '/api/replay' && method === 'POST') {
      const id = `acc_rep_${crypto.randomBytes(4).toString('hex')}`;
      const login = String(Math.floor(100000000 + Math.random() * 899999999));
      const ts = nowSec();
      const newAcc = {
        id,
        user_id: 'usr_admin',
        email: 'admin@zupirus.local',
        login,
        server: 'ZUPIRUS-SYNTHETIC',
        mode: 'REPLAY',
        enabled: 1,
        risk: 0.25,
        max_spread: 0.8,
        max_positions: 1,
        max_dd: 10,
        balance: 10000,
        equity: 10000,
        peak: 10000,
        seen: ts,
        positions: 0,
        cached_heartbeat: {
          login,
          server: 'ZUPIRUS-SYNTHETIC',
          balance: 10000,
          equity: 10000,
          positions: 0,
          cached_at: ts,
        },
      };
      accounts.unshift(newAcc);
      series.push(
        { id: series.length + 1, account_id: id, ts: ts - 60, balance: 10000, equity: 10000 },
        { id: series.length + 2, account_id: id, ts, balance: 10000, equity: 10018.5 }
      );
      orders.unshift({
        id: orders.length + 101,
        account_id: id,
        signal_id: `sig_rep_${crypto.randomBytes(3).toString('hex')}`,
        source: 'REPLAY',
        side: 'BUY',
        price: prices[replayIdx] || 2655.0,
        sl: (prices[replayIdx] || 2655.0) - 6,
        tp: (prices[replayIdx] || 2655.0) + 12,
        state: 'filled',
        ticket: `SIM-${orders.length + 101}`,
        deal: `SIM-${orders.length + 101}`,
        reason: '',
        created: ts,
        updated: ts,
      });
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts,
        actor: 'usr_admin',
        event: 'account_created',
        detail: JSON.stringify({ id, mode: 'REPLAY', login }),
      });
      return sendJson(res, 200, { id });
    }

    // Create DEMO Account
    if (pathname === '/api/accounts' && method === 'POST') {
      const body = await readJsonBody(req);
      const login = String(body.login || '').trim();
      const server = String(body.server || '').trim();
      const mode = body.mode === 'REPLAY' ? 'REPLAY' : 'DEMO';
      if (!/^\d+$/.test(login) || !server) {
        return sendJson(res, 422, { detail: 'Login phải là chữ số và tên server hợp lệ.' });
      }
      if (accounts.some((a) => a.login === login && a.server === server)) {
        return sendJson(res, 409, { detail: 'Account/server already linked' });
      }
      const id = `acc_${mode.toLowerCase()}_${crypto.randomBytes(4).toString('hex')}`;
      const ts = nowSec();
      const newAcc = {
        id,
        user_id: 'usr_admin',
        email: 'admin@zupirus.local',
        login,
        server,
        mode,
        enabled: 0,
        risk: 0.25,
        max_spread: 0.8,
        max_positions: 1,
        max_dd: 10,
        balance: 10000,
        equity: 10000,
        peak: 10000,
        seen: ts,
        positions: 0,
      };
      accounts.unshift(newAcc);
      series.push(
        { id: series.length + 1, account_id: id, ts: ts - 60, balance: 10000, equity: 10000 },
        { id: series.length + 2, account_id: id, ts, balance: 10000, equity: 10000 }
      );
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts,
        actor: 'usr_admin',
        event: 'account_created',
        detail: JSON.stringify({ id, mode, login, server }),
      });
      return sendJson(res, 200, { id });
    }

    // Account Risk Update
    const riskMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/risk$/);
    if (riskMatch && method === 'PUT') {
      const aid = riskMatch[1];
      const acc = accounts.find((a) => a.id === aid);
      if (!acc) return sendJson(res, 404, { detail: 'Account not found' });
      const body = await readJsonBody(req);
      acc.enabled = body.enabled ? 1 : 0;
      if (typeof body.risk === 'number') acc.risk = body.risk;
      if (typeof body.max_spread === 'number') acc.max_spread = body.max_spread;
      if (typeof body.max_positions === 'number') acc.max_positions = body.max_positions;
      if (typeof body.max_dd === 'number') acc.max_dd = body.max_dd;
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'risk_changed',
        detail: JSON.stringify({ account: aid, enabled: Boolean(acc.enabled), risk: acc.risk, max_dd: acc.max_dd }),
      });
      return sendJson(res, 200, { ok: true });
    }

    // Account Pairing Code
    const pairMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/pair$/);
    if (pairMatch && method === 'POST') {
      const aid = pairMatch[1];
      const acc = accounts.find((a) => a.id === aid);
      if (!acc) return sendJson(res, 404, { detail: 'Account not found' });
      if (acc.mode !== 'DEMO') return sendJson(res, 400, { detail: 'Only DEMO accounts pair with MT5' });
      const code = `ZUP-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'pair_code_issued',
        detail: JSON.stringify({ account: aid, expires_in: 300 }),
      });
      return sendJson(res, 200, { code, expires_in: 300 });
    }

    // Account Revoke
    const revokeMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/revoke$/);
    if (revokeMatch && method === 'POST') {
      const aid = revokeMatch[1];
      const acc = accounts.find((a) => a.id === aid);
      if (!acc) return sendJson(res, 404, { detail: 'Account not found' });
      acc.enabled = 0;
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'device_revoked',
        detail: JSON.stringify({ account: aid }),
      });
      return sendJson(res, 200, { ok: true });
    }

    // Admin Monitor
    if (pathname === '/api/admin/monitor' && method === 'GET') {
      return sendJson(res, 200, {
        accounts,
        audit: auditLogs.slice(0, 100),
        jobs: jobs.slice(0, 30),
        news: news.slice(0, 50),
        halted,
      });
    }

    // Admin Tracing
    if (pathname === '/api/admin/tracing' && method === 'GET') {
      return sendJson(res, 200, {
        langsmith_configured: true,
        langsmith_connected: Boolean(process.env.LANGSMITH_API_KEY),
        project: process.env.LANGSMITH_PROJECT || 'zupirus-quant-lab',
        endpoint: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
        total_traces_recorded: traces.length,
        recent_traces: traces.slice(-20).reverse(),
      });
    }

    // Start Walk-Forward Research Job
    if (pathname === '/api/admin/research' && method === 'POST') {
      const t0 = performance.now();
      const jid = `wfo_${crypto.randomBytes(8).toString('hex')}`;
      const report = runWalkForward(prices);
      const latency = performance.now() - t0;
      const newJob = {
        id: jid,
        state: 'waiting_approval',
        decision: null,
        result: JSON.stringify({ report }),
        error: null,
        created: nowSec(),
      };
      jobs.unshift(newJob);
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'research_requested',
        detail: JSON.stringify({ job: jid, oos_net: report.oos_net_price_units }),
      });
      recordTrace(
        'langgraph:walk_forward',
        'chain',
        { job_id: jid, bars: prices.length, split: '120 train / 60 OOS' },
        { state: 'waiting_approval', oos_net_price_units: report.oos_net_price_units, folds: report.folds.length },
        latency
      );
      return sendJson(res, 200, { id: jid, job: newJob });
    }

    // Admin Research Approval / Rejection Decision
    const decisionMatch = pathname.match(/^\/api\/admin\/research\/([^/]+)\/decision$/);
    if (decisionMatch && method === 'POST') {
      const jid = decisionMatch[1];
      const job = jobs.find((j) => j.id === jid);
      if (!job || job.state !== 'waiting_approval') {
        return sendJson(res, 409, { detail: 'Job not waiting for approval' });
      }
      const body = await readJsonBody(req);
      const approved = Boolean(body.approved);
      job.state = 'completed';
      job.decision = approved ? 1 : 0;
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(job.result || '{}');
      } catch {
        parsed = {};
      }
      parsed.approved = approved;
      parsed.disposition = approved ? 'approved_for_demo_review' : 'rejected';
      job.result = JSON.stringify(parsed);

      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'research_decision',
        detail: JSON.stringify({ job: jid, approved, disposition: parsed.disposition }),
      });
      recordTrace(
        'langgraph:admin_review',
        'chain',
        { job_id: jid, approved },
        { disposition: parsed.disposition },
        42.5
      );
      return sendJson(res, 200, { ok: true, disposition: parsed.disposition });
    }

    // Admin System Safety Switch
    if (pathname === '/api/admin/safety' && method === 'POST') {
      const body = await readJsonBody(req);
      halted = Boolean(body.halted);
      if (halted) {
        for (const a of accounts) a.enabled = 0;
        for (const o of orders) {
          if (o.state === 'queued') o.state = 'cancelled';
        }
      }
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'system_halt',
        detail: JSON.stringify({ halted }),
      });
      return sendJson(res, 200, {
        halted,
        note: 'Existing broker positions retain SL/TP; outstanding intents remain reconcilable.',
      });
    }

    // Admin Economic Calendar News - Add
    if (pathname === '/api/admin/news' && method === 'POST') {
      const body = await readJsonBody(req);
      const item = {
        id: `news_${crypto.randomBytes(4).toString('hex')}`,
        title: String(body.title || 'US High Impact Event'),
        currency: body.currency || 'USD',
        impact: body.impact || 'high',
        ts: Number(body.ts || nowSec() + 3600),
      };
      news.unshift(item);
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'calendar_added',
        detail: JSON.stringify(item),
      });
      return sendJson(res, 200, { ok: true });
    }

    // Admin Economic Calendar News - Update
    const newsUpdateMatch = pathname.match(/^\/api\/admin\/news\/([^/]+)$/);
    if (newsUpdateMatch && method === 'PUT') {
      const nid = newsUpdateMatch[1];
      const item = news.find((n) => n.id === nid);
      if (!item) return sendJson(res, 404, { detail: 'Event not found' });
      const body = await readJsonBody(req);
      if (body.title) item.title = String(body.title);
      if (body.currency) item.currency = body.currency;
      if (body.impact) item.impact = body.impact;
      if (body.ts) item.ts = Number(body.ts);
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'calendar_updated',
        detail: JSON.stringify(item),
      });
      return sendJson(res, 200, { ok: true });
    }

    // Admin Economic Calendar News - Delete
    if (newsUpdateMatch && method === 'DELETE') {
      const nid = newsUpdateMatch[1];
      const idx = news.findIndex((n) => n.id === nid);
      if (idx === -1) return sendJson(res, 404, { detail: 'Event not found' });
      const removed = news.splice(idx, 1)[0];
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: nowSec(),
        actor: 'usr_admin',
        event: 'calendar_deleted',
        detail: JSON.stringify(removed),
      });
      return sendJson(res, 200, { ok: true });
    }

    // Auto-sync Economic Calendar News
    if (pathname === '/api/admin/news/sync' && method === 'POST') {
      const now = nowSec();
      const synced = [
        { id: `news_auto_${now}_1`, title: 'US Initial Jobless Claims & Core PPI', currency: 'USD', impact: 'high', ts: now + 3600 * 6 },
        { id: `news_auto_${now}_2`, title: 'US Retail Sales & Consumer Sentiment', currency: 'USD', impact: 'high', ts: now + 3600 * 30 },
      ];
      news.push(...synced);
      auditLogs.unshift({
        id: auditLogs.length + 1,
        ts: now,
        actor: 'usr_admin',
        event: 'calendar_auto_synced',
        detail: JSON.stringify({ synced_count: synced.length }),
      });
      return sendJson(res, 200, { ok: true, synced_count: synced.length, total_events: news.length });
    }

    // Admin Users Management Endpoints
    if (pathname === '/api/admin/users' && method === 'GET') {
      return sendJson(res, 200, { users: mockAdminUsers });
    }
    if (pathname === '/api/admin/users' && method === 'POST') {
      const body = await readJsonBody(req);
      const newUser = {
        id: `usr_${crypto.randomBytes(6).toString('hex')}`,
        email: body.email,
        role: body.role || 'customer',
        active: true,
        created: new Date().toISOString(),
        last_login: null,
      };
      mockAdminUsers.unshift(newUser);
      return sendJson(res, 200, { ok: true, user: newUser });
    }
    const userRoleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
    if (userRoleMatch && method === 'PUT') {
      const uid = userRoleMatch[1];
      const body = await readJsonBody(req);
      const u = mockAdminUsers.find((x) => x.id === uid);
      if (u) u.role = body.role;
      return sendJson(res, 200, { ok: true, role: body.role });
    }
    const userPassMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
    if (userPassMatch && method === 'PUT') {
      return sendJson(res, 200, { ok: true });
    }
    const userDelMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userDelMatch && method === 'DELETE') {
      const uid = userDelMatch[1];
      const idx = mockAdminUsers.findIndex((x) => x.id === uid);
      if (idx !== -1) mockAdminUsers.splice(idx, 1);
      return sendJson(res, 200, { ok: true });
    }

    // Admin Gemini Keys Pool Endpoints
    if (pathname === '/api/admin/gemini/keys' && method === 'GET') {
      return sendJson(res, 200, {
        keys: mockGeminiKeys,
        total: mockGeminiKeys.length,
        active: mockGeminiKeys.filter((k) => k.is_active).length,
      });
    }
    if (pathname === '/api/admin/gemini/keys' && method === 'POST') {
      const body = await readJsonBody(req);
      const raw = String(body.key || '').trim();
      const masked = raw.length > 10 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : '***';
      const item = {
        id: `gem_${crypto.randomBytes(4).toString('hex')}`,
        name: body.name || `Gemini Key #${mockGeminiKeys.length + 1}`,
        key_masked: masked,
        is_active: true,
        requests_count: 0,
        last_used: null,
        created: new Date().toISOString(),
      };
      mockGeminiKeys.push(item);
      return sendJson(res, 200, { ok: true, key: item });
    }
    const gemToggleMatch = pathname.match(/^\/api\/admin\/gemini\/keys\/([^/]+)\/toggle$/);
    if (gemToggleMatch && method === 'PUT') {
      const kid = gemToggleMatch[1];
      const k = mockGeminiKeys.find((x) => x.id === kid);
      if (k) k.is_active = !k.is_active;
      return sendJson(res, 200, { ok: true, is_active: k?.is_active });
    }
    const gemDelMatch = pathname.match(/^\/api\/admin\/gemini\/keys\/([^/]+)$/);
    if (gemDelMatch && method === 'DELETE') {
      const kid = gemDelMatch[1];
      const idx = mockGeminiKeys.findIndex((x) => x.id === kid);
      if (idx !== -1) mockGeminiKeys.splice(idx, 1);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/gemini/test' && method === 'POST') {
      const body = await readJsonBody(req);
      const activeKey = mockGeminiKeys.find((k) => k.is_active) || mockGeminiKeys[0];
      if (activeKey) {
        activeKey.requests_count += 1;
        activeKey.last_used = new Date().toISOString();
      }
      return sendJson(res, 200, {
        success: true,
        key_used: activeKey ? `${activeKey.name} (${activeKey.key_masked})` : 'N/A',
        response: `[Gemini Multi-Key Failover Pool Response]: Đã phân tích điều kiện rủi ro cho prompt '${(body.prompt || '').slice(0, 50)}...'. Vùng kháng cự $2,662.00, hỗ trợ $2,645.00. Cơ chế dừng lệnh SL=6.0 / TP=12.0 đảm bảo an toàn vốn.`,
      });
    }

    // Admin Hindsight Memory Endpoints
    if (pathname === '/api/admin/memory' && method === 'GET') {
      const cat = parsedUrl.searchParams.get('category');
      const q = parsedUrl.searchParams.get('q');
      let resMem = [...mockHindsightMemories];
      if (cat) resMem = resMem.filter((m) => m.category === cat);
      if (q) resMem = resMem.filter((m) => m.content.toLowerCase().includes(q.toLowerCase()));
      return sendJson(res, 200, { memories: resMem, total: resMem.length });
    }
    if (pathname === '/api/admin/memory' && method === 'POST') {
      const body = await readJsonBody(req);
      const mem = {
        id: `mem_${crypto.randomBytes(6).toString('hex')}`,
        category: body.category || 'semantic',
        content: body.content,
        metadata: body.metadata || {},
        created: new Date().toISOString(),
      };
      mockHindsightMemories.unshift(mem);
      return sendJson(res, 200, { ok: true, memory: mem });
    }
    const memDelMatch = pathname.match(/^\/api\/admin\/memory\/([^/]+)$/);
    if (memDelMatch && method === 'DELETE') {
      const mid = memDelMatch[1];
      const idx = mockHindsightMemories.findIndex((x) => x.id === mid);
      if (idx !== -1) mockHindsightMemories.splice(idx, 1);
      return sendJson(res, 200, { ok: true });
    }

    // Quant Portfolio Universe & Sizing
    if (pathname === '/api/quant/universe' && method === 'GET') {
      return sendJson(res, 200, {
        universe: [
          { symbol: 'XAUUSD', name: 'Gold vs US Dollar', category: 'commodities', price: 2652.4, atr_m15: 3.8, volatility_pct: 0.143, regime: 'Dynamic Trend Continuation', strategy_bias: 'trend_following', sl_points: 5.7, tp_points: 11.4 },
          { symbol: 'EURUSD', name: 'Euro vs US Dollar', category: 'forex_major', price: 1.0845, atr_m15: 0.0018, volatility_pct: 0.166, regime: 'Low Volatility Consolidation', strategy_bias: 'mean_reversion', sl_points: 0.0027, tp_points: 0.0054 },
          { symbol: 'GBPUSD', name: 'British Pound vs US Dollar', category: 'forex_major', price: 1.2932, atr_m15: 0.0026, volatility_pct: 0.201, regime: 'Dynamic Trend Continuation', strategy_bias: 'trend_following', sl_points: 0.0039, tp_points: 0.0078 },
          { symbol: 'USDJPY', name: 'US Dollar vs Japanese Yen', category: 'forex_major', price: 154.25, atr_m15: 0.22, volatility_pct: 0.143, regime: 'Low Volatility Consolidation', strategy_bias: 'mean_reversion', sl_points: 0.33, tp_points: 0.66 },
          { symbol: 'BTCUSD', name: 'Bitcoin vs US Dollar', category: 'crypto', price: 91250.0, atr_m15: 420.0, volatility_pct: 0.46, regime: 'High Volatility Breakout', strategy_bias: 'breakout', sl_points: 840.0, tp_points: 1680.0 },
        ],
        scanned_at: nowSec(),
      });
    }

    if (pathname === '/api/quant/sizing' && method === 'POST') {
      return sendJson(res, 200, {
        symbol: 'XAUUSD',
        equity: 10000.0,
        risk_percent: 1.0,
        method: 'atr_volatility',
        recommended_lot: 0.26,
        dollar_risk: 100.0,
        sl_points: 5.7,
        contract_multiplier: 100.0,
        is_clamped: false,
      });
    }

    if (pathname === '/api/quant/monte-carlo' && method === 'POST') {
      return sendJson(res, 200, {
        iterations: 10000,
        horizon_trades: 100,
        initial_equity: 10000.0,
        ruin_threshold_pct: 20.0,
        risk_of_ruin_pct: 0.08,
        median_max_drawdown_pct: 2.15,
        var_95_max_drawdown_pct: 3.42,
        var_99_max_drawdown_pct: 4.65,
        median_final_equity: 14850.0,
        robustness_score: 92.4,
      });
    }

    // Swarm Multi-Agent Endpoints
    if (pathname === '/api/admin/swarm/status' && method === 'GET') {
      return sendJson(res, 200, {
        active_agents_count: 3,
        cycles_count: 24,
        agents: {
          sentinel: {
            name: 'Sentinel Agent',
            role: 'Macro Surveillance & News Blackout',
            state: 'working',
            last_action: 'Thị trường an toàn. Không có tin tức High Impact trong 4 giờ tới.',
            risk_score: 0.15,
            status: 'active',
          },
          alpha: {
            name: 'Alpha Agent',
            role: 'Multi-Asset Strategy Discovery',
            state: 'working',
            last_action: 'Đã quét 5 tài sản. Ưu tiên cấu hình [TREND_FOLLOWING] trên cặp XAUUSD.',
            top_asset: 'XAUUSD',
            strategy_bias: 'trend_following',
            status: 'active',
          },
          risk_guardian: {
            name: 'Risk Guardian Agent',
            role: 'Portfolio VaR 99% & Leverage Guardian',
            state: 'working',
            last_action: 'Danh mục an toàn. VaR 99% = 3.42%, Risk of Ruin = 0.08%.',
            var_99_pct: 3.42,
            risk_of_ruin_pct: 0.08,
            status: 'active',
          },
        },
        recent_messages: [
          { ts: nowSec() - 45, agent: 'Swarm Coordinator', message: 'Chu kỳ tự hành #24 hoàn tất: 3 Agent phối hợp đồng bộ. Trạng thái an toàn.' },
          { ts: nowSec() - 110, agent: 'Sentinel Agent', message: 'Quét lịch kinh tế ForexFactory: Không ghi nhận sự kiện High Impact.' },
          { ts: nowSec() - 170, agent: 'Alpha Agent', message: 'WFO Walk-Forward kiểm định Sharpe XAUUSD đạt 1.48 (OOS Profit Factor 1.95).' },
        ],
      });
    }

    if (pathname === '/api/admin/swarm/cycle' && method === 'POST') {
      return sendJson(res, 200, {
        ok: true,
        cycle: 25,
        sentinel: { blackout: false, risk_score: 0.15, events_count: 0 },
        alpha: { top_asset: 'XAUUSD', bias: 'trend_following', scanned_assets: 5 },
        risk_guardian: { var_99: 3.42, risk_of_ruin: 0.08, status: 'normal' },
      });
    }

    // Resend Mailer Endpoints
    if (pathname === '/api/admin/mailer/status' && method === 'GET') {
      return sendJson(res, 200, {
        configured: true,
        key_masked: 're_9n3W...gPc1',
        sender: 'ZUPIRUS Quant Lab <system@zupirus.com>',
        verified_domain: 'zupirus.com',
        provider: 'Resend (Tokyo ap-northeast-1)',
      });
    }

    if (pathname === '/api/admin/mailer/test' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        ok: true,
        id: 'mock_resend_' + Math.random().toString(36).substring(2, 10),
        recipients: [body.to || 'admin@zupirus.com'],
      });
    }

    if (pathname === '/api/auth/send-otp' && method === 'POST') {
      return sendJson(res, 200, {
        ok: true,
        message: 'Mã xác thực OTP đã được gửi đến email của bạn',
        expires_in: 600,
      });
    }

    if (pathname === '/api/auth/verify-otp' && method === 'POST') {
      return sendJson(res, 200, {
        ok: true,
        verified: true,
        message: 'Xác thực email thành công',
      });
    }

    // SePay Webhook Mock
    if (pathname === '/api/webhooks/sepay' && method === 'POST') {
      return sendJson(res, 200, {
        success: true,
        transaction_id: 'pay_mock_' + Math.random().toString(36).substring(2, 10),
        message: 'Payment verified and recorded successfully',
      });
    }

    if (pathname === '/api/v1/billing/admin/revenue' && method === 'GET') {
      return sendJson(res, 200, {
        total_orders: 12,
        total_revenue_usd: 540.0,
        total_revenue_vnd: 13890000,
        pending_orders: 2,
        paid_orders: 10,
        current_fx_rate: 25729.33,
        fx_source: 'API',
      });
    }

    if (pathname === '/api/v1/billing/admin/orders' && method === 'GET') {
      return sendJson(res, 200, {
        total: 2,
        orders: [
          {
            id: 'ord_15e8e3467903',
            user_id: 'usr_001',
            user_email: 'car230698@gmail.com',
            amount_usd: 30.0,
            amount_vnd: 772000,
            locked_exchange_rate: 25729.33,
            plan_tier: 'starter',
            cloud_slots_count: 1,
            status: 'PAID',
            payment_gateway: 'SEPAY',
            created_at: nowSec() - 1800,
            expires_at: nowSec() + 1800,
          },
          {
            id: 'ord_b3432835ec32',
            user_id: 'usr_002',
            user_email: 'trader@propfirm.vn',
            amount_usd: 45.0,
            amount_vnd: 1158000,
            locked_exchange_rate: 25729.33,
            plan_tier: 'growth',
            cloud_slots_count: 2,
            status: 'PENDING',
            payment_gateway: 'SEPAY',
            created_at: nowSec() - 600,
            expires_at: nowSec() + 600,
          }
        ]
      });
    }

    if (pathname === '/api/admin/payments' && method === 'GET') {
      return sendJson(res, 200, {
        total_revenue_vnd: 24500000.0,
        total_transactions: 5,
        transactions: [
          {
            id: 'pay_demo_01',
            sepay_id: '109281',
            user_id: 'usr_001',
            amount: 4900000.0,
            currency: 'VND',
            gateway: 'VietinBank',
            content: 'ZP car230698@gmail.com PRO',
            reference_code: 'FT2611158912',
            status: 'completed',
            created_at: nowSec() - 3600,
            user_email: 'car230698@gmail.com',
          },
        ],
      });
    }

    if (pathname === '/api/admin/payments/manual-approve' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        ok: true,
        transaction_id: 'manual_' + Math.random().toString(36).substring(2, 10),
        amount: Number(body.amount_vnd || 0),
        user_email: String(body.user_email || ''),
        message: 'Đã duyệt nạp thành công và gửi hóa đơn email cho khách hàng',
      });
    }

    // Legal Disclaimer & Real MT5 Accounts Mocks
    if (pathname === '/api/legal/status' && method === 'GET') {
      return sendJson(res, 200, {
        accepted: true,
        version: '2026.1',
        details: {
          accepted_at: nowSec() - 86400,
          signature_text: 'NGUYEN HOANG MINH',
          status: 'active',
        },
      });
    }

    if (pathname === '/api/legal/accept' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        ok: true,
        disclaimer_id: 'disc_mock_' + Math.random().toString(36).substring(2, 10),
        accepted_at: nowSec(),
        message: 'Đã ghi nhận chữ ký điện tử và chấp thuận Điều khoản Miễn trừ trách nhiệm thành công.',
      });
    }

    if (pathname === '/api/accounts/real' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        id: 'real_' + Math.random().toString(36).substring(2, 10),
        mode: 'REAL',
        message: 'Đã tạo tài khoản MT5 Real thành công kèm chứng chỉ miễn trừ trách nhiệm pháp lý.',
      });
    }

    // Direct-to-User MetaApi Cloud Execution Mocks
    if (pathname === '/api/metaapi/accounts' && method === 'GET') {
      return sendJson(res, 200, {
        accounts: [
          {
            id: 'cloud_demo_01',
            login: '1092837',
            server: 'Exness-MT5Real',
            platform: 'mt5',
            account_name: 'Quỹ Vàng Alpha',
            metaapi_account_id: 'meta_mock_1092837',
            metaapi_state: 'DEPLOYED',
            risk_percent: 1.0,
            max_lot: 1.0,
            multiplier: 1.0,
            auto_trade: 1,
            balance: 12450.0,
            equity: 12680.5,
            currency: 'USD',
            last_sync: nowSec() - 60,
            created_at: nowSec() - 86400 * 3,
          },
        ],
      });
    }

    if (pathname === '/api/metaapi/accounts' && method === 'POST') {
      const body = await readJsonBody(req);
      const aid = 'cloud_' + Math.random().toString(36).substring(2, 10);
      return sendJson(res, 200, {
        id: aid,
        metaapi_account_id: 'meta_' + aid,
        state: 'DEPLOYED',
        message: 'Đã kết nối tài khoản MT5 Cloud thành công. Hệ thống tự động bắn lệnh trực tiếp khi có tín hiệu.',
      });
    }

    if (pathname?.startsWith('/api/metaapi/accounts/') && pathname.endsWith('/toggle') && method === 'POST') {
      const parts = pathname.split('/');
      const aid = parts[4];
      return sendJson(res, 200, { id: aid, auto_trade: 1, status: 'ACTIVE' });
    }

    if (pathname?.startsWith('/api/metaapi/accounts/') && pathname.endsWith('/sync') && method === 'POST') {
      const parts = pathname.split('/');
      const aid = parts[4];
      return sendJson(res, 200, { id: aid, balance: 12450.0, equity: 12680.5, last_sync: nowSec() });
    }

    if (pathname?.startsWith('/api/metaapi/accounts/') && method === 'DELETE') {
      const parts = pathname.split('/');
      const aid = parts[4];
      return sendJson(res, 200, { id: aid, deleted: true });
    }

    if (pathname === '/api/metaapi/dispatch-signal' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        signal_id: 'sig_' + Math.random().toString(36).substring(2, 8),
        symbol: body.symbol || 'XAUUSD',
        action: body.action || 'BUY',
        total_accounts: 1,
        executed: 1,
        failed: 0,
        skipped: 0,
        total_fanout_elapsed_ms: 34,
        avg_latency_ms: 34,
        executions: [
          {
            account_id: 'cloud_demo_01',
            status: 'FILLED',
            volume: 0.25,
            order_id: 'ORD-98213',
            latency_ms: 34,
          },
        ],
      });
    }

    if (pathname === '/api/metaapi/executions' && method === 'GET') {
      return sendJson(res, 200, {
        executions: [
          {
            id: 'exec_01',
            signal_id: 'sig_xau_882',
            account_id: 'cloud_demo_01',
            login: '1092837',
            server: 'Exness-MT5Real',
            symbol: 'XAUUSD',
            action: 'BUY',
            volume: 0.25,
            entry_price: 2654.5,
            sl: 2649.5,
            tp: 2669.5,
            status: 'FILLED',
            latency_ms: 28,
            executed_at: nowSec() - 720,
          },
        ],
      });
    }

    if (pathname === '/api/metaapi/telemetry' && method === 'GET') {
      return sendJson(res, 200, {
        cloud_engine: 'MetaApi Cloud MT5',
        mode: 'Production MetaApi Gateway',
        total_connected_accounts: 1,
        active_auto_trading_accounts: 1,
        total_orders_executed: 48,
        average_latency_ms: 31.4,
        fill_rate_percent: 100.0,
        direct_to_user_enabled: true,
      });
    }

    // Admin Vision Incident Review
    if (pathname === '/api/admin/vision' && method === 'POST') {
      const body = await readJsonBody(req);
      const imgLen = String(body.image || '').length;
      const text =
        'Vision Incident Review (Demo Diagnostics): Biểu đồ XAUUSD M15 ghi nhận vùng biến động quanh ngưỡng SMA(5)/SMA(20) với biên độ SL=6.0 pts / TP=12.0 pts. Không phát hiện lệch chuẩn thực thi hay gửi trùng lệnh (Redis Distributed Lock hoạt động ổn định).';
      recordTrace(
        'ai_vision:incident_review',
        'llm',
        { image_bytes: imgLen, question: body.question || 'Phân tích sự cố trên biểu đồ demo này.' },
        { text },
        310.4,
        { prompt_tokens: 185, completion_tokens: 64, total_tokens: 249 }
      );
      return sendJson(res, 200, { available: true, text });
    }

    // TimescaleDB Candles Endpoint
    if (pathname === '/api/timescale/candles' && method === 'GET') {
      const symbol = parsedUrl.searchParams.get('symbol') || 'XAUUSD';
      const timeframe = parsedUrl.searchParams.get('timeframe') || 'M15';
      const source = parsedUrl.searchParams.get('source') || 'DEMO';
      const limit = Math.min(Number(parsedUrl.searchParams.get('limit') || 40), 200);
      const validTf = ['M1', 'M5', 'M15', 'H1', 'D1'];
      if (!validTf.includes(timeframe)) {
        return sendJson(res, 400, {
          detail: `Unsupported timeframe '${timeframe}'. Supported: ${validTf.join(', ')}`,
        });
      }
      const stepSec =
        timeframe === 'M1' ? 60 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'H1' ? 3600 : 86400;
      const now = Math.floor(nowSec() / stepSec) * stepSec;
      const candles = [];
      for (let i = 0; i < limit; i++) {
        const idx = (replayIdx - i * 3 + prices.length * 10) % prices.length;
        const c = prices[idx];
        const o = prices[(idx - 1 + prices.length) % prices.length];
        const h = Number((Math.max(o, c) + 1.35).toFixed(2));
        const l = Number((Math.min(o, c) - 1.15).toFixed(2));
        candles.push({
          bucket: new Date((now - i * stepSec) * 1000).toISOString(),
          open: o,
          high: h,
          low: l,
          close: c,
          volume: 18 + ((idx * 7) % 45),
        });
      }
      return sendJson(res, 200, { symbol, timeframe, source, candles });
    }

    // Classic Assistant Fallback
    if (pathname === '/api/assistant' && method === 'POST') {
      const body = await readJsonBody(req);
      const totalBal = accounts.reduce((s, a) => s + a.balance, 0);
      const totalEq = accounts.reduce((s, a) => s + a.equity, 0);
      const text = `Bạn có ${accounts.length} tài khoản (${orders.length} lệnh gần nhất), tổng Balance $${totalBal.toLocaleString()}, tổng Equity $${totalEq.toLocaleString()}. Real luôn bị khóa. Tạm dừng copy ngăn lệnh mới; SL/TP hiện hữu vẫn do broker xử lý. Câu hỏi: "${body.question || ''}"`;
      return sendJson(res, 200, { text, ai: false });
    }

    // Vercel AI SDK 6 Data Stream Protocol: Customer Assistant
    if (pathname === '/api/chat/assistant' && method === 'POST') {
      const body = await readJsonBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const userMsg = String(messages[messages.length - 1]?.content || '');
      const lower = userMsg.toLowerCase();

      const totalBalance = Number(accounts.reduce((s, a) => s + a.balance, 0).toFixed(2));
      const totalEquity = Number(accounts.reduce((s, a) => s + a.equity, 0).toFixed(2));
      const pnl = Number((totalEquity - totalBalance).toFixed(2));

      let invokedTool: { name: string; parameters: Record<string, any> } | null = null;
      let responseText = '';

      if (
        ['lệnh', 'giao dịch', 'order', 'deal', 'lịch sử', 'unknown', 'ticket'].some((k) => lower.includes(k))
      ) {
        invokedTool = {
          name: 'renderRecentOrdersCard',
          parameters: {
            orders: orders.slice(0, 8),
          },
        };
        responseText = `Trợ lý quy tắc · Hệ thống ghi nhận ${orders.length} lệnh thực thi gần nhất trên ${accounts.length} tài khoản. Mọi tín hiệu đều đi qua khóa phân tán Redis (lock:dispatch) và chỉ ghi nhận FILLED khi có đầy đủ Order Ticket + Deal từ broker. Trạng thái UNKNOWN sẽ chờ EA đối soát lịch sử, tuyệt đối không gửi lặp lệnh.`;
      } else {
        invokedTool = {
          name: 'renderPortfolioCard',
          parameters: {
            accountsCount: accounts.length,
            accounts: accounts.slice(0, 5),
            totalBalance,
            totalEquity,
          },
        };
        responseText = `Trợ lý quy tắc · Hệ thống demo ghi nhận ${accounts.length} tài khoản đang hoạt động (${orders.length} lệnh gần nhất). Tổng số dư là $${totalBalance.toLocaleString()}, vốn thả nổi (Equity) đạt $${totalEquity.toLocaleString()} (${pnl >= 0 ? '+' : ''}$${pnl}). Chế độ giao dịch tiền thật (REAL) đã bị khóa cứng ở cả Backend và EA.`;
      }

      recordTrace(
        'vercel_ai_sdk:chat_assistant',
        'llm',
        { user_message: userMsg },
        { response: responseText, generative_ui_tool: invokedTool?.name || null },
        118.6,
        { prompt_tokens: 92, completion_tokens: 68, total_tokens: 160 }
      );

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('x-vercel-ai-data-stream', 'v1');
      res.write(`0:${JSON.stringify(responseText)}\n`);
      if (invokedTool) {
        const callId = `tool_${crypto.randomBytes(6).toString('hex')}`;
        res.write(
          `9:${JSON.stringify({
            toolCallId: callId,
            toolName: invokedTool.name,
            args: invokedTool.parameters,
          })}\n`
        );
        res.write(
          `a:${JSON.stringify({
            toolCallId: callId,
            result: { rendered: true, ...invokedTool.parameters },
          })}\n`
        );
      }
      res.end('d:{"finishReason":"stop"}\n');
      return;
    }

    // Vercel AI SDK 6 ToolLoopAgent: Admin Approval Stream
    if (pathname === '/api/chat/admin-agent' && method === 'POST') {
      const pendingJobs = jobs.filter((j) => j.state === 'waiting_approval');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('x-vercel-ai-data-stream', 'v1');

      if (pendingJobs.length > 0) {
        const target = pendingJobs[0];
        const callId = `call_approval_${target.id}`;
        let report = {};
        try {
          report = JSON.parse(target.result || '{}').report || {};
        } catch {
          report = {};
        }
        res.write(`0:${JSON.stringify('Phát hiện chiến lược ứng viên Walk-Forward cần Admin duyệt trước khi lưu trữ:')}\n`);
        res.write(
          `9:${JSON.stringify({
            toolCallId: callId,
            toolName: 'requestStrategyApproval',
            args: { jobId: target.id, report, needsApproval: true },
          })}\n`
        );
      } else {
        res.write(
          `0:${JSON.stringify('Không có chiến lược nào đang chờ phê duyệt. Toàn bộ chu kỳ Walk-Forward đã hoàn tất.')}\n`
        );
      }
      res.end('d:{"finishReason":"stop"}\n');
      return;
    }

    // Live Topbar Telemetry
    if ((pathname === '/api/v1/telemetry/topbar' || pathname === '/api/v1/telemetry/public') && method === 'GET') {
      const mid = prices[replayIdx] || 2656.45;
      return sendJson(res, 200, {
        xauusd: {
          symbol: 'XAUUSD',
          bid: Number((mid - 0.14).toFixed(2)),
          ask: Number((mid + 0.14).toFixed(2)),
          mid: Number(mid.toFixed(2)),
          spread_pips: 2.8,
          live: true,
          data_available: true,
          stale: false,
          source: 'DEV_FIXTURE',
        },
        usd_vnd: {
          rate: 25730,
          source: 'Vietcombank Live',
        },
        news_shield: {
          status: 'CLEAR',
          distance_mins: 185,
          nearest_title: 'US Core CPI (MoM)',
        },
        metaapi_latency_ms: 28,
        region: 'london-g2',
        active_sources_count: 2,
        system_status: halted ? 'HALTED' : 'NOMINAL',
      });
    }

    // Exchange Rate & Billing Settings
    if (pathname === '/api/v1/billing/exchange-rate' && method === 'GET') {
      return sendJson(res, 200, {
        base: 'USD',
        target: 'VND',
        rate: 25730,
        source: 'Vietcombank / OpenER',
        is_cached: true,
        updated_at: nowSec() - 45,
      });
    }

    if (pathname === '/api/v1/billing/refresh-exchange-rate' && method === 'POST') {
      return sendJson(res, 200, {
        base: 'USD',
        target: 'VND',
        rate: 25735,
        source: 'Live Fetch',
        is_cached: false,
        updated_at: nowSec(),
      });
    }

    if (pathname === '/api/v1/billing/subscription' && method === 'GET') {
      return sendJson(res, 200, {
        plan_tier: 'alpha',
        status: 'ACTIVE',
        is_active: true,
        service_expires_at: nowSec() + 86400 * 26,
        max_mt5_accounts: 5,
        max_cloud_accounts: 5,
        allow_custom_multiplier: true,
        allow_compounding: true,
        allow_prop_firm_mode: true,
      });
    }

    if (pathname === '/api/v1/billing/checkout' && method === 'POST') {
      const body = await readJsonBody(req);
      const tier = body.plan_tier || 'growth';
      const slots = Number(body.cloud_slots || 1);
      const baseUsd = tier === 'alpha' ? 49 : tier === 'growth' ? 35 : 20;
      const totalUsd = baseUsd + slots * 10;
      const rate = 25730;
      const vnd = Math.ceil((totalUsd * rate) / 1000) * 1000;
      const ordId = 'ord_' + crypto.randomBytes(5).toString('hex');
      const memo = `ZP ${ordId.slice(-6).toUpperCase()}`;
      return sendJson(res, 200, {
        id: ordId,
        plan_tier: tier,
        cloud_slots_count: slots,
        amount_usd: totalUsd,
        amount_vnd: vnd,
        locked_exchange_rate: rate,
        bank_name: 'VietinBank',
        account_number: '',
        account_holder: '',
        payment_content: memo,
        status: 'PENDING',
        expires_at: nowSec() + 1200,
      });
    }

    if (pathname.startsWith('/api/v1/billing/orders/') && method === 'GET') {
      const ordId = decodeURIComponent(pathname.split('/').pop() || 'ord_demo');
      const extState = (globalThis as any).__zupirusExtendedState;
      const existing =
        extState?.reportOrders?.find((o: any) => o.id === ordId) ||
        extState?.billingOrders?.find((o: any) => o.id === ordId);
      if (existing) {
        return sendJson(res, 200, existing);
      }
      return sendJson(res, 200, {
        id: ordId,
        status: 'PAID',
        paid_at: nowSec(),
      });
    }

    if (pathname === '/api/admin/billing/settings' && method === 'GET') {
      return sendJson(res, 200, {
        bank_name: 'VietinBank',
        account_number: '',
        account_holder: '',
        content_prefix: 'ZP',
        fx_mode: 'AUTO',
        fallback_usd_vnd_rate: 25730,
        manual_fx_rate: 25730,
        current_live_rate: 25730,
        current_fx_rate: 25730,
        current_rate_source: 'Vietcombank Live',
        fx_source: 'Vietcombank Live',
        fx_rate_provider_url: 'https://open.er-api.com/v6/latest/USD',
        fx_rate_cache_ttl_seconds: 1800,
        supported_banks: [
          { shortName: 'VietinBank', name: 'Ngân hàng TMCP Công Thương Việt Nam (ICB)' },
          { shortName: 'Vietcombank', name: 'Ngân hàng TMCP Ngoại Thương Việt Nam (VCB)' },
          { shortName: 'MBBank', name: 'Ngân hàng TMCP Quân Đội (MB)' },
          { shortName: 'Techcombank', name: 'Ngân hàng TMCP Kỹ Thương Việt Nam (TCB)' },
        ],
      });
    }

    if (pathname === '/api/admin/billing/settings' && (method === 'POST' || method === 'PUT')) {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        ok: true,
        message: 'Đã lưu cấu hình tỷ giá USD/VND thành công.',
        settings: body,
      });
    }

    if (pathname === '/api/admin/billing/flush-fx-cache' && method === 'POST') {
      return sendJson(res, 200, {
        ok: true,
        message: 'Đã làm mới bộ nhớ đệm tỷ giá Redis.',
        new_rate: 25735,
        source: 'Vietcombank API',
      });
    }

    // Cloud MT5 Accounts v1
    if (pathname === '/api/v1/accounts' && method === 'GET') {
      const mapped = accounts.map((a, idx) => ({
        id: a.id,
        login: a.login,
        mt5_login: a.login,
        server: a.server === 'ZUPIRUS-SYNTHETIC' ? 'Exness-MT5Real24' : a.server,
        broker_server: a.server === 'ZUPIRUS-SYNTHETIC' ? 'Exness-MT5Real24' : a.server,
        account_name: idx === 0 ? 'Alpha Gold Vault #1' : 'FTMO Challenge 100K',
        account_type: idx === 0 ? 'RAW_ECN' : 'PROP_FIRM',
        balance: a.balance,
        equity: a.equity,
        auto_trade: a.enabled ? 1 : 0,
        risk_multiplier: idx === 0 ? 1.2 : 1.0,
        is_compounding: idx === 0,
        is_prop_firm_mode: idx !== 0,
        prop_daily_dd_limit_pct: 4.5,
        prop_profit_target_pct: 8.0,
        auto_be_partial_tp: true,
        deployment_state: 'DEPLOYED',
        is_active: true,
      }));
      return sendJson(res, 200, { accounts: mapped, total: mapped.length });
    }

    if (pathname === '/api/v1/accounts' && method === 'POST') {
      const body = await readJsonBody(req);
      const id = `acc_cloud_${crypto.randomBytes(4).toString('hex')}`;
      const ts = nowSec();
      accounts.unshift({
        id,
        user_id: 'usr_admin',
        email: 'admin@zupirus.local',
        login: String(body.login || '88991122'),
        server: String(body.server || 'Exness-MT5Real'),
        mode: 'DEMO',
        enabled: 1,
        risk: 1.0,
        max_spread: 0.8,
        max_positions: 2,
        max_dd: 10,
        balance: 15000,
        equity: 15000,
        peak: 15000,
        seen: ts,
        positions: 0,
      });
      return sendJson(res, 200, {
        id,
        metaapi_account_id: `meta_${id}`,
        state: 'DEPLOYED',
      });
    }

    const v1AccToggle = pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/toggle$/);
    if (v1AccToggle && method === 'POST') {
      const acc = accounts.find((a) => a.id === v1AccToggle[1]);
      if (acc) acc.enabled = acc.enabled ? 0 : 1;
      return sendJson(res, 200, { ok: true, auto_trade: acc ? acc.enabled : 1 });
    }

    const v1AccSync = pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/sync$/);
    if (v1AccSync && method === 'POST') {
      return sendJson(res, 200, { ok: true, synced_at: nowSec() });
    }

    const v1AccCloudDeploy = pathname.match(/^\/api\/v1\/accounts\/cloud\/([^/]+)\/(deploy|undeploy)$/);
    if (v1AccCloudDeploy && method === 'POST') {
      return sendJson(res, 200, { ok: true, action: v1AccCloudDeploy[2] });
    }

    const v1AccItem = pathname.match(/^\/api\/v1\/accounts\/([^/]+)$/);
    if (v1AccItem && (method === 'PATCH' || method === 'DELETE')) {
      if (method === 'DELETE') {
        const idx = accounts.findIndex((a) => a.id === v1AccItem[1]);
        if (idx !== -1) accounts.splice(idx, 1);
      }
      return sendJson(res, 200, { ok: true });
    }

    // Signals v1 Audit & Stats
    if (!(globalThis as any).__zupirusAuditLogs) {
      (globalThis as any).__zupirusAuditLogs = [
        {
          id: 'aud_01',
          created_at: nowSec() - 120,
          signal_id: 'sig_xau_london_901',
          source: 'LONDON_INST_G2',
          source_name: 'London Institutional Feed',
          raw_message: 'BUY XAUUSD @ 2906.40 SL 2896.00 TP 2926.00',
          action: 'BUY',
          side: 'BUY',
          symbol: 'XAUUSD',
          entry_price: 2906.4,
          sl: 2896.0,
          stop_loss: 2896.0,
          tp: 2926.0,
          status: 'EXECUTED',
          accounts_dispatched: 2,
          strategy_tier: 'ALPHA',
          reject_reason: 'Passed all 4 safety guards (Idempotency, Mandatory SL, News Shield, Spread 2.2p)',
          pnl: 142.5,
          mae: -1.4,
          mfe: 9.8,
          context_snapshot: {
            session: 'LONDON_NY_OVERLAP',
            atr_14: 4.15,
            spread_pips: 2.2,
            news_distance_mins: 185,
          },
        },
        {
          id: 'aud_02',
          created_at: nowSec() - 540,
          signal_id: 'sig_xau_tv_884',
          source: 'TV_WEBHOOK_PRO',
          source_name: 'TradingView Webhook Pro',
          raw_message: 'SELL XAUUSD @ 2912.80 SL 2921.50 TP 2894.00',
          action: 'SELL',
          side: 'SELL',
          symbol: 'XAUUSD',
          entry_price: 2912.8,
          sl: 2921.5,
          stop_loss: 2921.5,
          tp: 2894.0,
          status: 'EXECUTED',
          accounts_dispatched: 2,
          strategy_tier: 'GROWTH',
          reject_reason: 'Passed all 4 safety guards · Auto Break-Even armed at 1R',
          pnl: 96.0,
          mae: -0.9,
          mfe: 6.4,
          context_snapshot: {
            session: 'LONDON_OPEN',
            atr_14: 3.85,
            spread_pips: 2.4,
            news_distance_mins: 240,
          },
        },
        {
          id: 'aud_03',
          created_at: nowSec() - 1380,
          signal_id: 'sig_ext_unverified_402',
          source: 'SHADOW_CAND_04',
          source_name: 'Shadow Candidate #04',
          raw_message: 'BUY GOLD NOW NO SL',
          action: 'BUY',
          side: 'BUY',
          symbol: 'XAUUSD',
          entry_price: 2909.0,
          sl: null,
          stop_loss: null,
          tp: null,
          status: 'BLOCKED_NO_SL',
          accounts_dispatched: 0,
          strategy_tier: 'SHADOW',
          reject_reason: 'Guard #02 Triggered: Missing Mandatory Hard Stop-Loss',
          pnl: null,
          context_snapshot: {
            session: 'ASIAN_RANGE',
            atr_14: 2.4,
            spread_pips: 3.1,
            news_distance_mins: 410,
          },
        },
      ];
      (globalThis as any).__zupirusSignalCounters = {
        total_signals: 128,
        executed: 114,
        blocked: 14,
        active_trades: 2,
        learning_progress_pct: 92,
        active_signal_mode: 'HYBRID_TABULA_RASA',
      };
    }

    if (pathname === '/api/v1/signals/audit-logs' && method === 'GET') {
      const logs = (globalThis as any).__zupirusAuditLogs;
      return sendJson(res, 200, {
        logs,
        audit_logs: logs,
      });
    }

    if (pathname === '/api/v1/signals/stats' && method === 'GET') {
      const c = (globalThis as any).__zupirusSignalCounters;
      return sendJson(res, 200, {
        total_audited: c.total_signals,
        approved_count: c.executed,
        rejected_count: c.blocked,
        ...c,
      });
    }

    if (pathname === '/api/v1/signals/test-ingest' && method === 'POST') {
      const body = await readJsonBody(req);
      const rawMsg = String(body.raw_message || 'BUY XAUUSD @ 2908.50 SL 2898.00 TP 2928.00');
      const upper = rawMsg.toUpperCase();
      const action = upper.includes('SELL') ? 'SELL' : 'BUY';
      const sigId = 'sig_test_' + crypto.randomBytes(3).toString('hex');
      const dispatchedCount = Math.max(accounts.length, 2);
      const newEntry = {
        id: sigId,
        created_at: nowSec(),
        signal_id: sigId,
        source: body.source || 'ADMIN_TEST_BENCH',
        source_name: body.source || 'Admin Test Bench',
        raw_message: rawMsg,
        action,
        side: action,
        symbol: 'XAUUSD',
        entry_price: 2908.5,
        sl: action === 'BUY' ? 2898.0 : 2918.5,
        stop_loss: action === 'BUY' ? 2898.0 : 2918.5,
        tp: action === 'BUY' ? 2928.0 : 2888.0,
        status: 'EXECUTED',
        accounts_dispatched: dispatchedCount,
        strategy_tier: 'ALPHA',
        reject_reason: 'Passed all 4 safety guards · Auto-ATR SL verified',
      };
      (globalThis as any).__zupirusAuditLogs.unshift(newEntry);
      (globalThis as any).__zupirusSignalCounters.total_signals += 1;
      (globalThis as any).__zupirusSignalCounters.executed += 1;

      return sendJson(res, 200, {
        ok: true,
        signal_id: sigId,
        symbol: body.symbol || 'XAUUSD',
        action,
        dispatched: dispatchedCount,
        reason: `Đã chuẩn hóa ${action} XAUUSD, vượt qua 4 lớp bảo vệ và quạt lệnh tới ${dispatchedCount} tài khoản Cloud MT5 (28ms)`,
        guards_evaluated: {
          redis_idempotency_lock: 'PASS (<0.8ms)',
          mandatory_sl_guard: 'AUTO_ATTACHED_ATR_SL ($2,898.00)',
          live_news_shield: 'PASS (No USD Red News within ±15m)',
          spread_slippage_guard: 'PASS (2.2 pips <= 4.5 pips max)',
        },
        status: 'EXECUTED',
      });
    }

    // Admin Sources & Skills
    if (pathname === '/api/admin/sources' && method === 'GET') {
      return sendJson(res, 200, {
        sources: [
          {
            id: 'src_london_alpha',
            name: 'London Institutional Orderflow',
            source_type: 'METAAPI_STREAM',
            status: 'ACTIVE_LIVE',
            trust_score: 91.4,
            profit_factor: 2.34,
            win_rate: 0.74,
            max_drawdown_pips: 42,
            evaluated_signals: 86,
          },
          {
            id: 'src_tv_quant_m15',
            name: 'ZUPIRUS M15 Volatility Breakout',
            source_type: 'TRADINGVIEW_WEBHOOK',
            status: 'ACTIVE_LIVE',
            trust_score: 86.8,
            profit_factor: 1.98,
            win_rate: 0.68,
            max_drawdown_pips: 55,
            evaluated_signals: 112,
          },
          {
            id: 'src_tokyo_meanrev',
            name: 'Asian Session Liquidity Sweep',
            source_type: 'SHADOW_FEED',
            status: 'SHADOW_ONLY',
            trust_score: 72.5,
            profit_factor: 1.54,
            win_rate: 0.61,
            max_drawdown_pips: 68,
            evaluated_signals: 44,
          },
        ],
      });
    }

    if (pathname === '/api/admin/sources/shadow-signals' && method === 'GET') {
      return sendJson(res, 200, {
        signals: [
          {
            id: 'shd_99201a8b',
            source_id: 'src_london_alpha',
            source_name: 'London Institutional Orderflow',
            side: 'BUY',
            symbol: 'XAUUSD',
            entry_price: 2652.4,
            stop_loss: 2646.4,
            take_profit: 2664.4,
            eval_status: 'HIT_TP',
            pnl_pips: 120.0,
            mae_pips: 18.5,
            mfe_pips: 134.0,
          },
          {
            id: 'shd_88412c9e',
            source_id: 'src_tv_quant_m15',
            source_name: 'ZUPIRUS M15 Volatility Breakout',
            side: 'SELL',
            symbol: 'XAUUSD',
            entry_price: 2661.0,
            stop_loss: 2667.0,
            take_profit: 2649.0,
            eval_status: 'HIT_TP',
            pnl_pips: 120.0,
            mae_pips: 22.0,
            mfe_pips: 128.5,
          },
          {
            id: 'shd_77104f2d',
            source_id: 'src_tokyo_meanrev',
            source_name: 'Asian Session Liquidity Sweep',
            side: 'BUY',
            symbol: 'XAUUSD',
            entry_price: 2656.2,
            stop_loss: 2651.2,
            take_profit: 2666.2,
            eval_status: 'PENDING',
            pnl_pips: 14.5,
            mae_pips: 6.0,
            mfe_pips: 21.0,
          },
        ],
      });
    }

    const srcActionMatch = pathname.match(/^\/api\/admin\/sources\/([^/]+)\/(promote|demote|replay)$/);
    if (srcActionMatch && method === 'POST') {
      const action = srcActionMatch[2];
      if (action === 'replay') {
        return sendJson(res, 200, {
          ok: true,
          result: {
            simulated_trades: 94,
            profit_factor: 2.18,
            win_rate: 0.71,
            trust_score: 89.2,
          },
        });
      }
      return sendJson(res, 200, {
        ok: true,
        message: action === 'promote' ? 'Đã thăng hạng nguồn lên ACTIVE_LIVE.' : 'Đã chuyển nguồn về chế độ SHADOW_ONLY.',
      });
    }

    if (pathname === '/api/admin/sources/evaluate-eod' && method === 'POST') {
      return sendJson(res, 200, {
        ok: true,
        evaluated_count: 18,
      });
    }

    if (pathname === '/api/admin/skills' && method === 'GET') {
      return sendJson(res, 200, {
        skills: [
          {
            skill_id: 'market_regime_scanner',
            name: 'Market Regime & ATR Volatility Scanner',
            is_builtin: 1,
            enabled: 1,
            usage_count: 342,
            trigger_condition: 'Khi có tín hiệu mới hoặc định kỳ mỗi đóng nến M15',
            description: 'Phân loại cấu trúc thị trường (Trend, Mean-Reversion, Breakout) và đo lường biên độ ATR(14).',
          },
          {
            skill_id: 'liquidity_spread_auditor',
            name: 'Liquidity & Real-Time Spread Auditor',
            is_builtin: 1,
            enabled: 1,
            usage_count: 518,
            trigger_condition: 'Trước khi kích hoạt lệnh xuống cụm tài khoản Cloud MT5',
            description: 'Kiểm toán độ giãn Spread và độ trượt giá thực tế trên thanh khoản London G2.',
          },
          {
            skill_id: 'macro_news_interpreter',
            name: 'Macro High-Impact News Shield',
            is_builtin: 1,
            enabled: 1,
            usage_count: 210,
            trigger_condition: 'Khi phát hiện sự kiện USD High-Impact trong bán kính ±30 phút',
            description: 'Đóng băng cấp lệnh tự động quanh thời điểm công bố CPI, Non-Farm Payrolls và FOMC.',
          },
          {
            skill_id: 'source_grading_analyst',
            name: 'Shadow Source Trust-Score Analyst',
            is_builtin: 1,
            enabled: 1,
            usage_count: 89,
            trigger_condition: 'Chấm điểm EOD dựa trên dữ liệu nến M1 TimescaleDB',
            description: 'Đánh giá MAE/MFE, Profit Factor và tự động thăng/hạ cấp nguồn tín hiệu.',
          },
          {
            skill_id: 'strategy_synthesizer',
            name: 'Tabula Rasa Inductive Strategy Synthesizer',
            is_builtin: 0,
            enabled: 1,
            usage_count: 47,
            trigger_condition: 'Khi tích lũy đủ ≥50 mẫu Context Snapshot có lợi nhuận kỳ vọng dương',
            description: 'Tự đúc kết quy tắc giao dịch quy nạp từ lịch sử bối cảnh thị trường.',
          },
        ],
      });
    }

    const skillPatchMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)$/);
    if (skillPatchMatch && method === 'PATCH') {
      return sendJson(res, 200, { ok: true, message: 'Đã cập nhật trạng thái kích hoạt kỹ năng AI Agent.' });
    }

    const skillSpecMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/spec$/);
    if (skillSpecMatch && method === 'GET') {
      const sid = skillSpecMatch[1];
      return sendJson(res, 200, {
        skill_id: sid,
        skill_md: `# Skill Specification: ${sid}\n\n- **Architecture**: Progressive Disclosure (On-Demand Context Loading)\n- **Execution Environment**: ZUPIRUS Tabula Rasa Engine v2.2\n- **Fail-Closed Contract**: Enforces strict pre-trade validation before any MetaApi Cloud dispatch.\n\n## Inputs & Telemetry\n- TimescaleDB M1/M15 OHLCV stream\n- Live Bid/Ask spread from London G2 Bridge\n- Economic Calendar High-Impact USD window`,
      });
    }

    const skillTestMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/test$/);
    if (skillTestMatch && method === 'POST') {
      const sid = skillTestMatch[1];
      return sendJson(res, 200, {
        ok: true,
        result: {
          skill_id: sid,
          status: 'VERIFIED_NOMINAL',
          execution_latency_ms: 14.2,
          sample_output: {
            symbol: 'XAUUSD',
            regime: 'LONDON_TREND_EXPANSION',
            atr_14: 4.12,
            spread_pips: 2.6,
            recommendation: 'ALLOW_DISPATCH_WITH_1R_AUTO_BE',
          },
        },
      });
    }

    // Geo & Language Preferences
    if (pathname === '/api/v1/auth/geo' && method === 'GET') {
      return sendJson(res, 200, { language: 'vi', is_foreign: false, country: 'VN' });
    }
    if (pathname === '/api/v1/auth/language' && method === 'PATCH') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { ok: true, preferred_language: body.language === 'en' ? 'en' : 'vi' });
    }

    // In-memory state initialization for Reports, Control Plane, Notifications, Crypto & Referrals
    const g = globalThis as any;
    if (!g.__zupirusExtendedState) {
      g.__zupirusExtendedState = {
        signalMode: 'HYBRID_AGENT_SCORER',
        autoPromote: false,
        cryptoWallets: {
          enabled: true,
          trc20_address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
          bep20_address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
          has_trc20: true,
          has_bep20: true,
        },
        aiQuota: {
          calls_today: 42,
          daily_cap: 500,
          usage_pct: 8.4,
          status: 'OK',
          is_overridden: false,
          override_until: 0,
          breakdown: { sentinel: 14, alpha: 18, risk_guardian: 10 },
        },
        agentsHeartbeat: [
          {
            id: 'sentinel',
            name: 'Sentinel Agent',
            role: 'Macro News & Spread Shield',
            status: 'IDLE',
            trigger_mode: 'CRON_15M',
            last_run_at: nowSec() - 120,
            last_duration_ms: 184,
            last_summary: 'Không có tin đỏ USD trong ±15 phút. Spread XAU/USD ổn định.',
            calls_today: 14,
            is_paused: false,
          },
          {
            id: 'alpha',
            name: 'Alpha Quant Agent',
            role: 'Walk-Forward Hypothesis & OOS Tester',
            status: 'IDLE',
            trigger_mode: 'CRON_1H',
            last_run_at: nowSec() - 480,
            last_duration_ms: 612,
            last_summary: 'Hoàn tất kiểm định WFO 120/60 trên mẫu XAU/USD M15 (PF 1.74).',
            calls_today: 18,
            is_paused: false,
          },
          {
            id: 'risk_guardian',
            name: 'Risk Guardian Agent',
            role: 'Drawdown & Portfolio VaR Monitor',
            status: 'IDLE',
            trigger_mode: 'EVENT_DRIVEN',
            last_run_at: nowSec() - 60,
            last_duration_ms: 92,
            last_summary: 'Drawdown danh mục trong giới hạn an toàn (2.15% < 5.0% max).',
            calls_today: 10,
            is_paused: false,
          },
        ],
        strategyQueue: [
          {
            candidate: {
              id: 'cand_xau_london_sweep_v2',
              name: 'XAUUSD London Liquidity Sweep v2.1',
              win_rate: 0.625,
              profit_factor: 1.82,
              max_drawdown_pct: 3.8,
              sample_size: 168,
              rules: { session: 'LONDON_NY', atr_filter: '1.2x', rr: '1:2.0' },
            },
            current_live: {
              id: 'cand_xau_baseline_v1',
              name: 'Alpha Quant XAU M15 v1.0',
              win_rate: 0.58,
              profit_factor: 1.54,
              max_drawdown_pct: 4.5,
              sample_size: 142,
              rules: { session: 'LONDON_NY', atr_filter: '1.0x', rr: '1:1.8' },
            },
            delta: { win_rate_diff: 4.5, pf_diff: 0.28, dd_diff: -0.7 },
          },
        ],
        strategyHistory: [
          {
            id: 'cand_xau_baseline_v1',
            name: 'Alpha Quant XAU M15 v1.0',
            status: 'APPROVED_FOR_PROD',
            win_rate_pct: 58.0,
            profit_factor: 1.54,
            sharpe_ratio: 1.62,
            max_drawdown_pct: 4.5,
            sample_size: 142,
            rules: { session: 'LONDON_NY', sl_pts: 6.0, tp_pts: 12.0 },
            created_at: nowSec() - 86400 * 7,
            updated_at: nowSec() - 86400 * 2,
          },
        ],
        ingestedSkills: [
          {
            skill_id: 'ing_london_microstructure_2026',
            name: 'London Gold Microstructure & Fix Volatility (2026)',
            category: 'gold',
            detected_category: 'gold',
            chunks_count: 14,
            created_at: nowSec() - 86400 * 5,
            summary: 'Tài liệu nghiên cứu thanh khoản vàng quanh khung 07:00-16:00 UTC và hiện tượng quét thanh khoản 20 nến.',
          },
          {
            skill_id: 'ing_fomc_macro_regime_guide',
            name: 'DXY Real Yield & FOMC Macro Regime Filter',
            category: 'macro',
            detected_category: 'macro',
            chunks_count: 9,
            created_at: nowSec() - 86400 * 3,
            summary: 'Quy tắc nhận diện chế độ thị trường theo lợi suất thực US10Y và biến động DXY trước kỳ họp FOMC.',
          },
        ],
        notifications: [
          {
            id: 'notif_1',
            severity: 'INFO',
            title: 'Báo cáo nghiên cứu mới đã xuất bản',
            body: 'Ấn phẩm XAU/USD London-NY Microstructure & WFO (v1.0) đã sẵn sàng đọc thử bản PDF mẫu.',
            read_at: null,
            created_at: nowSec() - 1800,
          },
          {
            id: 'notif_2',
            severity: 'INFO',
            title: 'Hệ thống kiểm định WFO hoàn tất',
            body: 'Chu kỳ kiểm định ngoài mẫu 120/60 hoàn tất với Profit Factor 1.74 và Max Drawdown 4.2%.',
            read_at: nowSec() - 7200,
            created_at: nowSec() - 7200,
          },
        ],
        reports: [
          {
            id: 'rep_xauusd_london_ny_v1',
            slug: 'xauusd-london-ny-liquidity-sweep-wfo-2026',
            title: 'Nghiên Cứu Định Lượng XAU/USD: Cấu Trúc Quét Thanh Khoản Phiên London - New York & Kiểm Định Walk-Forward',
            subtitle: 'Phân tích vi cấu trúc M15/H1, phân rã kỳ vọng theo phiên và mô hình chi phí thực chiến cho nhà giao dịch Vàng',
            summary: 'Báo cáo định lượng chuyên sâu phân tích hiện tượng quét thanh khoản 20 nến (Liquidity Sweep) kết hợp xu hướng H1 trên thị trường Vàng (XAU/USD). Toàn bộ quy tắc được kiểm định ngoài mẫu (Walk-Forward 120/60) với giả định chi phí khứ hồi 3.5 pips minh bạch.',
            market: 'XAUUSD',
            timeframe: 'M15 / H1',
            status: 'PUBLISHED',
            current_version: 'v1.0',
            price_vnd: 790000,
            price_usd: 32.0,
            page_count: 18,
            sample_pdf_url: '/api/v1/reports/rep_xauusd_london_ny_v1/sample-pdf',
            sample_pdf_file: 'web/public/reports_samples/zupirus-xauusd-london-ny-microstructure-v1.0-sample.pdf',
            full_pdf_file: 'web/public/reports_samples/zupirus-xauusd-london-ny-microstructure-v1.0-sample.pdf',
            highlights: [
              'Phân rã hiệu suất theo từng phiên: Asia, London, London/NY Overlap và Late NY',
              'Kiểm định Walk-Forward 120 nến huấn luyện / 60 nến ngoài mẫu chống nhìn trước tương lai',
              'Bộ lọc Hazard Guard loại bỏ các vùng nhiễu thanh khoản khi thiếu xác nhận xu hướng H1',
              'Bảng tham chiếu quy mô vị thế và ngưỡng chịu đựng sụt giảm (Drawdown) theo ATR(14)',
            ],
            wfo_metrics: {
              sample_size: 142,
              oos_trades: 64,
              win_rate: 0.61,
              expectancy_R: 0.48,
              profit_factor: 1.74,
              max_drawdown_pct: 4.2,
              sharpe_ratio: 1.85,
              cost_model_pips: 3.5,
              cost_model_is_assumed: true,
            },
            published_at: nowSec() - 86400 * 5,
            updated_at: nowSec() - 86400 * 2,
            can_purchase: true,
            commercial_sale_enabled: true,
          },
          {
            id: 'rep_eurusd_h1_asia_london_v1',
            slug: 'eurusd-h1-asia-london-breakout-stats-v1',
            title: 'EURUSD H1: Phiên Á và Xác Suất Phá Biên London — Thống Kê Mẫu 2024–2026',
            subtitle: 'Nghiên cứu thống kê mô tả biên độ phiên Á, tỷ lệ giữ biên London và đường đi lịch sử của quy tắc mẫu (17,245 nến H1)',
            summary: 'Phân tích thống kê trên mẫu 17,245 nến EURUSD H1 về phân phối biên độ phiên Á/London/NY, vùng biến động ATR(14), tự tương quan trễ-1 và đường đi lịch sử sau chi phí khứ hồi 0.05R.',
            market: 'EURUSD',
            timeframe: 'H1',
            status: 'PUBLISHED',
            current_version: 'v1.0',
            price_vnd: 490000,
            price_usd: 19.0,
            page_count: 14,
            sample_pdf_url: '/api/v1/reports/rep_eurusd_h1_asia_london_v1/sample-pdf',
            sample_pdf_file: 'data/guides/eurusd-h1-asia-london-preview.pdf',
            full_pdf_file: 'data/guides/eurusd-h1-asia-london-preview.pdf',
            highlights: [
              'Mẫu 17,245 nến EURUSD H1 tái lập hoàn toàn được bằng tham số công khai',
              'Bảng hành vi theo phiên UTC, vùng biến động ATR(14) và mùa vụ theo giờ/thứ',
              'Quy tắc minh họa phá biên phiên Á với 704 giao dịch lịch sử sau chi phí 0.05R',
            ],
            wfo_metrics: {
              sample_size: 704,
              oos_trades: 704,
              win_rate: 0.5312,
              expectancy_R: 0.0201,
              profit_factor: 1.0476,
              max_drawdown_pct: 12.4,
              sharpe_ratio: 0.92,
              cost_model_pips: 0.8,
              cost_model_is_assumed: true,
            },
            published_at: nowSec() - 86400 * 2,
            updated_at: nowSec() - 86400,
            can_purchase: true,
            commercial_sale_enabled: true,
          },
        ],
        library: [
          {
            entitlement_id: 'ent_demo_01',
            report_id: 'rep_xauusd_london_ny_v1',
            purchased_version: 'v1.0',
            order_id: 'ord_rep_seed_01',
            order_code: 'ZP-REP-01',
            status: 'ACTIVE',
            granted_at: nowSec() - 86400 * 2,
            download_count: 1,
            last_downloaded_at: nowSec() - 3600,
            slug: 'xauusd-london-ny-liquidity-sweep-wfo-2026',
            title: 'Nghiên Cứu Định Lượng XAU/USD: Cấu Trúc Quét Thanh Khoản Phiên London - New York & Kiểm Định Walk-Forward',
            subtitle: 'Phân tích vi cấu trúc M15/H1, phân rã kỳ vọng theo phiên và mô hình chi phí thực chiến',
            summary: 'Báo cáo định lượng chuyên sâu phân tích hiện tượng quét thanh khoản 20 nến trên XAU/USD.',
            market: 'XAUUSD',
            timeframe: 'M15 / H1',
            report_status: 'PUBLISHED',
            latest_catalog_version: 'v1.0',
            page_count: 18,
            download_url: '/api/v1/reports/rep_xauusd_london_ny_v1/download?version=v1.0',
            sample_pdf_url: '/api/v1/reports/rep_xauusd_london_ny_v1/sample-pdf',
          },
        ],
        reportOrders: [],
        billingOrders: [
          {
            id: 'ord_15e8e3467903',
            user_id: 'usr_001',
            user_email: 'car230698@gmail.com',
            payment_code: 'ZP15E8E3',
            amount_usd: 32.0,
            amount_vnd: 790000,
            expected_amount_vnd: 790000,
            paid_amount_vnd: 790000,
            locked_exchange_rate: 25730,
            plan_tier: 'report_pdf',
            cloud_slots_count: 1,
            status: 'PAID',
            payment_gateway: 'USDT_BEP20',
            created_at: nowSec() - 86400 * 2,
            paid_at: nowSec() - 86400 * 2 + 120,
            expires_at: nowSec() - 86400 * 2 + 1800,
          },
          {
            id: 'ord_b3432835ec32',
            user_id: 'usr_002',
            user_email: 'trader@propfirm.vn',
            payment_code: 'ZPB34328',
            amount_usd: 19.0,
            amount_vnd: 490000,
            expected_amount_vnd: 490000,
            locked_exchange_rate: 25730,
            plan_tier: 'report_pdf',
            cloud_slots_count: 1,
            status: 'PENDING',
            payment_gateway: 'USDT_TRC20',
            created_at: nowSec() - 600,
            expires_at: nowSec() + 1200,
          },
        ],
        referredBy: null as string | null,
      };
    }
    const ext = g.__zupirusExtendedState;

    const servePdfFile = (fileRel: string | undefined, downloadName: string, inline = true) => {
      const candidates = [
        fileRel ? path.resolve(process.cwd(), fileRel) : '',
        path.resolve(process.cwd(), 'web/public/reports_samples/zupirus-xauusd-london-ny-microstructure-v1.0-sample.pdf'),
        path.resolve(process.cwd(), 'data/guides/eurusd-h1-asia-london-preview.pdf'),
      ].filter(Boolean);
      for (const fp of candidates) {
        try {
          if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
            const buf = fs.readFileSync(fp);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${downloadName}"`);
            res.setHeader('Content-Length', String(buf.length));
            res.end(buf);
            return;
          }
        } catch {
          // try next candidate
        }
      }
      // Minimal valid PDF fallback if sample files were absent
      const minimalPdf = Buffer.from(
        '%PDF-1.4\n1 0 obj<<>>endobj\n2 0 obj<< /Type /Catalog /Pages 3 0 R >>endobj\n3 0 obj<< /Type /Pages /Kids [4 0 R] /Count 1 >>endobj\n4 0 obj<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] >>endobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000028 00000 n \n0000000077 00000 n \n0000000134 00000 n \ntrailer<< /Size 5 /Root 2 0 R >>\nstartxref\n204\n%%EOF\n',
        'utf-8'
      );
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${downloadName}"`);
      res.end(minimalPdf);
    };

    // Public & Customer Quant Reports Catalog & Library
    if ((pathname === '/api/v1/reports' || pathname === '/api/reports') && method === 'GET') {
      const market = (parsedUrl.searchParams.get('market') || '').trim().toUpperCase();
      let items = ext.reports.filter((r: any) => r.status === 'PUBLISHED');
      if (market) items = items.filter((r: any) => String(r.market || '').toUpperCase().includes(market));
      const enriched = items.map((r: any) => ({
        ...r,
        is_owned: ext.library.some((l: any) => l.report_id === r.id),
      }));
      return sendJson(res, 200, { items: enriched, count: enriched.length });
    }

    if (
      (pathname === '/api/v1/reports/my/library' ||
        pathname === '/api/v1/library/reports' ||
        pathname === '/api/reports/my/library') &&
      method === 'GET'
    ) {
      return sendJson(res, 200, {
        items: ext.library,
        count: ext.library.length,
        pending_orders: ext.reportOrders.filter((o: any) => o.status === 'PENDING'),
      });
    }

    const repSampleMatch = pathname.match(/^\/api\/(?:v1\/)?reports\/([^/]+)\/sample-pdf$/);
    if (repSampleMatch && method === 'GET') {
      const rid = decodeURIComponent(repSampleMatch[1]);
      const rep = ext.reports.find((r: any) => r.id === rid || r.slug === rid);
      return servePdfFile(rep?.sample_pdf_file, `${rep?.slug || rid}-sample.pdf`, true);
    }

    const repCheckoutMatch = pathname.match(/^\/api\/(?:v1\/)?reports\/([^/]+)\/checkout$/);
    if (repCheckoutMatch && method === 'POST') {
      const rid = decodeURIComponent(repCheckoutMatch[1]);
      const rep = ext.reports.find((r: any) => r.id === rid || r.slug === rid);
      if (!rep) return sendJson(res, 404, { detail: 'Không tìm thấy báo cáo.' });
      const body = await readJsonBody(req);
      const pm = String(body.payment_method || 'USDT_BEP20').toUpperCase();
      const network = pm.includes('TRC20') ? 'TRC20' : 'BEP20';
      const ordId = `ord_rep_${crypto.randomBytes(4).toString('hex')}`;
      const order = {
        id: ordId,
        order_id: ordId,
        order_code: `ZP-${ordId.slice(-6).toUpperCase()}`,
        report_id: rep.id,
        report_version: rep.current_version,
        title: rep.title,
        amount_usd: rep.price_usd,
        amount_vnd: rep.price_vnd,
        amount: rep.price_usd,
        currency: 'USDT',
        network,
        payment_gateway: `USDT_${network}`,
        wallet_address: network === 'TRC20' ? ext.cryptoWallets.trc20_address : ext.cryptoWallets.bep20_address,
        status: 'PENDING',
        created_at: nowSec(),
        expires_at: nowSec() + 1800,
      };
      ext.reportOrders.unshift(order);
      ext.billingOrders.unshift({ ...order, user_email: devSession?.email || 'trader@client.org', plan_tier: 'report_pdf', cloud_slots_count: 1 });
      return sendJson(res, 200, order);
    }

    const repDlTokMatch = pathname.match(/^\/api\/(?:v1\/)?reports\/([^/]+)\/download-token$/);
    if (repDlTokMatch && method === 'POST') {
      const rid = decodeURIComponent(repDlTokMatch[1]);
      const version = parsedUrl.searchParams.get('version') || 'v1.0';
      const tok = crypto.randomBytes(12).toString('hex');
      return sendJson(res, 200, {
        token: tok,
        report_id: rid,
        version,
        download_url: `/api/v1/reports/${encodeURIComponent(rid)}/download?version=${encodeURIComponent(version)}&token=${tok}`,
      });
    }

    const repDlMatch = pathname.match(/^\/api\/(?:v1\/)?reports\/([^/]+)\/download$/);
    if (repDlMatch && method === 'GET') {
      const rid = decodeURIComponent(repDlMatch[1]);
      const version = parsedUrl.searchParams.get('version') || 'v1.0';
      const rep = ext.reports.find((r: any) => r.id === rid || r.slug === rid);
      const libItem = ext.library.find((l: any) => l.report_id === (rep?.id || rid));
      if (libItem) {
        libItem.download_count = (libItem.download_count || 0) + 1;
        libItem.last_downloaded_at = nowSec();
      }
      return servePdfFile(rep?.full_pdf_file || rep?.sample_pdf_file, `${rep?.slug || rid}-${version}.pdf`, false);
    }

    const repDetailMatch = pathname.match(/^\/api\/(?:v1\/)?reports\/([^/]+)$/);
    if (repDetailMatch && method === 'GET') {
      const rid = decodeURIComponent(repDetailMatch[1]);
      const rep = ext.reports.find((r: any) => r.id === rid || r.slug === rid);
      if (!rep) return sendJson(res, 404, { detail: 'Không tìm thấy báo cáo.' });
      return sendJson(res, 200, {
        ...rep,
        is_owned: ext.library.some((l: any) => l.report_id === rep.id),
      });
    }

    // Admin Reports Publisher
    if (pathname === '/api/v1/admin/reports' && method === 'GET') {
      return sendJson(res, 200, {
        items: ext.reports,
        count: ext.reports.length,
        research_candidates: ext.strategyHistory.map((s: any) => ({ id: s.id, name: s.name, profit_factor: s.profit_factor })),
      });
    }
    if (pathname === '/api/v1/admin/reports' && method === 'POST') {
      const body = await readJsonBody(req);
      const id = `rep_${crypto.randomBytes(4).toString('hex')}`;
      const item = {
        id,
        slug: body.slug || `${String(body.market || 'xauusd').toLowerCase()}-${id}`,
        title: body.title || 'Báo cáo nghiên cứu định lượng mới',
        subtitle: body.subtitle || '',
        summary: body.summary || '',
        market: body.market || 'XAUUSD',
        timeframe: body.timeframe || 'M15 / H1',
        status: 'DRAFT',
        current_version: body.version || 'v1.0',
        price_vnd: Number(body.price_vnd) || 790000,
        price_usd: Number(body.price_usd) || 32.0,
        page_count: Number(body.page_count) || 18,
        highlights: Array.isArray(body.highlights_json) ? body.highlights_json : [],
        sample_pdf_url: `/api/v1/reports/${id}/sample-pdf`,
        published_at: null,
        updated_at: nowSec(),
      };
      ext.reports.unshift(item);
      return sendJson(res, 200, item);
    }
    const adminRepActionMatch = pathname.match(/^\/api\/v1\/admin\/reports\/([^/]+)\/(publish|discontinue|upload-pdf|preview-pdf)$/);
    if (adminRepActionMatch) {
      const rid = decodeURIComponent(adminRepActionMatch[1]);
      const action = adminRepActionMatch[2];
      const rep = ext.reports.find((r: any) => r.id === rid);
      if (action === 'preview-pdf' && method === 'GET') {
        return servePdfFile(rep?.full_pdf_file || rep?.sample_pdf_file, `${rid}-preview.pdf`, true);
      }
      if (action === 'upload-pdf' && method === 'POST') {
        if (rep) rep.updated_at = nowSec();
        return sendJson(res, 200, { ok: true, message: 'Đã gắn tệp PDF thành công.' });
      }
      if (action === 'publish' && method === 'POST') {
        if (rep) {
          rep.status = 'PUBLISHED';
          rep.published_at = nowSec();
          rep.updated_at = nowSec();
        }
        return sendJson(res, 200, { ok: true, status: 'PUBLISHED' });
      }
      if (action === 'discontinue' && method === 'POST') {
        if (rep) {
          rep.status = 'DISCONTINUED';
          rep.updated_at = nowSec();
        }
        return sendJson(res, 200, { ok: true, status: 'DISCONTINUED' });
      }
    }
    const adminRepItemMatch = pathname.match(/^\/api\/v1\/admin\/reports\/([^/]+)$/);
    if (adminRepItemMatch && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      const rid = decodeURIComponent(adminRepItemMatch[1]);
      const idx = ext.reports.findIndex((r: any) => r.id === rid);
      if (idx === -1) return sendJson(res, 404, { detail: 'Report not found' });
      if (method === 'DELETE') {
        ext.reports.splice(idx, 1);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readJsonBody(req);
      ext.reports[idx] = {
        ...ext.reports[idx],
        ...body,
        current_version: body.version || ext.reports[idx].current_version,
        highlights: Array.isArray(body.highlights_json) ? body.highlights_json : ext.reports[idx].highlights,
        updated_at: nowSec(),
      };
      return sendJson(res, 200, ext.reports[idx]);
    }

    // Billing Gateways, Crypto Wallets & Admin Billing Summary/Orders
    if (pathname === '/api/v1/billing/gateways' && method === 'GET') {
      return sendJson(res, 200, {
        sepay: false,
        usdt: ext.cryptoWallets.enabled,
        usdt_trc20: Boolean(ext.cryptoWallets.trc20_address),
        usdt_bep20: Boolean(ext.cryptoWallets.bep20_address),
        supported_currencies: ['USDT'],
      });
    }
    if (pathname === '/api/v1/billing/my-orders' && method === 'GET') {
      return sendJson(res, 200, { orders: ext.billingOrders });
    }
    const verifyTxMatch = pathname.match(/^\/api\/v1\/billing\/orders\/([^/]+)\/verify-tx$/);
    if (verifyTxMatch && method === 'POST') {
      const ordId = decodeURIComponent(verifyTxMatch[1]);
      const ts = nowSec();
      const repOrd = ext.reportOrders.find((o: any) => o.id === ordId);
      const billOrd = ext.billingOrders.find((o: any) => o.id === ordId);
      if (repOrd) {
        repOrd.status = 'PAID';
        repOrd.paid_at = ts;
      }
      if (billOrd) {
        billOrd.status = 'PAID';
        billOrd.paid_at = ts;
      }
      const ord = repOrd || billOrd;
      if (ord?.report_id && !ext.library.some((l: any) => l.report_id === ord.report_id)) {
        const rep = ext.reports.find((r: any) => r.id === ord.report_id);
        if (rep) {
          ext.library.unshift({
            entitlement_id: `ent_${crypto.randomBytes(4).toString('hex')}`,
            report_id: rep.id,
            purchased_version: rep.current_version,
            order_id: ord.id,
            order_code: ord.order_code,
            status: 'ACTIVE',
            granted_at: ts,
            download_count: 0,
            slug: rep.slug,
            title: rep.title,
            subtitle: rep.subtitle,
            summary: rep.summary,
            market: rep.market,
            timeframe: rep.timeframe,
            report_status: rep.status,
            latest_catalog_version: rep.current_version,
            page_count: rep.page_count,
            download_url: `/api/v1/reports/${rep.id}/download?version=${rep.current_version}`,
            sample_pdf_url: rep.sample_pdf_url,
          });
        }
      }
      return sendJson(res, 200, { ok: true, status: 'PAID', message: 'Đã xác nhận giao dịch USDT on-chain và mở khóa ấn phẩm PDF.' });
    }
    if (pathname === '/api/v1/admin/billing/crypto-wallets' && method === 'GET') {
      return sendJson(res, 200, ext.cryptoWallets);
    }
    if (pathname === '/api/v1/admin/billing/crypto-wallets' && method === 'PUT') {
      const body = await readJsonBody(req);
      ext.cryptoWallets = {
        enabled: body.enabled !== false,
        trc20_address: String(body.trc20_address || '').trim(),
        bep20_address: String(body.bep20_address || '').trim(),
        has_trc20: Boolean(body.trc20_address),
        has_bep20: Boolean(body.bep20_address),
      };
      return sendJson(res, 200, ext.cryptoWallets);
    }
    if (pathname === '/api/admin/billing/summary' && method === 'GET') {
      const paidOrders = ext.billingOrders.filter((o: any) => o.status === 'PAID');
      return sendJson(res, 200, {
        orders: {
          total_orders: ext.billingOrders.length,
          paid_orders: paidOrders.length,
          paid_revenue_vnd: paidOrders.reduce((s: number, o: any) => s + Number(o.amount_vnd || 0), 0),
          paid_revenue_usd: paidOrders.reduce((s: number, o: any) => s + Number(o.amount_usd || 0), 0),
        },
        total_revenue_vnd: paidOrders.reduce((s: number, o: any) => s + Number(o.amount_vnd || 0), 0),
      });
    }
    if (pathname === '/api/admin/billing/orders' && method === 'GET') {
      return sendJson(res, 200, { orders: ext.billingOrders, total: ext.billingOrders.length });
    }
    const adminOrderApproveMatch = pathname.match(/^\/api\/admin\/billing\/orders\/([^/]+)\/approve$/);
    if (adminOrderApproveMatch && method === 'POST') {
      const ordId = decodeURIComponent(adminOrderApproveMatch[1]);
      const ts = nowSec();
      const repOrd = ext.reportOrders.find((o: any) => o.id === ordId);
      const billOrd = ext.billingOrders.find((o: any) => o.id === ordId);
      if (repOrd) {
        repOrd.status = 'PAID';
        repOrd.paid_at = ts;
      }
      if (billOrd) {
        billOrd.status = 'PAID';
        billOrd.paid_at = ts;
      }
      const ord = repOrd || billOrd;
      if (ord?.report_id && !ext.library.some((l: any) => l.report_id === ord.report_id)) {
        const rep = ext.reports.find((r: any) => r.id === ord.report_id);
        if (rep) {
          ext.library.unshift({
            entitlement_id: `ent_${crypto.randomBytes(4).toString('hex')}`,
            report_id: rep.id,
            purchased_version: rep.current_version,
            order_id: ord.id,
            order_code: ord.order_code,
            status: 'ACTIVE',
            granted_at: ts,
            download_count: 0,
            slug: rep.slug,
            title: rep.title,
            subtitle: rep.subtitle,
            summary: rep.summary,
            market: rep.market,
            timeframe: rep.timeframe,
            report_status: rep.status,
            latest_catalog_version: rep.current_version,
            page_count: rep.page_count,
            download_url: `/api/v1/reports/${rep.id}/download?version=${rep.current_version}`,
            sample_pdf_url: rep.sample_pdf_url,
          });
        }
      }
      return sendJson(res, 200, { ok: true, message: `Đã duyệt đơn hàng ${ordId} thành công.` });
    }

    // Notifications & Referrals & Orders Export
    if (pathname === '/api/v1/notifications' && method === 'GET') {
      const unreadCount = ext.notifications.filter((n: any) => !n.read_at).length;
      return sendJson(res, 200, { ok: true, unread_count: unreadCount, notifications: ext.notifications });
    }
    if (pathname === '/api/v1/notifications/read-all' && method === 'POST') {
      const ts = nowSec();
      for (const n of ext.notifications) if (!n.read_at) n.read_at = ts;
      return sendJson(res, 200, { ok: true });
    }
    const notifReadMatch = pathname.match(/^\/api\/v1\/notifications\/([^/]+)\/read$/);
    if (notifReadMatch && method === 'POST') {
      const nid = decodeURIComponent(notifReadMatch[1]);
      const n = ext.notifications.find((x: any) => x.id === nid);
      if (n) n.read_at = nowSec();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/v1/referral/me' && method === 'GET') {
      return sendJson(res, 200, {
        referral_code: 'ZUP-QUANT26',
        invite_url: 'https://zupirus.com/?ref=ZUP-QUANT26',
        referred_count: 2,
        bonus_days_earned: 14,
        referred_by: ext.referredBy,
        reward_rule: 'Phần thưởng giới thiệu do chủ sở hữu cấu hình, không phải lợi nhuận giao dịch.',
      });
    }
    if (pathname === '/api/v1/referral/apply' && method === 'POST') {
      const body = await readJsonBody(req);
      ext.referredBy = String(body.code || '').trim().toUpperCase();
      return sendJson(res, 200, { ok: true, code: ext.referredBy, message: 'Áp dụng mã giới thiệu thành công!' });
    }
    if (pathname === '/api/v1/orders/export' && method === 'GET') {
      const header = 'id,account_id,signal_id,side,lot,price,sl,tp,pnl,state,ticket\n';
      const rows = orders
        .map((o) => `${o.id},${o.account_id},${o.signal_id},${o.side},${o.lot || 0.1},${o.price},${o.sl},${o.tp},${o.pnl},${o.state},${o.ticket}`)
        .join('\n');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="zupirus_orders.csv"');
      res.end(header + rows);
      return;
    }

    // Admin Command Radar, Agents Heartbeat, AI Quota, Strategies & AI Evolution
    if (pathname === '/api/v1/telemetry/admin-radar' && method === 'GET') {
      const mid = prices[replayIdx] || 2656.45;
      return sendJson(res, 200, {
        halted,
        health_cards: [
          { key: 'market_data', title: 'Dữ liệu thị trường XAU/USD', ok: true, status_text: `Đang cập nhật (${mid.toFixed(2)})` },
          { key: 'ai_swarm', title: 'Bộ não AI Swarm & WFO', ok: true, status_text: `Đang hoạt động (${mockGeminiKeys.filter((k) => k.is_active).length} Key)` },
          { key: 'reports_vault', title: 'Kho Báo cáo & Kiểm định PDF', ok: true, status_text: `Sẵn sàng (${ext.reports.length} ấn phẩm)` },
          { key: 'usdt', title: 'Cổng thanh toán USDT on-chain', ok: true, status_text: 'Mặc định (An toàn)' },
        ],
        timeline: [
          { ts: nowSec() - 90, text: 'AI quét nến M15 XAUUSD: Biến động ổn định trong biên độ London/NY.', kind: 'info' },
          { ts: nowSec() - 320, text: 'Hoàn tất kiểm định Walk-Forward 120/60 ngoài mẫu (PF 1.74).', kind: 'success' },
        ],
        alerts: [],
        server_time: nowSec(),
        auto_promote: ext.autoPromote,
        signal_mode: ext.signalMode,
        active_strategy: 'Alpha Quant XAU M15 v1.0',
        canary_strategy: ext.strategyQueue[0]?.candidate?.name || null,
        regime: 'TRENDING',
        meta_router_scale: 1.0,
        dxy_trend: 'FLAT',
        macro_degraded: false,
        circuit_breaker_active: false,
        unverified_count: 0,
      });
    }
    if (
      (pathname === '/api/v1/telemetry/dry-run' || pathname === '/api/v1/telemetry/admin-radar/dry-run') &&
      (method === 'POST' || method === 'GET')
    ) {
      const mid = prices[replayIdx] || 2656.45;
      return sendJson(res, 200, {
        ok: true,
        timestamp: nowSec(),
        steps: [
          { step: '1. Dữ liệu thị trường XAU/USD', ok: true, detail: `Giá tham chiếu ${mid.toFixed(2)} (spread 2.8 pips)` },
          { step: '2. Bộ não AI Swarm', ok: true, detail: 'Sentinel blackout=false | Cycle hoàn tất an toàn.' },
          { step: '3. Kiểm tra 4 lớp màng lọc an toàn', ok: true, detail: '4 lớp màng lọc hoạt động chuẩn.' },
          { step: '4. Kho lưu trữ & Báo cáo PDF', ok: true, detail: `Kho báo cáo hoạt động tốt · ${ext.reports.length} ấn phẩm.` },
        ],
      });
    }
    if (pathname === '/api/admin-radar/retry-pending' && method === 'POST') {
      return sendJson(res, 200, { ok: true, redeployed: 0, message: 'Không có tác vụ chờ xử lý.' });
    }
    if (pathname === '/api/v1/telemetry/ai-evolution' && method === 'GET') {
      return sendJson(res, 200, {
        stage: {
          active_mode: ext.signalMode,
          auto_promote: ext.autoPromote,
          samples_learned: 242,
          target_samples: 500,
          readiness_pct: 48.4,
        },
        shadow_summary: {
          total_evaluated: 242,
          total_open: 3,
          overall_win_rate_pct: 61.2,
          sources: [
            { id: 'src_london_alpha', name: 'London Institutional Orderflow', source_type: 'METAAPI_STREAM', status: 'ACTIVE_LIVE', trust_score: 91.4, win_rate_pct: 64.0, profit_factor: 1.88, evaluated_signals: 112, open_signals: 1 },
            { id: 'src_tv_quant_m15', name: 'ZUPIRUS M15 Volatility Breakout', source_type: 'TRADINGVIEW_WEBHOOK', status: 'ACTIVE_LIVE', trust_score: 86.8, win_rate_pct: 59.5, profit_factor: 1.65, evaluated_signals: 130, open_signals: 2 },
          ],
        },
        hindsight_lessons: mockHindsightMemories.map((m) => ({
          id: m.id,
          category: m.category,
          content: m.content,
          confidence: 0.88,
          created_at: nowSec() - 3600,
        })),
        wfo_candidates: ext.strategyQueue.map((q: any) => ({
          id: q.candidate.id,
          name: q.candidate.name,
          status: 'WAITING_APPROVAL',
          win_rate_pct: Number((q.candidate.win_rate * 100).toFixed(1)),
          profit_factor: q.candidate.profit_factor,
          sharpe_ratio: 1.85,
          max_drawdown_pct: q.candidate.max_drawdown_pct,
          sample_size: q.candidate.sample_size,
        })),
        skills_builtin: [
          { skill_id: 'market_regime_scanner', name: 'Market Regime Scanner', description: 'Phân loại Trend/Range theo ATR(14)', trigger_condition: 'Mỗi đóng nến M15', is_builtin: true, enabled: true, usage_count: 342 },
          { skill_id: 'macro_news_interpreter', name: 'Macro News Shield', description: 'Chặn vùng tin đỏ USD ±15 phút', trigger_condition: 'Trước phiên NY/FOMC', is_builtin: true, enabled: true, usage_count: 210 },
        ],
        skills_learned: [
          { skill_id: 'learned_london_buy_filter', name: 'London Liquidity Sweep Filter', description: 'Lọc điểm đảo chiều quét thanh khoản 20 nến', trigger_condition: 'Phiên London 07:00-13:00 UTC', is_builtin: false, enabled: true, usage_count: 47 },
        ],
      });
    }
    if (pathname === '/api/admin/agents/heartbeat' && method === 'GET') {
      return sendJson(res, 200, { total: ext.agentsHeartbeat.length, agents: ext.agentsHeartbeat });
    }
    const agentWakeMatch = pathname.match(/^\/api\/admin\/agents\/([^/]+)\/wake$/);
    if (agentWakeMatch && method === 'POST') {
      const aid = decodeURIComponent(agentWakeMatch[1]);
      const ag = ext.agentsHeartbeat.find((a: any) => a.id === aid);
      if (ag) {
        ag.last_run_at = nowSec();
        ag.calls_today += 1;
      }
      return sendJson(res, 200, { ok: true, message: `Đã kích hoạt agent ${aid} thành công.` });
    }
    const agentPauseMatch = pathname.match(/^\/api\/admin\/agents\/([^/]+)\/toggle-pause$/);
    if (agentPauseMatch && method === 'POST') {
      const aid = decodeURIComponent(agentPauseMatch[1]);
      const ag = ext.agentsHeartbeat.find((a: any) => a.id === aid);
      if (ag) {
        ag.is_paused = !ag.is_paused;
        ag.status = ag.is_paused ? 'PAUSED' : 'IDLE';
      }
      return sendJson(res, 200, {
        ok: true,
        agent_id: aid,
        is_paused: Boolean(ag?.is_paused),
        status: ag?.status || 'IDLE',
        message: ag?.is_paused ? `Đã tạm dừng agent ${aid}.` : `Đã tiếp tục agent ${aid}.`,
      });
    }
    if (pathname === '/api/admin/ai/quota' && method === 'GET') {
      return sendJson(res, 200, ext.aiQuota);
    }
    if (pathname === '/api/admin/ai/quota' && method === 'PUT') {
      const body = await readJsonBody(req);
      if (body.reset_today) {
        ext.aiQuota.calls_today = 0;
        ext.aiQuota.usage_pct = 0;
      }
      if (typeof body.daily_cap === 'number') ext.aiQuota.daily_cap = body.daily_cap;
      if (typeof body.override_minutes === 'number') {
        ext.aiQuota.is_overridden = true;
        ext.aiQuota.override_until = nowSec() + body.override_minutes * 60;
      }
      return sendJson(res, 200, ext.aiQuota);
    }
    if (pathname === '/api/admin/gemini/keys/ping-all' && method === 'POST') {
      return sendJson(res, 200, { ok: true, message: `Đã kiểm tra ${mockGeminiKeys.filter((k) => k.is_active).length} Gemini key hoạt động bình thường.` });
    }
    if (pathname === '/api/admin/skills/ingested' && method === 'GET') {
      return sendJson(res, 200, { skills: ext.ingestedSkills, ingested_skills: ext.ingestedSkills });
    }
    if (pathname === '/api/admin/skills/ingest-pdf' && method === 'POST') {
      const newSkill = {
        skill_id: `ing_${crypto.randomBytes(4).toString('hex')}`,
        name: 'Tài liệu định lượng mới nạp',
        category: 'macro',
        detected_category: 'macro',
        chunks_count: 8,
        created_at: nowSec(),
        summary: 'Đã bóc tách và lập chỉ mục vào kho tri thức RAG.',
      };
      ext.ingestedSkills.unshift(newSkill);
      return sendJson(res, 200, { ok: true, ...newSkill });
    }
    if (pathname === '/api/admin/skills/reclassify-all' && method === 'POST') {
      return sendJson(res, 200, { ok: true, reclassified_count: ext.ingestedSkills.length });
    }
    const delIngestedMatch = pathname.match(/^\/api\/admin\/skills\/ingested\/([^/]+)$/);
    if (delIngestedMatch && method === 'DELETE') {
      const sid = decodeURIComponent(delIngestedMatch[1]);
      const idx = ext.ingestedSkills.findIndex((s: any) => s.skill_id === sid);
      if (idx !== -1) ext.ingestedSkills.splice(idx, 1);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/sources/signal-mode' && method === 'POST') {
      const body = await readJsonBody(req);
      if (body.mode) ext.signalMode = body.mode;
      return sendJson(res, 200, { ok: true, mode: ext.signalMode });
    }
    if ((pathname === '/api/admin/sources/auto-promote' || pathname === '/api/sources/auto-promote') && method === 'POST') {
      const body = await readJsonBody(req);
      ext.autoPromote = Boolean(body.enabled);
      return sendJson(res, 200, {
        ok: true,
        enabled: ext.autoPromote,
        message: ext.autoPromote ? 'Đã BẬT tự động thăng hạng chiến lược.' : 'Đã TẮT tự động thăng hạng chiến lược.',
      });
    }
    if (pathname === '/api/admin/strategies/review-queue' && method === 'GET') {
      return sendJson(res, 200, { total: ext.strategyQueue.length, queue: ext.strategyQueue });
    }
    if (pathname === '/api/admin/strategies/history' && method === 'GET') {
      return sendJson(res, 200, { total: ext.strategyHistory.length, strategies: ext.strategyHistory });
    }
    const stratDecisionMatch = pathname.match(/^\/api\/admin\/strategies\/([^/]+)\/(approve|reject|rollback)$/);
    if (stratDecisionMatch && method === 'POST') {
      const cid = decodeURIComponent(stratDecisionMatch[1]);
      const action = stratDecisionMatch[2];
      const qIdx = ext.strategyQueue.findIndex((q: any) => q.candidate.id === cid);
      if (qIdx !== -1 && (action === 'approve' || action === 'reject')) {
        const item = ext.strategyQueue.splice(qIdx, 1)[0];
        ext.strategyHistory.unshift({
          id: item.candidate.id,
          name: item.candidate.name,
          status: action === 'approve' ? 'APPROVED_FOR_PROD' : 'REJECTED',
          win_rate_pct: Number((item.candidate.win_rate * 100).toFixed(1)),
          profit_factor: item.candidate.profit_factor,
          sharpe_ratio: 1.85,
          max_drawdown_pct: item.candidate.max_drawdown_pct,
          sample_size: item.candidate.sample_size,
          rules: item.candidate.rules,
          created_at: nowSec() - 3600,
          updated_at: nowSec(),
        });
      }
      return sendJson(res, 200, { ok: true, message: `Đã xử lý chiến lược ${cid} (${action}).` });
    }

    if (pathname === '/api/v1/stream/topbar' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const mid = prices[replayIdx] || 2656.45;
      const snap = {
        xauusd: {
          symbol: 'XAUUSD',
          bid: Number((mid - 0.14).toFixed(2)),
          ask: Number((mid + 0.14).toFixed(2)),
          mid: Number(mid.toFixed(2)),
          spread_pips: 2.8,
          live: true,
          data_available: true,
          stale: false,
          source: 'DEV_FIXTURE',
        },
        usd_vnd: { rate: 25730, source: 'Vietcombank Live' },
        news_shield: { status: 'CLEAR', distance_mins: 185, nearest_title: 'US Core CPI (MoM)' },
        metaapi_latency_ms: 28,
        region: 'london-g2',
        active_sources_count: 2,
        system_status: halted ? 'HALTED' : 'NOMINAL',
        server_time: nowSec(),
      };
      res.write(`event: topbar\ndata: ${JSON.stringify(snap)}\n\n`);
      res.end();
      return;
    }
    if ((pathname === '/api/v1/stream/user' || pathname === '/api/v1/stream/admin') && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      res.end();
      return;
    }

    return sendJson(res, 404, { detail: `Endpoint not found: ${method} ${pathname}` });
  };

  return {
    name: 'zupirus-quant-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        apiMiddleware(req, res, next).catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        apiMiddleware(req, res, next).catch(next);
      });
    },
  };
}
