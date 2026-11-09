// Testes do contrato com o Voll Plan (node --test). Não sobem o gateway nem tocam em FreeSWITCH.
const test = require('node:test');
const assert = require('node:assert');
const { validateCallRequest, buildConnectorEvent, validateConnectorEvent } = require('../utils/voll-contract');

const valid = {
  attemptId: '7d1c3f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  traceId: '0b7f2a6e-5d4c-4b3a-9f8e-7d6c5b4a3f2e',
  connectionId: '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7',
  workspaceId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  to: '+5511988887777',
  from: '+551130001000',
  callerId: '+551130001000',
  tenantId: 'default',
  contact: { externalId: '00123', name: 'Cliente Teste', variables: { valor: '150,00' } },
  campaign: { id: '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9' },
  limits: { maxDurationSec: 300 },
  allowedTabulations: ['CONVERSION', 'NO_ANSWER'],
  callback: { url: 'https://plan.example.com/api/connectors/x/events', secret: 'segredo-hmac-com-32-caracteres!!' },
};

test('aceita uma ordem dentro do contrato', () => {
  assert.deepStrictEqual(validateCallRequest(valid), { ok: true, errors: [] });
});

test('rejeita ordem sem attemptId, com destino inválido ou sem callback', () => {
  const { attemptId, ...semId } = valid;
  assert.strictEqual(validateCallRequest(semId).ok, false);
  assert.strictEqual(validateCallRequest({ ...valid, to: 'abc' }).ok, false);
  const { callback, ...semCallback } = valid;
  assert.strictEqual(validateCallRequest(semCallback).ok, false);
});

test('eventId é determinístico por tentativa e tipo', () => {
  const a = buildConnectorEvent({ attemptId: valid.attemptId, providerAttemptId: `va-${valid.attemptId}`, tabulationCode: 'NO_ANSWER' });
  const b = buildConnectorEvent({ attemptId: valid.attemptId, providerAttemptId: `va-${valid.attemptId}`, tabulationCode: 'BUSY' });
  assert.strictEqual(a.eventId, `${valid.attemptId}:result`);
  assert.strictEqual(a.eventId, b.eventId);
});

test('evento de resultado segue o schema do Voll Plan, com custo de IA separado', () => {
  const ev = buildConnectorEvent({
    attemptId: valid.attemptId,
    providerAttemptId: `va-${valid.attemptId}`,
    tabulationCode: 'CALLBACK_SCHEDULED',
    scheduledAt: '2026-11-10T14:00:00-03:00',
    summary: 'Cliente pediu retorno amanhã às 14h',
    durationSeconds: 63.4,
    aiCostUsd: 0.0123,
  });
  assert.deepStrictEqual(validateConnectorEvent(ev), { ok: true, errors: [] });
  assert.strictEqual(ev.cost, undefined);
  assert.strictEqual(ev.aiCostUsd, 0.0123);
  assert.strictEqual(ev.durationSeconds, 63);
});

const { validateAgentTenant, checkOrderAgainstTenant, redactTenant } = require('../utils/voll-contract');

const tenant = {
  id: valid.connectionId,
  name: 'Agente cobrança',
  vollWorkspaceId: valid.workspaceId,
  vollAgentVersion: 3,
  stsEngine: 'openai',
  openaiModel: 'gpt-realtime-mini',
  voice: 'marin',
  instructions: 'Você é o assistente de cobrança da Voll. Seja cordial e objetivo.',
  greetingInstructions: null,
  maxDurationSec: 180,
  amd: { enabled: true, mode: 'active' },
  stt: { enabled: true },
  bargeinLevel: 3,
  allowedCallerIds: ['+551130001000'],
  extension: null,
  dids: [],
  active: true,
};

test('agente publicado pelo Voll Plan segue o contrato e não aceita credenciais', () => {
  assert.deepStrictEqual(validateAgentTenant(tenant), { ok: true, errors: [] });
  assert.strictEqual(validateAgentTenant({ ...tenant, openaiApiKey: 'qualquer-chave' }).ok, false);
  assert.strictEqual(validateAgentTenant({ ...tenant, dids: ['1133334444'] }).ok, false);
});

test('ordem é conferida contra o agente: inexistente, versão e caller ID', () => {
  const order = { ...valid, tenantId: tenant.id, agentVersion: 3 };
  assert.strictEqual(checkOrderAgainstTenant(order, tenant), null);
  assert.strictEqual(checkOrderAgainstTenant(order, null).error, 'unknown_tenant');
  assert.strictEqual(checkOrderAgainstTenant({ ...order, agentVersion: 4 }, tenant).status, 409);
  assert.strictEqual(checkOrderAgainstTenant({ ...order, callerId: '+551199990000' }, tenant).error, 'caller_id_not_allowed');
  // conexão legada sem agente cadastrado continua usando o tenant default
  assert.strictEqual(checkOrderAgainstTenant({ ...valid, tenantId: 'default' }, null), null);
});

test('tenant devolvido pela API tem as chaves mascaradas', () => {
  const r = redactTenant({ ...tenant, openaiApiKey: 'fake-key-abcdefghijklmnop1234' });
  assert.strictEqual(r.openaiApiKey, 'fake-ke...1234');
});
