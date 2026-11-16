'use strict';

const VALID_ENGINES = new Set(['openai', 'openai_live', 'elevenlabs']);

function normalizeStsEngine(raw, fallback = 'openai') {
  const val = String(raw || '').trim().toLowerCase();
  if (VALID_ENGINES.has(val)) return val;
  return VALID_ENGINES.has(fallback) ? fallback : 'openai';
}

function clampNumber(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Monta o payload `session.update` compatível com OpenAI Realtime / OpenAI Live API,
 * aplicando parâmetros de VAD, transcrição, voz, velocidade, temperatura e limite de tokens.
 */
function buildOpenAiSessionUpdate(tenant = {}, opts = {}) {
  const engine = normalizeStsEngine(tenant.stsEngine);
  const useG711 = Boolean(opts.useG711);
  const vadThreshold = clampNumber(opts.vadThreshold ?? tenant.vadThreshold, 0.1, 0.95, 0.45);
  const prefixPaddingMs = Math.round(clampNumber(opts.prefixPaddingMs ?? tenant.prefixPaddingMs, 0, 1000, 160));
  const silenceDurationMs = Math.round(clampNumber(opts.silenceDurationMs ?? tenant.silenceDurationMs, 100, 2000, 280));

  const vadType =
    tenant.openaiVadType === 'semantic_vad' || tenant.openaiVadType === 'server_vad'
      ? tenant.openaiVadType
      : engine === 'openai_live'
        ? 'semantic_vad'
        : 'server_vad';

  const interruptResponse = tenant.openaiInterruptResponse !== false;

  const turnDetection =
    vadType === 'semantic_vad'
      ? {
          type: 'semantic_vad',
          eagerness: ['low', 'medium', 'high', 'auto'].includes(tenant.openaiVadEagerness)
            ? tenant.openaiVadEagerness
            : 'medium',
          interrupt_response: interruptResponse
        }
      : {
          type: 'server_vad',
          threshold: vadThreshold,
          prefix_padding_ms: prefixPaddingMs,
          silence_duration_ms: silenceDurationMs,
          interrupt_response: interruptResponse
        };

  const transcriptionModel = ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'].includes(
    tenant.openaiTranscriptionModel
  )
    ? tenant.openaiTranscriptionModel
    : 'whisper-1';

  const transcriptionLang = ['pt', 'en', 'es', 'auto'].includes(tenant.openaiTranscriptionLanguage)
    ? tenant.openaiTranscriptionLanguage
    : 'pt';

  const transcription = {
    model: transcriptionModel,
    prompt: 'Voll, Voll Solutions, atendimento ao cliente, inteligência artificial, automações, planos, quanto custa, demonstração'
  };
  if (transcriptionLang !== 'auto') {
    transcription.language = transcriptionLang;
  }

  const session = {
    type: 'realtime',
    audio: {
      input: {
        transcription,
        turn_detection: turnDetection
      }
    }
  };

  if (useG711) {
    session.audio.input.format = { type: 'audio/pcmu' };
    session.audio.output = { format: { type: 'audio/pcmu' } };
  }

  if (tenant.voice) {
    session.audio.output = {
      ...(session.audio.output || {}),
      voice: tenant.voice
    };
  }

  if (tenant.openaiSpeed !== undefined && tenant.openaiSpeed !== null) {
    const speed = clampNumber(tenant.openaiSpeed, 0.25, 1.5, 1.0);
    if (speed !== 1.0) {
      session.audio.output = {
        ...(session.audio.output || {}),
        speed
      };
    }
  }

  if (tenant.openaiTemperature !== undefined && tenant.openaiTemperature !== null) {
    session.temperature = clampNumber(tenant.openaiTemperature, 0.6, 1.2, 0.8);
  }

  if (tenant.openaiMaxOutputTokens !== undefined && tenant.openaiMaxOutputTokens !== null && tenant.openaiMaxOutputTokens !== '') {
    session.max_output_tokens = Math.round(clampNumber(tenant.openaiMaxOutputTokens, 64, 4096, 1024));
  }

  if (tenant.instructions) {
    session.instructions = tenant.instructions;
  } else if (tenant.openaiPromptId) {
    session.prompt = { id: tenant.openaiPromptId };
  }

  return {
    type: 'session.update',
    session
  };
}

module.exports = {
  VALID_ENGINES,
  normalizeStsEngine,
  buildOpenAiSessionUpdate
};
