/**
 * Utilitários estatísticos para dimensionamento amostral e testes de hipóteses de CPC.
 * Aplica a fórmula de amostragem de Cochran para populações finitas com 95% de nível de confiança (Z = 1,96)
 * e margem de erro controlada (padrão: 5%).
 *
 * Para bases pequenas (N <= 100), adota automaticamente a partição equilibrada 50/50
 * para maximizar o poder estatístico do teste A/B empírico.
 */

export interface SampleSizeResult {
  sampleSize: number;
  samplePct: number;
  confidence: number;
  marginOfError: number;
  isSmallBase: boolean;
  formulaText: string;
  explanation: string;
}

export function calculateStatisticalSampleSize(
  totalN: number,
  marginOfError = 0.05,
): SampleSizeResult {
  if (totalN <= 0) {
    return {
      sampleSize: 0,
      samplePct: 0,
      confidence: 95,
      marginOfError: 5,
      isSmallBase: true,
      formulaText: 'Base vazia (N=0)',
      explanation: 'Nenhum contato disponível na base da campanha.',
    };
  }

  // Bases pequenas: amostragem proporcional não atinge significância em 10%.
  // Solução metodológica: Teste A/B balanceado 50/50.
  if (totalN <= 100) {
    const half = Math.max(2, Math.round(totalN * 0.5));
    const sampleSize = Math.min(totalN, half);
    const samplePct = Math.round((sampleSize / totalN) * 100);

    return {
      sampleSize,
      samplePct,
      confidence: 90,
      marginOfError: Math.min(15, Math.round((1 / Math.sqrt(sampleSize)) * 100)),
      isSmallBase: true,
      formulaText: `Ajuste A/B 50/50 para base pequena (N=${totalN})`,
      explanation: `Em bases com menos de 100 contatos, uma fatia de 10% é estatisticamente nula. O sistema ajusta a amostra para 50% (${sampleSize} contatos) para viabilizar comparação válida com a produção.`,
    };
  }

  // População finita: Cochran com fator de correção
  // n = (N * Z^2 * p * (1-p)) / (e^2 * (N - 1) + Z^2 * p * (1-p))
  const Z = 1.96; // 95% de nível de confiança
  const p = 0.5; // máxima variância amostral
  const e = marginOfError;

  const zSquaredPq = Z * Z * p * (1 - p); // 0.9604
  const numerator = totalN * zSquaredPq;
  const denominator = e * e * (totalN - 1) + zSquaredPq;
  const rawSize = Math.ceil(numerator / denominator);

  const sampleSize = Math.min(totalN, Math.max(30, rawSize));
  const samplePct = Math.max(1, Math.round((sampleSize / totalN) * 100));

  return {
    sampleSize,
    samplePct,
    confidence: 95,
    marginOfError: Math.round(marginOfError * 100),
    isSmallBase: false,
    formulaText: `Cochran finita (Z=1,96 · erro ±${Math.round(marginOfError * 100)}%)`,
    explanation: `Calculado para 95% de confiança estatística com erro amostral de ±${Math.round(marginOfError * 100)}%. São necessários ${sampleSize} contatos (${samplePct}% da base de ${totalN}) para validar o veredito empírico.`,
  };
}
