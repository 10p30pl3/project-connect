/**
 * Adaptador de canal de voz integrado ao voice-app (FreeSWITCH + OpenAI Realtime).
 * Implementa o contrato ConnectorAdapter com Idempotency-Key, deduplicação durável e suporte a statusQuery e cancel.
 */
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import type { ConnectorAdapter, SendInput, SendResult } from './adapter.js';
import { TransientConnectorError } from './adapter.js';

export const voiceAppAdapter: ConnectorAdapter = {
  capabilities: {
    statusQuery: true,
    cancel: true,
    asyncResults: true,
    maxBatch: 1,
  },

  async send(db: Db, { attempt, connection }: SendInput): Promise<SendResult> {
    const cfg = connection.config ?? {};
    let baseUrl = (cfg.voiceAppBaseUrl || cfg.endpointUrl || '').replace(/\/+$/, '');
    let token = cfg.voiceAppToken || '';
    let callerId = cfg.defaultCallerId || '';

    const row = await one<{
      id: string;
      workspace_id: string;
      trace_id: string;
      destination_address: string;
      campaign_id: string;
      contact_name: string | null;
      contact_ext_id: string;
      contact_attrs: Record<string, unknown>;
    }>(
      db,
      `SELECT a.id, a.workspace_id, a.trace_id, a.destination_address, a.campaign_id,
              c.name AS contact_name, c.external_id AS contact_ext_id, c.attributes AS contact_attrs
         FROM attempts a
         JOIN contacts c ON c.id = a.contact_id
        WHERE a.id = $1`,
      [attempt.id],
    );

    // Se a conexão não especificar URL/Token próprios, herda dos Endereços Técnicos do Workspace
    if ((!baseUrl || !token) && row?.workspace_id) {
      try {
        const epRow = await one<{ config: any }>(
          db,
          `SELECT config FROM workspace_channel_endpoints WHERE workspace_id = $1`,
          [row.workspace_id],
        );
        if (epRow?.config?.voice) {
          if (!baseUrl) baseUrl = (epRow.config.voice.voiceAppBaseUrl || '').replace(/\/+$/, '');
          if (!token) token = epRow.config.voice.voiceAppToken || '';
          if (!callerId) callerId = epRow.config.voice.defaultCallerId || '';
        }
      } catch {
        /* fallback default */
      }
    }

    let webhookSecret = (connection as any).webhook_secret;
    if (!webhookSecret) {
      try {
        const cRow = await one<{ webhook_secret: string }>(db, `SELECT webhook_secret FROM connections WHERE id = $1`, [connection.id]);
        webhookSecret = cRow?.webhook_secret;
      } catch {
        /* fallback */
      }
    }

    if (!baseUrl) baseUrl = 'http://192.168.15.36:8090';
    if (!callerId) callerId = '+5511989785888';

    const payload = {
      attemptId: attempt.id,
      traceId: attempt.trace_id,
      connectionId: connection.id,
      workspaceId: row?.workspace_id,
      to: attempt.destination_address,
      from: callerId,
      callerId,
      tenantId: cfg.tenantId || 'default',
      contact: {
        externalId: row?.contact_ext_id ?? attempt.id,
        name: row?.contact_name ?? 'Cliente',
        variables: row?.contact_attrs ?? {},
      },
      campaign: {
        id: row?.campaign_id,
      },
      limits: {
        maxDurationSec: cfg.maxDurationSec || 300,
      },
      callback: {
        url: `${config.publicUrl}/api/connectors/${connection.id}/events`,
        secret: webhookSecret || '',
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${baseUrl}/v1/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.id,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429) {
        throw new TransientConnectorError('Voice-app com capacidade máxima atingida (HTTP 429)');
      }

      const body: any = await res.json().catch(() => ({}));

      if (res.status === 200 || res.status === 201 || res.status === 202) {
        const providerAttemptId = body.providerAttemptId || body.callId || body.id || `va-${attempt.id}`;
        return { status: 'ACCEPTED', providerAttemptId };
      }

      if (res.status >= 400 && res.status < 500) {
        return {
          status: 'REJECTED',
          reason: body.error || body.reason || `HTTP_${res.status}`,
        };
      }

      // 5xx ou desconhecido
      return {
        status: 'INCONCLUSIVE',
        reason: body.error || `HTTP_${res.status}`,
        providerAttemptId: `va-${attempt.id}`,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err instanceof TransientConnectorError) {
        throw err;
      }
      return {
        status: 'INCONCLUSIVE',
        reason: `NETWORK_ERROR: ${err.message ?? 'timeout/refused'}`,
        providerAttemptId: `va-${attempt.id}`,
      };
    }
  },

  async queryStatus(attemptId: string, connection: any): Promise<{ status: string; result?: any }> {
    const cfg = connection.config ?? {};
    const baseUrl = (cfg.voiceAppBaseUrl || cfg.endpointUrl || 'http://192.168.15.36:8090').replace(/\/+$/, '');
    const token = cfg.voiceAppToken || '';

    try {
      const res = await fetch(`${baseUrl}/v1/calls/${attemptId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        return { status: data.status, result: data };
      }
      return { status: 'UNKNOWN' };
    } catch {
      return { status: 'UNREACHABLE' };
    }
  },

  async cancel(attemptId: string, connection: any): Promise<boolean> {
    const cfg = connection.config ?? {};
    const baseUrl = (cfg.voiceAppBaseUrl || cfg.endpointUrl || 'http://192.168.15.36:8090').replace(/\/+$/, '');
    const token = cfg.voiceAppToken || '';

    try {
      const res = await fetch(`${baseUrl}/v1/calls/${attemptId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
