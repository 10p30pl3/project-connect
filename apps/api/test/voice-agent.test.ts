/** Fase 3: agente de voz cadastrado na Conexão do Voll Plan e publicado no gateway como tenant. */
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPool, one, closePool } from '../src/db/pool.js';
import { voiceAppAdapter } from '../src/connectors/voice-app.js';
import { reconcileVoiceAgents } from '../src/modules/voice-agent.js';
import { api, login, makeApp, resetDb, type Api } from './helpers.js';

const require = createRequire(import.meta.url);
const gateway = require('../../voice-gateway/utils/voll-contract.js') as {
  validateAgentTenant(body: unknown): { ok: boolean; errors: string[] };
  validateCallRequest(body: unknown): { ok: boolean; errors: string[] };
  checkOrderAgainstTenant(order: any, tenant: any): null | { status: number; error: string };
};

const agent = {
  name: 'Agente cobrança D+5',
  engine: 'openai',
  openaiModel: 'gpt-realtime-mini',
  voice: 'marin',
  instructions: 'Você é o assistente de cobrança da Voll Solutions. Confirme o titular antes de falar do débito.',
  greeting: 'Olá, aqui é da Voll Solutions.',
  maxDurationSec: 240,
  amd: { enabled: true, mode: 'active' },
  stt: { enabled: true },
  bargeinLevel: 3,
  defaultCallerId: '+551130001000',
  allowedCallerIds: ['+551130001000', '+551130001001'],
};

let app: FastifyInstance;
let a: Api;
let connId: string;
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
  const c = await one(getPool(), `SELECT id FROM connections WHERE provider='VOICE_APP' LIMIT 1`);
  connId = c.id;
  await getPool().query(
    `UPDATE connections SET active=true, config = config || '{"voiceAppBaseUrl":"http://gateway.test:8090","voiceAppToken":"tok-123"}'::jsonb WHERE id=$1`,
    [connId],
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockGateway(status = 200) {
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { status, ok: status < 300, json: async () => (status < 300 ? { ok: true } : { error: 'boom' }) } as any;
  }) as any;
  return calls;
}

async function sendAttempt() {
  const conn = await one(getPool(), `SELECT id, provider, config, channel_type, webhook_secret FROM connections WHERE id=$1`, [connId]);
  const fakeDb: any = {
    query: async () => ({
      rows: [
        {
          workspace_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
          campaign_id: '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9',
          contact_name: 'Ana',
          contact_ext_id: '001',
          contact_attrs: {},
          tabulation_rules: { CONVERSION: 'FINISH_SUCCESS' },
        },
      ],
    }),
  };
  return voiceAppAdapter.send(fakeDb, {
    attempt: { id: '7d1c3f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', destination_address: '+5511988887777', channel_type: 'VOICE', trace_id: 't-1' },
    connection: conn,
  });
}

describe('agente de voz (cadastro único)', () => {
  it('valida o cadastro: caller ID padrão precisa estar entre os autorizados', async () => {
    const r = await a.put(`/connections/${connId}/voice-agent`, { ...agent, defaultCallerId: '+551199990000' });
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.defaultCallerId).toMatch(/autorizados/);
  });

  it('salva versão, publica no gateway dentro do contrato e só então libera o envio', async () => {
    const saved = await a.put(`/connections/${connId}/voice-agent`, agent);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 1, syncedVersion: null, inSync: false });

    // sem publicar, o adaptador não liga
    mockGateway(202);
    const blocked = await sendAttempt();
    expect(blocked.status).toBe('REJECTED');
    expect((blocked as any).reason).toMatch(/VOICE_AGENT_NOT_SYNCED/);

    const calls = mockGateway(200);
    const sync = await a.post(`/connections/${connId}/voice-agent/sync`);
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ published: true, inSync: true, syncedVersion: 1 });
    expect(calls[0].url).toBe(`http://gateway.test:8090/v1/tenants/${connId}`);
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-123');
    const tenant = JSON.parse(calls[0].init.body);
    // CONTRATO: o gateway aceita exatamente o que o Voll Plan publica, sem credenciais
    expect(gateway.validateAgentTenant(tenant)).toEqual({ ok: true, errors: [] });
    expect(tenant).not.toHaveProperty('openaiApiKey');

    // com o agente publicado, a ordem usa a conexão como tenant, a versão e o caller ID do agente
    const orders = mockGateway(202);
    const sent = await sendAttempt();
    expect(sent.status).toBe('ACCEPTED');
    const order = JSON.parse(orders[0].init.body);
    expect(order).toMatchObject({ tenantId: connId, agentVersion: 1, callerId: '+551130001000', limits: { maxDurationSec: 240 } });
    expect(gateway.validateCallRequest(order).ok).toBe(true);
    expect(gateway.checkOrderAgainstTenant(order, tenant)).toBeNull();

    // nova versão volta a bloquear até publicar
    const v2 = await a.put(`/connections/${connId}/voice-agent`, { ...agent, voice: 'cedar' });
    expect(v2.body).toMatchObject({ version: 2, syncedVersion: 1, inSync: false });
    mockGateway(202);
    expect((await sendAttempt()).status).toBe('REJECTED');
  });

  it('falha de publicação fica registrada e não marca como sincronizado', async () => {
    await a.put(`/connections/${connId}/voice-agent`, agent);
    mockGateway(500);
    const sync = await a.post(`/connections/${connId}/voice-agent/sync`);
    expect(sync.body).toMatchObject({ published: false, inSync: false });
    expect(sync.body.syncError).toMatch(/HTTP 500/);
    const audit = await one(getPool(), `SELECT action FROM audit_log WHERE entity_id=$1 ORDER BY id DESC LIMIT 1`, [connId]);
    expect(audit.action).toBe('voice_agent.sync_failed');
  });

  it('gateway recusando versão diferente vira rejeição, não reconciliação', async () => {
    await a.put(`/connections/${connId}/voice-agent`, agent);
    mockGateway(200);
    await a.post(`/connections/${connId}/voice-agent/sync`);
    globalThis.fetch = vi.fn(async () => ({
      status: 409,
      ok: false,
      json: async () => ({ error: 'agent_version_mismatch', message: 'Agente na versão 0; ordem pede 1' }),
    })) as any;
    const r = await sendAttempt();
    expect(r.status).toBe('REJECTED');
    expect((r as any).reason).toMatch(/AGENT_VERSION_MISMATCH/);
  });

  it('perfil Analista não altera o agente', async () => {
    const analyst = api(app, await login(app, 'analista@voll.local'));
    expect((await analyst.put(`/connections/${connId}/voice-agent`, agent)).status).toBe(403);
  });

  it('reconciliação: agente que sumiu do gateway é republicado; versão nova não publicada fica esperando', async () => {
    await a.put(`/connections/${connId}/voice-agent`, agent);
    mockGateway(200);
    await a.post(`/connections/${connId}/voice-agent/sync`);

    // gateway reiniciou sem o tenant: GET 404 -> PUT da versão publicada
    const seen: { method: string; body?: any }[] = [];
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      seen.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (!init?.method || init.method === 'GET') return { ok: false, status: 404, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
    }) as any;
    expect(await reconcileVoiceAgents()).toMatchObject({ checked: 1, republished: 1, failed: 0 });
    expect(seen.map((x) => x.method)).toEqual(['GET', 'PUT']);
    expect(seen[1].body.vollAgentVersion).toBe(1);

    // gateway já em dia: nada a fazer
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ vollAgentVersion: 1, active: true }) })) as any;
    expect(await reconcileVoiceAgents()).toMatchObject({ republished: 0, failed: 0 });

    // versão 2 salva mas não liberada: a reconciliação não publica por conta própria
    await a.put(`/connections/${connId}/voice-agent`, { ...agent, voice: 'cedar' });
    const puts: string[] = [];
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      if (init?.method === 'PUT') puts.push('PUT');
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }) as any;
    await reconcileVoiceAgents();
    expect(puts).toHaveLength(0);
  });
});
