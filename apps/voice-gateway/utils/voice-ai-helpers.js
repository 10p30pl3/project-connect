'use strict';

/**
 * Helpers compartilhados entre OpenAIS2SBridge, ElevenLabsS2SBridge e originateOutboundCall
 * evitando duplicação entre motores e garantindo paridade de features (AGENTS.md).
 */

const DEFAULT_TABULATIONS = ['CONVERSION', 'CPC_NO_DEAL', 'CALLBACK_SCHEDULED', 'WRONG_PERSON', 'OPT_OUT'];

const TABULATION_HINTS = {
  CONVERSION: 'CONVERSION (acordo/conversão concluída)',
  CPC_NO_DEAL: 'CPC_NO_DEAL (atendimento confirmado sem acordo)',
  CALLBACK_SCHEDULED: 'CALLBACK_SCHEDULED (cliente pediu reagendamento — informe scheduledAt ISO)',
  WRONG_PERSON: 'WRONG_PERSON (engano/terceiro/não é o titular)',
  OPT_OUT: 'OPT_OUT (pediu para não receber novas ligações — bloqueio LGPD)',
};

// Mapeamento simplificado de estado/região para fallback de Local Presence quando não há match exato de DDD
const DDD_REGION_GROUP = {
  11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
  21: 'RJ', 22: 'RJ', 24: 'RJ',
  27: 'ES', 28: 'ES',
  31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
  41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR',
  47: 'SC', 48: 'SC', 49: 'SC',
  51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
  61: 'DF', 62: 'GO', 64: 'GO', 63: 'TO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE',
  81: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 86: 'PI', 87: 'PE', 88: 'CE', 89: 'PI',
  91: 'PA', 92: 'AM', 93: 'PA', 94: 'PA', 95: 'RR', 96: 'AP', 97: 'AM', 98: 'MA', 99: 'MA',
};

function extractBrazilDdd(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2, 4);
  if (digits.length >= 10 && digits.length <= 11) return digits.slice(0, 2);
  return null;
}

const roundRobinCursors = new Map();

function selectCallerId({ strategy = 'FIXED', to, defaultCallerId, allowedCallerIds = [], tenantKey = 'default' }) {
  const pool = Array.isArray(allowedCallerIds) ? allowedCallerIds.filter(Boolean) : [];
  if (pool.length === 0) return defaultCallerId;
  if (strategy === 'FIXED' || pool.length === 1) {
    return defaultCallerId && pool.includes(defaultCallerId) ? defaultCallerId : pool[0];
  }
  if (strategy === 'LOCAL_PRESENCE_DDD') {
    const targetDdd = extractBrazilDdd(to);
    if (targetDdd) {
      const exact = pool.find((cid) => extractBrazilDdd(cid) === targetDdd);
      if (exact) return exact;
      const targetRegion = DDD_REGION_GROUP[targetDdd];
      if (targetRegion) {
        const regional = pool.find((cid) => DDD_REGION_GROUP[extractBrazilDdd(cid)] === targetRegion);
        if (regional) return regional;
      }
    }
  }
  // ROUND_ROBIN ou fallback balanceado
  const prevIdx = roundRobinCursors.get(tenantKey) ?? -1;
  const nextIdx = (prevIdx + 1) % pool.length;
  roundRobinCursors.set(tenantKey, nextIdx);
  return pool[nextIdx];
}

function normalizeTabulations(allowedTabulations) {
  const clean = Array.isArray(allowedTabulations)
    ? allowedTabulations.map((c) => String(c).trim()).filter(Boolean)
    : [];
  return clean.length > 0 ? Array.from(new Set(clean)) : [...DEFAULT_TABULATIONS];
}

function buildOutcomeToolSchema(allowedTabulations, structuredDataSchema = null) {
  const codes = normalizeTabulations(allowedTabulations);
  const descriptions = codes.map((c) => TABULATION_HINTS[c] || c).join(', ');

  const properties = {
    tabulationCode: {
      type: 'string',
      enum: codes,
      description: `Código da tabulação permitida nesta campanha: ${descriptions}`,
    },
    scheduledAt: {
      type: 'string',
      description: 'Data e hora combinada em ISO-8601 (ex: 2026-11-10T14:30:00-03:00) em caso de reagendamento.',
    },
    summary: {
      type: 'string',
      description: 'Resumo objetivo do que foi conversado ou combinado.',
    },
  };

  if (structuredDataSchema && typeof structuredDataSchema === 'object' && Object.keys(structuredDataSchema).length > 0) {
    properties.extractedData = {
      type: 'object',
      description: 'Campos estruturados extraídos da conversa conforme o schema configurado para o agente.',
      properties: structuredDataSchema,
    };
  }

  return {
    type: 'function',
    name: 'registrar_desfecho_chamada',
    description:
      'Registra a tabulação, dados estruturados e o desfecho final da ligação com o cliente.',
    parameters: {
      type: 'object',
      properties,
      required: ['tabulationCode'],
    },
  };
}

function buildPronunciationPrompt(rules = []) {
  if (!Array.isArray(rules) || rules.length === 0) return '';
  const lines = rules
    .filter((r) => r && r.pattern && r.replacement)
    .slice(0, 50)
    .map((r) => `- Sempre pronuncie "${r.pattern}" como "${r.replacement}"`);
  if (!lines.length) return '';
  return `[GUIA DE PRONÚNCIA FONÉTICA]\n${lines.join('\n')}`;
}

function buildGuardrailsPrompt(guardrails) {
  if (!guardrails || typeof guardrails !== 'object') return '';
  const parts = [];
  if (Array.isArray(guardrails.mandatoryDisclosures) && guardrails.mandatoryDisclosures.length) {
    parts.push(`Frases obrigatórias: ${guardrails.mandatoryDisclosures.join(' | ')}`);
  }
  if (Array.isArray(guardrails.forbiddenTopics) && guardrails.forbiddenTopics.length) {
    parts.push(`Tópicos PROIBIDOS (nunca prometer ou abordar): ${guardrails.forbiddenTopics.join(' | ')}`);
  }
  if (Array.isArray(guardrails.escalationKeywords) && guardrails.escalationKeywords.length) {
    parts.push(`Palavras que exigem transferência imediata: ${guardrails.escalationKeywords.join(', ')}`);
  }
  return parts.length ? `[REGRAS DE COMPLIANCE & GUARDRAILS]\n${parts.join('\n')}` : '';
}

function buildContactPrompt({ contact, allowedTabulations, structuredDataSchema, extraInstructions, tenant }) {
  const parts = [];
  const codes = normalizeTabulations(allowedTabulations);

  if (contact) {
    const contactName = contact.name || 'Cliente';
    const vars = { ...(contact.variables || {}) };
    const memoryText = vars.__memory ? String(vars.__memory) : '';
    delete vars.__memory;

    const varLines = Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    const nowBrt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const tabLines = codes
      .map((code) => `- ${TABULATION_HINTS[code] || `${code}: utilize quando este desfecho se aplicar.`}`)
      .join('\n');

    let structuredBlock = '';
    if (structuredDataSchema && typeof structuredDataSchema === 'object' && Object.keys(structuredDataSchema).length > 0) {
      const keys = Object.keys(structuredDataSchema).join(', ');
      structuredBlock = `\n[EXTRAÇÃO ESTRUTURADA]\nAo chamar "registrar_desfecho_chamada", preencha "extractedData" com os campos disponíveis (${keys}).`;
    }

    parts.push(
      `[DADOS DO CLIENTE E CONTEXTO OPERACIONAL]\n- Nome do cliente: ${contactName}\n- Data e hora atual (São Paulo): ${nowBrt}${varLines ? `\n- Dados complementares:\n${varLines}` : ''}`,
    );

    if (memoryText) {
      parts.push(`[MEMÓRIA DE ATENDIMENTOS ANTERIORES]\n${memoryText}`);
    }

    parts.push(
      `[INSTRUÇÃO OBRIGATÓRIA DE DESFECHO]\nSempre utilize a ferramenta "registrar_desfecho_chamada" usando EXCLUSIVAMENTE um dos códigos permitidos:\n${tabLines}${structuredBlock}`,
    );
  }

  const pron = buildPronunciationPrompt(tenant?.pronunciationRules);
  if (pron) parts.push(pron);

  const guard = buildGuardrailsPrompt(tenant?.guardrails);
  if (guard) parts.push(guard);

  if (extraInstructions) {
    parts.push(`[INSTRUÇÕES ESPECÍFICAS DA CAMPANHA]\n${extraInstructions}`);
  }
  return parts.join('\n\n');
}

class IdleMessageManager {
  constructor({ messages = [], timeoutSeconds = 8, onIdle } = {}) {
    this.messages = Array.isArray(messages) ? messages.filter((m) => typeof m === 'string' && m.trim()) : [];
    this.timeoutMs = Math.max(3, Math.min(30, Number(timeoutSeconds || 8))) * 1000;
    this.onIdle = typeof onIdle === 'function' ? onIdle : () => {};
    this.index = 0;
    this.timer = null;
    this.stopped = false;
  }

  reset() {
    if (this.stopped || this.messages.length === 0) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.index >= this.messages.length) return;
    this.timer = setTimeout(() => {
      if (this.stopped || this.index >= this.messages.length) return;
      const msg = this.messages[this.index];
      this.index += 1;
      try {
        this.onIdle(msg, this.index, this.index >= this.messages.length);
      } catch {}
    }, this.timeoutMs);
  }

  onUserSpeech() {
    // Quando o cliente responde normalmente, reinicia o índice/paciência do silêncio
    this.index = 0;
    this.reset();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  DEFAULT_TABULATIONS,
  extractBrazilDdd,
  selectCallerId,
  normalizeTabulations,
  buildOutcomeToolSchema,
  buildPronunciationPrompt,
  buildGuardrailsPrompt,
  buildContactPrompt,
  IdleMessageManager,
};
