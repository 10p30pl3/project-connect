require('dotenv').config({ override: true });
const WebSocket = require('ws');
const http = require('http');
const os = require('os');
const { URL } = require('url');
const EventEmitter = require('events');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const AUDIO_FORK_WS_HOST = process.env.AUDIO_FORK_WS_HOST || getLocalIp();
const WORKER_ID = parseInt(process.env.NODE_APP_INSTANCE || process.env.WORKER_ID || '0', 10);

/**
 * Servidor HTTP/WebSocket Centralizado por Worker
 * - Suporta múltiplos processos (Multi-Core PM2/Cluster) alocando portas automaticamente (ex: 8090, 8091, 8092...)
 * - Limita maxPayload em 64KB para evitar exaustão de memória (DoS)
 * - Disponibiliza endpoint /health com métricas do worker e do cluster FreeSWITCH
 */
class WsMediaServer {
  constructor() {
    this.server = null;
    this.wss = null;
    this.port = null;
    this.isListening = false;
    this.listenPromise = null;
    this.sessions = new Map(); // channelUuid -> WsMediaBridge
    this.pendingConnections = new Set();
    this.healthCallback = null;
    this.apiHandler = null;
  }

  setHealthCallback(fn) {
    this.healthCallback = fn;
  }

  setApiHandler(fn) {
    this.apiHandler = fn;
  }

  getHealthObject() {
    const extraHealth = this.healthCallback ? this.healthCallback() : {};
    return {
      status: 'ok',
      workerId: WORKER_ID,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      activeCallsInWorker: this.sessions.size,
      mediaPort: this.port,
      ...extraHealth
    };
  }

  async listen(requestedPort = null) {
    if (this.isListening) return this.port;
    if (this.listenPromise) return this.listenPromise;

    const basePort = parseInt(requestedPort || process.env.MEDIA_WS_PORT || '8090', 10);
    let candidatePort = basePort > 0 ? basePort + WORKER_ID : 0;

    this.listenPromise = new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.url === '/health' || req.url === '/healthz') {
          const status = this.getHealthObject();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(status, null, 2));
        }

        if (this.apiHandler) {
          try {
            const handled = await this.apiHandler(req, res);
            if (handled) return;
          } catch (err) {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'internal_error', message: err.message }));
            }
            return;
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`voice-app media server online (worker ${WORKER_ID})`);
      });

      this.wss = new WebSocket.Server({
        noServer: true,
        maxPayload: 64 * 1024 // Limite de 64KB por frame para proteção de memória
      });

      this.server.on('upgrade', (req, socket, head) => {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      let portRetries = 0;
      const maxPortRetries = 10;

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && portRetries < maxPortRetries && candidatePort > 0) {
          portRetries += 1;
          candidatePort += 1;
          console.warn(`[WsMediaServer] Porta em uso! Tentando próxima porta livre: ${candidatePort}...`);
          setTimeout(() => {
            this.server.listen(candidatePort, '0.0.0.0');
          }, 50);
          return;
        }
        console.error('[WsMediaServer] Erro no servidor HTTP central:', err.message);
        this.listenPromise = null;
        reject(err);
      });

      this.server.listen(candidatePort, '0.0.0.0', () => {
        this.port = this.server.address().port;
        this.isListening = true;
        console.log(`[WsMediaServer] 🚀 Worker #${WORKER_ID} (PID ${process.pid}) ouvindo mídia em 0.0.0.0:${this.port}`);
        resolve(this.port);
      });
    });

    return this.listenPromise;
  }

  extractChannelUuid(req) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const queryUuid = parsedUrl.searchParams.get('channelUuid') || parsedUrl.searchParams.get('uuid');
      if (queryUuid && this.sessions.has(queryUuid)) {
        return queryUuid;
      }

      const parts = parsedUrl.pathname.split('/').filter(Boolean);
      for (const part of parts) {
        if (this.sessions.has(part)) {
          return part;
        }
      }

      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (this.sessions.has(lastPart)) return lastPart;
        // Se a URL especificou explicitamente /media/<uuid> e o UUID não existe em sessions, não faz fallback
        if (parts[0] === 'media' && parts.length >= 2) {
          return null;
        }
      }
    } catch {}

    if (this.pendingConnections.size === 1) {
      const [singleUuid] = this.pendingConnections;
      return singleUuid;
    }

    return null;
  }

  handleConnection(ws, req) {
    const ip = req.socket.remoteAddress;
    const channelUuid = this.extractChannelUuid(req);

    if (!channelUuid || !this.sessions.has(channelUuid)) {
      console.warn(`[WsMediaServer] Conexão WS rejeitada de ${ip} (URL: ${req.url}): canal não registrado`);
      ws.close(1008, 'Channel not found');
      return;
    }

    const session = this.sessions.get(channelUuid);
    this.pendingConnections.delete(channelUuid);
    session.attachSocket(ws, ip);
  }

  registerSession(channelUuid, session) {
    this.sessions.set(channelUuid, session);
    this.pendingConnections.add(channelUuid);
  }

  unregisterSession(channelUuid) {
    this.sessions.delete(channelUuid);
    this.pendingConnections.delete(channelUuid);
  }

  async close() {
    this.isListening = false;
    this.listenPromise = null;

    for (const session of this.sessions.values()) {
      try {
        session.stop();
      } catch {}
    }
    this.sessions.clear();
    this.pendingConnections.clear();

    if (this.wss) {
      try {
        this.wss.clients.forEach((c) => c.terminate());
        this.wss.close();
      } catch {}
      this.wss = null;
    }

    if (this.server) {
      await new Promise((resolve) => {
        try {
          this.server.closeAllConnections?.();
          this.server.close(() => resolve());
        } catch {
          resolve();
        }
      });
      this.server = null;
    }
    console.log('[WsMediaServer] Servidor Central de Mídia encerrado.');
  }
}

const mediaServerSingleton = new WsMediaServer();

class WsMediaBridge extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.callId = null;
    this.onAudio = null;
    this.endpoint = null;
    this.channelUuid = null;
    this.stopped = false;
    this.isPlaying = false;
    this.streamEnding = false;
    this.playbackChunkCount = 0;
    this.recorder = null;

    // Pacer de transmissão (40ms / 640 bytes @ 8kHz L16):
    // Evita bursts > 8KB no libwebsockets do mod_audio_fork, realocações de CircularBuffer
    // e contenção de switch_mutex_trylock no dub_speech_frame (causa de chiados/dropouts RTP).
    this.txQueue = [];
    this.txRemainder = Buffer.alloc(0);
    this.txPacerTimer = null;
    this.txPacerStartTime = 0;
    this.txFramesSent = 0;
  }

  setRecorder(recorder) {
    this.recorder = recorder;
  }

  async start({ callId, endpoint, onAudio }) {
    this.callId = callId;
    this.onAudio = onAudio;
    this.endpoint = endpoint;

    this.channelUuid =
      endpoint.uuid ||
      endpoint.id ||
      endpoint.sessionId ||
      endpoint.channelId ||
      endpoint.conn?.uuid;

    if (!this.channelUuid) {
      throw new Error('Não consegui descobrir o uuid do canal para uuid_audio_fork');
    }

    const port = await mediaServerSingleton.listen();
    mediaServerSingleton.registerSession(this.channelUuid, this);

    const wsUrl = `ws://${AUDIO_FORK_WS_HOST}:${port}/media/${this.channelUuid}`;
    // Habilita streaming bidirecional de áudio binário em mod_audio_fork:
    // argv[5]: bugname ('audio_fork' — obrigatório para compatibilidade com fork_session_stop_play em mod_audio_fork.c)
    // argv[6]: metadata ({})
    // argv[7]: bidirectionalAudio_enabled (true)
    // argv[8]: bidirectionalAudio_stream_enabled (true - aceita frames binários L16 do WebSocket para tocar no canal)
    // argv[9]: bidirectionalAudio_stream_samplerate (8000 Hz)
    const cmd = `uuid_audio_fork ${this.channelUuid} start ${wsUrl} mono 8000 audio_fork {} true true 8000`;
    console.log(`[${this.callId}] Iniciando mod_audio_fork na porta ${port}: ${cmd}`);

    if (!this.endpoint || typeof this.endpoint.api !== 'function') {
      console.warn(`[${this.callId}] [WsMediaBridge] Endpoint FreeSWITCH não disponível para iniciar mod_audio_fork`);
      return;
    }

    const response = await this.endpoint.api(cmd);
    console.log(`[${this.callId}] Resposta uuid_audio_fork:`, response?.body || response);
  }

  attachSocket(ws, ip) {
    this.socket = ws;
    console.log(`[${this.callId}] [WsMediaBridge] mod_audio_fork conectado de ${ip} (Canal: ${this.channelUuid})`);

    ws.on('message', (raw) => {
      if (this.stopped) return;

      if (Buffer.isBuffer(raw)) {
        this.onAudio && this.onAudio(raw);
        return;
      } else if (raw instanceof ArrayBuffer) {
        this.onAudio && this.onAudio(Buffer.from(raw));
        return;
      } else if (Array.isArray(raw)) {
        this.onAudio && this.onAudio(Buffer.concat(raw));
        return;
      }

      const s = raw.toString();
      if (s && s.length > 0) {
        try {
          const msg = JSON.parse(s);
          if (msg.audio) this.onAudio && this.onAudio(Buffer.from(msg.audio, 'base64'));
        } catch {
          this.onAudio && this.onAudio(Buffer.from(s));
        }
      }
    });

    ws.on('close', () => {
      console.log(`[${this.callId}] WebSocket de mídia desconectado.`);
      this.socket = null;
      this.stopTxPacer(true);
    });

    ws.on('error', (err) => {
      console.error(`[${this.callId}] Erro no WebSocket de mídia:`, err.message);
    });
  }

  startPlaybackStream() {
    if (this.stopped) return;
    this.isPlaying = true;
    this.streamEnding = false;
    this.playbackChunkCount = 0;
    console.log(`[${this.callId}] 🔊 Iniciando playback via WebSocket bidirecional (mod_audio_fork)`);
  }

  stopTxPacer(clearBuffers = false) {
    if (this.txPacerTimer) {
      clearInterval(this.txPacerTimer);
      this.txPacerTimer = null;
    }
    if (clearBuffers) {
      this.txQueue = [];
      this.txRemainder = Buffer.alloc(0);
      this.txFramesSent = 0;
      this.txPacerStartTime = 0;
    }
  }

  drainTxPacerTick() {
    if (this.stopped || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.stopTxPacer(true);
      return;
    }

    const FRAME_MS = 40;
    const CUSHION_FRAMES = 3; // 120ms de pré-buffer constante no CircularBuffer do FreeSWITCH
    const now = Date.now();
    const elapsedMs = now - this.txPacerStartTime;
    const targetFrames = Math.floor(elapsedMs / FRAME_MS) + CUSHION_FRAMES;

    let sentThisTick = 0;
    while (this.txFramesSent < targetFrames && this.txQueue.length > 0 && sentThisTick < 3) {
      const frame = this.txQueue.shift();
      try {
        this.socket.send(frame);
        this.txFramesSent++;
        sentThisTick++;
        this.playbackChunkCount++;
        if (this.playbackChunkCount === 1) {
          console.log(`[${this.callId}] 🔊 Primeiro frame cadenciado enviado via WS (${frame.length} bytes)`);
        }
      } catch (err) {
        console.error(`[${this.callId}] Erro ao enviar frame cadenciado via WS:`, err.message);
        break;
      }
    }

    if (this.txQueue.length === 0) {
      if (this.streamEnding) {
        if (this.txRemainder.length >= 2) {
          const evenLen = this.txRemainder.length & ~1;
          const tailFrame = this.txRemainder.subarray(0, evenLen);
          this.txRemainder = Buffer.alloc(0);
          try {
            this.socket.send(tailFrame);
            this.txFramesSent++;
            this.playbackChunkCount++;
          } catch {}
        } else {
          this.txRemainder = Buffer.alloc(0);
        }
        console.log(`[${this.callId}] 🔇 Playback encerrado (${this.playbackChunkCount} frames enviados)`);
        this.stopTxPacer(true);
        this.isPlaying = false;
        this.streamEnding = false;
        this.emit('playback_ended');
      } else if (targetFrames > this.txFramesSent + CUSHION_FRAMES) {
        // Evita acúmulo de déficit caso a IA demore entre pacotes na mesma resposta
        this.txPacerStartTime = now - Math.max(0, this.txFramesSent - 1) * FRAME_MS;
      }
    }
  }

  pushAudioChunk(chunk) {
    if (this.stopped || !chunk || chunk.length === 0) return;
    if (!this.isPlaying) {
      this.startPlaybackStream();
    }
    this.streamEnding = false;

    if (this.recorder) {
      this.recorder.pushAiChunk(chunk);
    }

    const FRAME_BYTES = 640; // 40ms @ 8kHz 16-bit mono (320 samples)
    const combined = this.txRemainder.length > 0 ? Buffer.concat([this.txRemainder, chunk]) : chunk;
    let offset = 0;

    while (offset + FRAME_BYTES <= combined.length) {
      const frame = Buffer.from(combined.subarray(offset, offset + FRAME_BYTES));
      this.txQueue.push(frame);
      offset += FRAME_BYTES;
    }

    this.txRemainder = offset < combined.length
      ? Buffer.from(combined.subarray(offset))
      : Buffer.alloc(0);

    if (!this.txPacerTimer && (this.txQueue.length > 0 || this.txRemainder.length >= 2)) {
      this.txPacerStartTime = Date.now();
      this.txFramesSent = 0;
      this.drainTxPacerTick();
      if (this.txQueue.length > 0 || !this.streamEnding) {
        this.txPacerTimer = setInterval(() => this.drainTxPacerTick(), 20);
      }
    } else if (this.txPacerTimer) {
      this.drainTxPacerTick();
    }
  }

  endPlaybackStream() {
    if (!this.isPlaying) return;
    this.streamEnding = true;
    if (this.txPacerTimer) {
      this.drainTxPacerTick();
    } else if (this.txRemainder.length >= 2 && this.socket && this.socket.readyState === WebSocket.OPEN) {
      const evenLen = this.txRemainder.length & ~1;
      try {
        this.socket.send(this.txRemainder.subarray(0, evenLen));
        this.playbackChunkCount++;
      } catch {}
      this.txRemainder = Buffer.alloc(0);
      console.log(`[${this.callId}] 🔇 Playback encerrado (${this.playbackChunkCount} frames enviados)`);
      this.isPlaying = false;
      this.streamEnding = false;
      this.emit('playback_ended');
    } else {
      console.log(`[${this.callId}] 🔇 Playback encerrado (${this.playbackChunkCount} frames enviados)`);
      this.isPlaying = false;
      this.streamEnding = false;
      this.emit('playback_ended');
    }
  }

  killAudio() {
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    this.streamEnding = false;
    this.stopTxPacer(true);
    if (wasPlaying) {
      this.emit('playback_ended');
    }
    if (this.recorder) {
      this.recorder.clearAiBuffer();
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        // Envia mensagem JSON nativa do mod_audio_fork para descarte imediato do buffer de áudio
        this.socket.send(JSON.stringify({ type: 'killAudio' }));
      } catch (e) {
        console.error(`[${this.callId}] Erro ao enviar killAudio via WS:`, e.message);
      }
    }
    if (this.endpoint && this.channelUuid) {
      // Dispara stop_play na API do FreeSWITCH para zerar os ponteiros de playout buffer no C++
      this.endpoint.api(`uuid_audio_fork ${this.channelUuid} stop_play`).catch(() => {});
    }
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;

    this.stopTxPacer(true);
    this.isPlaying = false;
    this.streamEnding = false;

    if (this.recorder) {
      await this.recorder.stop();
      this.recorder = null;
    }

    if (this.channelUuid) {
      mediaServerSingleton.unregisterSession(this.channelUuid);
    }

    try {
      if (this.endpoint && this.channelUuid) {
        const cmd = `uuid_audio_fork ${this.channelUuid} stop`;
        const response = await this.endpoint.api(cmd);
        console.log(`[${this.callId}] Stop uuid_audio_fork:`, response?.body || response);
      }
    } catch (err) {
      console.error(`[${this.callId}] Erro no stop uuid_audio_fork:`, err.message || err);
    }

    try {
      if (this.socket) {
        this.socket.terminate();
        this.socket = null;
      }
    } catch {}
  }
}

module.exports = WsMediaBridge;
module.exports.mediaServer = mediaServerSingleton;
