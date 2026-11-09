const fs = require('fs');
const path = require('path');

/**
 * Formata Data/Hora local no padrão YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Gravador Estéreo Dual-Stream + Transcrição Dialogada (Cliente / Atendente)
 * - Ativado quando a Transcrição (STT) está habilitada na chamada.
 * - Áudio WAV 8kHz, 16-bit PCM, 2 Canais:
 *   - Canal Esquerdo (Left  / Canal 0): Voz do Cliente (RX do FreeSWITCH)
 *   - Canal Direito  (Right / Canal 1): Voz do Atendente IA (TX da OpenAI Realtime)
 * - Arquivo de Transcrição (.txt) sincronizado com Data/Hora e separação "Cliente:" / "Atendente:"
 * - Sincronizado com Barge-in (clearAiBuffer descarta o áudio da IA interrompido pelo usuário)
 * - Zero bloqueio do Event Loop (usa fs.WriteStream + libuv threadpool) e 100% Fail-Open
 */
class CallRecorder {
  constructor({ callId, tenantId = 'default', recordingDir = null, sampleRate = 8000, silent = false }) {
    this.callId = callId || 'unknown';
    this.tenantId = tenantId || 'default';
    this.sampleRate = sampleRate;
    this.silent = silent;
    this.numChannels = 2; // Estéreo: L=Cliente, R=Atendente
    this.bitsPerSample = 16;

    const defaultDir = path.join(__dirname, '..', 'recordings');
    this.recordingDir = recordingDir || process.env.RECORDING_DIR || defaultDir;

    const safeCallId = String(this.callId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeTenant = String(this.tenantId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const now = new Date();
    const datePrefix = formatDateTime(now).replace(' ', '_').replace(/:/g, '-');
    this.baseName = `${datePrefix}_${safeTenant}_${safeCallId}`;
    this.fileName = `${this.baseName}.wav`;
    this.filePath = path.join(this.recordingDir, this.fileName);
    this.transcriptFileName = `${this.baseName}.txt`;
    this.transcriptPath = path.join(this.recordingDir, this.transcriptFileName);

    this.writeStream = null;
    this.transcriptStream = null;
    this.isStarted = false;
    this.isPaused = false;
    this.isStopped = false;
    this.failed = false;
    this.dataBytesWritten = 0;

    // Histórico estruturado de transcrição da chamada
    this.transcriptEntries = [];

    // Fila circular em memória para alinhar os bursts de áudio da IA ao relógio de 20ms do RTP
    this.aiQueue = [];
    this.aiQueueOffset = 0;
    this.aiBytesAvailable = 0;
    this.maxAiBufferBytes = this.sampleRate * 2 * 30; // Limite de segurança: máx 30s de áudio na fila
  }

  /**
   * Constrói o cabeçalho binário RIFF/WAVE de 44 bytes para PCM 16-bit Estéreo
   */
  static buildWavHeader(dataByteLength, sampleRate = 8000, numChannels = 2, bitsPerSample = 16) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataByteLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 para PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = Linear PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataByteLength, 40);

    return header;
  }

  async start() {
    if (this.isStarted || this.isStopped || this.failed) return;
    try {
      await fs.promises.mkdir(this.recordingDir, { recursive: true });
      if (this.isStopped) return;

      this.writeStream = fs.createWriteStream(this.filePath, { flags: 'w' });
      this.writeStream.on('error', (err) => {
        console.warn(`[${this.callId}] [CallRecorder] ⚠️ Erro de escrita WAV em disco (Fail-Open):`, err.message);
        this.failed = true;
      });

      this.transcriptStream = fs.createWriteStream(this.transcriptPath, { flags: 'a', encoding: 'utf8' });
      this.transcriptStream.on('error', (err) => {
        console.warn(`[${this.callId}] [CallRecorder] ⚠️ Erro de escrita TXT em disco (Fail-Open):`, err.message);
      });

      // Escreve cabeçalho WAV provisório (44 bytes) que será atualizado no stop()
      const initialHeader = CallRecorder.buildWavHeader(0, this.sampleRate, this.numChannels, this.bitsPerSample);
      this.writeStream.write(initialHeader);
      this.isStarted = true;

      // Drena eventuais linhas de transcrição registradas antes do stream abrir
      if (this.transcriptEntries.length > 0 && this.transcriptStream) {
        for (const item of this.transcriptEntries) {
          this.transcriptStream.write(`${item.formatted}\n`);
        }
      }

      if (!this.silent) {
        console.log(`[${this.callId}] 🎙️ Gravação Estéreo + Transcrição iniciadas: ${this.filePath}`);
      }
    } catch (err) {
      console.warn(`[${this.callId}] [CallRecorder] ⚠️ Não foi possível iniciar gravação (Fail-Open):`, err.message);
      this.failed = true;
    }
  }

  /**
   * Registra uma fala na transcrição dialogada dividindo "Cliente:" e "Atendente:" com Data e Hora
   * @param {'Cliente'|'Atendente'} speaker Papel do interlocutor ('Cliente' ou 'Atendente')
   * @param {string} text Conteúdo transcrito
   * @param {Date} [date] Data/hora opcional (padrão: agora)
   * @param {Object} [extra] Metadados opcionais como delayMs e delayLabel
   */
  addTranscript(speaker, text, date = new Date(), extra = {}) {
    if (this.isStopped || this.isPaused) return null;
    const cleanText = String(text || '').trim();
    if (!cleanText) return null;

    const role = speaker === 'Atendente' ? 'Atendente' : 'Cliente';
    const timestamp = formatDateTime(date);
    const formatted = `[${timestamp}] ${role}: ${cleanText}`;

    const nowMs = date.getTime();
    let delayMs = extra.delayMs !== undefined ? extra.delayMs : null;
    let delayLabel = extra.delayLabel || null;

    if (role === 'Cliente') {
      this.lastClientTime = nowMs;
    } else {
      if (delayMs === null && this.lastClientTime) {
        delayMs = Math.max(0, nowMs - this.lastClientTime);
        this.lastClientTime = null;
      }
      if (!delayLabel) {
        if (delayMs !== null) {
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
      }
      this.hasHadClientTurn = true;
    }

    const entry = {
      timestamp,
      speaker: role,
      text: cleanText,
      delayMs,
      delayLabel,
      formatted
    };

    this.transcriptEntries.push(entry);
    if (!this.silent) {
      console.log(`[${this.callId}] 📝 ${formatted}${delayLabel ? ` [${delayLabel}]` : ''}`);
    }

    if (this.isStarted && this.transcriptStream && !this.transcriptStream.writableEnded) {
      try {
        this.transcriptStream.write(`${formatted}\n`);
      } catch {}
    }

    return entry;
  }

  /**
   * Retorna todas as linhas formatadas da transcrição
   */
  getFormattedTranscript() {
    return this.transcriptEntries.map((e) => e.formatted).join('\n');
  }

  /**
   * Enfileira áudio gerado pelo Atendente IA (Canal Direito - R)
   * @param {Buffer} pcm8kBuffer Buffer PCM 16-bit 8kHz mono
   */
  pushAiChunk(pcm8kBuffer) {
    if (!this.isStarted || this.isPaused || this.isStopped || this.failed || !pcm8kBuffer || pcm8kBuffer.length < 2) return;
    const evenLen = pcm8kBuffer.length & ~1;
    if (evenLen <= 0) return;
    if (this.aiBytesAvailable + evenLen > this.maxAiBufferBytes) return;

    const chunk = evenLen === pcm8kBuffer.length ? pcm8kBuffer : pcm8kBuffer.subarray(0, evenLen);
    this.aiQueue.push(chunk);
    this.aiBytesAvailable += chunk.length;
  }

  /**
   * Descarta imediatamente o áudio residual da IA que ainda não foi tocado (acionado no Barge-in / killAudio)
   */
  clearAiBuffer() {
    this.aiQueue = [];
    this.aiQueueOffset = 0;
    this.aiBytesAvailable = 0;
  }

  pause() {
    this.isPaused = true;
    this.clearAiBuffer();
  }

  resume() {
    this.isPaused = false;
  }

  /**
   * Extrai 1 amostra Int16LE da fila da IA ou retorna 0 (silêncio) se a fila estiver vazia
   */
  _popAiSample() {
    if (this.aiBytesAvailable < 2 || this.aiQueue.length === 0) {
      return 0;
    }
    const head = this.aiQueue[0];
    const sample = head.readInt16LE(this.aiQueueOffset);
    this.aiQueueOffset += 2;
    this.aiBytesAvailable -= 2;

    if (this.aiQueueOffset >= head.length) {
      this.aiQueue.shift();
      this.aiQueueOffset = 0;
    }
    return sample;
  }

  /**
   * Recebe o frame de 20ms do microfone do Cliente (Canal Esquerdo - L),
   * entrelaça com o Canal Direito (Atendente IA) e grava no stream WAV estéreo.
   * @param {Buffer} userPcm8kBuffer Buffer PCM 16-bit 8kHz mono
   */
  writeUserChunk(userPcm8kBuffer) {
    if (!this.isStarted || this.isPaused || this.isStopped || this.failed || !this.writeStream) return;
    if (!userPcm8kBuffer || userPcm8kBuffer.length < 2) return;

    try {
      const samplesCount = userPcm8kBuffer.length >> 1;
      if (samplesCount === 0) return;

      const stereoBuffer = Buffer.allocUnsafe(samplesCount * 4);
      for (let i = 0; i < samplesCount; i++) {
        const leftUserSample = userPcm8kBuffer.readInt16LE(i * 2);
        const rightAiSample = this._popAiSample();
        const pos = i * 4;
        stereoBuffer.writeInt16LE(leftUserSample, pos);
        stereoBuffer.writeInt16LE(rightAiSample, pos + 2);
      }

      this.dataBytesWritten += stereoBuffer.length;
      this.writeStream.write(stereoBuffer);
    } catch (err) {
      this.failed = true;
    }
  }

  /**
   * Finaliza os streams (.wav e .txt) e atualiza os tamanhos de cabeçalho RIFF/WAVE
   */
  async stop() {
    if (this.isStopped) return;
    this.isStopped = true;
    this.clearAiBuffer();

    if (this.transcriptStream) {
      await new Promise((resolve) => {
        if (this.transcriptStream.writableEnded || this.transcriptStream.destroyed) {
          return resolve();
        }
        this.transcriptStream.once('finish', resolve);
        this.transcriptStream.once('error', resolve);
        this.transcriptStream.end();
      });
    }

    if (!this.isStarted || !this.writeStream) return;

    try {
      await new Promise((resolve) => {
        if (this.writeStream.writableEnded || this.writeStream.destroyed) {
          return resolve();
        }
        this.writeStream.once('finish', resolve);
        this.writeStream.once('error', resolve);
        this.writeStream.end();
      });

      if (!this.failed && this.dataBytesWritten >= 0) {
        const finalHeader = CallRecorder.buildWavHeader(
          this.dataBytesWritten,
          this.sampleRate,
          this.numChannels,
          this.bitsPerSample
        );
        const fh = await fs.promises.open(this.filePath, 'r+');
        try {
          await fh.write(finalHeader, 0, 44, 0);
        } finally {
          await fh.close();
        }
        if (!this.silent) {
          console.log(
            `[${this.callId}] 💾 Gravação Estéreo (${(this.dataBytesWritten / 1024).toFixed(1)} KB) e Transcrição (${this.transcriptEntries.length} turnos) salvas em: ${this.recordingDir}`
          );
        }
      }
    } catch (err) {
      console.warn(`[${this.callId}] [CallRecorder] ⚠️ Erro ao finalizar cabeçalho WAV:`, err.message);
    }
  }
}

module.exports = CallRecorder;
module.exports.CallRecorder = CallRecorder;
module.exports.formatDateTime = formatDateTime;
