/**
 * Gerenciador de Energia de Áudio (PCM16)
 * Calcula o nível de ruído ambiente para ajuste dinâmico de VAD.
 */
class EnergyManager {
  constructor() {
    this.reset();
  }

  /**
   * Limpa completamente todos os acumuladores para garantir 0 vazamento de estado.
   */
  reset() {
    this.noiseFloor = 0;
    this.samplesCount = 0;
    this.alpha = 0.1; // Fator de suavização (Moving Average)
    
    // Para detecção automática de Viva-voz (Eco)
    this.echoEnergySum = 0;
    this.echoSamplesCount = 0;

    // [v39.0] Detecção Espectral por Média Robusta (Goertzel)
    this.targetFreq = 425;
    this.sampleRate = 8000;
    this.magnitudeSum = 0;
    this.magnitudeCount = 0;
  }

  /**
   * Implementação do Algoritmo de Goertzel para detectar uma frequência específica
   * @param {Int16Array} samples 
   * @param {number} targetFreq 
   * @param {number} sampleRate 
   * @returns {number} Magnitude da frequência
   */
  getFrequencyMagnitude(samples, targetFreq, sampleRate) {
    const N = samples.length;
    const k = Math.round((N * targetFreq) / sampleRate);
    const omega = (2.0 * Math.PI * k) / N;
    const coeff = 2.0 * Math.cos(omega);

    let q0 = 0, q1 = 0, q2 = 0;

    for (let i = 0; i < N; i++) {
      q0 = coeff * q1 - q2 + samples[i];
      q2 = q1;
      q1 = q0;
    }

    const magnitude = Math.sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff);
    return magnitude / N; // Normalizado
  }

  /**
   * Calcula a energia (RMS) de um buffer PCM16 (Int16Array)
   * @param {Buffer} buffer 
   * @param {boolean} isAgentTalking 
   * @returns {number} Energy level (0 to 32768)
   */
  calculateEnergy(buffer, isAgentTalking = false) {
    if (!buffer || buffer.length < 2) return 0;
    
    try {
      this.samplesCount++;

      let pcm16;
      if (buffer.byteOffset % 2 === 0) {
        pcm16 = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));
      } else {
        const aligned = Buffer.allocUnsafe(buffer.length);
        buffer.copy(aligned);
        pcm16 = new Int16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / 2));
      }

      let sumSquares = 0;
      for (let i = 0; i < pcm16.length; i++) {
          sumSquares += pcm16[i] * pcm16[i];
      }
      
      const rms = Math.sqrt(sumSquares / pcm16.length) || 0;
      
      if (isAgentTalking) {
        this.echoEnergySum += rms;
        this.echoSamplesCount++;

        // [v39.0] Cálculo Espectral por Média Robusta (Ignora o 'picotado')
        const freqs = [415, 420, 425, 430, 435];
        let maxMag = 0;
        for (const f of freqs) {
          const mag = this.getFrequencyMagnitude(pcm16, f, this.sampleRate);
          if (mag > maxMag) maxMag = mag;
        }
        
        // SÓ inclui na média se houver áudio real (ignora o "vazio" do picotado da rede)
        // Se o RMS for muito baixo (silêncio), não deixamos ele baixar a média espectral.
        if (rms > (this.noiseFloor * 1.2) || rms > 150) {
          this.magnitudeSum += maxMag;
          this.magnitudeCount++;
        }
      } else {
        // [v48.0] Estimação robusta do piso de ruído de fundo:
        // Ignora voz humana ativa (RMS > 400) para evitar que o "Alô!" do cliente inflacione o noiseFloor para >1500
        if (rms < 400) {
          // Desce rápido para acompanhar períodos de silêncio, sobe suavemente para não inflar com estalos transitórios
          const adaptAlpha = rms < this.noiseFloor ? 0.25 : 0.04;
          this.noiseFloor = (adaptAlpha * rms) + ((1 - adaptAlpha) * this.noiseFloor);
        }
      }
      
      return rms;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Classifica se o ambiente parece estar em Viva-voz baseado no retorno do áudio
   * @param {string} callId 
   * @returns {string} viva_voz | fone_ouvido
   */
  detectDeviceMode(callId = 'default') {
    if (this.echoSamplesCount < 5) {
      console.log(`[${callId}] [VAD-ENERGY] Dados insuficientes (${this.echoSamplesCount} samples). Assumindo FONE_OUVIDO.`);
      return 'fone_ouvido';
    }
    
    // Heurística de Energia (v21.0)
    const avgEcho = this.echoEnergySum / this.echoSamplesCount;
    const energyRatio = avgEcho / (this.noiseFloor || 1);

    // [v45.0] Engine de Contexto Híbrido (Barulho vs Silêncio)
    const avgMag = this.magnitudeSum / (this.magnitudeCount || 1);
    const isNoisy = this.noiseFloor > 400; // Define Ambiente Barulhento (TV/Street)

    if (isNoisy) {
      // ===== AMBIENTE BARULHENTO =====
      // Fato acústico: Viva-voz supera o barulho da sala e dobra a energia (Ratio > 2.0).
      // Fone apenas sofre crosstalk elétrico e fica mascarado pelo barulho (Ratio < 2.0).
      const passNoisySpeaker = energyRatio >= 2.0 && avgMag > 100;
      
      console.log(`[${callId}] ┌── 📡 SONAR NOISE-LOCK (415-435Hz) ────────`);
      console.log(`[${callId}] │ Contexto: BARULHENTO (NF: ${this.noiseFloor.toFixed(0)})`);
      console.log(`[${callId}] │ Ratio Exigido: >=2.0x (Real: ${energyRatio.toFixed(1)}x)`);
      console.log(`[${callId}] │ Magnitude Acústica: ${avgMag.toFixed(2)}`);
      console.log(`[${callId}] └─────────────────────────────────────────────`);

      if (passNoisySpeaker) {
        console.log(`[${callId}] [VAD-ENERGY] Resultado: VIVA_VOZ 🔊 (Sobressaiu ao Ruído)`);
        return 'viva_voz';
      }
      
      console.log(`[${callId}] [VAD-ENERGY] Resultado: FONE_OUVIDO 🎧 (Afogado no Ruído)`);
      return 'fone_ouvido';

    } else {
      // ===== AMBIENTE SILENCIOSO =====
      // [v47.0] Precision Gate: Aumentamos a exigência de Ratio para sinais fortes.
      // Viva-Voz Real no silêncio TRIPLA a energia da sala (Ratio > 3.0).
      // Fones de ouvido "barulhentos" vazam frequência (Mag alta) mas raramente triplicam o RMS.
      
      const isCrosstalk = avgMag > 40.0 && energyRatio < 3.0;
      const isLoudSpeaker = avgMag > 40.0 && energyRatio >= 3.0;

      console.log(`[${callId}] ┌── 📡 SONAR QUIET-LOCK (415-435Hz) ────────`);
      console.log(`[${callId}] │ Contexto: SILENCIOSO (NF: ${this.noiseFloor.toFixed(0)})`);
      console.log(`[${callId}] │ Magnitude: ${avgMag.toFixed(0)} | Ratio: ${energyRatio.toFixed(1)}x`);
      console.log(`[${callId}] └─────────────────────────────────────────────`);

      if (isCrosstalk) {
        console.log(`[${callId}] [VAD-ENERGY] Resultado: FONE_OUVIDO 🎧 (Crosstalk Elétrico: Mag ${avgMag.toFixed(0)} | Ratio ${energyRatio.toFixed(1)}x)`);
        return 'fone_ouvido';
      }

      if (isLoudSpeaker) {
        console.log(`[${callId}] [VAD-ENERGY] Resultado: VIVA_VOZ 🔊 (Acoustic Power: Ratio ${energyRatio.toFixed(1)}x)`);
        return 'viva_voz';
      }

      // Heurística de Base v40.1 (Exigência rígida de Ratio no silêncio)
      const MAG_BASE     = 9.0;  
      const RATIO_STRICT = 1.1; 

      if (avgMag > MAG_BASE && energyRatio >= RATIO_STRICT) {
        console.log(`[${callId}] [VAD-ENERGY] Resultado: VIVA_VOZ 🔊 (Sinal Acústico Seguro)`);
        return 'viva_voz';
      }

      console.log(`[${callId}] [VAD-ENERGY] Resultado: FONE_OUVIDO 🎧 (Sinal abaixo do Ratio ${RATIO_STRICT}x)`);
      return 'fone_ouvido';
    }
  }

  /**
   * Sugere um threshold de VAD para a OpenAI (0.0 a 1.0)
   * Teto máximo seguro limitado a 0.68 para nunca ensurdecer a IA no telefone.
   * @returns {number}
   */
  suggestThreshold(baseThreshold = 0.5) {
    const maxThreshold = 0.68;
    const mapped = baseThreshold + (this.noiseFloor / 1000) * 0.20;
    return Math.min(maxThreshold, mapped);
  }

  /**
   * Classifica o ambiente baseado no nível de ruído atual
   * @returns {string} SILENCE | OFFICE | STREET | TV
   */
  getClassification() {
    const nf = this.noiseFloor;
    if (nf < 80) return 'SILENCE';
    if (nf < 220) return 'OFFICE';
    if (nf < 380) return 'STREET';
    return 'TV';
  }
}

module.exports = EnergyManager;
