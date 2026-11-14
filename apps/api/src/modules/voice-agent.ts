/**
 * Cadastro único do agente de voz (fase 3 da consolidação com o gateway de voz).
 *
 * O agente (roteiro, voz, motor, AMD, caller IDs) vive na Conexão de voz do Voll Plan, versionado, e é
 * publicado no gateway como o tenant `<connectionId>` (`PUT /v1/tenants/:id`). Credenciais de IA ficam
 * no ambiente do gateway e nunca trafegam por aqui. O adaptador só despacha quando a versão publicada
 * é a versão cadastrada.
 */
import type { FastifyInstance } from 'fastify';
import { VoiceAgentSchema, VoiceAgentTenantSchema, type VoiceAgent, type VoiceAgentTenant } from '@voll/shared';
import { getPool, one, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { badRequest, notFound, parse } from '../lib/problem.js';
import { audit } from '../lib/audit.js';

const SYNC_TIMEOUT_MS = 5000;

type Conn = { id: string; workspace_id: string; provider: string; config: any; active: boolean };

export type VoiceAgentState = {
  agent: VoiceAgent | null;
  version: number;
  syncedVersion: number | null;
  syncedAt: string | null;
  syncError: string | null;
  inSync: boolean;
};

export function agentState(config: any): VoiceAgentState {
  const version = Number(config?.voiceAgentVersion ?? 0);
  const syncedVersion = config?.voiceAgentSyncedVersion ?? null;
  return {
    agent: config?.voiceAgent ?? null,
    version,
    syncedVersion,
    syncedAt: config?.voiceAgentSyncedAt ?? null,
    syncError: config?.voiceAgentSyncError ?? null,
    inSync: version > 0 && syncedVersion === version,
  };
}

/** Monta o tenant publicado no gateway a partir do agente cadastrado (mesmo contrato que o gateway valida). */
export function toTenant(conn: { id: string; workspace_id: string; active: boolean }, agent: VoiceAgent, version: number): VoiceAgentTenant {
  const allowed = agent.allowedCallerIds.length ? agent.allowedCallerIds : [agent.defaultCallerId];
  return VoiceAgentTenantSchema.parse({
    id: conn.id,
    name: agent.name,
    vollWorkspaceId: conn.workspace_id,
    vollAgentVersion: version,
    stsEngine: agent.engine,
    openaiModel: agent.openaiModel,
    voice: agent.voice,
    elevenlabsVoiceId: agent.elevenlabsVoiceId,
    elevenlabsModel: agent.elevenlabsModel,
    instructions: agent.instructions,
    greetingInstructions: agent.greeting ?? null,
    maxDurationSec: agent.maxDurationSec,
    amd: agent.amd,
    stt: agent.stt,
    bargeinLevel: agent.bargeinLevel,
    allowedCallerIds: allowed,
    extension: null,
    dids: [],
    active: conn.active,
  });
}

async function loadVoiceConnection(id: string, workspaceId: string, forUpdate = false, db: any = getPool()): Promise<Conn> {
  const c = await one<Conn>(
    db,
    `SELECT id, workspace_id, provider, config, active FROM connections WHERE id=$1 AND workspace_id=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, workspaceId],
  );
  if (!c) throw notFound('Conexão');
  if (c.provider !== 'VOICE_APP') throw badRequest('Agente de voz só existe em conexões do gateway de voz (VOICE_APP)');
  return c;
}

async function gatewayEndpoint(conn: Conn): Promise<{ baseUrl: string; token: string }> {
  const cfg = conn.config ?? {};
  let baseUrl = String(cfg.voiceAppBaseUrl || '');
  let token = String(cfg.voiceAppToken || '');
  if (!baseUrl || !token) {
    const ep = await one<{ config: any }>(getPool(), `SELECT config FROM workspace_channel_endpoints WHERE workspace_id=$1`, [conn.workspace_id]);
    baseUrl ||= String(ep?.config?.voice?.voiceAppBaseUrl || '');
    token ||= String(ep?.config?.voice?.voiceAppToken || '');
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

async function gatewayFetch(conn: Conn, path: string, init: RequestInit = {}): Promise<Response> {
  const gw = await gatewayEndpoint(conn);
  if (!gw.baseUrl) throw new Error('Endereço do gateway de voz não configurado');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    return await fetch(`${gw.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(gw.token ? { Authorization: `Bearer ${gw.token}` } : {}), ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Publica o agente no gateway. Devolve o erro (texto) ou null. Nunca lança: a falha fica registrada. */
async function publish(conn: Conn, tenant: VoiceAgentTenant): Promise<string | null> {
  try {
    const res = await gatewayFetch(conn, `/v1/tenants/${encodeURIComponent(tenant.id)}`, { method: 'PUT', body: JSON.stringify(tenant) });
    if (res.ok) return null;
    const body: any = await res.json().catch(() => ({}));
    return `Gateway respondeu HTTP ${res.status}${body?.error ? ` (${body.error})` : ''}${body?.details ? `: ${[].concat(body.details).join('; ')}` : ''}`;
  } catch (err: any) {
    if (String(err?.message).startsWith('Endereço do gateway')) return err.message;
    return `Gateway inacessível: ${err?.name === 'AbortError' ? 'tempo esgotado' : err?.message ?? 'erro de rede'}`;
  }
}

/**
 * O Postgres do Voll Plan é a fonte da verdade dos agentes; o gateway é cache (fase 6).
 * Republica todo agente sincronizado que sumiu do gateway (reinício, disco perdido, nó novo) ou que
 * está em outra versão. Roda no worker; nunca publica uma versão ainda não liberada pelo usuário.
 */
export async function reconcileVoiceAgents(): Promise<{ checked: number; republished: number; failed: number }> {
  const conns = (
    await getPool().query<Conn>(
      `SELECT id, workspace_id, provider, config, active FROM connections
        WHERE provider='VOICE_APP' AND (config->>'voiceAgentSyncedVersion') IS NOT NULL`,
    )
  ).rows;
  let republished = 0;
  let failed = 0;
  for (const conn of conns) {
    const st = agentState(conn.config);
    if (!st.agent || st.syncedVersion == null) continue;
    const version = st.syncedVersion;
    try {
      const res = await gatewayFetch(conn, `/v1/tenants/${encodeURIComponent(conn.id)}`);
      const remote: any = res.ok ? await res.json().catch(() => null) : null;
      if (res.ok && remote?.vollAgentVersion === version && remote?.active === conn.active) continue;
      if (!res.ok && res.status !== 404) {
        failed++;
        continue;
      }
    } catch {
      failed++;
      continue;
    }
    // só republica a versão que já tinha sido publicada; uma versão nova continua aguardando o usuário
    if (Number(conn.config?.voiceAgentVersion) !== version) continue;
    const error = await publish(conn, toTenant(conn, st.agent, version));
    if (error) failed++;
    else republished++;
  }
  return { checked: conns.length, republished, failed };
}

export async function voiceAgentRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/connections/:id/voice-agent', async (req) => {
    const conn = await loadVoiceConnection(req.params.id, actor(req).workspaceId);
    return agentState(conn.config);
  });

  /** Salva uma nova versão do agente. Não publica: a conexão fica "fora de sincronia" até o sync. */
  app.put<{ Params: { id: string } }>('/connections/:id/voice-agent', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const agent = parse(VoiceAgentSchema, req.body);
    const a = actor(req);
    return tx(async (c) => {
      const conn = await loadVoiceConnection(req.params.id, a.workspaceId, true, c);
      const before = agentState(conn.config);
      const version = before.version + 1;
      const config = {
        ...(conn.config ?? {}),
        voiceAgent: agent,
        voiceAgentVersion: version,
        // o caller ID do agente passa a ser o da conexão: uma fonte só
        defaultCallerId: agent.defaultCallerId,
        maxDurationSec: agent.maxDurationSec,
        tenantId: conn.id,
      };
      await c.query(`UPDATE connections SET config=$2 WHERE id=$1`, [conn.id, config]);
      await audit(c, a, 'voice_agent.save', 'connection', conn.id, { before: before.agent, after: { ...agent, version } });
      return agentState(config);
    });
  });

  /** Publica a versão atual no gateway e registra o resultado. */
  app.post<{ Params: { id: string } }>('/connections/:id/voice-agent/sync', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const a = actor(req);
    const conn = await loadVoiceConnection(req.params.id, a.workspaceId);
    const state = agentState(conn.config);
    if (!state.agent) throw badRequest('Cadastre o agente de voz antes de publicar');
    const tenant = toTenant(conn, state.agent, state.version);
    const error = await publish(conn, tenant);
    if (!error) {
      await getPool()
        .query(
          `INSERT INTO workspace_voice_resources (resource_type, resource_id, workspace_id, is_global_default, owner_mode, updated_at)
           VALUES ('agent', $1, $2, false, 'TENANT_BYOK', now())
           ON CONFLICT (resource_type, resource_id) DO UPDATE
           SET workspace_id = EXCLUDED.workspace_id,
               is_global_default = false,
               owner_mode = 'TENANT_BYOK',
               updated_at = now()`,
          [tenant.id, a.workspaceId],
        )
        .catch(() => {});
    }
    return tx(async (c) => {
      // grava sobre a configuração atual: outra edição pode ter chegado durante o HTTP
      const cur = await loadVoiceConnection(conn.id, a.workspaceId, true, c);
      const cfg = { ...(cur.config ?? {}) };
      if (error) {
        cfg.voiceAgentSyncError = error;
      } else if (Number(cfg.voiceAgentVersion) === state.version) {
        cfg.voiceAgentSyncedVersion = state.version;
        cfg.voiceAgentSyncedAt = new Date().toISOString();
        cfg.voiceAgentSyncError = null;
      }
      await c.query(`UPDATE connections SET config=$2 WHERE id=$1`, [cur.id, cfg]);
      await audit(c, a, error ? 'voice_agent.sync_failed' : 'voice_agent.sync', 'connection', cur.id, {
        after: { version: state.version, error },
      });
      return { ...agentState(cfg), published: !error };
    });
  });
}
