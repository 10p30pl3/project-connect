const { EventEmitter } = require('events');

/**
 * Sintetiza um tom senoidal PCM16 8kHz a partir de uma string tone_stream:// do FreeSWITCH.
 * Ex: "tone_stream://v=-16;%(500,0,425)" ou "tone_stream://v=-10;%(400,200,425);%(400,200,425)"
 */
function synthesizeToneStreamPcm(toneSpec) {
  const str = String(toneSpec || '');
  let db = -16;
  const dbMatch = str.match(/v=(-?\d+(?:\.\d+)?)/i);
  if (dbMatch) {
    db = parseFloat(dbMatch[1]);
  }
  const amp = Math.min(30000, Math.round(32767 * Math.pow(10, db / 20)));

  const segments = [];
  const segRegex = /%\((\d+),(\d+),(\d+)\)/g;
  let match;
  while ((match = segRegex.exec(str)) !== null) {
    segments.push({
      onMs: parseInt(match[1], 10) || 0,
      offMs: parseInt(match[2], 10) || 0,
      freq: parseInt(match[3], 10) || 425
    });
  }

  if (segments.length === 0) {
    segments.push({ onMs: 500, offMs: 0, freq: 425 });
  }

  const sampleRate = 8000;
  const buffers = [];

  for (const seg of segments) {
    const onSamples = Math.round((seg.onMs / 1000) * sampleRate);
    if (onSamples > 0) {
      const buf = Buffer.allocUnsafe(onSamples * 2);
      for (let i = 0; i < onSamples; i++) {
        const val = Math.round(amp * Math.sin((2 * Math.PI * seg.freq * i) / sampleRate));
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, val)), i * 2);
      }
      buffers.push(buf);
    }

    const offSamples = Math.round((seg.offMs / 1000) * sampleRate);
    if (offSamples > 0) {
      buffers.push(Buffer.alloc(offSamples * 2));
    }
  }

  return Buffer.concat(buffers);
}

/**
 * Adaptador de endpoint FreeSWITCH para sessões WebRTC puras no Node.js.
 * Mantém paridade total com OpenAIS2SBridge e ElevenLabsS2SBridge (Sonar, Grace Period, Mute, Hold, Transfer).
 */
class WebRtcEndpointAdapter extends EventEmitter {
  constructor({ uuid, mediaBridge, onTransferRequest, onDestroy } = {}) {
    super();
    this.uuid = uuid || `webrtc-${Date.now()}`;
    this.id = this.uuid;
    this.isWebRtc = true;
    this.mediaBridge = mediaBridge;
    this.onTransferRequest = onTransferRequest || null;
    this.onDestroy = onDestroy || null;
    this.destroyed = false;
    this.conn = null; // Sem ESL FreeSWITCH
  }

  async api(cmd) {
    if (this.destroyed) return { body: '-ERR destroyed' };
    const text = String(cmd || '').trim();

    if (/^uuid_audio\s+\S+\s+start\s+read\s+mute/i.test(text)) {
      this.mediaBridge.setRxMuted(true);
      return { body: '+OK muted' };
    }
    if (/^uuid_audio\s+\S+\s+stop\s+read/i.test(text)) {
      this.mediaBridge.setRxMuted(false);
      return { body: '+OK unmuted' };
    }
    if (/^uuid_hold\s+off/i.test(text)) {
      this.mediaBridge.setHold(false);
      return { body: '+OK unhold' };
    }
    if (/^uuid_hold/i.test(text)) {
      this.mediaBridge.setHold(true);
      return { body: '+OK hold' };
    }
    if (/^uuid_transfer\s+/i.test(text)) {
      const parts = text.split(/\s+/);
      const target = parts[2] || '';
      if (typeof this.onTransferRequest === 'function') {
        await this.onTransferRequest(target, text);
        return { body: '+OK transferring_to_sip' };
      }
      throw new Error('Transferência SIP sob demanda não configurada neste canal');
    }

    return { body: '+OK' };
  }

  async play(spec) {
    if (this.destroyed || !this.mediaBridge) return;
    const str = String(spec || '');
    if (str.startsWith('tone_stream://')) {
      const pcm = synthesizeToneStreamPcm(str);
      if (pcm.length > 0) {
        this.mediaBridge.pushAudioChunk(pcm);
        this.mediaBridge.markStreamEnd();
      }
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      if (typeof this.onDestroy === 'function') this.onDestroy();
    } catch {}
    try {
      this.mediaBridge?.stop();
    } catch {}
    this.emit('destroy');
  }
}

module.exports = { WebRtcEndpointAdapter, synthesizeToneStreamPcm };
