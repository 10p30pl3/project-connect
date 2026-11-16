import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool, one } from '../src/db/pool.js';
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

async function setupGatewayAndWorkspaceAgent(workspaceId: string, agentId: string) {
  await getPool().query(
    `INSERT INTO workspace_channel_endpoints (workspace_id, config)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET config = EXCLUDED.config`,
    [workspaceId, { voice: { voiceAppBaseUrl: 'http://gateway.test:8090', voiceAppToken: 'tok-svc' } }],
  );
  await getPool().query(
    `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
     VALUES ('agent', $2, $1, false, 'TENANT_BYOK')
     ON CONFLICT (resource_type, resource_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id`,
    [workspaceId, agentId],
  );
}

describe('arquitetura Canal, Agentes e Rotas (006)', () => {
  it('lista usos do agente em Canais/Rotas/Campanhas e bloqueia DELETE com 409 enquanto em uso', async () => {
    const ws = await one<{ id: string }>(getPool(), `SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`);
    const wsId = ws!.id;
    await setupGatewayAndWorkspaceAgent(wsId, 'agent-shared-1');

    const cVoice = await a.post('/connections', {
      name: 'Canal SIP Principal',
      channelType: 'VOICE',
      provider: 'VOICE_APP',
      tenantId: 'agent-shared-1',
    });
    expect(cVoice.status).toBe(201);

    const cWebrtc = await a.post('/connections', {
      name: 'Canal WebRTC Site',
      channelType: 'WEBRTC',
      provider: 'WEBRTC_NATIVE',
      tenantId: 'agent-shared-1',
    });
    expect(cWebrtc.status).toBe(201);

    const mockRoutes = [
      { id: 'r-vip', name: 'Rota VIP Web', channelType: 'WEBRTC', connectionId: cWebrtc.body.id, tenantId: 'agent-shared-1', active: true, priority: 10 },
    ];
    await getPool().query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
       VALUES ('route', 'r-vip', $1, false, 'TENANT_BYOK')`,
      [wsId],
    );

    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const target = String(url);
      if (target.endsWith('/v1/routes')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ routes: mockRoutes }) } as any;
      }
      if (target.endsWith('/v1/tenants')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ tenants: [{ id: 'agent-shared-1', name: 'Agente Compartilhado', active: true }] }) } as any;
      }
      if (init?.method === 'DELETE' && target.includes('/v1/tenants/')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ deleted: true }) } as any;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) } as any;
    }) as any;

    const usagesRes = await a.get('/telephony/tenants/agent-shared-1/usages');
    expect(usagesRes.status).toBe(200);
    expect(usagesRes.body.agentId).toBe('agent-shared-1');
    expect(usagesRes.body.channels).toHaveLength(2);
    expect(usagesRes.body.routes).toHaveLength(1);
    expect(usagesRes.body.totalReferences).toBe(3);

    // Enquanto vinculado a canais/rotas, exclusão deve falhar com HTTP 409
    const blockedDel = await a.del('/telephony/tenants/agent-shared-1');
    expect(blockedDel.status).toBe(409);

    // Após desvincular canais e rotas, exclusão é permitida
    await a.patch(`/connections/${cVoice.body.id}`, { tenantId: null });
    await a.patch(`/connections/${cWebrtc.body.id}`, { tenantId: null });
    mockRoutes.length = 0;

    const okDel = await a.del('/telephony/tenants/agent-shared-1');
    expect(okDel.status).toBe(200);
  });

  it('aplica precedência Rota > Canal > Workspace no simulador, WebRTC público e WhatsApp Calling e bloqueia cross-workspace 403', async () => {
    const ws = await one<{ id: string }>(getPool(), `SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`);
    const wsId = ws!.id;
    await setupGatewayAndWorkspaceAgent(wsId, 'agent-route-a');
    await setupGatewayAndWorkspaceAgent(wsId, 'agent-channel-b');

    const otherWs = await one<{ id: string }>(
      getPool(),
      `INSERT INTO workspaces (organization_id, name, timezone, active, plan_code)
       SELECT organization_id, 'Workspace Externo', 'America/Sao_Paulo', true, 'GROWTH'
         FROM workspaces WHERE id=$1
       RETURNING id`,
      [wsId],
    );
    await setupGatewayAndWorkspaceAgent(otherWs!.id, 'agent-foreign-z');

    const foreignConn = await one<{ id: string }>(
      getPool(),
      `INSERT INTO connections (workspace_id, name, channel_type, provider, config, webhook_secret, active)
       VALUES ($1, 'Canal Externo', 'WEBRTC', 'WEBRTC_NATIVE', '{"webrtcMode":"BOTH"}', 'sec-ext', true)
       RETURNING id`,
      [otherWs!.id],
    );

    const webConn = await a.post('/connections', {
      name: 'Canal WebRTC Multicanal',
      channelType: 'WEBRTC',
      provider: 'WEBRTC_NATIVE',
      webrtcMode: 'BOTH',
      tenantId: 'agent-channel-b',
      whatsappPhoneNumberId: '109283746501234',
      whatsappAppSecret: 'app-sec-006',
      whatsappAccessToken: 'wa-tok-006',
    });
    expect(webConn.status).toBe(201);

    const gwRoutes = [
      {
        id: 'r-vip-origin',
        name: 'Web VIP Origem',
        channelType: 'WEBRTC',
        connectionId: webConn.body.id,
        originPattern: 'https://vip.cliente.com',
        didPattern: '*',
        callerPattern: '*',
        tenantId: 'agent-route-a',
        priority: 10,
        active: true,
      },
    ];
    await getPool().query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
       VALUES ('route', 'r-vip-origin', $1, false, 'TENANT_BYOK')`,
      [wsId],
    );

    const gatewayTenantsOffered: string[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const target = String(url);
      if (target.endsWith('/v1/routes')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ routes: gwRoutes }) } as any;
      }
      if (target.endsWith('/v1/tenants')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              tenants: [
                { id: 'agent-route-a', name: 'Agente Rota A', active: true },
                { id: 'agent-channel-b', name: 'Agente Canal B', active: true },
              ],
            }),
        } as any;
      }
      if (target.endsWith('/v1/webrtc/offer')) {
        const body = JSON.parse(init.body);
        gatewayTenantsOffered.push(body.tenantId);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, callId: `gw-${gatewayTenantsOffered.length}`, sdpAnswer: 'v=0\r\nans', type: 'answer', iceServers: [] }),
        } as any;
      }
      if (target.startsWith('https://graph.facebook.com/v21.0/109283746501234/calls')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) } as any;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) } as any;
    }) as any;

    // Cross-workspace em POST /telephony/routes bloqueado com 403
    const crossAgentRoute = await a.post('/telephony/routes', {
      name: 'Rota Invasiva Agente',
      channelType: 'WEBRTC',
      connectionId: webConn.body.id,
      tenantId: 'agent-foreign-z',
    });
    expect(crossAgentRoute.status).toBe(403);

    const crossConnRoute = await a.post('/telephony/routes', {
      name: 'Rota Invasiva Canal',
      channelType: 'WEBRTC',
      connectionId: foreignConn!.id,
      tenantId: 'agent-route-a',
    });
    expect(crossConnRoute.status).toBe(403);

    // Simulador: origem VIP casa rota -> agent-route-a ('inbound_route')
    const simRoute = await a.post('/telephony/routes/simulate', {
      channelType: 'WEBRTC',
      connectionId: webConn.body.id,
      origin: 'https://vip.cliente.com',
    });
    expect(simRoute.status).toBe(200);
    expect(simRoute.body.resolvedTenantId).toBe('agent-route-a');
    expect(simRoute.body.source).toBe('inbound_route');

    // Simulador: outra origem cai no padrão do canal -> agent-channel-b ('channel_default')
    const simFallback = await a.post('/telephony/routes/simulate', {
      channelType: 'WEBRTC',
      connectionId: webConn.body.id,
      origin: 'https://site.cliente.com',
    });
    expect(simFallback.status).toBe(200);
    expect(simFallback.body.resolvedTenantId).toBe('agent-channel-b');
    expect(simFallback.body.source).toBe('channel_default');

    // WebRTC público em runtime segue a mesma precedência
    const offerRoute = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/offer',
      headers: { origin: 'https://vip.cliente.com' },
      payload: { publicWidgetKey: webConn.body.publicWidgetKey, sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    expect(offerRoute.statusCode).toBe(200);

    const offerFallback = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/offer',
      headers: { origin: 'https://site.cliente.com' },
      payload: { publicWidgetKey: webConn.body.publicWidgetKey, sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    expect(offerFallback.statusCode).toBe(200);
    expect(gatewayTenantsOffered).toEqual(['agent-route-a', 'agent-channel-b']);

    // WhatsApp Calling também resolve via Rota quando há regra para o canal/caller
    gwRoutes.unshift({
      id: 'r-wa-caller',
      name: 'WhatsApp VIP',
      channelType: 'WEBRTC',
      connectionId: webConn.body.id,
      originPattern: '*',
      didPattern: '109283746501234',
      callerPattern: '5511999*',
      tenantId: 'agent-route-a',
      priority: 5,
      active: true,
    });
    await getPool().query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
       VALUES ('route', 'r-wa-caller', $1, false, 'TENANT_BYOK')`,
      [wsId],
    );

    const waPayload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: 'calls',
              value: {
                calls: [
                  {
                    id: 'wacid.route-1',
                    from: '5511999112233',
                    event: 'connect',
                    session: { sdp_type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const sig = 'sha256=' + createHmac('sha256', 'app-sec-006').update(waPayload, 'utf8').digest('hex');
    const waRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-calling/${webConn.body.id}`,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      payload: waPayload,
    });
    expect(waRes.statusCode).toBe(200);
    expect(gatewayTenantsOffered[2]).toBe('agent-route-a');
  });
});
