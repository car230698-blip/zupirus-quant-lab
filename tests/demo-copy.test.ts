import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import express from 'express';
import { createAuthMiddleware } from '../src/server/authMiddleware.ts';
import { registerDemoCopyRoutes } from '../src/server/demoCopyRoutes.ts';

it('links a demo EA once and persists only matching account telemetry across server restarts', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zup-copy-demo-'));
  const adminToken = 'copy-fixture-admin-only';
  async function start() {
    const app = express();
    app.use(express.json());
    const auth = createAuthMiddleware({ strictAuth: true, adminToken });
    registerDemoCopyRoutes(app, directory, auth.requireRoles(['ADMIN'], true));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return { server, baseUrl: 'http://127.0.0.1:' + address.port };
  }
  let { server, baseUrl } = await start();
  const call = (route: string, body?: object, token?: string) => fetch(baseUrl + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body && JSON.stringify(body),
  });
  try {
    const links = '/api/control/copy-demo/links';
    assert.equal((await call(links, {})).status, 401);
    const created = await call(links, {}, adminToken);
    assert.equal(created.status, 201);
    const { id, pairingCode } = await created.json();
    const account = { login: '135792468', server: 'Broker-Demo', mode: 'DEMO', pairingCode };
    const pair = '/api/copy-demo/pair';
    assert.equal((await call(pair, { ...account, mode: 'REAL' })).status, 400);
    const linked = await call(pair, account);
    assert.equal(linked.status, 200);
    const { eaToken } = await linked.json();
    assert.equal((await call(pair, account)).status, 409);
    const heartbeat = '/api/copy-demo/heartbeat';
    const snapshot = { ...account, equity: 321.05, balance: 333 };
    assert.equal((await call(heartbeat, { ...snapshot, login: '100' }, eaToken)).status, 403);
    assert.equal((await call(heartbeat, snapshot, eaToken)).status, 204);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    ({ server, baseUrl } = await start());
    assert.equal((await call(links + '/' + id, undefined, eaToken)).status, 401);
    const state = await (await call(links + '/' + id, undefined, adminToken)).json();
    assert.equal(state.balance, 333);
    assert.equal(state.equity, 321.05);
    assert.equal(state.login, account.login);
    assert.equal(state.eaToken, undefined);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
