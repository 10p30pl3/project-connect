'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { LiveMonitor } = require('../utils/live-monitor');
const {
  selectCallerId,
  buildOutcomeToolSchema,
  buildContactPrompt,
  IdleMessageManager,
} = require('../utils/voice-ai-helpers');
const { redactPii } = require('../utils/pii-redactor');
const { assertSafeToolUrl } = require('../utils/tool-executor');
const { buildConnectorEvent, validateConnectorEvent } = require('../utils/voll-contract');

test('LiveMonitor mede latencia de turno e agrega picos L/R', () => {
  const mon = new LiveMonitor({ callId: 'c-mon-1' });
  try {
    const pcmLoud = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) pcmLoud.writeInt16LE(4500, i * 2);

    const t0 = Date.now() - 220;
    mon.markUserSpeechStart(t0 - 500);
    mon.pushCallerAudio(pcmLoud);
    mon.markUserSpeechEnd(t0, 40);
    mon.pushAgentAudio(pcmLoud);

    const stats = mon.getStats();
    assert.strictEqual(stats.turnsCount, 1);
    assert.ok(stats.lastMs >= 200 && stats.lastMs <= 350, `latência inesperada: ${stats.lastMs}`);
    assert.strictEqual(stats.history[0].endpointingMs, 40);
  } finally {
    mon.stop();
  }
});

test('selectCallerId escolhe DDD local exato, regional ou round-robin', () => {
  const pool = ['+551130001000', '+552135001100', '+553132008820'];
  assert.strictEqual(
    selectCallerId({ strategy: 'LOCAL_PRESENCE_DDD', to: '+552199998888', defaultCallerId: pool[0], allowedCallerIds: pool }),
    '+552135001100',
  );
  // 19 (Campinas/SP) cai no DDD 11 (mesmo estado SP)
  assert.strictEqual(
    selectCallerId({ strategy: 'LOCAL_PRESENCE_DDD', to: '+551999998888', defaultCallerId: pool[1], allowedCallerIds: pool }),
    '+551130001000',
  );
  const rr1 = selectCallerId({ strategy: 'ROUND_ROBIN', to: '+558599998888', allowedCallerIds: pool, tenantKey: 'rr-test' });
  const rr2 = selectCallerId({ strategy: 'ROUND_ROBIN', to: '+558599998888', allowedCallerIds: pool, tenantKey: 'rr-test' });
  assert.notStrictEqual(rr1, rr2);
});

test('buildOutcomeToolSchema e buildContactPrompt respeitam allowedTabulations, schema e memoria', () => {
  const schema = buildOutcomeToolSchema(['CUSTOM_OK', 'CUSTOM_NO'], { interesse_nivel: { type: 'string' } });
  assert.deepStrictEqual(schema.parameters.properties.tabulationCode.enum, ['CUSTOM_OK', 'CUSTOM_NO']);
  assert.ok(schema.parameters.properties.extractedData.properties.interesse_nivel);

  const prompt = buildContactPrompt({
    contact: { name: 'Ana', variables: { __memory: 'Cliente pediu retorno sexta', valor: '199,00' } },
    allowedTabulations: ['CUSTOM_OK'],
    structuredDataSchema: { interesse_nivel: { type: 'string' } },
    tenant: { pronunciationRules: [{ pattern: 'VOLL', replacement: 'Vól' }] },
  });
  assert.ok(prompt.includes('Cliente pediu retorno sexta'));
  assert.ok(prompt.includes('CUSTOM_OK'));
  assert.ok(prompt.includes('"VOLL" como "Vól"'));
  assert.ok(!prompt.includes('__memory:'));
});

test('redactPii mascara CPF, CNPJ e CVV mantendo o restante legivel', () => {
  const txt = 'Meu CPF 384.482.918-20 e CVV: 942';
  const masked = redactPii(txt, true);
  assert.strictEqual(masked, 'Meu CPF 384.***.***-20 e CVV ***');
});

test('assertSafeToolUrl bloqueia enderecos internos por padrao', () => {
  assert.throws(() => assertSafeToolUrl('http://127.0.0.1:3333/secret'));
  assert.throws(() => assertSafeToolUrl('http://10.0.0.5/api'));
  assert.doesNotThrow(() => assertSafeToolUrl('https://crm.empresa.com.br/webhook'));
});

test('IdleMessageManager dispara aviso apos silencio e para ao chamar stop()', (_, done) => {
  let called = false;
  const mgr = new IdleMessageManager({
    messages: ['Oi, ainda está aí?'],
    timeoutSeconds: 0.05, // Math.max(3, ...) vai arredondar p/ 3s, então testamos override direto abaixo
    onIdle: (msg) => {
      called = msg;
    },
  });
  mgr.timeoutMs = 25;
  mgr.reset();
  setTimeout(() => {
    mgr.stop();
    assert.strictEqual(called, 'Oi, ainda está aí?');
    done();
  }, 60);
});

test('buildConnectorEvent inclui recordingUrl, amdResult, extractedData e latencyStats validos', () => {
  const ev = buildConnectorEvent({
    attemptId: '7d1c3f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    providerAttemptId: 'va-7d1c3f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    tabulationCode: 'CONVERSION',
    recordingUrl: 'https://plan.example.com/api/telephony/recordings/abc/audio',
    amdResult: 'HUMAN',
    extractedData: { interesse: 'alto' },
    latencyStats: { p50Ms: 210, lastMs: 205, maxMs: 260, turnsCount: 3 },
  });
  assert.deepStrictEqual(validateConnectorEvent(ev), { ok: true, errors: [] });
});
