const WebSocket = require('ws');
const { EventEmitter } = require('events');

/**
 * Helper de reamostragem rápida PCM16: 8kHz para 16kHz (Interpolação Linear leve)
 * O Whisper espera áudio mono de 16kHz (16.000 amostras/segundo).
 */
function upsample8to16(buffer8k) {
  const samplesCount = buffer8k.length >> 1;
  if (samplesCount === 0) return Buffer.alloc(0);
  const buffer16k = Buffer.allocUnsafe(samplesCount * 4);

  for (let i = 0; i < samplesCount; i++) {
    const s0 = buffer8k.readInt16LE(i * 2);
    const s1 = i + 1 < samplesCount ? buffer8k.readInt16LE((i + 1) * 2) : s0;

    const mid = (s0 + s1) >> 1;
    const pos = i * 4;
    buffer16k.writeInt16LE(s0, pos);
    buffer16k.writeInt16LE(mid, pos + 2);
  }
  return buffer16k;
}

/**
 * Pool de Conexões com Múltiplos Nós do whisper-service
 * Suporta balanceamento Least-Connections e Fail-open (Circuit Breaker)
 */
class WhisperPool {
  constructor() {
    this.nodes = [];
    this.roundRobinIdx = 0;
    this.parseNodes();
  }

  parseNodes() {
    const raw = process.env.WHISPER_NODES || process.env.WHISPER_SERVICE_URL || 'ws://127.0.0.1:8080/ws/audio';
    const entries = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.nodes = entries.map((url, idx) => {
      const wsUrl = url.includes('/ws/') ? url : `${url.replace(/\/+$/, '')}/ws/audio`;
      return {
        id: `whisper-${idx + 1}`,
        url: wsUrl,
        activeSessions: 0,
        isHealthy: true,
        unhealthyUntil: 0,
        lastError: null
      };
    });
  }

  selectNode() {
    const now = Date.now();
    for (const n of this.nodes) {
      if (!n.isHealthy && now >= n.unhealthyUntil) {
        n.isHealthy = true;
      }
    }
    const healthy = this.nodes.filter((n) => n.isHealthy);
    if (healthy.length === 0) return null; // Retorna null para acionar Fail-Open imediato (0ms) sem travar chamadas
    if (healthy.length === 1) return healthy[0];

    let min = Infinity;
    for (const n of healthy) {
      if (n.activeSessions < min) min = n.activeSessions;
    }
    const candidates = healthy.filter((n) => n.activeSessions === min);
    const chosen = candidates[this.roundRobinIdx % candidates.length];
    this.roundRobinIdx = (this.roundRobinIdx + 1) % 1000000;
    return chosen;
  }

  markNodeUnhealthy(node, errMsg, cooldownMs = 10000) {
    if (!node) return;
    node.isHealthy = false;
    node.unhealthyUntil = Date.now() + cooldownMs;
    node.lastError = errMsg;
  }

  getStats() {
    const healthyCount = this.nodes.filter((n) => n.isHealthy).length;
    return {
      totalNodes: this.nodes.length,
      healthyNodes: healthyCount,
      nodes: this.nodes.map((n) => ({
        id: n.id,
        url: n.url,
        isHealthy: n.isHealthy,
        activeSessions: n.activeSessions,
        lastError: n.lastError
      }))
    };
  }
}

const globalWhisperPool = new WhisperPool();

/**
 * Gerenciador de Sessão AMD/STT por Chamada (WhisperSession)
 */
class WhisperSession extends EventEmitter {
  constructor({ callId, channelUuid, tenant, sipHeaders = {} }) {
    super();
    this.callId = callId;
    this.channelUuid = channelUuid;
    this.tenant = tenant;

    const sipAmdHeader = sipHeaders['x-amd-enabled'] || sipHeaders['X-AMD-Enabled'];
    const sipSttHeader = sipHeaders['x-stt-enabled'] || sipHeaders['X-STT-Enabled'];
    const sipSpkHeader = sipHeaders['x-crosstalk-mode'] || sipHeaders['X-Crosstalk-Mode'];

    this.isAmdEnabled =
      sipAmdHeader !== undefined
        ? sipAmdHeader === 'true' || sipAmdHeader === true
        : !!(tenant.amd && tenant.amd.enabled);

    this.isSttEnabled =
      sipSttHeader !== undefined
        ? sipSttHeader === 'true' || sipSttHeader === true
        : !!(tenant.stt && tenant.stt.enabled);

    // Suporte aos filtros opcionais de biometria vocal neural: 'wespeaker' e 'ecapa'
    const spkMode = (sipSpkHeader || (tenant.crosstalkFilter && tenant.crosstalkFilter.mode) || tenant.crosstalkMode || process.env.CROSSTALK_FILTER_MODE || 'none').toLowerCase();
    this.spkFilter = (spkMode === 'wespeaker' || spkMode === 'ecapa') ? spkMode : 'none';
    this.spkThreshold = Number((tenant.crosstalkFilter && tenant.crosstalkFilter.threshold) || tenant.crosstalkThreshold || process.env.CROSSTALK_THRESHOLD || 0);
    this.isSpkFilterEnabled = this.spkFilter !== 'none';

    this.amdMode = (tenant.amd && tenant.amd.mode) || 'active';
    this.ws = null;
    this.node = null;
    this.nodeId = null;
    this.decisionReceived = false;
    this.lastDecision = null;
    this.decisionPromise = null;
    this.decisionResolve = null;
    this.circuitBreakerTimer = null;
    this.pendingChunks = []; // Buffer para não perder a 1ª sílaba do "Alô" enquanto o WS está em CONNECTING
    this.maxPendingChunks = 50; // Máx 1 segundo (50 chunks de 20ms)
    this.closed = false;

    this.decisionPromise = new Promise((resolve) => {
      this.decisionResolve = resolve;
    });
  }

  isActive() {
    return this.isAmdEnabled || this.isSttEnabled || this.isSpkFilterEnabled;
  }

  resolveDecisionOnce(decisionObj) {
    if (this.decisionReceived) return;
    this.decisionReceived = true;
    this.lastDecision = decisionObj;
    if (this.circuitBreakerTimer) {
      clearTimeout(this.circuitBreakerTimer);
      this.circuitBreakerTimer = null;
    }
    this.emit('decision', decisionObj);
    if (this.decisionResolve) {
      this.decisionResolve(decisionObj);
    }
  }

  async waitForDecision() {
    if (this.lastDecision) return this.lastDecision;
    if (!this.isAmdEnabled) {
      return { label: 'humano', confidence: 1.0, reason: 'amd_disabled' };
    }
    return this.decisionPromise;
  }

  start() {
    if (!this.isActive()) {
      this.resolveDecisionOnce({
        label: 'humano',
        confidence: 1.0,
        reason: 'amd_disabled'
      });
      return;
    }

    if (!this.isAmdEnabled) {
      // Modo Somente STT: já resolve a decisão de AMD como humano imediatamente
      this.resolveDecisionOnce({
        label: 'humano',
        confidence: 1.0,
        reason: 'stt_only_mode'
      });
    }

    this.node = globalWhisperPool.selectNode();
    if (!this.node) {
      console.warn(`[${this.callId}] [WhisperSession] Nenhum nó Whisper disponível. Fallback para humano.`);
      this.resolveDecisionOnce({ label: 'humano', confidence: 0.5, reason: 'no_whisper_node' });
      return;
    }

    this.nodeId = this.node.id;
    this.node.activeSessions += 1;

    const urlObj = new URL(this.node.url);
    urlObj.searchParams.set('call_id', this.callId);
    urlObj.searchParams.set('tenant_id', this.tenant.id || 'default');
    urlObj.searchParams.set('amd', this.isAmdEnabled ? 'true' : 'false');
    urlObj.searchParams.set('stt', this.isSttEnabled ? 'true' : 'false');
    urlObj.searchParams.set('mode', this.amdMode);
    urlObj.searchParams.set('spk_filter', this.spkFilter || 'none');
    // Sem threshold explícito, o serviço usa o padrão calibrado do modelo
    if (this.spkThreshold > 0) urlObj.searchParams.set('spk_threshold', String(this.spkThreshold));

    if (this.isAmdEnabled) {
      this.circuitBreakerTimer = setTimeout(() => {
        if (!this.decisionReceived && !this.closed) {
          console.warn(`[${this.callId}] ⏱️ [AMD] Circuit Breaker atingido (3.5s sem resposta). Assumindo HUMANO.`);
          this.resolveDecisionOnce({
            label: 'humano',
            confidence: 0.5,
            reason: 'circuit_breaker_timeout'
          });
          if (!this.isSttEnabled && !this.isSpkFilterEnabled) {
            this.stop();
          }
        }
      }, 3500);
    }

    try {
      this.ws = new WebSocket(urlObj.toString());

      this.ws.on('open', () => {
        console.log(
          `[${this.callId}] 🧠 Conectado ao nó [${this.node.id}] (${this.node.url}) | AMD: ${this.isAmdEnabled} | STT: ${this.isSttEnabled} | Biometria: ${this.spkFilter.toUpperCase()}`
        );
        // Despeja imediatamente os pacotes iniciais capturados durante o handshake do WS
        if (this.pendingChunks.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
          for (const chunk of this.pendingChunks) {
            try {
              this.ws.send(chunk);
            } catch {}
          }
          this.pendingChunks = [];
        }
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.type === 'speaker_filter_updated') {
            this.spkFilter = msg.spk_filter;
            this.isSpkFilterEnabled = msg.spk_filter !== 'none';
            this.emit('speaker_filter_updated', msg);
            return;
          }

          if (msg.type === 'decision' && !this.decisionReceived) {
            console.log(
              `[${this.callId}] 🎯 [AMD] Decisão: [${msg.label.toUpperCase()}] (Confiança: ${(msg.confidence * 100).toFixed(0)}% | Fala: ${msg.speech_ms || 0}ms | Texto: "${msg.transcript || ''}")`
            );

            this.resolveDecisionOnce(msg);

            // Whisper local é estritamente para detecção de AMD: desliga assim que a decisão for obtida
            if (!this.isSttEnabled) {
              this.stop();
            }
          }

          if (msg.type === 'transcript') {
            this.emit('transcript', msg);
          }

          if (msg.type === 'speaker_enrolled') {
            this.emit('speaker_enrolled', msg);
          }

          if (msg.type === 'speaker_verification') {
            this.emit('speaker_verification', msg);
          }

          if (msg.type === 'speaker_idle') {
            this.emit('speaker_idle', msg);
          }
        } catch (err) {
          console.error(`[${this.callId}] [WhisperSession] Erro ao decodificar JSON do Whisper:`, err.message);
        }
      });

      this.ws.on('error', (err) => {
        if (!this.closed) {
          console.warn(`[${this.callId}] ⚠️ Erro no WebSocket do Whisper [${this.nodeId}]:`, err.message);
        }
        globalWhisperPool.markNodeUnhealthy(this.node, err.message);
        this._releaseNode();
        this.resolveDecisionOnce({ label: 'humano', confidence: 0.5, reason: 'whisper_ws_error' });
      });

      this.ws.on('close', () => {
        this._releaseNode();
        this.resolveDecisionOnce({ label: 'humano', confidence: 0.5, reason: 'whisper_ws_closed' });
      });
    } catch (err) {
      console.error(`[${this.callId}] Erro ao instanciar WebSocket Whisper:`, err.message);
      globalWhisperPool.markNodeUnhealthy(this.node, err.message);
      this._releaseNode();
      this.resolveDecisionOnce({ label: 'humano', confidence: 0.5, reason: 'whisper_init_failed' });
    }
  }

  _releaseNode() {
    if (this.node) {
      this.node.activeSessions = Math.max(0, this.node.activeSessions - 1);
      this.node = null;
    }
  }

  setSpeakerFilter(filterName, threshold = null) {
    this.spkFilter = (filterName || 'none').toLowerCase();
    this.isSpkFilterEnabled = this.spkFilter === 'wespeaker' || this.spkFilter === 'ecapa';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'set_spk_filter',
        spk_filter: this.spkFilter,
        spk_threshold: threshold
      }));
    }
  }

  pushAudio(audioBuffer, inputRate = 8000) {
    if (this.closed || !this.ws) return;
    if (this.decisionReceived && !this.isSttEnabled && !this.isSpkFilterEnabled) return;

    try {
      const pcm16k = inputRate === 8000 ? upsample8to16(audioBuffer) : audioBuffer;

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(pcm16k);
      } else if (this.ws.readyState === WebSocket.CONNECTING && this.pendingChunks.length < this.maxPendingChunks) {
        this.pendingChunks.push(pcm16k);
      }
    } catch {}
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    this.pendingChunks = [];

    if (this.circuitBreakerTimer) {
      clearTimeout(this.circuitBreakerTimer);
      this.circuitBreakerTimer = null;
    }

    // Garante que qualquer await waitForDecision() pendente seja destravado
    this.resolveDecisionOnce({ label: 'humano', confidence: 0.5, reason: 'session_stopped' });

    this._releaseNode();

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'stop' }));
        }
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

module.exports = {
  WhisperPool,
  whisperPool: globalWhisperPool,
  WhisperSession,
  upsample8to16
};
