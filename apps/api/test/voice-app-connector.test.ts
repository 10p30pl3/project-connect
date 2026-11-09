import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { voiceAppAdapter } from '../src/connectors/voice-app.js';
import { TransientConnectorError } from '../src/connectors/adapter.js';
import { ConnectorEventSchema } from '@voll/shared';

describe('Voice-App Connector Adapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('declares expected capabilities', () => {
    expect(voiceAppAdapter.capabilities.statusQuery).toBe(true);
    expect(voiceAppAdapter.capabilities.cancel).toBe(true);
    expect(voiceAppAdapter.capabilities.asyncResults).toBe(true);
  });

  it('sends call order to voice-app with correct payload and receives 202 ACCEPTED', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedHeaders: any = null;

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      capturedHeaders = init.headers;
      return {
        status: 202,
        ok: true,
        json: async () => ({
          ok: true,
          status: 'ACCEPTED',
          providerAttemptId: `va-${attemptId}`,
        }),
      } as any;
    });

    const fakeDb: any = {
      query: async () => ({
        rows: [
          {
            id: attemptId,
            workspace_id: 'w0000000-0000-0000-0000-000000000001',
            trace_id: 'trc-test-99',
            destination_address: '+5511988887777',
            campaign_id: 'c0000000-0000-0000-0000-000000000001',
            contact_name: 'Carlos Oliveira',
            contact_ext_id: 'cli_carlos',
            contact_attrs: { saldo: 'R$ 150,00' },
          },
        ],
      }),
    };

    const res = await voiceAppAdapter.send(fakeDb, {
      attempt: {
        id: attemptId,
        destination_address: '+5511988887777',
        channel_type: 'VOICE',
        trace_id: 'trc-test-99',
      },
      connection: {
        id: 'conn-test-01',
        provider: 'VOICE_APP',
        channel_type: 'VOICE',
        config: {
          voiceAppBaseUrl: 'http://127.0.0.1:5050',
          defaultCallerId: '+551140030000',
        },
        webhook_secret: 'whsec_test_secret_123',
      } as any,
    });

    expect(capturedUrl).toBe('http://127.0.0.1:5050/v1/calls');
    expect(capturedHeaders['Idempotency-Key']).toBe(attemptId);
    expect(capturedBody.to).toBe('+5511988887777');
    expect(capturedBody.from).toBe('+551140030000');
    expect(capturedBody.callerId).toBe('+551140030000');
    expect(capturedBody.callback.url).toContain('/api/connectors/conn-test-01/events');
    expect(capturedBody.callback.secret).toBe('whsec_test_secret_123');
    expect(capturedBody.contact.name).toBe('Carlos Oliveira');

    expect(res.status).toBe('ACCEPTED');
    if (res.status === 'ACCEPTED') {
      expect(res.providerAttemptId).toBe(`va-${attemptId}`);
    }
  });

  it('supports 201 Created and maps providerAttemptId or callId', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
    globalThis.fetch = vi.fn(async () => ({
      status: 201,
      ok: true,
      json: async () => ({
        ok: true,
        callId: 'call-outbound-123',
      }),
    } as any));

    const fakeDb: any = {
      query: async () => ({
        rows: [
          {
            id: attemptId,
            workspace_id: 'w0000000-0000-0000-0000-000000000001',
            trace_id: 'trc-test-99',
            destination_address: '+5511988887777',
            campaign_id: 'c0000000-0000-0000-0000-000000000001',
            contact_name: 'Carlos Oliveira',
            contact_ext_id: 'cli_carlos',
            contact_attrs: {},
          },
        ],
      }),
    };

    const res = await voiceAppAdapter.send(fakeDb, {
      attempt: {
        id: attemptId,
        destination_address: '+5511988887777',
        channel_type: 'VOICE',
        trace_id: 'trc-test-99',
      },
      connection: {
        id: 'conn-test-01',
        provider: 'VOICE_APP',
        channel_type: 'VOICE',
        config: { voiceAppBaseUrl: 'http://127.0.0.1:5050' },
      },
    });

    expect(res.status).toBe('ACCEPTED');
    if (res.status === 'ACCEPTED') {
      expect(res.providerAttemptId).toBe('call-outbound-123');
    }
  });

  it('throws TransientConnectorError when voice-app returns 429', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
    globalThis.fetch = vi.fn(async () => ({
      status: 429,
      ok: false,
      json: async () => ({ error: 'capacity_exceeded' }),
    } as any));

    const fakeDb: any = {
      query: async () => ({
        rows: [
          {
            id: attemptId,
            workspace_id: 'w0000000-0000-0000-0000-000000000001',
            trace_id: 'trc-test-99',
            destination_address: '+5511988887777',
            campaign_id: 'c0000000-0000-0000-0000-000000000001',
            contact_name: 'Carlos Oliveira',
            contact_ext_id: 'cli_carlos',
            contact_attrs: {},
          },
        ],
      }),
    };

    await expect(
      voiceAppAdapter.send(fakeDb, {
        attempt: {
          id: attemptId,
          destination_address: '+5511988887777',
          channel_type: 'VOICE',
          trace_id: 'trc-test-99',
        },
        connection: {
          id: 'conn-test-01',
          provider: 'VOICE_APP',
          channel_type: 'VOICE',
          config: { voiceAppBaseUrl: 'http://127.0.0.1:5050' },
        },
      }),
    ).rejects.toThrow(TransientConnectorError);
  });

  it('queries call status and cancels call idempotently', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
    const connection = {
      config: { voiceAppBaseUrl: 'http://127.0.0.1:5050' },
    };

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      if (init?.method === 'DELETE') {
        return { ok: true, status: 200 } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'IN_PROGRESS', duration: 12 }),
      } as any;
    });

    const status = await voiceAppAdapter.queryStatus!(attemptId, connection);
    expect(status.status).toBe('IN_PROGRESS');

    const cancelled = await voiceAppAdapter.cancel!(attemptId, connection);
    expect(cancelled).toBe(true);
  });

  it('validates ConnectorEventSchema with CALLBACK_SCHEDULED and scheduledAt', () => {
    const event = {
      eventId: 'evt-test-123',
      providerAttemptId: 'call-outbound-123',
      attemptId: 'a0000000-0000-0000-0000-000000000099',
      type: 'RESULT',
      occurredAt: '2026-11-09T14:30:00.000Z',
      tabulationCode: 'CALLBACK_SCHEDULED',
      scheduledAt: '2026-11-10T15:00:00.000-03:00',
      summary: 'Cliente pediu para retornar amanhã à tarde',
      durationSeconds: 28,
      cost: 0.05,
    };

    const parsed = ConnectorEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tabulationCode).toBe('CALLBACK_SCHEDULED');
      expect(parsed.data.scheduledAt).toBe('2026-11-10T15:00:00.000-03:00');
    }
  });
});
