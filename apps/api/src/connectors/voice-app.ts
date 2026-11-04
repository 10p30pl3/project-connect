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
    const baseUrl = (cfg.voiceAppBaseUrl || cfg.endpointUrl || 'http://127.0.0.1:5050').replace(/\/+$/, '');
    const token = cfg.voiceAppToken || '';
    const callerId = cfg.defaultCallerId || '+551140030000';

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

    const payload = {
      attemptId: attempt.id,
      traceId: attempt.trace_id,
      connectionId: connection.id,
      workspaceId: row?.workspace_id,
      to: attempt.destination_address,
      callerId,
      contact: {
        externalId: row?.contact_ext_id ?? attempt.id,
        name: row?.contact_name ?? 'Cliente',
        variables: row?.contact_attrs ?? {},
      },
      campaign: {
        id: row?.campaign_id,
      },
      limits: {
        maxDurationSec: 300,
      },
      callback: {
        url: `${config.publicUrl}/connectors/${connection.id}/events`,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

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

      if (res.status === 200 || res.status === 202) {
        const providerAttemptId = body.providerAttemptId || body.id || `va-${attempt.id}`;
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
    const baseUrl = (cfg.voiceAppBaseUrl || cfg.endpointUrl || 'http://127.0.0.1:5050').replace(/\/+$/, '');
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
    const baseUrl = (cfg.voiceAppBaseUrl || cfg.endpointUrl || 'http://127.0.0.1:5050').replace(/\/+$/, '');
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
