/**
 * Valores de rede e de BINA vindos do ambiente (antes fixos no código do laboratório).
 * Ordens do Voll Plan sempre trazem o caller ID do agente; estes padrões só valem para chamadas de
 * teste do painel e para o roteamento interno FreeSWITCH <-> Drachtio.
 */
const DEFAULT_CALLER_ID = String(process.env.DEFAULT_CALLER_ID || '').replace(/[^\d+]/g, '');
const SIP_HOST = process.env.SIP_INTERNAL_HOST || process.env.AUDIO_FORK_WS_HOST || process.env.DRACHTIO_EXTERNAL_IP || '127.0.0.1';

/** Caller ID para uma chamada sem BINA informada; erro claro em vez de usar um número de outra pessoa. */
function requireCallerId(...candidates) {
  const v = candidates.find((c) => c && String(c).trim());
  if (v) return String(v).trim();
  if (DEFAULT_CALLER_ID) return DEFAULT_CALLER_ID;
  throw new Error('Caller ID não informado: envie "callerId"/"from" ou defina DEFAULT_CALLER_ID no .env do gateway');
}

module.exports = { DEFAULT_CALLER_ID, SIP_HOST, requireCallerId };
