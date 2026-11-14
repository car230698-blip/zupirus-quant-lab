import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type express from 'express';

const LINK_TTL_MS = 10 * 60_000;
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function identity(body: { login?: unknown; server?: unknown; mode?: unknown }) {
  const { login, server, mode } = body ?? {};
  if (mode !== 'DEMO' || typeof login !== 'string' || !/^[1-9]\d{0,19}$/.test(login) ||
      typeof server !== 'string' || !server.trim() || server.length > 128) return null;
  return { login, server: server.trim() };
}

export function registerDemoCopyRoutes(
  app: express.Express,
  dataDir: string,
  requireAdmin: express.RequestHandler
) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'copy-demo.sqlite'), { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS copy_links (
      id TEXT PRIMARY KEY,
      pairing_hash TEXT UNIQUE,
      expires_at INTEGER NOT NULL,
      ea_hash TEXT UNIQUE,
      login TEXT,
      server TEXT,
      last_seen INTEGER,
      balance REAL,
      equity REAL,
      UNIQUE(server, login)
    );
  `);

  app.post('/api/control/copy-demo/links', requireAdmin, (_req, res) => {
    const pairingCode = secret();
    const id = randomUUID();
    const expiresAt = Date.now() + LINK_TTL_MS;
    db.prepare('INSERT INTO copy_links (id, pairing_hash, expires_at) VALUES (?, ?, ?)')
      .run(id, digest(pairingCode), expiresAt);
    res.set('Cache-Control', 'no-store').status(201).json({ id, pairingCode, expiresAt });
  });

  app.get('/api/control/copy-demo/links/:id', requireAdmin, (req, res) => {
    const link = db.prepare(`
      SELECT id, login, server, last_seen AS lastSeen, balance, equity
      FROM copy_links WHERE id = ?
    `).get(req.params.id);
    if (!link) return res.status(404).json({ error: 'LINK_NOT_FOUND' });
    return res.set('Cache-Control', 'no-store').json(link);
  });

  app.post('/api/copy-demo/pair', (req, res) => {
    const account = identity(req.body);
    const code = req.body?.pairingCode;
    if (!account || typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID_DEMO_PAIRING' });
    }
    const now = Date.now();
    const eaToken = secret();
    const linked = db.prepare(`
      UPDATE copy_links
      SET pairing_hash = NULL, ea_hash = ?, login = ?, server = ?, last_seen = ?
      WHERE pairing_hash = ? AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM copy_links WHERE login = ? AND server = ?)
      RETURNING id
    `).get(digest(eaToken), account.login, account.server, now, digest(code), now,
      account.login, account.server);
    if (!linked) return res.status(409).json({ error: 'PAIRING_UNAVAILABLE' });
    return res.set('Cache-Control', 'no-store').json({ id: linked.id, eaToken });
  });

  app.post('/api/copy-demo/heartbeat', (req, res) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') ?? '')?.[1];
    if (!token) return res.status(401).json({ error: 'EA_TOKEN_REQUIRED' });
    const account = identity(req.body);
    const { balance, equity } = req.body ?? {};
    if (!account || typeof balance !== 'number' || typeof equity !== 'number' ||
        !Number.isFinite(balance) || !Number.isFinite(equity)) {
      return res.status(400).json({ error: 'INVALID_DEMO_HEARTBEAT' });
    }
    const result = db.prepare(`
      UPDATE copy_links SET last_seen = ?, balance = ?, equity = ?
      WHERE ea_hash = ? AND login = ? AND server = ?
    `).run(Date.now(), balance, equity, digest(token), account.login, account.server);
    if (!result.changes) return res.status(403).json({ error: 'EA_ACCOUNT_MISMATCH' });
    return res.status(204).end();
  });

  return {
    db,
    close: () => {
      try {
        db.close();
      } catch {}
    },
  };
}
