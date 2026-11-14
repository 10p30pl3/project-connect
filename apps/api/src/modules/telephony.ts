/**
 * Área Telefonia Multi-Tenant (Voll Connect integrado):
 * Proxy autenticado e isolado por empresa (workspace) para o cluster de voz (`voice-app`),
 * com Troncos Default (read-only/mascarados), Troncos & Chaves IA BYOK por tenant,
 * idempotência na originação e sanitização estrita (tempo-apenas para clientes).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isReadOnlyRole, isSuperAdminRole } from '@voll/shared';
import { getPool, one, q } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { HttpError } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { decryptSecret, encryptSecret, maskSecret } from '../lib/crypto.js';
import { idempotencyGuard } from '../lib/idempotency.js';

const DEFAULT_TIMEOUT_MS = 8000;
const LONG_TIMEOUT_MS = 20000;
const enc = encodeURIComponent;

type VoiceResourceType = 'agent' | 'trunk' | 'extension' | 'route' | 'outbound_route';

type ResourceOwnership = {
  resource_id: string;
  workspace_id: string | null;
  is_global_default: boolean;
  owner_mode: 'GLOBAL_DEFAULT' | 'TENANT_BYOK';
};

async function getMasterWorkspaceId(): Promise<string | null> {
  const row = await one<{ id: string }>(
    getPool(),
    `SELECT id FROM workspaces ORDER BY COALESCE(is_master, false) DESC, created_at ASC LIMIT 1`,
  ).catch(() => null);
  return row?.id ?? null;
}

async function syncAndFetchOwnership(
  type: VoiceResourceType,
  gatewayItems: any[],
): Promise<Map<string, ResourceOwnership>> {
  const pool = getPool();
  const rows = await q<ResourceOwnership>(
    pool,
    `SELECT resource_id, workspace_id, is_global_default, owner_mode
       FROM workspace_voice_resources
      WHERE resource_type = $1`,
    [type],
  ).catch(() => []);

  const map = new Map<string, ResourceOwnership>();
  for (const r of rows) map.set(r.resource_id, r);

  const missingIds = gatewayItems
    .map((it) => String(it?.id ?? it?.extension ?? it?.name ?? '').trim())
    .filter((id) => id && !map.has(id));

  if (missingIds.length > 0) {
    const masterId = await getMasterWorkspaceId();
    const defaultAsGlobal = type === 'trunk';
    for (const rid of missingIds) {
      await pool
        .query(
          `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (resource_type, resource_id) DO NOTHING`,
          [
            type,
            rid,
            defaultAsGlobal ? null : masterId,
            defaultAsGlobal,
            defaultAsGlobal ? 'GLOBAL_DEFAULT' : 'TENANT_BYOK',
          ],
        )
        .catch(() => {});

      map.set(rid, {
        resource_id: rid,
        workspace_id: defaultAsGlobal ? null : masterId,
        is_global_default: defaultAsGlobal,
        owner_mode: defaultAsGlobal ? 'GLOBAL_DEFAULT' : 'TENANT_BYOK',
      });
    }
  }

  return map;
}

async function getWorkspaceResourceIds(workspaceId: string, type: VoiceResourceType): Promise<Set<string>> {
  const rows = await q<{ resource_id: string }>(
    getPool(),
    `SELECT resource_id FROM workspace_voice_resources WHERE resource_type = $1 AND workspace_id = $2`,
    [type, workspaceId],
  ).catch(() => []);
  return new Set(rows.map((r) => r.resource_id));
}

async function assertCanCreateOrModifyResource(
  type: VoiceResourceType,
  resourceId: string,
  workspaceId: string,
  role: string,
  requestedGlobalDefault = false,
) {
  const isSuper = isSuperAdminRole(role);
  if (requestedGlobalDefault && !isSuper) {
    throw new HttpError(403, 'Acesso restrito ao Super Admin', 'Somente Super Admin pode publicar Troncos Globais Default.');
  }

  const existing = await one<ResourceOwnership>(
    getPool(),
    `SELECT resource_id, workspace_id, is_global_default, owner_mode
       FROM workspace_voice_resources
      WHERE resource_type = $1 AND resource_id = $2`,
    [type, resourceId],
  ).catch(() => null);

  if (!existing) return;
  if (existing.is_global_default && !isSuper) {
    throw new HttpError(403, 'Recurso global protegido', 'Este tronco padrão da plataforma está em modo somente-leitura.');
  }
  if (!existing.is_global_default && existing.workspace_id && existing.workspace_id !== workspaceId) {
    throw new HttpError(403, 'Conflito multi-tenant', 'Este recurso pertence a outra empresa.');
  }
}

async function upsertResourceOwnership(
  type: VoiceResourceType,
  resourceId: string,
  workspaceId: string,
  isGlobalDefault: boolean,
) {
  await getPool().query(
    `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (resource_type, resource_id) DO UPDATE
     SET workspace_id = EXCLUDED.workspace_id,
         is_global_default = EXCLUDED.is_global_default,
         owner_mode = EXCLUDED.owner_mode,
         updated_at = now()`,
    [
      type,
      resourceId,
      isGlobalDefault ? null : workspaceId,
      isGlobalDefault,
      isGlobalDefault ? 'GLOBAL_DEFAULT' : 'TENANT_BYOK',
    ],
  );
}

function sanitizeCallItem(item: any, isSuper: boolean) {
  if (!item || typeof item !== 'object') return item;
  if (isSuper) return item;
  const {
    costUsd: _c1,
    costBrl: _c2,
    aiCostUsd: _c3,
    aiCostBrl: _c4,
    inputTokens: _t1,
    outputTokens: _t2,
    totalTokens: _t3,
    tokens: _t4,
    costBreakdown: _cb,
    billing: _b,
    ...rest
  } = item;
  return rest;
}

function sanitizeTrunkForTenant(trunk: any, own: ResourceOwnership | undefined, isSuper: boolean, isReadOnly = false) {
  const isGlobal = Boolean(own?.is_global_default);
  const readOnly = isReadOnly || (isGlobal && !isSuper);
  if (isGlobal && !isSuper) {
    return {
      ...trunk,
      ownerMode: 'GLOBAL_DEFAULT',
      isGlobalDefault: true,
      readOnly: true,
      username: trunk.username ? maskSecret(String(trunk.username)) : 'Configuração Gerenciada',
      password: '',
      authPassword: '',
      secret: '',
    };
  }
  return {
    ...trunk,
    ownerMode: isGlobal ? 'GLOBAL_DEFAULT' : 'TENANT_BYOK',
    isGlobalDefault: isGlobal,
    readOnly,
    password: '',
    authPassword: '',
    secret: '',
  };
}

function extractRecordingTenantId(recordingId: string): string | null {
  const clean = String(recordingId || '').trim().replace(/\.(wav|txt)$/i, '');
  const dated = clean.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_([^_]+)_/);
  if (dated) return dated[1];
  const simple = clean.match(/^([a-z0-9-]+)_[^_]+$/i);
  if (simple) return simple[1];
  return null;
}

function recordingMatchesAgent(recordingId: string, agentIds: Set<string>, isMasterWorkspace: boolean): boolean {
  if (agentIds.size === 0) return false;
  const tid = extractRecordingTenantId(recordingId);
  if (tid) return agentIds.has(tid);
  return isMasterWorkspace && !recordingId.includes('_');
}

async function ensureOwnershipSynced(workspaceId: string, type: VoiceResourceType, gwPath: string, listKey: string) {
  const raw = await proxyJson(workspaceId, gwPath).catch(() => ({}));
  const list = Array.isArray(raw?.[listKey]) ? raw[listKey] : [];
  await syncAndFetchOwnership(type, list);
  return list;
}

async function assertCallOwnership(workspaceId: string, callId: string, role: string) {
  const [call, tenantsRaw] = await Promise.all([
    proxyJson(workspaceId, `/v1/calls/${enc(callId)}`),
    proxyJson(workspaceId, '/v1/tenants').catch(() => ({ tenants: [] })),
  ]);
  await syncAndFetchOwnership('agent', tenantsRaw?.tenants ?? []);
  const [allowedAgents, allowedExts, masterId] = await Promise.all([
    getWorkspaceResourceIds(workspaceId, 'agent'),
    getWorkspaceResourceIds(workspaceId, 'extension'),
    getMasterWorkspaceId(),
  ]);
  const tid = String(call?.tenantId || '').trim();
  const isMaster = masterId === workspaceId;
  const ownsByAgent = tid ? allowedAgents.has(tid) : (isMaster && allowedAgents.size === 0 && isSuperAdminRole(role));
  const ownsByExt = allowedExts.has(String(call?.caller || '')) || allowedExts.has(String(call?.called || ''));
  if (!ownsByAgent && !ownsByExt) {
    throw new HttpError(403, 'Acesso negado à chamada', 'Esta chamada pertence a outra empresa.');
  }
  return call;
}

async function computeWorkspaceCallDurationStats(workspaceId: string, gatewayCallsHistory: any[]) {
  const agentIds = await getWorkspaceResourceIds(workspaceId, 'agent');
  const filtered = gatewayCallsHistory.filter((h) => agentIds.has(String(h?.tenantId || 'default')));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthItems = filtered.filter((h) => {
    const dt = new Date(h?.startedAt || h?.endedAt || 0).getTime();
    return Number.isFinite(dt) && dt >= monthStart.getTime();
  });
  const monthDurationSec = monthItems.reduce((acc, h) => acc + Math.max(0, Number(h?.durationSec ?? 0)), 0);
  return {
    monthDurationSec,
    monthCallsCount: monthItems.length,
    totalCallsCount: filtered.length,
  };
}

export async function gatewayFor(workspaceId: string): Promise<{ baseUrl: string; token: string }> {
  const ep = await one<{ config: any }>(
    getPool(),
    `SELECT config FROM workspace_channel_endpoints WHERE workspace_id=$1`,
    [workspaceId],
  ).catch(() => null);

  let baseUrl = String(ep?.config?.voice?.voiceAppBaseUrl || '').trim();
  let token = String(ep?.config?.voice?.voiceAppToken || '').trim();

  if (!baseUrl) {
    const c = await one<{ config: any }>(
      getPool(),
      `SELECT config FROM connections WHERE workspace_id=$1 AND provider='VOICE_APP' AND config->>'voiceAppBaseUrl' <> '' ORDER BY active DESC, created_at LIMIT 1`,
      [workspaceId],
    ).catch(() => null);
    baseUrl = String(c?.config?.voiceAppBaseUrl || '').trim();
    token ||= String(c?.config?.voiceAppToken || '').trim();
  }

  if (!baseUrl) {
    baseUrl = String(process.env.VOICE_APP_BASE_URL || '').trim();
  }
  token ||= String(process.env.VOICE_APP_TOKEN || process.env.API_AUTH_TOKEN || '').trim();

  if (!baseUrl) {
    throw new HttpError(
      409,
      'Gateway de voz não configurado',
      'Informe o endereço do gateway em Canais > Endereços técnicos ou configure VOICE_APP_BASE_URL.',
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

async function callGateway(
  workspaceId: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const gw = await gatewayFor(workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${gw.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(gw.token ? { Authorization: `Bearer ${gw.token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new HttpError(
      502,
      'Gateway de voz indisponível',
      err?.name === 'AbortError' ? 'Tempo esgotado ao falar com o gateway de voz.' : String(err?.message ?? err),
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyJson(
  workspaceId: string,
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const res = await callGateway(workspaceId, path, init, timeoutMs);
  const text = await res.text();
  let body: any = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  if (!res.ok) {
    const status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw new HttpError(status, 'Gateway de voz recusou', body?.message || body?.error || `HTTP ${res.status}`);
  }
  return body;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined || method === 'GET' || method === 'HEAD') {
    return { method };
  }
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function telephonyRoutes(app: FastifyInstance) {
  const manageGuard = { preHandler: requireRoles(...CAN.admin) };
  const operateGuard = { preHandler: requireRoles(...CAN.supervise, ...CAN.operate) };

  // ---------------- Status, Cluster & Features ----------------
  app.get('/telephony/status', async (req) => proxyJson(actor(req).workspaceId, '/v1/status'));
  app.get('/telephony/cluster/nodes', async (req) => proxyJson(actor(req).workspaceId, '/v1/cluster/nodes'));
  app.get('/telephony/commands', async (req) => proxyJson(actor(req).workspaceId, '/v1/commands'));

  app.get<{ Querystring: { test?: string } }>('/telephony/features', async (req) => {
    const qs = req.query.test === 'true' ? '?test=true' : '';
    return proxyJson(
      actor(req).workspaceId,
      `/v1/features${qs}`,
      undefined,
      req.query.test === 'true' ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    );
  });

  app.post('/telephony/features/test', operateGuard, async (req) =>
    proxyJson(actor(req).workspaceId, '/v1/features/test', jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS),
  );

  app.post<{ Params: { id: string } }>('/telephony/features/:id/test', operateGuard, async (req) =>
    proxyJson(actor(req).workspaceId, `/v1/features/${enc(req.params.id)}/test`, jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS),
  );

  app.get<{ Querystring: { tenantId?: string } }>('/telephony/features/crosstalk/mode', async (req) => {
    const a = actor(req);
    const tid = req.query.tenantId ? String(req.query.tenantId).trim() : '';
    if (tid) {
      await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
      const allowed = await getWorkspaceResourceIds(a.workspaceId, 'agent');
      if (!allowed.has(tid) && !isSuperAdminRole(a.role)) {
        throw new HttpError(403, 'Acesso negado ao agente', 'Este agente pertence a outra empresa.');
      }
    }
    const qs = tid ? `?tenantId=${enc(tid)}` : '';
    return proxyJson(a.workspaceId, `/v1/features/crosstalk/mode${qs}`);
  });

  const handleCrosstalkMode = async (req: any) => {
    const a = actor(req);
    const body = (req.body ?? {}) as Record<string, any>;
    const tid = body.tenantId ? String(body.tenantId).trim() : '';
    if (tid) {
      await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
      const allowed = await getWorkspaceResourceIds(a.workspaceId, 'agent');
      if (!allowed.has(tid) && !isSuperAdminRole(a.role)) {
        throw new HttpError(403, 'Acesso negado ao agente', 'Você só pode alterar o filtro de voz de agentes da sua empresa.');
      }
    } else if (!isSuperAdminRole(a.role)) {
      throw new HttpError(403, 'Acesso restrito ao Super Admin', 'Somente Super Admin pode alterar o filtro de voz global do gateway.');
    }
    const res = await proxyJson(a.workspaceId, '/v1/features/crosstalk/mode', jsonInit('POST', body));
    await audit(getPool(), a, 'telephony.crosstalk_mode', 'gateway', tid || 'global', { after: body });
    return res;
  };
  app.post('/telephony/features/crosstalk/mode', manageGuard, handleCrosstalkMode);
  app.put('/telephony/features/crosstalk/mode', manageGuard, handleCrosstalkMode);

  // ---------------- Chamadas Ao Vivo, Histórico & Comandos In-Call ----------------
  app.get('/telephony/calls', async (req) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const [raw, tenantsRaw] = await Promise.all([
      proxyJson(a.workspaceId, '/v1/calls'),
      proxyJson(a.workspaceId, '/v1/tenants').catch(() => ({ tenants: [] })),
    ]);
    await syncAndFetchOwnership('agent', tenantsRaw?.tenants ?? []);
    const [allowedAgents, allowedExts, masterId] = await Promise.all([
      getWorkspaceResourceIds(a.workspaceId, 'agent'),
      getWorkspaceResourceIds(a.workspaceId, 'extension'),
      getMasterWorkspaceId(),
    ]);
    const isMaster = masterId === a.workspaceId;
    const filtered = (Array.isArray(raw?.calls) ? raw.calls : []).filter((c: any) => {
      if (!c?.tenantId && isMaster && allowedAgents.size === 0) return true;
      const tid = String(c?.tenantId || 'default');
      return allowedAgents.has(tid) || allowedExts.has(String(c?.caller || '')) || allowedExts.has(String(c?.called || ''));
    });
    return {
      count: filtered.length,
      calls: filtered.map((c: any) => sanitizeCallItem(c, isSuper)),
      viewMode: isSuper ? 'SUPER_ADMIN_FULL' : 'CLIENT_TIME_ONLY',
    };
  });

  app.post(
    '/telephony/calls',
    { preHandler: [requireRoles(...CAN.supervise, ...CAN.operate), idempotencyGuard('telephony.originate')] },
    async (req) => {
      const a = actor(req);
      const body = { ...(req.body ?? {}) } as Record<string, any>;
      const tenantsRaw = await proxyJson(a.workspaceId, '/v1/tenants').catch(() => ({ tenants: [] }));
      await syncAndFetchOwnership('agent', tenantsRaw?.tenants ?? []);
      const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');

      if (!body.tenantId && allowedAgents.size > 0) {
        body.tenantId = [...allowedAgents][0];
      }
      const targetTenant = String(body.tenantId || '').trim();
      if (!targetTenant || !allowedAgents.has(targetTenant)) {
        throw new HttpError(
          403,
          'Agente de Voz não pertence à empresa',
          allowedAgents.size === 0
            ? 'Crie primeiro um Agente de Voz (Tenant) para esta empresa antes de originar chamadas.'
            : `O agente "${targetTenant}" pertence a outra empresa.`,
        );
      }

      const r = await proxyJson(a.workspaceId, '/v1/calls', jsonInit('POST', body), LONG_TIMEOUT_MS);
      await audit(getPool(), a, 'telephony.originate', 'call', String(r?.callId ?? 'outbound'), {
        after: { to: body.to, tenantId: targetTenant },
      });
      return sanitizeCallItem(r, isSuperAdminRole(a.role));
    },
  );

  app.get<{ Querystring: { limit?: string; search?: string; direction?: string; tenantId?: string } }>(
    '/telephony/calls/history',
    async (req) => {
      const a = actor(req);
      const isSuper = isSuperAdminRole(a.role);
      const qs = new URLSearchParams();
      if (req.query.limit) qs.set('limit', String(req.query.limit));
      if (req.query.search) qs.set('search', String(req.query.search));
      if (req.query.direction) qs.set('direction', String(req.query.direction));

      const [raw, tenantsRaw] = await Promise.all([
        proxyJson(a.workspaceId, `/v1/calls/history${qs.size ? `?${qs}` : ''}`),
        proxyJson(a.workspaceId, '/v1/tenants').catch(() => ({ tenants: [] })),
      ]);
      await syncAndFetchOwnership('agent', tenantsRaw?.tenants ?? []);
      const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');
      const reqTid = req.query.tenantId ? String(req.query.tenantId) : null;
      if (reqTid && !allowedAgents.has(reqTid)) {
        return { total: 0, history: [], viewMode: isSuper ? 'SUPER_ADMIN_FULL' : 'CLIENT_TIME_ONLY' };
      }

      const history = (Array.isArray(raw?.history) ? raw.history : [])
        .filter((h: any) => {
          const tid = String(h?.tenantId || 'default');
          if (reqTid && tid !== reqTid) return false;
          return allowedAgents.has(tid);
        })
        .map((h: any) => sanitizeCallItem(h, isSuper));

      return {
        total: history.length,
        history,
        viewMode: isSuper ? 'SUPER_ADMIN_FULL' : 'CLIENT_TIME_ONLY',
      };
    },
  );

  app.get<{ Params: { id: string } }>('/telephony/calls/:id', async (req) => {
    const a = actor(req);
    const call = await assertCallOwnership(a.workspaceId, req.params.id, a.role);
    return sanitizeCallItem(call, isSuperAdminRole(a.role));
  });

  app.get<{ Params: { id: string } }>('/telephony/calls/:id/transcript', async (req) => {
    const a = actor(req);
    await assertCallOwnership(a.workspaceId, req.params.id, a.role);
    return proxyJson(a.workspaceId, `/v1/calls/${enc(req.params.id)}/transcript`);
  });

  app.delete<{ Params: { id: string } }>('/telephony/calls/:id', operateGuard, async (req) => {
    const a = actor(req);
    await assertCallOwnership(a.workspaceId, req.params.id, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/calls/${enc(req.params.id)}`, { method: 'DELETE' });
    await audit(getPool(), a, 'telephony.hangup', 'call', req.params.id, { reason: 'Encerrada via DELETE no portal' });
    return r;
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/telephony/calls/:id/hangup',
    operateGuard,
    async (req) => {
      const a = actor(req);
      await assertCallOwnership(a.workspaceId, req.params.id, a.role);
      const reason = String(req.body?.reason || 'Encerrada pelo operador no Voll Plan');
      const r = await proxyJson(a.workspaceId, `/v1/calls/${enc(req.params.id)}/hangup`, jsonInit('POST', { reason }));
      await audit(getPool(), a, 'telephony.hangup', 'call', req.params.id, { reason });
      return r;
    },
  );

  for (const action of ['say', 'interrupt', 'transfer', 'dtmf', 'play', 'mute', 'unmute', 'hold', 'unhold', 'recording', 'crosstalk'] as const) {
    app.post<{ Params: { id: string } }>(
      `/telephony/calls/:id/${action}`,
      operateGuard,
      async (req) => {
        const a = actor(req);
        await assertCallOwnership(a.workspaceId, req.params.id, a.role);
        const r = await proxyJson(
          a.workspaceId,
          `/v1/calls/${enc(req.params.id)}/${action}`,
          jsonInit('POST', req.body ?? {}),
        );
        if (action === 'transfer' || action === 'recording') {
          await audit(getPool(), a, `telephony.${action}`, 'call', req.params.id, { after: req.body ?? {} });
        }
        return r;
      },
    );
  }

  // ---------------- Gravações Estéreo (.wav + .txt) ----------------
  app.get('/telephony/recordings', async (req) => {
    const a = actor(req);
    const tenantsRaw = await proxyJson(a.workspaceId, '/v1/tenants').catch(() => ({ tenants: [] }));
    await syncAndFetchOwnership('agent', tenantsRaw?.tenants ?? []);
    const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');
    if (allowedAgents.size === 0) return { count: 0, recordings: [] };

    const qs = `?tenantIds=${enc([...allowedAgents].join(','))}`;
    return proxyJson(a.workspaceId, `/v1/recordings${qs}`);
  });

  app.post<{ Body: { ids?: string[]; baseNames?: string[] } }>(
    '/telephony/recordings/batch-delete',
    manageGuard,
    async (req) => {
      const a = actor(req);
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : Array.isArray(req.body?.baseNames) ? req.body.baseNames : [];
      const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');
      const masterId = await getMasterWorkspaceId();
      const isMaster = masterId === a.workspaceId;
      for (const recId of ids) {
        if (!recordingMatchesAgent(String(recId), allowedAgents, isMaster)) {
          throw new HttpError(403, 'Acesso negado à gravação', `A gravação "${recId}" pertence a outra empresa.`);
        }
      }
      const r = await proxyJson(a.workspaceId, '/v1/recordings/batch-delete', jsonInit('POST', { ids }));
      await audit(getPool(), a, 'telephony.recordings_batch_delete', 'recording', `batch(${ids.length})`, { after: { ids } });
      return r;
    },
  );

  app.get<{ Params: { id: string } }>('/telephony/recordings/:id/transcript', async (req) => {
    const a = actor(req);
    const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');
    const masterId = await getMasterWorkspaceId();
    if (!recordingMatchesAgent(req.params.id, allowedAgents, masterId === a.workspaceId)) {
      throw new HttpError(403, 'Acesso negado à gravação', 'Esta gravação pertence a outra empresa.');
    }
    return proxyJson(a.workspaceId, `/v1/recordings/${enc(req.params.id)}/transcript`);
  });

  app.delete<{ Params: { id: string } }>('/telephony/recordings/:id', manageGuard, async (req) => {
    const a = actor(req);
    const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');
    const masterId = await getMasterWorkspaceId();
    if (!recordingMatchesAgent(req.params.id, allowedAgents, masterId === a.workspaceId)) {
      throw new HttpError(403, 'Acesso negado à gravação', 'Esta gravação pertence a outra empresa.');
    }
    const r = await proxyJson(a.workspaceId, `/v1/recordings/${enc(req.params.id)}`, { method: 'DELETE' });
    await audit(getPool(), a, 'telephony.recording_deleted', 'recording', req.params.id);
    return r;
  });

  app.get<{ Params: { id: string } }>('/telephony/recordings/:id/audio', async (req, reply: FastifyReply) => {
    const a = actor(req);
    const allowedAgents = await getWorkspaceResourceIds(a.workspaceId, 'agent');
    const masterId = await getMasterWorkspaceId();
    if (!recordingMatchesAgent(req.params.id, allowedAgents, masterId === a.workspaceId)) {
      throw new HttpError(403, 'Acesso negado à gravação', 'Esta gravação pertence a outra empresa.');
    }
    const reqHeaders: Record<string, string> = {};
    if (req.headers.range) reqHeaders.Range = String(req.headers.range);
    const res = await callGateway(
      a.workspaceId,
      `/v1/recordings/${enc(req.params.id)}/audio`,
      { headers: reqHeaders },
      LONG_TIMEOUT_MS,
    );
    if (!res.ok || !res.body) {
      throw new HttpError(res.status === 404 ? 404 : 502, 'Gravação indisponível', `HTTP ${res.status}`);
    }
    if (!req.headers.range) {
      await audit(getPool(), a, 'telephony.recording_played', 'recording', req.params.id);
    }
    reply.code(res.status === 206 ? 206 : 200);
    reply.header('Content-Type', res.headers.get('content-type') ?? 'audio/wav');
    reply.header('Accept-Ranges', res.headers.get('accept-ranges') ?? 'bytes');
    const cr = res.headers.get('content-range');
    if (cr) reply.header('Content-Range', cr);
    const len = res.headers.get('content-length');
    if (len) reply.header('Content-Length', len);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(res.body);
  });

  // ---------------- Agentes de Voz (Tenants) ----------------
  app.get('/telephony/tenants', async (req) => {
    const a = actor(req);
    const raw = await proxyJson(a.workspaceId, '/v1/tenants');
    const list = Array.isArray(raw?.tenants) ? raw.tenants : [];
    const ownership = await syncAndFetchOwnership('agent', list);
    const filtered = list.filter((t: any) => ownership.get(String(t?.id ?? ''))?.workspace_id === a.workspaceId);
    return { count: filtered.length, tenants: filtered };
  });

  app.get<{ Params: { id: string } }>('/telephony/tenants/:id', async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
    await assertCanCreateOrModifyResource('agent', req.params.id, a.workspaceId, a.role);
    return proxyJson(a.workspaceId, `/v1/tenants/${enc(req.params.id)}`);
  });

  app.post('/telephony/tenants', manageGuard, async (req) => {
    const a = actor(req);
    const body = (req.body ?? {}) as Record<string, any>;
    const rid = String(body.id || '').trim();
    if (!rid || !/^[a-z0-9][a-z0-9_-]{2,48}$/i.test(rid)) {
      throw new HttpError(400, 'ID de agente inválido', 'Use entre 3 e 48 caracteres alfanuméricos, "-" ou "_".');
    }
    await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
    await assertCanCreateOrModifyResource('agent', rid, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, '/v1/tenants', jsonInit('POST', body));
    const savedId = String(r?.tenant?.id || r?.id || rid || '');
    if (savedId) await upsertResourceOwnership('agent', savedId, a.workspaceId, false);
    await audit(getPool(), a, 'telephony.tenant_upsert', 'tenant', savedId || 'new', { after: { ...body, openaiApiKey: undefined, elevenlabsApiKey: undefined } });
    return r;
  });

  app.put<{ Params: { id: string } }>('/telephony/tenants/:id', manageGuard, async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
    await assertCanCreateOrModifyResource('agent', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/tenants/${enc(req.params.id)}`, jsonInit('PUT', req.body ?? {}));
    await upsertResourceOwnership('agent', req.params.id, a.workspaceId, false);
    await audit(getPool(), a, 'telephony.tenant_upsert', 'tenant', req.params.id, { after: { ...(req.body ?? {}), openaiApiKey: undefined, elevenlabsApiKey: undefined } });
    return r;
  });

  app.delete<{ Params: { id: string } }>('/telephony/tenants/:id', manageGuard, async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
    await assertCanCreateOrModifyResource('agent', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/tenants/${enc(req.params.id)}`, { method: 'DELETE' });
    await getPool()
      .query(`DELETE FROM workspace_voice_resources WHERE resource_type='agent' AND resource_id=$1`, [req.params.id])
      .catch(() => {});
    await audit(getPool(), a, 'telephony.tenant_delete', 'tenant', req.params.id);
    return r;
  });

  // ---------------- Ramais SIP & Softphones (1000-1010, 9000, *99) ----------------
  app.get('/telephony/extensions/config', async (req) => proxyJson(actor(req).workspaceId, '/v1/extensions/config'));

  app.post('/telephony/extensions/generate-range', manageGuard, async (req) => {
    const a = actor(req);
    const r = await proxyJson(a.workspaceId, '/v1/extensions/generate-range', jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS);
    const list = await proxyJson(a.workspaceId, '/v1/extensions').catch(() => ({ extensions: [] }));
    const created = Array.isArray(r?.extensions) ? r.extensions : [];
    for (const ext of created) {
      const eid = String(ext?.extension || ext?.id || '');
      if (eid) await upsertResourceOwnership('extension', eid, a.workspaceId, false);
    }
    await syncAndFetchOwnership('extension', list?.extensions ?? []);
    return r;
  });

  app.post('/telephony/extensions/sync', manageGuard, async (req) =>
    proxyJson(actor(req).workspaceId, '/v1/extensions/sync', jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS),
  );

  app.get('/telephony/extensions', async (req) => {
    const a = actor(req);
    const canSeeSipSecret = isSuperAdminRole(a.role) || CAN.admin.includes(a.role as any);
    const raw = await proxyJson(a.workspaceId, '/v1/extensions');
    const list = Array.isArray(raw?.extensions) ? raw.extensions : [];
    const ownership = await syncAndFetchOwnership('extension', list);
    const filtered = list
      .filter((e: any) => {
        const eid = String(e?.id ?? e?.extension ?? '');
        return ownership.get(eid)?.workspace_id === a.workspaceId;
      })
      .map((e: any) => (canSeeSipSecret ? e : { ...e, password: '', hasPassword: Boolean(e.password) }));
    return { ...raw, count: filtered.length, extensions: filtered };
  });

  app.post('/telephony/extensions', manageGuard, async (req) => {
    const a = actor(req);
    const body = (req.body ?? {}) as Record<string, any>;
    const eid = String(body.extension || body.id || '').trim();
    await ensureOwnershipSynced(a.workspaceId, 'extension', '/v1/extensions', 'extensions');
    if (eid) await assertCanCreateOrModifyResource('extension', eid, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, '/v1/extensions', jsonInit('POST', body));
    const savedId = String(r?.extension?.extension || r?.extension?.id || eid || '');
    if (savedId) await upsertResourceOwnership('extension', savedId, a.workspaceId, false);
    return r;
  });

  app.get<{ Params: { id: string } }>('/telephony/extensions/:id', async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('extension', req.params.id, a.workspaceId, a.role);
    return proxyJson(a.workspaceId, `/v1/extensions/${enc(req.params.id)}`);
  });

  app.put<{ Params: { id: string } }>('/telephony/extensions/:id', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('extension', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/extensions/${enc(req.params.id)}`, jsonInit('PUT', req.body ?? {}));
    await upsertResourceOwnership('extension', req.params.id, a.workspaceId, false);
    return r;
  });

  app.delete<{ Params: { id: string } }>('/telephony/extensions/:id', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('extension', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/extensions/${enc(req.params.id)}`, { method: 'DELETE' });
    await getPool()
      .query(`DELETE FROM workspace_voice_resources WHERE resource_type='extension' AND resource_id=$1`, [req.params.id])
      .catch(() => {});
    return r;
  });

  app.post<{ Params: { id: string } }>('/telephony/extensions/:id/test-call', operateGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('extension', req.params.id, a.workspaceId, a.role);
    return proxyJson(a.workspaceId, `/v1/extensions/${enc(req.params.id)}/test-call`, jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS);
  });

  // ---------------- Troncos SIP Híbridos (Global Default + Tenant BYOK) & Provedores ----------------
  app.get('/telephony/trunks', async (req) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const isViewer = isReadOnlyRole(a.role);
    const raw = await proxyJson(a.workspaceId, '/v1/trunks');
    const list = Array.isArray(raw?.trunks) ? raw.trunks : [];
    const ownership = await syncAndFetchOwnership('trunk', list);

    const visible = list
      .filter((t: any) => {
        const own = ownership.get(String(t?.id ?? ''));
        return own?.is_global_default || own?.workspace_id === a.workspaceId;
      })
      .map((t: any) => sanitizeTrunkForTenant(t, ownership.get(String(t?.id ?? '')), isSuper, isViewer));

    return { trunks: visible, count: visible.length };
  });

  app.post('/telephony/trunks', manageGuard, async (req) => {
    const a = actor(req);
    const body = { ...(req.body ?? {}) } as Record<string, any>;
    const tid = String(body.id || '').trim();
    const wantsGlobal = body.isGlobalDefault === true || body.ownerMode === 'GLOBAL_DEFAULT';
    await ensureOwnershipSynced(a.workspaceId, 'trunk', '/v1/trunks', 'trunks');
    if (tid) await assertCanCreateOrModifyResource('trunk', tid, a.workspaceId, a.role, wantsGlobal);
    else if (wantsGlobal && !isSuperAdminRole(a.role)) {
      throw new HttpError(403, 'Acesso restrito ao Super Admin', 'Somente Super Admin pode publicar Troncos Globais Default.');
    }

    delete body.isGlobalDefault;
    delete body.ownerMode;
    const r = await proxyJson(a.workspaceId, '/v1/trunks', jsonInit('POST', body), LONG_TIMEOUT_MS);
    const savedId = String(r?.trunk?.id || r?.id || tid || '');
    if (savedId) await upsertResourceOwnership('trunk', savedId, a.workspaceId, wantsGlobal);
    await audit(getPool(), a, 'telephony.trunk_upsert', 'trunk', savedId || 'new', {
      after: { id: savedId, proxy: body.proxy, isGlobalDefault: wantsGlobal },
    });
    return r;
  });

  app.get<{ Params: { id: string } }>('/telephony/trunks/:id', async (req) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const raw = await proxyJson(a.workspaceId, `/v1/trunks/${enc(req.params.id)}`);
    const own = await one<ResourceOwnership>(
      getPool(),
      `SELECT resource_id, workspace_id, is_global_default, owner_mode FROM workspace_voice_resources WHERE resource_type='trunk' AND resource_id=$1`,
      [req.params.id],
    ).catch(() => null);
    if (own && !own.is_global_default && own.workspace_id !== a.workspaceId) {
      throw new HttpError(403, 'Acesso negado ao tronco', 'Este tronco BYOK pertence a outra empresa.');
    }
    return sanitizeTrunkForTenant(raw, own ?? undefined, isSuper);
  });

  app.get<{ Params: { id: string } }>('/telephony/trunks/:id/status', async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'trunk', '/v1/trunks', 'trunks');
    const own = await one<ResourceOwnership>(
      getPool(),
      `SELECT resource_id, workspace_id, is_global_default, owner_mode FROM workspace_voice_resources WHERE resource_type='trunk' AND resource_id=$1`,
      [req.params.id],
    ).catch(() => null);
    if (own && !own.is_global_default && own.workspace_id !== a.workspaceId) {
      throw new HttpError(403, 'Acesso negado ao tronco', 'Este tronco BYOK pertence a outra empresa.');
    }
    return proxyJson(a.workspaceId, `/v1/trunks/${enc(req.params.id)}/status`);
  });

  app.put<{ Params: { id: string } }>('/telephony/trunks/:id', manageGuard, async (req) => {
    const a = actor(req);
    const body = { ...(req.body ?? {}) } as Record<string, any>;
    const wantsGlobal = body.isGlobalDefault === true || body.ownerMode === 'GLOBAL_DEFAULT';
    await ensureOwnershipSynced(a.workspaceId, 'trunk', '/v1/trunks', 'trunks');
    await assertCanCreateOrModifyResource('trunk', req.params.id, a.workspaceId, a.role, wantsGlobal);
    delete body.isGlobalDefault;
    delete body.ownerMode;
    const r = await proxyJson(a.workspaceId, `/v1/trunks/${enc(req.params.id)}`, jsonInit('PUT', body), LONG_TIMEOUT_MS);
    if (isSuperAdminRole(a.role) && Object.prototype.hasOwnProperty.call(req.body ?? {}, 'isGlobalDefault')) {
      await upsertResourceOwnership('trunk', req.params.id, a.workspaceId, wantsGlobal);
    }
    return r;
  });

  app.delete<{ Params: { id: string } }>('/telephony/trunks/:id', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('trunk', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/trunks/${enc(req.params.id)}`, { method: 'DELETE' }, LONG_TIMEOUT_MS);
    await getPool()
      .query(`DELETE FROM workspace_voice_resources WHERE resource_type='trunk' AND resource_id=$1`, [req.params.id])
      .catch(() => {});
    return r;
  });

  app.post<{ Params: { id: string } }>('/telephony/trunks/:id/register', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('trunk', req.params.id, a.workspaceId, a.role);
    return proxyJson(a.workspaceId, `/v1/trunks/${enc(req.params.id)}/register`, jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS);
  });

  app.post<{ Params: { id: string } }>('/telephony/trunks/:id/toggle', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('trunk', req.params.id, a.workspaceId, a.role);
    return proxyJson(a.workspaceId, `/v1/trunks/${enc(req.params.id)}/toggle`, jsonInit('POST', req.body ?? {}));
  });

  app.get('/telephony/providers', async (req) => {
    const a = actor(req);
    const raw = await proxyJson(a.workspaceId, '/v1/providers');
    if (isSuperAdminRole(a.role)) return raw;
    const providers = (Array.isArray(raw?.providers) ? raw.providers : []).map((p: any) => ({
      ...p,
      apiKey: undefined,
      secret: undefined,
      readOnly: true,
    }));
    return { ...raw, providers };
  });
  app.post('/telephony/providers', manageGuard, async (req) => {
    const a = actor(req);
    if (!isSuperAdminRole(a.role)) {
      throw new HttpError(403, 'Acesso restrito ao Super Admin', 'Somente Super Admin gerencia provedores SIP de catálogo global.');
    }
    return proxyJson(a.workspaceId, '/v1/providers', jsonInit('POST', req.body ?? {}));
  });
  app.delete<{ Params: { id: string } }>('/telephony/providers/:id', manageGuard, async (req) => {
    const a = actor(req);
    if (!isSuperAdminRole(a.role)) {
      throw new HttpError(403, 'Acesso restrito ao Super Admin', 'Somente Super Admin gerencia provedores SIP de catálogo global.');
    }
    return proxyJson(a.workspaceId, `/v1/providers/${enc(req.params.id)}`, { method: 'DELETE' });
  });

  // ---------------- Rotas de Entrada (DIDs) ----------------
  app.get('/telephony/routes', async (req) => {
    const a = actor(req);
    const raw = await proxyJson(a.workspaceId, '/v1/routes');
    const list = Array.isArray(raw?.routes) ? raw.routes : [];
    const ownership = await syncAndFetchOwnership('route', list);
    const filtered = list.filter((rt: any) => ownership.get(String(rt?.id ?? ''))?.workspace_id === a.workspaceId);
    return { ...raw, routes: filtered, count: filtered.length };
  });

  app.post('/telephony/routes', manageGuard, async (req) => {
    const a = actor(req);
    const body = (req.body ?? {}) as Record<string, any>;
    const rid = String(body.id || '').trim();
    await ensureOwnershipSynced(a.workspaceId, 'route', '/v1/routes', 'routes');
    if (rid) await assertCanCreateOrModifyResource('route', rid, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, '/v1/routes', jsonInit('POST', body));
    const savedId = String(r?.route?.id || r?.id || rid || '');
    if (savedId) await upsertResourceOwnership('route', savedId, a.workspaceId, false);
    return r;
  });

  app.post<{ Body: { ids?: string[] } }>('/telephony/routes/reorder', manageGuard, async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'route', '/v1/routes', 'routes');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    for (const rid of ids) {
      await assertCanCreateOrModifyResource('route', rid, a.workspaceId, a.role);
    }
    return proxyJson(a.workspaceId, '/v1/routes/reorder', jsonInit('POST', { ids }));
  });
  app.post<{ Body: { ruleId?: string; tenantId?: string } }>('/telephony/routes/simulate', operateGuard, async (req) => {
    const a = actor(req);
    const ruleId = req.body?.ruleId ? String(req.body.ruleId) : '';
    if (ruleId) {
      await ensureOwnershipSynced(a.workspaceId, 'route', '/v1/routes', 'routes');
      await assertCanCreateOrModifyResource('route', ruleId, a.workspaceId, a.role);
    }
    return proxyJson(a.workspaceId, '/v1/routes/simulate', jsonInit('POST', req.body ?? {}));
  });
  app.post<{ Body: { ruleId?: string; tenantId?: string } }>('/telephony/routes/test-call', operateGuard, async (req) => {
    const a = actor(req);
    const ruleId = req.body?.ruleId ? String(req.body.ruleId) : '';
    if (ruleId) {
      await ensureOwnershipSynced(a.workspaceId, 'route', '/v1/routes', 'routes');
      await assertCanCreateOrModifyResource('route', ruleId, a.workspaceId, a.role);
    }
    const tid = req.body?.tenantId ? String(req.body.tenantId) : '';
    if (tid) {
      await ensureOwnershipSynced(a.workspaceId, 'agent', '/v1/tenants', 'tenants');
      await assertCanCreateOrModifyResource('agent', tid, a.workspaceId, a.role);
    }
    return proxyJson(a.workspaceId, '/v1/routes/test-call', jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS);
  });

  app.put<{ Params: { id: string } }>('/telephony/routes/:id', manageGuard, async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'route', '/v1/routes', 'routes');
    await assertCanCreateOrModifyResource('route', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/routes/${enc(req.params.id)}`, jsonInit('PUT', req.body ?? {}));
    await upsertResourceOwnership('route', req.params.id, a.workspaceId, false);
    return r;
  });

  app.delete<{ Params: { id: string } }>('/telephony/routes/:id', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('route', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/routes/${enc(req.params.id)}`, { method: 'DELETE' });
    await getPool()
      .query(`DELETE FROM workspace_voice_resources WHERE resource_type='route' AND resource_id=$1`, [req.params.id])
      .catch(() => {});
    return r;
  });

  // ---------------- Rotas de Saída PSTN ----------------
  app.get('/telephony/outbound-routes', async (req) => {
    const a = actor(req);
    const raw = await proxyJson(a.workspaceId, '/v1/outbound-routes');
    const list = Array.isArray(raw?.routes) ? raw.routes : [];
    const ownership = await syncAndFetchOwnership('outbound_route', list);
    const filtered = list.filter((rt: any) => ownership.get(String(rt?.id ?? ''))?.workspace_id === a.workspaceId);
    return { ...raw, routes: filtered, count: filtered.length };
  });

  app.post('/telephony/outbound-routes', manageGuard, async (req) => {
    const a = actor(req);
    const body = (req.body ?? {}) as Record<string, any>;
    const rid = String(body.id || '').trim();
    await ensureOwnershipSynced(a.workspaceId, 'outbound_route', '/v1/outbound-routes', 'routes');
    if (rid) await assertCanCreateOrModifyResource('outbound_route', rid, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, '/v1/outbound-routes', jsonInit('POST', body), LONG_TIMEOUT_MS);
    const savedId = String(r?.route?.id || r?.id || rid || '');
    if (savedId) await upsertResourceOwnership('outbound_route', savedId, a.workspaceId, false);
    return r;
  });

  app.post<{ Body: { ids?: string[] } }>('/telephony/outbound-routes/reorder', manageGuard, async (req) => {
    const a = actor(req);
    await ensureOwnershipSynced(a.workspaceId, 'outbound_route', '/v1/outbound-routes', 'routes');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    for (const rid of ids) {
      await assertCanCreateOrModifyResource('outbound_route', rid, a.workspaceId, a.role);
    }
    return proxyJson(a.workspaceId, '/v1/outbound-routes/reorder', jsonInit('POST', { ids }), LONG_TIMEOUT_MS);
  });
  app.post('/telephony/outbound-routes/sync', manageGuard, async (req) =>
    proxyJson(actor(req).workspaceId, '/v1/outbound-routes/sync', jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS),
  );

  app.put<{ Params: { id: string } }>('/telephony/outbound-routes/:id', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('outbound_route', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/outbound-routes/${enc(req.params.id)}`, jsonInit('PUT', req.body ?? {}), LONG_TIMEOUT_MS);
    await upsertResourceOwnership('outbound_route', req.params.id, a.workspaceId, false);
    return r;
  });

  app.delete<{ Params: { id: string } }>('/telephony/outbound-routes/:id', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('outbound_route', req.params.id, a.workspaceId, a.role);
    const r = await proxyJson(a.workspaceId, `/v1/outbound-routes/${enc(req.params.id)}`, { method: 'DELETE' }, LONG_TIMEOUT_MS);
    await getPool()
      .query(`DELETE FROM workspace_voice_resources WHERE resource_type='outbound_route' AND resource_id=$1`, [req.params.id])
      .catch(() => {});
    return r;
  });

  app.post<{ Params: { id: string } }>('/telephony/outbound-routes/:id/toggle', manageGuard, async (req) => {
    const a = actor(req);
    await assertCanCreateOrModifyResource('outbound_route', req.params.id, a.workspaceId, a.role);
    return proxyJson(a.workspaceId, `/v1/outbound-routes/${enc(req.params.id)}/toggle`, jsonInit('POST', req.body ?? {}), LONG_TIMEOUT_MS);
  });

  // ---------------- Provedor de IA (BYOK por Tenant + Global Master) & Custos Sanitizados ----------------
  app.get('/telephony/ai-providers', async (req) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const [raw, histRaw, epRow] = await Promise.all([
      proxyJson(a.workspaceId, '/v1/ai-providers'),
      proxyJson(a.workspaceId, '/v1/calls/history?limit=500').catch(() => ({ history: [] })),
      one<{ byok: Record<string, any> | null }>(
        getPool(),
        `SELECT config->'byokAi' AS byok FROM workspace_channel_endpoints WHERE workspace_id=$1`,
        [a.workspaceId],
      ).catch(() => null),
    ]);

    const timeStats = await computeWorkspaceCallDurationStats(a.workspaceId, histRaw?.history ?? []);
    const byokMap = epRow?.byok ?? {};

    if (isSuper) {
      return {
        ...raw,
        viewMode: 'SUPER_ADMIN_FULL',
        ...timeStats,
      };
    }

    const providers = (Array.isArray(raw?.providers) ? raw.providers : []).map((p: any) => {
      const localCfg = byokMap?.[p.id];
      const decKey = localCfg?.apiKey ? decryptSecret(String(localCfg.apiKey)) : '';
      return {
        id: p.id,
        name: p.name,
        active: localCfg?.active ?? p.active,
        defaultModel: localCfg?.defaultModel || p.defaultModel,
        defaultVoice: localCfg?.defaultVoice || p.defaultVoice,
        audioCodec: localCfg?.audioCodec || p.audioCodec,
        models: p.models,
        byokConfigured: Boolean(decKey),
        maskedByokKey: decKey ? maskSecret(decKey) : '',
      };
    });

    return {
      viewMode: 'CLIENT_TIME_ONLY',
      providers,
      ...timeStats,
    };
  });

  const handleAiProvUpdate = async (req: any) => {
    const a = actor(req);
    const providerId = String(req.params.id || '').trim();
    const body = (req.body ?? {}) as Record<string, any>;

    if (isSuperAdminRole(a.role)) {
      const r = await proxyJson(a.workspaceId, `/v1/ai-providers/${enc(providerId)}`, jsonInit('PUT', body));
      await audit(getPool(), a, 'telephony.ai_provider_update', 'ai_provider', providerId);
      return r;
    }

    // Cliente ADMIN salva chave/preferências BYOK criptografadas em seu próprio workspace
    const currentRow = await one<{ byok: Record<string, any> | null }>(
      getPool(),
      `SELECT config->'byokAi' AS byok FROM workspace_channel_endpoints WHERE workspace_id=$1`,
      [a.workspaceId],
    ).catch(() => null);
    const current = currentRow?.byok?.[providerId] ?? {};
    const encryptedKey =
      typeof body.apiKey === 'string' && body.apiKey.trim()
        ? encryptSecret(body.apiKey.trim())
        : current.apiKey ?? '';
    const nextEntry = {
      active: body.active !== undefined ? Boolean(body.active) : current.active ?? true,
      defaultModel: typeof body.defaultModel === 'string' && body.defaultModel.trim() ? body.defaultModel.trim() : current.defaultModel ?? '',
      defaultVoice: typeof body.defaultVoice === 'string' && body.defaultVoice.trim() ? body.defaultVoice.trim() : current.defaultVoice ?? '',
      audioCodec: typeof body.audioCodec === 'string' && body.audioCodec.trim() ? body.audioCodec.trim() : current.audioCodec ?? 'g711_ulaw',
      apiKey: encryptedKey,
    };
    const nextByok = { ...(currentRow?.byok ?? {}), [providerId]: nextEntry };

    await getPool().query(
      `INSERT INTO workspace_channel_endpoints (workspace_id, config, updated_at)
       VALUES ($1, jsonb_build_object('byokAi', $2::jsonb), now())
       ON CONFLICT (workspace_id) DO UPDATE
       SET config = jsonb_set(COALESCE(workspace_channel_endpoints.config, '{}'::jsonb), '{byokAi}', $2::jsonb, true),
           updated_at = now()`,
      [a.workspaceId, JSON.stringify(nextByok)],
    );
    await audit(getPool(), a, 'telephony.ai_provider_byok_update', 'ai_provider', providerId);
    const dec = decryptSecret(encryptedKey);
    return {
      ok: true,
      mode: 'TENANT_BYOK',
      provider: {
        id: providerId,
        active: nextEntry.active,
        defaultModel: nextEntry.defaultModel,
        defaultVoice: nextEntry.defaultVoice,
        audioCodec: nextEntry.audioCodec,
        byokConfigured: Boolean(dec),
        maskedByokKey: dec ? maskSecret(dec) : '',
      },
    };
  };

  app.put<{ Params: { id: string } }>('/telephony/ai-providers/:id', manageGuard, handleAiProvUpdate);
  app.post<{ Params: { id: string } }>('/telephony/ai-providers/:id', manageGuard, handleAiProvUpdate);

  app.get('/telephony/ai-costs', async (req) => {
    const a = actor(req);
    if (isSuperAdminRole(a.role)) {
      return proxyJson(a.workspaceId, '/v1/ai-costs/summary');
    }
    const histRaw = await proxyJson(a.workspaceId, '/v1/calls/history?limit=500').catch(() => ({ history: [] }));
    const timeStats = await computeWorkspaceCallDurationStats(a.workspaceId, histRaw?.history ?? []);
    return { viewMode: 'CLIENT_TIME_ONLY', ...timeStats };
  });

  app.get('/telephony/ai-costs/summary', async (req) => {
    const a = actor(req);
    if (isSuperAdminRole(a.role)) {
      return proxyJson(a.workspaceId, '/v1/ai-costs/summary');
    }
    const histRaw = await proxyJson(a.workspaceId, '/v1/calls/history?limit=500').catch(() => ({ history: [] }));
    const timeStats = await computeWorkspaceCallDurationStats(a.workspaceId, histRaw?.history ?? []);
    return { viewMode: 'CLIENT_TIME_ONLY', ...timeStats };
  });

  app.get<{ Querystring: { provider?: string; tenantId?: string; limit?: string } }>(
    '/telephony/ai-costs/statement',
    async (req) => {
      const a = actor(req);
      if (!isSuperAdminRole(a.role)) {
        const histRaw = await proxyJson(a.workspaceId, '/v1/calls/history?limit=500').catch(() => ({ history: [] }));
        const timeStats = await computeWorkspaceCallDurationStats(a.workspaceId, histRaw?.history ?? []);
        return { viewMode: 'CLIENT_TIME_ONLY', statement: [], summary: timeStats };
      }
      const qs = new URLSearchParams();
      if (req.query.provider) qs.set('provider', String(req.query.provider));
      if (req.query.tenantId) qs.set('tenantId', String(req.query.tenantId));
      if (req.query.limit) qs.set('limit', String(req.query.limit));
      return proxyJson(a.workspaceId, `/v1/ai-costs/statement${qs.size ? `?${qs}` : ''}`);
    },
  );
}
