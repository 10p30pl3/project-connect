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
const agentTenantSchema = require('../../../packages/shared/contracts/voice-agent-tenant.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateRequest = ajv.compile(callRequestSchema);
const validateEvent = ajv.compile(connectorEventSchema);
const validateTenant = ajv.compile(agentTenantSchema);

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

/** Valida o agente de voz publicado pelo Voll Plan (`PUT /v1/tenants/:connectionId`). */
function validateAgentTenant(body) {
  const ok = validateTenant(body);
  return ok ? { ok: true, errors: [] } : { ok: false, errors: describeErrors(validateTenant.errors) };
}

/**
 * Confere uma ordem do Voll Plan contra o tenant (agente) cadastrado no gateway.
 * Devolve null quando pode originar, ou { status, error, message } para responder.
 * - tenant inexistente: 422 (sem cair no tenant default, que teria outro roteiro)
 * - versão do agente diferente: 409 (o Voll Plan precisa sincronizar antes)
 * - caller ID fora da lista autorizada: 422
 */
function checkOrderAgainstTenant(order, tenant) {
  if (!order || !order.attemptId) return null;
  const managed = order.agentVersion != null;
  if (!tenant) {
    if (!managed && order.tenantId === 'default') return null; // conexão legada sem agente cadastrado
    return { status: 422, error: 'unknown_tenant', message: `Agente ${order.tenantId} não está publicado neste gateway` };
  }
  if (managed && tenant.vollAgentVersion !== order.agentVersion) {
    return {
      status: 409,
      error: 'agent_version_mismatch',
      message: `Agente na versão ${tenant.vollAgentVersion ?? 'desconhecida'}; ordem pede ${order.agentVersion}`,
    };
  }
  const allowed = Array.isArray(tenant.allowedCallerIds) ? tenant.allowedCallerIds : [];
  if (allowed.length && !allowed.includes(order.callerId)) {
    return { status: 422, error: 'caller_id_not_allowed', message: `Caller ID ${order.callerId} não autorizado para este agente` };
  }
  return null;
}

/** Remove credenciais de um tenant antes de devolvê-lo pela API. */
function redactTenant(t) {
  if (!t) return t;
  const mask = (k) => (k ? `${String(k).slice(0, 7)}...${String(k).slice(-4)}` : null);
  return { ...t, openaiApiKey: mask(t.openaiApiKey), elevenlabsApiKey: mask(t.elevenlabsApiKey) };
}

module.exports = {
  validateCallRequest,
  buildConnectorEvent,
  validateConnectorEvent,
  validateAgentTenant,
  checkOrderAgainstTenant,
  redactTenant,
};
