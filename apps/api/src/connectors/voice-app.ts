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
import { one } from '../db/pool.js';
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
    maxDurationSec: Number(cfg.maxDurationSec || 300),
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
      contact_name: string | null;
      contact_ext_id: string;
      contact_attrs: Record<string, unknown> | null;
      tabulation_rules: Record<string, unknown> | null;
    }>(
      db,
      `SELECT a.workspace_id, a.campaign_id,
              c.name AS contact_name, c.external_id AS contact_ext_id, c.attributes AS contact_attrs,
              sv.config->'tabulationRules' AS tabulation_rules
         FROM attempts a
         JOIN contacts c ON c.id = a.contact_id
         LEFT JOIN strategy_versions sv ON sv.id = a.strategy_version_id
        WHERE a.id = $1`,
      [attempt.id],
    );
    if (!row) return { status: 'REJECTED', reason: 'ATTEMPT_NOT_FOUND' };

    const ep = await resolveEndpoint(db, connection.config, row.workspace_id);
    // agente de voz cadastrado na conexão: o tenant no gateway é a própria conexão, na versão publicada
    const agent = agentState(connection.config);
    let agentVersion: number | undefined;
    if (agent.agent) {
      if (!agent.inSync) {
        return { status: 'REJECTED', reason: `VOICE_AGENT_NOT_SYNCED: versão ${agent.version} ainda não publicada no gateway` };
      }
      agentVersion = agent.version;
      ep.tenantId = connection.id;
      ep.callerId = agent.agent.defaultCallerId;
      ep.maxDurationSec = agent.agent.maxDurationSec;
    }
    if (!ep.baseUrl || !ep.callerId) {
      return { status: 'REJECTED', reason: 'VOICE_APP_NOT_CONFIGURED: informe endereço do gateway e caller ID' };
    }

    let webhookSecret: string | undefined = (connection as any).webhook_secret;
    if (!webhookSecret) {
      const c = await one<{ webhook_secret: string }>(db, `SELECT webhook_secret FROM connections WHERE id = $1`, [connection.id]);
      webhookSecret = c?.webhook_secret;
    }

    const payload: VoiceCallRequest = {
      attemptId: attempt.id,
      traceId: attempt.trace_id,
      connectionId: connection.id,
      workspaceId: row.workspace_id,
      to: attempt.destination_address,
      from: ep.callerId,
      callerId: ep.callerId,
      tenantId: ep.tenantId,
      contact: {
        externalId: row.contact_ext_id,
        name: row.contact_name ?? 'Cliente',
        variables: row.contact_attrs ?? {},
      },
      campaign: { id: row.campaign_id },
      limits: { maxDurationSec: ep.maxDurationSec },
      allowedTabulations: row.tabulation_rules ? Object.keys(row.tabulation_rules) : undefined,
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
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.id, ...authHeaders(ep.token) },
        body: JSON.stringify(checked.data),
        signal: controller.signal,
      });

      // 429: capacidade indisponível ANTES da aceitação; o worker reagenda sem consumir tentativa
      if (res.status === 429) throw new TransientConnectorError('Gateway de voz sem capacidade (HTTP 429)');

      const body: any = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 201 || res.status === 202) {
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
