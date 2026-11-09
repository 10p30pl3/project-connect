/**
 * Área Telefonia (fase 4 da consolidação): a SPA do Voll Plan passa a mostrar o que antes só aparecia
 * no dashboard.html do gateway de voz. A API faz de intermediária — o gateway fica numa rede interna,
 * o token de serviço nunca vai ao navegador e o acesso segue os perfis do Voll Plan.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getPool, one } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { HttpError } from '../lib/problem.js';
import { audit } from '../lib/audit.js';

const TIMEOUT_MS = 6000;

async function gatewayFor(workspaceId: string): Promise<{ baseUrl: string; token: string }> {
  const ep = await one<{ config: any }>(getPool(), `SELECT config FROM workspace_channel_endpoints WHERE workspace_id=$1`, [workspaceId]);
  let baseUrl = String(ep?.config?.voice?.voiceAppBaseUrl || '');
  let token = String(ep?.config?.voice?.voiceAppToken || '');
  if (!baseUrl) {
    // sem Endereços Técnicos: usa a primeira conexão de voz ativa do workspace
    const c = await one<{ config: any }>(
      getPool(),
      `SELECT config FROM connections WHERE workspace_id=$1 AND provider='VOICE_APP' AND config->>'voiceAppBaseUrl' <> '' ORDER BY active DESC, created_at LIMIT 1`,
      [workspaceId],
    );
    baseUrl = String(c?.config?.voiceAppBaseUrl || '');
    token ||= String(c?.config?.voiceAppToken || '');
  }
  if (!baseUrl) throw new HttpError(409, 'Gateway de voz não configurado', 'Informe o endereço do gateway em Canais > Endereços técnicos.');
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

async function call(workspaceId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const gw = await gatewayFor(workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${gw.baseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(gw.token ? { Authorization: `Bearer ${gw.token}` } : {}), ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new HttpError(502, 'Gateway de voz indisponível', err?.name === 'AbortError' ? 'Tempo esgotado ao falar com o gateway' : String(err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

async function json(workspaceId: string, path: string, init?: RequestInit) {
  const res = await call(workspaceId, path, init);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, 'Gateway de voz recusou', body?.message || body?.error || `HTTP ${res.status}`);
  return body;
}

const enc = encodeURIComponent;

/**
 * Tenants do gateway que pertencem ao workspace: as conexões de voz dele (cada agente publicado usa o id
 * da conexão) e o tenant `default`, usado por conexões legadas sem agente cadastrado.
 */
async function ownTenants(workspaceId: string): Promise<Set<string>> {
  const rows = await getPool().query(`SELECT id FROM connections WHERE workspace_id=$1 AND provider='VOICE_APP'`, [workspaceId]);
  return new Set(['default', ...rows.rows.map((r: any) => String(r.id))]);
}
async function assertOwnRecording(workspaceId: string, id: string) {
  const own = await ownTenants(workspaceId);
  if (![...own].some((t) => id.includes(`_${t}_`))) throw new HttpError(404, 'Não encontrado', 'Gravação não encontrada');
}
const mine = (own: Set<string>) => (x: any) => !x?.tenantId || own.has(String(x.tenantId));

export async function telephonyRoutes(app: FastifyInstance) {
  app.get('/telephony/status', async (req) => json(actor(req).workspaceId, '/v1/status'));

  app.get('/telephony/calls', async (req) => {
    const ws = actor(req).workspaceId;
    const [body, own] = await Promise.all([json(ws, '/v1/calls'), ownTenants(ws)]);
    const calls = (body.calls ?? []).filter(mine(own));
    return { count: calls.length, calls };
  });

  app.get<{ Querystring: { limit?: string; search?: string } }>('/telephony/calls/history', async (req) => {
    const ws = actor(req).workspaceId;
    const qs = new URLSearchParams();
    if (req.query.limit) qs.set('limit', String(req.query.limit));
    if (req.query.search) qs.set('search', String(req.query.search));
    const [body, own] = await Promise.all([json(ws, `/v1/calls/history${qs.size ? `?${qs}` : ''}`), ownTenants(ws)]);
    const history = (body.history ?? []).filter(mine(own));
    return { total: history.length, history };
  });

  app.get<{ Params: { id: string } }>('/telephony/calls/:id', async (req) => json(actor(req).workspaceId, `/v1/calls/${enc(req.params.id)}`));

  app.get<{ Params: { id: string } }>('/telephony/calls/:id/transcript', async (req) =>
    json(actor(req).workspaceId, `/v1/calls/${enc(req.params.id)}/transcript`),
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/telephony/calls/:id/hangup',
    { preHandler: requireRoles(...CAN.supervise, ...CAN.operate) },
    async (req) => {
      const a = actor(req);
      const reason = String(req.body?.reason || 'Encerrada pelo Voll Plan');
      const r = await json(a.workspaceId, `/v1/calls/${enc(req.params.id)}/hangup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      await audit(getPool(), a, 'telephony.hangup', 'call', req.params.id, { reason });
      return r;
    },
  );

  app.get('/telephony/recordings', async (req) => {
    const ws = actor(req).workspaceId;
    const [body, own] = await Promise.all([json(ws, '/v1/recordings'), ownTenants(ws)]);
    // o nome do arquivo traz o tenant (`..._<tenantId>_...`)
    const recordings = (body.recordings ?? []).filter((r: any) => [...own].some((t) => String(r.id).includes(`_${t}_`)));
    return { count: recordings.length, recordings };
  });

  app.get<{ Params: { id: string } }>('/telephony/recordings/:id/transcript', async (req) => {
    await assertOwnRecording(actor(req).workspaceId, req.params.id);
    return json(actor(req).workspaceId, `/v1/recordings/${enc(req.params.id)}/transcript`);
  });

  /** Áudio da gravação, repassado em streaming; ouvir fica registrado na auditoria (LGPD). */
  app.get<{ Params: { id: string } }>('/telephony/recordings/:id/audio', async (req, reply: FastifyReply) => {
    const a = actor(req);
    await assertOwnRecording(a.workspaceId, req.params.id);
    const res = await call(a.workspaceId, `/v1/recordings/${enc(req.params.id)}/audio`);
    if (!res.ok || !res.body) throw new HttpError(res.status === 404 ? 404 : 502, 'Gravação indisponível', `HTTP ${res.status}`);
    await audit(getPool(), a, 'telephony.recording_played', 'recording', req.params.id);
    reply.header('Content-Type', res.headers.get('content-type') ?? 'audio/wav');
    const len = res.headers.get('content-length');
    if (len) reply.header('Content-Length', len);
    reply.header('Cache-Control', 'private, no-store');
    const buf = Buffer.from(await res.arrayBuffer());
    return reply.send(buf);
  });

  app.get('/telephony/ai-costs', async (req) => json(actor(req).workspaceId, '/v1/ai-costs/summary'));

  app.get('/telephony/trunks', async (req) => json(actor(req).workspaceId, '/v1/trunks'));
}
