/**
 * Base de Conhecimento Brasil (TIC Domicílios 2025, IBGE, Anatel) +
 * Benchmark Global de Ferramentas de Discagem/Collections/Sales +
 * Catálogo das 5 Famílias de Hipóteses (H-A, H-G, H-C, H-T, H-L).
 */
import type { CeticAgeBracket, HypothesisFamily, IbgeCityTier, MacroRegion } from '@voll/shared';

export type DddProfile = {
  ddd: string;
  uf: string;
  macroRegion: MacroRegion;
  cityTier: IbgeCityTier;
  referenceArea: string;
  timezone: string;
  /** Proporção regional que teve pacote de dados móveis encerrado nos últimos 3 meses (TIC 2025) */
  dataCapExhaustionPct: number;
  /** Uso regional de e-mail entre internautas (TIC 2025) */
  regionalEmailUsagePct: number;
  /** Uso regional de mensageria instantânea entre internautas (TIC 2025) */
  regionalMessagingUsagePct: number;
  /** Sensibilidade a BINA com DDD Local (0.0 a 1.0) */
  localDddSensitivity: number;
  /** Saturação de chamadas de spam/robocall (0.0 a 1.0) */
  spamSaturationIndex: number;
};

/** Tabela Oficial TIC Domicílios 2025 (Cetic.br — Tabelas C1, C5 e C16A) */
export const TIC_DOMICILIOS_2025_BY_AGE: {
  bracket: CeticAgeBracket;
  label: string;
  generationAlias: string;
  internetEverPct: number;
  offlinePopulationPct: number;
  emailAmongUsersPct: number;
  instantMessagingAmongUsersPct: number;
  internetVoiceVideoAmongUsersPct: number;
  socialMediaAmongUsersPct: number;
  mobileOnlyAccessPct: number;
  strategicImplication: string;
}[] = [
  {
    bracket: '16_24',
    label: '16–24 anos',
    generationAlias: 'Geração Z',
    internetEverPct: 99,
    offlinePopulationPct: 1,
    emailAmongUsersPct: 69,
    instantMessagingAmongUsersPct: 95,
    internetVoiceVideoAmongUsersPct: 81,
    socialMediaAmongUsersPct: 93,
    mobileOnlyAccessPct: 60,
    strategicImplication: 'Altíssima conectividade digital e forte aversão a chamadas de voz de números desconhecidos (Phone Anxiety). Iniciar por canais digitais curtos/identificados.',
  },
  {
    bracket: '25_34',
    label: '25–34 anos',
    generationAlias: 'Millennials Jovens / Gen Z',
    internetEverPct: 99,
    offlinePopulationPct: 1,
    emailAmongUsersPct: 74,
    instantMessagingAmongUsersPct: 97,
    internetVoiceVideoAmongUsersPct: 84,
    socialMediaAmongUsersPct: 94,
    mobileOnlyAccessPct: 58,
    strategicImplication: 'Maior taxa nacional de uso de e-mail (74%) e mensageria (97%). Excelente resposta a E-mail contextual + WhatsApp ou Voz precedida por Warm-up.',
  },
  {
    bracket: '35_44',
    label: '35–44 anos',
    generationAlias: 'Millennials Maduros',
    internetEverPct: 97,
    offlinePopulationPct: 3,
    emailAmongUsersPct: 68,
    instantMessagingAmongUsersPct: 95,
    internetVoiceVideoAmongUsersPct: 85,
    socialMediaAmongUsersPct: 85,
    mobileOnlyAccessPct: 62,
    strategicImplication: 'Rotina profissional intensa. Janelas de almoço (12h–13h30) e fim de expediente (17h30–19h30) com identificação clara do remetente maximizam o CPC.',
  },
  {
    bracket: '45_59',
    label: '45–59 anos',
    generationAlias: 'Geração X',
    internetEverPct: 92,
    offlinePopulationPct: 8,
    emailAmongUsersPct: 59,
    instantMessagingAmongUsersPct: 95,
    internetVoiceVideoAmongUsersPct: 84,
    socialMediaAmongUsersPct: 75,
    mobileOnlyAccessPct: 68,
    strategicImplication: 'Perfil híbrido e pragmático. Atende chamada de voz se o DDD for local/identificado ou após aviso prévio por SMS/WhatsApp.',
  },
  {
    bracket: '60_PLUS',
    label: '60+ anos',
    generationAlias: 'Baby Boomers / Sênior',
    internetEverPct: 62,
    offlinePopulationPct: 38,
    emailAmongUsersPct: 40,
    instantMessagingAmongUsersPct: 83,
    internetVoiceVideoAmongUsersPct: 76,
    socialMediaAmongUsersPct: 57,
    mobileOnlyAccessPct: 81,
    strategicImplication: '38% estão fora da internet (exigindo Telefonia/Voz tradicional). Entre os 62% online, 83% usam mensageria e 81% usam exclusivamente o celular (evitar e-mail frio; combinar Voz Local Matinal + WhatsApp com alternativa humana).',
  },
];

/** Catálogo dos DDDs Brasileiros com Contexto IBGE + Conectividade Cetic 2025 */
export const BRAZIL_DDD_CATALOG: Record<string, DddProfile> = {
  // SUDESTE (E-mail: 66%, Mensageria: 94%, Esgotamento franquia: ~33%)
  '11': { ddd: '11', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'METROPOLE', referenceArea: 'São Paulo / Grande SP', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 31, regionalEmailUsagePct: 68, regionalMessagingUsagePct: 95, localDddSensitivity: 0.65, spamSaturationIndex: 0.96 },
  '12': { ddd: '12', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'São José dos Campos / Vale do Paraíba', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 32, regionalEmailUsagePct: 66, regionalMessagingUsagePct: 94, localDddSensitivity: 0.78, spamSaturationIndex: 0.75 },
  '13': { ddd: '13', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Santos / Baixada Santista', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 33, regionalEmailUsagePct: 65, regionalMessagingUsagePct: 94, localDddSensitivity: 0.76, spamSaturationIndex: 0.76 },
  '14': { ddd: '14', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Bauru / Marília', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 35, regionalEmailUsagePct: 61, regionalMessagingUsagePct: 93, localDddSensitivity: 0.84, spamSaturationIndex: 0.64 },
  '15': { ddd: '15', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Sorocaba e Região', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 34, regionalEmailUsagePct: 63, regionalMessagingUsagePct: 94, localDddSensitivity: 0.80, spamSaturationIndex: 0.70 },
  '16': { ddd: '16', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Ribeirão Preto / Araraquara', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 33, regionalEmailUsagePct: 65, regionalMessagingUsagePct: 94, localDddSensitivity: 0.85, spamSaturationIndex: 0.72 },
  '17': { ddd: '17', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'São José do Rio Preto', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 35, regionalEmailUsagePct: 62, regionalMessagingUsagePct: 93, localDddSensitivity: 0.85, spamSaturationIndex: 0.66 },
  '18': { ddd: '18', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Presidente Prudente / Araçatuba', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 36, regionalEmailUsagePct: 60, regionalMessagingUsagePct: 92, localDddSensitivity: 0.86, spamSaturationIndex: 0.62 },
  '19': { ddd: '19', uf: 'SP', macroRegion: 'SUDESTE', cityTier: 'METROPOLE', referenceArea: 'Campinas / Piracicaba', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 31, regionalEmailUsagePct: 67, regionalMessagingUsagePct: 95, localDddSensitivity: 0.78, spamSaturationIndex: 0.84 },
  '21': { ddd: '21', uf: 'RJ', macroRegion: 'SUDESTE', cityTier: 'METROPOLE', referenceArea: 'Rio de Janeiro / Grande Rio', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 35, regionalEmailUsagePct: 66, regionalMessagingUsagePct: 94, localDddSensitivity: 0.72, spamSaturationIndex: 0.93 },
  '22': { ddd: '22', uf: 'RJ', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Campos dos Goytacazes / Região dos Lagos', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 38, regionalEmailUsagePct: 58, regionalMessagingUsagePct: 92, localDddSensitivity: 0.82, spamSaturationIndex: 0.68 },
  '24': { ddd: '24', uf: 'RJ', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Petrópolis / Volta Redonda', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 36, regionalEmailUsagePct: 60, regionalMessagingUsagePct: 93, localDddSensitivity: 0.82, spamSaturationIndex: 0.67 },
  '27': { ddd: '27', uf: 'ES', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Vitória / Grande Vitória', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 35, regionalEmailUsagePct: 64, regionalMessagingUsagePct: 94, localDddSensitivity: 0.83, spamSaturationIndex: 0.74 },
  '28': { ddd: '28', uf: 'ES', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Cachoeiro de Itapemirim / Sul ES', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 39, regionalEmailUsagePct: 56, regionalMessagingUsagePct: 91, localDddSensitivity: 0.88, spamSaturationIndex: 0.58 },
  '31': { ddd: '31', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'METROPOLE', referenceArea: 'Belo Horizonte / RMBH', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 34, regionalEmailUsagePct: 65, regionalMessagingUsagePct: 94, localDddSensitivity: 0.82, spamSaturationIndex: 0.88 },
  '32': { ddd: '32', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Juiz de Fora / Zona da Mata', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 37, regionalEmailUsagePct: 60, regionalMessagingUsagePct: 92, localDddSensitivity: 0.86, spamSaturationIndex: 0.65 },
  '33': { ddd: '33', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Governador Valadares / Teófilo Otoni', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 42, regionalEmailUsagePct: 54, regionalMessagingUsagePct: 90, localDddSensitivity: 0.88, spamSaturationIndex: 0.60 },
  '34': { ddd: '34', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Uberlândia / Triângulo Mineiro', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 34, regionalEmailUsagePct: 63, regionalMessagingUsagePct: 94, localDddSensitivity: 0.85, spamSaturationIndex: 0.72 },
  '35': { ddd: '35', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Poços de Caldas / Sul de Minas', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 37, regionalEmailUsagePct: 59, regionalMessagingUsagePct: 92, localDddSensitivity: 0.87, spamSaturationIndex: 0.62 },
  '37': { ddd: '37', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Divinópolis / Centro-Oeste MG', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 38, regionalEmailUsagePct: 57, regionalMessagingUsagePct: 91, localDddSensitivity: 0.87, spamSaturationIndex: 0.60 },
  '38': { ddd: '38', uf: 'MG', macroRegion: 'SUDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Montes Claros / Norte de Minas', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 43, regionalEmailUsagePct: 53, regionalMessagingUsagePct: 89, localDddSensitivity: 0.89, spamSaturationIndex: 0.59 },
  // SUL
  '41': { ddd: '41', uf: 'PR', macroRegion: 'SUL', cityTier: 'METROPOLE', referenceArea: 'Curitiba / RMC', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 31, regionalEmailUsagePct: 65, regionalMessagingUsagePct: 94, localDddSensitivity: 0.86, spamSaturationIndex: 0.86 },
  '42': { ddd: '42', uf: 'PR', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Ponta Grossa / Guarapuava', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 35, regionalEmailUsagePct: 59, regionalMessagingUsagePct: 92, localDddSensitivity: 0.90, spamSaturationIndex: 0.64 },
  '43': { ddd: '43', uf: 'PR', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Londrina / Norte do PR', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 33, regionalEmailUsagePct: 63, regionalMessagingUsagePct: 93, localDddSensitivity: 0.89, spamSaturationIndex: 0.72 },
  '44': { ddd: '44', uf: 'PR', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Maringá / Foz do Iguaçu', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 33, regionalEmailUsagePct: 63, regionalMessagingUsagePct: 93, localDddSensitivity: 0.89, spamSaturationIndex: 0.70 },
  '45': { ddd: '45', uf: 'PR', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Cascavel / Oeste PR', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 34, regionalEmailUsagePct: 61, regionalMessagingUsagePct: 92, localDddSensitivity: 0.91, spamSaturationIndex: 0.65 },
  '46': { ddd: '46', uf: 'PR', macroRegion: 'SUL', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Francisco Beltrão / Pato Branco', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 36, regionalEmailUsagePct: 58, regionalMessagingUsagePct: 91, localDddSensitivity: 0.92, spamSaturationIndex: 0.56 },
  '47': { ddd: '47', uf: 'SC', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Joinville / Blumenau / Balneário Camboriú', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 29, regionalEmailUsagePct: 66, regionalMessagingUsagePct: 95, localDddSensitivity: 0.93, spamSaturationIndex: 0.76 },
  '48': { ddd: '48', uf: 'SC', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Florianópolis / Criciúma', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 29, regionalEmailUsagePct: 67, regionalMessagingUsagePct: 95, localDddSensitivity: 0.89, spamSaturationIndex: 0.79 },
  '49': { ddd: '49', uf: 'SC', macroRegion: 'SUL', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Chapecó / Lages / Oeste SC', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 34, regionalEmailUsagePct: 60, regionalMessagingUsagePct: 92, localDddSensitivity: 0.94, spamSaturationIndex: 0.60 },
  '51': { ddd: '51', uf: 'RS', macroRegion: 'SUL', cityTier: 'METROPOLE', referenceArea: 'Porto Alegre / RMPA', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 32, regionalEmailUsagePct: 64, regionalMessagingUsagePct: 94, localDddSensitivity: 0.88, spamSaturationIndex: 0.85 },
  '53': { ddd: '53', uf: 'RS', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Pelotas / Rio Grande', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 36, regionalEmailUsagePct: 58, regionalMessagingUsagePct: 91, localDddSensitivity: 0.91, spamSaturationIndex: 0.63 },
  '54': { ddd: '54', uf: 'RS', macroRegion: 'SUL', cityTier: 'POLO_REGIONAL', referenceArea: 'Caxias do Sul / Passo Fundo / Serra Gaúcha', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 31, regionalEmailUsagePct: 63, regionalMessagingUsagePct: 93, localDddSensitivity: 0.94, spamSaturationIndex: 0.68 },
  '55': { ddd: '55', uf: 'RS', macroRegion: 'SUL', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Santa Maria / Uruguaiana / Interior RS', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 36, regionalEmailUsagePct: 57, regionalMessagingUsagePct: 91, localDddSensitivity: 0.92, spamSaturationIndex: 0.59 },
  // CENTRO-OESTE
  '61': { ddd: '61', uf: 'DF', macroRegion: 'CENTRO_OESTE', cityTier: 'METROPOLE', referenceArea: 'Brasília / Distrito Federal', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 32, regionalEmailUsagePct: 67, regionalMessagingUsagePct: 95, localDddSensitivity: 0.78, spamSaturationIndex: 0.87 },
  '62': { ddd: '62', uf: 'GO', macroRegion: 'CENTRO_OESTE', cityTier: 'METROPOLE', referenceArea: 'Goiânia / Anápolis', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 37, regionalEmailUsagePct: 60, regionalMessagingUsagePct: 93, localDddSensitivity: 0.84, spamSaturationIndex: 0.80 },
  '64': { ddd: '64', uf: 'GO', macroRegion: 'CENTRO_OESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Rio Verde / Itumbiara / Sudoeste GO', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 39, regionalEmailUsagePct: 56, regionalMessagingUsagePct: 91, localDddSensitivity: 0.87, spamSaturationIndex: 0.63 },
  '65': { ddd: '65', uf: 'MT', macroRegion: 'CENTRO_OESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Cuiabá / Várzea Grande', timezone: 'America/Cuiaba', dataCapExhaustionPct: 39, regionalEmailUsagePct: 58, regionalMessagingUsagePct: 92, localDddSensitivity: 0.85, spamSaturationIndex: 0.74 },
  '66': { ddd: '66', uf: 'MT', macroRegion: 'CENTRO_OESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Rondonópolis / Sinop / Sorriso', timezone: 'America/Cuiaba', dataCapExhaustionPct: 41, regionalEmailUsagePct: 55, regionalMessagingUsagePct: 91, localDddSensitivity: 0.88, spamSaturationIndex: 0.62 },
  '67': { ddd: '67', uf: 'MS', macroRegion: 'CENTRO_OESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Campo Grande / Dourados', timezone: 'America/Cuiaba', dataCapExhaustionPct: 38, regionalEmailUsagePct: 59, regionalMessagingUsagePct: 92, localDddSensitivity: 0.85, spamSaturationIndex: 0.72 },
  // NORDESTE (Esgotamento de franquia: 49% TIC 2025; E-mail: 49%; Mensageria: 91%)
  '71': { ddd: '71', uf: 'BA', macroRegion: 'NORDESTE', cityTier: 'METROPOLE', referenceArea: 'Salvador / RMS', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 46, regionalEmailUsagePct: 54, regionalMessagingUsagePct: 92, localDddSensitivity: 0.82, spamSaturationIndex: 0.84 },
  '73': { ddd: '73', uf: 'BA', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Ilhéus / Itabuna / Extremo Sul BA', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 51, regionalEmailUsagePct: 46, regionalMessagingUsagePct: 89, localDddSensitivity: 0.86, spamSaturationIndex: 0.61 },
  '74': { ddd: '74', uf: 'BA', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Juazeiro / Jacobina / Norte BA', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 52, regionalEmailUsagePct: 45, regionalMessagingUsagePct: 88, localDddSensitivity: 0.87, spamSaturationIndex: 0.58 },
  '75': { ddd: '75', uf: 'BA', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Feira de Santana / Recôncavo', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 49, regionalEmailUsagePct: 49, regionalMessagingUsagePct: 90, localDddSensitivity: 0.85, spamSaturationIndex: 0.67 },
  '77': { ddd: '77', uf: 'BA', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Vitória da Conquista / Barreiras', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 50, regionalEmailUsagePct: 48, regionalMessagingUsagePct: 89, localDddSensitivity: 0.87, spamSaturationIndex: 0.62 },
  '79': { ddd: '79', uf: 'SE', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Aracaju / Sergipe', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 48, regionalEmailUsagePct: 51, regionalMessagingUsagePct: 91, localDddSensitivity: 0.85, spamSaturationIndex: 0.70 },
  '81': { ddd: '81', uf: 'PE', macroRegion: 'NORDESTE', cityTier: 'METROPOLE', referenceArea: 'Recife / RMR / Caruaru', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 47, regionalEmailUsagePct: 53, regionalMessagingUsagePct: 92, localDddSensitivity: 0.84, spamSaturationIndex: 0.84 },
  '82': { ddd: '82', uf: 'AL', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Maceió / Arapiraca', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 50, regionalEmailUsagePct: 48, regionalMessagingUsagePct: 90, localDddSensitivity: 0.85, spamSaturationIndex: 0.69 },
  '83': { ddd: '83', uf: 'PB', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'João Pessoa / Campina Grande', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 49, regionalEmailUsagePct: 50, regionalMessagingUsagePct: 91, localDddSensitivity: 0.86, spamSaturationIndex: 0.70 },
  '84': { ddd: '84', uf: 'RN', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Natal / Mossoró', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 48, regionalEmailUsagePct: 51, regionalMessagingUsagePct: 91, localDddSensitivity: 0.85, spamSaturationIndex: 0.71 },
  '85': { ddd: '85', uf: 'CE', macroRegion: 'NORDESTE', cityTier: 'METROPOLE', referenceArea: 'Fortaleza / RMF', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 47, regionalEmailUsagePct: 53, regionalMessagingUsagePct: 92, localDddSensitivity: 0.84, spamSaturationIndex: 0.83 },
  '86': { ddd: '86', uf: 'PI', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Teresina / Parnaíba', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 51, regionalEmailUsagePct: 47, regionalMessagingUsagePct: 89, localDddSensitivity: 0.86, spamSaturationIndex: 0.66 },
  '87': { ddd: '87', uf: 'PE', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Petrolina / Garanhuns / Sertão PE', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 52, regionalEmailUsagePct: 45, regionalMessagingUsagePct: 88, localDddSensitivity: 0.88, spamSaturationIndex: 0.59 },
  '88': { ddd: '88', uf: 'CE', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Juazeiro do Norte / Sobral', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 51, regionalEmailUsagePct: 46, regionalMessagingUsagePct: 89, localDddSensitivity: 0.88, spamSaturationIndex: 0.61 },
  '89': { ddd: '89', uf: 'PI', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Picos / Floriano / Sul PI', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 53, regionalEmailUsagePct: 44, regionalMessagingUsagePct: 87, localDddSensitivity: 0.89, spamSaturationIndex: 0.55 },
  '98': { ddd: '98', uf: 'MA', macroRegion: 'NORDESTE', cityTier: 'POLO_REGIONAL', referenceArea: 'São Luís / Ilha do Maranhão', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 51, regionalEmailUsagePct: 47, regionalMessagingUsagePct: 89, localDddSensitivity: 0.85, spamSaturationIndex: 0.69 },
  '99': { ddd: '99', uf: 'MA', macroRegion: 'NORDESTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Imperatriz / Caxias', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 53, regionalEmailUsagePct: 44, regionalMessagingUsagePct: 87, localDddSensitivity: 0.88, spamSaturationIndex: 0.58 },
  // NORTE (Esgotamento de franquia: 54% TIC 2025; Mensageria: 86%)
  '63': { ddd: '63', uf: 'TO', macroRegion: 'NORTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Palmas / Araguaína', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 50, regionalEmailUsagePct: 50, regionalMessagingUsagePct: 88, localDddSensitivity: 0.85, spamSaturationIndex: 0.63 },
  '68': { ddd: '68', uf: 'AC', macroRegion: 'NORTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Rio Branco / Acre', timezone: 'America/Rio_Branco', dataCapExhaustionPct: 55, regionalEmailUsagePct: 47, regionalMessagingUsagePct: 85, localDddSensitivity: 0.88, spamSaturationIndex: 0.58 },
  '69': { ddd: '69', uf: 'RO', macroRegion: 'NORTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Porto Velho / Ji-Paraná', timezone: 'America/Manaus', dataCapExhaustionPct: 52, regionalEmailUsagePct: 49, regionalMessagingUsagePct: 87, localDddSensitivity: 0.87, spamSaturationIndex: 0.62 },
  '91': { ddd: '91', uf: 'PA', macroRegion: 'NORTE', cityTier: 'METROPOLE', referenceArea: 'Belém / Ananindeua', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 53, regionalEmailUsagePct: 51, regionalMessagingUsagePct: 88, localDddSensitivity: 0.84, spamSaturationIndex: 0.78 },
  '92': { ddd: '92', uf: 'AM', macroRegion: 'NORTE', cityTier: 'METROPOLE', referenceArea: 'Manaus / Amazonas', timezone: 'America/Manaus', dataCapExhaustionPct: 54, regionalEmailUsagePct: 52, regionalMessagingUsagePct: 87, localDddSensitivity: 0.85, spamSaturationIndex: 0.77 },
  '93': { ddd: '93', uf: 'PA', macroRegion: 'NORTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Santarém / Oeste do Pará', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 56, regionalEmailUsagePct: 44, regionalMessagingUsagePct: 84, localDddSensitivity: 0.89, spamSaturationIndex: 0.54 },
  '94': { ddd: '94', uf: 'PA', macroRegion: 'NORTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Marabá / Parauapebas / Sul PA', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 54, regionalEmailUsagePct: 46, regionalMessagingUsagePct: 86, localDddSensitivity: 0.88, spamSaturationIndex: 0.59 },
  '95': { ddd: '95', uf: 'RR', macroRegion: 'NORTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Boa Vista / Roraima', timezone: 'America/Manaus', dataCapExhaustionPct: 55, regionalEmailUsagePct: 48, regionalMessagingUsagePct: 86, localDddSensitivity: 0.87, spamSaturationIndex: 0.57 },
  '96': { ddd: '96', uf: 'AP', macroRegion: 'NORTE', cityTier: 'POLO_REGIONAL', referenceArea: 'Macapá / Santana', timezone: 'America/Sao_Paulo', dataCapExhaustionPct: 55, regionalEmailUsagePct: 48, regionalMessagingUsagePct: 86, localDddSensitivity: 0.87, spamSaturationIndex: 0.60 },
  '97': { ddd: '97', uf: 'AM', macroRegion: 'NORTE', cityTier: 'INTERIOR_PEQUENO', referenceArea: 'Interior do Amazonas / Tefé / Parintins', timezone: 'America/Manaus', dataCapExhaustionPct: 59, regionalEmailUsagePct: 41, regionalMessagingUsagePct: 82, localDddSensitivity: 0.90, spamSaturationIndex: 0.50 },
};

/** Benchmark Global das Ferramentas de Discagem, Collections e Sales */
export const GLOBAL_DIALERS_BENCHMARK = [
  {
    tool: 'Aspect ALM / Alvaria Advanced Outreach',
    category: 'Enterprise List & Campaign Management',
    coreConcepts: 'Arquitetura desacoplada (Cérebro vs. Discador), Record-Based Workflow, controle de Penetração vs. Saturação, Account Harassment Thresholds (Reg F/Anatel) e Limited Content Message (LCM).',
    historicalLimitation: 'Baseado em regras SQL/booleanas estáticas que exigem configuração manual pesada e não calculam o Custo Esperado por CPC individualmente.',
    howVollEvolvesIt: 'Transforma o ALM em uma Esteira Matemática guiada pelo Prompt de Finalidade, operando nos modos Produção e Laboratório.',
  },
  {
    tool: 'Altitude uCI (Enghouse Interactive)',
    category: 'Campaign & Credit Recovery Suite',
    coreConcepts: 'Shift Recycling Matrix (Matriz de Reciclagem de Turno: Manhã -> Tarde -> Noite -> Sábado), Multi-Phone Priority e Soberania do Agendamento (Callback).',
    historicalLimitation: 'Desenhado para maximizar a ocupação de operadores de call center, tratando o digital como canal secundário.',
    howVollEvolvesIt: 'Aplica a Matriz de Reciclagem de Turno em todos os canais sincronizada com fuso horário e janelas de conexão Wi-Fi.',
  },
  {
    tool: 'Olos (OlosChannel / Olos Locator / JourneyX)',
    category: 'Omnichannel Dialer & Locator (Brasil)',
    coreConcepts: 'Qualificação prévia de titularidade/viabilidade do telefone (Locator Score), Best Time to Call (BTTC) e transbordo de voz improdutiva para WhatsApp/SMS.',
    historicalLimitation: 'Muitas operações ainda gastam tentativas caras de voz antes de transbordar perfis claramente digitais.',
    howVollEvolvesIt: 'Separa o Locator Score da Propensão de CPC no Bloco 7 e já escolhe o 1º canal ótimo antes do primeiro disparo.',
  },
  {
    tool: 'Genesys Cloud CX (Outbound & Copilot)',
    category: 'Global CCaaS Leader',
    coreConcepts: 'Callable Time Sets por fuso IANA (tzdata), Pre-Call & Wrap-up Rules e diagnóstico operacional por linguagem natural (Copilot).',
    historicalLimitation: 'Depende de modelos externos (Snowflake/CRM) para carimbar colunas de BTTC e propensão a RPC na lista.',
    howVollEvolvesIt: 'Oferece o cérebro preditivo nativamente na esteira e devolve a lista enriquecida nos 8 blocos para qualquer plataforma.',
  },
  {
    tool: 'TrueAccord (HeartBeat) & Symend',
    category: 'AI Behavioral Collections',
    coreConcepts: 'Motor reativo sem régua fixa (HeartBeat) e Arquétipos Comportamentais (Symend) que adaptam canal, cadência e framing psicológico.',
    historicalLimitation: 'Calibrados para o mercado norte-americano (foco em e-mail/SMS, sem considerar a centralidade do WhatsApp e o fim de pacote de dados no Brasil).',
    howVollEvolvesIt: 'Combina arquétipos comportamentais com dados da TIC Domicílios 2025 e calendário brasileiro de liquidez (5º dia útil/INSS/Vale).',
  },
  {
    tool: 'FICO (CCS), TitanX (Phone-Intent) & Hiya (Branded Call)',
    category: 'Proactive Micro-Journeys & Voice Reputation',
    coreConcepts: 'Micro-jornadas coordenadas (Warm-up pré-ligação), classificação P1..P4 de quem realmente atende o telefone (TitanX) e chamada verificada/local (Hiya).',
    historicalLimitation: 'Ferramentas fragmentadas vendidas separadamente para vendas B2B ou grandes bancos.',
    howVollEvolvesIt: 'Integra Phone-Intent (P1..P4), Warm-up pré-chamada e política de BINA Local/Identificado dentro dos 8 blocos de cada contato.',
  },
];

/** Catálogo das 29 Hipóteses Estruturadas nas 5 Famílias (H-A, H-G, H-C, H-T, H-L) */
export const DEFAULT_STUDY_HYPOTHESES: {
  code: string;
  family: HypothesisFamily;
  title: string;
  description: string;
  publicEvidence: string;
  candidateVariables: string;
  internalTest: string;
  allowedDecision: string;
  benchmarkTool: string;
  productionWeight: number;
  labWeight: number;
}[] = [
  // 3.1 Idade, geração e maturidade digital (H-A1..A6)
  {
    code: 'H-A1',
    family: 'H-A',
    title: 'Disponibilidade real de canal explica mais que rótulo geracional',
    description: 'Diferenças de resultado por idade são explicadas parcialmente por uso real e disponibilidade de canal (ex.: 38% offline em 60+), e não somente pelo grupo geracional.',
    publicEvidence: 'TIC Domicílios 2025 (Tabelas C1 e C5)',
    candidateVariables: 'Faixa etária Cetic, presença de destino válido por canal, histórico de entrega técnica',
    internalTest: 'Comparar CPC por canal controlando por validade do destino e conectividade regional',
    allowedDecision: 'Ponderar mix de canais pela disponibilidade real sem criar bloqueio estereotipado por geração',
    benchmarkTool: 'TrueAccord HeartBeat + Cetic.br',
    productionWeight: 1.0,
    labWeight: 1.15,
  },
  {
    code: 'H-A2',
    family: 'H-A',
    title: 'Maior resposta digital em 16–34 anos modulada por finalidade',
    description: 'Usuários de 16–34 anos têm maior chance de resposta em canais digitais assíncronos que em chamada convencional, variando por assunto, urgência e relacionamento prévio.',
    publicEvidence: 'TIC Domicílios 2025 C5 (95%–97% mensageria) + Mobile Time Super Panorama 2026',
    candidateVariables: 'Idade 16–34, finalidade do prompt, relacionamento prévio, Phone-Intent Tier',
    internalTest: 'Experimento em ondas comparando 1º toque WhatsApp/E-mail vs. Voz direta em 16–34 anos',
    allowedDecision: 'Priorizar 1º toque digital assíncrono ou Voz com Warm-up para 16–34 anos',
    benchmarkTool: 'TitanX Phone-Intent + Symend',
    productionWeight: 1.1,
    labWeight: 1.25,
  },
  {
    code: 'H-A3',
    family: 'H-A',
    title: 'Competitividade de custo do E-mail na faixa 25–59 anos',
    description: 'O e-mail é altamente competitivo em custo por CPC para públicos urbanos de 25–59 anos (59%–74% de uso) quando há endereço válido e contexto esperado.',
    publicEvidence: 'TIC Domicílios 2025 C5 (74% em 25–34; 68% em 35–44; 59% em 45–59) + Twilio SendGrid BR',
    candidateVariables: 'Endereço de e-mail válido, idade 25–59, zona urbana/Sudeste/Sul/DF, finalidade esperada',
    internalTest: 'Testar passo inicial de E-mail contextual antes de canais tarifados por mensagem/minuto',
    allowedDecision: 'Incluir E-mail como Passo 1 econômico ou preparação de contexto para 25–59 com e-mail válido',
    benchmarkTool: 'TrueAccord + Twilio SendGrid',
    productionWeight: 1.0,
    labWeight: 1.2,
  },
  {
    code: 'H-A4',
    family: 'H-A',
    title: 'Identidade explicada e alternativa humana/voz para 60+ anos',
    description: 'Para pessoas 60+ (onde 38% são offline e entre os online 81% são mobile-only), um plano com identificação clara, Voz local e opção humana supera sequências 100% digitais.',
    publicEvidence: 'TIC Domicílios 2025 C1 (62% internet), C5 (83% mensageria nos online) e C16A (81% só celular)',
    candidateVariables: 'Faixa 60+, presença de telefone fixo/móvel, DDD local',
    internalTest: 'Comparar sequência Voz Local Matinal + WhatsApp assistido vs. régua digital automática em 60+',
    allowedDecision: 'Combinar Voz identificada na janela matinal com WhatsApp de texto claro e opção humana',
    benchmarkTool: 'OlosChannel + Hiya Branded Call',
    productionWeight: 1.15,
    labWeight: 1.3,
  },
  {
    code: 'H-A5',
    family: 'H-A',
    title: 'Sinais individuais recentes prevalecem sobre idade demográfica',
    description: 'Preferência informada, canal de origem do relacionamento, respostas anteriores e validade do destino explicam mais o CPC do que a idade isolada.',
    publicEvidence: 'Genesys CX LATAM + Histórico Operacional Voll',
    candidateVariables: 'Tabulações anteriores de CPC, canal de última interação, preferência declarada',
    internalTest: 'Medir ganho de Brier Score ao sobrepor histórico individual ao prior etário',
    allowedDecision: 'Sobrescrever prior demográfico sempre que houver evidência individual observada',
    benchmarkTool: 'TrueAccord HeartBeat',
    productionWeight: 1.2,
    labWeight: 1.25,
  },
  {
    code: 'H-A6',
    family: 'H-A',
    title: 'Monitoramento dinâmico de coorte etária no tempo',
    description: 'Efeitos geracionais aparentes mudam com o tempo e com filtros antispam; os pesos devem ser recalibrados pelas ondas do Modo Laboratório.',
    publicEvidence: 'Metodologia Científica Voll Fase 5 e 6',
    candidateVariables: 'Coorte temporal da campanha, deriva de taxa de atendimento por faixa',
    internalTest: 'Comparar estabilidade dos coeficientes entre ondas sucessivas do Laboratório',
    allowedDecision: 'Atualizar pesos de produção via promoção de ondas validadas no Laboratório',
    benchmarkTool: 'Voll Connect Lab Engine',
    productionWeight: 1.0,
    labWeight: 1.1,
  },

  // 3.2 Região, município e contexto de vida (H-G1..G5)
  {
    code: 'H-G1',
    family: 'H-G',
    title: 'DDD e Região definem Fuso Horário IANA e janela local',
    description: 'Região e DDD determinam o fuso horário legal (America/Sao_Paulo, Cuiaba, Manaus, Rio_Branco) e a janela local, sem substituir hábitos individuais.',
    publicEvidence: 'Anatel + Base IBGE/IANA tzdata',
    candidateVariables: 'DDD do destino, UF, fuso horário IANA',
    internalTest: 'Auditoria de zero disparos fora da janela local permitida no fuso do destinatário',
    allowedDecision: 'Ajustar automaticamente todas as janelas horárias para o fuso IANA do DDD do contato',
    benchmarkTool: 'Genesys Callable Time Sets + Aspect ALM',
    productionWeight: 1.0,
    labWeight: 1.0,
  },
  {
    code: 'H-G2',
    family: 'H-G',
    title: 'Porte municipal IBGE e deslocamento urbano modulam atendimento',
    description: 'Em grandes metrópoles (>1M hab.), o deslocamento reduz o atendimento de voz em horário comercial e eleva a leitura de mensageria no início da manhã, almoço e fim de tarde.',
    publicEvidence: 'IBGE Censo 2022 / Estimativas Populacionais + Cetic.br',
    candidateVariables: 'Porte municipal IBGE (Metrópole, Polo Regional, Interior), DDD, turno do dia',
    internalTest: 'Comparar CPC por turno entre Metrópoles (DDD 11/21/31) e Interior (<100k hab.)',
    allowedDecision: 'Alocar janelas de deslocamento/almoço para metrópoles e preservar horário de almoço no interior',
    benchmarkTool: 'Altitude uCI BTTC + IBGE',
    productionWeight: 1.05,
    labWeight: 1.2,
  },
  {
    code: 'H-G3',
    family: 'H-G',
    title: 'Adaptação ao esgotamento de franquia de dados móveis (Norte, Nordeste e Rural)',
    description: '39% dos brasileiros ficam sem pacote de dados móveis (46% Rural, 49% Nordeste, 54% Norte). Mensagens digitais leves nas janelas de Wi-Fi (almoço/noite) ou fallback SMS/Voz reduzem perda de entrega.',
    publicEvidence: 'TIC Domicílios 2025 (Indicador de encerramento de pacote de dados móveis)',
    candidateVariables: 'Macrorregião (Norte/Nordeste), porte interior/rural, índice de esgotamento de dados do DDD',
    internalTest: 'Testar disparo WhatsApp na janela Wi-Fi (12h–13h30 / 19h–21h) + fallback SMS vs. disparo 15h',
    allowedDecision: 'Priorizar janelas de conexão Wi-Fi e mensagens de baixo consumo de dados em DDDs com >45% de esgotamento',
    benchmarkTool: 'Voll Connect Brazil Intelligence',
    productionWeight: 1.1,
    labWeight: 1.35,
  },
  {
    code: 'H-G4',
    family: 'H-G',
    title: 'Sincronização com calendário de liquidez e sazonalidade de renda',
    description: 'Dias de pagamento salarial (1º ao 5º dia útil CLT, calendário INSS e vale dia 20) elevam a disposição para atender e resolver pendências financeiras.',
    publicEvidence: 'Calendário Bancário Febraban / INSS + Economia Comportamental (Symend)',
    candidateVariables: 'Data de referência da operação, finalidade cobrança/vendas, dia do mês',
    internalTest: 'Comparar Custo por CPC na janela de liquidez (dias 01–08 e 20–22) vs. vale da esquiva',
    allowedDecision: 'Concentrar canais de maior tarifa nas janelas de liquidez e usar canais econômicos fora delas',
    benchmarkTool: 'Symend Behavioral Engine',
    productionWeight: 1.05,
    labWeight: 1.2,
  },
  {
    code: 'H-G5',
    family: 'H-G',
    title: 'Detecção de mobilidade regional sem geolocalização invasiva',
    description: 'Divergência entre DDD dos telefones ou UF cadastrada indica migração interna; manter fuso mais conservador sem coleta invasiva de localização.',
    publicEvidence: 'Diretrizes LGPD/ANPD + IBGE Migração',
    candidateVariables: 'Múltiplos DDDs no mesmo cadastro, UF cadastral vs. DDD do celular',
    internalTest: 'Verificar interseção de janela segura quando contato possui DDDs de fusos distintos',
    allowedDecision: 'Aplicar janela horária compatível com ambos os fusos quando houver divergência',
    benchmarkTool: 'Genesys Cloud Compliance',
    productionWeight: 1.0,
    labWeight: 1.0,
  },

  // 3.3 Canal, contexto e identidade (H-C1..C8)
  {
    code: 'H-C1',
    family: 'H-C',
    title: 'Separação estrita entre entrega/leitura no WhatsApp e CPC confirmado',
    description: 'WhatsApp tem 92% de alcance entre internautas, mas mensagem entregue ou lida não equivale a CPC até haver confirmação do titular na tabulação.',
    publicEvidence: 'TIC Domicílios 2025 C5 + Definição Oficial de CPC Voll (§1)',
    candidateVariables: 'Eventos DELIVERY_CONFIRMED, READ_NO_REPLY vs. Tabulação com is_cpc = true',
    internalTest: 'Reconciliar funil de entrega/leitura contra tabulação efetiva de pessoa certa',
    allowedDecision: 'Contabilizar no denominador de CPC exclusivamente contatos com pessoa certa tabulada',
    benchmarkTool: 'Voll Connect Core Ledger',
    productionWeight: 1.0,
    labWeight: 1.0,
  },
  {
    code: 'H-C2',
    family: 'H-C',
    title: 'Micro-jornada de Warm-up contextual pré-chamada destrava atendimento',
    description: 'Enviar mensagem curta e identificada (SMS/WhatsApp) minutos antes da ligação eleva a taxa de atendimento em perfis P2 e reduz marcação de spam.',
    publicEvidence: 'FICO CCS + NICE ContactEngine + Hiya State of the Call',
    candidateVariables: 'Phone-Intent Tier P2, finalidade relevante, disponibilidade de SMS/WhatsApp + Voz',
    internalTest: 'Onda Laboratório comparando Voz fria (3 tentativas) vs. 1 Warm-up + 1 Voz identificada',
    allowedDecision: 'Ativar micro-jornada Warm-up -> Voz quando o ganho de CPC compensar o custo marginal do aviso',
    benchmarkTool: 'FICO CCS + NICE ContactEngine',
    productionWeight: 1.1,
    labWeight: 1.35,
  },
  {
    code: 'H-C3',
    family: 'H-C',
    title: 'Equilíbrio entre confirmação forte de identidade na Voz e risco de bloqueio',
    description: 'A chamada telefônica confirma identidade rapidamente quando atendida, mas exige controle rigoroso de tentativas e BINA para não sofrer bloqueio de rede.',
    publicEvidence: 'Diretrizes Anatel Ago/2026 + Mobile Time/DialMyApp 2024',
    candidateVariables: 'Saturação de spam do DDD, histórico de atendimento de voz, teto diário',
    internalTest: 'Monitorar queda marginal de atendimento após a 2ª tentativa de voz sem resposta',
    allowedDecision: 'Limitar insistência cega de voz e transbordar para canal digital após 2 tentativas sem atendimento',
    benchmarkTool: 'OlosChannel + Anatel Guardrails',
    productionWeight: 1.1,
    labWeight: 1.25,
  },
  {
    code: 'H-C4',
    family: 'H-C',
    title: 'E-mail como ancoragem de contexto e opção de autoatendimento',
    description: 'O e-mail fornece contexto detalhado com custo próximo de zero, preparando a confiança para o contato subsequente ou gerando retorno espontâneo.',
    publicEvidence: 'Twilio SendGrid 2024 + TrueAccord',
    candidateVariables: 'Presença de e-mail válido, faixa 25–59, finalidade com documento/fatura/contexto',
    internalTest: 'Medir redução no custo total até CPC quando e-mail precede acionamento móvel',
    allowedDecision: 'Usar e-mail como âncora de baixo custo sem tratar abertura isolada como CPC',
    benchmarkTool: 'TrueAccord HeartBeat',
    productionWeight: 1.0,
    labWeight: 1.15,
  },
  {
    code: 'H-C5',
    family: 'H-C',
    title: 'SMS como fallback leve onde o pacote de dados móveis falha',
    description: 'SMS independe de pacote de dados ativo (GSM), funcionando como lembrete ou ponte de retorno em áreas com alta restrição de franquia móvel.',
    publicEvidence: 'TIC Domicílios 2025 (39%–54% sem dados móveis) + Preços Twilio/Operadoras',
    candidateVariables: 'Falha de entrega WhatsApp, DDD com alta exaustão de dados, celular válido',
    internalTest: 'Testar fallback SMS curto com número de retorno quando mensagem IP não entrega',
    allowedDecision: 'Acionar SMS quando houver sombra de dados móveis ou como pré-aviso econômico',
    benchmarkTool: 'Aspect ALM + Infobip',
    productionWeight: 1.0,
    labWeight: 1.15,
  },
  {
    code: 'H-C6',
    family: 'H-C',
    title: 'Identidade do remetente e Presença Local (DDD Local) superam geração',
    description: 'BINA com mesmo DDD do cliente (especialmente no Sul, MG, Interior e Nordeste) e identificação verificada da marca reduzem rejeição mais do que segmentação etária.',
    publicEvidence: 'Hiya Branded Calling + ServiceNow Consumer Voice Brasil + Genesys CX',
    candidateVariables: 'Sensibilidade a DDD local da região, disponibilidade de DID local ou conta verificada',
    internalTest: 'A/B entre discagem com DID Local/Branded vs. número genérico de outra UF',
    allowedDecision: 'Prescrever obrigatoriedade de DID Local ou Remetente Verificado no Bloco 8 (Governança)',
    benchmarkTool: 'Hiya Branded Call + Orum/Nooks Local Presence',
    productionWeight: 1.2,
    labWeight: 1.35,
  },
  {
    code: 'H-C7',
    family: 'H-C',
    title: 'Finalidade informada no Prompt Inicial redefine a árvore de canais',
    description: 'Atendimento solicitado, confirmação de serviço, pesquisa, vendas e cobrança possuem expectativas distintas e não devem compartilhar a mesma política.',
    publicEvidence: 'Mobile Time/DialMyApp 2024 + Symend + Decisão de Produto Voll (§8)',
    candidateVariables: 'purposeCode e purposePrompt informados pelo usuário no início da operação',
    internalTest: 'Comparar elasticidade de resposta por canal entre finalidades transacionais vs. cobrança/vendas',
    allowedDecision: 'Calibrar pesos de canal, framing e limite de tentativas a partir do Prompt Inicial de Finalidade',
    benchmarkTool: 'Symend + Genesys Copilot',
    productionWeight: 1.15,
    labWeight: 1.25,
  },
  {
    code: 'H-C8',
    family: 'H-C',
    title: 'Diferenciação entre primeiro contato desconhecido e relacionamento ativo',
    description: 'Contatos sem histórico prévio exigem construção de contexto e modo de privacidade (LCM) antes de expor detalhes sensíveis.',
    publicEvidence: 'Termômetro Digital 2025 (74% atendimento receptivo) + Reg F / LGPD',
    candidateVariables: 'history_total, tabulações anteriores no workspace, origem do cadastro',
    internalTest: 'Avaliar taxa de bloqueio/opt-out no 1º toque com e sem apresentação contextual',
    allowedDecision: 'Ativar Limited Content Message (LCM) e identificação reforçada quando não houver CPC prévio',
    benchmarkTool: 'Aspect ALM (LCM) + Meta/Kantar',
    productionWeight: 1.05,
    labWeight: 1.15,
  },

  // 3.4 Horário e sequência (H-T1..T6)
  {
    code: 'H-T1',
    family: 'H-T',
    title: 'Janelas horárias adaptadas à rotina regional e finalidade',
    description: 'Não existe um único "melhor horário brasileiro"; a janela ótima emerge da combinação entre canal, porte do município, idade e finalidade.',
    publicEvidence: 'Pesquisas Mobile Time/Opinion Box + Telemetria Operacional',
    candidateVariables: 'Canal, porte municipal IBGE, faixa etária, finalidade do prompt',
    internalTest: 'Randomizar faixas horárias dentro dos turnos permitidos nas ondas do Laboratório',
    allowedDecision: 'Atribuir janela horária personalizada no Bloco 4 de cada contato',
    benchmarkTool: 'Olos BTTC + Genesys Outbound',
    productionWeight: 1.05,
    labWeight: 1.2,
  },
  {
    code: 'H-T2',
    family: 'H-T',
    title: 'Matriz de Reciclagem de Turno (Shift Recycling Matrix)',
    description: 'Quando uma tentativa falha em um turno (ex.: Manhã 08h–11h), a próxima tentativa deve rotacionar para turno distinto (Almoço, Fim de Tarde, Noite Digital ou Sábado).',
    publicEvidence: 'Engenharia Altitude uCI + Genesys Smart Recycling',
    candidateVariables: 'Horário das tentativas anteriores sem CPC, disponibilidade de turnos futuros',
    internalTest: 'Comparar CPC incremental de retentativa em turno alternado vs. mesmo turno',
    allowedDecision: 'Gerar ordem obrigatória de rotação de turnos no Bloco 4 (Horário) e Bloco 5 (Tentativas)',
    benchmarkTool: 'Altitude uCI (Shift Recycling Matrix)',
    productionWeight: 1.15,
    labWeight: 1.3,
  },
  {
    code: 'H-T3',
    family: 'H-T',
    title: 'Memória do horário de resposta anterior (BTTC Individual Observado)',
    description: 'Se o contato já atendeu ou respondeu anteriormente em determinada faixa horária, essa evidência observada prediz a melhor janela futura.',
    publicEvidence: 'Histórico de Eventos Voll (attempt_events) + Literatura de BTTC',
    candidateVariables: 'Timestamp de tentativas anteriores com tabulação de CPC ou resposta humana',
    internalTest: 'Medir lift de CPC ao acionar dentro de ±60 min do horário histórico de sucesso',
    allowedDecision: 'Priorizar janela histórica observada e rotular origem como HISTORICO_OBSERVADO no Bloco 4',
    benchmarkTool: 'Olos BTTC + TrueAccord',
    productionWeight: 1.25,
    labWeight: 1.3,
  },
  {
    code: 'H-T4',
    family: 'H-T',
    title: 'Intervalo ótimo de espera (Cooldown) entre canais para evitar fadiga',
    description: 'Respeitar janela de reação após envio assíncrono antes do fallback reduz custo duplicado e evita sensação de perseguição.',
    publicEvidence: 'Opinion Box WhatsApp 2026 + Diretrizes Anatel de Proporcionalidade',
    candidateVariables: 'Tempo médio de leitura/resposta por canal, feedbackTimeoutMinutes',
    internalTest: 'Testar intervalos de espera (ex.: 45 min vs. 180 min vs. turno seguinte) antes do passo 2',
    allowedDecision: 'Definir intervalo mínimo de espera e supressão imediata caso o cliente responda',
    benchmarkTool: 'NICE ContactEngine + Aspect ALM',
    productionWeight: 1.05,
    labWeight: 1.15,
  },
  {
    code: 'H-T5',
    family: 'H-T',
    title: 'Alternância multimodal supera repetição insistente no mesmo canal',
    description: 'Alternar canal após falha (ex.: E-mail -> WhatsApp -> Voz Local) entrega maior CPC incremental por real gasto do que repetir 6 vezes o mesmo canal.',
    publicEvidence: 'Infobip Messaging Trends 2026 + Dados Internos de Saturação',
    candidateVariables: 'Quantidade de destinos válidos em canais distintos, tarifa marginal de cada canal',
    internalTest: 'Comparar sequência multimodal vs. sequência unicanal com mesmo orçamento máximo',
    allowedDecision: 'Montar sequência multimodal no Bloco 5 sempre que o contato possuir múltiplos canais válidos',
    benchmarkTool: 'OlosChannel + Infobip',
    productionWeight: 1.15,
    labWeight: 1.3,
  },
  {
    code: 'H-T6',
    family: 'H-T',
    title: 'Soberania absoluta do retorno solicitado pelo cliente (Callback)',
    description: 'Quando o cliente solicita retorno em horário ou canal específico, esse compromisso prevalece sobre qualquer score estatístico.',
    publicEvidence: 'Genesys CX + Altitude uCI + Código de Defesa do Consumidor',
    candidateVariables: 'Atributo de retorno agendado ou preferência declarada no cadastro/tabulação',
    internalTest: 'Auditar 100% de aderência ao canal e horário solicitados pelo titular',
    allowedDecision: 'Travar canal e janela exatamente conforme solicitado pelo cliente',
    benchmarkTool: 'Altitude uCI + Aspect ALM',
    productionWeight: 1.5,
    labWeight: 1.5,
  },

  // 3.5 Qualidade da lista e custos (H-L1..L6)
  {
    code: 'H-L1',
    family: 'H-L',
    title: 'Locator Score: separar validade do destino da propensão do cliente',
    description: 'Validade sintática, tipo de linha e histórico de entrega técnica do telefone/e-mail explicam grande parcela do CPC e devem ser separados do score comportamental.',
    publicEvidence: 'Olos Locator + TitanX Data Hygiene',
    candidateVariables: 'Formato E.164, histórico INVALID_NUMBER, confirmação de entrega anterior, prioridade cadastral',
    internalTest: 'Isolar taxa de falha técnica de rede da taxa de recusa/não resposta humana',
    allowedDecision: 'Exibir Score de Validade do Destino (Locator) separadamente da Probabilidade de CPC no Bloco 7',
    benchmarkTool: 'Olos Locator + Orum Scout AI',
    productionWeight: 1.2,
    labWeight: 1.25,
  },
  {
    code: 'H-L2',
    family: 'H-L',
    title: 'Descarte de números reciclados ou de terceiros (Wrong Person)',
    description: 'Destinos tabulados como WRONG_PERSON (terceiro) ou INVALID_NUMBER geram falsos sinais e risco de exposição indevida; devem ser invalidados para aquele titular.',
    publicEvidence: 'Regras CFPB Reg F / LGPD + Tabulações Voll (invalidates_destination)',
    candidateVariables: 'Histórico de tabulações WRONG_PERSON e INVALID_NUMBER por destination_id',
    internalTest: 'Verificar redução de custo inútil e erro de identidade ao bloquear destinos de terceiros',
    allowedDecision: 'Bloquear destino com confirmação de terceiro e avançar para destino alternativo do titular',
    benchmarkTool: 'Aspect ALM + Voll Eligibility Engine',
    productionWeight: 1.3,
    labWeight: 1.3,
  },
  {
    code: 'H-L3',
    family: 'H-L',
    title: 'Taxonomia unificada de tabulações de CPC',
    description: 'Somente tabulações explicitamente auditadas como confirmação da pessoa certa entram no numerador de CPC, preservando o código original do conector.',
    publicEvidence: 'Especificação Voll Connect (§1 e §8 do Plano de Estudo)',
    candidateVariables: 'tabulations.is_cpc, código original do provedor, origem humano/automação',
    internalTest: 'Auditoria cruzada entre eventos brutos do conector e indicador de CPC confirmado',
    allowedDecision: 'Manter separação estrita no Bloco 2 entre CPC Estimado e CPC Confirmado por Tabulação',
    benchmarkTool: 'Voll Connect Audit Ledger',
    productionWeight: 1.0,
    labWeight: 1.0,
  },
  {
    code: 'H-L4',
    family: 'H-L',
    title: 'Otimização pelo Custo Efetivo Completo até CPC (ECPC Solver)',
    description: 'Um canal de tarifa unitária baixa (ex.: Voz R$ 0,12 com 4% de CPC = R$ 3,00/CPC) pode ser muito mais caro por CPC efetivo do que um canal combinado com 35% de CPC.',
    publicEvidence: 'Economia de Operações Voll + Preços Vigentes de Conectores',
    candidateVariables: 'Tarifa por tentativa de cada canal, probabilidade condicional de CPC em cada passo',
    internalTest: 'Comparar Custo Real por CPC Confirmado da sequência otimizada vs. ordem fixa',
    allowedDecision: 'Ordenar a fila de contatos e escolher a sequência que minimiza o Custo Esperado por CPC',
    benchmarkTool: 'Voll Connect ECPC Solver',
    productionWeight: 1.25,
    labWeight: 1.35,
  },
  {
    code: 'H-L5',
    family: 'H-L',
    title: 'Valor informacional de descoberta no 1º toque em contatos inéditos',
    description: 'Para contatos sem histórico algum, a 1ª tentativa em canal econômico possui valor de descoberta (validar existência e atividade do destino).',
    publicEvidence: 'Teoria de Multi-Armed Bandits / Exploration Value',
    candidateVariables: 'Ausência de tentativas anteriores (history_total IS NULL ou 0), custo do 1º passo',
    internalTest: 'Avaliar ganho de informação na 1ª tentativa econômica antes de alocar canal premium',
    allowedDecision: 'Incluir passo de validação/descoberta de baixo custo para registros sem histórico conhecido',
    benchmarkTool: 'TrueAccord + Multi-Armed Bandit Lab',
    productionWeight: 1.0,
    labWeight: 1.2,
  },
  {
    code: 'H-L6',
    family: 'H-L',
    title: 'Controle Anti-Manipulação (Cobertura vs. Custo) e Amostragem de Laboratório',
    description: 'Impedir que o custo por CPC pareça baixo apenas por excluir contatos difíceis; reportar Cobertura Elegível (%) e usar amostragem estratificada no Laboratório.',
    publicEvidence: 'Diretrizes de Governança Voll (§1 e §7 do Plano de Estudo)',
    candidateVariables: 'Taxa de cobertura elegível da lista, proporção de excluídos, tamanho da amostra de laboratório',
    internalTest: 'Auditar que toda redução de custo mantenha cobertura elegível e significância estatística',
    allowedDecision: 'Exibir Cobertura (%) lado a lado com Custo/CPC e particionar amostra estatisticamente viável no Laboratório',
    benchmarkTool: 'Voll Connect Dual Mode Governance',
    productionWeight: 1.0,
    labWeight: 1.0,
  },
];

/** Fases do Plano de Estudo (Fases 0 a 6 — §4 do documento) */
export const STUDY_ROADMAP_PHASES = [
  {
    phase: 'Fase 0',
    title: 'Definição de problema, taxonomia de CPC e guardrails',
    horizon: '1–2 semanas',
    status: 'IMPLEMENTADO_NA_ESTEIRA',
    deliverables: 'Dicionário de eventos separando Entrega, Leitura, Resposta, Terceiro e CPC Confirmado por tabulação; coleta da finalidade no prompt inicial e métricas de guarda.',
  },
  {
    phase: 'Fase 1',
    title: 'Revisão de dados, Locator Score e catálogo de fontes agregadas',
    horizon: '2–3 semanas',
    status: 'IMPLEMENTADO_NA_ESTEIRA',
    deliverables: 'Scorecard de qualidade cadastral por destino, dicionário de tarifas por canal e catálogo versionado TIC Domicílios 2025 / IBGE / Anatel.',
  },
  {
    phase: 'Fase 2',
    title: 'Pesquisa qualitativa de barreiras, confiança e receio de fraude',
    horizon: '3–4 semanas',
    status: 'EM_CALIBRACAO_CONTINUA',
    deliverables: 'Mapeamento de gatilhos de confiança (DDD local, identificação do remetente, warm-up pré-chamada e modo de privacidade LCM).',
  },
  {
    phase: 'Fase 3',
    title: 'Calibração quantitativa de segmentos e pacote de dados regional',
    horizon: '4–6 semanas',
    status: 'IMPLEMENTADO_NA_ESTEIRA',
    deliverables: 'Estratificação pelas 5 macrorregiões, faixas etárias Cetic (16–24 a 60+), porte municipal IBGE e ajuste para esgotamento de pacote de dados móveis (39%–54%).',
  },
  {
    phase: 'Fase 4',
    title: 'Experimentos em campo via Modo Laboratório (Ondas Multi-Dia)',
    horizon: 'Contínuo por carteira (2–7 dias por piloto)',
    status: 'ATIVO_MODO_LABORATORIO',
    deliverables: 'Particionamento de amostra estatisticamente viável, disparo de ondas diárias nos acionadores, coleta de tabulações reais, ajuste automático e promoção para Produção.',
  },
  {
    phase: 'Fase 5',
    title: 'Modelagem sequencial, explicabilidade em 8 Blocos e revisão humana',
    horizon: 'Contínuo',
    status: 'IMPLEMENTADO_NA_ESTEIRA',
    deliverables: 'Previsão condicionada a canal/janela com distinção explícita entre Dado Observado, Inferência Contextual e Prior Inicial, mais botão de revisão humana (ANPD).',
  },
  {
    phase: 'Fase 6',
    title: 'Operação Dual (Produção + Laboratório) e monitoramento de deriva',
    horizon: 'Operação Permanente',
    status: 'ATIVO_OPERACAO_DUAL',
    deliverables: 'Execução simultânea de Produção (escala imediata) e Laboratório (aprendizado contínuo), exportação CSV/JSON dos 8 blocos e reconciliação de tabulações.',
  },
];

const SENIOR_NAMES = new Set([
  'jose', 'antonio', 'francisco', 'joao', 'sebastiao', 'geraldo', 'raimundo', 'manoel', 'benedito', 'valdemar',
  'maria', 'aparecida', 'francisca', 'antonia', 'vera', 'dirce', 'tereza', 'conceicao', 'lourdes', 'marlene',
  'otavio', 'osvaldo', 'waldir', 'neusa', 'iracema',
]);
const GENX_NAMES = new Set([
  'marcio', 'marcelo', 'sandro', 'sergio', 'ricardo', 'fábio', 'fabio', 'marcos', 'wagner', 'claudio',
  'adriana', 'patricia', 'simone', 'cristiane', 'luciana', 'claudia', 'renata', 'sandra', 'elisa', 'paula',
]);
const MILLENNIAL_NAMES = new Set([
  'rodrigo', 'bruno', 'tiago', 'rafael', 'diego', 'leandro', 'felipe', 'guilherme', 'lucas', 'gustavo',
  'juliana', 'camila', 'larissa', 'amanda', 'natalia', 'carla', 'fernanda', 'priscila', 'vanessa', 'tatiane',
]);
const GENZ_NAMES = new Set([
  'enzo', 'caua', 'kayky', 'pietro', 'heitor', 'davi', 'miguel', 'arthur', 'theo', 'ryan',
  'valentina', 'yasmin', 'giovanna', 'vitoria', 'isabela', 'sofia', 'lara', 'manuella', 'ana', 'gabriela',
]);

const normalizeToken = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export function resolveDddProfile(phones: string[], fallbackUf?: string): DddProfile {
  for (const raw of phones) {
    const digits = raw.replace(/\D/g, '');
    const ddd = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2, 4) : digits.slice(0, 2);
    if (BRAZIL_DDD_CATALOG[ddd]) return BRAZIL_DDD_CATALOG[ddd];
  }
  if (fallbackUf) {
    const ufUp = fallbackUf.trim().toUpperCase();
    const match = Object.values(BRAZIL_DDD_CATALOG).find((d) => d.uf === ufUp);
    if (match) return match;
  }
  return BRAZIL_DDD_CATALOG['11'];
}

export function resolveAgeBracket(
  attributes: Record<string, unknown>,
  name?: string | null,
  hasLandline?: boolean,
): {
  bracket: CeticAgeBracket;
  estimatedAge: number | null;
  source: 'OBSERVADO_CADASTRO' | 'INFERENCIA_CONTEXTUAL' | 'PRIOR_INICIAL';
  confidencePct: number;
} {
  // 1. Verifica campos explícitos de idade ou data de nascimento no cadastro
  for (const [k, v] of Object.entries(attributes ?? {})) {
    const key = normalizeToken(k);
    if (v === null || v === undefined || v === '') continue;
    if (['idade', 'age', 'anos'].includes(key)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 16 && n <= 105) {
        return { bracket: ageToBracket(n), estimatedAge: n, source: 'OBSERVADO_CADASTRO', confidencePct: 98 };
      }
    }
    if (['datanascimento', 'dtnasc', 'nascimento', 'birthdate', 'data_nascimento'].includes(key)) {
      const s = String(v).trim();
      const mYear = s.match(/(19\d{2}|20[01]\d)/);
      if (mYear) {
        const age = 2026 - Number(mYear[1]);
        if (age >= 16 && age <= 105) {
          return { bracket: ageToBracket(age), estimatedAge: age, source: 'OBSERVADO_CADASTRO', confidencePct: 98 };
        }
      }
    }
  }

  // 2. Prior contextual demográfico (apenas como agrupamento analítico secundário com incerteza explícita)
  const firstName = normalizeToken((name ?? '').split(/\s+/)[0] ?? '');
  if (SENIOR_NAMES.has(firstName) || (hasLandline && GENX_NAMES.has(firstName))) {
    return { bracket: '60_PLUS', estimatedAge: 66, source: 'INFERENCIA_CONTEXTUAL', confidencePct: 74 };
  }
  if (GENX_NAMES.has(firstName)) {
    return { bracket: '45_59', estimatedAge: 51, source: 'INFERENCIA_CONTEXTUAL', confidencePct: 72 };
  }
  if (MILLENNIAL_NAMES.has(firstName)) {
    return { bracket: '35_44', estimatedAge: 38, source: 'INFERENCIA_CONTEXTUAL', confidencePct: 71 };
  }
  if (GENZ_NAMES.has(firstName)) {
    return { bracket: '25_34', estimatedAge: 27, source: 'INFERENCIA_CONTEXTUAL', confidencePct: 68 };
  }
  if (hasLandline) {
    return { bracket: '45_59', estimatedAge: 52, source: 'PRIOR_INICIAL', confidencePct: 58 };
  }
  return { bracket: '35_44', estimatedAge: null, source: 'PRIOR_INICIAL', confidencePct: 55 };
}

function ageToBracket(age: number): CeticAgeBracket {
  if (age <= 24) return '16_24';
  if (age <= 34) return '25_34';
  if (age <= 44) return '35_44';
  if (age <= 59) return '45_59';
  return '60_PLUS';
}
