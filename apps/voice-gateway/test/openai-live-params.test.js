'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { normalizeStsEngine, buildOpenAiSessionUpdate } = require('../utils/openai-session-params');
const tenantManagerSingleton = require('../utils/tenant-manager');
const TenantManager = tenantManagerSingleton.constructor;

test('normalizeStsEngine aceita openai, openai_live e elevenlabs com fallback seguro', () => {
  assert.equal(normalizeStsEngine('openai'), 'openai');
  assert.equal(normalizeStsEngine('openai_live'), 'openai_live');
  assert.equal(normalizeStsEngine('elevenlabs'), 'elevenlabs');
  assert.equal(normalizeStsEngine('desconhecido'), 'openai');
});

test('buildOpenAiSessionUpdate aplica semantic_vad como padrão para openai_live e server_vad para openai', () => {
  const livePayload = buildOpenAiSessionUpdate({
    stsEngine: 'openai_live',
    voice: 'alloy',
    instructions: 'Atenda de forma cordial.',
    openaiVadEagerness: 'high',
    openaiSpeed: 1.15,
    openaiTemperature: 0.9,
    openaiMaxOutputTokens: 512,
    openaiTranscriptionModel: 'gpt-4o-mini-transcribe',
    openaiTranscriptionLanguage: 'auto',
    openaiInterruptResponse: false,
  });

  assert.equal(livePayload.type, 'session.update');
  assert.equal(livePayload.session.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(livePayload.session.audio.input.turn_detection.eagerness, 'high');
  assert.equal(livePayload.session.audio.input.turn_detection.interrupt_response, false);
  assert.equal(livePayload.session.audio.output.voice, 'alloy');
  assert.equal(livePayload.session.audio.output.speed, 1.15);
  assert.equal(livePayload.session.temperature, 0.9);
  assert.equal(livePayload.session.max_output_tokens, 512);
  assert.equal(livePayload.session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
  assert.equal(livePayload.session.audio.input.transcription.language, undefined);

  const realtimePayload = buildOpenAiSessionUpdate({
    stsEngine: 'openai',
    voice: 'marin',
    vadThreshold: 0.55,
    prefixPaddingMs: 200,
    silenceDurationMs: 400,
  });
  assert.equal(realtimePayload.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(realtimePayload.session.audio.input.turn_detection.threshold, 0.55);
  assert.equal(realtimePayload.session.audio.input.turn_detection.prefix_padding_ms, 200);
  assert.equal(realtimePayload.session.audio.input.turn_detection.silence_duration_ms, 400);
});

test('TenantManager persiste openai_live e parâmetros avançados mantendo compatibilidade legada', () => {
  const tmpFile = path.join(os.tmpdir(), `tenants-test-${Date.now()}.json`);
  try {
    const tm = new TenantManager(tmpFile);
    const saved = tm.upsertTenant({
      id: 'live-agent',
      name: 'Agente Live',
      stsEngine: 'openai_live',
      openaiTemperature: 0.75,
      openaiSpeed: 1.1,
    });
    assert.equal(saved.stsEngine, 'openai_live');
    assert.equal(saved.openaiVadType, 'semantic_vad');
    assert.equal(saved.openaiTemperature, 0.75);
    assert.equal(saved.openaiSpeed, 1.1);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
