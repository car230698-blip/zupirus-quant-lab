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
    if (pathname === '/api/v1/telemetry/topbar' && method === 'GET') {
      const mid = prices[replayIdx] || 2656.45;
      return sendJson(res, 200, {
        xauusd: {
          symbol: 'XAUUSD',
          bid: Number((mid - 0.14).toFixed(2)),
          ask: Number((mid + 0.14).toFixed(2)),
          mid: Number(mid.toFixed(2)),
          spread_pips: 2.8,
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
        service_expires_at: nowSec() + 86400 * 26,
        max_mt5_accounts: 5,
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
        account_number: '105887054819',
        account_holder: 'LE NGUYEN NHU THUY',
        payment_content: memo,
        status: 'PENDING',
        expires_at: nowSec() + 1200,
      });
    }

    if (pathname.startsWith('/api/v1/billing/orders/') && method === 'GET') {
      const ordId = pathname.split('/').pop() || 'ord_demo';
      return sendJson(res, 200, {
        id: ordId,
        status: 'PAID',
        paid_at: nowSec(),
      });
    }

    if (pathname === '/api/admin/billing/settings' && method === 'GET') {
      return sendJson(res, 200, {
        bank_name: 'VietinBank',
        account_number: '105887054819',
        account_holder: 'LE NGUYEN NHU THUY',
        content_prefix: 'ZP',
        fx_mode: 'AUTO',
        manual_fx_rate: 25730,
        current_fx_rate: 25730,
        fx_source: 'Vietcombank Live',
        supported_banks: [
          { shortName: 'VietinBank', name: 'Ngân hàng TMCP Công Thương Việt Nam (ICB)' },
          { shortName: 'Vietcombank', name: 'Ngân hàng TMCP Ngoại Thương Việt Nam (VCB)' },
          { shortName: 'MBBank', name: 'Ngân hàng TMCP Quân Đội (MB)' },
          { shortName: 'Techcombank', name: 'Ngân hàng TMCP Kỹ Thương Việt Nam (TCB)' },
        ],
      });
    }

    if (pathname === '/api/admin/billing/settings' && method === 'POST') {
      return sendJson(res, 200, {
        ok: true,
        message: 'Đã lưu cấu hình cổng thanh toán SePay VietQR & Tỷ giá thành công.',
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
    if (pathname === '/api/v1/signals/audit-logs' && method === 'GET') {
      return sendJson(res, 200, {
        audit_logs: [
          {
            id: 'aud_01',
            signal_id: 'sig_xau_london_901',
            source_name: 'London Institutional Feed',
            strategy_tier: 'ALPHA',
            side: 'BUY',
            symbol: 'XAUUSD',
            entry_price: 2654.2,
            stop_loss: 2648.5,
            status: 'APPROVED',
            reject_reason: 'Passed all 4 safety guards (Idempotency, Mandatory SL, News Shield, Spread 2.6p)',
            pnl: 142.5,
            mae: -1.4,
            mfe: 9.8,
            context_snapshot: {
              session: 'LONDON_NY_OVERLAP',
              atr_14: 4.15,
              spread_pips: 2.6,
              news_distance_mins: 185,
            },
          },
          {
            id: 'aud_02',
            signal_id: 'sig_xau_tv_884',
            source_name: 'TradingView Webhook Pro',
            strategy_tier: 'GROWTH',
            side: 'SELL',
            symbol: 'XAUUSD',
            entry_price: 2661.8,
            stop_loss: 2667.8,
            status: 'APPROVED',
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
            signal_id: 'sig_ext_unverified_402',
            source_name: 'Shadow Candidate #04',
            strategy_tier: 'SHADOW',
            side: 'BUY',
            symbol: 'XAUUSD',
            entry_price: 2659.0,
            stop_loss: null,
            status: 'REJECTED',
            reject_reason: 'Guard #02 Triggered: Missing Mandatory Hard Stop-Loss',
            pnl: null,
            context_snapshot: {
              session: 'ASIAN_RANGE',
              atr_14: 2.4,
              spread_pips: 3.1,
              news_distance_mins: 410,
            },
          },
        ],
      });
    }

    if (pathname === '/api/v1/signals/stats' && method === 'GET') {
      return sendJson(res, 200, {
        total_audited: 128,
        approved_count: 114,
        rejected_count: 14,
      });
    }

    if (pathname === '/api/v1/signals/test-ingest' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        ok: true,
        signal_id: 'sig_test_' + crypto.randomBytes(3).toString('hex'),
        symbol: body.symbol || 'XAUUSD',
        action: body.action || 'BUY',
        guards_evaluated: {
          redis_idempotency_lock: 'PASS (<0.8ms)',
          mandatory_sl_guard: 'AUTO_ATTACHED_ATR_SL ($2,674.80)',
          live_news_shield: 'PASS (No USD Red News within ±15m)',
          spread_slippage_guard: 'PASS (2.7 pips <= 4.5 pips max)',
        },
        status: 'APPROVED_FOR_DISPATCH',
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
