import {
  AUDIENCE_SEGMENT_METADATA,
  PURPOSE_METADATA,
  type AudienceSegment,
  type ChannelType,
  type OperationPurpose,
} from '@voll/shared';
import type { MailingSummary } from './types';

export type ParsedCampaignFilter = {
  field: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  value: any;
  label: string;
};

export type ParsedCampaignSort = {
  field: string;
  dir: 'asc' | 'desc';
  label: string;
};

export type ParsedCampaignResult = {
  purposeCode: OperationPurpose;
  audienceSegment: AudienceSegment;
  campaignName: string;
  description: string;
  extractedFilters: ParsedCampaignFilter[];
  extractedSort: ParsedCampaignSort;
  recommendedChannels: ChannelType[];
  cadenceSummary: string;
  maxCpcBrl: number;
  expectedRatePct: number;
  unitCostBrl: number;
  gainOrSavingsPct: number;
};

/**
 * Motor de Interpretação por IA (NLP Parser)
 * Extrai Objetivo, Segmento B2B/B2C, Filtros e Ordenação a partir de texto em linguagem natural.
 */
export function parseCampaignPrompt(
  prompt: string,
  mailing?: MailingSummary | null,
): ParsedCampaignResult {
  const p = prompt.toLowerCase();
  const todayStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  // 1. Objetivo Operacional
  let purposeCode: OperationPurpose = 'COBRANCA';
  const isAppointment =
    p.includes('agenda') ||
    p.includes('consulta') ||
    p.includes('exame') ||
    p.includes('visita') ||
    p.includes('medico') ||
    p.includes('clinica') ||
    p.includes('lembrete') ||
    p.includes('comparecimento') ||
    p.includes('no-show') ||
    p.includes('reagendar');

  const isDebt =
    p.includes('cobrança') ||
    p.includes('cobranca') ||
    p.includes('inadimplen') ||
    p.includes('recupera') ||
    p.includes('atraso') ||
    p.includes('dívida') ||
    p.includes('divida') ||
    p.includes('faturamento') ||
    p.includes('título') ||
    p.includes('titulo') ||
    p.includes('boleto') ||
    p.includes('acordo');

  const isSales =
    p.includes('venda') ||
    p.includes('oferta') ||
    p.includes('upgrade') ||
    p.includes('adesao') ||
    p.includes('prospec') ||
    p.includes('cross-sell') ||
    p.includes('upsell') ||
    p.includes('lead') ||
    (p.includes('comercial') && !p.includes('horário comercial') && !p.includes('horario comercial') && !isDebt);

  if (isAppointment) {
    purposeCode = 'AGENDAMENTOS';
  } else if (isDebt) {
    purposeCode = 'COBRANCA';
  } else if (isSales) {
    purposeCode = 'VENDAS';
  }

  // 2. Segmento do Público (B2B vs B2C)
  let audienceSegment: AudienceSegment = 'B2C';
  const mailingNameLower = (mailing?.name ?? '').toLowerCase();
  const hasB2bKeywords =
    p.includes('b2b') ||
    p.includes('empresa') ||
    p.includes('pj') ||
    p.includes('cnpj') ||
    p.includes('corporativ') ||
    p.includes('juridic') ||
    p.includes('pme') ||
    p.includes('razao social') ||
    mailingNameLower.includes('b2b') ||
    mailingNameLower.includes('cnpj') ||
    mailingNameLower.includes('pj') ||
    mailingNameLower.includes('empresa');

  if (p.includes('misto') || p.includes('hibrid') || p.includes('ambos')) {
    audienceSegment = 'MIXED';
  } else if (hasB2bKeywords) {
    audienceSegment = 'B2B';
  }

  // 3. Extração de Filtros em Linguagem Natural
  const extractedFilters: ParsedCampaignFilter[] = [];

  // Filtro de dias de atraso (ex: "atraso maior que 30", "atraso superior a 30 dias", "mais de 45 dias", "atraso > 60")
  const delayMatch = p.match(/(?:atraso|vencid[oa]s?|atrasad[oa]s?|faixa)\s*(?:maior|superior|acima|mais|de|>|\>=)?\s*(?:que|de|a)?\s*(\d+)\s*dias?/);
  if (delayMatch) {
    const days = parseInt(delayMatch[1], 10);
    extractedFilters.push({
      field: 'dias_atraso',
      op: 'gte',
      value: days,
      label: `Atraso superior a ${days} dias`,
    });
  }

  // Filtro de valor da dívida (ex: "valor acima de 500", "dívida maior que R$ 300", "> 1000")
  const valueMatch = p.match(/(?:valor|d[ií]vida|saldo|d[eé]bito)\s*(?:maior|superior|acima|mais|>|\>=)?\s*(?:que|de)?\s*(?:r\$)?\s*(\d+[\d.,]*)/);
  if (valueMatch) {
    const cleanVal = parseFloat(valueMatch[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(cleanVal) && cleanVal > 0) {
      extractedFilters.push({
        field: 'valor_divida',
        op: 'gte',
        value: cleanVal,
        label: `Valor superior a R$ ${cleanVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      });
    }
  }

  // Filtro de estado / região (ex: "SP", "São Paulo", "RJ", "Rio", "Sudeste")
  if (p.includes('são paulo') || p.includes(' sp ') || p.endsWith(' sp')) {
    extractedFilters.push({ field: 'uf', op: 'eq', value: 'SP', label: 'Estado: São Paulo (SP)' });
  } else if (p.includes('rio de janeiro') || p.includes(' rj ') || p.endsWith(' rj')) {
    extractedFilters.push({ field: 'uf', op: 'eq', value: 'RJ', label: 'Estado: Rio de Janeiro (RJ)' });
  } else if (p.includes('minas') || p.includes(' mg ') || p.endsWith(' mg')) {
    extractedFilters.push({ field: 'uf', op: 'eq', value: 'MG', label: 'Estado: Minas Gerais (MG)' });
  }

  // Filtro de Sênior / Idade
  if (p.includes('senior') || p.includes('sênior') || p.includes('idoso') || p.includes('60+')) {
    extractedFilters.push({ field: 'idade', op: 'gte', value: 60, label: 'Público Sênior (60+ anos)' });
  }

  // Filtro de WhatsApp verificado / celular
  if (p.includes('celular') || p.includes('whatsapp verificado') || p.includes('apenas whatsapp')) {
    extractedFilters.push({ field: 'tem_whatsapp', op: 'eq', value: true, label: 'Telefone móvel com WhatsApp ativo' });
  }

  // Se nenhum filtro foi detectado no texto, adiciona um filtro padrão elegante baseado no objetivo
  if (extractedFilters.length === 0) {
    if (purposeCode === 'COBRANCA') {
      extractedFilters.push({ field: 'dias_atraso', op: 'gte', value: 15, label: 'Atraso superior a 15 dias' });
    } else if (purposeCode === 'VENDAS') {
      extractedFilters.push({ field: 'tem_whatsapp', op: 'eq', value: true, label: 'Contatos com WhatsApp ativo' });
    } else {
      extractedFilters.push({ field: 'data_agendamento', op: 'gte', value: 'hoje', label: 'Agendamentos futuros ativos' });
    }
  }

  // 4. Extração de Ordenação em Linguagem Natural
  let extractedSort: ParsedCampaignSort = {
    field: 'priority_score',
    dir: 'desc',
    label: 'Maior probabilidade de contato (IA Score)',
  };

  if (p.includes('maior valor') || p.includes('maiores dívidas') || p.includes('maiores débitos')) {
    extractedSort = { field: 'valor_divida', dir: 'desc', label: 'Maior valor financeiro primeiro' };
  } else if (p.includes('menor valor') || p.includes('menores valores')) {
    extractedSort = { field: 'valor_divida', dir: 'asc', label: 'Menores valores primeiro' };
  } else if (p.includes('maior atraso') || p.includes('mais antigo') || p.includes('mais atrasad')) {
    extractedSort = { field: 'dias_atraso', dir: 'desc', label: 'Maior tempo de atraso primeiro' };
  } else if (p.includes('recente') || p.includes('mais recente')) {
    extractedSort = { field: 'dias_atraso', dir: 'asc', label: 'Atrasos mais recentes primeiro' };
  } else if (purposeCode === 'AGENDAMENTOS' || p.includes('data') || p.includes('horário')) {
    extractedSort = { field: 'data_agendamento', dir: 'asc', label: 'Data de agendamento mais próxima (D-1 e D-0)' };
  }

  // 5. Nome da Campanha
  let campaignName = '';
  if (purposeCode === 'AGENDAMENTOS') {
    campaignName = `Confirmação Agendamentos · ${audienceSegment} · ${todayStr}`;
  } else if (purposeCode === 'VENDAS') {
    campaignName = `Venda Ativa Comercial · ${audienceSegment} · ${todayStr}`;
  } else {
    campaignName = `Cobrança & Recuperação · ${audienceSegment} · ${todayStr}`;
  }

  // 6. Canais Recomendados
  let recommendedChannels: ChannelType[] = ['WHATSAPP', 'VOICE'];
  if (audienceSegment === 'B2B') {
    recommendedChannels = ['EMAIL', 'WHATSAPP', 'VOICE'];
  } else if (purposeCode === 'AGENDAMENTOS') {
    recommendedChannels = ['WHATSAPP', 'SMS'];
  }

  // 7. Cadência & Resumo
  let cadenceSummary = '';
  if (purposeCode === 'AGENDAMENTOS') {
    cadenceSummary =
      'Cadência Automática: Lembrete 1 dia antes (D-1 interativo com botões) + Lembrete no dia (D-0 informativo 2h antes com localização).';
  } else if (audienceSegment === 'B2B') {
    cadenceSummary =
      'Horário Comercial Corporativo: Segunda a Sexta, 08h30 às 18h00. Bloqueio estrito de noites e finais de semana. Envio de boletos/DDA com código de barras.';
  } else {
    cadenceSummary =
      'TIC Domicílios 2025: Janelas de almoço (11h30–13h30), Noite Wi-Fi Residencial (18h00–20h45) e BINA Local com chave PIX instantânea.';
  }

  const pMeta = PURPOSE_METADATA[purposeCode] ?? PURPOSE_METADATA.COBRANCA;
  const aMeta = AUDIENCE_SEGMENT_METADATA[audienceSegment];

  return {
    purposeCode,
    audienceSegment,
    campaignName,
    description: prompt.trim() || `${pMeta.title} · ${aMeta.title}`,
    extractedFilters,
    extractedSort,
    recommendedChannels,
    cadenceSummary,
    maxCpcBrl: purposeCode === 'AGENDAMENTOS' ? 1.8 : purposeCode === 'VENDAS' ? 12.0 : 4.5,
    expectedRatePct: pMeta.expectedRatePct,
    unitCostBrl: pMeta.optimizedUnitCostBrl,
    gainOrSavingsPct: pMeta.savingsOrGainPct,
  };
}
