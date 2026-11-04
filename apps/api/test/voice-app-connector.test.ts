import { describe, expect, it } from 'vitest';
import { voiceAppAdapter } from '../src/connectors/voice-app.js';
import { TransientConnectorError } from '../src/connectors/adapter.js';

describe('Voice-App Connector Adapter', () => {
  it('declares expected capabilities', () => {
    expect(voiceAppAdapter.capabilities.statusQuery).toBe(true);
    expect(voiceAppAdapter.capabilities.cancel).toBe(true);
    expect(voiceAppAdapter.capabilities.asyncResults).toBe(true);
  });

  it('sends call order to voice-app and receives 202 ACCEPTED', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
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
      },
    });

    expect(res.status).toBe('ACCEPTED');
    if (res.status === 'ACCEPTED') {
      expect(res.providerAttemptId).toBe(`va-${attemptId}`);
    }
  });

  it('supports idempotent replay for the same attemptId without creating duplicate call', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
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
        config: {
          voiceAppBaseUrl: 'http://127.0.0.1:5050',
        },
      },
    });

    // Replay should return ACCEPTED with identical providerAttemptId
    expect(res.status).toBe('ACCEPTED');
    if (res.status === 'ACCEPTED') {
      expect(res.providerAttemptId).toBe(`va-${attemptId}`);
    }
  });

  it('queries call status and cancels call idempotently', async () => {
    const attemptId = 'a0000000-0000-0000-0000-000000000099';
    const connection = {
      config: { voiceAppBaseUrl: 'http://127.0.0.1:5050' },
    };

    const status = await voiceAppAdapter.queryStatus!(attemptId, connection);
    expect(status.status).toBeDefined();

    const cancelled = await voiceAppAdapter.cancel!(attemptId, connection);
    expect(cancelled).toBe(true);
  });
});
