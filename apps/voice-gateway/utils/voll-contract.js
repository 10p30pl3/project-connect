/**
 * Contrato com o Voll Plan (motor de campanhas).
 *
 * Os schemas vêm de packages/shared/contracts, gerados a partir dos schemas Zod que o Voll Plan usa
 * (`npm run contracts`). O gateway valida a ordem de chamada recebida e monta os eventos de retorno
 * com a mesma definição, e o teste de contrato do CI quebra se um lado mudar sozinho.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const callRequestSchema = require('../../../packages/shared/contracts/voice-call-request.schema.json');
const connectorEventSchema = require('../../../packages/shared/contracts/connector-event.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateRequest = ajv.compile(callRequestSchema);
const validateEvent = ajv.compile(connectorEventSchema);

function describeErrors(errors) {
  return (errors || []).map((e) => `${e.instancePath || '(raiz)'} ${e.message}`);
}

/** Valida a ordem `POST /v1/calls` vinda do Voll Plan. */
function validateCallRequest(body) {
  const ok = validateRequest(body);
  return ok ? { ok: true, errors: [] } : { ok: false, errors: describeErrors(validateRequest.errors) };
}

/**
 * Monta o evento de retorno para o Voll Plan.
 * O `eventId` é determinístico por tentativa e tipo: reenviar o mesmo desfecho (retry de webhook ou dois
 * caminhos de encerramento) gera o mesmo id e o Voll Plan descarta a repetição sem efeito.
 */
function buildConnectorEvent({
  type = 'RESULT',
  attemptId = null,
  providerAttemptId,
  tabulationCode,
  scheduledAt,
  summary,
  durationSeconds,
  aiCostUsd,
  occurredAt = new Date().toISOString(),
}) {
  const key = attemptId || providerAttemptId;
  const event = {
    eventId: `${key}:${type.toLowerCase()}`,
    providerAttemptId: String(providerAttemptId),
    type,
    occurredAt,
  };
  if (attemptId) event.attemptId = attemptId;
  if (tabulationCode) event.tabulationCode = tabulationCode;
  if (scheduledAt) event.scheduledAt = scheduledAt;
  if (summary) event.summary = String(summary).slice(0, 2000);
  if (Number.isFinite(durationSeconds)) event.durationSeconds = Math.max(0, Math.round(durationSeconds));
  if (Number.isFinite(aiCostUsd) && aiCostUsd >= 0) event.aiCostUsd = aiCostUsd;
  return event;
}

/** Valida um evento antes do envio (usado nos testes e em log de diagnóstico). */
function validateConnectorEvent(event) {
  const ok = validateEvent(event);
  return ok ? { ok: true, errors: [] } : { ok: false, errors: describeErrors(validateEvent.errors) };
}

module.exports = { validateCallRequest, buildConnectorEvent, validateConnectorEvent };
