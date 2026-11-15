'use strict';

/**
 * Monitor de Voz em Tempo Real (LiveMonitor):
 * - Agrega picos RMS Cliente (RX) vs Agente IA (TX) a cada ~60ms
 * - Mede latência real entre turnos (fim da fala do cliente -> 1º áudio da IA)
 * - Distribui eventos via SSE (/v1/calls/:callId/monitor/events)
 * - Faz tap de áudio PCM 8kHz 16-bit LE ao vivo (/v1/calls/:callId/monitor/audio)
 */

const WAVE_WINDOW_MS = 60;
const MAX_WAVE_HISTORY = 450; // ~27s de histórico visível ao abrir o cockpit
const MAX_LATENCY_HISTORY = 100;
const PCM_SILENCE_100MS_MONO = Buffer.alloc(1600); // 8000 Hz * 2 bytes * 0.1s
const PCM_SILENCE_100MS_STEREO = Buffer.alloc(3200);

function computePeakPct(pcmBuf) {
  if (!pcmBuf || pcmBuf.length < 2) return 0;
  let sumSq = 0;
  const samples = Math.floor(pcmBuf.length / 2);
  for (let i = 0; i < samples; i++) {
    const s = pcmBuf.readInt16LE(i * 2);
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, samples));
  if (rms < 40) return 0;
  // Escala logarítmica perceptual em dBFS (-55 dBFS -> 0%, 0 dBFS -> 100%)
  // Evita saturação em 100% durante fala normal/alta e mantém dinâmica real da energia.
  const db = 20 * Math.log10(rms / 32768);
  const pct = ((db + 55) / 55) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

class LiveMonitor {
  constructor({ callId } = {}) {
    this.callId = callId || 'unknown';
    this.startedAt = Date.now();
    this.waveHistory = [];
    this.latencyHistory = [];

    this._callerMaxPeak = 0;
    this._agentMaxPeak = 0;
    this._lastCallerChunk = null;
    this._lastCallerAt = 0;
    this._lastAgentChunk = null;
    this._lastAgentAt = 0;

    // Controle de turno de fala para cálculo exato da latência de resposta (ms)
    this._userSpeaking = false;
    this._userSpeechEndAt = null;
    this._awaitingAiAfterUser = false;
    this._lastRmsSpeechAt = 0;
    this._currentEndpointingMs = null;

    this.sseClients = new Set();
    this.audioClients = new Set(); // { res, channel: 'stereo' | 'caller' | 'agent' }

    this._waveTimer = setInterval(() => this._flushWaveSample(), WAVE_WINDOW_MS);
    this._pingTimer = setInterval(() => this._sendSseHeartbeat(), 15000);
    this._keepaliveTimer = setInterval(() => this._sendAudioKeepalive(), 120);
  }

  markUserSpeechStart(ts = Date.now()) {
    this._userSpeaking = true;
    this._userSpeechEndAt = null;
    this._awaitingAiAfterUser = false;
  }

  markUserSpeechEnd(ts = Date.now(), endpointingMs = null) {
    this._userSpeaking = false;
    this._userSpeechEndAt = ts;
    this._awaitingAiAfterUser = true;
    this._currentEndpointingMs = Number.isFinite(endpointingMs) ? Math.max(0, Math.round(endpointingMs)) : null;
  }

  markAiFirstAudio(ts = Date.now()) {
    if (!this._awaitingAiAfterUser && !this._lastRmsSpeechAt) return null;
    const endRef = this._userSpeechEndAt || this._lastRmsSpeechAt;
    if (!endRef || ts < endRef) return null;

    const rawDelta = Math.round(ts - endRef);
    // Descarta deltas absurdos (> 10s) causados por longos silêncios/idle
    this._awaitingAiAfterUser = false;
    this._userSpeechEndAt = null;
    this._lastRmsSpeechAt = 0;

    if (rawDelta < 10 || rawDelta > 10000) return null;

    const endpointingMs = this._currentEndpointingMs ?? Math.min(rawDelta, 120);
    const aiTurnaroundMs = Math.max(0, rawDelta - endpointingMs);
    this._currentEndpointingMs = null;

    const entry = {
      atMs: ts - this.startedAt,
      userEndAt: endRef,
      aiStartAt: ts,
      responseMs: rawDelta,
      endpointingMs,
      aiTurnaroundMs,
    };
    this.latencyHistory.push(entry);
    if (this.latencyHistory.length > MAX_LATENCY_HISTORY) {
      this.latencyHistory.shift();
    }

    this._broadcastSse('latency_turn', {
      turn: entry,
      stats: this.getStats(),
    });
    return entry;
  }

  pushCallerAudio(pcm8k) {
    if (!pcm8k || pcm8k.length === 0) return;
    const peak = computePeakPct(pcm8k);
    if (peak > this._callerMaxPeak) this._callerMaxPeak = peak;

    // Fallback de detecção RMS caso o bridge não dispare evento speech_stopped explícito
    if (peak >= 8) {
      this._lastRmsSpeechAt = Date.now();
    }

    this._lastCallerChunk = pcm8k;
    this._lastCallerAt = Date.now();
    this._emitAudioFrame('caller', pcm8k);
  }

  pushAgentAudio(pcm8k) {
    if (!pcm8k || pcm8k.length === 0) return;
    const peak = computePeakPct(pcm8k);
    if (peak > this._agentMaxPeak) this._agentMaxPeak = peak;

    if (this._awaitingAiAfterUser) {
      this.markAiFirstAudio(Date.now());
    }

    this._lastAgentChunk = pcm8k;
    this._lastAgentAt = Date.now();
    this._emitAudioFrame('agent', pcm8k);
  }

  _emitAudioFrame(source, pcmBuf) {
    if (this.audioClients.size === 0) return;
    const now = Date.now();
    for (const client of this.audioClients) {
      if (client.res.writableEnded || client.res.destroyed) {
        this.audioClients.delete(client);
        continue;
      }
      client.lastWriteAt = now;
      if (client.channel === 'caller') {
        if (source === 'caller') client.res.write(pcmBuf);
      } else if (client.channel === 'agent') {
        if (source === 'agent') client.res.write(pcmBuf);
      } else {
        // Estéreo intercalado (Left = Cliente, Right = Agente IA)
        const samples = Math.floor(pcmBuf.length / 2);
        const stereo = Buffer.allocUnsafe(samples * 4);
        const peerChunk = source === 'caller'
          ? (now - this._lastAgentAt < 80 ? this._lastAgentChunk : null)
          : (now - this._lastCallerAt < 80 ? this._lastCallerChunk : null);

        for (let i = 0; i < samples; i++) {
          const val = pcmBuf.readInt16LE(i * 2);
          const peerSample = peerChunk && i * 2 + 1 < peerChunk.length ? peerChunk.readInt16LE(i * 2) : 0;
          if (source === 'caller') {
            stereo.writeInt16LE(val, i * 4);
            stereo.writeInt16LE(peerSample, i * 4 + 2);
          } else {
            stereo.writeInt16LE(peerSample, i * 4);
            stereo.writeInt16LE(val, i * 4 + 2);
          }
        }
        client.res.write(stereo);
      }
    }
  }

  _sendAudioKeepalive() {
    if (this.audioClients.size === 0) return;
    const now = Date.now();
    for (const client of this.audioClients) {
      if (client.res.writableEnded || client.res.destroyed) {
        this.audioClients.delete(client);
        continue;
      }
      if (now - (client.lastWriteAt || 0) >= 120) {
        client.lastWriteAt = now;
        client.res.write(client.channel === 'stereo' ? PCM_SILENCE_100MS_STEREO : PCM_SILENCE_100MS_MONO);
      }
    }
  }

  _flushWaveSample() {
    const sample = {
      t: Date.now() - this.startedAt,
      caller: this._callerMaxPeak,
      agent: this._agentMaxPeak,
    };
    this._callerMaxPeak = 0;
    this._agentMaxPeak = 0;

    this.waveHistory.push(sample);
    if (this.waveHistory.length > MAX_WAVE_HISTORY) {
      this.waveHistory.shift();
    }
    this._broadcastSse('wave_sample', sample);
  }

  _broadcastSse(event, data) {
    if (this.sseClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      if (res.writableEnded || res.destroyed) {
        this.sseClients.delete(res);
        continue;
      }
      res.write(payload);
    }
  }

  _sendSseHeartbeat() {
    if (this.sseClients.size === 0) return;
    for (const res of this.sseClients) {
      if (res.writableEnded || res.destroyed) {
        this.sseClients.delete(res);
        continue;
      }
      res.write(': ping\n\n');
    }
  }

  subscribeEvents(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(
      `event: init\ndata: ${JSON.stringify({
        callId: this.callId,
        samples: this.waveHistory,
        latencyHistory: this.latencyHistory,
        stats: this.getStats(),
      })}\n\n`,
    );
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  subscribeAudio(res, channel = 'stereo') {
    const normalized = ['stereo', 'caller', 'agent'].includes(channel) ? channel : 'stereo';
    const channels = normalized === 'stereo' ? 2 : 1;
    res.writeHead(200, {
      'Content-Type': `audio/l16; rate=8000; channels=${channels}`,
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
      'X-Audio-Channel': normalized,
    });
    const client = { res, channel: normalized, lastWriteAt: Date.now() };
    this.audioClients.add(client);
    res.on('close', () => this.audioClients.delete(client));
  }

  getStats() {
    const vals = this.latencyHistory.map((h) => h.responseMs);
    if (vals.length === 0) {
      return {
        lastMs: null,
        avgMs: null,
        p50Ms: null,
        maxMs: null,
        turnsCount: 0,
        history: [],
      };
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const sum = vals.reduce((acc, v) => acc + v, 0);
    return {
      lastMs: vals[vals.length - 1],
      avgMs: Math.round(sum / vals.length),
      p50Ms: sorted[Math.floor(sorted.length / 2)],
      maxMs: sorted[sorted.length - 1],
      turnsCount: vals.length,
      history: this.latencyHistory.slice(-30),
    };
  }

  stop() {
    clearInterval(this._waveTimer);
    clearInterval(this._pingTimer);
    clearInterval(this._keepaliveTimer);
    for (const res of this.sseClients) {
      try { res.end(); } catch {}
    }
    for (const c of this.audioClients) {
      try { c.res.end(); } catch {}
    }
    this.sseClients.clear();
    this.audioClients.clear();
  }
}

module.exports = { LiveMonitor, computePeakPct };
