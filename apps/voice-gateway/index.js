require('dotenv').config({ override: true });
// Voice App - High-Scalability Multi-Tenant & Multi-FreeSWITCH Voice Gateway

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const getTS = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });
console.log = (...args) => originalLog(`[${getTS()}]`, ...args);
console.error = (...args) => originalError(`[${getTS()}]`, ...args);
console.warn = (...args) => originalWarn(`[${getTS()}]`, ...args);

const Srf = require('drachtio-srf');
const Mrf = require('drachtio-fsmrf');
const WebSocket = require('ws');

const DRACHTIO_MODE = (process.env.DRACHTIO_MODE || 'inbound').toLowerCase(); // 'inbound' (connect) ou 'outbound' (listen)
const DRACHTIO_HOST = process.env.DRACHTIO_HOST || '127.0.0.1';
const DRACHTIO_PORT = parseInt(process.env.DRACHTIO_PORT || '9022', 10);
const DRACHTIO_SECRET = process.env.DRACHTIO_SECRET || 'cymru';
const DRACHTIO_LISTEN_PORT = parseInt(process.env.DRACHTIO_LISTEN_PORT || '3000', 10);
const WORKER_ID = parseInt(process.env.NODE_APP_INSTANCE || process.env.WORKER_ID || '0', 10);

const EnergyManager = require('./utils/energy-manager');
const CrosstalkFilter = require('./utils/crosstalk-filter');
const FrameVad = require('./utils/frame-vad');
const WsMediaBridge = require('./media/ws-media-bridge');
const { mediaServer } = require('./media/ws-media-bridge');
const tenantManager = require('./utils/tenant-manager');
const trunkManager = require('./utils/trunk-manager');
const routeManager = require('./utils/route-manager');
const providerManager = require('./utils/provider-manager');
const OutreachManager = require('./utils/outreach-manager');
const aiCostTracker = require('./utils/ai-cost-tracker');
const FreeSwitchPool = require('./utils/freeswitch-pool');
const { WhisperSession, whisperPool } = require('./media/whisper-client');
const { CallRecorder, formatDateTime } = require('./utils/call-recorder');
const CallHistoryManager = require('./utils/call-history-manager');
const ExtensionManager = require('./utils/extension-manager');
const { createApiRouter } = require('./utils/api-router');
const aiProviderManager = require('./utils/ai-provider-manager');
const ElevenLabsS2SBridge = require('./media/elevenlabs-s2s-bridge');
const { sendVollPlanWebhook } = require('./utils/voll-webhook');

function createAiBridge(tenant, sipHeaders) {
  const engine = (tenant?.stsEngine || 'openai').toLowerCase();
  if (engine === 'elevenlabs') {
    return new ElevenLabsS2SBridge(tenant, sipHeaders, { callHistoryManager });
  }
  return new OpenAIS2SBridge(tenant, sipHeaders);
}

const srf = new Srf();
const mrf = new Mrf(srf);
const fsPool = new FreeSwitchPool(mrf);
const callHistoryManager = new CallHistoryManager();
const extensionManager = new ExtensionManager(fsPool);
const outboundRouteManager = require('./utils/outbound-route-manager');
outboundRouteManager.setFsPool(fsPool);

let isShuttingDown = false;
let isDrachtioConnected = false;
const activeBridges = new Map(); // callId -> OpenAIS2SBridge

// Endpoint /health agora exibe métricas do Worker, Tenants e de todo o Cluster FreeSWITCH
mediaServer.setHealthCallback(() => ({
  drachtioMode: DRACHTIO_MODE,
  drachtioConnected: DRACHTIO_MODE === 'outbound' ? true : isDrachtioConnected,
  freeSwitchCluster: fsPool.getPoolStats(),
  activeCallsByTenant: tenantManager.getTenantStats(),
  shuttingDown: isShuttingDown
}));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms)
    )
  ]);
}

function getCallId(req) {
  return req.get('Call-ID') || req.get('call-id') || `call-${Date.now()}`;
}

function getChannelUuid(endpoint) {
  return (
    endpoint?.uuid ||
    endpoint?.id ||
    endpoint?.sessionId ||
    endpoint?.channelId ||
    endpoint?.conn?.uuid
  );
}

const {
  StatefulResampler24to8,
  StatefulReconstructionFilter8k,
  upsample8to24,
  linear16ToMulaw,
  mulawToLinear16
} = require('./utils/audio-resampler');

class OpenAIS2SBridge {
  constructor(tenant, sipHeaders = {}) {
    this.tenant = tenant;
    this.sipHeaders = sipHeaders;
    this.whisperSession = null;
    const provider = aiProviderManager.get('openai');
    const codec = provider?.audioCodec || tenant.audioCodec || process.env.AUDIO_CODEC_MODE || 'g711_ulaw';
    this.useG711 = codec === 'g711_ulaw';
    this.resampler24to8 = new StatefulResampler24to8();
    this.reconFilter8k = new StatefulReconstructionFilter8k();
    this.endpoint = null;
    this.dialog = null;
    this.channelUuid = null;
    this.callId = null;
    this.attemptId = null;
    this.providerAttemptId = null;
    this.callOutcome = null;
    this.energyManager = new EnergyManager();
    this.mediaBridge = new WsMediaBridge();

    this.baseThreshold = 0.45;
    this.isAgentTalking = false;
    this.deviceMode = 'viva_voz';
    this.isToneProbe = false;

    this.calibrationActive = true;
    this.calibrationSamplesRecv = 0;

    // Perfis acústicos calibrados por tipo de linha:
    // - trunk_sip (Linha Telefônica PSTN / Tronco SIP / Celular):
    //   G.711 / AMR com corte de banda e ruído de operadora. Exige latência ultra-baixa de fim de turno (250-300ms)
    //   e VAD adaptativo calibrado (0.45 a 0.65 máx) para resposta imediata.
    // - softphone (Softphone IP / MicroSIP / Linphone em PC/Headset):
    //   Microfone de alta fidelidade e sala de escritório com corte padronizado em 250-300ms.
    this.profilesByLine = {
      trunk_sip: {
        SILENCE: {
          fone: { base: 0.45, prefix: 150, silence: 250 },
          viva: { base: 0.48, prefix: 160, silence: 270 }
        },
        OFFICE: {
          fone: { base: 0.50, prefix: 160, silence: 270 },
          viva: { base: 0.52, prefix: 180, silence: 280 }
        },
        STREET: {
          fone: { base: 0.55, prefix: 180, silence: 280 },
          viva: { base: 0.58, prefix: 200, silence: 290 }
        },
        TV: {
          fone: { base: 0.62, prefix: 200, silence: 290 },
          viva: { base: 0.65, prefix: 200, silence: 300 }
        }
      },
      softphone: {
        SILENCE: {
          fone: { base: 0.45, prefix: 150, silence: 250 },
          viva: { base: 0.48, prefix: 160, silence: 270 }
        },
        OFFICE: {
          fone: { base: 0.50, prefix: 160, silence: 270 },
          viva: { base: 0.55, prefix: 180, silence: 280 }
        },
        STREET: {
          fone: { base: 0.58, prefix: 180, silence: 280 },
          viva: { base: 0.62, prefix: 200, silence: 290 }
        },
        TV: {
          fone: { base: 0.68, prefix: 200, silence: 290 },
          viva: { base: 0.72, prefix: 200, silence: 300 }
        }
      }
    };
    this.lineType = 'trunk_sip';
    this.profiles = this.profilesByLine.trunk_sip;
    this.currentProfile = 'SILENCE';

    this.openaiSocket = null;
    this.openaiConnected = false;
    this.openaiReady = false;
    this.openaiReadyPromise = null;
    this.openaiReadyResolve = null;

    this.maxDurationTimer = null;
    this.warningDurationTimer = null;
    this.safetyCloseTimer = null;
    this.isSafetyExpiring = false;
    this.maxDurationSec = 180;
    this.isTerminated = false;

    const sipBargeinGrace = this.sipHeaders['x-bargein-grace-sec'] || this.sipHeaders['X-Bargein-Grace-Sec'];
    this.bargeinGraceSec = Number(
      sipBargeinGrace !== undefined
        ? sipBargeinGrace
        : this.tenant.bargeinGraceSec ?? process.env.BARGEIN_GRACE_SEC ?? 8
    );
    this.isMicMutedByGrace = false;
    this.graceUnmuteTimer = null;
    this.isGreetingInProgress = false;
    this.greetingResponsePending = false;
    this.greetingResponseId = null;
    this.greetingAudioBytes = 0;
    this.greetingPlaybackStartTime = null;
    this.greetingFinishTimer = null;
    this.greetingSafetyTimer = null;
    this.graceCompleted = false;

    // Configuração dos 3 Modos de Filtro de Voz de Fundo:
    // 1. 'atual' (ou 'dsp'): Filtro Acústico (YIN CMNDF pitch + proximidade spectral + RMS)
    // 2. 'wespeaker': Biometria Neural CAM++ (ONNX 512-dim)
    // 3. 'ecapa': Biometria Neural ECAPA-TDNN (ONNX 512-dim)
    // 4. 'none': Filtro desligado
    const rawFilterMode = String(
      this.sipHeaders['x-crosstalk-mode'] ||
      this.sipHeaders['X-Crosstalk-Mode'] ||
      (this.tenant.crosstalkFilter && this.tenant.crosstalkFilter.mode) ||
      this.tenant.crosstalkMode ||
      process.env.CROSSTALK_FILTER_MODE ||
      'atual'
    ).toLowerCase();

    this.crosstalkMode = ['atual', 'dsp', 'wespeaker', 'ecapa', 'none'].includes(rawFilterMode)
      ? rawFilterMode
      : 'atual';

    this.isDspFilterActive = this.crosstalkMode === 'atual' || this.crosstalkMode === 'dsp';
    this.isNeuralFilterActive = this.crosstalkMode === 'wespeaker' || this.crosstalkMode === 'ecapa';

    const crosstalkRatio = Number(
      this.sipHeaders['x-crosstalk-ratio'] ||
      this.sipHeaders['X-Crosstalk-Ratio'] ||
      (this.tenant.crosstalkFilter && this.tenant.crosstalkFilter.ratio) ||
      this.tenant.crosstalkRatio ||
      process.env.CROSSTALK_RATIO ||
      0.45
    );

    this.crosstalkFilter = this.isDspFilterActive
      ? new CrosstalkFilter({ ratio: crosstalkRatio, hangoverMs: 400 })
      : null;
    this.crosstalkEnrolledLogged = false;
    this.dynamicEcapaSwitched = false;
    this.crosstalkRatio = crosstalkRatio;

    // VAD de energia por frame: detector de "fala ativa" quando o gate DSP não está em uso
    // (modos 'wespeaker', 'ecapa' e 'none'), evitando barge-in por frames de silêncio ou ruídos de fundo.
    const frameVadMinRms = Number(this.tenant?.bargeinMinRms || process.env.BARGEIN_MIN_RMS || 800);
    const frameVadAttack = Number(this.tenant?.bargeinAttackFrames || process.env.BARGEIN_ATTACK_FRAMES || 8);
    this.frameVad = this.crosstalkFilter
      ? null
      : new FrameVad({ minRms: frameVadMinRms, attackFrames: frameVadAttack, noiseRatio: 2.8 });

    // Estado da Biometria Neural ('wespeaker' / 'ecapa')
    this.isSecondaryVoiceBlocked = false;
    this.lastSpeakerScore = 1.0;
    this.agentPlaybackStartTime = null;

    this.recorder = null;
    this.isResponseCancelled = false;
    this.dtmfBuffer = '';
    this.dtmfTimer = null;
    this.startedAt = null;
    this.caller = null;
    this.called = null;
    this.isMuted = false;
    this.isOnHold = false;
    this.transcriptLog = [];
    this.lastTurn = null;
    this.activeAudioFormat = this.useG711 ? 'g711_ulaw' : 'pcm24k';
    this.cleanupHandler = null;
    this.graceEndLogged = false;

    this.handleEslEvent = this.handleEslEvent.bind(this);
    this.handleDtmf = this.handleDtmf.bind(this);
  }

  setCleanupHandler(handler) {
    this.cleanupHandler = handler;
  }

  isBargeinGraceActive() {
    if (this.graceCompleted) return false;
    if (this.isGreetingInProgress || this.isMicMutedByGrace) return true;
    if (!this.startedAt || this.bargeinGraceSec <= 0) return false;
    const elapsedSec = (Date.now() - this.startedAt.getTime()) / 1000;
    return elapsedSec < this.bargeinGraceSec;
  }

  canTriggerBargeIn() {
    if (this.isSafetyExpiring) return false;
    if (this.isGreetingInProgress || this.isMicMutedByGrace) return false;
    if (this.isBargeinGraceActive()) return false;
    // Carência mínima de 450ms após o início do áudio do agente para evitar falso corte pelo eco/cauda do usuário
    if (this.agentPlaybackStartTime && Date.now() - this.agentPlaybackStartTime < 450) {
      return false;
    }
    return true;
  }

  safeApi(cmd) {
    if (!this.endpoint || typeof this.endpoint.api !== 'function' || this.isTerminated) {
      return Promise.resolve(null);
    }
    return this.endpoint.api(cmd).catch(() => null);
  }

  async openCustomerChannel(reason = 'greeting_completed') {
    if (!this.isMicMutedByGrace && !this.isGreetingInProgress) return;
    this.isGreetingInProgress = false;
    this.isMicMutedByGrace = false;
    this.graceCompleted = true;

    if (this.greetingFinishTimer) {
      clearTimeout(this.greetingFinishTimer);
      this.greetingFinishTimer = null;
    }
    if (this.greetingSafetyTimer) {
      clearTimeout(this.greetingSafetyTimer);
      this.greetingSafetyTimer = null;
    }
    if (this.graceUnmuteTimer) {
      clearTimeout(this.graceUnmuteTimer);
      this.graceUnmuteTimer = null;
    }

    if (this.endpoint && this.channelUuid && !this.isTerminated) {
      await this.safeApi(`uuid_audio ${this.channelUuid} stop read`);
      await this.safeApi(`uuid_audio ${this.channelUuid} stop`);
    }

    console.log(
      `[${this.callId}] 🎙️ [BARGE-IN DINÂMICO] Saudação inicial do agente concluída (${reason}). Canal do cliente ABERTO no FreeSWITCH. Pedidos e barge-in liberados!`
    );

    if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
      try {
        this.openaiSocket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      } catch {}
    }
  }

  triggerBargeIn(reason = 'speech_started') {
    if (!this.canTriggerBargeIn()) {
      const elapsedSec = this.startedAt ? (Date.now() - this.startedAt.getTime()) / 1000 : 0;
      console.log(
        `[${this.callId}] 🛡️ [BARGE-IN GRACE] Tentativa de interrupção (${reason}) bloqueada: ${elapsedSec.toFixed(1)}s < ${this.bargeinGraceSec}s (Pedido do cliente ignorado durante saudação).`
      );
      if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
        try {
          this.openaiSocket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        } catch {}
      }
      return false;
    }

    console.log(`[${this.callId}] 🎤 BARGE-IN: Interrompendo agente imediatamente (${reason})...`);
    this.isAgentTalking = false;
    this.agentPlaybackStartTime = null;
    this.isResponseCancelled = true;
    this.resampler24to8.reset();
    this.reconFilter8k.reset();
    this.mediaBridge.killAudio();
    if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
      try {
        this.openaiSocket.send(JSON.stringify({ type: 'response.cancel' }));
      } catch {}
    }
    if (this.channelUuid) {
      this.safeApi(`uuid_audio_fork ${this.channelUuid} stop_play`);
      this.safeApi(`uuid_break ${this.channelUuid} all`);
    }
    return true;
  }

  handleEslEvent(evt) {
    if (!evt || !evt.getHeader) return;
    const subclass = evt.getHeader('Event-Subclass');
    const eventUuid = evt.getHeader('Unique-ID');
    if (eventUuid && eventUuid !== this.channelUuid) return;

    if (subclass === 'mod_audio_fork::play_audio') {
      const file = evt.getHeader('file');
      if (file && this.endpoint) {
        console.log(`[${this.callId}] 🔊 Evento play_audio recebido: ${file}`);
        this.endpoint.play(file).catch((e) => {
          if (!e.message?.includes('break')) {
            console.error(`[${this.callId}] Erro ao tocar play_audio:`, e.message);
          }
        });
      }
    }
  }

  initOpenAiConnection() {
    this.openaiReadyPromise = new Promise((resolve) => {
      this.openaiReadyResolve = resolve;
    });

    const apiKey = this.tenant.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(`[${this.callId}] 🔴 Erro: Chave de API da OpenAI não configurada para o tenant ${this.tenant.id}`);
      this.terminateCall('missing_openai_key');
      return;
    }

    let model = (this.tenant.openaiModel || 'gpt-realtime-2.1-mini').trim();
    // Mapeamento de compatibilidade para modelos Live e variantes para a Realtime API
    if (model === 'gpt-live-1' || model === 'gpt-live-1-mini' || model.includes('live')) {
      console.log(`[${this.callId}] ℹ️ Modelo configurado "${model}" mapeado para "gpt-realtime-2.1" no gateway Realtime.`);
      model = 'gpt-realtime-2.1';
    }
    const openaiUrl = `wss://api.openai.com/v1/realtime?model=${model}`;

    console.log(`[${this.callId}] ⚡ Conectando à OpenAI Realtime (${model}) em paralelo...`);
    this.openaiSocket = new WebSocket(openaiUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    this.openaiSocket.on('open', () => {
      console.log(`[${this.callId}] 🟢 WebSocket OpenAI conectado com sucesso!`);
      this.openaiConnected = true;
      if (this.openaiReadyResolve) this.openaiReadyResolve();
    });

    this.openaiSocket.on('message', (data) => {
      this.handleOpenAiMessage(data);
    });

    this.openaiSocket.on('close', (code, reason) => {
      console.log(`[${this.callId}] 🔴 WebSocket OpenAI fechado. Código: ${code}, Razão: ${reason.toString()}`);
      this.openaiConnected = false;
      this.openaiReady = false;
      if (!this.isTerminated) {
        this.terminateCall('openai_disconnected');
      }
    });

    this.openaiSocket.on('error', (err) => {
      console.error(`[${this.callId}] 🔴 Erro no WebSocket OpenAI:`, err.message);
      if (!this.openaiConnected && this.openaiReadyResolve) {
        this.openaiReadyResolve();
      }
    });
  }

  handleOpenAiMessage(data) {
    try {
      const body = JSON.parse(data.toString());

      if (body.type !== 'response.output_audio.delta' && body.type !== 'input_audio_buffer.committed') {
        console.log(`[${this.callId}] 🔍 [OpenAI] Evento: ${body.type}`);
      }

      if (body.type === 'error') {
        if (body.error && body.error.code !== 'response_cancel_not_active') {
          console.error(`[${this.callId}] 🔴 Erro recebido da OpenAI Realtime:`, body.error);
        }
      }

      if (body.type === 'session.updated' && body.session) {
        const outFmt = body.session.audio?.output?.format?.type;
        const confirmedVoice = body.session.audio?.output?.voice;
        if (outFmt === 'audio/pcmu') {
          this.activeAudioFormat = 'g711_ulaw';
          console.log(`[${this.callId}] 🟢 Formato de áudio confirmado pela OpenAI: G.711 u-law | Voz: ${confirmedVoice || 'n/a'}`);
        } else {
          this.activeAudioFormat = 'pcm24k';
          console.log(`[${this.callId}] ℹ️ Formato de áudio da OpenAI: ${outFmt || 'pcm24k'} | Voz: ${confirmedVoice || 'n/a'}`);
        }
      }

      if (body.type === 'response.function_call_arguments.done') {
        console.log(`[${this.callId}] 🛠️ [Tool Call] Função invocada: ${body.name} com args:`, body.arguments);
        if (body.name === 'registrar_desfecho_chamada') {
          try {
            const parsed = JSON.parse(body.arguments || '{}');
            this.callOutcome = {
              tabulationCode: parsed.tabulationCode,
              scheduledAt: parsed.scheduledAt,
              summary: parsed.summary
            };
            console.log(`[${this.callId}] 🎯 [Desfecho Registrado pela IA]:`, this.callOutcome);
          } catch (e) {
            console.warn(`[${this.callId}] ⚠️ Erro ao fazer parse dos args de registrar_desfecho_chamada:`, e.message);
          }
        }
        if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN && body.call_id) {
          try {
            this.openaiSocket.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: body.call_id,
                output: JSON.stringify({ ok: true, status: 'registrado' })
              }
            }));
            this.openaiSocket.send(JSON.stringify({ type: 'response.create' }));
          } catch {}
        }
      }

      if (body.type === 'response.output_item.done' && body.item && body.item.type === 'function_call') {
        if (body.item.name === 'registrar_desfecho_chamada') {
          try {
            const parsed = JSON.parse(body.item.arguments || '{}');
            this.callOutcome = {
              tabulationCode: parsed.tabulationCode,
              scheduledAt: parsed.scheduledAt,
              summary: parsed.summary
            };
            console.log(`[${this.callId}] 🎯 [Desfecho Registrado via output_item.done]:`, this.callOutcome);
          } catch {}
        }
      }

      if (body.type === 'response.created' || body.type === 'response.output_item.added') {
        this.isResponseCancelled = false;
        if (this.greetingResponsePending && body.type === 'response.created') {
          this.greetingResponsePending = false;
          this.greetingResponseId = body.response?.id;
          console.log(
            `[${this.callId}] ⏳ [BARGE-IN DINÂMICO] IA gerando saudação inicial (Response ID: ${this.greetingResponseId || 'n/a'}). Canal do cliente permanece fechado.`
          );
        } else if (this.isBargeinGraceActive() && body.type === 'response.created') {
          console.log(
            `[${this.callId}] 🛡️ [BARGE-IN DINÂMICO] Resposta da IA cancelada: pedido do cliente ignorado durante a saudação do agente.`
          );
          if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
            try {
              this.openaiSocket.send(JSON.stringify({ type: 'response.cancel' }));
              this.openaiSocket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
            } catch {}
          }
          return;
        }
      } else if (body.type === 'response.cancelled') {
        this.isResponseCancelled = false;
        this.isAgentTalking = false;
        this.agentPlaybackStartTime = null;
        this.resampler24to8.reset();
        this.reconFilter8k.reset();
        this.mediaBridge.killAudio();
      }

      if (body.type === 'response.output_audio.delta' && body.delta) {
        if (this.isResponseCancelled) {
          return;
        }
        if (!this.isAgentTalking) {
          this.isAgentTalking = true;
          this.agentPlaybackStartTime = Date.now();
          this.mediaBridge.startPlaybackStream();
        }
        const rawDelta = Buffer.from(body.delta, 'base64');
        const pcm8k = this.activeAudioFormat === 'g711_ulaw'
          ? this.reconFilter8k.process(mulawToLinear16(rawDelta))
          : this.resampler24to8.process(rawDelta);
        this.mediaBridge.pushAudioChunk(pcm8k);

        if (this.isGreetingInProgress) {
          if (!this.greetingPlaybackStartTime) {
            this.greetingPlaybackStartTime = Date.now();
          }
          this.greetingAudioBytes += pcm8k.length;
        }
      }

      // 1. Transcrição do Atendente (IA) via eventos da OpenAI Realtime
      if (
        (body.type === 'response.output_audio_transcript.done' ||
         body.type === 'response.audio_transcript.done') &&
        body.transcript
      ) {
        this.recordTranscriptTurn('Atendente', body.transcript);
      } else if (body.type === 'response.done') {
        if (body.response?.usage) {
          aiCostTracker.recordUsage({
            callId: this.callId,
            tenantId: this.tenant?.id || 'default',
            provider: 'openai',
            model: this.tenant?.openaiModel || 'gpt-realtime-2.1-mini',
            usage: body.response.usage
          });
          try {
            if (callHistoryManager) {
              const aiUsage = aiCostTracker.getCostByCallId(this.callId);
              if (aiUsage) {
                callHistoryManager.recordCallUpdate(this.callId, {
                  costUsd: aiUsage.costUsd,
                  totalTokens: aiUsage.totalTokens
                });
              }
            }
          } catch {}
        }
        if (body.response?.output) {
          // Fallback para capturar transcript do response.done caso evento individual não tenha sido disparado
          for (const outItem of body.response.output) {
            if (outItem.content) {
              for (const c of outItem.content) {
                if (c.transcript) {
                  this.recordTranscriptTurn('Atendente', c.transcript);
                }
              }
            }
          }
        }
      }

      // 2. Transcrição da fala do Cliente recebida nativamente da OpenAI Realtime
      if (
        body.type === 'conversation.item.input_audio_transcription.completed' &&
        body.transcript
      ) {
        if (this.isBargeinGraceActive()) {
          console.log(
            `[${this.callId}] 🛡️ [BARGE-IN GRACE] Transcrição do cliente ignorada durante carência: "${body.transcript}"`
          );
          this.recordTranscriptTurn('Cliente', `[Ignorado na Saudação]: ${body.transcript}`);
        } else {
          this.recordTranscriptTurn('Cliente', body.transcript);
        }
      }

      if (['response.output_audio.done', 'response.done'].includes(body.type)) {
        if (this.isAgentTalking) {
          this.resampler24to8.reset();
          this.reconFilter8k.reset();
          console.log(`[${this.callId}] 🔊 Fim da transmissão de áudio da IA.`);
          this.mediaBridge.endPlaybackStream();
          if (!this.mediaBridge.isPlaying) {
            this.isAgentTalking = false;
          }
        }

        // Barge-in Dinâmico: Quando a IA termina de gerar a saudação de boas-vindas, aguarda a finalização
        // do playout do buffer de áudio no FreeSWITCH e então abre o canal do microfone do cliente.
        if (this.isGreetingInProgress && !this.greetingFinishTimer) {
          const audioDurationMs = Math.round(this.greetingAudioBytes / 16);
          const elapsedPlaybackMs = this.greetingPlaybackStartTime
            ? Date.now() - this.greetingPlaybackStartTime
            : 0;
          const remainingMs = Math.max(0, audioDurationMs - elapsedPlaybackMs) + 350;

          console.log(
            `[${this.callId}] ⏳ [BARGE-IN DINÂMICO] Saudação da IA transmitida (${(audioDurationMs / 1000).toFixed(1)}s de áudio). Aguardando término da reprodução (${remainingMs}ms) para abrir o canal.`
          );

          this.greetingFinishTimer = setTimeout(async () => {
            await this.openCustomerChannel('greeting_completed');
          }, remainingMs);
        }

        if (this.isSafetyExpiring && !this.safetyCloseTimer) {
          console.log(
            `[${this.callId}] ⏱️ Aviso de limite de segurança reproduzido pela IA. Encerrando chamada com tolerância de 1.5s.`
          );
          this.safetyCloseTimer = setTimeout(() => {
            this.terminateCall('safety_limit_3_minutes');
          }, 1500);
        }
      }

      if (body.type === 'input_audio_buffer.speech_started') {
        const isAgentReallyPlaying = Boolean(this.isAgentTalking || (this.mediaBridge && this.mediaBridge.isPlaying));
        const isLegitSpeaker = !this.isSecondaryVoiceBlocked &&
          (!this.crosstalkFilter || this.crosstalkFilter.isActivelySpeaking(isAgentReallyPlaying));
        if (isLegitSpeaker) {
          this.triggerBargeIn('speech_started');
        } else {
          console.log(`[${this.callId}] 🛡️ [BIOMETRIA] speech_started ignorado (voz secundária/fundo bloqueada ou energia insuficiente).`);
        }
      }
    } catch (err) {
      console.error(`[${this.callId}] Erro ao decodificar mensagem OpenAI:`, err.message);
    }
  }

  handleDtmf(evt) {
    if (this.isTerminated) return;
    const digit = evt?.dtmf || evt?.digit;
    if (!digit) return;

    if (this.isBargeinGraceActive()) {
      console.log(`[${this.callId}] 🛡️ [BARGE-IN GRACE] Dígito DTMF '${digit}' ignorado durante o período de carência (saudação inicial).`);
      return;
    }

    console.log(`[${this.callId}] 🔢 [DTMF] Dígito capturado: '${digit}'`);

    // Barge-in no primeiro dígito caso a IA esteja falando
    if (this.isAgentTalking) {
      if (typeof this.triggerBargeIn === 'function') {
        this.triggerBargeIn('dtmf_input');
      } else {
        this.isAgentTalking = false;
        if (this.mediaBridge) this.mediaBridge.killAudio();
        if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
          this.openaiSocket.send(JSON.stringify({ type: 'response.cancel' }));
        }
      }
    }

    if (this.dtmfTimer) {
      clearTimeout(this.dtmfTimer);
      this.dtmfTimer = null;
    }

    // Se o usuário pressionar '#', envia os dígitos acumulados imediatamente sem aguardar debounce
    if (digit === '#') {
      if (this.dtmfBuffer.length > 0) {
        this.flushDtmfBuffer();
      }
      return;
    }

    this.dtmfBuffer += String(digit);
    const debounceMs = this.tenant?.dtmf?.debounceMs || 1200;
    this.dtmfTimer = setTimeout(() => {
      this.flushDtmfBuffer();
    }, debounceMs);
  }

  flushDtmfBuffer() {
    if (this.dtmfTimer) {
      clearTimeout(this.dtmfTimer);
      this.dtmfTimer = null;
    }
    if (!this.dtmfBuffer || this.isTerminated) return;

    if (this.isBargeinGraceActive()) {
      console.log(`[${this.callId}] 🛡️ [BARGE-IN GRACE] Sequência DTMF "${this.dtmfBuffer}" ignorada durante o período de carência.`);
      this.dtmfBuffer = '';
      return;
    }

    const digits = this.dtmfBuffer;
    this.dtmfBuffer = '';

    console.log(`[${this.callId}] 🔢 [DTMF FLUSH] Sequência completa enviada à IA: "${digits}"`);

    this.recordTranscriptTurn('Cliente', `[DTMF: ${digits}]`);

    if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
      this.openaiSocket.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `[DTMF digitado pelo usuário no teclado: ${digits}]`
              }
            ]
          }
        })
      );
      this.openaiSocket.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  detectLineType() {
    const cleanTo = String(this.called || '').replace(/\D/g, '');
    const cleanFrom = String(this.caller || '').replace(/\D/g, '');

    const headerLineType = String(this.sipHeaders?.['x-line-type'] || '').toLowerCase();
    if (headerLineType === 'softphone' || headerLineType === 'trunk_sip') {
      return headerLineType;
    }

    // Se qualquer ponta for número de telefone público (>= 10 dígitos com DDD/DDI), é Tronco SIP
    if (cleanTo.length >= 10 || cleanFrom.length >= 10) {
      return 'trunk_sip';
    }

    // Se ambos forem ramais curtos (<= 5 dígitos, ex: 1000, 9000, *99, etc.), é Softphone interno de teste
    if ((cleanTo.length >= 2 && cleanTo.length <= 5) || (cleanFrom.length >= 2 && cleanFrom.length <= 5)) {
      return 'softphone';
    }

    return 'trunk_sip';
  }

  async start({ callId, endpoint, dialog, caller = null, called = null }) {
    this.callId = callId;
    this.endpoint = endpoint;
    this.dialog = dialog;
    this.caller = caller;
    this.called = called;
    this.startedAt = new Date();
    this.channelUuid = getChannelUuid(endpoint);

    if (!this.channelUuid) {
      throw new Error('Não consegui identificar o UUID do canal FreeSWITCH');
    }

    this.lineType = this.detectLineType();
    this.profiles = this.profilesByLine[this.lineType] || this.profilesByLine.trunk_sip;
    console.log(
      `[${this.callId}] 📞 Linha Detectada: [${this.lineType === 'trunk_sip' ? 'TRONCO SIP / TELEFONIA PÚBLICA' : 'SOFTPHONE INTERNO / TESTE'}] (De: ${this.caller || '--'} | Para: ${this.called || '--'})`
    );

    // Log explícito do Filtro de Voz ativo na chamada
    const filterLabels = {
      atual: 'DSP Acústico (YIN Pitch F0 + RMS Gate - 0.35ms)',
      dsp: 'DSP Acústico (YIN Pitch F0 + RMS Gate - 0.35ms)',
      wespeaker: 'CAM++ WeSpeaker (Biometria Neural 512-dim)',
      ecapa: 'ECAPA-TDNN (Biometria Neural 512-dim)',
      none: 'Sem Filtro (Bypass)'
    };
    const activeFilterLabel = filterLabels[this.crosstalkMode] || this.crosstalkMode;
    console.log(`[${this.callId}] 🛡️ [FILTRO DE VOZ ATIVO] Modo: [${this.crosstalkMode.toUpperCase()}] -> ${activeFilterLabel}`);

    // 0. Bloqueio Dinâmico de Barge-in: Corta o microfone do interlocutor no FreeSWITCH durante a frase inicial do agente
    if (this.bargeinGraceSec > 0) {
      this.isMicMutedByGrace = true;
      this.isGreetingInProgress = true;
      this.greetingAudioBytes = 0;
      this.greetingPlaybackStartTime = null;

      this.safeApi(`uuid_audio ${this.channelUuid} start read mute`);
      console.log(
        `[${this.callId}] 🔇 [BARGE-IN DINÂMICO] Canal do microfone do cliente CORTADO no FreeSWITCH durante a frase inicial do agente.`
      );

      // Timeout de segurança dinâmico para garantir abertura rápida do canal caso haja lentidão na IA
      const safetyGraceMs = Math.max(8000, (this.bargeinGraceSec || 8) * 1000);
      this.greetingSafetyTimer = setTimeout(() => {
        if (this.isGreetingInProgress && !this.isTerminated) {
          if (this.greetingAudioBytes > 0 && this.greetingFinishTimer) {
            return;
          }
          console.warn(`[${this.callId}] ⏱️ [BARGE-IN DINÂMICO] Timeout de segurança de saudação (${safetyGraceMs}ms). Liberando canal do cliente.`);
          this.openCustomerChannel('safety_timeout');
        }
      }, safetyGraceMs);
    }

    this.maxDurationSec = Number(
      this.tenant.maxDurationSec || process.env.MAX_CALL_DURATION_SEC || 180
    );
    const warningLeadSec = Math.min(10, Math.max(4, Math.floor(this.maxDurationSec / 10)));
    const warningTimeMs = Math.max(1000, (this.maxDurationSec - warningLeadSec) * 1000);

    // 1. Timer de Aviso Prévio com Fala Explícita de Interrupção aos ~170s
    this.warningDurationTimer = setTimeout(() => {
      if (this.isTerminated) return;
      this.isSafetyExpiring = true;
      const warningText =
        'Atenção: esta chamada atingiu o limite de segurança de três minutos e foi interrompida para sua proteção. Agradecemos pelo contato e até logo!';
      console.warn(
        `[${this.callId}] ⏱️ Limite de segurança de 3 minutos atingido (${this.maxDurationSec}s). Falando aviso de interrupção ao interlocutor.`
      );

      // Injeta instrução prioritária na OpenAI Realtime para falar imediatamente
      if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
        try {
          this.say(
            'AVISO DO SISTEMA: O limite máximo de segurança de 3 minutos foi atingido. Encerre imediatamente com o aviso regulamentar.',
            {
              role: 'system',
              interrupt: true,
              triggerResponse: true,
              instructions: `Fale IMEDIATAMENTE com voz clara, firme e educada: "${warningText}". Não responda nem diga mais nada.`
            }
          );
        } catch (e) {
          console.error(`[${this.callId}] Erro ao injetar fala de limite de segurança na OpenAI:`, e.message);
        }
      } else if (this.endpoint) {
        // Fallback acústico caso a OpenAI não esteja conectada
        try {
          this.endpoint.play('tone_stream://v=-10;%(400,200,425);%(400,200,425)').catch(() => {});
        } catch {}
      }
    }, warningTimeMs);

    // 2. Hard Cap Inegociável aos 180s (3 minutos): derruba a chamada incondicionalmente para proteção de custos
    this.maxDurationTimer = setTimeout(() => {
      console.warn(
        `[${this.callId}] 🛑 Limite rígido de segurança atingido (${this.maxDurationSec}s). Encerrando chamada para evitar cobrança indevida da OpenAI.`
      );
      this.terminateCall('safety_limit_3_minutes');
    }, this.maxDurationSec * 1000);

    const sipAmdHeader = this.sipHeaders['x-amd-enabled'] || this.sipHeaders['X-AMD-Enabled'];
    this.isAmdEnabled =
      sipAmdHeader !== undefined
        ? String(sipAmdHeader).toLowerCase() === 'true'
        : Boolean(this.tenant.amd?.enabled);

    const sipSttHeader = this.sipHeaders['x-stt-enabled'] || this.sipHeaders['X-STT-Enabled'];
    this.isSttEnabled =
      sipSttHeader !== undefined
        ? String(sipSttHeader).toLowerCase() === 'true'
        : this.tenant.stt?.enabled !== false;

    // 1. Inicia sessão Whisper (AMD Inteligente) se configurado
    this.whisperSession = new WhisperSession({
      callId: this.callId,
      channelUuid: this.channelUuid,
      tenant: this.tenant,
      sipHeaders: this.sipHeaders
    });

    const isActiveAmd =
      this.whisperSession.isAmdEnabled && this.whisperSession.amdMode === 'active';

    if (!isActiveAmd) {
      this.initOpenAiConnection();
    }

    if (this.whisperSession.isActive()) {
      this.whisperSession.on('decision', (decision) => {
        if (['caixa_postal', 'operadora', 'silencio'].includes(decision.label)) {
          if (this.whisperSession?.amdMode === 'active' || this.tenant.amd?.mode === 'active') {
            console.log(
              `[${this.callId}] 🤖 AMD [ACTIVE]: Detectada ${decision.label.toUpperCase()} (${decision.reason}). Encerrando chamada.`
            );
            this.terminateCall(`amd_${decision.label}`);
          } else {
            console.log(
              `[${this.callId}] 🔍 AMD [SHADOW]: Detectada ${decision.label.toUpperCase()} (${decision.reason}). Chamada mantida.`
            );
          }
        } else {
          console.log(`[${this.callId}] 👤 AMD: HUMANO confirmado (${decision.reason}).`);
        }
      });

      this.whisperSession.start();
    }

    // 2. Gravação Dual-Stream Stereo (.wav) + Transcrição (.txt) SOMENTE quando a transcrição (STT) estiver habilitada
    if (this.whisperSession && this.whisperSession.isSttEnabled) {
      this.recorder = new CallRecorder({
        callId: this.callId,
        tenantId: this.tenant.id,
        recordingDir: this.tenant.recordingDir
      });
      this.mediaBridge.setRecorder(this.recorder);
      await this.recorder.start();
    }

    // 2.1 Captura de DTMF In-Call via FreeSWITCH ESL / drachtio-fsmrf
    const dtmfHeader = this.sipHeaders['x-dtmf-enabled'];
    const isDtmfEnabled =
      dtmfHeader !== undefined
        ? String(dtmfHeader).toLowerCase() !== 'false'
        : this.tenant.dtmf?.enabled !== false;

    if (isDtmfEnabled && this.endpoint && typeof this.endpoint.on === 'function') {
      this.endpoint.on('dtmf', this.handleDtmf);
    }

    // 3. Limpeza de sessões residuais
    this.safeApi(`uuid_audio_fork ${this.channelUuid} stop`);
    await wait(100);
    if (this.isTerminated || !this.endpoint) return;

    if (this.endpoint.conn) {
      try {
        this.endpoint.conn.subscribe('CUSTOM mod_audio_fork::play_audio');
        this.endpoint.conn.on('esl::event::CUSTOM::*', this.handleEslEvent);
      } catch (err) {
        console.error(`[${this.callId}] Erro ao subscrever eventos ESL:`, err.message);
      }
    }

    this.safeApi(`uuid_setvar ${this.channelUuid} echo_cancellation false`);
    this.safeApi(`uuid_setvar ${this.channelUuid} noise_suppression true`);

    let vadThreshold = 0.45;
    let prefixPaddingMs = 160;
    let silenceDurationMs = 280;

    // 3. Inicia ponte de áudio recebendo Buffer binário direto (sem conversão Base64 intermediária)
    this.energyManager.reset();
    this.calibrationActive = true;

    this.mediaBridge.on('playback_ended', () => {
      this.isAgentTalking = false;
      this.agentPlaybackStartTime = null;
    });

    await this.mediaBridge.start({
      callId: this.callId,
      endpoint: this.endpoint,
      onAudio: (buffer) => {
        if (this.isTerminated) return;

        // Gravação Stereo (Left=Cliente, Right=Atendente) guiada pelo clock de 20ms do RTP (somente quando STT/Gravação ativa)
        if (this.recorder && !this.isToneProbe) {
          this.recorder.writeUserChunk(buffer);
        }

        // OTIMIZAÇÃO DE ESCALA: Só calcula RMS e Goertzel durante os 1.1s iniciais de calibração Sonar!
        if (this.calibrationActive) {
          let isEcoSample = false;
          if (this.isToneProbe || this.isAgentTalking) {
            isEcoSample = true;
            this.calibrationSamplesRecv++;
            if (this.calibrationSamplesRecv > 500) {
              this.calibrationActive = false;
            }
          }
          this.energyManager.calculateEnergy(buffer, isEcoSample);
        }

        // Se o AMD ativo ainda está decidindo, não envia áudio da operadora/caixa postal para a OpenAI
        const amdStillDeciding =
          this.whisperSession &&
          this.whisperSession.isAmdEnabled &&
          this.whisperSession.amdMode === 'active' &&
          !this.whisperSession.decisionReceived;

        // Período de Graça de Barge-in: Durante a saudação inicial do agente, qualquer fala do cliente é bloqueada
        const isGraceActive = this.isBargeinGraceActive();

        if (!isGraceActive && !this.graceEndLogged && this.bargeinGraceSec > 0 && this.startedAt) {
          this.graceEndLogged = true;
          console.log(
            `[${this.callId}] ⏳ [BARGE-IN GRACE] Período de carência finalizado (${this.bargeinGraceSec}s). Processamento de fala e pedidos do cliente liberados.`
          );
          if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
            try {
              this.openaiSocket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
            } catch {}
          }
        }

        // Filtros de Voz de Fundo Selecionáveis: 'atual' (DSP), 'wespeaker' (CAM++) ou 'ecapa' (ECAPA-TDNN)
        const isAgentReallyPlaying = Boolean(this.isAgentTalking || (this.mediaBridge && this.mediaBridge.isPlaying));

        // 1. Filtro DSP ('atual'):
        let isPrimaryVoiceDsp = true;
        if (this.isDspFilterActive && this.crosstalkFilter) {
          isPrimaryVoiceDsp = !this.isToneProbe && !amdStillDeciding && !isGraceActive
            ? this.crosstalkFilter.process(buffer, isAgentReallyPlaying)
            : false;

          // Monitoramento em tempo real do piso de ruído durante a chamada:
          // Se o ruído subir consistentemente (noiseFloor > 200, ex: rua, TV ou conversas paralelas),
          // chaveia automaticamente para o modelo neural ECAPA para máxima robustez acústica!
          if (!this.dynamicEcapaSwitched && this.crosstalkFilter.noiseFloor >= 200) {
            this.dynamicEcapaSwitched = true;
            this.switchCrosstalkFilter('ecapa', `Piso de ruído elevado em tempo real (${Math.round(this.crosstalkFilter.noiseFloor)} RMS)`);
          }
        } else if (isGraceActive || this.isToneProbe || amdStillDeciding) {
          isPrimaryVoiceDsp = false;
        }

        // 2. Filtro Neural ('wespeaker' / 'ecapa'):
        let isPrimaryVoiceNeural = true;
        if (this.isNeuralFilterActive && this.isSecondaryVoiceBlocked) {
          isPrimaryVoiceNeural = false;
        }

        const isPrimaryVoice = isPrimaryVoiceDsp && isPrimaryVoiceNeural;

        if (this.crosstalkFilter && this.crosstalkFilter.enrolled && !this.crosstalkEnrolledLogged) {
          this.crosstalkEnrolledLogged = true;
          console.log(
            `[${this.callId}] 👤 [BIOMETRIA VOCAL DSP] Assinatura do titular capturada: F0 = ${Math.round(this.crosstalkFilter.ownerPitchHz)}Hz | Graves = ${this.crosstalkFilter.ownerLowRatio.toFixed(2)} | RMS = ${Math.round(this.crosstalkFilter.userVoiceRms)}. Vozes divergentes serão bloqueadas.`
          );
        }

        // Proteção contra corte de canal: só substitui por silêncio em carência inicial, AMD,
        // tom probe, voz secundária neural confirmada ou ruído residual puro (<200 RMS).
        // Quando o agente está falando, ruídos ou voz não-titular são silenciados para evitar auto-barge-in e interrupção por TV.
        let effectiveBuffer = buffer;
        if (isGraceActive || this.isToneProbe || amdStillDeciding) {
          effectiveBuffer = Buffer.alloc(buffer.length);
        } else if (this.isNeuralFilterActive && this.isSecondaryVoiceBlocked) {
          effectiveBuffer = Buffer.alloc(buffer.length);
        } else if (this.isDspFilterActive && !isPrimaryVoiceDsp && (isAgentReallyPlaying || (this.crosstalkFilter?.lastRms || 0) < 400)) {
          effectiveBuffer = Buffer.alloc(buffer.length);
        }

        // Barge-in Instantâneo (<20ms): só interrompe se for fala ativa legítima (não cauda/hangover silencioso)
        const isActivelySpeaking = this.crosstalkFilter
          ? this.crosstalkFilter.isActivelySpeaking(isAgentReallyPlaying)
          : this.frameVad.process(buffer);
        if (isPrimaryVoice && isActivelySpeaking && isAgentReallyPlaying && this.canTriggerBargeIn()) {
          this.triggerBargeIn(this.isNeuralFilterActive ? `biometric_${this.crosstalkMode}` : 'local_biometric_vad');
        }

        // Whisper local é SOMENTE para AMD (antes da decisão de humano/secretária).
        // Após a decisão ou connect, ele é desligado e não consome áudio.
        if (this.whisperSession && this.isAmdEnabled && !this.whisperSession.decisionReceived && !this.isToneProbe) {
          this.whisperSession.pushAudio(buffer, 8000);
        }

        if (
          !this.isToneProbe &&
          !amdStillDeciding &&
          !isGraceActive &&
          this.openaiReady &&
          this.openaiSocket &&
          this.openaiSocket.readyState === WebSocket.OPEN
        ) {
          const outboundAudio = this.useG711 ? linear16ToMulaw(effectiveBuffer) : upsample8to24(effectiveBuffer);
          this.openaiSocket.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: outboundAudio.toString('base64')
            })
          );
        }
      }
    });
    if (this.isTerminated) return;

    // 4. Se o AMD estiver ligado na chamada, aguarda a classificação antes de liberar a conversação
    const amdWasExecuted = !!(this.isAmdEnabled && this.whisperSession);
    if (amdWasExecuted) {
      console.log(`[${this.callId}] 🕵️ Aguardando análise do Detector de Secretária (AMD)...`);
      await this.whisperSession.waitForDecision();
      if (this.isTerminated) {
        return; // Chamada encerrada pelo AMD (caixa_postal / operadora / silencio) sem abrir nem gastar sessão na OpenAI!
      }
      // Pós-decisão / connect: desliga o Whisper local imediatamente para zerar consumo de CPU/GPU
      if (this.whisperSession) {
        console.log(`[${this.callId}] 🔌 Connect confirmado / AMD concluído. Desligando Whisper local.`);
        this.whisperSession.stop();
        this.whisperSession = null;
      }
      if (!this.openaiSocket) {
        this.initOpenAiConnection();
      }
    }

    // Connect da chamada: garante que o Whisper local seja desligado para zerar consumo de CPU/GPU
    if (this.whisperSession) {
      console.log(`[${this.callId}] 🔌 Connect confirmado. Desligando Whisper local.`);
      this.whisperSession.stop();
      this.whisperSession = null;
    }

    const bargeinLevel = this.tenant.bargeinLevel ?? 3;

    // 4. Calibração acústica (Sonar Mode)
    // Se o AMD já executou, já coletamos amostras acústicas reais durante o "Alô?" (~1.5s),
    // então pulamos os 1.1s do bip Sonar para responder ao humano imediatamente sem silêncio duplo!
    if (amdWasExecuted) {
      this.calibrationActive = false;
      this.deviceMode = 'fone_ouvido';
      this.currentProfile = this.energyManager.getClassification();
      const lineProfiles = this.profilesByLine[this.lineType] || this.profilesByLine.trunk_sip;
      const config = lineProfiles[this.currentProfile].fone;
      vadThreshold = Number(this.tenant?.vadThreshold || config.base);
      prefixPaddingMs = Number(this.tenant?.prefixPaddingMs || config.prefix);
      silenceDurationMs = Number(this.tenant?.silenceDurationMs || config.silence);
      console.log(
        `[${this.callId}] ⚡ FAST-LOCK (Pós-AMD): Linha ${this.lineType.toUpperCase()} | Ambiente ${this.currentProfile} | VAD ${vadThreshold} | Silêncio ${silenceDurationMs}ms (Sonar pulado para 0ms de atraso)`
      );

      // Chaveamento Dinâmico para ECAPA em ambiente ruidoso
      if (['STREET', 'TV', 'OFFICE'].includes(this.currentProfile) && (this.crosstalkMode === 'atual' || this.crosstalkMode === 'dsp')) {
        this.switchCrosstalkFilter('ecapa', `Ambiente ruidoso detectado pós-AMD (${this.currentProfile})`);
      }
    } else if (bargeinLevel >= 3) {
      this.safeApi(`uuid_setvar ${this.channelUuid} echo_cancellation false`);
      await wait(150);
      if (this.isTerminated || !this.endpoint) return;

      this.isToneProbe = true;
      if (this.endpoint && typeof this.endpoint.play === 'function') {
        this.endpoint.play('tone_stream://v=0;%(700,0,425)').catch(() => {});
      }
      const startSamples = this.energyManager.echoSamplesCount;
      await wait(700);
      if (this.isTerminated || !this.endpoint) return;

      this.isToneProbe = false;
      const collected = this.energyManager.echoSamplesCount - startSamples;

      if (collected > 0) {
        console.log(`[${this.callId}] [SONAR] Capturadas ${collected} amostras acústicas.`);
      }

      this.deviceMode = this.energyManager.detectDeviceMode(this.callId);

      // Desliga o cálculo de energia após travar o perfil do Sonar (economia de ~30% de CPU por chamada)
      this.calibrationActive = false;

      if (this.deviceMode === 'viva_voz') {
        console.log(`[${this.callId}] 🛡️ Ativando AEC para proteção de Viva-voz.`);
        this.safeApi(`uuid_setvar ${this.channelUuid} echo_cancellation true`);
      } else {
        console.log(`[${this.callId}] 🎧 Mantendo AEC desligado para máxima fluidez no Fone.`);
        this.safeApi(`uuid_setvar ${this.channelUuid} echo_cancellation false`);
      }

      this.currentProfile = this.energyManager.getClassification();
      const lineProfiles = this.profilesByLine[this.lineType] || this.profilesByLine.trunk_sip;
      const config = lineProfiles[this.currentProfile][this.deviceMode === 'fone_ouvido' ? 'fone' : 'viva'];

      vadThreshold = Number(this.tenant?.vadThreshold || config.base);
      prefixPaddingMs = Number(this.tenant?.prefixPaddingMs || config.prefix);
      silenceDurationMs = Number(this.tenant?.silenceDurationMs || config.silence);

      console.log(
        `[${this.callId}] 🎯 SONAR LOCK: Linha ${this.lineType.toUpperCase()} | Dispositivo ${this.deviceMode.toUpperCase()} | Ambiente ${this.currentProfile} | VAD ${vadThreshold} | Silêncio ${silenceDurationMs}ms`
      );

      // Chaveamento Dinâmico para ECAPA em ambiente ruidoso
      if (['STREET', 'TV', 'OFFICE'].includes(this.currentProfile) && (this.crosstalkMode === 'atual' || this.crosstalkMode === 'dsp')) {
        this.switchCrosstalkFilter('ecapa', `Ambiente ruidoso detectado na calibração Sonar (${this.currentProfile})`);
      }
    } else {
      this.calibrationActive = false;
      this.endpoint.play('tone_stream://v=-13;%(500,0,425)').catch(() => {});
      await wait(500);
    }

    if (this.isTerminated) return;

    // 5. Aguarda confirmação do handshake OpenAI
    if (!this.openaiConnected && this.openaiReadyPromise) {
      await withTimeout(this.openaiReadyPromise, 4000).catch((e) => {
        console.warn(`[${this.callId}] Alerta no handshake OpenAI:`, e.message);
      });
    }

    if (this.isTerminated) return;

    if (!this.openaiSocket || this.openaiSocket.readyState !== WebSocket.OPEN) {
      console.error(`[${this.callId}] 🔴 Falha ao estabelecer conexão com a OpenAI Realtime.`);
      this.terminateCall('openai_connection_failed');
      return;
    }

    // 6. Envia configuração da sessão compatível com OpenAI Realtime GA (type: 'realtime')
    const sessionUpdate = {
      type: 'session.update',
      session: {
        type: 'realtime',
        audio: {
          input: {
            transcription: {
              model: 'whisper-1',
              language: 'pt',
              prompt: 'Voll, Voll Solutions, atendimento ao cliente, inteligência artificial, automações, planos, quanto custa, demonstração'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: vadThreshold,
              prefix_padding_ms: prefixPaddingMs,
              silence_duration_ms: silenceDurationMs
            }
          }
        }
      }
    };

    if (this.useG711) {
      sessionUpdate.session.audio.input.format = { type: 'audio/pcmu' };
      sessionUpdate.session.audio.output = {
        format: { type: 'audio/pcmu' }
      };
    }

    if (this.tenant.voice) {
      sessionUpdate.session.audio.output = {
        ...(sessionUpdate.session.audio.output || {}),
        voice: this.tenant.voice
      };
    }

    if (this.tenant.instructions) {
      sessionUpdate.session.instructions = this.tenant.instructions;
    } else if (this.tenant.openaiPromptId) {
      sessionUpdate.session.prompt = { id: this.tenant.openaiPromptId };
    }

    sessionUpdate.session.tools = [
      {
        type: 'function',
        name: 'registrar_desfecho_chamada',
        description:
          'Registra a tabulação e o desfecho final da ligação com o cliente, especialmente se houver acordo ou pedido de reagendamento para outro dia/horário.',
        parameters: {
          type: 'object',
          properties: {
            tabulationCode: {
              type: 'string',
              enum: ['CONVERSION', 'CPC_NO_DEAL', 'CALLBACK_SCHEDULED', 'WRONG_PERSON', 'OPT_OUT'],
              description: 'Código da tabulação: CONVERSION (acordo), CPC_NO_DEAL (sem acordo), CALLBACK_SCHEDULED (reagendamento), WRONG_PERSON (terceiro), OPT_OUT (remover contato)'
            },
            scheduledAt: {
              type: 'string',
              description: 'Data e hora combinada no formato ISO-8601 (ex: 2026-11-10T14:30:00-03:00) quando o cliente pedir reagendamento (CALLBACK_SCHEDULED)'
            },
            summary: {
              type: 'string',
              description: 'Resumo objetivo do que foi conversado ou combinado'
            }
          },
          required: ['tabulationCode']
        }
      }
    ];
    sessionUpdate.session.tool_choice = 'auto';

    this.openaiSocket.send(JSON.stringify(sessionUpdate));

    const responseCreate = {
      type: 'response.create',
      response: {
        instructions: this.tenant?.greetingInstructions || this.tenant?.greetingMessage || 'Dê as boas-vindas cordialmente de forma curta e amigável e pergunte em que pode ajudar hoje.'
      }
    };
    this.greetingResponsePending = true;
    this.openaiSocket.send(JSON.stringify(responseCreate));

    // Somente após session.update e response.create liberamos o envio de input_audio_buffer.append
    this.openaiReady = true;

    console.log(
      `[${this.callId}] 🟢 IA configurada (Codec: ${this.useG711 ? 'g711_ulaw' : 'pcm24k'}) e pronta para conversação.`
    );
  }

  recordTranscriptTurn(speaker, text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return null;

    // Deduplicação: se a mesma fala do mesmo interlocutor chegar em menos de 3.5 segundos, não duplica
    const now = Date.now();
    if (
      this.lastTurn &&
      this.lastTurn.speaker === speaker &&
      this.lastTurn.text.toLowerCase() === cleanText.toLowerCase() &&
      now - this.lastTurn.time < 3500
    ) {
      return this.lastTurn.entry;
    }

    const role = speaker === 'Atendente' ? 'Atendente' : 'Cliente';
    const timestamp = formatDateTime();
    const formatted = `[${timestamp}] ${role}: ${cleanText}`;

    let delayMs = null;
    let delayLabel = null;
    if (role === 'Cliente') {
      this.lastClientTurnTime = now;
    } else {
      if (this.lastClientTurnTime) {
        delayMs = Math.max(0, now - this.lastClientTurnTime);
        this.lastClientTurnTime = null;
        if (delayMs === 0) {
          delayLabel = 'Delay: < 1s';
        } else if (delayMs < 1000) {
          delayLabel = `Delay: ${delayMs}ms`;
        } else {
          const sec = delayMs / 1000;
          delayLabel = `Delay: ${sec >= 10 ? Math.round(sec) : sec.toFixed(1)}s`;
        }
      } else if (!this.hasHadClientTurn) {
        delayLabel = 'Saudação';
      }
      this.hasHadClientTurn = true;
    }

    let entry = { timestamp, speaker: role, text: cleanText, delayMs, delayLabel, formatted };

    if (this.recorder && !this.recorder.isStopped && !this.recorder.isPaused) {
      const recEntry = this.recorder.addTranscript(role, cleanText, new Date(), { delayMs, delayLabel });
      if (recEntry) {
        entry = recEntry;
      }
    } else {
      console.log(`[${this.callId}] 📝 ${formatted}${delayLabel ? ` [${delayLabel}]` : ''}`);
    }

    this.transcriptLog.push(entry);
    this.lastTurn = { speaker, text: cleanText, time: now, entry };
    try {
      if (callHistoryManager) {
        callHistoryManager.recordCallUpdate(this.callId, {
          transcriptTurnsCount: this.transcriptLog.length,
          lastTurn: entry
        });
      }
    } catch {}
    return entry;
  }

  getCallInfo(includeTranscript = false) {
    const durationSec = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0;
    const lastTurnEntry = this.transcriptLog.length > 0 ? this.transcriptLog[this.transcriptLog.length - 1] : null;
    const info = {
      callId: this.callId,
      channelUuid: this.channelUuid,
      tenantId: this.tenant?.id || 'default',
      caller: this.caller,
      called: this.called,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      durationSec,
      maxDurationSec: this.maxDurationSec || 180,
      isSafetyExpiring: this.isSafetyExpiring,
      bargeinGraceSec: this.bargeinGraceSec,
      isBargeinGraceActive: this.isBargeinGraceActive(),
      isMicMutedByGrace: this.isMicMutedByGrace,
      isGreetingInProgress: this.isGreetingInProgress,
      crosstalkFilter: {
        mode: this.crosstalkMode,
        isDspActive: this.isDspFilterActive,
        isNeuralActive: this.isNeuralFilterActive,
        lastSpeakerScore: this.lastSpeakerScore,
        isSecondaryVoiceBlocked: this.isSecondaryVoiceBlocked,
        dspMetrics: this.crosstalkFilter ? this.crosstalkFilter.getMetrics() : null
      },
      lineType: this.lineType || 'trunk_sip',
      codec: this.useG711 ? 'g711_ulaw' : 'pcm24k',
      deviceMode: this.deviceMode,
      noiseProfile: this.currentProfile,
      isAgentTalking: this.isAgentTalking,
      isMuted: this.isMuted,
      isOnHold: this.isOnHold,
      openaiConnected: this.openaiConnected,
      amdEnabled: Boolean(this.isAmdEnabled),
      sttEnabled: Boolean(this.isSttEnabled),
      recordingActive: !!(this.recorder && this.recorder.isStarted && !this.recorder.isStopped && !this.recorder.isPaused),
      recordingPaused: !!(this.recorder && this.recorder.isPaused),
      recordingFile: this.recorder ? this.recorder.fileName : null,
      transcriptFile: this.recorder ? this.recorder.transcriptFileName : null,
      transcriptTurnsCount: this.transcriptLog.length,
      lastTranscript: lastTurnEntry
    };

    if (includeTranscript) {
      info.transcript = this.transcriptLog;
    }
    return info;
  }

  switchCrosstalkFilter(newMode, reason = 'noise_detected') {
    const targetMode = String(newMode || '').toLowerCase();
    if (!['atual', 'dsp', 'wespeaker', 'ecapa', 'none'].includes(targetMode)) return;
    if (this.crosstalkMode === targetMode) return;

    const prevMode = this.crosstalkMode;
    this.crosstalkMode = targetMode;
    this.isDspFilterActive = this.crosstalkMode === 'atual' || this.crosstalkMode === 'dsp';
    this.isNeuralFilterActive = this.crosstalkMode === 'wespeaker' || this.crosstalkMode === 'ecapa';

    if (this.isDspFilterActive) {
      if (!this.crosstalkFilter) {
        this.crosstalkFilter = new CrosstalkFilter({ ratio: this.crosstalkRatio, hangoverMs: 400 });
      }
      this.frameVad = null;
    } else {
      const frameVadMinRms = Number(this.tenant?.bargeinMinRms || process.env.BARGEIN_MIN_RMS || 800);
      const frameVadAttack = Number(this.tenant?.bargeinAttackFrames || process.env.BARGEIN_ATTACK_FRAMES || 8);
      this.frameVad = new FrameVad({ minRms: frameVadMinRms, attackFrames: frameVadAttack, noiseRatio: 2.8 });
    }

    if (this.whisperSession) {
      if (this.isNeuralFilterActive) {
        this.whisperSession.setSpeakerFilter(this.crosstalkMode);
      } else {
        this.whisperSession.setSpeakerFilter('none');
      }
    }

    console.log(
      `[${this.callId}] 🔀 [DYNAMIC FILTER SWITCH] Filtro de voz alternado de [${prevMode.toUpperCase()}] para [${this.crosstalkMode.toUpperCase()}] | Motivo: ${reason}`
    );
  }

  interruptAgent() {
    this.isAgentTalking = false;
    this.agentPlaybackStartTime = null;
    this.resampler24to8.reset();
    this.reconFilter8k.reset();
    this.mediaBridge.killAudio();
    if (this.openaiSocket && this.openaiSocket.readyState === WebSocket.OPEN) {
      this.openaiSocket.send(JSON.stringify({ type: 'response.cancel' }));
    }
    if (this.channelUuid) {
      this.safeApi(`uuid_audio_fork ${this.channelUuid} stop_play`);
      this.safeApi(`uuid_break ${this.channelUuid} all`);
    }
  }

  say(text, { role = 'user', interrupt = true, triggerResponse = true, instructions = null } = {}) {
    if (interrupt && this.isAgentTalking) {
      this.interruptAgent();
    }
    if (!this.openaiSocket || this.openaiSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Sessão OpenAI Realtime não está conectada');
    }

    const validRole = ['user', 'system', 'assistant'].includes(role) ? role : 'user';
    this.openaiSocket.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: validRole,
          content: [
            {
              type: 'input_text',
              text: String(text)
            }
          ]
        }
      })
    );

    if (triggerResponse) {
      const respPayload = { type: 'response.create' };
      if (instructions) {
        respPayload.response = { instructions: String(instructions) };
      }
      this.openaiSocket.send(JSON.stringify(respPayload));
    }

    return { role: validRole, interrupt, triggerResponse };
  }

  async transfer(target, { mode = 'blind', dialplan = 'XML', context = 'default' } = {}) {
    if (mode === 'refer' && this.dialog && typeof this.dialog.request === 'function') {
      const referTo = target.startsWith('sip:') || target.startsWith('<sip:') ? target : `<sip:${target}>`;
      await this.dialog.request({
        method: 'REFER',
        headers: {
          'Refer-To': referTo
        }
      });
      return { mode: 'refer', target: referTo };
    }

    if (!this.endpoint || !this.channelUuid) {
      throw new Error('Canal FreeSWITCH indisponível para transferência');
    }
    const cleanTarget = String(target).replace(/[^a-zA-Z0-9_+*#@.-]/g, '');
    await this.endpoint.api(`uuid_transfer ${this.channelUuid} ${cleanTarget} ${dialplan} ${context}`);
    return { mode: 'blind', target: cleanTarget, dialplan, context };
  }

  async sendDtmf(digits, direction = 'outbound') {
    const cleanDigits = String(digits).replace(/[^0-9A-D*#wW]/g, '');
    if (!cleanDigits) {
      throw new Error('Nenhum dígito DTMF válido informado');
    }

    if (direction === 'inbound') {
      for (const ch of cleanDigits) {
        this.handleDtmf({ dtmf: ch });
      }
      this.flushDtmfBuffer();
      return { direction: 'inbound', digits: cleanDigits };
    }

    if (!this.endpoint || !this.channelUuid) {
      throw new Error('Canal FreeSWITCH indisponível para envio de DTMF');
    }
    await this.endpoint.api(`uuid_send_dtmf ${this.channelUuid} ${cleanDigits}`);
    return { direction: 'outbound', digits: cleanDigits };
  }

  async playAudioFile(file) {
    if (!this.endpoint) {
      throw new Error('Endpoint FreeSWITCH indisponível');
    }
    await this.endpoint.play(file);
    return { file };
  }

  async setMute(muted) {
    this.isMuted = Boolean(muted);
    if (this.endpoint && this.channelUuid) {
      if (this.isMuted) {
        await this.endpoint.api(`uuid_audio ${this.channelUuid} start read mute`).catch(() => {});
      } else {
        await this.endpoint.api(`uuid_audio ${this.channelUuid} stop read`).catch(() => {});
      }
    }
    return { isMuted: this.isMuted };
  }

  async setHold(held) {
    this.isOnHold = Boolean(held);
    if (this.endpoint && this.channelUuid) {
      const subCmd = this.isOnHold ? `${this.channelUuid}` : `off ${this.channelUuid}`;
      await this.endpoint.api(`uuid_hold ${subCmd}`).catch(() => {});
    }
    return { isOnHold: this.isOnHold };
  }

  async controlRecording(action = 'start') {
    if (action === 'start') {
      if (!this.recorder || this.recorder.isStopped) {
        this.recorder = new CallRecorder({
          callId: this.callId,
          tenantId: this.tenant.id,
          recordingDir: this.tenant.recordingDir
        });
        this.mediaBridge.setRecorder(this.recorder);
        await this.recorder.start();
      } else if (this.recorder.isPaused) {
        this.recorder.resume();
      }
      return {
        recordingActive: true,
        recordingPaused: false,
        fileName: this.recorder.fileName
      };
    }

    if (action === 'pause') {
      if (this.recorder && this.recorder.isStarted && !this.recorder.isStopped) {
        this.recorder.pause();
      }
      return {
        recordingActive: false,
        recordingPaused: !!(this.recorder && this.recorder.isPaused)
      };
    }

    if (action === 'resume') {
      if (this.recorder && this.recorder.isStarted && !this.recorder.isStopped) {
        this.recorder.resume();
      }
      return {
        recordingActive: !!(this.recorder && this.recorder.isStarted && !this.recorder.isPaused),
        recordingPaused: false
      };
    }

    if (action === 'stop') {
      if (this.recorder) {
        await this.recorder.stop();
      }
      return {
        recordingActive: false,
        recordingPaused: false
      };
    }

    throw new Error(`Ação de gravação inválida: ${action} (use start, pause, resume ou stop)`);
  }

  terminateCall(reason = 'normal_hangup') {
    if (this.graceUnmuteTimer) {
      clearTimeout(this.graceUnmuteTimer);
      this.graceUnmuteTimer = null;
    }
    if (this.greetingFinishTimer) {
      clearTimeout(this.greetingFinishTimer);
      this.greetingFinishTimer = null;
    }
    if (this.greetingSafetyTimer) {
      clearTimeout(this.greetingSafetyTimer);
      this.greetingSafetyTimer = null;
    }

    if (this.isTerminated) {
      if (this.cleanupHandler) {
        const cb = this.cleanupHandler;
        this.cleanupHandler = null;
        try { cb(reason); } catch {}
      }
      return;
    }
    this.isTerminated = true;

    console.log(`[${this.callId}] Encerrando chamada (Motivo: ${reason})...`);
    if (this.dialog) {
      try {
        this.dialog.destroy();
      } catch {}
      this.dialog = null;
    }
    if (this.endpoint) {
      try {
        this.endpoint.destroy();
      } catch {}
      this.endpoint = null;
    }
    this.stop().catch(() => {});
    if (this.cleanupHandler) {
      const cb = this.cleanupHandler;
      this.cleanupHandler = null;
      try { cb(reason); } catch {}
    }
  }

  async stop() {
    this.isTerminated = true;

    if (this.graceUnmuteTimer) {
      clearTimeout(this.graceUnmuteTimer);
      this.graceUnmuteTimer = null;
    }
    if (this.greetingFinishTimer) {
      clearTimeout(this.greetingFinishTimer);
      this.greetingFinishTimer = null;
    }
    if (this.greetingSafetyTimer) {
      clearTimeout(this.greetingSafetyTimer);
      this.greetingSafetyTimer = null;
    }

    if (this.warningDurationTimer) {
      clearTimeout(this.warningDurationTimer);
      this.warningDurationTimer = null;
    }

    if (this.safetyCloseTimer) {
      clearTimeout(this.safetyCloseTimer);
      this.safetyCloseTimer = null;
    }

    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    if (this.dtmfTimer) {
      clearTimeout(this.dtmfTimer);
      this.dtmfTimer = null;
    }

    if (this.endpoint && typeof this.endpoint.removeListener === 'function') {
      try {
        this.endpoint.removeListener('dtmf', this.handleDtmf);
      } catch {}
    }

    if (this.endpoint && this.endpoint.conn) {
      try {
        this.endpoint.conn.removeListener('esl::event::CUSTOM::*', this.handleEslEvent);
      } catch {}
    }

    if (this.endpoint) {
      try {
        this.endpoint.destroy();
      } catch {}
      this.endpoint = null;
    }

    if (this.mediaBridge) {
      await this.mediaBridge.stop();
    }

    if (this.recorder) {
      await this.recorder.stop();
      this.recorder = null;
    }

    if (this.whisperSession) {
      this.whisperSession.stop();
      this.whisperSession = null;
    }

    if (this.openaiSocket) {
      try {
        this.openaiSocket.close();
      } catch {}
      this.openaiSocket = null;
    }
    this.openaiReady = false;
  }
}

// Inicialização Drachtio SRF (Suporta Modo Inbound e Modo Outbound para Load Balancing)
if (DRACHTIO_MODE === 'outbound') {
  const listenPort = DRACHTIO_LISTEN_PORT + WORKER_ID;
  srf.listen({ port: listenPort, secret: DRACHTIO_SECRET });
  console.log(`✅ Drachtio SRF em modo OUTBOUND ouvindo na porta ${listenPort} (Worker #${WORKER_ID})`);
} else {
  srf.connect({
    host: DRACHTIO_HOST,
    port: DRACHTIO_PORT,
    secret: DRACHTIO_SECRET
  });

  srf.on('connect', (err, hp) => {
    if (err) {
      console.error('🔴 Erro conectando ao Drachtio:', err);
      return;
    }
    isDrachtioConnected = true;
    console.log(`✅ Conectado ao Drachtio SRF: ${hp} (Worker #${WORKER_ID})`);
  });
}

srf.on('disconnect', () => {
  isDrachtioConnected = false;
  console.error('🚨 Drachtio SRF desconectado!');
});

srf.on('error', (err) => {
  console.error('🚨 Erro no Drachtio SRF:', err.message || err);
});

// Inicializa Pool de Múltiplas Instâncias FreeSWITCH e o Servidor HTTP/WS
fsPool.start();

// Handler para Originação de Chamadas Ativas (POST /v1/calls)
async function originateOutboundCall(params) {
  if (isShuttingDown || !fsPool.hasHealthyNode()) {
    throw new Error('Serviço indisponível ou sem nós FreeSWITCH saudáveis');
  }

  const tenantId = params.tenantId || 'default';
  const baseTenant = tenantManager.tenants.get(tenantId) || tenantManager.getDefaultTenant();

  let extraInstructions = params.instructions || '';
  if (params.contact) {
    const contactName = params.contact.name || 'Cliente';
    const vars = params.contact.variables || {};
    const varLines = Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    const nowBrt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const contactPrompt = `
[DADOS DO CLIENTE E CONTEXTO OPERACIONAL]
- Nome do cliente: ${contactName}
- Data e hora atual (São Paulo): ${nowBrt}
${varLines ? `- Dados complementares:\n${varLines}` : ''}
[INSTRUÇÃO OBRIGATÓRIA DE DESFECHO]
Sempre utilize a ferramenta "registrar_desfecho_chamada" ao identificar o desfecho da conversa.
- Se o cliente concordar com o pagamento/acordo: tabulationCode="CONVERSION".
- Se o cliente disser que não pode falar agora e pedir para ligar em outro horário/dia: descubra a data/hora exata preferida, calcule o timestamp ISO com fuso -03:00 correspondente à data atual informada acima e registre tabulationCode="CALLBACK_SCHEDULED" e scheduledAt="<ISO>".
- Se disser que não tem interesse ou recusar: tabulationCode="CPC_NO_DEAL".
- Se não for o titular da conta / engano / terceiro: tabulationCode="WRONG_PERSON".
- Se solicitar expressamente para nunca mais ligar: tabulationCode="OPT_OUT".
`.trim();

    extraInstructions = extraInstructions
      ? `${contactPrompt}\n\n[INSTRUÇÕES ESPECÍFICAS DA CAMPANHA]\n${extraInstructions}`
      : contactPrompt;
  }

  const tenant = {
    ...baseTenant,
    instructions: extraInstructions
      ? `${baseTenant.instructions ? baseTenant.instructions + '\n\n' : ''}${extraInstructions}`
      : baseTenant.instructions,
    ...(params.voice ? { voice: params.voice } : {}),
    ...(params.openaiModel ? { openaiModel: params.openaiModel } : {})
  };

  const slotCheck = tenantManager.tryAcquireSlot(tenant);
  if (!slotCheck.allowed) {
    throw new Error(slotCheck.reason);
  }

  let releaseNodeSlot = null;
  let bridge = null;
  let dialog = null;
  let endpoint = null;
  let tenantSlotReleased = false;
  let cleanedUp = false;

  const releaseTenantSlotOnce = () => {
    if (tenantSlotReleased) return;
    tenantSlotReleased = true;
    tenantManager.releaseSlot(tenant);
  };

  try {
    let from = (params.from && params.from.trim()) ? params.from.trim() : (params.callerId || '5511989785888');
    let to = params.to ? String(params.to).trim() : '';
    if (to.startsWith('+')) {
      to = to.substring(1);
    }

    if (to === '9000' || to === '*1000' || to.toLowerCase() === 'ia') {
      throw new Error('O ramal 9000 é exclusivo para chamadas de entrada (quando você liga DE um softphone PARA a IA). Para efetuar uma chamada de teste de saída, informe seu número de celular com DDD (ex: 11999998888 ou 5511999998888) ou um ramal SIP registrado (ex: 1000).');
    }

    const cleanTo = to.replace(/\D/g, '');
    const cleanFrom = from.replace(/\D/g, '');

    // Normalização de BINA: se o destino for telefone público (>= 10 dígitos) e o From for ramal interno (< 10 dígitos),
    // usa a BINA homologada na operadora (5511989785888) para evitar rejeição "603 Decline"
    if (cleanTo.length >= 10 && cleanFrom.length < 10) {
      from = params.callerId || '5511989785888';
      console.log(`[Originate] 🛡️ BINA normalizada para operadora: From=${from} (era ${cleanFrom}) para destino público To=${to}`);
    }

    const detectedLine = cleanTo.length >= 10 ? 'trunk_sip' : 'softphone';
    const customHeaders = {
      'X-Line-Type': detectedLine,
      ...(params.headers || {})
    };

    const { endpoint: fsEndpoint, dialog: uacDialog, fsNode, releaseNodeSlot: rSlot } = await fsPool.originateCall(srf, {
      to,
      from,
      headers: customHeaders
    });

    endpoint = fsEndpoint;
    dialog = uacDialog;
    releaseNodeSlot = rSlot;
    const callId = dialog.sip?.callId || `out-${Date.now()}`;

    const sipHeaders = {
      'x-amd-enabled':
        params.amd !== undefined
          ? String(Boolean(params.amd))
          : customHeaders['X-AMD-Enabled'] || String(Boolean(tenant.amd?.enabled)),
      'x-stt-enabled':
        params.stt !== undefined ? String(Boolean(params.stt)) : customHeaders['X-STT-Enabled'],
      'x-dtmf-enabled':
        params.dtmf !== undefined ? String(Boolean(params.dtmf)) : customHeaders['X-DTMF-Enabled'],
      'x-bargein-grace-sec':
        params.bargeinGraceSec !== undefined ? String(params.bargeinGraceSec) : customHeaders['X-Bargein-Grace-Sec'],
      'x-crosstalk-mode':
        params.crosstalkMode !== undefined
          ? String(params.crosstalkMode)
          : customHeaders['X-Crosstalk-Mode'] || String(tenant.crosstalkFilter?.mode || 'atual'),
      'x-line-type': detectedLine,
      'x-tenant-id': tenant.id
    };

    const outFilterMode = (sipHeaders['x-crosstalk-mode'] || tenant.crosstalkFilter?.mode || 'atual').toLowerCase();
    console.log(
      `[${callId}] 📤 Chamada OUTBOUND conectada de ${from} para ${to} | Tenant: [${tenant.id}] | Filtro: [${outFilterMode.toUpperCase()}] | Nó Mídia: [${fsNode.id}]`
    );

    bridge = createAiBridge(tenant, sipHeaders);
    bridge.attemptId = params.attemptId || null;
    bridge.providerAttemptId = params.providerAttemptId || callId;
    activeBridges.set(callId, bridge);
    try {
      if (callHistoryManager) {
        const engine = tenant.stsEngine || 'openai';
        const initialLogs = [
          {
            timestamp: new Date().toISOString(),
            type: 'SIP_INVITE',
            message: `SIP INVITE outbound enviado de ${from} para ${to}`,
            details: `Tronco SIP / Gateway | AMD: ${params.amd ? 'Ativo' : 'Desativado'}`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'SIP_200_OK',
            message: `Chamada outbound atendida pelo destinatário (200 OK)`,
            details: `Canal FreeSWITCH: ${endpoint ? endpoint.uuid : '--'} | Nó: ${fsNode.id}`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'AUDIO_FORK',
            message: `Streaming de mídia bidirecional conectado (mod_audio_fork)`,
            details: `Codec: G.711 u-law / 8000Hz mono PCM L16`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'AI_STS',
            message: `Motor de IA conectado: [${engine.toUpperCase()}]`,
            details: engine === 'elevenlabs'
              ? `Agent ID: ${tenant.elevenlabsAgentId || '--'} | Voz: ${tenant.elevenlabsVoiceId || 'Rachel'}`
              : `Modelo: ${tenant.openaiModel || 'gpt-realtime-2.1-mini'} | Voz: ${tenant.voice || 'marin'}`
          }
        ];

        callHistoryManager.recordCallStart({
          callId,
          channelUuid: endpoint ? endpoint.uuid : null,
          direction: 'outbound',
          tenantId: tenant.id,
          caller: from,
          called: to,
          fsNodeId: fsNode.id,
          stsEngine: engine,
          startedAt: new Date().toISOString(),
          amdEnabled: Boolean(params.amd),
          telephonyLogs: initialLogs
        });
      }
    } catch {}

    const cleanupCall = async (reason = 'normal_hangup') => {
      if (cleanedUp) return;
      cleanedUp = true;
      console.log(`[${callId}] Limpando chamada outbound (Motivo: ${reason})...`);
      try {
        if (bridge && callHistoryManager) {
          callHistoryManager.addTelephonyLog(callId, {
            timestamp: new Date().toISOString(),
            type: 'SIP_BYE',
            message: `SIP BYE / Chamada outbound finalizada`,
            details: `Motivo: ${reason} | Encerrado por: ${reason.includes('destroy') ? 'remoto' : 'sistema'}`
          });
          const callInfo = bridge.getCallInfo(true);
          const aiUsage = (aiCostTracker && typeof aiCostTracker.getCostByCallId === 'function')
            ? aiCostTracker.getCostByCallId(callId)
            : null;
          callHistoryManager.recordCallEnd({
            ...callInfo,
            direction: 'outbound',
            hangupReason: reason,
            hangupBy: reason.includes('destroy') ? 'remote' : 'system',
            costUsd: aiUsage ? aiUsage.costUsd : undefined,
            totalTokens: aiUsage ? aiUsage.totalTokens : undefined
          });

          // Notifica o Voll Plan via Webhook autenticado por HMAC
          let tabulationCode = 'NO_ANSWER';
          let scheduledAt = undefined;
          let summary = undefined;

          if (bridge.callOutcome && bridge.callOutcome.tabulationCode) {
            tabulationCode = bridge.callOutcome.tabulationCode;
            scheduledAt = bridge.callOutcome.scheduledAt || undefined;
            summary = bridge.callOutcome.summary || undefined;
          } else if (reason.startsWith('amd_caixa_postal') || reason.startsWith('amd_operadora')) {
            tabulationCode = 'VOICEMAIL';
            summary = 'Caixa postal detectada pelo AMD Whisper';
          } else if (reason === 'amd_silencio') {
            tabulationCode = 'NO_ANSWER';
            summary = 'Silêncio na linha';
          } else if (callInfo && (callInfo.durationSec > 5 || callInfo.isCpc)) {
            tabulationCode = 'CPC_NO_DEAL';
            summary = 'Atendimento confirmado sem fechamento';
          } else {
            tabulationCode = 'NO_ANSWER';
            summary = `Chamada finalizada (${reason})`;
          }

          if (params.callback && params.callback.url) {
            sendVollPlanWebhook(params.callback, {
              eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              attemptId: params.attemptId,
              providerAttemptId: params.providerAttemptId || callId,
              type: 'RESULT',
              occurredAt: new Date().toISOString(),
              tabulationCode,
              scheduledAt,
              summary,
              durationSeconds: Math.round(callInfo ? callInfo.durationSec : 0),
              cost: aiUsage ? aiUsage.costUsd : undefined
            }).catch((whErr) => console.warn(`[${callId}] Falha ao despachar webhook para Voll Plan:`, whErr.message));
          }
        }
      } catch (logErr) {
        console.warn(`[${callId}] Falha ao arquivar log da chamada:`, logErr.message);
      }
      activeBridges.delete(callId);
      releaseTenantSlotOnce();
      if (releaseNodeSlot) releaseNodeSlot();
      if (endpoint) {
        try { endpoint.destroy(); } catch {}
      }
      if (dialog) {
        try { dialog.destroy(); } catch {}
      }
      try {
        if (bridge) await bridge.stop();
      } catch {}
    };

    bridge.setCleanupHandler(cleanupCall);

    dialog.on('destroy', async () => {
      console.log(`[${callId}] Chamada outbound encerrada.`);
      await cleanupCall('dialog_destroy');
    });

    bridge.start({ callId, endpoint, dialog, caller: from, called: to }).catch((err) => {
      console.error(`[${callId}] Erro em bridge.start (outbound):`, err.message);
    });

    return {
      ok: true,
      callId,
      channelUuid: getChannelUuid(endpoint),
      tenantId: tenant.id,
      from,
      to,
      mediaNode: fsNode.id,
      amdEnabled: sipHeaders['x-amd-enabled'] === 'true',
      sttEnabled: sipHeaders['x-stt-enabled'] === 'true' || Boolean(tenant.stt?.enabled)
    };
  } catch (err) {
    releaseTenantSlotOnce();
    if (releaseNodeSlot) releaseNodeSlot();
    if (endpoint) {
      try {
        endpoint.destroy();
      } catch {}
    }
    if (dialog) {
      try {
        dialog.destroy();
      } catch {}
    }
    if (bridge) {
      try {
        await bridge.stop();
      } catch {}
    }
    // Grava tentativa com falha no histórico para que os logs reflitam o disparo imediatamente
    try {
      if (callHistoryManager) {
        callHistoryManager.recordCallEnd({
          callId: (dialog && dialog.sip?.callId) || `fail-${Date.now()}`,
          direction: 'outbound',
          tenantId: tenant?.id || 'default',
          caller: params.from || '5511989785888',
          called: params.to || '1000',
          durationSec: 0,
          costUsd: 0,
          costBrl: 0,
          hangupReason: err.message || 'originate_failed',
          hangupBy: 'system',
          codec: 'g711_ulaw',
          deviceMode: 'outbound_attempt',
          noiseProfile: 'N/A',
          amdResult: 'FALHA_CONEXAO',
          sttEnabled: Boolean(params.stt)
        });
      }
    } catch (logErr) {
      console.warn('Falha ao registrar tentativa com erro no histórico:', logErr.message);
    }
    if (params.callback && params.callback.url) {
      let tabCode = 'NO_ANSWER';
      const msg = String(err.message || '').toLowerCase();
      if (msg.includes('486') || msg.includes('busy') || msg.includes('ocupado')) {
        tabCode = 'BUSY';
      } else if (msg.includes('404') || msg.includes('484') || msg.includes('invalid') || msg.includes('inválido')) {
        tabCode = 'INVALID_NUMBER';
      } else if (msg.includes('480') || msg.includes('timeout') || msg.includes('temporarily')) {
        tabCode = 'NO_ANSWER';
      }
      sendVollPlanWebhook(params.callback, {
        eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        attemptId: params.attemptId,
        providerAttemptId: params.providerAttemptId || (dialog && dialog.sip?.callId) || `fail-${Date.now()}`,
        type: 'RESULT',
        occurredAt: new Date().toISOString(),
        tabulationCode: tabCode,
        durationSeconds: 0,
        summary: `Falha na originação SIP: ${err.message || 'originate_failed'}`
      }).catch((whErr) => console.warn('Falha ao despachar webhook de erro para Voll Plan:', whErr.message));
    }
    throw err;
  }
}

// Troncos SIP: aplica no FreeSWITCH assim que um nó ESL estiver pronto
trunkManager.attach(fsPool);
(function syncTrunksWhenReady(attempt = 0) {
  if (isShuttingDown) return;
  if (!fsPool.hasHealthyNode()) {
    if (attempt < 60) setTimeout(() => syncTrunksWhenReady(attempt + 1), 2000);
    return;
  }
  trunkManager
    .syncAll()
    .then((r) => console.log('[TrunkManager] Sincronização de troncos com FreeSWITCH:', JSON.stringify(r)))
    .catch((e) => console.error('[TrunkManager] Falha ao sincronizar troncos:', e.message));

  extensionManager
    .syncAllToFreeSwitch()
    .then((r) => console.log('[ExtensionManager] Sincronização de ramais com FreeSWITCH:', JSON.stringify(r)))
    .catch((e) => console.error('[ExtensionManager] Falha ao sincronizar ramais:', e.message));

  outboundRouteManager
    .syncAllToFreeSwitch()
    .then((r) => console.log('[OutboundRouteManager] Sincronização de rotas de saída com FreeSWITCH:', JSON.stringify(r)))
    .catch((e) => console.error('[OutboundRouteManager] Falha ao sincronizar rotas de saída:', e.message));
})();

const outreachManager = new OutreachManager({ providerManager, originateCallHandler: originateOutboundCall });

mediaServer.setApiHandler(
  createApiRouter({
    activeBridges,
    tenantManager,
    fsPool,
    whisperPool,
    mediaServer,
    originateCallHandler: originateOutboundCall,
    trunkManager,
    routeManager,
    providerManager,
    outreachManager,
    callHistoryManager,
    aiCostTracker,
    extensionManager,
    outboundRouteManager,
    aiProviderManager
  })
);

mediaServer.listen().catch(() => {});

// Keep-alive SIP OPTIONS (Softphones como Telephone, Zoiper, MicroSIP enviam ping OPTIONS)
srf.options((req, res) => {
  res.send(200);
});

// Proxy transparente de Registro SIP (REGISTER) para o FreeSWITCH (porta 5080)
// Permite que softphones se registrem tanto pela porta padrão 5060 quanto pela 5080
srf.register(async (req, res) => {
  const user = req.get('From') || req.uri;
  console.log(`[SIP Register] Recebido REGISTER na porta 5060 para ${user}, repassando para FreeSWITCH 5080...`);
  try {
    const fsTarget = 'sip:192.168.15.36:5080';
    await srf.proxyRequest(req, fsTarget);
  } catch (err) {
    console.error('[SIP Register Proxy] Erro ao repassar registro:', err.message);
    if (!res.finalResponseSent) {
      try { res.send(503); } catch (_) {}
    }
  }
});

// Atendimento de Chamadas SIP (INVITE) com Balanceamento entre Instâncias FreeSWITCH
srf.invite(async (req, res) => {
  if (isShuttingDown || !fsPool.hasHealthyNode()) {
    return res.send(503);
  }

  const callId = getCallId(req);
  const inboundTrunkId = trunkManager.identifyTrunk(req);
  const routed = routeManager.resolveRoute(req, tenantManager, inboundTrunkId);
  const tenant = routed.tenant;
  const routeRule = routed.rule;

  if (!tenant || !tenant.active) {
    console.warn(`[${callId}] Chamada rejeitada: Tenant inativo ou não cadastrado.`);
    return res.send(404);
  }

  // Verifica limite de canais simultâneos e CPS do Tenant
  const slotCheck = tenantManager.tryAcquireSlot(tenant);
  if (!slotCheck.allowed) {
    console.warn(`[${callId}] Chamada recusada para Tenant [${tenant.id}]: ${slotCheck.reason}`);
    return res.send(slotCheck.sipStatus || 486);
  }

  // Limites de canais da regra de roteamento e do tronco de origem
  if (!routeManager.tryAcquire(routeRule)) {
    tenantManager.releaseSlot(tenant);
    console.warn(`[${callId}] Chamada recusada: limite de canais da regra [${routeRule.id}] atingido.`);
    return res.send(486);
  }
  if (!trunkManager.tryAcquire(inboundTrunkId)) {
    routeManager.release(routeRule);
    tenantManager.releaseSlot(tenant);
    console.warn(`[${callId}] Chamada recusada: limite de canais do tronco [${inboundTrunkId}] atingido.`);
    return res.send(486);
  }
  if (routeRule) {
    console.log(`[${callId}] 🔀 Rota [${routeRule.name}] -> Agente [${tenant.id}]${inboundTrunkId ? ` | Tronco [${inboundTrunkId}]` : ''}`);
  }

  let endpoint;
  let dialog;
  let fsNode;
  let releaseNodeSlot;
  let bridge;
  let tenantSlotReleased = false;
  let cleanedUp = false;

  const releaseTenantSlotOnce = () => {
    if (tenantSlotReleased) return;
    tenantSlotReleased = true;
    tenantManager.releaseSlot(tenant);
    routeManager.release(routeRule);
    trunkManager.release(inboundTrunkId);
  };

  try {
    const caller = req.callingNumber || req.get('From');
    const called = req.calledNumber || req.get('To');

    const sipHeaders = {
      'x-amd-enabled': req.get('x-amd-enabled') || req.get('X-AMD-Enabled'),
      'x-stt-enabled': req.get('x-stt-enabled') || req.get('X-STT-Enabled'),
      'x-dtmf-enabled': req.get('x-dtmf-enabled') || req.get('X-DTMF-Enabled'),
      'x-bargein-grace-sec': req.get('x-bargein-grace-sec') || req.get('X-Bargein-Grace-Sec'),
      'x-tenant-id': req.get('x-tenant-id') || req.get('X-Tenant-ID')
    };
    if (routeRule) {
      // Regra de roteamento fornece defaults (headers SIP explícitos continuam com prioridade)
      if (!sipHeaders['x-amd-enabled'] && routeRule.amdMode && routeRule.amdMode !== 'tenant_default') {
        sipHeaders['x-amd-enabled'] = String(routeRule.amdMode === 'active');
      }
      if (!sipHeaders['x-bargein-grace-sec'] && routeRule.bargeinGraceSec !== null && routeRule.bargeinGraceSec !== undefined && routeRule.bargeinGraceSec !== '') {
        sipHeaders['x-bargein-grace-sec'] = String(routeRule.bargeinGraceSec);
      }
      if (!sipHeaders['x-crosstalk-mode'] && routeRule.crosstalkFilterMode && routeRule.crosstalkFilterMode !== 'tenant_default') {
        sipHeaders['x-crosstalk-mode'] = String(routeRule.crosstalkFilterMode);
      }
    }

    // Aloca a chamada na instância de FreeSWITCH com menor carga do Pool
    ({ endpoint, dialog, fsNode, releaseNodeSlot } = await fsPool.connectCaller(req, res));
    const resolvedFilterMode = (sipHeaders['x-crosstalk-mode'] || tenant.crosstalkFilter?.mode || 'atual').toLowerCase();
    console.log(
      `[${callId}] 📞 Chamada atendida de ${caller} para ${called} | Tenant: [${tenant.id}] | Filtro: [${resolvedFilterMode.toUpperCase()}] | Nó Mídia: [${fsNode.id}] (Ativas no nó: ${fsNode.activeCalls})`
    );

    bridge = createAiBridge(tenant, sipHeaders);
    bridge.attemptId = (req.get && (req.get('X-Attempt-ID') || req.get('x-attempt-id'))) || null;
    bridge.providerAttemptId = callId;
    activeBridges.set(callId, bridge);
    try {
      if (callHistoryManager) {
        const sipCallId = (req.get && req.get('Call-ID')) || callId;
        const userAgent = (req.get && req.get('User-Agent')) || 'SIP Phone';
        const remoteIp = req.source_address ? `${req.source_address}:${req.source_port || 5060}` : null;
        const engine = tenant.stsEngine || 'openai';

        const initialLogs = [
          {
            timestamp: new Date().toISOString(),
            type: 'SIP_INVITE',
            message: `SIP INVITE recebido de ${caller} para ${called}`,
            details: `Via ${req.protocol || 'UDP'} ${remoteIp || 'N/A'} | User-Agent: ${userAgent}`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'SIP_200_OK',
            message: `Chamada atendida (200 OK) pelo Gateway SIP`,
            details: `SIP Call-ID: ${sipCallId}`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'FS_MEDIA',
            message: `Canal FreeSWITCH alocado no nó [${fsNode.id}]`,
            details: `UUID: ${endpoint ? endpoint.uuid : '--'} | ESL: ${fsNode.host || '127.0.0.1'}`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'AUDIO_FORK',
            message: `Streaming de mídia bidirecional conectado (mod_audio_fork)`,
            details: `Codec: 8000Hz mono PCM L16 (FIR Blackman 31-tap)`
          },
          {
            timestamp: new Date().toISOString(),
            type: 'AI_STS',
            message: `Motor de IA conectado: [${engine.toUpperCase()}]`,
            details: engine === 'elevenlabs'
              ? `Agent ID: ${tenant.elevenlabsAgentId || '--'} | Voz: ${tenant.elevenlabsVoiceId || 'Rachel'}`
              : `Modelo: ${tenant.openaiModel || 'gpt-realtime-2.1-mini'} | Voz: ${tenant.voice || 'marin'}`
          }
        ];

        callHistoryManager.recordCallStart({
          callId,
          sipCallId,
          userAgent,
          remoteAddress: remoteIp,
          fsNodeId: fsNode.id,
          stsEngine: engine,
          channelUuid: endpoint ? endpoint.uuid : null,
          direction: 'inbound',
          tenantId: tenant.id,
          caller,
          called,
          startedAt: new Date().toISOString(),
          amdEnabled: Boolean(tenant.amd?.enabled),
          telephonyLogs: initialLogs
        });
      }
    } catch {}

    const cleanupCall = async (reason = 'normal_hangup') => {
      if (cleanedUp) return;
      cleanedUp = true;
      console.log(`[${callId}] Limpando recursos da chamada (Motivo: ${reason})...`);
      try {
        if (bridge && callHistoryManager) {
          callHistoryManager.addTelephonyLog(callId, {
            timestamp: new Date().toISOString(),
            type: 'SIP_BYE',
            message: `SIP BYE / Chamada outbound finalizada`,
            details: `Motivo: ${reason} | Encerrado por: ${reason.includes('destroy') ? 'remoto' : 'sistema'}`
          });
          const callInfo = bridge.getCallInfo(true);
          const aiUsage = (aiCostTracker && typeof aiCostTracker.getCostByCallId === 'function')
            ? aiCostTracker.getCostByCallId(callId)
            : null;
          callHistoryManager.recordCallEnd({
            ...callInfo,
            direction: 'inbound',
            hangupReason: reason,
            hangupBy: reason.includes('destroy') ? 'remote' : 'system',
            costUsd: aiUsage ? aiUsage.costUsd : undefined,
            totalTokens: aiUsage ? aiUsage.totalTokens : undefined
          });
        }
      } catch (logErr) {
        console.warn(`[${callId}] Falha ao arquivar log da chamada:`, logErr.message);
      }
      activeBridges.delete(callId);
      releaseTenantSlotOnce();
      if (releaseNodeSlot) releaseNodeSlot();
      if (endpoint) {
        try { endpoint.destroy(); } catch {}
      }
      if (dialog) {
        try { dialog.destroy(); } catch {}
      }
      try {
        if (bridge) await bridge.stop();
      } catch {}
    };

    bridge.setCleanupHandler(cleanupCall);

    dialog.on('destroy', async () => {
      console.log(`[${callId}] Chamada encerrada pelo assinante/rede.`);
      await cleanupCall('dialog_destroy');
    });

    await bridge.start({ callId, endpoint, dialog, caller, called });
  } catch (err) {
    if (!cleanedUp) {
      cleanedUp = true;
      console.error(`[${callId}] Erro durante atendimento da chamada:`, err);
      activeBridges.delete(callId);
      releaseTenantSlotOnce();
      if (releaseNodeSlot) releaseNodeSlot();
      try {
        if (callHistoryManager) {
        callHistoryManager.recordCallEnd({
          callId,
          direction: 'inbound',
          tenantId: tenant ? tenant.id : 'default',
          caller: req.callingNumber || req.get('From') || 'Desc',
          called: req.calledNumber || req.get('To') || '1000',
          durationSec: 0,
          costUsd: 0,
          costBrl: 0,
          hangupReason: `fail_setup: ${err.message}`,
          hangupBy: 'system',
          codec: 'g711_ulaw',
          deviceMode: 'inbound_attempt',
          noiseProfile: 'N/A',
          amdResult: 'FALHA_CONEXAO',
          sttEnabled: false
        });
      }
    } catch (logErr) {
      console.warn(`[${callId}] Falha ao registrar log de erro inbound:`, logErr.message);
    }
    if (endpoint) {
      try { endpoint.destroy(); } catch {}
    }
    if (dialog) {
      try { dialog.destroy(); } catch {}
    }
    if (bridge) {
      try { await bridge.stop(); } catch {}
    }
  }
  try {
    res.send(500);
  } catch {}
}
});

// Encerramento Gracioso (Graceful Shutdown)
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[SHUTDOWN] Recebido sinal ${signal}. Encerrando graciosamente...`);

  const activeList = Array.from(activeBridges.values());
  console.log(`[SHUTDOWN] Finalizando ${activeList.length} chamada(s) ativa(s)...`);
  for (const bridge of activeList) {
    try {
      bridge.terminateCall('server_shutdown');
    } catch {}
  }
  activeBridges.clear();

  try {
    await mediaServer.close();
  } catch {}

  try {
    await fsPool.stop();
  } catch {}

  try {
    srf.disconnect();
  } catch {}

  console.log('[SHUTDOWN] voice-app finalizado com sucesso.');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('🚨 [FATAL] uncaughtException interceptada:', err.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🚨 [WARN] unhandledRejection interceptada:', reason?.stack || reason);
});
