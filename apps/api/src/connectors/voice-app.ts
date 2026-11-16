/**
 * Adaptador do canal de voz para o gateway de voz (apps/voice-gateway: FreeSWITCH + agente de IA).
 *
 * Contrato único em `@voll/shared`: a ordem é um `VoiceCallRequest` validado antes do envio e o gateway
 * valida o mesmo schema (JSON Schema gerado em packages/shared/contracts). O retorno chega pelo webhook
 * `POST /api/connectors/:id/events` como `ConnectorEvent` assinado com HMAC.
 *
 * Sem valores de fallback: endereço do gateway e caller ID vêm da conexão ou dos Endereços Técnicos do
 * workspace. Faltando um deles, a ordem é rejeitada (REJECTED) e nenhuma chamada é feita.
 */
import { VoiceCallRequestSchema, type VoiceCallRequest } from '@voll/shared';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { one, q } from '../db/pool.js';
import type { ConnectorAdapter, SendInput, SendResult } from './adapter.js';
import { TransientConnectorError } from './adapter.js';
import { agentState } from '../modules/voice-agent.js';

const SEND_TIMEOUT_MS = 5000;

type Endpoint = { baseUrl: string; token: string; callerId: string; tenantId: string; maxDurationSec: number };

/** Endereço do gateway: primeiro a configuração da conexão, depois os Endereços Técnicos do workspace. */
async function resolveEndpoint(db: Db | null, connectionConfig: any, workspaceId: string | null): Promise<Endpoint> {
  const cfg = connectionConfig ?? {};
  let baseUrl = String(cfg.voiceAppBaseUrl || cfg.endpointUrl || '');
  let token = String(cfg.voiceAppToken || '');
  let callerId = String(cfg.defaultCallerId || '');
  if (db && workspaceId && (!baseUrl || !token || !callerId)) {
    const ep = await one<{ config: any }>(db, `SELECT config FROM workspace_channel_endpoints WHERE workspace_id = $1`, [workspaceId]).catch(
      () => null,
    );
    const voice = ep?.config?.voice ?? {};
    baseUrl ||= String(voice.voiceAppBaseUrl || '');
    token ||= String(voice.voiceAppToken || '');
    callerId ||= String(voice.defaultCallerId || '');
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    callerId,
    tenantId: String(cfg.tenantId || 'default'),
    maxDurationSec: Number(cfg.maxDurationSec || 180),
  };
}

const authHeaders = (token: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

export const voiceAppAdapter: ConnectorAdapter = {
  capabilities: {
    statusQuery: true,
    cancel: true,
    asyncResults: true,
    maxBatch: 1,
  },

  async send(db: Db, { attempt, connection }: SendInput): Promise<SendResult> {
    const row = await one<{
      workspace_id: string;
      campaign_id: string;
      contact_id: string;
      contact_name: string | null;
      contact_ext_id: string;
      contact_attrs: Record<string, unknown> | null;
      campaign_trunk_ids: string[] | null;
      campaign_voice_agent_id: string | null;
      tabulation_rules: Record<string, unknown> | null;
      voice_overrides: Record<string, unknown> | null;
    }>(
      db,
      `SELECT a.workspace_id, a.campaign_id, a.contact_id,
              c.name AS contact_name, c.external_id AS contact_ext_id, c.attributes AS contact_attrs,
              cam.trunk_ids AS campaign_trunk_ids, cam.voice_agent_id AS campaign_voice_agent_id,
              sv.config->'tabulationRules' AS tabulation_rules,
              sv.config->'voiceOverrides' AS voice_overrides
         FROM attempts a
         JOIN contacts c ON c.id = a.contact_id
         JOIN campaigns cam ON cam.id = a.campaign_id
         LEFT JOIN strategy_versions sv ON sv.id = a.strategy_version_id
        WHERE a.id = $1`,
      [attempt.id],
    );
    if (!row) return { status: 'REJECTED', reason: 'ATTEMPT_NOT_FOUND' };

    const ep = await resolveEndpoint(db, connection.config, row.workspace_id);
    const campaignAgentId = typeof row.campaign_voice_agent_id === 'string' ? row.campaign_voice_agent_id.trim() : '';
    // agente de voz: prioriza escolha explícita da campanha (`campaigns.voice_agent_id`); caso contrário, herda da conexão
    const agent = agentState(connection.config);
    let agentVersion: number | undefined;
    let callerIdPool: string[] | undefined;
    const applyEmbeddedConnectionAgent = Boolean(agent.agent) && (!campaignAgentId || campaignAgentId === connection.id);
    if (applyEmbeddedConnectionAgent && agent.agent) {
      if (!agent.inSync) {
        return { status: 'REJECTED', reason: `VOICE_AGENT_NOT_SYNCED: versão ${agent.version} ainda não publicada no gateway` };
      }
      agentVersion = agent.version;
      ep.tenantId = connection.id;
      ep.callerId = agent.agent.defaultCallerId;
      ep.maxDurationSec = agent.agent.maxDurationSec;
      if (agent.agent.allowedCallerIds?.length) {
        callerIdPool = agent.agent.allowedCallerIds;
      }
    } else if (campaignAgentId) {
      ep.tenantId = campaignAgentId;
    }
    if (!ep.baseUrl || !ep.callerId) {
      return { status: 'REJECTED', reason: 'VOICE_APP_NOT_CONFIGURED: informe endereço do gateway e caller ID' };
    }

    const contactVariables: Record<string, unknown> = { ...(row.contact_attrs ?? {}) };
    if (agent.agent?.crossCallMemoryEnabled) {
      const prevRows = await q<{ tabulation_code: string | null; state_reason: string | null; extracted_data: any; finalized_at: string | null }>(
        db,
        `SELECT tabulation_code, state_reason, extracted_data, finalized_at
           FROM attempts
          WHERE workspace_id = $1 AND contact_id = $2 AND id <> $3 AND state = 'FINALIZED'
          ORDER BY finalized_at DESC NULLS LAST
          LIMIT 2`,
        [row.workspace_id, row.contact_id, attempt.id],
      ).catch(() => []);
      if (prevRows.length > 0) {
        contactVariables.__memory = prevRows
          .map((p) => {
            const extra = p.extracted_data && Object.keys(p.extracted_data).length ? JSON.stringify(p.extracted_data) : '';
            return `${p.finalized_at?.slice(0, 10) ?? 'anterior'}: ${p.tabulation_code ?? p.state_reason ?? 'contato'}${extra ? ` (${extra})` : ''}`;
          })
          .join(' | ')
          .slice(0, 1100);
      }
    }

    let webhookSecret: string | undefined = (connection as any).webhook_secret;
    if (!webhookSecret) {
      const c = await one<{ webhook_secret: string }>(db, `SELECT webhook_secret FROM connections WHERE id = $1`, [connection.id]);
      webhookSecret = c?.webhook_secret;
    }

    const campaignTrunkIds = Array.isArray(row.campaign_trunk_ids) ? row.campaign_trunk_ids.map(String).filter(Boolean) : [];
    const agentSource: VoiceCallRequest['agentSource'] = campaignAgentId
      ? 'campaign_override'
      : (connection.config as any)?.tenantId
        ? 'channel_default'
        : 'workspace_default';
    const trunkSource: VoiceCallRequest['trunkSource'] =
      campaignTrunkIds.length > 0 ? 'campaign_override' : 'outbound_route';
    const payload: VoiceCallRequest = {
      attemptId: attempt.id,
      traceId: attempt.trace_id,
      connectionId: connection.id,
      workspaceId: row.workspace_id,
      to: attempt.destination_address,
      from: ep.callerId,
      callerId: ep.callerId,
      ...(callerIdPool ? { callerIdPool } : {}),
      tenantId: ep.tenantId,
      agentSource,
      trunkSource,
      contact: {
        externalId: row.contact_ext_id,
        name: row.contact_name ?? 'Cliente',
        variables: contactVariables,
      },
      campaign: { id: row.campaign_id },
      limits: { maxDurationSec: ep.maxDurationSec },
      allowedTabulations: row.tabulation_rules ? Object.keys(row.tabulation_rules) : undefined,
      ...(campaignTrunkIds.length > 0 ? { trunkIds: campaignTrunkIds } : {}),
      ...(row.voice_overrides ? { agentOverrides: row.voice_overrides as any } : {}),
      agentVersion,
      callback: {
        url: `${config.publicUrl}/api/connectors/${connection.id}/events`,
        secret: webhookSecret ?? '',
      },
    };

    // mesmo schema que o gateway valida: uma ordem fora do contrato nunca sai daqui
    const checked = VoiceCallRequestSchema.safeParse(payload);
    if (!checked.success) {
      const why = checked.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
      return { status: 'REJECTED', reason: `INVALID_CALL_REQUEST: ${why}` };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${ep.baseUrl}/v1/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.id,
          'X-Correlation-Id': attempt.id,
          ...authHeaders(ep.token),
        },
        body: JSON.stringify(checked.data),
        signal: controller.signal,
      });

      const body: any = await res.json().catch(() => ({}));
      const isExplicitCapacity503 =
        res.status === 503 &&
        (body?.error === 'capacity_exceeded' || body?.error === 'tenant_capacity_exceeded');
      // 429 (ex.: trunk_capacity_exceeded) ou 503 explícito de capacidade indisponível ANTES da aceitação:
      // o worker reagenda sem consumir tentativa nem descartar o contato da fila
      if (res.status === 429 || isExplicitCapacity503) {
        const detailMsg = body?.error === 'trunk_capacity_exceeded' ? 'trunk_capacity_exceeded' : `HTTP ${res.status}`;
        throw new TransientConnectorError(`Gateway de voz sem capacidade (${detailMsg})`);
      }
      if (res.status === 200 || res.status === 201 || res.status === 202) {
        if (body?.trunkId) {
          await db.query(`UPDATE attempts SET trunk_id = $2 WHERE id = $1`, [attempt.id, String(body.trunkId)]).catch(() => {});
        }
        return { status: 'ACCEPTED', providerAttemptId: body.providerAttemptId || body.callId || body.id || `va-${attempt.id}` };
      }
      if (res.status === 409 && body?.error === 'agent_version_mismatch') {
        // o gateway recusou ANTES de aceitar: nenhuma chamada saiu; republicar o agente resolve
        return { status: 'REJECTED', reason: `AGENT_VERSION_MISMATCH: ${body.message ?? ''}`.trim() };
      }
      if (res.status === 409) {
        // mesma Idempotency-Key com payload diferente: não rediscar, investigar
        return { status: 'INCONCLUSIVE', reason: 'IDEMPOTENCY_CONFLICT', providerAttemptId: `va-${attempt.id}` };
      }
      if (res.status >= 400 && res.status < 500) {
        return { status: 'REJECTED', reason: body.error || body.reason || `HTTP_${res.status}` };
      }
      // 5xx ou desconhecido: a chamada pode ter sido aceita; reconciliar, nunca reenviar
      return { status: 'INCONCLUSIVE', reason: body.error || `HTTP_${res.status}`, providerAttemptId: `va-${attempt.id}` };
    } catch (err: any) {
      if (err instanceof TransientConnectorError) throw err;
      return { status: 'INCONCLUSIVE', reason: `NETWORK_ERROR: ${err?.message ?? 'timeout/refused'}`, providerAttemptId: `va-${attempt.id}` };
    } finally {
      clearTimeout(timeout);
    }
  },

  async queryStatus(attemptId: string, connection: any): Promise<{ status: string; result?: any }> {
    const ep = await resolveEndpoint(null, connection?.config, null);
    if (!ep.baseUrl) return { status: 'NOT_CONFIGURED' };
    try {
      const res = await fetch(`${ep.baseUrl}/v1/calls/${encodeURIComponent(attemptId)}`, { headers: authHeaders(ep.token) });
      if (res.ok) {
        const data: any = await res.json();
        return { status: data.status ?? 'UNKNOWN', result: data };
      }
      // 404 não prova que não houve chamada (§ contrato): fica UNKNOWN para reconciliação
      return { status: 'UNKNOWN' };
    } catch {
      return { status: 'UNREACHABLE' };
    }
  },

  async cancel(attemptId: string, connection: any): Promise<boolean> {
    const ep = await resolveEndpoint(null, connection?.config, null);
    if (!ep.baseUrl) return false;
    try {
      const res = await fetch(`${ep.baseUrl}/v1/calls/${encodeURIComponent(attemptId)}`, {
        method: 'DELETE',
        headers: authHeaders(ep.token),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
