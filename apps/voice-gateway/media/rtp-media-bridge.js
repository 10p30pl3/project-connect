const dgram = require('dgram');

class RtpMediaBridge {
  constructor() {
    this.rx = null;
    this.tx = null;
    this.remote = null;
    this.callId = null;
    this.onAudio = null;
    this.localPort = 40000 + Math.floor(Math.random() * 1000);
  }

  async start({ callId, endpoint, onAudio }) {
    this.callId = callId;
    this.onAudio = onAudio;

    this.rx = dgram.createSocket('udp4');
    this.tx = dgram.createSocket('udp4');

    this.rx.on('message', (msg /* Buffer */) => {
      // Em um bridge RTP real você precisa:
      // 1) remover cabeçalho RTP
      // 2) extrair payload G.711 u-law
      // 3) mandar base64 do payload para a OpenAI
      const payload = extractRtpPayload(msg);
      if (payload) this.onAudio(payload.toString('base64'));
    });

    await new Promise((resolve) => this.rx.bind(this.localPort, '0.0.0.0', resolve));

    console.log(`[${callId}] RTP bridge escutando em udp://0.0.0.0:${this.localPort}`);

    // ponto de integração com o FreeSWITCH:
    // mandar a chamada para um bridge RTP externo/udp.
    // Exemplo conceitual; depende do mecanismo usado no FreeSWITCH.
    // await endpoint.api('uuid_external_media', `${callId} start 127.0.0.1 ${this.localPort} pcmu`);

    // Você também precisa descobrir para onde enviar o áudio de volta.
    // Isso normalmente vem da própria negociação/bridge RTP.
    this.remote = { host: '127.0.0.1', port: 50000 }; // placeholder
  }

  async play(base64Audio) {
    if (!this.remote) return;
    const payload = Buffer.from(base64Audio, 'base64');
    const packet = buildRtpPacket(payload);
    this.tx.send(packet, this.remote.port, this.remote.host);
  }

  async stop() {
    try { this.rx && this.rx.close(); } catch {}
    try { this.tx && this.tx.close(); } catch {}
    this.rx = null;
    this.tx = null;
  }
}

function extractRtpPayload(packet) {
  if (!packet || packet.length < 12) return null;
  const cc = packet[0] & 0x0f;
  const headerLen = 12 + cc * 4;
  if (packet.length <= headerLen) return null;
  return packet.subarray(headerLen);
}

let seq = 0;
let ts = 0;
const ssrc = Math.floor(Math.random() * 0xffffffff);

function buildRtpPacket(payload) {
  const buf = Buffer.alloc(12 + payload.length);
  buf[0] = 0x80;
  buf[1] = 0x00; // PT placeholder; ajuste para PCMU se necessário
  buf.writeUInt16BE(seq++ & 0xffff, 2);
  buf.writeUInt32BE(ts >>> 0, 4);
  buf.writeUInt32BE(ssrc >>> 0, 8);
  payload.copy(buf, 12);
  ts += 160; // 20ms @ 8kHz para G.711
  return buf;
}

module.exports = RtpMediaBridge;
