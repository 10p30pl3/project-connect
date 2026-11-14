const { EventEmitter } = require('events');
const crypto = require('crypto');
const {
  RTCPeerConnection,
  MediaStreamTrack,
  RTCRtpCodecParameters,
  RtpHeader,
  RtpPacket
} = require('werift');
const OpusScript = require('opusscript');

const FRAME_BYTES_8K = 320; // 20ms @ 8kHz 16-bit mono (160 samples)
const FRAME_SAMPLES_8K = 160;
const FRAME_SAMPLES_48K = 960; // 20ms @ 48kHz
const FRAME_MS = 20;

function parseIceServers() {
  if (process.env.WEBRTC_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.WEBRTC_ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

/**
 * Converte PCM16 48kHz (960 samples) para PCM16 8kHz (160 samples) com média anti-aliasing 6:1.
 */
function downsample48kTo8k(pcm48k) {
  const inSamples = Math.floor(pcm48k.length / 2);
  const outSamples = Math.floor(inSamples / 6);
  const out = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const base = i * 6;
    let sum = 0;
    for (let j = 0; j < 6; j++) {
      sum += pcm48k.readInt16LE((base + j) * 2);
    }
    const avg = Math.max(-32768, Math.min(32767, Math.round(sum / 6)));
    out.writeInt16LE(avg, i * 2);
  }
  return out;
}

/**
 * Converte PCM16 8kHz (160 samples) para PCM16 48kHz (960 samples) com interpolação linear.
 */
function upsample8kTo48k(pcm8k, prevSample = 0) {
  const inSamples = Math.floor(pcm8k.length / 2);
  const out = Buffer.allocUnsafe(inSamples * 6 * 2);
  let last = prevSample;
  for (let i = 0; i < inSamples; i++) {
    const curr = pcm8k.readInt16LE(i * 2);
    const diff = curr - last;
    for (let j = 0; j < 6; j++) {
      const val = Math.max(-32768, Math.min(32767, Math.round(last + (diff * (j + 1)) / 6)));
      out.writeInt16LE(val, (i * 6 + j) * 2);
    }
    last = curr;
  }
  return { buffer: out, lastSample: last };
}

class WebRtcMediaBridge extends EventEmitter {
  constructor({ iceServers } = {}) {
    super();
    this.callId = null;
    this.channelUuid = null;
    this.endpoint = null;
    this.onAudio = null;
    this.recorder = null;
    this.stopped = false;
    this.rxMuted = false;
    this.isHold = false;
    this.isPlaying = false;
    this.streamEnding = false;
    this.playbackChunkCount = 0;

    // Ponte SIP sob demanda (handoff WebRTC -> FreeSWITCH)
    this.sipPeerBridge = null;

    this.iceServers = iceServers || parseIceServers();
    this.opusEncoder = new OpusScript(48000, 1, OpusScript.Application.VOIP);
    this.opusDecoder = new OpusScript(48000, 1, OpusScript.Application.VOIP);

    this.txTrack = new MediaStreamTrack({ kind: 'audio' });
    this.txSsrc = crypto.randomBytes(4).readUInt32BE(0) || 0x12345678;
    this.txSeq = Math.floor(Math.random() * 65535);
    this.txTimestamp = Math.floor(Math.random() * 0xffffffff);
    this.txPayloadType = 111;
    this.lastUpsampleSample = 0;

    this.txQueue = [];
    this.txRemainder = Buffer.alloc(0);
    this.txPacerTimer = null;
    this.txPacerStartTime = 0;
    this.txFramesSent = 0;

    this.dataChannel = null;

    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      codecs: {
        audio: [
          new RTCRtpCodecParameters({
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            payloadType: 111
          })
        ]
      }
    });

    this.transceiver = this.pc.addTransceiver(this.txTrack, { direction: 'sendrecv' });
    this._setupPeerEvents();
  }

  _setupPeerEvents() {
    this.pc.ondatachannel = (ev) => {
      const dc = ev.channel || ev;
      if (!dc) return;
      this.dataChannel = dc;
      dc.onopen = () => {
        this.sendEvent({ type: 'ready', callId: this.callId, channel: 'webrtc' });
      };
      dc.onmessage = (msgEv) => {
        try {
          const raw = typeof msgEv.data === 'string' ? msgEv.data : msgEv.data?.toString('utf8');
          if (!raw) return;
          const payload = JSON.parse(raw);
          this.emit('client_event', payload);
        } catch {}
      };
    };

    const attachRxTrack = (track) => {
      if (!track || track.kind !== 'audio') return;
      track.onReceiveRtp.subscribe((rtp) => {
        if (this.stopped || !rtp?.payload || rtp.payload.length === 0) return;
        try {
          const decoded = this.opusDecoder.decode(rtp.payload);
          if (!decoded || decoded.length === 0) return;
          const pcm8k = downsample48kTo8k(Buffer.from(decoded));
          if (pcm8k.length === 0) return;

          if (this.sipPeerBridge) {
            if (!this.rxMuted && !this.isHold) {
              this.sipPeerBridge.pushAudioChunk(pcm8k);
              if (this.recorder) this.recorder.writeUserChunk(pcm8k);
            }
            return;
          }

          if (this.rxMuted || this.isHold) return;
          if (this.onAudio) this.onAudio(pcm8k);
        } catch {
          // Ignora pacotes Opus corrompidos ou DTX/CN
        }
      });
    };

    if (this.transceiver?.receiver?.track) {
      attachRxTrack(this.transceiver.receiver.track);
    }
    this.pc.ontrack = (ev) => {
      if (ev?.track) attachRxTrack(ev.track);
    };

    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      if (st === 'closed' || st === 'failed') {
        this.emit('disconnected', st);
      }
    };
  }

  async handleOffer(sdpOffer) {
    if (this.stopped) throw new Error('WebRtcMediaBridge já encerrado');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Aguarda coleta inicial de candidatos ICE (máximo 1500ms para manter handshake rápido)
    if (this.pc.iceGatheringState !== 'complete') {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 1500);
        this.pc.onicegatheringstatechange = () => {
          if (this.pc.iceGatheringState === 'complete') finish();
        };
      });
    }

    // Atualiza payloadType negociado se disponível
    const codecs = this.transceiver?.codecs || [];
    const opusCodec = codecs.find((c) => /opus/i.test(c.mimeType || ''));
    if (opusCodec?.payloadType) {
      this.txPayloadType = opusCodec.payloadType;
    }

    return {
      type: this.pc.localDescription.type,
      sdp: this.pc.localDescription.sdp,
      iceServers: this.iceServers
    };
  }

  async addIceCandidate(candidate) {
    if (this.stopped || !candidate) return;
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {}
  }

  setRecorder(recorder) {
    this.recorder = recorder;
  }

  setRxMuted(muted) {
    this.rxMuted = Boolean(muted);
  }

  setHold(hold) {
    this.isHold = Boolean(hold);
    if (this.isHold) this.killAudio();
    this.sendEvent({ type: 'hold', active: this.isHold });
  }

  /**
   * Conecta este canal WebRTC a uma ponte WsMediaBridge (FreeSWITCH) para transferência transparente.
   */
  attachSipPeer(wsMediaBridge) {
    this.sipPeerBridge = wsMediaBridge;
    this.killAudio();
    this.sendEvent({ type: 'transferred_to_sip', active: true });
  }

  sendEvent(payload) {
    if (this.stopped || !this.dataChannel || this.dataChannel.readyState !== 'open') return;
    try {
      this.dataChannel.send(JSON.stringify(payload));
    } catch {}
  }

  async start({ callId, endpoint, onAudio }) {
    this.callId = callId;
    this.onAudio = onAudio;
    this.endpoint = endpoint || null;
    this.channelUuid = endpoint?.uuid || callId || `webrtc-${Date.now()}`;
  }

  startTxPacer() {
    if (this.txPacerTimer || this.stopped) return;
    this.txPacerStartTime = Date.now();
    this.txFramesSent = 0;

    this.txPacerTimer = setInterval(() => {
      if (this.stopped) {
        this.stopTxPacer(true);
        return;
      }

      const now = Date.now();
      const targetFrames = Math.floor((now - this.txPacerStartTime) / FRAME_MS) + 1;
      const maxBurst = 3;
      let sentThisTick = 0;

      while (this.txFramesSent < targetFrames && sentThisTick < maxBurst) {
        if (this.txQueue.length === 0) break;
        const frame = this.txQueue.shift();

        try {
          const { buffer: pcm48k, lastSample } = upsample8kTo48k(frame, this.lastUpsampleSample);
          this.lastUpsampleSample = lastSample;
          const encoded = this.opusEncoder.encode(pcm48k, FRAME_SAMPLES_48K);

          this.txSeq = (this.txSeq + 1) & 0xffff;
          this.txTimestamp = (this.txTimestamp + FRAME_SAMPLES_48K) >>> 0;

          const header = new RtpHeader({
            payloadType: this.txPayloadType,
            sequenceNumber: this.txSeq,
            timestamp: this.txTimestamp,
            ssrc: this.txSsrc,
            marker: this.txFramesSent === 0
          });
          const pkt = new RtpPacket(header, Buffer.from(encoded));
          this.txTrack.writeRtp(pkt);

          if (this.recorder && typeof this.recorder.pushAiChunk === 'function') {
            this.recorder.pushAiChunk(frame);
          }
        } catch {}

        this.txFramesSent += 1;
        this.playbackChunkCount += 1;
        sentThisTick += 1;
      }

      if (this.txQueue.length === 0 && this.streamEnding) {
        this.stopTxPacer(true);
        this.isPlaying = false;
        this.streamEnding = false;
        this.emit('playback_ended');
      } else if (targetFrames > this.txFramesSent + 10) {
        this.txPacerStartTime = now - Math.max(0, this.txFramesSent - 1) * FRAME_MS;
      }
    }, FRAME_MS);
  }

  stopTxPacer(clearQueue = false) {
    if (this.txPacerTimer) {
      clearInterval(this.txPacerTimer);
      this.txPacerTimer = null;
    }
    if (clearQueue) {
      this.txQueue = [];
      this.txRemainder = Buffer.alloc(0);
    }
  }

  startPlaybackStream() {
    this.isPlaying = true;
    this.streamEnding = false;
    this.playbackChunkCount = 0;
  }

  pushAudioChunk(pcm8kBuffer) {
    if (this.stopped || this.isHold || !pcm8kBuffer || pcm8kBuffer.length === 0) return;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.playbackChunkCount = 0;
    }
    this.streamEnding = false;

    const combined = this.txRemainder.length > 0
      ? Buffer.concat([this.txRemainder, pcm8kBuffer])
      : pcm8kBuffer;

    let offset = 0;
    while (offset + FRAME_BYTES_8K <= combined.length) {
      this.txQueue.push(combined.subarray(offset, offset + FRAME_BYTES_8K));
      offset += FRAME_BYTES_8K;
    }
    this.txRemainder = offset < combined.length ? Buffer.from(combined.subarray(offset)) : Buffer.alloc(0);

    this.startTxPacer();
  }

  markStreamEnd() {
    this.streamEnding = true;
    if (this.txRemainder.length > 0) {
      const padded = Buffer.alloc(FRAME_BYTES_8K);
      this.txRemainder.copy(padded);
      this.txQueue.push(padded);
      this.txRemainder = Buffer.alloc(0);
    }
    if (this.txQueue.length === 0) {
      this.stopTxPacer(true);
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
    if (this.recorder && typeof this.recorder.clearAiBuffer === 'function') {
      this.recorder.clearAiBuffer();
    }
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopTxPacer(true);
    try {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.close();
      }
    } catch {}
    try {
      await this.pc.close();
    } catch {}
    try {
      if (typeof this.opusEncoder?.delete === 'function') this.opusEncoder.delete();
      if (typeof this.opusDecoder?.delete === 'function') this.opusDecoder.delete();
    } catch {}
    this.emit('closed');
  }
}

module.exports = WebRtcMediaBridge;
