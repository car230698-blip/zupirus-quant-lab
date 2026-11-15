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
      price: 2658.4,
      sl: 2652.4,
      tp: 2670.4,
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
      price: 2654.15,
      sl: 2648.15,
      tp: 2666.15,
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
      price: 2661.8,
      sl: 2667.8,
      tp: 2649.8,
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
      price: 2649.2,
      sl: 2655.2,
      tp: 2637.2,
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
      return sendJson(res, 200, { email: 'admin@zupirus.local', role: 'admin' });
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { email: body.email || 'admin@zupirus.local', role: 'admin' });
    }
    if (pathname === '/api/register' && method === 'POST') {
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && method === 'POST') {
      return sendJson(res, 200, { ok: true });
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
