/**
 * Utilitários de Processamento Digital de Sinais (DSP) e Codecs de Áudio
 * Suporta conversões entre PCM 8kHz, 16kHz, 24kHz e G.711 u-law (PCMU)
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

function upsample8to24(buffer8k) {
  const samplesCount = buffer8k.length >> 1;
  if (samplesCount === 0) return Buffer.alloc(0);
  const buffer24k = Buffer.allocUnsafe(samplesCount * 6);

  for (let i = 0; i < samplesCount; i++) {
    const s0 = buffer8k.readInt16LE(i * 2);
    const s1 = i + 1 < samplesCount ? buffer8k.readInt16LE((i + 1) * 2) : s0;

    const diff = s1 - s0;
    const pos = i * 6;
    buffer24k.writeInt16LE(s0, pos);
    buffer24k.writeInt16LE((s0 + diff * 0.3333) | 0, pos + 2);
    buffer24k.writeInt16LE((s0 + diff * 0.6667) | 0, pos + 4);
  }
  return buffer24k;
}

function downsample24to8(buffer24k) {
  const samplesCount = buffer24k.length >> 1;
  const targetSamplesCount = (samplesCount / 3) | 0;
  if (targetSamplesCount === 0) return Buffer.alloc(0);
  const buffer8k = Buffer.allocUnsafe(targetSamplesCount * 2);

  const getSample = (idx) => {
    if (idx < 0) idx = 0;
    else if (idx >= samplesCount) idx = samplesCount - 1;
    return buffer24k.readInt16LE(idx * 2);
  };

  for (let i = 0; i < targetSamplesCount; i++) {
    const center = i * 3;
    const s_m3 = getSample(center - 3);
    const s_m2 = getSample(center - 2);
    const s_m1 = getSample(center - 1);
    const s_0  = getSample(center);
    const s_p1 = getSample(center + 1);
    const s_p2 = getSample(center + 2);
    const s_p3 = getSample(center + 3);

    const acc = -500 * (s_m3 + s_p3) + 1200 * (s_m2 + s_p2) + 6500 * (s_m1 + s_p1) + 18368 * s_0;
    let out = (acc >> 15) | 0;
    if (out > 32767) out = 32767;
    else if (out < -32768) out = -32768;

    buffer8k.writeInt16LE(out, i * 2);
  }
  return buffer8k;
}

function linear16ToMulaw(pcm16Buffer) {
  const samples = pcm16Buffer.length >> 1;
  const mulaw = Buffer.allocUnsafe(samples);
  const BIAS = 0x84;
  const CLIP = 32635;

  for (let i = 0; i < samples; i++) {
    let sample = pcm16Buffer.readInt16LE(i * 2);
    const sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;

    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return mulaw;
}

let mulawDecodeTable = null;
function mulawToLinear16(mulawBuffer) {
  if (!mulawDecodeTable) {
    mulawDecodeTable = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
      const u = ~i;
      let t = ((u & 0x0f) << 3) + 0x84;
      t <<= (u & 0x70) >> 4;
      mulawDecodeTable[i] = (u & 0x80) ? (0x84 - t) : (t - 0x84);
    }
  }
  const len = mulawBuffer.length;
  const pcm16 = Buffer.allocUnsafe(len * 2);
  for (let i = 0; i < len; i++) {
    pcm16.writeInt16LE(mulawDecodeTable[mulawBuffer[i]], i * 2);
  }
  return pcm16;
}

module.exports = {
  upsample8to16,
  upsample8to24,
  downsample24to8,
  linear16ToMulaw,
  mulawToLinear16
};
