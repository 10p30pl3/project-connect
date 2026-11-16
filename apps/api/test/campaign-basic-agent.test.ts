import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool, one } from '../src/db/pool.js';
import { voiceAppAdapter } from '../src/connectors/voice-app.js';
import {
  api,
  catalog,
  importCsv,
  login,
  makeApp,
  resetDb,
  SMALL_CSV,
  type Api,
} from './helpers.js';

const ATTEMPT = '8e2d4a1b-1111-4c3d-8e9f-0a1b2c3d4e5f';
const CONNECTION = '4f5a6b7c-2222-4e9f-a0b1-c2d3e4f5a6b7';

describe('campaign voiceAgentId — adapter override unit', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('usa campaign_voice_agent_id no VoiceCallRequest.tenantId sem alterar o padrão da conexão', async () => {
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return { status: 202, ok: true, json: async () => ({ ok: true, providerAttemptId: `va-${ATTEMPT}` }) } as any;
    }) as any;

    const fakeDb = (campaignAgentId: string | null): any => ({
      query: async () => ({
        rows: [
          {
            workspace_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
            campaign_id: '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9',
            contact_id: '3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f',
            contact_name: 'Maria Souza',
            contact_ext_id: '00999',
            contact_attrs: {},
            campaign_trunk_ids: [],
            campaign_voice_agent_id: campaignAgentId,
            tabulation_rules: { CONVERSION: 'FINISH_SUCCESS' },
            voice_overrides: null,
          },
        ],
      }),
    });

    const conn = {
      id: CONNECTION,
      provider: 'VOICE_APP',
      channel_type: 'VOICE' as const,
      config: {
        voiceAppBaseUrl: 'http://127.0.0.1:5050',
        defaultCallerId: '+551140030000',
        tenantId: 'conn-default-agent',
      },
      webhook_secret: 'whsec_test_secret_1234567890abcdef',
    } as any;

    const attempt = {
      id: ATTEMPT,
      destination_address: '+5511988887777',
      channel_type: 'VOICE' as const,
      trace_id: 'trc-agent-1',
    };

    const resOverride = await voiceAppAdapter.send(fakeDb('campaign-custom-agent'), { attempt, connection: conn });
    expect(resOverride.status).toBe('ACCEPTED');
    expect(calls[0].body.tenantId).toBe('campaign-custom-agent');

    const resFallback = await voiceAppAdapter.send(fakeDb(null), { attempt, connection: conn });
    expect(resFallback.status).toBe('ACCEPTED');
    expect(calls[1].body.tenantId).toBe('conn-default-agent');
  });
});

describe('campaign voiceAgentId — API persistence, workspace isolation & draft', () => {
  let app: FastifyInstance;
  let adminApi: Api;
  let workspaceId: string;
  let mailingId: string;
  let journeyVersionId: string;
  let strategyVersionId: string;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  beforeEach(async () => {
    const seedInfo = await resetDb();
    workspaceId = seedInfo.workspaceId;
    const cookie = await login(app);
    adminApi = api(app, cookie);

    const imp = await importCsv(adminApi, 'Base Agente Campanha', SMALL_CSV);
    mailingId = imp.result.body.mailingId;
    const cat = await catalog();
    journeyVersionId = cat.journey('Discador');
    strategyVersionId = cat.strategy('Demonstração 24x7');
  });

  it('persiste voiceAgentId por campanha sem mutar conexões e permite herança quando nulo', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id)
       VALUES ('agent', 'agent-cobranca-v3', $1), ('agent', 'agent-vendas-v1', $1)
       ON CONFLICT (resource_type, resource_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id`,
      [workspaceId],
    );

    const c1 = await adminApi.post('/campaigns', {
      name: 'Campanha Agente Cobrança',
      mailingId,
      journeyVersionId,
      strategyVersionId,
      voiceAgentId: 'agent-cobranca-v3',
      startMode: 'READY',
    });
    expect(c1.status).toBe(201);
    expect(c1.body.voiceAgentId).toBe('agent-cobranca-v3');

    const c2 = await adminApi.post('/campaigns', {
      name: 'Campanha Agente Vendas',
      mailingId,
      journeyVersionId,
      strategyVersionId,
      voiceAgentId: 'agent-vendas-v1',
      startMode: 'READY',
    });
    expect(c2.status).toBe(201);
    expect(c2.body.voiceAgentId).toBe('agent-vendas-v1');

    const cDefault = await adminApi.post('/campaigns', {
      name: 'Campanha Padrão Canal',
      mailingId,
      journeyVersionId,
      strategyVersionId,
      startMode: 'READY',
    });
    expect(cDefault.status).toBe(201);
    expect(cDefault.body.voiceAgentId).toBeNull();

    const fetched = await adminApi.get(`/campaigns/${c1.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.voiceAgentId).toBe('agent-cobranca-v3');
  });

  it('rejeita com HTTP 403 agente de voz pertencente a outro workspace', async () => {
    const pool = getPool();
    const otherOrg = await one<{ id: string }>(
      pool,
      `INSERT INTO organizations (name) VALUES ('Outra Org Teste') RETURNING id`,
      [],
    );
    const otherWs = await one<{ id: string }>(
      pool,
      `INSERT INTO workspaces (organization_id, name, timezone) VALUES ($1, 'Outro Workspace', 'America/Sao_Paulo') RETURNING id`,
      [otherOrg!.id],
    );
    await pool.query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id)
       VALUES ('agent', 'agent-de-outra-empresa', $1)`,
      [otherWs!.id],
    );

    const r = await adminApi.post('/campaigns', {
      name: 'Tentativa Agente Cruzado',
      mailingId,
      journeyVersionId,
      strategyVersionId,
      voiceAgentId: 'agent-de-outra-empresa',
      startMode: 'READY',
    });
    expect(r.status).toBe(403);
  });

  it('preserva extras de acionamento no rascunho (/campaign-draft) e limpa ao finalizar campanha', async () => {
    const put1 = await adminApi.put('/campaign-draft', {
      data: {
        step: 'ACTIVATION',
        mailingId,
        audienceMode: 'ALL',
        extra: {
          voiceAgentId: 'agent-cobranca-v3',
          voiceAgentName: 'Agente Cobrança v3',
          selectedConnectionId: 'conn-1',
        },
      },
      revision: 0,
    });
    expect(put1.status).toBe(200);
    expect(put1.body.revision).toBe(1);

    const got = await adminApi.get('/campaign-draft');
    expect(got.status).toBe(200);
    expect(got.body.data.extra.voiceAgentId).toBe('agent-cobranca-v3');
    expect(got.body.data.extra.selectedConnectionId).toBe('conn-1');

    const created = await adminApi.post('/campaigns', {
      name: 'Campanha Final Rascunho',
      mailingId,
      journeyVersionId,
      strategyVersionId,
      voiceAgentId: 'agent-cobranca-v3',
      startMode: 'READY',
    });
    expect(created.status).toBe(201);

    const afterDraft = await adminApi.get('/campaign-draft');
    expect(afterDraft.status).toBe(200);
    expect(afterDraft.body).toBeNull();
  });
});
