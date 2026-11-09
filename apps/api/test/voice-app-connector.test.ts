/**
 * Adaptador do gateway de voz + teste de contrato entre os dois lados do monorepo.
 * O lado do gateway é o próprio código de apps/voice-gateway (CommonJS), carregado com createRequire.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorEventSchema, VoiceCallRequestSchema } from '@voll/shared';
import { voiceAppAdapter } from '../src/connectors/voice-app.js';
import { TransientConnectorError } from '../src/connectors/adapter.js';

const require = createRequire(import.meta.url);
const gateway = require('../../voice-gateway/utils/voll-contract.js') as {
  validateCallRequest(body: unknown): { ok: boolean; errors: string[] };
  buildConnectorEvent(input: Record<string, unknown>): Record<string, unknown>;
};

const ATTEMPT = '7d1c3f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const CONNECTION = '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7';
const ROW = {
  workspace_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  campaign_id: '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9',
  contact_name: 'Carlos Oliveira',
  contact_ext_id: '00123',
  contact_attrs: { saldo: 'R$ 150,00' },
  tabulation_rules: { CONVERSION: 'FINISH_SUCCESS', NO_ANSWER: 'RETRY' },
};
const fakeDb = (row: any = ROW): any => ({ query: async () => ({ rows: row ? [row] : [] }) });
const input = (config: Record<string, unknown>) => ({
  attempt: { id: ATTEMPT, destination_address: '+5511988887777', channel_type: 'VOICE' as const, trace_id: 'trc-test-99' },
  connection: {
    id: CONNECTION,
    provider: 'VOICE_APP',
    channel_type: 'VOICE' as const,
    config,
    webhook_secret: 'whsec_test_secret_1234567890abcdef',
  } as any,
});
const configured = { voiceAppBaseUrl: 'http://127.0.0.1:5050/', defaultCallerId: '+551140030000' };

function mockFetch(status: number, body: unknown) {
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { status, ok: status < 300, json: async () => body } as any;
  }) as any;
  return calls;
}

describe('adaptador do gateway de voz', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('declara consulta e cancelamento', () => {
    expect(voiceAppAdapter.capabilities).toMatchObject({ statusQuery: true, cancel: true, asyncResults: true });
  });

  it('envia a ordem dentro do contrato, com Idempotency-Key = attemptId, e recebe 202', async () => {
    const calls = mockFetch(202, { ok: true, status: 'ACCEPTED', providerAttemptId: `va-${ATTEMPT}` });
    const res = await voiceAppAdapter.send(fakeDb(), input(configured));
    expect(res).toEqual({ status: 'ACCEPTED', providerAttemptId: `va-${ATTEMPT}` });
    expect(calls[0].url).toBe('http://127.0.0.1:5050/v1/calls');
    expect(calls[0].init.headers['Idempotency-Key']).toBe(ATTEMPT);
    const body = JSON.parse(calls[0].init.body);
    expect(VoiceCallRequestSchema.safeParse(body).success).toBe(true);
    expect(body.callerId).toBe('+551140030000');
    expect(body.allowedTabulations).toEqual(['CONVERSION', 'NO_ANSWER']);
    expect(body.callback.url).toContain(`/api/connectors/${CONNECTION}/events`);
  });

  it('CONTRATO: a ordem que o Voll Plan envia passa na validação do gateway', async () => {
    const calls = mockFetch(202, { ok: true, status: 'ACCEPTED', providerAttemptId: `va-${ATTEMPT}` });
    await voiceAppAdapter.send(fakeDb(), input(configured));
    const verdict = gateway.validateCallRequest(JSON.parse(calls[0].init.body));
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('CONTRATO: todo evento que o gateway monta passa no schema do Voll Plan', () => {
    for (const tabulationCode of ['CONVERSION', 'CPC_NO_DEAL', 'WRONG_PERSON', 'OPT_OUT', 'VOICEMAIL', 'NO_ANSWER', 'BUSY', 'INVALID_NUMBER']) {
      const ev = gateway.buildConnectorEvent({
        attemptId: ATTEMPT,
        providerAttemptId: `va-${ATTEMPT}`,
        tabulationCode,
        summary: 'resumo',
        durationSeconds: 42,
        aiCostUsd: 0.0123,
      });
      const parsed = ConnectorEventSchema.safeParse(ev);
      expect(parsed.success, `${tabulationCode}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(ev.eventId).toBe(`${ATTEMPT}:result`);
      expect(ev.cost).toBeUndefined();
    }
    const cb = gateway.buildConnectorEvent({
      attemptId: ATTEMPT,
      providerAttemptId: `va-${ATTEMPT}`,
      tabulationCode: 'CALLBACK_SCHEDULED',
      scheduledAt: '2026-11-10T15:00:00.000-03:00',
    });
    expect(ConnectorEventSchema.parse(cb).scheduledAt).toBe('2026-11-10T15:00:00.000-03:00');
  });

  it('sem endereço do gateway ou caller ID: rejeita e não liga', async () => {
    const calls = mockFetch(202, {});
    const res = await voiceAppAdapter.send(fakeDb(), input({ voiceAppBaseUrl: 'http://127.0.0.1:5050' }));
    expect(res.status).toBe('REJECTED');
    expect((res as any).reason).toMatch(/VOICE_APP_NOT_CONFIGURED/);
    expect(calls).toHaveLength(0);
  });

  it('ordem fora do contrato (destino inválido) é rejeitada antes do envio', async () => {
    const calls = mockFetch(202, {});
    const res = await voiceAppAdapter.send(fakeDb(), {
      ...input(configured),
      attempt: { ...input(configured).attempt, destination_address: 'abc' },
    });
    expect(res.status).toBe('REJECTED');
    expect((res as any).reason).toMatch(/INVALID_CALL_REQUEST/);
    expect(calls).toHaveLength(0);
  });

  it('aceita 201 e usa o callId como providerAttemptId', async () => {
    mockFetch(201, { ok: true, callId: 'call-outbound-123' });
    expect(await voiceAppAdapter.send(fakeDb(), input(configured))).toEqual({ status: 'ACCEPTED', providerAttemptId: 'call-outbound-123' });
  });

  it('429 é indisponibilidade transitória (reagenda sem consumir tentativa)', async () => {
    mockFetch(429, { error: 'capacity_exceeded' });
    await expect(voiceAppAdapter.send(fakeDb(), input(configured))).rejects.toThrow(TransientConnectorError);
  });

  it('409 (mesma chave, payload diferente) e 5xx vão para reconciliação, nunca para reenvio', async () => {
    mockFetch(409, { error: 'idempotency_conflict' });
    expect((await voiceAppAdapter.send(fakeDb(), input(configured))).status).toBe('INCONCLUSIVE');
    mockFetch(503, { error: 'unavailable' });
    expect((await voiceAppAdapter.send(fakeDb(), input(configured))).status).toBe('INCONCLUSIVE');
  });

  it('consulta e cancela pelo attemptId; sem endereço não chama nada', async () => {
    globalThis.fetch = vi.fn(async (_url: any, init: any) =>
      init?.method === 'DELETE' ? ({ ok: true, status: 200 } as any) : ({ ok: true, status: 200, json: async () => ({ status: 'IN_PROGRESS' }) } as any),
    ) as any;
    const connection = { config: configured };
    expect((await voiceAppAdapter.queryStatus!(ATTEMPT, connection)).status).toBe('IN_PROGRESS');
    expect(await voiceAppAdapter.cancel!(ATTEMPT, connection)).toBe(true);
    expect((await voiceAppAdapter.queryStatus!(ATTEMPT, { config: {} })).status).toBe('NOT_CONFIGURED');
    expect(await voiceAppAdapter.cancel!(ATTEMPT, { config: {} })).toBe(false);
  });
});
