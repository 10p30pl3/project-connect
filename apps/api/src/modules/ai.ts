import type { FastifyInstance } from 'fastify';
import {
  AiCampaignChatRequestSchema,
  CHANNEL_LABEL,
  type AiCampaignChatRequest,
  type AiCampaignChatResponse,
  type AiCampaignExtractedState,
  type AudienceSegment,
  type ChannelType,
  type OperationPurpose,
} from '@voll/shared';
import { config } from '../config.js';
import { parse } from '../lib/problem.js';

let runtimeOpenAiKey = config.openAiApiKey;
let runtimeOpenAiModel = config.openAiModel || 'gpt-4o-mini';

const SYSTEM_PROMPT = `Você é o Assistente Especialista em Operações Omnichannel e CPC (Contato com a Pessoa Certa) da plataforma Voll Plan.
Sua missão é conduzir uma conversa interativa em português (pt-BR) para ajudar o usuário a estruturar uma campanha de acionamento passo a passo, extraindo os parâmetros da conversa e fazendo perguntas objetivas apenas sobre as informações que ainda faltam.

Regras da conversa:
1. Analise todo o histórico de mensagens e o estado atual (currentState) além do mailing selecionado (selectedMailingName, selectedMailingCount).
2. Os pilares de uma campanha são:
   - purposeCode: 'COBRANCA' | 'VENDAS' | 'AGENDAMENTOS'
   - audienceSegment: 'B2C' (Pessoa Física/CPF) | 'B2B' (Pessoa Jurídica/CNPJ/Empresas) | 'MIXED' (Misto)
   - Base de contatos (Mailing): se selectedMailingId estiver vazio/nulo, avise que falta selecionar ou anexar o mailing (missingInfo = 'MAILING').
   - recommendedChannels: array com os canais na ordem de acionamento ('WHATSAPP', 'VOICE', 'SMS', 'EMAIL').
   - operatingDays: dias da semana (0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb). Ex: [1,2,3,4,5] para Seg-Sex.
   - operatingStart / operatingEnd: janela horária no formato HH:MM (ex: "08:30" e "18:00" para B2B, ou "08:00" e "20:00" para B2C).
   - maxAttemptsPerContact: número máximo de tentativas por contato (ex: 3).
   - maxAcceptableCpcBrl: custo máximo aceitável por CPC em reais (ex: 4.5).
   - campaignName: nome sugerido elegante para a campanha.
   - extractedFilters: filtros extraídos da conversa (ex: dias_atraso >= 30, valor_divida >= 1000, uf == 'SP').
   - extractedSort: ordenação extraída (ex: valor_divida desc, dias_atraso desc, priority_score desc).
   - cadenceSummary: resumo claro da régua e janelas.
3. Seja conciso, cordial e consultivo. Se faltar alguma informação essencial (ex: ainda não escolheu o mailing, ou ainda não ficou claro se o público é B2C ou B2B, ou se deseja refinar canais/tentativas), pergunte de forma direta e forneça de 2 a 4 sugestões curtas em suggestedReplies para o usuário clicar com 1 toque.
4. Quando o objetivo, segmento, canais, limites e mailing já estiverem definidos, defina missingInfo = null e readyToReview = true, convidando o usuário a clicar em "Continuar para revisão" ou ajustar qualquer detalhe.

Responda EXCLUSIVAMENTE com um objeto JSON válido seguindo exatamente este formato:
{
  "reply": "texto da resposta para o usuário no chat",
  "missingInfo": "PURPOSE" | "MAILING" | "AUDIENCE_SEGMENT" | "CHANNELS" | "SCHEDULE" | null,
  "readyToReview": boolean,
  "suggestedReplies": ["opção rápida 1", "opção rápida 2"],
  "extracted": {
    "purposeCode": "COBRANCA" | "VENDAS" | "AGENDAMENTOS",
    "audienceSegment": "B2C" | "B2B" | "MIXED",
    "campaignName": "string",
    "description": "string",
    "recommendedChannels": ["WHATSAPP", "VOICE"],
    "operatingDays": [1, 2, 3, 4, 5],
    "operatingStart": "08:00",
    "operatingEnd": "20:00",
    "maxAttemptsPerContact": 3,
    "maxAcceptableCpcBrl": 4.5,
    "extractedFilters": [
      { "field": "dias_atraso", "op": "gte", "value": 30, "label": "Atraso superior a 30 dias" }
    ],
    "extractedSort": { "field": "priority_score", "dir": "desc", "label": "Maior probabilidade de contato (IA Score)" },
    "cadenceSummary": "string"
  }
}`;

export async function callOpenAiCampaignAssistant(
  body: AiCampaignChatRequest,
  apiKey: string,
  model: string,
): Promise<AiCampaignChatResponse> {
  const contextNote = JSON.stringify({
    currentState: body.currentState ?? {},
    selectedMailingId: body.selectedMailingId ?? null,
    selectedMailingName: body.selectedMailingName ?? null,
    selectedMailingCount: body.selectedMailingCount ?? null,
    today: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  });

  const openAiMessages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nContexto atual da sessão: ${contextNote}` },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: openAiMessages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI API HTTP ${response.status}: ${errText.slice(0, 240)}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Resposta vazia da OpenAI API');
  }

  const parsed = JSON.parse(content);
  const fallback = buildLocalInteractiveResponse(body);

  const extracted: AiCampaignExtractedState = {
    ...fallback.extracted,
    ...(parsed.extracted ?? {}),
  };

  return {
    reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : fallback.reply,
    provider: 'OPENAI',
    model: data?.model || model || 'gpt-4o-mini',
    missingInfo: parsed.missingInfo !== undefined ? parsed.missingInfo : fallback.missingInfo,
    readyToReview: Boolean(parsed.readyToReview ?? fallback.readyToReview),
    suggestedReplies: Array.isArray(parsed.suggestedReplies)
      ? parsed.suggestedReplies.slice(0, 4).map(String)
      : fallback.suggestedReplies,
    extracted,
  };
}

/**
 * Motor conversacional determinístico multi-turno (usado como fallback ou quando sem chave OpenAI),
 * garantindo experiência 100% interativa em qualquer ambiente.
 */
export function buildLocalInteractiveResponse(body: AiCampaignChatRequest): AiCampaignChatResponse {
  const prev = body.currentState ?? {};
  const allUserText = body.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' \n ');
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const p = allUserText.toLowerCase();
  const lastLower = lastUserMsg.toLowerCase();
  const todayStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  // 1. Detecta Objetivo (Purpose)
  let purposeCode: OperationPurpose | null = prev.purposeCode ?? null;
  if (
    lastLower.includes('agenda') ||
    lastLower.includes('consulta') ||
    lastLower.includes('exame') ||
    lastLower.includes('visita') ||
    lastLower.includes('lembrete') ||
    lastLower.includes('no-show')
  ) {
    purposeCode = 'AGENDAMENTOS';
  } else if (
    lastLower.includes('venda') ||
    lastLower.includes('oferta') ||
    lastLower.includes('plano') ||
    lastLower.includes('upgrade') ||
    lastLower.includes('prospec') ||
    lastLower.includes('comercial')
  ) {
    purposeCode = 'VENDAS';
  } else if (
    lastLower.includes('cobran') ||
    lastLower.includes('inadimpl') ||
    lastLower.includes('atraso') ||
    lastLower.includes('dívida') ||
    lastLower.includes('divida') ||
    lastLower.includes('boleto') ||
    lastLower.includes('acordo') ||
    lastLower.includes('pix') ||
    lastLower.includes('fatura')
  ) {
    purposeCode = 'COBRANCA';
  }

  // 2. Detecta Segmento B2C / B2B / MIXED
  let audienceSegment: AudienceSegment | null = prev.audienceSegment ?? null;
  const mailingLower = (body.selectedMailingName ?? '').toLowerCase();
  if (lastLower.includes('misto') || lastLower.includes('híbrido') || lastLower.includes('ambos')) {
    audienceSegment = 'MIXED';
  } else if (
    lastLower.includes('b2b') ||
    lastLower.includes('pj') ||
    lastLower.includes('cnpj') ||
    lastLower.includes('empresa') ||
    lastLower.includes('corporativ') ||
    mailingLower.includes('b2b') ||
    mailingLower.includes('pj')
  ) {
    audienceSegment = 'B2B';
  } else if (
    lastLower.includes('b2c') ||
    lastLower.includes('pf') ||
    lastLower.includes('cpf') ||
    lastLower.includes('pessoa física') ||
    lastLower.includes('pessoa fisica') ||
    lastLower.includes('consumidor') ||
    lastLower.includes('residencial')
  ) {
    audienceSegment = 'B2C';
  }

  // 3. Canais Recomendados
  let recommendedChannels: ChannelType[] = prev.recommendedChannels ?? [];
  const mentionedChannels: ChannelType[] = [];
  if (lastLower.includes('whatsapp') || lastLower.includes('whats')) mentionedChannels.push('WHATSAPP');
  if (lastLower.includes('voz') || lastLower.includes('discador') || lastLower.includes('ligar') || lastLower.includes('telefonia')) mentionedChannels.push('VOICE');
  if (lastLower.includes('sms')) mentionedChannels.push('SMS');
  if (lastLower.includes('email') || lastLower.includes('e-mail')) mentionedChannels.push('EMAIL');

  if (mentionedChannels.length > 0) {
    recommendedChannels = mentionedChannels;
  } else if (recommendedChannels.length === 0) {
    if (audienceSegment === 'B2B') recommendedChannels = ['EMAIL', 'WHATSAPP', 'VOICE'];
    else if (purposeCode === 'AGENDAMENTOS') recommendedChannels = ['WHATSAPP', 'SMS'];
    else recommendedChannels = ['WHATSAPP', 'VOICE'];
  }

  // 4.Tentativas e Horários
  let maxAttemptsPerContact = prev.maxAttemptsPerContact ?? 3;
  const attMatch = lastLower.match(/(\d+)\s*tentativa/);
  if (attMatch) {
    maxAttemptsPerContact = Math.min(10, Math.max(1, parseInt(attMatch[1], 10)));
  }

  const effectiveSegment: AudienceSegment = audienceSegment ?? 'B2C';
  const effectivePurpose: OperationPurpose = purposeCode ?? 'COBRANCA';

  let operatingDays = prev.operatingDays ?? (effectiveSegment === 'B2B' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6]);
  if (lastLower.includes('segunda a sexta') || lastLower.includes('dias úteis')) {
    operatingDays = [1, 2, 3, 4, 5];
  } else if (lastLower.includes('sábado') || lastLower.includes('sabado')) {
    operatingDays = [1, 2, 3, 4, 5, 6];
  }

  let operatingStart = prev.operatingStart ?? (effectiveSegment === 'B2B' ? '08:30' : '08:00');
  let operatingEnd = prev.operatingEnd ?? (effectiveSegment === 'B2B' ? '18:00' : '20:00');
  const hoursMatch = lastLower.match(/(\d{1,2})[:h](\d{2})?\s*(?:às|as|a|-|até)\s*(\d{1,2})[:h](\d{2})?/);
  if (hoursMatch) {
    operatingStart = `${hoursMatch[1].padStart(2, '0')}:${hoursMatch[2] || '00'}`;
    operatingEnd = `${hoursMatch[3].padStart(2, '0')}:${hoursMatch[4] || '00'}`;
  }

  // 5. Filtros e Ordenação
  const extractedFilters = [...(prev.extractedFilters ?? [])];
  const delayMatch = p.match(/(?:atraso|vencid[oa]s?|atrasad[oa]s?|faixa)\s*(?:maior|superior|acima|mais|de|>|\>=)?\s*(?:que|de|a)?\s*(\d+)\s*dias?/);
  if (delayMatch) {
    const days = parseInt(delayMatch[1], 10);
    if (!extractedFilters.some((f) => f.field === 'dias_atraso')) {
      extractedFilters.push({ field: 'dias_atraso', op: 'gte', value: days, label: `Atraso superior a ${days} dias` });
    }
  }
  const valueMatch = p.match(/(?:valor|d[ií]vida|saldo|d[eé]bito|acima de)\s*(?:maior|superior|acima|mais|>|\>=)?\s*(?:que|de)?\s*(?:r\$)?\s*(\d+[\d.,]*)/);
  if (valueMatch) {
    const cleanVal = parseFloat(valueMatch[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(cleanVal) && cleanVal > 0 && !extractedFilters.some((f) => f.field === 'valor_divida')) {
      extractedFilters.push({
        field: 'valor_divida',
        op: 'gte',
        value: cleanVal,
        label: `Valor superior a R$ ${cleanVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      });
    }
  }

  let extractedSort = prev.extractedSort ?? {
    field: 'priority_score',
    dir: 'desc' as const,
    label: 'Maior probabilidade de contato (IA Score)',
  };
  if (p.includes('maior valor') || p.includes('maiores dívidas')) {
    extractedSort = { field: 'valor_divida', dir: 'desc', label: 'Maior valor financeiro primeiro' };
  } else if (p.includes('maior atraso') || p.includes('mais antigo')) {
    extractedSort = { field: 'dias_atraso', dir: 'desc', label: 'Maior tempo de atraso primeiro' };
  }

  const purposeTitle =
    effectivePurpose === 'AGENDAMENTOS'
      ? 'Confirmação de Agendamentos'
      : effectivePurpose === 'VENDAS'
        ? 'Venda Ativa Comercial'
        : 'Cobrança e Recuperação';

  const campaignName = `${purposeTitle} · ${effectiveSegment} · ${todayStr}`;
  const cadenceSummary =
    effectiveSegment === 'B2B'
      ? `Horário Comercial (${operatingStart}–${operatingEnd}, Seg–Sex) com foco em decisores/financeiro e até ${maxAttemptsPerContact} tentativas.`
      : `Janelas otimizadas (${operatingStart}–${operatingEnd}) via ${recommendedChannels.map((c) => CHANNEL_LABEL[c]).join(' → ')} (até ${maxAttemptsPerContact} tentativas).`;

  const hasMailing = Boolean(body.selectedMailingId);

  // Determina qual pergunta fazer a seguir
  let missingInfo: AiCampaignChatResponse['missingInfo'] = null;
  let reply = '';
  let suggestedReplies: string[] = [];

  if (!purposeCode) {
    missingInfo = 'PURPOSE';
    reply =
      'Para começarmos a desenhar sua campanha, qual é o objetivo principal da operação? Você pode escolher abaixo ou descrever com suas palavras:';
    suggestedReplies = [
      'Cobrança de faturas em atraso',
      'Venda ativa de planos e ofertas',
      'Confirmação de agendamentos (D-1 e D-0)',
    ];
  } else if (!audienceSegment) {
    missingInfo = 'AUDIENCE_SEGMENT';
    reply = `Perfeito, configurei o objetivo como **${purposeTitle}**. Para eu calibrar os horários permitidos e a abordagem, o público-alvo dessa campanha é **Pessoa Física (B2C)**, **Pessoa Jurídica / Empresas (B2B)** ou **Base Mista**?`;
    suggestedReplies = [
      'Pessoa Física (B2C · CPF)',
      'Pessoa Jurídica (B2B · Empresas)',
      'Base Mista (CPF e CNPJ)',
    ];
  } else if (!hasMailing) {
    missingInfo = 'MAILING';
    reply = `Ótimo! Campanha de **${purposeTitle} (${audienceSegment})** pré-configurada com canais **${recommendedChannels.map((c) => CHANNEL_LABEL[c]).join(' → ')}** (${operatingStart} às ${operatingEnd}).\n\nAgora só falta vincular a **base de contatos (mailing)** para calcularmos o volume elegível. Selecione um mailing existente ou anexe um arquivo CSV:`;
    suggestedReplies = [
      'Usar WhatsApp + Discador com até 3 tentativas',
      'Apenas WhatsApp em horário comercial',
      'Priorizar maiores valores primeiro',
    ];
  } else {
    missingInfo = null;
    reply = `Tudo pronto! Estruturei sua campanha **"${campaignName}"** vinculada à base **${body.selectedMailingName}** (${(body.selectedMailingCount ?? 0).toLocaleString('pt-BR')} contatos):\n• **Canais**: ${recommendedChannels.map((c) => CHANNEL_LABEL[c]).join(' → ')}\n• **Janela**: ${operatingStart} às ${operatingEnd} (até ${maxAttemptsPerContact} tentativas/contato)\n• **Ordenação**: ${extractedSort.label}\n\nDeseja ajustar algum filtro/horário ou já podemos avançar para a revisão final?`;
    suggestedReplies = [
      'Alterar limite para 5 tentativas por contato',
      'Priorizar maiores valores primeiro',
      'Usar apenas WhatsApp e SMS',
    ];
  }

  return {
    reply,
    provider: 'LOCAL_ASSISTANT',
    model: 'voll-interactive-v2',
    missingInfo,
    readyToReview: Boolean(purposeCode && hasMailing),
    suggestedReplies,
    extracted: {
      purposeCode: effectivePurpose,
      audienceSegment: effectiveSegment,
      campaignName,
      description: allUserText.trim() || `${purposeTitle} (${effectiveSegment})`,
      recommendedChannels,
      operatingDays,
      operatingStart,
      operatingEnd,
      maxAttemptsPerContact,
      maxAcceptableCpcBrl: prev.maxAcceptableCpcBrl ?? (effectivePurpose === 'AGENDAMENTOS' ? 1.8 : effectivePurpose === 'VENDAS' ? 12.0 : 4.5),
      extractedFilters,
      extractedSort,
      cadenceSummary,
    },
  };
}

export async function aiRoutes(app: FastifyInstance) {
  app.get('/ai/status', async () => {
    const hasKey = Boolean(runtimeOpenAiKey && runtimeOpenAiKey.trim().length > 10);
    return {
      configured: hasKey,
      provider: hasKey ? 'OPENAI' : 'LOCAL_ASSISTANT',
      model: runtimeOpenAiModel,
    };
  });

  app.post<{ Body: { apiKey?: string; model?: string } }>('/ai/config', async (req) => {
    const body = (req.body ?? {}) as { apiKey?: string; model?: string };
    if (typeof body.apiKey === 'string') {
      runtimeOpenAiKey = body.apiKey.trim();
    }
    if (typeof body.model === 'string' && body.model.trim()) {
      runtimeOpenAiModel = body.model.trim();
    }
    const hasKey = Boolean(runtimeOpenAiKey && runtimeOpenAiKey.trim().length > 10);
    return {
      ok: true,
      configured: hasKey,
      provider: hasKey ? 'OPENAI' : 'LOCAL_ASSISTANT',
      model: runtimeOpenAiModel,
    };
  });

  app.post<{ Body: { apiKey?: string; model?: string } }>('/ai/test', async (req) => {
    const body = (req.body ?? {}) as { apiKey?: string; model?: string };
    const keyToTest = (body.apiKey?.trim() || runtimeOpenAiKey || '').trim();
    const modelToTest = (body.model?.trim() || runtimeOpenAiModel || 'gpt-4o-mini').trim();

    if (!keyToTest) {
      return {
        ok: false,
        message: 'Nenhum token da OpenAI informado.',
      };
    }

    const t0 = Date.now();
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keyToTest}`,
        },
        body: JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 2,
        }),
      });

      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        const errText = await res.text();
        return {
          ok: false,
          status: res.status,
          latencyMs,
          message: `Falha na autenticação da OpenAI (${res.status}): ${errText.slice(0, 140)}`,
        };
      }

      return {
        ok: true,
        status: 200,
        latencyMs,
        model: modelToTest,
        message: `Token validado com sucesso pela OpenAI! Modelo ${modelToTest} respondeu em ${latencyMs}ms.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Erro de conexão com os servidores da OpenAI: ${(err as Error).message}`,
      };
    }
  });

  app.post('/ai/campaign-chat', async (req) => {
    const body = parse(AiCampaignChatRequestSchema, req.body);
    const activeKey = (body.apiKey?.trim() || runtimeOpenAiKey || '').trim();
    const activeModel = (body.model?.trim() || runtimeOpenAiModel || 'gpt-4o-mini').trim();

    if (activeKey.length > 10) {
      try {
        return await callOpenAiCampaignAssistant(body, activeKey, activeModel);
      } catch (err) {
        req.log.warn({ err }, 'Falha ao consultar OpenAI API; utilizando motor interativo local como fallback.');
        const fallback = buildLocalInteractiveResponse(body);
        return {
          ...fallback,
          reply: `${fallback.reply}\n\n_(Nota: Não foi possível conectar à OpenAI com a chave informada [${(err as Error).message.slice(0, 90)}]. Continuando com o assistente interativo integrado.)_`,
        };
      }
    }

    return buildLocalInteractiveResponse(body);
  });
}
