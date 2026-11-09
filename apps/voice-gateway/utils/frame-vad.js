/**
 * VAD de energia leve, por frame (PCM16 LE), usado como detector de "fala ativa" local
 * quando o gate DSP (CrosstalkFilter) não está em uso (modos 'wespeaker', 'ecapa' e 'none').
 *
 * Sem ele, qualquer frame de silêncio do FreeSWITCH seria tratado como voz do cliente e
 * cortaria o agente (barge-in falso) logo após a carência inicial.
 */
class FrameVad {
  /**
   * @param {object} [opts]
   * @param {number} [opts.minRms=800]        RMS mínimo (escala Int16) para considerar fala (calibrado telefonia)
   * @param {number} [opts.noiseRatio=2.8]    Fala = RMS > pisoDeRuído * noiseRatio
   * @param {number} [opts.attackFrames=8]    Frames consecutivos acima do limiar (8 x 20ms = 160ms de sustentação)
   * @param {number} [opts.releaseFrames=5]   Frames abaixo do limiar para encerrar a fala (100ms)
   */
  constructor({ minRms = 800, noiseRatio = 2.8, attackFrames = 8, releaseFrames = 5 } = {}) {
    this.minRms = minRms;
    this.noiseRatio = noiseRatio;
    this.attackFrames = attackFrames;
    this.releaseFrames = releaseFrames;
    this.noiseFloor = 60;
    this.consecutiveAbove = 0;
    this.consecutiveBelow = 0;
    this.speaking = false;
  }

  static rms(buffer) {
    const n = buffer.length >> 1;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = buffer.readInt16LE(i * 2);
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  }

  /**
   * Processa um frame e retorna true enquanto houver fala ativa sustentada.
   */
  process(buffer) {
    const rms = FrameVad.rms(buffer);
    const threshold = Math.max(this.minRms, this.noiseFloor * this.noiseRatio);

    if (rms > threshold) {
      this.consecutiveAbove++;
      this.consecutiveBelow = 0;
      if (this.consecutiveAbove >= this.attackFrames) this.speaking = true;
    } else {
      this.consecutiveBelow++;
      this.consecutiveAbove = 0;
      // Piso de ruído adaptativo apenas em frames de não-fala
      this.noiseFloor = Math.min(400, 0.95 * this.noiseFloor + 0.05 * rms);
      if (this.consecutiveBelow >= this.releaseFrames) this.speaking = false;
    }

    // Fala "ativa" exige frame atual acima do limiar (cauda de hangover não conta)
    return this.speaking && this.consecutiveAbove > 0;
  }

  reset() {
    this.consecutiveAbove = 0;
    this.consecutiveBelow = 0;
    this.speaking = false;
  }
}

module.exports = FrameVad;
