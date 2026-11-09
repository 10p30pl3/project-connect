const WebSocket = require('ws');
const { EventEmitter } = require('events');
const WsMediaBridge = require('./ws-media-bridge');
const { WhisperSession } = require('./whisper-client');
const { CallRecorder, formatDateTime } = require('../utils/call-recorder');
const EnergyManager = require('../utils/energy-manager');
const CrosstalkFilter = require('../utils/crosstalk-filter');
const FrameVad = require('../utils/frame-vad');
const aiProviderManager = require('../utils/ai-provider-manager');
const aiCostTracker = require('../utils/ai-cost-tracker');
const {
  StatefulResampler24to8,
  StatefulResampler16to8,
  StatefulReconstructionFilter8k,
  upsample8to16,
  linear16ToMulaw,
  mulawToLinear16
} = require('../utils/audio-resampler');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, errorMsg = 'Timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
}

function getChannelUuid(endpoint) {
  if (!endpoint) return null;
  if (endpoint.uuid) return endpoint.uuid;
  if (endpoint.id) return endpoint.id;
  if (endpoint.sessionId) return endpoint.sessionId;
  if (endpoint.channelId) return endpoint.channelId;
  if (endpoint.conn?.uuid) return endpoint.conn.uuid;
  if (endpoint.channelUuid) return endpoint.channelUuid;
  if (endpoint.dialog?.sip?.callId) return endpoint.dialog.sip.callId;
  return null;
}

class ElevenLabsS2SBridge extends EventEmitter {
  constructor(tenant, sipHeaders = {}, options = {}) {
    super();
    this.tenant = tenant;
    this.sipHeaders = sipHeaders;
    this.callHistoryManager = options.callHistoryManager || null;
    this.whisperSession = null;

    const provider = aiProviderManager.get('elevenlabs');
    const codec = provider?.audioCodec || tenant.audioCodec || process.env.AUDIO_CODEC_MODE || 'g711_ulaw';
    this.useG711 = codec === 'g711_ulaw';

    this.endpoint = null;
    this.dialog = null;
    this.channelUuid = null;
    this.callId = null;
    this.energyManager = new EnergyManager();
    this.mediaBridge = new WsMediaBridge();

    this.baseThreshold = 0.45;
    this.isAgentTalking = false;
    this.deviceMode = 'viva_voz';
    this.isToneProbe = false;

    this.calibrationActive = true;
    this.calibrationSamplesRecv = 0;

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

    this.elevenSocket = null;
    this.elevenConnected = false;
    this.elevenReady = false;
    this.elevenReadyPromise = null;
    this.elevenReadyResolve = null;

    this.maxDurationTimer = null;
    this.warningDurationTimer = null;
    this.safetyCloseTimer = null;
    this.isSafetyExpiring = false;
    this.maxDurationSec = 180;
    this.isTerminated = false;

    // Barge-In Dinâmico & Carência da Saudação Inicial (idêntico à OpenAI)
    const sipBargeinGrace = this.sipHeaders['x-bargein-grace-sec'] || this.sipHeaders['X-Bargein-Grace-Sec'];
    this.bargeinGraceSec = Number(
      sipBargeinGrace !== undefined
        ? sipBargeinGrace
        : this.tenant.bargeinGraceSec ?? process.env.BARGEIN_GRACE_SEC ?? 8
    );
    this.isMicMutedByGrace = false;
    this.graceUnmuteTimer = null;
    this.isGreetingInProgress = false;
    this.greetingAudioBytes = 0;
    this.greetingPlaybackStartTime = null;
    this.greetingFinishTimer = null;
    this.greetingSafetyTimer = null;
    this.graceCompleted = false;
    this.graceEndLogged = false;

    // Configuração dos 3 Modos de Filtro de Voz de Fundo ('atual'/'dsp', 'wespeaker', 'ecapa', 'none')
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
    this.cleanupHandler = null;

    this.agentAudioFormat = 'pcm_8000';
    this.userInputAudioFormat = 'pcm_8000';
    this.conversationId = null;
    this.agentSilenceTimer = null;
    this.turnAudioBytes = 0;
    this.turnPlaybackStartTime = null;

    // Filtros FIR Sinc Stateful (31-tap Blackman) e Suavizador Pós-Reconstrução 8kHz
    this.resampler24to8 = new StatefulResampler24to8();
    this.resampler16to8 = new StatefulResampler16to8();
    this.reconFilter8k = new StatefulReconstructionFilter8k();

    this.handleEslEvent = this.handleEslEvent.bind(this);
    this.handleDtmf = this.handleDtmf.bind(this);
  }

  setCleanupHandler(fn) {
    this.cleanupHandler = fn;
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
      `[${this.callId}] 🎙️ [BARGE-IN DINÂMICO] Saudação inicial da ElevenLabs concluída (${reason}). Canal do cliente ABERTO no FreeSWITCH. Pedidos e barge-in liberados!`
    );
  }

  getCredentials() {
    const rawProv = aiProviderManager.getRaw('elevenlabs') || {};
    const apiKey = (this.tenant.elevenlabsApiKey || rawProv.apiKey || process.env.ELEVENLABS_API_KEY || '').trim();
    const DEFAULT_AGENT_ID = 'agent_01jvsk3cr8ep3an7shbcnfvt8d';
    const agentId = (this.tenant.elevenlabsAgentId || rawProv.agentId || process.env.ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID).trim();
    const voiceId = (this.tenant.elevenlabsVoiceId || rawProv.defaultVoice || 'Rachel').trim();
    const model = (this.tenant.elevenlabsModel || rawProv.defaultModel || 'eleven_turbo_v2_5').trim();

    return { apiKey, agentId, voiceId, model };
  }

  initElevenLabsConnection() {
    if (this.elevenSocket || this.isTerminated) return;

    this.elevenReadyPromise = new Promise((resolve) => {
      this.elevenReadyResolve = resolve;
    });

    const { apiKey, agentId } = this.getCredentials();

    if (!apiKey) {
      console.error(`[${this.callId}] 🔴 Erro: Chave API da ElevenLabs não configurada.`);
      this.terminateCall('missing_elevenlabs_key');
      return;
    }

    if (!agentId) {
      console.error(`[${this.callId}] 🔴 Erro: ElevenLabs Agent ID não configurado para o tenant "${this.tenant.id}".`);
      this.terminateCall('missing_elevenlabs_agent');
      return;
    }

    const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
    console.log(`[${this.callId}] ⚡ Conectando ao ElevenLabs Conversational AI (Agent: ${agentId})...`);

    try {
      this.elevenSocket = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': apiKey
        }
      });

      this.elevenSocket.on('open', () => {
        console.log(`[${this.callId}] 🟢 WebSocket ElevenLabs conectado com sucesso!`);
        this.elevenConnected = true;
        this.elevenReady = true;

        try {
          const initPayload = {
            type: 'conversation_initiation_client_data'
          };

          // conversation_config_override só é enviado se o usuário habilitar explicitamente
          // no tenant (allowElevenOverrides), pois a ElevenLabs derruba a chamada (Code 1008)
          // se o agente publicado não tiver os toggles de segurança habilitados no painel.
          if (this.tenant.allowElevenOverrides) {
            const agentOverride = {};
            if (this.tenant.instructions) {
              agentOverride.prompt = { prompt: String(this.tenant.instructions) };
            }
            const greetingText = this.tenant.greetingInstructions || this.tenant.greetingMessage;
            if (greetingText) {
              agentOverride.first_message = String(greetingText);
            }
            if (Object.keys(agentOverride).length > 0) {
              initPayload.conversation_config_override = { agent: agentOverride };
            }
          }

          this.elevenSocket.send(JSON.stringify(initPayload));
          console.log(`[${this.callId}] 📤 Enviado conversation_initiation_client_data para acionar saudação inicial.`);

          if (this.tenant.instructions) {
            this.elevenSocket.send(
              JSON.stringify({
                type: 'contextual_update',
                text: String(this.tenant.instructions)
              })
            );
            console.log(`[${this.callId}] 📤 Enviado contextual_update com as instruções do Agente para a ElevenLabs.`);
          }

          // Se o agente na ElevenLabs não tiver saudação inicial configurada (nenhum byte de áudio em 3.5s), abre o canal do cliente automaticamente
          setTimeout(() => {
            if (this.isGreetingInProgress && this.greetingAudioBytes === 0 && !this.isTerminated) {
              this.openCustomerChannel('no_greeting_audio_after_3.5s');
            }
          }, 3500);
        } catch (err) {
          console.warn(`[${this.callId}] Erro ao enviar conversation_initiation_client_data:`, err.message);
        }

        if (this.elevenReadyResolve) {
          this.elevenReadyResolve();
          this.elevenReadyResolve = null;
        }
      });

      this.elevenSocket.on('message', (raw) => {
        this.handleElevenMessage(raw);
      });

      this.elevenSocket.on('error', (err) => {
        console.error(`[${this.callId}] 🔴 Erro no WebSocket da ElevenLabs:`, err.message);
        if (!this.elevenConnected && this.elevenReadyResolve) {
          this.elevenReadyResolve();
          this.elevenReadyResolve = null;
        }
      });

      this.elevenSocket.on('close', (code, reason) => {
        console.log(`[${this.callId}] 🔴 WebSocket ElevenLabs fechado. Código: ${code}, Razão: ${reason ? reason.toString() : 'N/A'}`);
        this.elevenConnected = false;
        this.elevenReady = false;
        if (!this.isTerminated) {
          this.terminateCall('elevenlabs_disconnected');
        }
      });
    } catch (err) {
      console.error(`[${this.callId}] Falha ao iniciar WebSocket ElevenLabs:`, err.message);
    }
  }

  convertAgentAudioToPcm8k(rawAudioBuf) {
    if (!rawAudioBuf || rawAudioBuf.length === 0) return Buffer.alloc(0);
    const fmt = (this.agentAudioFormat || 'pcm_8000').toLowerCase();
    if (fmt === 'pcm_8000') {
      return this.reconFilter8k.process(rawAudioBuf);
    }
    if (fmt === 'ulaw_8000' || fmt === 'g711_ulaw') {
      return this.reconFilter8k.process(mulawToLinear16(rawAudioBuf));
    }
    if (fmt === 'pcm_24000') {
      return this.resampler24to8.process(rawAudioBuf);
    }
    // Default fallback: pcm_16000 -> pcm_8000 com filtro FIR anti-aliasing stateful
    return this.resampler16to8.process(rawAudioBuf);
  }

  convertUserPcm8kToElevenFormat(pcm8kBuffer) {
    if (!pcm8kBuffer || pcm8kBuffer.length === 0) return Buffer.alloc(0);
    const fmt = (this.userInputAudioFormat || 'pcm_8000').toLowerCase();
    if (fmt === 'pcm_8000') {
      return pcm8kBuffer;
    }
    if (fmt === 'ulaw_8000' || fmt === 'g711_ulaw') {
      return linear16ToMulaw(pcm8kBuffer);
    }
    return upsample8to16(pcm8kBuffer);
  }

  handleElevenMessage(data) {
    try {
      const msg = JSON.parse(data.toString());

      // 0. Metadados de inicialização da conversa
      if (msg.conversation_initiation_metadata_event || msg.type === 'conversation_initiation_metadata') {
        const meta = msg.conversation_initiation_metadata_event || msg;
        this.agentAudioFormat = meta.agent_output_audio_format || 'pcm_8000';
        this.userInputAudioFormat = meta.user_input_audio_format || 'pcm_8000';
        this.conversationId = meta.conversation_id;
        console.log(
          `[${this.callId}] 🟢 Metadados ElevenLabs: ConvID [${this.conversationId}] | Áudio Agente: [${this.agentAudioFormat}] | Entrada: [${this.userInputAudioFormat}]`
        );
      }

      // 1. Áudio do Agente da ElevenLabs para tocar no FreeSWITCH via WsMediaBridge
      if (msg.audio_event && msg.audio_event.audio_base_64) {
        if (this.isResponseCancelled) {
          return;
        }
        if (!this.isAgentTalking) {
          this.isAgentTalking = true;
          this.agentPlaybackStartTime = Date.now();
          this.turnPlaybackStartTime = Date.now();
          this.turnAudioBytes = 0;
          this.mediaBridge.startPlaybackStream();
        }

        const rawAudioBuf = Buffer.from(msg.audio_event.audio_base_64, 'base64');
        const pcm8k = this.convertAgentAudioToPcm8k(rawAudioBuf);

        if (this.mediaBridge && !this.isTerminated && pcm8k.length > 0) {
          // Nota: WsMediaBridge.pushAudioChunk já alimenta automaticamente this.recorder.pushAiChunk(pcm8k)
          this.mediaBridge.pushAudioChunk(pcm8k);
        }

        if (pcm8k.length > 0) {
          this.turnAudioBytes += pcm8k.length;
        }

        if (this.isGreetingInProgress && pcm8k.length > 0) {
          if (!this.greetingPlaybackStartTime) {
            this.greetingPlaybackStartTime = Date.now();
          }
          this.greetingAudioBytes += pcm8k.length;
        }

        if (this.agentSilenceTimer) {
          clearTimeout(this.agentSilenceTimer);
        }

        // Calcula o tempo real restante de reprodução no pacer (PCM 8kHz 16-bit = 16 bytes/ms)
        const turnDurationMs = Math.round(this.turnAudioBytes / 16);
        const elapsedTurnMs = this.turnPlaybackStartTime
          ? Date.now() - this.turnPlaybackStartTime
          : 0;
        const remainingTurnPlayoutMs = Math.max(650, turnDurationMs - elapsedTurnMs + 300);

        this.agentSilenceTimer = setTimeout(() => {
          if (this.isAgentTalking) {
            this.turnAudioBytes = 0;
            this.turnPlaybackStartTime = null;
            this.resampler24to8.reset();
            this.resampler16to8.reset();
            this.reconFilter8k.reset();
            console.log(`[${this.callId}] 🔊 Fim da reprodução de áudio da IA (ElevenLabs).`);
            if (this.mediaBridge) {
              this.mediaBridge.endPlaybackStream();
              if (!this.mediaBridge.isPlaying) {
                this.isAgentTalking = false;
              }
            } else {
              this.isAgentTalking = false;
            }
          }

          // Barge-in Dinâmico: Quando a IA termina de reproduzir os chunks da saudação inicial,
          // abre o microfone do cliente no FreeSWITCH.
          if (this.isGreetingInProgress && !this.greetingFinishTimer) {
            const audioDurationMs = Math.round(this.greetingAudioBytes / 16);
            const elapsedPlaybackMs = this.greetingPlaybackStartTime
              ? Date.now() - this.greetingPlaybackStartTime
              : 0;
            const remainingMs = Math.max(0, audioDurationMs - elapsedPlaybackMs) + 250;

            console.log(
              `[${this.callId}] ⏳ [BARGE-IN DINÂMICO] Saudação da ElevenLabs transmitida (${(audioDurationMs / 1000).toFixed(1)}s de áudio). Aguardando término da reprodução (${remainingMs}ms) para abrir o canal.`
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
        }, remainingTurnPlayoutMs);
      }

      // 2. Transcrição da fala do Cliente recebida da ElevenLabs
      if (msg.user_transcription_event && msg.user_transcription_event.user_transcript) {
        const text = msg.user_transcription_event.user_transcript.trim();
        if (text) {
          if (this.isBargeinGraceActive()) {
            console.log(
              `[${this.callId}] 🛡️ [BARGE-IN GRACE] Transcrição do cliente ignorada durante carência: "${text}"`
            );
            this.recordTranscriptTurn('Cliente', `[Ignorado na Saudação]: ${text}`);
          } else {
            this.recordTranscriptTurn('Cliente', text);
          }
        }
      }

      // 3. Resposta textual do Agente da ElevenLabs
      if (msg.agent_response_event && msg.agent_response_event.agent_response) {
        this.isResponseCancelled = false;
        const text = msg.agent_response_event.agent_response.trim();
        if (text) {
          this.recordTranscriptTurn('Atendente', text);
        }
      }

      // 4. Interrupção disparada pelo servidor ElevenLabs (Barge-In remoto)
      if (msg.interruption_event) {
        if (!this.canTriggerBargeIn()) {
          console.log(
            `[${this.callId}] 🛡️ [BARGE-IN GRACE] Interrupção remota da ElevenLabs bloqueada durante carência/saudação.`
          );
          return;
        }
        const isAgentReallyPlaying = Boolean(this.isAgentTalking || (this.mediaBridge && this.mediaBridge.isPlaying));
        const isLegitSpeaker = !this.isSecondaryVoiceBlocked &&
          (!this.crosstalkFilter || this.crosstalkFilter.isActivelySpeaking(isAgentReallyPlaying));
        if (!isLegitSpeaker) {
          console.log(`[${this.callId}] 🛡️ [BIOMETRIA] interruption_event ignorado (voz secundária/fundo bloqueada ou energia insuficiente).`);
          return;
        }
        console.log(`[${this.callId}] ⚡ Interrupção recebida da ElevenLabs.`);
        this.interruptAgent();
      }

      // 5. Ping / Pong Keep-Alive da ElevenLabs
      if (msg.type === 'ping') {
        if (this.elevenSocket?.readyState === WebSocket.OPEN) {
          this.elevenSocket.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id }));
        }
      }
    } catch (err) {
      console.warn(`[${this.callId}] Erro ao processar mensagem ElevenLabs:`, err.message);
    }
  }

  interruptAgent() {
    this.isAgentTalking = false;
    this.agentPlaybackStartTime = null;
    this.turnAudioBytes = 0;
    this.turnPlaybackStartTime = null;
    this.resampler24to8.reset();
    this.resampler16to8.reset();
    this.reconFilter8k.reset();
    if (this.agentSilenceTimer) {
      clearTimeout(this.agentSilenceTimer);
      this.agentSilenceTimer = null;
    }
    if (this.mediaBridge) {
      this.mediaBridge.killAudio();
    }
    if (this.channelUuid) {
      this.safeApi(`uuid_audio_fork ${this.channelUuid} stop_play`);
      this.safeApi(`uuid_break ${this.channelUuid} all`);
    }
    return true;
  }

  triggerBargeIn(reason = 'local_vad') {
    if (!this.canTriggerBargeIn()) {
      const elapsedSec = this.startedAt ? (Date.now() - this.startedAt.getTime()) / 1000 : 0;
      console.log(
        `[${this.callId}] 🛡️ [BARGE-IN GRACE] Tentativa de interrupção (${reason}) bloqueada: ${elapsedSec.toFixed(1)}s < ${this.bargeinGraceSec}s (Pedido do cliente ignorado durante saudação).`
      );
      return false;
    }

    if (!this.isAgentTalking) return false;

    console.log(`[${this.callId}] 🎤 BARGE-IN: Interrompendo agente ElevenLabs imediatamente (${reason})...`);
    this.isResponseCancelled = true;
    this.interruptAgent();
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

  handleDtmf(evt) {
    if (this.isTerminated) return;
    const digit = typeof evt === 'string' ? evt : evt?.dtmf || evt?.digit;
    if (!digit) return;

    if (this.isBargeinGraceActive()) {
      console.log(`[${this.callId}] 🛡️ [BARGE-IN GRACE] Dígito DTMF '${digit}' ignorado durante o período de carência (saudação inicial).`);
      return;
    }

    console.log(`[${this.callId}] 🔢 [DTMF] Dígito capturado: '${digit}'`);

    if (this.isAgentTalking) {
      this.triggerBargeIn('dtmf_input');
    }

    if (this.dtmfTimer) {
      clearTimeout(this.dtmfTimer);
      this.dtmfTimer = null;
    }

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

    console.log(`[${this.callId}] 🔢 [DTMF FLUSH] Sequência completa enviada à IA (ElevenLabs): "${digits}"`);
    this.recordTranscriptTurn('Cliente', `[DTMF: ${digits}]`);

    if (this.elevenSocket && this.elevenSocket.readyState === WebSocket.OPEN) {
      try {
        this.elevenSocket.send(
          JSON.stringify({
            type: 'user_message',
            text: `[DTMF digitado pelo usuário no teclado: ${digits}]`
          })
        );
      } catch {}
    }
  }

  recordTranscriptTurn(speaker, text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return null;

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
    this.lastTurn = { speaker: role, text: cleanText, time: now, entry };

    try {
      if (this.callHistoryManager) {
        this.callHistoryManager.recordCallUpdate(this.callId, {
          transcriptTurnsCount: this.transcriptLog.length,
          lastTurn: entry
        });
      }
    } catch {}

    return entry;
  }

  detectLineType() {
    const cleanTo = String(this.called || '').replace(/\D/g, '');
    const cleanFrom = String(this.caller || '').replace(/\D/g, '');

    const headerLineType = String(this.sipHeaders?.['x-line-type'] || '').toLowerCase();
    if (headerLineType === 'softphone' || headerLineType === 'trunk_sip') {
      return headerLineType;
    }

    if (cleanTo.length >= 10 || cleanFrom.length >= 10) {
      return 'trunk_sip';
    }

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

    const { model, voiceId, agentId } = this.getCredentials();
    console.log(
      `[${this.callId}] 🎙️ [ELEVENLABS STS] Inicializando chamada | Agent: [${agentId}] | Voz: [${voiceId}] | Modelo: [${model}]`
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

    // 1. Timer de Aviso Prévio aos ~170s
    this.warningDurationTimer = setTimeout(() => {
      if (this.isTerminated) return;
      this.isSafetyExpiring = true;
      const warningText =
        'Atenção: esta chamada atingiu o limite de segurança de três minutos e foi interrompida para sua proteção. Agradecemos pelo contato e até logo!';
      console.warn(
        `[${this.callId}] ⏱️ Limite de segurança de 3 minutos atingido (${this.maxDurationSec}s). Falando aviso de interrupção ao interlocutor.`
      );

      if (this.elevenSocket && this.elevenSocket.readyState === WebSocket.OPEN) {
        try {
          this.say(
            `[AVISO DO SISTEMA: O limite máximo de segurança de 3 minutos foi atingido. Fale IMEDIATAMENTE: "${warningText}"]`,
            { interrupt: true }
          );
        } catch (e) {
          console.error(`[${this.callId}] Erro ao enviar fala de limite de segurança na ElevenLabs:`, e.message);
        }
      } else if (this.endpoint) {
        try {
          this.endpoint.play('tone_stream://v=-10;%(400,200,425);%(400,200,425)').catch(() => {});
        } catch {}
      }
    }, warningTimeMs);

    // 2. Hard Cap Inegociável aos 180s
    this.maxDurationTimer = setTimeout(() => {
      console.warn(
        `[${this.callId}] 🛑 Limite rígido de segurança atingido (${this.maxDurationSec}s). Encerrando chamada ElevenLabs.`
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

    // 2. Gravação Dual-Stream Stereo (.wav) + Transcrição (.txt) SOMENTE quando STT habilitado
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
    let silenceDurationMs = 280;

    // 3. Inicia ponte de áudio recebendo Buffer binário direto
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

        // Gravação Stereo (Left=Cliente, Right=Atendente) guiada pelo clock de 20ms do RTP
        if (this.recorder && !this.isToneProbe) {
          this.recorder.writeUserChunk(buffer);
        }

        // OTIMIZAÇÃO DE ESCALA: Só calcula RMS e Goertzel durante os 1.1s iniciais de calibração Sonar
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

        const amdStillDeciding =
          this.whisperSession &&
          this.whisperSession.isAmdEnabled &&
          this.whisperSession.amdMode === 'active' &&
          !this.whisperSession.decisionReceived;

        const isGraceActive = this.isBargeinGraceActive();

        if (!isGraceActive && !this.graceEndLogged && this.bargeinGraceSec > 0 && this.startedAt) {
          this.graceEndLogged = true;
          console.log(
            `[${this.callId}] ⏳ [BARGE-IN GRACE] Período de carência finalizado (${this.bargeinGraceSec}s). Processamento de fala e pedidos do cliente liberados.`
          );
        }

        // Filtros de Voz de Fundo Selecionáveis: 'atual' (DSP), 'wespeaker' (CAM++) ou 'ecapa' (ECAPA-TDNN)
        const isAgentReallyPlaying = Boolean(this.isAgentTalking || (this.mediaBridge && this.mediaBridge.isPlaying));

        let isPrimaryVoiceDsp = true;
        if (this.isDspFilterActive && this.crosstalkFilter) {
          isPrimaryVoiceDsp = !this.isToneProbe && !amdStillDeciding && !isGraceActive
            ? this.crosstalkFilter.process(buffer, isAgentReallyPlaying)
            : false;

          if (!this.dynamicEcapaSwitched && this.crosstalkFilter.noiseFloor >= 200) {
            this.dynamicEcapaSwitched = true;
            this.switchCrosstalkFilter('ecapa', `Piso de ruído elevado em tempo real (${Math.round(this.crosstalkFilter.noiseFloor)} RMS)`);
          }
        } else if (isGraceActive || this.isToneProbe || amdStillDeciding) {
          isPrimaryVoiceDsp = false;
        }

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
        // tom probe, voz secundária neural confirmada ou ruído/TV enquanto o agente fala.
        let effectiveBuffer = buffer;
        if (isGraceActive || this.isToneProbe || amdStillDeciding) {
          effectiveBuffer = Buffer.alloc(buffer.length);
        } else if (this.isNeuralFilterActive && this.isSecondaryVoiceBlocked) {
          effectiveBuffer = Buffer.alloc(buffer.length);
        } else if (this.isDspFilterActive && !isPrimaryVoiceDsp && (isAgentReallyPlaying || (this.crosstalkFilter?.lastRms || 0) < 400)) {
          effectiveBuffer = Buffer.alloc(buffer.length);
        }

        // Barge-in Instantâneo (<20ms): só interrompe se for fala ativa legítima e fora da carência
        const isActivelySpeaking = this.crosstalkFilter
          ? this.crosstalkFilter.isActivelySpeaking(isAgentReallyPlaying)
          : this.frameVad.process(buffer);
        if (isPrimaryVoice && isActivelySpeaking && isAgentReallyPlaying && this.canTriggerBargeIn()) {
          this.triggerBargeIn(this.isNeuralFilterActive ? `biometric_${this.crosstalkMode}` : 'local_biometric_vad');
        }

        // Whisper local para AMD
        if (this.whisperSession && this.isAmdEnabled && !this.whisperSession.decisionReceived && !this.isToneProbe) {
          this.whisperSession.pushAudio(buffer, 8000);
        }

        // Envia áudio para a ElevenLabs somente após fim do Sonar, fim do AMD e fora da carência da saudação
        if (
          !this.isToneProbe &&
          !amdStillDeciding &&
          !isGraceActive &&
          !this.isMuted &&
          !this.isOnHold &&
          this.elevenReady &&
          this.elevenSocket &&
          this.elevenSocket.readyState === WebSocket.OPEN
        ) {
          const outboundAudio = this.convertUserPcm8kToElevenFormat(effectiveBuffer);
          this.elevenSocket.send(
            JSON.stringify({
              user_audio_chunk: outboundAudio.toString('base64')
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
        return;
      }
      if (this.whisperSession) {
        console.log(`[${this.callId}] 🔌 Connect confirmado / AMD concluído. Desligando Whisper local.`);
        this.whisperSession.stop();
        this.whisperSession = null;
      }
    }

    if (this.whisperSession) {
      console.log(`[${this.callId}] 🔌 Connect confirmado. Desligando Whisper local.`);
      this.whisperSession.stop();
      this.whisperSession = null;
    }

    const bargeinLevel = this.tenant.bargeinLevel ?? 3;

    // 4. Calibração acústica (Sonar Mode - Tom inicial 425Hz de 700ms para detectar nível de ruído e eco)
    if (amdWasExecuted) {
      this.calibrationActive = false;
      this.deviceMode = 'fone_ouvido';
      this.currentProfile = this.energyManager.getClassification();
      const lineProfiles = this.profilesByLine[this.lineType] || this.profilesByLine.trunk_sip;
      const config = lineProfiles[this.currentProfile].fone;
      vadThreshold = Number(this.tenant?.vadThreshold || config.base);
      silenceDurationMs = Number(this.tenant?.silenceDurationMs || config.silence);
      console.log(
        `[${this.callId}] ⚡ FAST-LOCK (Pós-AMD): Linha ${this.lineType.toUpperCase()} | Ambiente ${this.currentProfile} | VAD ${vadThreshold} | Silêncio ${silenceDurationMs}ms (Sonar pulado para 0ms de atraso)`
      );

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
      silenceDurationMs = Number(this.tenant?.silenceDurationMs || config.silence);

      console.log(
        `[${this.callId}] 🎯 SONAR LOCK: Linha ${this.lineType.toUpperCase()} | Dispositivo ${this.deviceMode.toUpperCase()} | Ambiente ${this.currentProfile} | VAD ${vadThreshold} | Silêncio ${silenceDurationMs}ms`
      );

      if (['STREET', 'TV', 'OFFICE'].includes(this.currentProfile) && (this.crosstalkMode === 'atual' || this.crosstalkMode === 'dsp')) {
        this.switchCrosstalkFilter('ecapa', `Ambiente ruidoso detectado na calibração Sonar (${this.currentProfile})`);
      }
    } else {
      this.calibrationActive = false;
      this.endpoint.play('tone_stream://v=-13;%(500,0,425)').catch(() => {});
      await wait(500);
    }

    if (this.isTerminated) return;

    // 5. Inicia a conexão com a ElevenLabs APÓS a sonda Sonar 425Hz terminar!
    // Assim, a saudação inicial da ElevenLabs toca limpa imediatamente após o bip Sonar, sem colisão de áudio.
    this.initElevenLabsConnection();

    if (!this.elevenConnected && this.elevenReadyPromise) {
      await withTimeout(this.elevenReadyPromise, 5000).catch((e) => {
        console.warn(`[${this.callId}] Alerta no handshake ElevenLabs:`, e.message);
      });
    }

    if (this.isTerminated) return;

    if (!this.elevenSocket || this.elevenSocket.readyState !== WebSocket.OPEN) {
      console.error(`[${this.callId}] 🔴 Falha ao estabelecer conexão com a ElevenLabs Conversational AI.`);
      this.terminateCall('elevenlabs_connection_failed');
      return;
    }

    console.log(
      `[${this.callId}] 🟢 ElevenLabs STS configurada (Formato Agente: ${this.agentAudioFormat}) e pronta para conversação.`
    );
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

  say(text, { role = 'user', interrupt = true, triggerResponse = true } = {}) {
    if (!text || this.isTerminated) return { role, interrupt, triggerResponse };
    if (interrupt && this.isAgentTalking) {
      this.interruptAgent();
    }
    if (!this.elevenSocket || this.elevenSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Sessão ElevenLabs Conversational AI não está conectada');
    }

    console.log(`[${this.callId}] 📢 say() em ElevenLabs STS: "${text}"`);
    if (triggerResponse) {
      this.elevenSocket.send(
        JSON.stringify({
          type: 'user_message',
          text: String(text)
        })
      );
    } else {
      this.elevenSocket.send(
        JSON.stringify({
          type: 'contextual_update',
          text: String(text)
        })
      );
    }
    return { role, interrupt, triggerResponse };
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

  mute(muted = true) {
    return this.setMute(muted);
  }

  async setHold(held) {
    this.isOnHold = Boolean(held);
    if (this.isOnHold) {
      this.interruptAgent();
    }
    if (this.endpoint && this.channelUuid) {
      const subCmd = this.isOnHold ? `${this.channelUuid}` : `off ${this.channelUuid}`;
      await this.endpoint.api(`uuid_hold ${subCmd}`).catch(() => {});
    }
    return { isOnHold: this.isOnHold };
  }

  hold(onHold = true) {
    return this.setHold(onHold);
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
      stsEngine: 'elevenlabs',
      codec: this.agentAudioFormat || 'pcm_8000',
      deviceMode: this.deviceMode,
      noiseProfile: this.currentProfile,
      isAgentTalking: this.isAgentTalking,
      isMuted: this.isMuted,
      isOnHold: this.isOnHold,
      openaiConnected: this.elevenConnected,
      elevenConnected: this.elevenConnected,
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

    console.log(`[${this.callId}] Encerrando chamada ElevenLabs (Motivo: ${reason})...`);
    if (this.dialog) {
      try { this.dialog.destroy(); } catch {}
      this.dialog = null;
    }
    if (this.endpoint) {
      try { this.endpoint.destroy(); } catch {}
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
    if (this.agentSilenceTimer) {
      clearTimeout(this.agentSilenceTimer);
      this.agentSilenceTimer = null;
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

    // Registra custos no AiCostTracker e atualiza histórico em tempo real
    try {
      const durationSec = this.startedAt ? Math.max(1, Math.floor((Date.now() - this.startedAt.getTime()) / 1000)) : 0;
      const { model } = this.getCredentials();
      aiCostTracker.recordUsage({
        callId: this.callId,
        tenantId: this.tenant?.id || 'default',
        provider: 'elevenlabs',
        model,
        usage: { durationSec, totalTokens: durationSec * 50 }
      });
      if (this.callHistoryManager) {
        const aiUsage = aiCostTracker.getCostByCallId(this.callId);
        if (aiUsage) {
          this.callHistoryManager.recordCallUpdate(this.callId, {
            costUsd: aiUsage.costUsd,
            totalTokens: aiUsage.totalTokens
          });
        }
      }
    } catch {}

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

    if (this.elevenSocket) {
      try {
        this.elevenSocket.close();
      } catch {}
      this.elevenSocket = null;
    }
    this.elevenConnected = false;
    this.elevenReady = false;
  }
}

module.exports = ElevenLabsS2SBridge;
