import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool, one } from '../src/db/pool.js';
import { api, login, makeApp, resetDb, type Api } from './helpers.js';

let app: FastifyInstance;
let a: Api;
const originalFetch = globalThis.fetch;
const originalVoiceAppToken = process.env.VOICE_APP_TOKEN;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

beforeEach(async () => {
  process.env.VOICE_APP_TOKEN = 'internal-gw-secret';
  await resetDb();
  a = api(app, await login(app));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalVoiceAppToken === undefined) delete process.env.VOICE_APP_TOKEN;
  else process.env.VOICE_APP_TOKEN = originalVoiceAppToken;
  vi.restoreAllMocks();
});

async function getPrimaryWorkspaceId(): Promise<string> {
  const ws = await one<{ id: string }>(getPool(), `SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`);
  return ws!.id;
}

async function configureGateway(workspaceId: string) {
  await getPool().query(
    `INSERT INTO workspace_channel_endpoints (workspace_id, config)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET config = EXCLUDED.config`,
    [workspaceId, { voice: { voiceAppBaseUrl: 'http://gateway.test:8090', voiceAppToken: 'tok-svc' } }],
  );
}

function signMeta(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

describe('canal WEBRTC (visibilidade, widget público e WhatsApp Calling)', () => {
  it('provisiona canal WEBRTC padrão ativo no workspace e não recria após exclusão manual', async () => {
    const list1 = await a.get('/connections');
    expect(list1.status).toBe(200);
    const webrtc = list1.body.items.find((c: any) => c.channelType === 'WEBRTC');
    expect(webrtc).toBeTruthy();
    expect(webrtc.active).toBe(true);
    expect(webrtc.provider).toBe('WEBRTC_NATIVE');
    expect(webrtc.webrtcMode).toBe('BOTH');
    expect(String(webrtc.publicWidgetKey)).toMatch(/^wrtc_/);
    expect(String(webrtc.whatsappVerifyToken)).toMatch(/^wtok_/);

    const del = await a.del(`/connections/${webrtc.id}`);
    expect(del.status).toBe(200);

    const list2 = await a.get('/connections');
    expect(list2.body.items.some((c: any) => c.id === webrtc.id)).toBe(false);
    expect(list2.body.items.some((c: any) => c.channelType === 'WEBRTC')).toBe(false);
  });

  it('mascara segredos Meta no POST/PATCH e rejeita agente de outro workspace com 403', async () => {
    const wsId = await getPrimaryWorkspaceId();
    const otherWs = await one<{ id: string }>(
      getPool(),
      `INSERT INTO workspaces (organization_id, name, timezone, active, plan_code)
       SELECT organization_id, 'Empresa B', 'America/Sao_Paulo', true, 'GROWTH'
         FROM workspaces WHERE id=$1
       RETURNING id`,
      [wsId],
    );
    await getPool().query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
       VALUES ('agent', 'agent-own', $1, false, 'TENANT_BYOK'),
              ('agent', 'agent-foreign', $2, false, 'TENANT_BYOK')`,
      [wsId, otherWs!.id],
    );

    const cross = await a.post('/connections', {
      name: 'WebRTC Cruzado',
      channelType: 'WEBRTC',
      provider: 'WEBRTC_NATIVE',
      tenantId: 'agent-foreign',
    });
    expect(cross.status).toBe(403);

    const created = await a.post('/connections', {
      name: 'WebRTC Corporativo',
      channelType: 'WEBRTC',
      provider: 'WEBRTC_NATIVE',
      webrtcMode: 'BOTH',
      tenantId: 'agent-own',
      allowedOrigins: ['https://app.empresa.com/'],
      whatsappPhoneNumberId: '109283746501234',
      whatsappAppSecret: 'meta-secret-1234',
      whatsappAccessToken: 'meta-access-5678',
    });
    expect(created.status).toBe(201);
    expect(created.body.allowedOrigins).toEqual(['https://app.empresa.com']);
    expect(created.body.hasWhatsappAppSecret).toBe(true);
    expect(created.body.hasWhatsappAccessToken).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('meta-secret-1234');
    expect(JSON.stringify(created.body)).not.toContain('meta-access-5678');

    const crossPatch = await a.patch(`/connections/${created.body.id}`, { tenantId: 'agent-foreign' });
    expect(crossPatch.status).toBe(403);

    const keptPatch = await a.patch(`/connections/${created.body.id}`, {
      name: 'WebRTC Renomeado',
      whatsappAppSecret: '***',
      whatsappAccessToken: '••••5678',
    });
    expect(keptPatch.status).toBe(200);
    const dbRow = await one<{ config: any }>(getPool(), `SELECT config FROM connections WHERE id=$1`, [created.body.id]);
    expect(dbRow!.config.whatsappAppSecret).toBe('meta-secret-1234');
    expect(dbRow!.config.whatsappAccessToken).toBe('meta-access-5678');
  });

  it('autentica widget público por publicWidgetKey, valida Origin/agente/ICE/hangup', async () => {
    const wsId = await getPrimaryWorkspaceId();
    await configureGateway(wsId);

    const created = await a.post('/connections', {
      name: 'Widget Público',
      channelType: 'WEBRTC',
      provider: 'WEBRTC_NATIVE',
      webrtcMode: 'WEB',
      allowedOrigins: ['https://site.cliente.com'],
    });
    expect(created.status).toBe(201);
    const key = created.body.publicWidgetKey as string;

    // Sem agente cadastrado no workspace -> 422
    const noAgent = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/offer',
      headers: { origin: 'https://site.cliente.com' },
      payload: { publicWidgetKey: key, sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    expect(noAgent.statusCode).toBe(422);

    // Vincula agente ao workspace
    await getPool().query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
       VALUES ('agent', 'agent-web-1', $1, false, 'TENANT_BYOK')`,
      [wsId],
    );
    await a.patch(`/connections/${created.body.id}`, { tenantId: 'agent-web-1' });

    // Chave desconhecida -> 401
    const badKey = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/offer',
      headers: { origin: 'https://site.cliente.com' },
      payload: { publicWidgetKey: 'wrtc_inexistente', sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    expect(badKey.statusCode).toBe(401);

    // Origem não autorizada -> 403
    const badOrigin = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/offer',
      headers: { origin: 'https://malicioso.example' },
      payload: { publicWidgetKey: key, sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    expect(badOrigin.statusCode).toBe(403);

    // Sucesso + ICE + DELETE com controlToken
    const gwCalls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      gwCalls.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith('/v1/webrtc/offer')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, callId: 'gw-web-1', sdpAnswer: 'v=0\r\nanswer', type: 'answer', iceServers: [], controlToken: 'ctrl-1' }),
        } as any;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) } as any;
    }) as any;

    const okOffer = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/offer',
      headers: { origin: 'https://site.cliente.com' },
      payload: { publicWidgetKey: key, sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
    expect(okOffer.statusCode).toBe(200);
    const offerBody = okOffer.json();
    expect(offerBody.callId).toBe('gw-web-1');
    expect(gwCalls[0].body.tenantId).toBe('agent-web-1');

    const iceRes = await app.inject({
      method: 'POST',
      url: '/api/public/webrtc/gw-web-1/ice',
      headers: { 'x-webrtc-control-token': 'ctrl-1' },
      payload: { candidate: { candidate: 'candidate:1' } },
    });
    expect(iceRes.statusCode).toBe(200);
    expect(gwCalls[1].url).toBe('http://gateway.test:8090/v1/webrtc/gw-web-1/ice');
    expect(gwCalls[1].headers['X-WebRTC-Control-Token'] || gwCalls[1].headers['x-webrtc-control-token']).toBe('ctrl-1');

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/public/webrtc/gw-web-1',
      headers: { 'x-webrtc-control-token': 'ctrl-1' },
    });
    expect(delRes.statusCode).toBe(200);
    expect(gwCalls[2].method).toBe('DELETE');
  });

  it('opera WhatsApp Calling receptivo com desafio GET, HMAC POST, idempotência, terminate e callback interno', async () => {
    const wsId = await getPrimaryWorkspaceId();
    await configureGateway(wsId);

    const created = await a.post('/connections', {
      name: 'WhatsApp Calling Oficial',
      channelType: 'WEBRTC',
      provider: 'WEBRTC_NATIVE',
      webrtcMode: 'WHATSAPP_CALLING',
      whatsappPhoneNumberId: '109283746501234',
      whatsappVerifyToken: 'verify-tok-wa',
      whatsappAppSecret: 'app-secret-wa',
      whatsappAccessToken: 'wa-bearer-tok',
    });
    expect(created.status).toBe(201);
    const connId = created.body.id as string;

    // GET challenge
    const badVerify = await app.inject({
      method: 'GET',
      url: `/api/webhooks/whatsapp-calling/${connId}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`,
    });
    expect(badVerify.statusCode).toBe(403);

    const okVerify = await app.inject({
      method: 'GET',
      url: `/api/webhooks/whatsapp-calling/${connId}?hub.mode=subscribe&hub.verify_token=verify-tok-wa&hub.challenge=98765`,
    });
    expect(okVerify.statusCode).toBe(200);
    expect(okVerify.body).toBe('98765');

    const connectPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'calls',
              value: {
                calls: [
                  {
                    id: 'wacid.call-1',
                    from: '5511999998888',
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

    // Sem assinatura HMAC -> 401
    const noSig = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-calling/${connId}`,
      headers: { 'content-type': 'application/json' },
      payload: connectPayload,
    });
    expect(noSig.statusCode).toBe(401);

    // Sem agente cadastrado no workspace -> 422
    const noAgent = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-calling/${connId}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signMeta(connectPayload, 'app-secret-wa'),
      },
      payload: connectPayload,
    });
    expect(noAgent.statusCode).toBe(422);

    // Vincula agente e processa connect
    await getPool().query(
      `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
       VALUES ('agent', 'agent-wa-1', $1, false, 'TENANT_BYOK')`,
      [wsId],
    );
    await a.patch(`/connections/${connId}`, { tenantId: 'agent-wa-1' });

    const externalCalls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const target = String(url);
      const parsedBody = init?.body ? JSON.parse(init.body) : null;
      externalCalls.push({ url: target, method: init?.method ?? 'GET', headers: init?.headers, body: parsedBody });
      if (target === 'http://gateway.test:8090/v1/webrtc/offer') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, callId: 'gw-wa-1', sdpAnswer: 'v=0\r\nsdp-answer-wa', type: 'answer', iceServers: [] }),
        } as any;
      }
      if (target.startsWith('https://graph.facebook.com/v21.0/109283746501234/calls')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) } as any;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) } as any;
    }) as any;

    const okConnect = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-calling/${connId}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signMeta(connectPayload, 'app-secret-wa'),
      },
      payload: connectPayload,
    });
    expect(okConnect.statusCode).toBe(200);
    expect(okConnect.json().processed).toBe(1);
    expect(externalCalls[0].body.tenantId).toBe('agent-wa-1');
    expect(externalCalls[0].body.metadata.source).toBe('whatsapp_calling');
    expect(externalCalls[1].body.action).toBe('accept');
    expect(externalCalls[1].body.call_id).toBe('wacid.call-1');

    // Reentrega duplicada -> idempotente sem chamar gateway/Meta novamente
    const dupConnect = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-calling/${connId}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signMeta(connectPayload, 'app-secret-wa'),
      },
      payload: connectPayload,
    });
    expect(dupConnect.statusCode).toBe(200);
    expect(dupConnect.json().duplicates).toBe(1);
    expect(externalCalls).toHaveLength(2);

    // Callback interno de fim pelo gateway exige Bearer token
    const badInternal = await app.inject({
      method: 'POST',
      url: '/api/internal/webrtc/gw-wa-1/ended',
      headers: { authorization: 'Bearer wrong-token' },
      payload: { reason: 'agent_hangup', durationSec: 42, endedBy: 'agent' },
    });
    expect(badInternal.statusCode).toBe(401);

    const okInternal = await app.inject({
      method: 'POST',
      url: '/api/internal/webrtc/gw-wa-1/ended',
      headers: { authorization: 'Bearer internal-gw-secret' },
      payload: { reason: 'agent_hangup', durationSec: 42, endedBy: 'agent' },
    });
    expect(okInternal.statusCode).toBe(200);
    expect(externalCalls[2].url).toBe('https://graph.facebook.com/v21.0/109283746501234/calls');
    expect(externalCalls[2].body.action).toBe('terminate');

    const sessionRow = await one<{ status: string }>(
      getPool(),
      `SELECT status FROM whatsapp_calling_sessions WHERE whatsapp_call_id='wacid.call-1'`,
    );
    expect(sessionRow!.status).toBe('ENDED');
  });
});
