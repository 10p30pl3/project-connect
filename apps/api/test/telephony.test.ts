/** Fase 4: área Telefonia — a API repassa ao gateway de voz sem expor o token ao navegador. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPool, one, closePool } from '../src/db/pool.js';
import { api, login, makeApp, resetDb, type Api } from './helpers.js';

let app: FastifyInstance;
let a: Api;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  a = api(app, await login(app));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function configureGateway() {
  const ws = await one(getPool(), `SELECT id FROM workspaces LIMIT 1`);
  await getPool().query(
    `INSERT INTO workspace_channel_endpoints (workspace_id, config) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET config = EXCLUDED.config`,
    [ws.id, { voice: { voiceAppBaseUrl: 'http://gateway.test:8090/', voiceAppToken: 'tok-svc' } }],
  );
}

describe('telefonia (proxy do gateway de voz)', () => {
  it('sem gateway configurado responde 409 com orientação', async () => {
    const r = await a.get('/telephony/calls');
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/não configurado/);
  });

  it('lista chamadas ao vivo com o token de serviço só no servidor', async () => {
    await configureGateway();
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ count: 1, calls: [{ callId: 'c1' }] }) } as any;
    }) as any;
    const r = await a.get('/telephony/calls');
    expect(r.status).toBe(200);
    expect(r.body.calls[0].callId).toBe('c1');
    expect(calls[0].url).toBe('http://gateway.test:8090/v1/calls');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-svc');
    expect(JSON.stringify(r.body)).not.toContain('tok-svc');
  });

  it('gateway fora do ar vira 502 legível', async () => {
    await configureGateway();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as any;
    const r = await a.get('/telephony/status');
    expect(r.status).toBe(502);
    expect(r.body.detail).toMatch(/ECONNREFUSED/);
  });

  it('encerrar chamada exige perfil de operação e fica auditado', async () => {
    await configureGateway();
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, command: 'hangup' }) })) as any;
    const analyst = api(app, await login(app, 'analista@voll.local'));
    expect((await analyst.post('/telephony/calls/c1/hangup', { reason: 'teste' })).status).toBe(403);
    const r = await a.post('/telephony/calls/c1/hangup', { reason: 'Cliente pediu' });
    expect(r.status).toBe(200);
    const log = await one(getPool(), `SELECT action, reason FROM audit_log WHERE entity='call' AND entity_id='c1'`);
    expect(log).toEqual({ action: 'telephony.hangup', reason: 'Cliente pediu' });
  });
});
