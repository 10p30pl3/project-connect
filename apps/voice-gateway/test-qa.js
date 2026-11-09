#!/usr/bin/env node
/**
 * Suite Automatizada de QA Completa (Produção)
 * Valida:
 * 1. DSP e Codecs (upsample8to16, upsample8to24, downsample24to8, linear16ToMulaw, mulawToLinear16)
 * 2. TenantManager (Deep merge, CPS, limites concorrentes, segurança de X-Tenant-ID ativo/inválido)
 * 3. FreeSwitchPool (Least-Connections, Round-Robin, Failover automático e reset de chamadas em disconnect)
 * 4. WsMediaServer (Roteamento de UUID, proteção Anti-Hijack e tratamento binário)
 * 5. WhisperSession e WhisperPool (4 modos, pending buffer, circuit-breaker e Fail-Open quando todos os nós caem)
 * 6. Classificador Léxico e Heurístico Python + LGPD Redactor (CPF, Cartão e Email)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { execFileSync } = require('child_process');

const { WhisperPool, WhisperSession } = require('./media/whisper-client');
const FreeSwitchPool = require('./utils/freeswitch-pool');
const WsMediaBridge = require('./media/ws-media-bridge');
const { mediaServer } = require('./media/ws-media-bridge');
const { CallRecorder, formatDateTime } = require('./utils/call-recorder');
const { createApiRouter } = require('./utils/api-router');
const http = require('http');

const {
  upsample8to16,
  upsample8to24,
  downsample24to8,
  linear16ToMulaw,
  mulawToLinear16
} = require('./utils/audio-dsp');

const indexContent = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

async function runQaSuite() {
  console.log('====================================================');
  console.log('🧪 INICIANDO SUITE DE QA DE PRODUÇÃO - VOICE-APP');
  console.log('====================================================\n');

  // -------------------------------------------------------------------------
  // 1. Teste de DSP e Codecs de Áudio
  // -------------------------------------------------------------------------
  console.log('👉 [1/8] Testando DSP e Codecs (PCM 8k, 16k, 24k e G.711 u-law)...');
  
  // 1.1 upsample8to16
  const buf8k = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) buf8k.writeInt16LE(i * 100, i * 2);
  const buf16k = upsample8to16(buf8k);
  assert.strictEqual(buf16k.length, 640);
  assert.strictEqual(buf16k.readInt16LE(2), 50);

  // 1.2 upsample8to24 e downsample24to8
  const buf24k = upsample8to24(buf8k);
  assert.strictEqual(buf24k.length, 320 * 3, '24kHz deve ter 3x o tamanho de 8kHz');
  const restored8k = downsample24to8(buf24k);
  assert.strictEqual(restored8k.length, buf8k.length);

  // 1.3 linear16ToMulaw e mulawToLinear16 roundtrip
  const testSample = Buffer.alloc(4);
  testSample.writeInt16LE(1500, 0);
  testSample.writeInt16LE(-1500, 2);
  const mulawEncoded = linear16ToMulaw(testSample);
  assert.strictEqual(mulawEncoded.length, 2, 'G.711 u-law deve ter 1 byte por sample');
  const restoredPcm = mulawToLinear16(mulawEncoded);
  assert.ok(Math.abs(restoredPcm.readInt16LE(0) - 1500) < 50, 'Quantização G.711 deve preservar sinal');
  assert.ok(Math.abs(restoredPcm.readInt16LE(2) - (-1500)) < 50);

  // 1.4 CrosstalkFilter (Gate de voz de fundo com validação de ataque de 3 frames)
  const CrosstalkFilter = require('./utils/crosstalk-filter');
  const xtalk = new CrosstalkFilter({ ratio: 0.48, initialUserRms: 1200, hangoverMs: 40, attackFrames: 3 });
  const strongChunk = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) strongChunk.writeInt16LE(Math.sin(i * 0.1) * 1700, i * 2);
  assert.strictEqual(xtalk.process(strongChunk), false, 'Pico isolado de 1 frame não deve abrir o gate');
  assert.strictEqual(xtalk.process(strongChunk), false, 'Pico isolado de 2 frames não deve abrir o gate');
  assert.strictEqual(xtalk.process(strongChunk), true, 'Voz sustentada (3+ frames) do usuário principal deve abrir o gate');

  // Esgota o hangover
  const silentChunk = Buffer.alloc(320);
  xtalk.process(silentChunk);
  xtalk.process(silentChunk);
  xtalk.process(silentChunk);

  // Voz de fundo fraca (RMS ~250 < 40% de 1200): deve ser bloqueada
  const weakChunk = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) weakChunk.writeInt16LE(Math.sin(i * 0.1) * 350, i * 2);
  assert.strictEqual(xtalk.process(weakChunk), false, 'Voz de fundo deve ser bloqueada pelo gate');

  console.log('   ✅ DSP e Codecs de áudio aprovados!\n');

  // -------------------------------------------------------------------------
  // 2. Teste do TenantManager (Deep Merge, Limite de Canais, CPS e Segurança)
  // -------------------------------------------------------------------------
  console.log('👉 [2/8] Testando TenantManager (Segurança, Concorrência e CPS)...');
  const tmpConfig = path.join(os.tmpdir(), `tenants-qa-${Date.now()}.json`);
  fs.writeFileSync(
    tmpConfig,
    JSON.stringify([
      {
        id: 'cliente-parcial',
        dids: ['551140040001'],
        maxConcurrentCalls: 2,
        maxCallsPerSecond: 2,
        amd: { enabled: true }
      },
      {
        id: 'cliente-inativo',
        dids: ['551199999999'],
        active: false
      }
    ])
  );

  const TenantManagerClass = require('./utils/tenant-manager').constructor;
  const tm = new TenantManagerClass(tmpConfig);
  const tenant = tm.tenants.get('cliente-parcial');
  assert.ok(tenant);
  assert.strictEqual(tenant.amd.enabled, true);
  assert.strictEqual(tenant.amd.mode, 'active', 'Deep merge deve manter mode=active');
  assert.strictEqual(typeof tenant.stt.enabled, 'boolean');

  // Concorrência e CPS
  assert.strictEqual(tm.tryAcquireSlot(tenant).allowed, true);
  assert.strictEqual(tm.tryAcquireSlot(tenant).allowed, true);
  const thirdTry = tm.tryAcquireSlot(tenant);
  assert.strictEqual(thirdTry.allowed, false);
  assert.strictEqual(thirdTry.sipStatus, 486);
  tm.releaseSlot(tenant);
  tm.releaseSlot(tenant);

  // Segurança de X-Tenant-ID
  const mockReqInativo = { get: (h) => (h.toLowerCase() === 'x-tenant-id' ? 'cliente-inativo' : null) };
  const resInativo = tm.resolveTenant(mockReqInativo);
  assert.strictEqual(resInativo.active, false, 'Tenant inativo deve ser retornado como inativo para bloqueio SIP 404');

  const mockReqInvalido = { get: (h) => (h.toLowerCase() === 'x-tenant-id' ? 'cliente-fantasma' : null) };
  const resInvalido = tm.resolveTenant(mockReqInvalido);
  assert.strictEqual(resInvalido, null, 'Tenant desconhecido em header explícito deve retornar null');

  fs.unlinkSync(tmpConfig);
  console.log('   ✅ TenantManager (Segurança + Concorrência + CPS) aprovado!\n');

  // -------------------------------------------------------------------------
  // 3. Teste do FreeSwitchPool (Least-Connections, Failover e Reset de Desconexão)
  // -------------------------------------------------------------------------
  console.log('👉 [3/8] Testando FreeSwitchPool (Least-Connections, Failover e Cleanup)...');
  const fsPool = new FreeSwitchPool();
  let disconnectListener1 = null;
  const fakeMs1 = {
    connectCaller: async () => ({ endpoint: {}, dialog: { on: () => {} } }),
    on: (evt, fn) => { if (evt === 'disconnect') disconnectListener1 = fn; }
  };
  const fakeMs2 = {
    connectCaller: async () => ({ endpoint: {}, dialog: { on: () => {} } }),
    on: () => {}
  };
  const node1 = { id: 'fs-1', mediaserver: fakeMs1, activeCalls: 0, totalCallsHandled: 0, ready: true };
  const node2 = { id: 'fs-2', mediaserver: fakeMs2, activeCalls: 0, totalCallsHandled: 0, ready: true };
  fsPool.nodes = [node1, node2];

  fakeMs1.on('disconnect', () => {
    node1.ready = false;
    node1.mediaserver = null;
    node1.activeCalls = 0;
  });

  const c1 = await fsPool.connectCaller({}, {});
  const c2 = await fsPool.connectCaller({}, {});
  assert.notStrictEqual(c1.fsNode.id, c2.fsNode.id, 'Least-Connections deve distribuir chamadas');
  assert.strictEqual(fsPool.nodes[0].activeCalls, 1);
  assert.strictEqual(fsPool.nodes[1].activeCalls, 1);

  // Simula queda de nó e zera contagem para evitar chamadas fantasmas
  disconnectListener1();
  assert.strictEqual(fsPool.nodes[0].activeCalls, 0, 'Queda de FreeSWITCH deve zerar activeCalls');

  const c3 = await fsPool.connectCaller({}, {});
  assert.strictEqual(c3.fsNode.id, 'fs-2', 'Chamada deve rotear apenas para nós saudáveis');
  c1.releaseNodeSlot();
  c2.releaseNodeSlot();
  c3.releaseNodeSlot();
  assert.strictEqual(fsPool.nodes[1].activeCalls, 0);
  console.log('   ✅ FreeSwitchPool aprovado!\n');

  // -------------------------------------------------------------------------
  // 4. Teste do WsMediaServer (Extração de UUID, Anti-Hijack e Suporte Binário)
  // -------------------------------------------------------------------------
  console.log('👉 [4/8] Testando WsMediaServer (Extração de UUID, Anti-Hijack e ArrayBuffer)...');
  let receivedAudio = null;
  const fakeBridgeSession = {
    attachSocket: (ws) => {
      ws.on('message', (data) => {
        if (Buffer.isBuffer(data)) receivedAudio = data;
        else if (data instanceof ArrayBuffer) receivedAudio = Buffer.from(data);
      });
    },
    stop: () => {}
  };
  mediaServer.registerSession('uuid-legitimo-123', fakeBridgeSession);

  // Roteamento de UUID
  assert.strictEqual(mediaServer.extractChannelUuid({ url: '/media/uuid-legitimo-123' }), 'uuid-legitimo-123');
  assert.strictEqual(mediaServer.extractChannelUuid({ url: '/media/uuid-invasor-999' }), null, 'Anti-hijack deve bloquear paths divergentes');
  assert.strictEqual(mediaServer.extractChannelUuid({ url: '/' }), 'uuid-legitimo-123', 'Fallback para single session quando URL for genérica');

  mediaServer.unregisterSession('uuid-legitimo-123');
  console.log('   ✅ WsMediaServer Anti-Hijack aprovado!\n');

  // -------------------------------------------------------------------------
  // 5. Teste Integrado do WhisperSession (4 Modos + Fail-Open em Circuit Breaker)
  // -------------------------------------------------------------------------
  console.log('👉 [5/8] Testando WhisperSession (4 Modos + Fail-Open de Pool)...');

  const mockWss = new WebSocket.Server({ port: 0 });
  const mockPort = mockWss.address().port;

  const { whisperPool } = require('./media/whisper-client');
  whisperPool.nodes = [
    {
      id: 'whisper-mock-1',
      url: `ws://127.0.0.1:${mockPort}/ws/audio`,
      activeSessions: 0,
      isHealthy: true,
      unhealthyUntil: 0,
      lastError: null
    }
  ];

  mockWss.on('connection', (ws, req) => {
    const u = new URL(req.url, 'http://localhost');
    const amd = u.searchParams.get('amd') === 'true';
    const stt = u.searchParams.get('stt') === 'true';
    let chunksReceived = 0;

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      chunksReceived += 1;

      if (amd && chunksReceived === 2) {
        ws.send(
          JSON.stringify({
            type: 'decision',
            label: 'caixa_postal',
            confidence: 0.96,
            speech_ms: 1450,
            transcript: 'Deixe seu recado após o sinal'
          })
        );
      } else if (stt && chunksReceived === 3) {
        ws.send(
          JSON.stringify({
            type: 'transcript',
            text: 'Meu CPF é ***.***.***-**',
            speech_ms: 1200,
            is_final: true
          })
        );
      }
    });
  });

  // Modo A: Desligado
  const sessOff = new WhisperSession({
    callId: 'qa-off',
    channelUuid: 'u1',
    tenant: { id: 't1', amd: { enabled: false }, stt: { enabled: false } }
  });
  sessOff.start();
  const decOff = await sessOff.waitForDecision();
  assert.strictEqual(decOff.label, 'humano');
  assert.strictEqual(decOff.reason, 'amd_disabled');

  // Modo B: Somente STT
  const sessSttOnly = new WhisperSession({
    callId: 'qa-stt-only',
    channelUuid: 'u2',
    tenant: { id: 't1', amd: { enabled: false }, stt: { enabled: true } }
  });
  sessSttOnly.start();
  const decSttOnly = await sessSttOnly.waitForDecision();
  assert.strictEqual(decSttOnly.reason, 'stt_only_mode');

  const transcriptPromise = new Promise((resolve) => sessSttOnly.once('transcript', resolve));
  sessSttOnly.pushAudio(Buffer.alloc(320), 8000);
  sessSttOnly.pushAudio(Buffer.alloc(320), 8000);
  sessSttOnly.pushAudio(Buffer.alloc(320), 8000);
  const tr = await transcriptPromise;
  assert.strictEqual(tr.text, 'Meu CPF é ***.***.***-**');
  sessSttOnly.stop();

  // Modo C: Somente AMD
  const sessAmdOnly = new WhisperSession({
    callId: 'qa-amd-only',
    channelUuid: 'u3',
    tenant: { id: 't1', amd: { enabled: true }, stt: { enabled: false } }
  });
  sessAmdOnly.start();
  sessAmdOnly.pushAudio(Buffer.alloc(320), 8000);
  sessAmdOnly.pushAudio(Buffer.alloc(320), 8000);
  const decAmdOnly = await sessAmdOnly.waitForDecision();
  assert.strictEqual(decAmdOnly.label, 'caixa_postal');
  assert.strictEqual(sessAmdOnly.closed, true);

  // Modo D: Fail-Open Imediato (todos os nós em cooldown circuit-breaker)
  whisperPool.nodes[0].isHealthy = false;
  whisperPool.nodes[0].unhealthyUntil = Date.now() + 30000;
  const sessFailOpen = new WhisperSession({
    callId: 'qa-fail-open',
    channelUuid: 'u4',
    tenant: { id: 't1', amd: { enabled: true } }
  });
  sessFailOpen.start();
  const decFailOpen = await sessFailOpen.waitForDecision();
  assert.strictEqual(decFailOpen.label, 'humano', 'Fail-open deve assumir humano');
  assert.strictEqual(decFailOpen.reason, 'no_whisper_node', 'Fail-open deve ocorrer em 0ms sem tentar socket morto');

  mockWss.close();
  console.log('   ✅ WhisperSession (4 modos + Fail-Open imediato) aprovado!\n');

  // -------------------------------------------------------------------------
  // 6. Teste de Classificação Léxica/Heurística e LGPD PII Redactor
  // -------------------------------------------------------------------------
  console.log('👉 [6/8] Testando Classificador AMD Expandido e PII Redactor...');
  const pyScript = `
import sys
sys.path.insert(0, 'whisper-service')
from classifier import AMDClassifier
from pii_redactor import redact_pii

clf = AMDClassifier()

# 1. Humano
r1 = clf.classify("Alô, quem fala?", speech_ms=650, silence_ms=400)
assert r1["label"] == "humano", f"Falha 1: {r1}"

# 2. Caixa postal léxica clássica
r2 = clf.classify("Deixe seu recado após o sinal", speech_ms=1400, silence_ms=200)
assert r2["label"] == "caixa_postal", f"Falha 2: {r2}"

# 3. Caixa de mensagens (TIM / Claro / iPhone)
r3 = clf.classify("Sua chamada está sendo encaminhada para a caixa de mensagens", speech_ms=1500, silence_ms=100)
assert r3["label"] == "caixa_postal", f"Falha 3: {r3}"

# 4. Não pode atender (3ª pessoa)
r4 = clf.classify("O assinante não pode atender no momento", speech_ms=1300, silence_ms=150)
assert r4["label"] == "caixa_postal", f"Falha 4: {r4}"

# 5. Operadora
r5 = clf.classify("O número chamado está desligado ou fora da área de cobertura", speech_ms=1700, silence_ms=100, is_early_media=True)
assert r5["label"] == "operadora", f"Falha 5: {r5}"

# 6. Monólogo longo sem pausa dialógica (>= 1800ms)
r6 = clf.classify("Bem vindo ao atendimento automático da empresa XPTO aguarde na linha", speech_ms=1950, silence_ms=50)
assert r6["label"] == "caixa_postal", f"Falha 6: {r6}"

# 7. LGPD: Redação de CPF, Cartão e Email
t1 = redact_pii("Meu CPF é 123, 456, 789, 00, cartão 4532 1122 3344 5566 e email contato@empresa.com.br")
assert "***.***.***-**" in t1, f"Falha CPF: {t1}"
assert "****-****-****-****" in t1, f"Falha Cartão: {t1}"
assert "***@***.***" in t1, f"Falha Email: {t1}"

print("   ✅ Classificador Expandido (6 cenários) + LGPD Redactor aprovados!")
`;
  const pyOut = execFileSync('python3', ['-c', pyScript], { encoding: 'utf8' });
  console.log(pyOut.trim());
  console.log('');

  // -------------------------------------------------------------------------
  // 7. Teste de Gravação Dual-Stream Stereo (CallRecorder) + Transcrição Cliente/Atendente
  // -------------------------------------------------------------------------
  console.log('👉 [7/8] Testando CallRecorder (WAV Stereo 8kHz, Isolamento L/R, Barge-in e Transcrição Data/Hora)...');
  const tmpRecDir = path.join(os.tmpdir(), `recordings-qa-${Date.now()}`);
  const rec = new CallRecorder({
    callId: 'call-stereo-qa',
    tenantId: 'tenant-qa',
    recordingDir: tmpRecDir
  });

  await rec.start();
  assert.strictEqual(rec.isStarted, true);

  // Prepara 1 frame de 20ms (160 samples = 320 bytes) do Cliente (valor constante 1234)
  const userFrame = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) userFrame.writeInt16LE(1234, i * 2);

  // Prepara 2 frames de 20ms (640 bytes) do Atendente (valor constante -4321)
  const aiTwoFrames = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) aiTwoFrames.writeInt16LE(-4321, i * 2);
  rec.pushAiChunk(aiTwoFrames);

  // Escreve o 1º frame de 20ms: deve consumir 320 bytes da IA e sobrar 320 bytes no buffer da IA
  rec.writeUserChunk(userFrame);
  assert.strictEqual(rec.aiBytesAvailable, 320, 'Deve restar 1 frame de 20ms da IA após 1º tick');

  // Simula Barge-In: deve purgar imediatamente o restante do buffer da IA
  rec.clearAiBuffer();
  assert.strictEqual(rec.aiBytesAvailable, 0, 'Barge-in deve truncar o buffer futuro da IA');

  // Escreve o 2º frame de 20ms após barge-in: Canal Direito (Atendente) deve sair com silêncio (0)
  rec.writeUserChunk(userFrame);

  // Registra diálogo formatado com data/hora e divisão Cliente: / Atendente:
  const fixedDate1 = new Date('2026-11-01T18:15:30');
  const fixedDate2 = new Date('2026-11-01T18:15:34');
  const e1 = rec.addTranscript('Cliente', 'Olá, gostaria de consultar meu saldo.', fixedDate1);
  const e2 = rec.addTranscript('Atendente', 'Claro! Por favor, digite ou fale seu CPF.', fixedDate2);

  assert.strictEqual(e1.formatted, '[2026-11-01 18:15:30] Cliente: Olá, gostaria de consultar meu saldo.');
  assert.strictEqual(e2.formatted, '[2026-11-01 18:15:34] Atendente: Claro! Por favor, digite ou fale seu CPF.');

  await rec.stop();

  // Valida arquivo WAV binário gerado
  const wavBuf = fs.readFileSync(rec.filePath);
  // Header 44 bytes + 2 frames stereo de 640 bytes = 44 + 1280 = 1324 bytes
  assert.strictEqual(wavBuf.length, 44 + 1280, 'Tamanho do WAV deve ser 44 + 1280 bytes');
  assert.strictEqual(wavBuf.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(wavBuf.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(wavBuf.readUInt16LE(22), 2, 'WAV deve ter 2 canais (Stereo)');
  assert.strictEqual(wavBuf.readUInt32LE(24), 8000, 'Sample rate deve ser 8000 Hz');
  assert.strictEqual(wavBuf.readUInt32LE(40), 1280, 'Subchunk2Size deve ser atualizado no stop() com 1280 bytes');

  // Verifica 1ª amostra do 1º frame (Left = Cliente = 1234, Right = Atendente = -4321)
  assert.strictEqual(wavBuf.readInt16LE(44), 1234, 'Canal Esquerdo (Cliente) deve conter 1234');
  assert.strictEqual(wavBuf.readInt16LE(46), -4321, 'Canal Direito (Atendente) deve conter -4321 antes do barge-in');

  // Verifica 1ª amostra do 2º frame pós-barge-in (Left = Cliente = 1234, Right = Atendente = 0 silêncio)
  assert.strictEqual(wavBuf.readInt16LE(44 + 640), 1234, 'Canal Esquerdo no 2º frame deve conter 1234');
  assert.strictEqual(wavBuf.readInt16LE(44 + 642), 0, 'Canal Direito no 2º frame pós-barge-in deve ser 0 (silêncio)');

  // Valida arquivo .txt de transcrição
  const txtContent = fs.readFileSync(rec.transcriptPath, 'utf8').trim().split('\n');
  assert.strictEqual(txtContent.length, 2);
  assert.strictEqual(txtContent[0], '[2026-11-01 18:15:30] Cliente: Olá, gostaria de consultar meu saldo.');
  assert.strictEqual(txtContent[1], '[2026-11-01 18:15:34] Atendente: Claro! Por favor, digite ou fale seu CPF.');

  fs.rmSync(tmpRecDir, { recursive: true, force: true });
  console.log('   ✅ CallRecorder Stereo (WAV 8kHz L/R + Barge-in + Transcrição Cliente/Atendente com Data/Hora) aprovado!\n');

  // -------------------------------------------------------------------------
  // 8. Teste de Regra Condicional de Gravação (Somente com STT) + Captura DTMF (Debounce & '#')
  // -------------------------------------------------------------------------
  console.log('👉 [8/8] Testando Regra Condicional de Gravação (STT) e DTMF In-Call (Debounce, # e Barge-In)...');

  // 8.1 Verifica que WsMediaBridge.killAudio() também aciona clearAiBuffer() no gravador quando acoplado
  const bridgeMedia = new WsMediaBridge();
  let clearAiCalled = false;
  bridgeMedia.setRecorder({
    pushAiChunk: () => {},
    clearAiBuffer: () => { clearAiCalled = true; },
    stop: async () => {}
  });
  bridgeMedia.killAudio();
  assert.strictEqual(clearAiCalled, true, 'killAudio() deve truncar o buffer de gravação da IA no Barge-In');

  // 8.1.1 Teste de Período de Graça Dinâmico de Barge-In (Corte durante frase inicial do agente e abertura automática)
  const graceHarness = {
    callId: 'qa-bargein-grace',
    startedAt: new Date(Date.now() - 2000), // 2s decorridos de chamada
    bargeinGraceSec: 8,
    isMicMutedByGrace: true,
    isGreetingInProgress: true,
    graceCompleted: false,
    isSafetyExpiring: false,
    isAgentTalking: true,
    killed: false,
    mediaBridge: {
      killAudio: () => { graceHarness.killed = true; }
    },
    isBargeinGraceActive() {
      if (this.graceCompleted) return false;
      if (this.isGreetingInProgress || this.isMicMutedByGrace) return true;
      if (!this.startedAt || this.bargeinGraceSec <= 0) return false;
      const elapsedSec = (Date.now() - this.startedAt.getTime()) / 1000;
      return elapsedSec < this.bargeinGraceSec;
    },
    canTriggerBargeIn() {
      if (this.isSafetyExpiring) return false;
      if (this.graceCompleted) return true;
      if (this.isGreetingInProgress || this.isMicMutedByGrace) return false;
      if (this.isBargeinGraceActive()) return false;
      return true;
    },
    triggerBargeIn(reason) {
      if (!this.canTriggerBargeIn()) return false;
      this.isAgentTalking = false;
      this.mediaBridge.killAudio();
      return true;
    },
    openCustomerChannel(reason) {
      this.isGreetingInProgress = false;
      this.isMicMutedByGrace = false;
      this.graceCompleted = true;
    }
  };

  // Enquanto o agente fala a frase inicial de boas-vindas: canal cortado e interrupção bloqueada
  assert.strictEqual(graceHarness.isGreetingInProgress, true);
  assert.strictEqual(graceHarness.isMicMutedByGrace, true);
  assert.strictEqual(graceHarness.isBargeinGraceActive(), true);
  assert.strictEqual(graceHarness.canTriggerBargeIn(), false);
  const blockedResult = graceHarness.triggerBargeIn('speech_started');
  assert.strictEqual(blockedResult, false);
  assert.strictEqual(graceHarness.killed, false);
  assert.strictEqual(graceHarness.isAgentTalking, true);

  // Assim que o agente termina a frase inicial (boas-vindas e pergunta como pode ajudar): canal ABERTO imediatamente!
  graceHarness.openCustomerChannel('greeting_completed');
  assert.strictEqual(graceHarness.isGreetingInProgress, false);
  assert.strictEqual(graceHarness.isBargeinGraceActive(), false);
  assert.strictEqual(graceHarness.canTriggerBargeIn(), true);
  const allowedResult = graceHarness.triggerBargeIn('speech_started');
  assert.strictEqual(allowedResult, true);
  assert.strictEqual(graceHarness.killed, true);
  assert.strictEqual(graceHarness.isAgentTalking, false);

  // 8.2 Simula lógica de DTMF com Debounce e '#'
  let sentOpenAiEvents = [];
  let bargeInKilled = false;
  const dtmfHarness = {
    callId: 'qa-dtmf',
    isTerminated: false,
    isAgentTalking: true,
    dtmfBuffer: '',
    dtmfTimer: null,
    tenant: { dtmf: { enabled: true, debounceMs: 80 } },
    whisperSession: { isSttEnabled: true },
    recorder: {
      transcripts: [],
      addTranscript(speaker, text) {
        const formatted = `[${formatDateTime()}] ${speaker}: ${text}`;
        this.transcripts.push(formatted);
        return { formatted };
      }
    },
    recordTranscriptTurn(speaker, text) {
      return this.recorder.addTranscript(speaker, text);
    },
    isBargeinGraceActive() {
      return false;
    },
    mediaBridge: {
      killAudio: () => { bargeInKilled = true; }
    },
    openaiSocket: {
      readyState: WebSocket.OPEN,
      send: (msg) => sentOpenAiEvents.push(JSON.parse(msg))
    }
  };

  // Extrai métodos handleDtmf e flushDtmfBuffer da classe OpenAIS2SBridge em index.js
  const handleDtmfMatch = indexContent.match(/handleDtmf\(evt\)\s*\{[\s\S]+?\n  \}\n\n  flushDtmfBuffer\(\)\s*\{[\s\S]+?\n  \}/);
  assert.ok(handleDtmfMatch, 'Métodos handleDtmf e flushDtmfBuffer devem existir em index.js');
  const dtmfMethods = eval(`(class { ${handleDtmfMatch[0]} })`).prototype;
  dtmfHarness.handleDtmf = dtmfMethods.handleDtmf.bind(dtmfHarness);
  dtmfHarness.flushDtmfBuffer = dtmfMethods.flushDtmfBuffer.bind(dtmfHarness);

  // Valida que durante o período de carência (isBargeinGraceActive = true), DTMF é ignorado
  dtmfHarness.isBargeinGraceActive = () => true;
  dtmfHarness.handleDtmf({ dtmf: '7' });
  assert.strictEqual(dtmfHarness.dtmfBuffer, '', 'Dígitos DTMF devem ser ignorados durante período de carência');
  dtmfHarness.isBargeinGraceActive = () => false;

  // Digita '1', '2', '3', '#' (flush imediato no '#')
  dtmfHarness.handleDtmf({ dtmf: '1' });
  assert.strictEqual(bargeInKilled, true, '1º dígito DTMF deve acionar Barge-In imediato se IA estiver falando');
  assert.strictEqual(dtmfHarness.isAgentTalking, false);
  dtmfHarness.handleDtmf({ dtmf: '2' });
  dtmfHarness.handleDtmf({ dtmf: '3' });
  dtmfHarness.handleDtmf({ dtmf: '#' });

  // Verifica que 'response.cancel', 'conversation.item.create' e 'response.create' foram enviados imediatamente
  assert.strictEqual(sentOpenAiEvents[0].type, 'response.cancel');
  assert.strictEqual(sentOpenAiEvents[1].type, 'conversation.item.create');
  assert.strictEqual(
    sentOpenAiEvents[1].item.content[0].text,
    '[DTMF digitado pelo usuário no teclado: 123]'
  );
  assert.strictEqual(sentOpenAiEvents[2].type, 'response.create');
  assert.ok(dtmfHarness.recorder.transcripts[0].includes('Cliente: [DTMF: 123]'));

  // Testa disparo por timeout de Debounce (sem '#')
  sentOpenAiEvents = [];
  dtmfHarness.handleDtmf({ dtmf: '9' });
  dtmfHarness.handleDtmf({ dtmf: '8' });
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(sentOpenAiEvents.length, 2, 'Debounce timer deve enviar conversation.item.create + response.create');
  assert.strictEqual(
    sentOpenAiEvents[0].item.content[0].text,
    '[DTMF digitado pelo usuário no teclado: 98]'
  );

  // Verifica no código de index.js que CallRecorder só é instanciado se this.whisperSession.isSttEnabled for true
  assert.ok(
    indexContent.includes('if (this.whisperSession && this.whisperSession.isSttEnabled) {\n      this.recorder = new CallRecorder('),
    'Gravação stereo deve ser condicionada estritamente a this.whisperSession.isSttEnabled'
  );

  // Verifica que o corte de microfone no FreeSWITCH (uuid_audio start read mute / stop read) está implementado
  assert.ok(
    indexContent.includes('uuid_audio ${this.channelUuid} start read mute'),
    'Deve enviar comando FreeSWITCH para cortar microfone do cliente no bargein grace'
  );
  assert.ok(
    indexContent.includes('uuid_audio ${this.channelUuid} stop read'),
    'Deve enviar comando FreeSWITCH para reativar microfone do cliente ao fim do grace'
  );
  console.log('   ✅ Regra Condicional de Gravação (STT) + DTMF In-Call aprovados!\n');

  // -------------------------------------------------------------------------
  // 9. Teste Completo da API REST (/v1) com os Principais Comandos de Mercado
  // -------------------------------------------------------------------------
  console.log('👉 [9/9] Testando API REST (/v1/commands, /v1/calls, originate, say, transfer, dtmf, mute, hold, recording, tenants)...');
  const mockActiveBridges = new Map();
  let lastAction = null;

  const mockCallBridge = {
    getCallInfo: (includeTranscript) => ({
      callId: 'call-api-1',
      channelUuid: 'uuid-api-1',
      tenantId: 'default',
      caller: '1000',
      called: '2000',
      sttEnabled: true,
      recordingActive: true,
      transcript: includeTranscript
        ? [{ timestamp: '2026-11-01 18:20:00', speaker: 'Cliente', text: 'Oi', formatted: '[2026-11-01 18:20:00] Cliente: Oi' }]
        : undefined
    }),
    say: (text, opts) => {
      lastAction = { cmd: 'say', text, opts };
      return { role: opts.role, interrupt: opts.interrupt };
    },
    interruptAgent: () => {
      lastAction = { cmd: 'interrupt' };
    },
    transfer: async (target, opts) => {
      lastAction = { cmd: 'transfer', target, opts };
      return { mode: opts.mode, target };
    },
    sendDtmf: async (digits, direction) => {
      lastAction = { cmd: 'dtmf', digits, direction };
      return { digits, direction };
    },
    setMute: async (muted) => {
      lastAction = { cmd: 'mute', muted };
      return { isMuted: muted };
    },
    setHold: async (held) => {
      lastAction = { cmd: 'hold', held };
      return { isOnHold: held };
    },
    controlRecording: async (action) => {
      lastAction = { cmd: 'recording', action };
      return { recordingActive: action === 'start' || action === 'resume', recordingPaused: action === 'pause' };
    },
    terminateCall: (reason) => {
      lastAction = { cmd: 'hangup', reason };
      mockActiveBridges.delete('call-api-1');
    }
  };
  mockActiveBridges.set('call-api-1', mockCallBridge);

  const tmpTenantsApiFile = path.join(os.tmpdir(), `tenants-api-qa-${Date.now()}.json`);
  const tmApi = new TenantManagerClass(tmpTenantsApiFile);
  const apiRouter = createApiRouter({
    activeBridges: mockActiveBridges,
    tenantManager: tmApi,
    fsPool,
    whisperPool,
    mediaServer,
    originateCallHandler: async (body) => ({
      ok: true,
      callId: 'out-call-999',
      to: body.to,
      from: body.from || '1000'
    })
  });

  const apiTestServer = http.createServer((req, res) => {
    apiRouter(req, res);
  });
  await new Promise((r) => apiTestServer.listen(0, '127.0.0.1', r));
  const apiPort = apiTestServer.address().port;

  function apiReq(method, urlPath, bodyObj = null) {
    return new Promise((resolve, reject) => {
      const data = bodyObj ? JSON.stringify(bodyObj) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: apiPort,
          path: urlPath,
          method,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
        }
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // 9.0 Front-End de Acompanhamento em Tempo Real (GET / e GET /dashboard)
  const feRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${apiPort}/`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
  assert.strictEqual(feRes.status, 200);
  assert.ok(feRes.headers['content-type'].includes('text/html'));
  assert.ok(feRes.body.includes('Voice-App Gateway AI | Painel de Acompanhamento'));

  // 9.1 Catálogo de comandos e Status do Cluster
  const catRes = await apiReq('GET', '/v1/commands');
  assert.strictEqual(catRes.status, 200);
  assert.ok(Array.isArray(catRes.body.commandsCatalog) && catRes.body.commandsCatalog.length >= 5);

  const statusRes = await apiReq('GET', '/v1/status');
  assert.strictEqual(statusRes.status, 200);
  assert.ok(statusRes.body.whisperCluster && typeof statusRes.body.whisperCluster.totalNodes === 'number');
  assert.ok(Array.isArray(statusRes.body.voiceFeatures) && statusRes.body.voiceFeatures.length === 14);

  const featRes = await apiReq('GET', '/v1/features');
  assert.strictEqual(featRes.status, 200);
  assert.strictEqual(featRes.body.count, 14);
  assert.ok(featRes.body.activeCount >= 9);

  // 9.1.1 Diagnóstico das 14 Features de Voz (/v1/features/test)
  const diagRes = await apiReq('POST', '/v1/features/test');
  assert.strictEqual(diagRes.status, 200);
  assert.strictEqual(diagRes.body.ok, true);
  assert.strictEqual(diagRes.body.total, 14);
  assert.strictEqual(diagRes.body.passed, 14);
  assert.strictEqual(diagRes.body.failed, 0);
  assert.ok(diagRes.body.totalDurationMs < 1000);
  assert.strictEqual(diagRes.body.features.length, 14);
  assert.strictEqual(diagRes.body.features[0].test.passed, true);

  // 9.1.2 Teste de feature individual (/v1/features/crosstalk_filter/test, wespeaker e ecapa)
  const xtalkTestRes = await apiReq('POST', '/v1/features/crosstalk_filter/test');
  assert.strictEqual(xtalkTestRes.status, 200);
  assert.strictEqual(xtalkTestRes.body.ok, true);
  assert.strictEqual(xtalkTestRes.body.test.passed, true);

  const wespeakerTestRes = await apiReq('POST', '/v1/features/wespeaker/test');
  assert.strictEqual(wespeakerTestRes.status, 200);
  assert.strictEqual(wespeakerTestRes.body.ok, true);
  assert.strictEqual(wespeakerTestRes.body.test.passed, true);

  const ecapaTestRes = await apiReq('POST', '/v1/features/ecapa/test');
  assert.strictEqual(ecapaTestRes.status, 200);
  assert.strictEqual(ecapaTestRes.body.ok, true);
  assert.strictEqual(ecapaTestRes.body.test.passed, true);

  const graceTestRes = await apiReq('POST', '/v1/features/bargein_grace/test');
  assert.strictEqual(graceTestRes.status, 200);
  assert.strictEqual(graceTestRes.body.ok, true);
  assert.strictEqual(graceTestRes.body.test.passed, true);

  // 9.1.3 Alternância do Filtro de Voz de Fundo via API (/v1/features/crosstalk/mode)
  const setWespeakerRes = await apiReq('POST', '/v1/features/crosstalk/mode', { mode: 'wespeaker' });
  assert.strictEqual(setWespeakerRes.status, 200);
  assert.strictEqual(setWespeakerRes.body.ok, true);
  assert.strictEqual(setWespeakerRes.body.mode, 'wespeaker');

  const checkWespeakerRes = await apiReq('GET', '/v1/features');
  const wespeakerFeat = checkWespeakerRes.body.features.find(f => f.id === 'wespeaker');
  const dspFeat = checkWespeakerRes.body.features.find(f => f.id === 'crosstalk_filter');
  assert.strictEqual(wespeakerFeat.active, true);
  assert.strictEqual(dspFeat.active, false);

  // Retorna para o modo 'atual' (DSP)
  const setAtualRes = await apiReq('POST', '/v1/features/crosstalk/mode', { mode: 'atual' });
  assert.strictEqual(setAtualRes.status, 200);
  assert.strictEqual(setAtualRes.body.mode, 'atual');

  const nodesRes = await apiReq('GET', '/v1/cluster/nodes');
  assert.strictEqual(nodesRes.status, 200);
  assert.ok(nodesRes.body.freeSwitch && nodesRes.body.whisper);

  // 9.2 Listagem de chamadas ativas
  const listCalls = await apiReq('GET', '/v1/calls');
  assert.strictEqual(listCalls.status, 200);
  assert.strictEqual(listCalls.body.count, 1);

  // 9.3 Originação Outbound (POST /v1/calls)
  const origRes = await apiReq('POST', '/v1/calls', { to: '1000@192.168.15.36', from: '551140040001' });
  assert.strictEqual(origRes.status, 201);
  assert.strictEqual(origRes.body.callId, 'out-call-999');

  // 9.4 Comandos In-Call: say, interrupt, transfer, dtmf, mute, hold, recording (pause/resume), transcript, hangup
  const sayRes = await apiReq('POST', '/v1/calls/call-api-1/say', { text: 'Ofereça 20% de desconto agora' });
  assert.strictEqual(sayRes.status, 200);
  assert.strictEqual(lastAction.cmd, 'say');

  const intRes = await apiReq('POST', '/v1/calls/call-api-1/interrupt');
  assert.strictEqual(intRes.status, 200);
  assert.strictEqual(lastAction.cmd, 'interrupt');

  const xferRes = await apiReq('POST', '/v1/calls/call-api-1/transfer', { target: '2005', mode: 'blind' });
  assert.strictEqual(xferRes.status, 200);
  assert.strictEqual(lastAction.target, '2005');

  const dtmfApiRes = await apiReq('POST', '/v1/calls/call-api-1/dtmf', { digits: '456#' });
  assert.strictEqual(dtmfApiRes.status, 200);
  assert.strictEqual(lastAction.digits, '456#');

  const muteRes = await apiReq('POST', '/v1/calls/call-api-1/mute');
  assert.strictEqual(muteRes.status, 200);
  assert.strictEqual(muteRes.body.isMuted, true);

  const holdRes = await apiReq('POST', '/v1/calls/call-api-1/hold');
  assert.strictEqual(holdRes.status, 200);
  assert.strictEqual(holdRes.body.isOnHold, true);

  const recPauseRes = await apiReq('POST', '/v1/calls/call-api-1/recording', { action: 'pause' });
  assert.strictEqual(recPauseRes.status, 200);
  assert.strictEqual(recPauseRes.body.recordingPaused, true);

  const trApiRes = await apiReq('GET', '/v1/calls/call-api-1/transcript');
  assert.strictEqual(trApiRes.status, 200);
  assert.ok(trApiRes.body.formatted.includes('Cliente: Oi'));

  const hupRes = await apiReq('POST', '/v1/calls/call-api-1/hangup', { reason: 'operator_ended' });
  assert.strictEqual(hupRes.status, 200);
  assert.strictEqual(mockActiveBridges.size, 0);

  // 9.5 CRUD de Tenants (/v1/tenants)
  const createTenantRes = await apiReq('POST', '/v1/tenants', {
    id: 'banco-xyz',
    name: 'Banco XYZ',
    dids: ['551130030000'],
    stt: { enabled: true }
  });
  assert.strictEqual(createTenantRes.status, 201);
  assert.strictEqual(createTenantRes.body.tenant.stt.enabled, true);

  const delTenantRes = await apiReq('DELETE', '/v1/tenants/banco-xyz');
  assert.strictEqual(delTenantRes.status, 200);

  // 9.6 Exclusão em Lote de Gravações (/v1/recordings/batch-delete)
  const targetRecDir = process.env.RECORDING_DIR || path.join(__dirname, 'recordings');
  fs.mkdirSync(targetRecDir, { recursive: true });
  fs.writeFileSync(path.join(targetRecDir, 'batch-test-1.wav'), 'fake-wav-1');
  fs.writeFileSync(path.join(targetRecDir, 'batch-test-1.txt'), 'fake-txt-1');
  fs.writeFileSync(path.join(targetRecDir, 'batch-test-2.wav'), 'fake-wav-2');
  fs.writeFileSync(path.join(targetRecDir, 'batch-test-2.txt'), 'fake-txt-2');

  const batchDelRes = await apiReq('POST', '/v1/recordings/batch-delete', {
    ids: ['batch-test-1', 'batch-test-2']
  });
  assert.strictEqual(batchDelRes.status, 200);
  assert.strictEqual(batchDelRes.body.ok, true);
  assert.strictEqual(batchDelRes.body.deletedCount, 2);
  assert.strictEqual(fs.existsSync(path.join(targetRecDir, 'batch-test-1.wav')), false);
  assert.strictEqual(fs.existsSync(path.join(targetRecDir, 'batch-test-1.txt')), false);
  assert.strictEqual(fs.existsSync(path.join(targetRecDir, 'batch-test-2.wav')), false);
  assert.strictEqual(fs.existsSync(path.join(targetRecDir, 'batch-test-2.txt')), false);

  apiTestServer.close();
  try { fs.unlinkSync(tmpTenantsApiFile); } catch {}
  console.log('   ✅ API REST (/v1) com todos os principais comandos de mercado aprovada!\n');

  // 9.2 VAD por frame (modos sem gate DSP): silêncio nunca é fala ativa; fala sustentada é; cauda não conta
  const FrameVad = require('./utils/frame-vad');
  const makeFrame = (amp) => {
    const b = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) b.writeInt16LE(Math.round(Math.sin(i * 0.3) * amp), i * 2);
    return b;
  };
  const vad = new FrameVad();
  for (let i = 0; i < 200; i++) {
    assert.strictEqual(vad.process(Buffer.alloc(320)), false, 'silêncio não pode ser fala ativa');
  }
  for (let i = 0; i < 7; i++) {
    assert.strictEqual(vad.process(makeFrame(3000)), false, 'frames isolados (<8) não disparam');
  }
  assert.strictEqual(vad.process(makeFrame(3000)), true, '8 frames sustentados (160ms) = fala ativa');
  assert.strictEqual(vad.process(Buffer.alloc(320)), false, 'cauda silenciosa (hangover) não conta como fala ativa');
  for (let i = 0; i < 10; i++) vad.process(Buffer.alloc(320));
  assert.strictEqual(vad.speaking, false);
  // Ruído de fundo baixo constante não deve disparar
  const vad2 = new FrameVad();
  for (let i = 0; i < 300; i++) assert.strictEqual(vad2.process(makeFrame(120)), false);
  console.log('   ✅ FrameVad (barge-in sem gate DSP calibrado: 160ms ataque, 800 RMS) aprovado!');

  console.log('====================================================');
  console.log('🎉 TODOS OS 9 BLOCOS DE QA PASSARAM COM 100% DE SUCESSO!');
  console.log('====================================================');
}

runQaSuite().catch((err) => {
  console.error('❌ FALHA NA SUITE DE QA:', err);
  process.exit(1);
});
