#!/usr/bin/env node
/**
 * Teste e Simulador de Softphone SIP Local (Voll Connect)
 * Valida o registro e tráfego SIP de ramais (1000 a 1010) com o FreeSWITCH (porta 5080)
 */

const dgram = require('dgram');
const crypto = require('crypto');

const SERVER_IP = process.env.FREESWITCH_HOST || '192.168.15.36';
const SERVER_PORT = parseInt(process.env.FREESWITCH_PORT || '5080', 10);
const DEFAULT_PASS = '1234';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function calculateDigest(username, realm, password, uri, nonce, nc = '00000001', cnonce = 'xyz', qop = 'auth') {
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`REGISTER:${uri}`);
  if (qop) {
    return md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  }
  return md5(`${ha1}:${nonce}:${ha2}`);
}

class TestSipPhone {
  constructor({ extension = '1000', password = DEFAULT_PASS, localPort = 5098, serverIp = SERVER_IP, serverPort = SERVER_PORT }) {
    this.extension = String(extension);
    this.password = String(password);
    this.localPort = localPort;
    this.serverIp = serverIp;
    this.serverPort = serverPort;
    this.realm = serverIp;
    this.cseq = 1;
    this.callId = `reg-${Date.now()}-${Math.random()}@${serverIp}`;
    this.fromTag = Math.random().toString(36).substring(2, 10);
    this.socket = null;
    this.isRegistered = false;
    this.onRegistered = null;
    this.onIncomingCall = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('error', (err) => {
        console.error(`[Ramal ${this.extension}] Erro de Socket:`, err.message);
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg.toString(), rinfo);
      });

      this.socket.bind(this.localPort, '0.0.0.0', () => {
        this.sendRegister();
        // Timeout de registro em 6 segundos
        const timer = setTimeout(() => {
          if (!this.isRegistered) {
            reject(new Error(`Timeout aguardando registro do ramal ${this.extension}`));
          }
        }, 6000);

        this.onRegistered = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
    });
  }

  sendRegister(authHeader = null) {
    let msg = `REGISTER sip:${this.realm}:${this.serverPort} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.realm}:${this.localPort};branch=z9hG4bK-${Date.now()}-${this.cseq};rport\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: <sip:${this.extension}@${this.realm}>;tag=${this.fromTag}\r\n`;
    msg += `To: <sip:${this.extension}@${this.realm}>\r\n`;
    msg += `Call-ID: ${this.callId}\r\n`;
    msg += `CSeq: ${this.cseq++} REGISTER\r\n`;
    msg += `Contact: <sip:${this.extension}@${this.realm}:${this.localPort};transport=udp>\r\n`;
    msg += `Expires: 300\r\n`;
    msg += `User-Agent: VollConnect-SimSoftphone/1.0\r\n`;
    if (authHeader) {
      msg += `Authorization: ${authHeader}\r\n`;
    }
    msg += `Content-Length: 0\r\n\r\n`;

    this.socket.send(Buffer.from(msg), this.serverPort, this.serverIp);
  }

  handleMessage(text, rinfo) {
    if (text.includes('401 Unauthorized')) {
      const authMatch = text.match(/WWW-Authenticate:\s*Digest\s+(.+)/i);
      if (authMatch) {
        const params = {};
        authMatch[1].replace(/(\w+)="?([^",]+)"?/g, (_, k, v) => { params[k] = v; });
        const nonce = params.nonce;
        const respRealm = params.realm || this.realm;
        const uri = `sip:${respRealm}:${this.serverPort}`;
        const qop = params.qop;
        const cnonce = '0a4f113b';
        const nc = '00000001';
        const response = calculateDigest(this.extension, respRealm, this.password, uri, nonce, nc, cnonce, qop);

        let authHeader = `Digest username="${this.extension}", realm="${respRealm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
        if (qop) {
          authHeader += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
        }
        this.sendRegister(authHeader);
      }
    } else if (text.includes('200 OK') && text.includes('CSeq:') && text.includes('REGISTER')) {
      this.isRegistered = true;
      if (typeof this.onRegistered === 'function') {
        this.onRegistered();
      }
    } else if (text.startsWith('INVITE ')) {
      // Chamada recebida! Responde 180 Ringing e depois 200 OK
      this.handleIncomingInvite(text);
    }
  }

  handleIncomingInvite(text) {
    const viaMatch = text.match(/Via:\s*([^\r\n]+)/i);
    const fromMatch = text.match(/From:\s*([^\r\n]+)/i);
    const toMatch = text.match(/To:\s*([^\r\n]+)/i);
    const callIdMatch = text.match(/Call-ID:\s*([^\r\n]+)/i);
    const cseqMatch = text.match(/CSeq:\s*([^\r\n]+)/i);

    const via = viaMatch ? viaMatch[1] : '';
    const from = fromMatch ? fromMatch[1] : '';
    const to = toMatch ? toMatch[1] : '';
    const callId = callIdMatch ? callIdMatch[1] : '';
    const cseq = cseqMatch ? cseqMatch[1] : '';

    console.log(`[Ramal ${this.extension}] 🔔 Recebeu chamada! De: ${from}`);

    // Envia 180 Ringing
    let ringing = `SIP/2.0 180 Ringing\r\n`;
    ringing += `Via: ${via}\r\n`;
    ringing += `From: ${from}\r\n`;
    ringing += `To: ${to};tag=${Math.random().toString(36).substring(2, 10)}\r\n`;
    ringing += `Call-ID: ${callId}\r\n`;
    ringing += `CSeq: ${cseq}\r\n`;
    ringing += `Content-Length: 0\r\n\r\n`;

    this.socket.send(Buffer.from(ringing), this.serverPort, this.serverIp);

    if (typeof this.onIncomingCall === 'function') {
      this.onIncomingCall({ from, to, callId });
    }
  }

  stop() {
    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
      this.socket = null;
    }
  }
}

async function runExtensionSelfTest() {
  console.log('====================================================');
  console.log('🧪 TESTE DE FUNCIONAMENTO DOS RAMAIS SIP (1000 a 1010)');
  console.log('====================================================');
  console.log(`Servidor FreeSWITCH: ${SERVER_IP}:${SERVER_PORT}\n`);

  const results = [];

  // Testa registro de amostra de ramais: 1000, 1001, 1005, 1010
  const sampleExts = ['1000', '1001', '1005', '1010'];

  for (let i = 0; i < sampleExts.length; i++) {
    const ext = sampleExts[i];
    const port = 5120 + i;
    const phone = new TestSipPhone({ extension: ext, localPort: port });

    process.stdout.write(`1. Testando registro do Ramal ${ext} na porta UDP ${port}... `);
    try {
      await phone.start();
      console.log('✅ REGISTRADO COM SUCESSO (200 OK)');
      results.push({ ext, ok: true });
    } catch (err) {
      console.log(`❌ FALHA: ${err.message}`);
      results.push({ ext, ok: false, error: err.message });
    } finally {
      phone.stop();
    }
  }

  console.log('\n----------------------------------------------------');
  console.log('📊 RESUMO DO TESTE DE RAMAIS SIP:');
  const passed = results.filter(r => r.ok).length;
  console.log(`Aprovados: ${passed}/${results.length}`);
  if (passed === results.length) {
    console.log('🎉 TODOS OS RAMAIS TESTADOS REGISTRARAM COM SUCESSO NO FREESWITCH!');
  }
  console.log('====================================================\n');
}

if (require.main === module) {
  runExtensionSelfTest().catch(console.error);
}

module.exports = { TestSipPhone, runExtensionSelfTest };
