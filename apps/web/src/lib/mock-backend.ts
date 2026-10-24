/**
 * Motor de mockup 100% no navegador (frontend-only fallback).
 * Quando o backend (`/api`) não está acessível (ex.: deploy estático na Vercel),
 * atende todas as rotas com dados simulados realistas em memória, permitindo
 * navegar por todas as telas, trocar de perfil (Admin, Gestor, Supervisor,
 * Operador, Analista) sem login e testar fluxos completos.
 */
import {
  ATTEMPT_STATE_LABEL,
  CAMPAIGN_STATUS_LABEL,
  maskAddress,
  ROLES,
  type AttemptState,
  type CampaignDraft,
  type CampaignStatus,
  type ChannelType,
  type ColumnMapping,
  type ListFilter,
  type ReasonCode,
  type Role,
  type StrategyConfig,
} from '@voll/shared';
import { ApiError } from './api';
import type {
  AttemptDetail,
  AuditRow,
  Block,
  CampaignDetail,
  Connection,
  ContactDetail,
  ContactRow,
  Control,
  Destination,
  DraftEnvelope,
  Eligibility,
  EligibilityRow,
  ImportPreview,
  Indicators,
  Journey,
  ListDetail,
  ListMember,
  ListPreview,
  ListSummary,
  MailingDetail,
  MailingRecord,
  MailingSummary,
  Me,
  Overview,
  Preflight,
  Strategy,
  StrategyDetail,
  StrategyVersion,
  Tabulation,
  TimelineEvent,
  User,
} from './types';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let seq = 500;
const nextUuid = () => uuid(++seq);

const ORG = { id: uuid(1), name: 'Voll Solutions' };
const WS = { id: uuid(2), name: 'Principal', timezone: 'America/Sao_Paulo' };

const DEMO_USERS: Record<Role, User & { id: string }> = {
  ADMIN: { id: uuid(10), email: 'ricardo@vollsolutions.com.br', name: 'Ricardo (Voll Solutions)', role: 'ADMIN', active: true, createdAt: '2026-10-01T12:00:00Z' },
  MANAGER: { id: uuid(11), email: 'gestor@voll.local', name: 'Gestora Exemplo', role: 'MANAGER', active: true, createdAt: '2026-10-01T12:00:00Z' },
  SUPERVISOR: { id: uuid(12), email: 'supervisor@voll.local', name: 'Supervisor Exemplo', role: 'SUPERVISOR', active: true, createdAt: '2026-10-01T12:00:00Z' },
  OPERATOR: { id: uuid(13), email: 'operador@voll.local', name: 'Operador Exemplo', role: 'OPERATOR', active: true, createdAt: '2026-10-01T12:00:00Z' },
  ANALYST: { id: uuid(14), email: 'analista@voll.local', name: 'Analista Exemplo', role: 'ANALYST', active: true, createdAt: '2026-10-01T12:00:00Z' },
};

const RULES: StrategyConfig['tabulationRules'] = {
  CONVERSION: 'FINISH_SUCCESS',
  CPC_NO_DEAL: 'RETRY',
  NO_ANSWER: 'RETRY',
  BUSY: 'RETRY',
  WRONG_PERSON: 'NEXT_DESTINATION',
  INVALID_NUMBER: 'NEXT_DESTINATION',
  OPT_OUT: 'FINISH_FAIL',
  READ_NO_REPLY: 'NEXT_STEP',
  REPLIED: 'RETRY',
};

const TABULATIONS: Tabulation[] = [
  { id: uuid(20), code: 'CONVERSION', name: 'Acordo fechado', isCpc: true, isConversion: true, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(21), code: 'CPC_NO_DEAL', name: 'Titular sem acordo', isCpc: true, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(22), code: 'NO_ANSWER', name: 'Não atendeu', isCpc: false, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(23), code: 'BUSY', name: 'Ocupado', isCpc: false, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(24), code: 'WRONG_PERSON', name: 'Terceiro', isCpc: false, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(25), code: 'INVALID_NUMBER', name: 'Número inválido', isCpc: false, isConversion: false, isOptOut: false, invalidatesDestination: true, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(26), code: 'OPT_OUT', name: 'Não deseja contato', isCpc: false, isConversion: false, isOptOut: true, invalidatesDestination: false, channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] },
  { id: uuid(27), code: 'READ_NO_REPLY', name: 'Lida sem resposta', isCpc: false, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['WHATSAPP', 'SMS'] },
  { id: uuid(28), code: 'REPLIED', name: 'Respondeu', isCpc: true, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['WHATSAPP', 'SMS', 'EMAIL'] },
];

const CONNECTIONS: Connection[] = [
  {
    id: uuid(30),
    name: 'Discador simulado',
    channelType: 'VOICE',
    provider: 'SIMULATED',
    tariff: 0.12,
    tariffUpdatedAt: '2026-10-15T10:00:00Z',
    active: true,
    simulation: {
      outcomes: { NO_ANSWER: 4, BUSY: 1, CPC_NO_DEAL: 2, CONVERSION: 1.2, WRONG_PERSON: 0.8, INVALID_NUMBER: 0.5, OPT_OUT: 0.2, RESULT_UNKNOWN: 0.4 },
      minDelaySeconds: 2,
      maxDelaySeconds: 8,
      duplicateRate: 0.15,
      noReturnRate: 0.05,
    },
  },
  {
    id: uuid(31),
    name: 'WhatsApp simulado',
    channelType: 'WHATSAPP',
    provider: 'SIMULATED',
    tariff: 0.05,
    tariffUpdatedAt: '2026-10-15T10:00:00Z',
    active: true,
    simulation: {
      outcomes: { READ_NO_REPLY: 4, REPLIED: 2, CONVERSION: 1, OPT_OUT: 0.3, RESULT_UNKNOWN: 0.3 },
      minDelaySeconds: 2,
      maxDelaySeconds: 8,
      duplicateRate: 0.15,
      noReturnRate: 0.05,
    },
  },
  {
    id: uuid(32),
    name: 'SMS simulado',
    channelType: 'SMS',
    provider: 'SIMULATED',
    tariff: null,
    tariffUpdatedAt: null,
    active: true,
    simulation: {
      outcomes: { READ_NO_REPLY: 5, REPLIED: 1, OPT_OUT: 0.2 },
      minDelaySeconds: 2,
      maxDelaySeconds: 8,
      duplicateRate: 0.15,
      noReturnRate: 0.05,
    },
  },
];

const JOURNEYS: Journey[] = [
  {
    id: uuid(40),
    name: 'Discador',
    latestVersion: {
      id: uuid(41),
      version: 1,
      steps: [{ channelType: 'VOICE', connectionId: uuid(30), connectionName: 'Discador simulado', feedbackTimeoutMinutes: 2 }],
    },
  },
  {
    id: uuid(42),
    name: 'WhatsApp → Discador',
    latestVersion: {
      id: uuid(43),
      version: 1,
      steps: [
        { channelType: 'WHATSAPP', connectionId: uuid(31), connectionName: 'WhatsApp simulado', feedbackTimeoutMinutes: 5 },
        { channelType: 'VOICE', connectionId: uuid(30), connectionName: 'Discador simulado', feedbackTimeoutMinutes: 2 },
      ],
    },
  },
];

const STRATEGIES: StrategyDetail[] = [
  {
    id: uuid(50),
    name: 'Padrão cobrança',
    protected: true,
    latestVersion: {
      id: uuid(51),
      version: 1,
      publishedAt: '2026-10-10T12:00:00Z',
      config: {
        calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00', timezone: 'America/Sao_Paulo' },
        limits: { total: 10, daily: 3, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
        retry: { intervalMinutes: 30, maxPerDestination: 3 },
        distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
        tabulationRules: RULES,
      },
    },
    versions: [],
  },
  {
    id: uuid(52),
    name: 'Intensiva',
    protected: true,
    latestVersion: {
      id: uuid(53),
      version: 1,
      publishedAt: '2026-10-10T12:00:00Z',
      config: {
        calendar: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '21:00', timezone: 'America/Sao_Paulo' },
        limits: { total: 15, daily: 5, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
        retry: { intervalMinutes: 15, maxPerDestination: 5 },
        distribution: { batchSize: 40, maxPending: 100, leaseSeconds: 60 },
        tabulationRules: RULES,
      },
    },
    versions: [],
  },
  {
    id: uuid(54),
    name: 'Demonstração 24x7',
    protected: false,
    latestVersion: {
      id: uuid(55),
      version: 1,
      publishedAt: '2026-10-10T12:00:00Z',
      config: {
        calendar: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', timezone: 'America/Sao_Paulo' },
        limits: { total: 6, daily: 4, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
        retry: { intervalMinutes: 1, maxPerDestination: 2 },
        distribution: { batchSize: 10, maxPending: 20, leaseSeconds: 60 },
        tabulationRules: RULES,
      },
    },
    versions: [],
  },
];
for (const s of STRATEGIES) {
  if (s.latestVersion) s.versions = [s.latestVersion];
}

type FullContact = {
  id: string;
  externalId: string;
  name: string;
  attributes: Record<string, unknown>;
  historyTotal: number | null;
  historyReferenceDate: string | null;
  destinations: Destination[];
  blocks: Block[];
};

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Tiago', 'Vera', 'Wagner'];
const LAST = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gomes', 'Henriques', 'Lima', 'Moraes'];
const CITIES = ['SP', 'RJ', 'MG', 'PR', 'RS'];

const CONTACTS: FullContact[] = Array.from({ length: 24 }, (_, idx) => {
  const i = idx + 1;
  const id = uuid(100 + i);
  const externalId = String(i).padStart(6, '0');
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
  const phone1 = `551190000${String(i * 10 + 1).padStart(4, '0')}`;
  const wa = `551190000${String(i * 10 + 5).padStart(4, '0')}`;
  const destinations: Destination[] = [
    { id: uuid(200 + i * 2), channelType: 'VOICE', address: phone1, addressMasked: maskAddress(phone1), label: 'Principal', priority: 1, valid: true, blocked: false },
  ];
  if (i % 2 === 0) {
    destinations.push({ id: uuid(200 + i * 2 + 1), channelType: 'WHATSAPP', address: wa, addressMasked: maskAddress(wa), label: 'WhatsApp', priority: 1, valid: true, blocked: false });
  }
  const blocks: Block[] =
    i === 1
      ? [
          {
            id: uuid(301),
            scope: 'CONTACT',
            destinationId: null,
            reason: 'Solicitação registrada no SAC (exemplo)',
            origin: 'MANUAL',
            createdAt: '2026-10-18T14:20:00Z',
            revokedAt: null,
          },
        ]
      : [];
  return {
    id,
    externalId,
    name,
    attributes: {
      cidade: CITIES[i % CITIES.length],
      valor_divida: Number((250 + ((i * 137) % 4800)).toFixed(2)),
      dias_atraso: 5 + ((i * 17) % 180),
      score: (i * 29) % 101,
    },
    historyTotal: i % 5 === 0 ? null : (i * 3) % 4,
    historyReferenceDate: i % 5 === 0 ? null : '2026-10-15',
    destinations,
    blocks,
  };
});

const MAILING_ID = uuid(60);
const MAILING_VER_ID = uuid(61);

const MAILINGS: { detail: MailingDetail; records: MailingRecord[] }[] = [
  {
    detail: {
      id: MAILING_ID,
      name: 'Carteira exemplo',
      createdAt: '2026-10-18T12:00:00Z',
      recordCount: CONTACTS.length,
      columns: ['cidade', 'valor_divida', 'dias_atraso', 'score'],
      versions: [
        {
          id: MAILING_VER_ID,
          version: 1,
          totalRows: CONTACTS.length + 1,
          validRows: CONTACTS.length,
          rejectedRows: 1,
          createdAt: '2026-10-18T12:00:00Z',
        },
      ],
    },
    records: CONTACTS.map((c, idx) => ({
      id: uuid(350 + idx),
      rowNumber: idx + 2,
      contactId: c.id,
      externalId: c.externalId,
      name: c.name,
      fields: c.attributes,
      blocked: c.blocks.some((b) => !b.revokedAt && b.scope === 'CONTACT'),
    })),
  },
];

const LIST_ID = uuid(70);
const LIST_VER_ID = uuid(71);

const LISTS: ListDetail[] = [
  {
    id: LIST_ID,
    name: 'Atraso > 30 dias (SP/RJ)',
    mailing: { id: MAILING_ID, name: 'Carteira exemplo' },
    latestVersion: {
      id: LIST_VER_ID,
      version: 1,
      membershipMode: 'SNAPSHOT',
      memberCount: 16,
      publishedAt: '2026-10-19T09:30:00Z',
    },
    versions: [
      {
        id: LIST_VER_ID,
        version: 1,
        membershipMode: 'SNAPSHOT',
        memberCount: 16,
        publishedAt: '2026-10-19T09:30:00Z',
        filters: [{ field: 'dias_atraso', op: 'gt', value: 30 }],
        sort: [{ field: 'valor_divida', dir: 'desc' }],
      },
    ],
  },
];

const CAMPAIGN_1_ID = uuid(80);
const CAMPAIGN_2_ID = uuid(81);

const CAMPAIGNS: CampaignDetail[] = [
  {
    id: CAMPAIGN_1_ID,
    name: 'Cobrança Outubro — Faixa 30+ dias',
    description: 'Acionamento multicanal WhatsApp seguido de Discador para carteira prioritária.',
    status: 'RUNNING',
    statusLabel: CAMPAIGN_STATUS_LABEL.RUNNING,
    operationalState: 'PROCESSING',
    operationalExplanation: 'Processando: reservas e envios em andamento dentro da janela operacional.',
    audience: { type: 'LIST', name: 'Atraso > 30 dias (SP/RJ)' },
    journeyName: 'WhatsApp → Discador',
    strategyName: 'Demonstração 24x7',
    strategyVersion: 1,
    createdAt: '2026-10-20T10:00:00Z',
    startedAt: '2026-10-20T10:05:00Z',
    scheduledAt: null,
    progress: { members: 16, finished: 5, active: 11 },
    mailing: { id: MAILING_ID, name: 'Carteira exemplo' },
    listVersion: { id: LIST_VER_ID, version: 1, membershipMode: 'SNAPSHOT' },
    journey: {
      id: JOURNEYS[1].id,
      version: 1,
      steps: JOURNEYS[1].latestVersion!.steps,
    },
    strategy: {
      id: STRATEGIES[2].id,
      version: 1,
      config: STRATEGIES[2].latestVersion!.config,
    },
  },
  {
    id: CAMPAIGN_2_ID,
    name: 'Recuperação Preventiva — Carteira Geral',
    description: 'Campanha em pausa para revisão de lote.',
    status: 'PAUSED',
    statusLabel: CAMPAIGN_STATUS_LABEL.PAUSED,
    operationalState: 'IDLE',
    operationalExplanation: 'Campanha pausada: novas reservas suspensas; retornos pendentes continuam sendo recebidos.',
    audience: { type: 'MAILING', name: 'Carteira exemplo' },
    journeyName: 'Discador',
    strategyName: 'Padrão cobrança',
    strategyVersion: 1,
    createdAt: '2026-10-19T14:00:00Z',
    startedAt: '2026-10-19T14:10:00Z',
    scheduledAt: null,
    progress: { members: 23, finished: 8, active: 15 },
    mailing: { id: MAILING_ID, name: 'Carteira exemplo' },
    listVersion: null,
    journey: {
      id: JOURNEYS[0].id,
      version: 1,
      steps: JOURNEYS[0].latestVersion!.steps,
    },
    strategy: {
      id: STRATEGIES[0].id,
      version: 1,
      config: STRATEGIES[0].latestVersion!.config,
    },
  },
];

const ATTEMPTS: Map<string, AttemptDetail> = new Map();
function seedAttempts() {
  const specs: {
    id: string;
    contactIdx: number;
    channel: ChannelType;
    connName: string;
    state: AttemptState;
    tabCode: string | null;
    cost: number | null;
    tariff: number | null;
    camp: CampaignDetail;
    dup?: boolean;
  }[] = [
    { id: uuid(401), contactIdx: 1, channel: 'WHATSAPP', connName: 'WhatsApp simulado', state: 'FINALIZED', tabCode: 'CONVERSION', cost: 0.05, tariff: 0.05, camp: CAMPAIGNS[0], dup: true },
    { id: uuid(402), contactIdx: 2, channel: 'VOICE', connName: 'Discador simulado', state: 'FINALIZED', tabCode: 'CPC_NO_DEAL', cost: 0.12, tariff: 0.12, camp: CAMPAIGNS[0] },
    { id: uuid(403), contactIdx: 3, channel: 'VOICE', connName: 'Discador simulado', state: 'SENT', tabCode: null, cost: null, tariff: 0.12, camp: CAMPAIGNS[0], dup: true },
    { id: uuid(404), contactIdx: 4, channel: 'WHATSAPP', connName: 'WhatsApp simulado', state: 'RECONCILIATION', tabCode: null, cost: null, tariff: 0.05, camp: CAMPAIGNS[0] },
    { id: uuid(405), contactIdx: 5, channel: 'VOICE', connName: 'Discador simulado', state: 'FINALIZED', tabCode: 'NO_ANSWER', cost: 0.12, tariff: 0.12, camp: CAMPAIGNS[1] },
    { id: uuid(406), contactIdx: 6, channel: 'VOICE', connName: 'Discador simulado', state: 'FINALIZED', tabCode: 'CONVERSION', cost: 0.12, tariff: 0.12, camp: CAMPAIGNS[1] },
  ];

  for (const s of specs) {
    const c = CONTACTS[s.contactIdx];
    const dest = c.destinations[0];
    const tab = s.tabCode ? TABULATIONS.find((t) => t.code === s.tabCode) ?? null : null;
    const now = new Date(Date.now() - (410 - Number(s.id.slice(-3))) * 600_000).toISOString();
    const timeline: TimelineEvent[] = [
      { id: 1, eventType: 'RESERVED', label: 'Contato reservado', fromState: null, toState: 'RESERVED', reasonCode: null, duplicate: false, occurredAt: now, receivedAt: now, data: {} },
      { id: 2, eventType: 'DISPATCH_ACCEPTED', label: 'Enviado ao canal', fromState: 'RESERVED', toState: 'SENT', reasonCode: null, duplicate: false, occurredAt: now, receivedAt: now, data: {} },
    ];
    if (s.dup) {
      timeline.push({
        id: 3,
        eventType: 'DELIVERY_CONFIRMED',
        label: 'Retorno associado à tentativa',
        fromState: 'SENT',
        toState: 'SENT',
        reasonCode: null,
        duplicate: true,
        occurredAt: now,
        receivedAt: now,
        data: {},
      });
    }
    if (s.state === 'RECONCILIATION') {
      timeline.push({
        id: 4,
        eventType: 'FEEDBACK_TIMEOUT',
        label: 'Prazo de feedback expirado — movido para reconciliação',
        fromState: 'SENT',
        toState: 'RECONCILIATION',
        reasonCode: 'RECONCILIATION',
        duplicate: false,
        occurredAt: now,
        receivedAt: now,
        data: {},
      });
    } else if (s.state === 'FINALIZED' && tab) {
      timeline.push({
        id: 4,
        eventType: 'RESULT',
        label: `Resultado recebido: ${tab.name}`,
        fromState: 'SENT',
        toState: 'FINALIZED',
        reasonCode: null,
        duplicate: false,
        occurredAt: now,
        receivedAt: now,
        data: { tabulationCode: tab.code },
      });
    }

    const nextAction =
      s.state === 'RECONCILIATION'
        ? 'Resolver reconciliação (Supervisor/Admin)'
        : s.state === 'SENT'
          ? 'Aguardar retorno do canal'
          : tab?.code === 'CONVERSION'
            ? 'Inscrição encerrada com sucesso'
            : 'Aguardar intervalo de retentativa';

    ATTEMPTS.set(s.id, {
      attempt: {
        id: s.id,
        contact: { id: c.id, externalId: c.externalId, name: c.name },
        channelType: s.channel,
        connectionName: s.connName,
        destinationMasked: dest.addressMasked,
        stage: 0,
        state: s.state,
        stateLabel: ATTEMPT_STATE_LABEL[s.state],
        tabulation: tab ? { code: tab.code, name: tab.name } : null,
        createdAt: now,
        sentAt: now,
        finalizedAt: s.state === 'FINALIZED' ? now : null,
        nextAction,
        campaign: { id: s.camp.id, name: s.camp.name },
        traceId: nextUuid(),
        strategyVersionId: s.camp.strategy.id,
        journeyVersionId: s.camp.journey.id,
        tariffSnapshot: s.tariff,
        costConfirmed: s.cost,
        leaseUntil: null,
        feedbackDeadline: new Date(Date.now() + 300_000).toISOString(),
        providerAttemptId: `sim-${s.id.slice(-4)}`,
      },
      explanation: {
        whatHappened:
          s.state === 'RECONCILIATION'
            ? 'O envio foi aceito pelo canal, mas o prazo de retorno expirou sem resultado conclusivo.'
            : s.state === 'FINALIZED'
              ? `Tentativa finalizada com a tabulação "${tab?.name}".`
              : 'Enviado ao canal.',
        why:
          s.state === 'RECONCILIATION'
            ? 'Novos envios para este contato estão bloqueados até que um supervisor reconcilie a tentativa.'
            : 'Fluxo processado conforme regras da estratégia e da jornada.',
        nextAction: `${nextAction}.`,
      },
      timeline,
    });
  }
}
seedAttempts();

let CONTROL: Control = { dailyLimit: null, totalLimit: null, globalSuspension: false };
const AUDITS: AuditRow[] = [
  {
    id: 1,
    at: '2026-10-20T10:05:00Z',
    user: { name: 'Ricardo (Voll Solutions)' },
    action: 'campaign.start',
    entity: 'campaign',
    entityId: CAMPAIGN_1_ID,
    reason: 'Início imediato na criação',
    before: { status: 'READY' },
    after: { status: 'RUNNING' },
  },
];

let DRAFT: DraftEnvelope = null;

function currentRole(headers: Record<string, string>): Role {
  const h = (headers['X-Demo-Role'] || headers['x-demo-role'] || '').toUpperCase();
  return (ROLES as readonly string[]).includes(h) ? (h as Role) : 'ADMIN';
}

function currentMe(headers: Record<string, string>): Me {
  const role = currentRole(headers);
  const u = DEMO_USERS[role];
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organization: ORG,
    workspace: WS,
    demoMode: true,
  };
}

function parseQuery(path: string): { pathname: string; searchParams: URLSearchParams } {
  const [pathname, qs = ''] = path.split('?');
  return { pathname, searchParams: new URLSearchParams(qs) };
}

function buildImportPreview(body: any): ImportPreview {
  const content = String(body?.content ?? '').trim();
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const delimiter = body?.delimiter && body.delimiter !== 'auto' ? body.delimiter : (lines[0]?.includes(';') ? ';' : ',');
  const hasHeader = body?.hasHeader !== false;
  const rawHeaders = hasHeader && lines.length > 0 ? lines[0].split(delimiter).map((s: string) => s.trim()) : ['col1', 'col2', 'col3'];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const suggestedMapping: ColumnMapping[] =
    body?.mapping ??
    rawHeaders.map((h: string, i: number) => {
      const lower = h.toLowerCase();
      if (lower === 'id' || lower.includes('external') || lower.includes('cpf') || lower.includes('contrato') || i === 0)
        return { column: h, target: 'external_id', type: 'text', required: true };
      if (lower.includes('nome') || lower === 'name')
        return { column: h, target: 'name', type: 'text', required: false };
      if (lower.includes('tel') || lower.includes('fone') || lower.includes('cel'))
        return { column: h, target: 'phone1', type: 'text', required: false };
      if (lower.includes('whats'))
        return { column: h, target: 'digital1', digitalType: 'WHATSAPP', type: 'text', required: false };
      if (lower.includes('email'))
        return { column: h, target: 'email', type: 'text', required: false };
      return { column: h, target: 'attribute', attributeName: h, type: 'text', required: false };
    });

  let validRows = 0;
  let rejectedRows = 0;
  const rows = dataLines.slice(0, 200).map((line, idx) => {
    const cols = line.split(delimiter).map((c) => c.trim());
    const values: Record<string, string> = {};
    rawHeaders.forEach((h, i) => {
      values[h] = cols[i] ?? '';
    });
    const errors: string[] = [];
    for (const m of suggestedMapping) {
      const val = values[m.column] ?? '';
      if (m.target === 'external_id' && !val) errors.push(`${m.column}: identificador obrigatório`);
      if (m.target.startsWith('phone') && val) {
        const digits = val.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) errors.push(`${m.column}: deve ter de 10 a 15 dígitos`);
      }
    }
    if (errors.length) rejectedRows++;
    else validRows++;
    return { rowNumber: hasHeader ? idx + 2 : idx + 1, values, errors };
  });

  return {
    delimiter,
    headers: rawHeaders,
    totalRows: dataLines.length,
    suggestedMapping,
    rows,
    validRows,
    rejectedRows,
    schemaErrors: [],
  };
}

export async function handleMockApi<T = unknown>(
  rawPath: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = (opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers = opts.headers ?? {};
  const body = (opts.body ?? {}) as any;
  const { pathname, searchParams } = parseQuery(rawPath);
  const me = currentMe(headers);

  // Auth
  if (pathname === '/auth/me' && method === 'GET') return me as T;
  if (pathname === '/auth/login' && method === 'POST') return { user: me } as T;
  if (pathname === '/auth/logout' && method === 'POST') return undefined as T;
  if (pathname === '/users' && method === 'GET') return { items: Object.values(DEMO_USERS) } as T;
  if (pathname === '/users' && method === 'POST') {
    const u: User = { id: nextUuid(), email: body.email, name: body.name, role: body.role, active: true, createdAt: new Date().toISOString() };
    return u as T;
  }

  // Overview
  if (pathname === '/overview' && method === 'GET') {
    const attempts = Array.from(ATTEMPTS.values()).map((a) => a.attempt);
    const ov: Overview = {
      campaigns: {
        running: CAMPAIGNS.filter((c) => c.status === 'RUNNING').length,
        paused: CAMPAIGNS.filter((c) => c.status === 'PAUSED').length,
        ready: CAMPAIGNS.filter((c) => c.status === 'READY').length,
        scheduled: CAMPAIGNS.filter((c) => c.status === 'SCHEDULED').length,
        completed: CAMPAIGNS.filter((c) => c.status === 'COMPLETED' || c.status === 'CLOSED').length,
      },
      attempts: {
        active: attempts.filter((a) => ['RESERVED', 'SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION'].includes(a.state)).length,
        reconciliation: attempts.filter((a) => a.state === 'RECONCILIATION').length,
        sentToday: attempts.length,
      },
      contacts: CONTACTS.length,
      mailings: MAILINGS.length,
      globalSuspension: CONTROL.globalSuspension,
    };
    return ov as T;
  }

  // Mailings & Import
  if (pathname === '/mailings' && method === 'GET') {
    const items: MailingSummary[] = MAILINGS.map((m) => {
      const lv = m.detail.versions[m.detail.versions.length - 1] ?? null;
      return {
        id: m.detail.id,
        name: m.detail.name,
        createdAt: m.detail.createdAt,
        recordCount: m.detail.recordCount,
        lastVersion: lv ? { version: lv.version, validRows: lv.validRows, rejectedRows: lv.rejectedRows, createdAt: lv.createdAt } : null,
      };
    });
    return { items } as T;
  }
  const mailingMatch = pathname.match(/^\/mailings\/([^/]+)$/);
  if (mailingMatch && method === 'GET') {
    const found = MAILINGS.find((m) => m.detail.id === mailingMatch[1]) ?? MAILINGS[0];
    return found.detail as T;
  }
  const mailingRecsMatch = pathname.match(/^\/mailings\/([^/]+)\/records$/);
  if (mailingRecsMatch && method === 'GET') {
    const found = MAILINGS.find((m) => m.detail.id === mailingRecsMatch[1]) ?? MAILINGS[0];
    const q = (searchParams.get('q') ?? '').toLowerCase();
    const items = found.records.filter(
      (r) => !q || r.externalId.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q),
    );
    return { items, nextCursor: null, total: items.length } as T;
  }
  if (pathname === '/imports/preview' && method === 'POST') {
    return buildImportPreview(body) as T;
  }
  if (pathname === '/imports' && method === 'POST') {
    const prev = buildImportPreview(body);
    if (prev.rejectedRows > 0 && !body.acceptPartial) {
      throw new ApiError({ type: 'validation', title: 'Confirme a importação parcial', status: 422, fieldErrors: { acceptPartial: 'Confirme a importação parcial' } });
    }
    const newId = nextUuid();
    const verId = nextUuid();
    const now = new Date().toISOString();
    const validRows = prev.rows.filter((r) => r.errors.length === 0);
    const records: MailingRecord[] = validRows.map((r, idx) => ({
      id: nextUuid(),
      rowNumber: r.rowNumber,
      contactId: CONTACTS[idx % CONTACTS.length].id,
      externalId: Object.values(r.values)[0] || String(idx + 1).padStart(4, '0'),
      name: Object.values(r.values)[1] || `Cliente ${idx + 1}`,
      fields: r.values,
      blocked: false,
    }));
    MAILINGS.unshift({
      detail: {
        id: newId,
        name: body.name || 'Novo Mailing',
        createdAt: now,
        recordCount: prev.validRows,
        columns: prev.headers,
        versions: [{ id: verId, version: 1, totalRows: prev.totalRows, validRows: prev.validRows, rejectedRows: prev.rejectedRows, createdAt: now }],
      },
      records,
    });
    return { mailingId: newId, versionId: verId, validRows: prev.validRows, rejectedRows: prev.rejectedRows } as T;
  }

  // Lists
  if (pathname === '/lists' && method === 'GET') {
    const items: ListSummary[] = LISTS.map((l) => ({
      id: l.id,
      name: l.name,
      mailing: l.mailing,
      latestVersion: l.latestVersion,
    }));
    return { items } as T;
  }
  if (pathname === '/lists/preview' && method === 'POST') {
    const m = MAILINGS.find((x) => x.detail.id === body.mailingId) ?? MAILINGS[0];
    const filters: ListFilter[] = body.filters ?? [];
    const sorts: { field: string; dir: 'asc' | 'desc' }[] = body.sort ?? [];
    const activeRecords = m.records.filter((r) => !r.blocked);
    let filtered = filters.length === 0 ? [...activeRecords] : activeRecords.slice(0, Math.max(1, Math.floor(activeRecords.length * 0.7)));

    if (sorts.length > 0) {
      filtered.sort((a, b) => {
        for (const s of sorts) {
          const valA = (s.field === 'external_id' ? a.externalId : s.field === 'name' ? a.name : a.fields[s.field]) ?? '';
          const valB = (s.field === 'external_id' ? b.externalId : s.field === 'name' ? b.name : b.fields[s.field]) ?? '';
          let cmp = 0;
          if (typeof valA === 'number' && typeof valB === 'number') {
            cmp = valA - valB;
          } else {
            cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
          }
          if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }

    const prev: ListPreview = {
      selected: filtered.length,
      excluded: [{ reason: 'DNC', count: m.records.filter((r) => r.blocked).length || 1 }],
      sample: filtered.slice(0, 15).map((r) => ({
        contactId: r.contactId,
        externalId: r.externalId,
        name: r.name,
        fields: r.fields,
      })),
      fields: [
        { key: 'cidade', type: 'text' },
        { key: 'valor_divida', type: 'number' },
        { key: 'dias_atraso', type: 'number' },
        { key: 'score', type: 'number' },
      ],
    };
    return prev as T;
  }
  if (pathname === '/lists' && method === 'POST') {
    const m = MAILINGS.find((x) => x.detail.id === body.mailingId) ?? MAILINGS[0];
    const existing = body.listId ? LISTS.find((l) => l.id === body.listId) : undefined;
    const listId = existing?.id ?? nextUuid();
    const listVersionId = nextUuid();
    const version = existing ? existing.versions.length + 1 : 1;
    const memberCount = Math.max(1, m.records.length - 1);
    const vInfo = {
      id: listVersionId,
      version,
      membershipMode: (body.membershipMode ?? 'SNAPSHOT') as 'SNAPSHOT' | 'DYNAMIC',
      memberCount,
      publishedAt: new Date().toISOString(),
      filters: body.filters ?? [],
      sort: body.sort ?? [],
    };
    if (existing) {
      existing.name = body.name || existing.name;
      existing.latestVersion = vInfo;
      existing.versions.push(vInfo);
    } else {
      LISTS.unshift({
        id: listId,
        name: body.name || 'Nova Lista',
        mailing: { id: m.detail.id, name: m.detail.name },
        latestVersion: vInfo,
        versions: [vInfo],
      });
    }
    return { listId, listVersionId, version, memberCount } as T;
  }
  const listMatch = pathname.match(/^\/lists\/([^/]+)$/);
  if (listMatch && method === 'GET') {
    const found = LISTS.find((l) => l.id === listMatch[1]) ?? LISTS[0];
    return found as T;
  }
  const listMembersMatch = pathname.match(/^\/lists\/versions\/([^/]+)\/members$/);
  if (listMembersMatch && method === 'GET') {
    const items: ListMember[] = MAILINGS[0].records.slice(0, 16).map((r) => ({
      contactId: r.contactId,
      externalId: r.externalId,
      name: r.name,
      fields: r.fields,
    }));
    return { items, nextCursor: null, total: items.length } as T;
  }

  // Catalog
  if (pathname === '/tabulations' && method === 'GET') return { items: TABULATIONS } as T;
  if (pathname === '/connections' && method === 'GET') return { items: CONNECTIONS } as T;
  const connMatch = pathname.match(/^\/connections\/([^/]+)$/);
  if (connMatch && method === 'PATCH') {
    const c = CONNECTIONS.find((x) => x.id === connMatch[1]);
    if (c) {
      if (body.name !== undefined) c.name = body.name;
      if (body.tariff !== undefined) {
        c.tariff = body.tariff;
        c.tariffUpdatedAt = body.tariff === null ? null : new Date().toISOString();
      }
      if (body.active !== undefined) c.active = body.active;
      if (body.simulation !== undefined) c.simulation = body.simulation;
    }
    return (c ?? CONNECTIONS[0]) as T;
  }
  if (pathname === '/journeys' && method === 'GET') return { items: JOURNEYS } as T;
  if (pathname === '/journeys' && method === 'POST') {
    const j: Journey = {
      id: nextUuid(),
      name: body.name || 'Nova Jornada',
      latestVersion: {
        id: nextUuid(),
        version: 1,
        steps: (body.steps ?? []).map((s: any) => ({
          ...s,
          connectionName: CONNECTIONS.find((c) => c.id === s.connectionId)?.name ?? 'Conexão simulada',
        })),
      },
    };
    JOURNEYS.unshift(j);
    return j as T;
  }
  if (pathname === '/strategies' && method === 'GET') {
    const items: Strategy[] = STRATEGIES.map(({ versions: _v, ...rest }) => rest);
    return { items } as T;
  }
  if (pathname === '/strategies' && method === 'POST') {
    const v: StrategyVersion = { id: nextUuid(), version: 1, config: body.config ?? STRATEGIES[0].latestVersion!.config, publishedAt: new Date().toISOString() };
    const s: StrategyDetail = { id: nextUuid(), name: body.name || 'Nova Estratégia', protected: false, latestVersion: v, versions: [v] };
    STRATEGIES.unshift(s);
    return { id: s.id } as T;
  }
  const stratMatch = pathname.match(/^\/strategies\/([^/]+)$/);
  if (stratMatch && method === 'GET') {
    return (STRATEGIES.find((s) => s.id === stratMatch[1]) ?? STRATEGIES[0]) as T;
  }
  const stratVerMatch = pathname.match(/^\/strategies\/([^/]+)\/versions$/);
  if (stratVerMatch && method === 'POST') {
    const s = STRATEGIES.find((x) => x.id === stratVerMatch[1]) ?? STRATEGIES[0];
    const v: StrategyVersion = {
      id: nextUuid(),
      version: s.versions.length + 1,
      config: body.config,
      publishedAt: new Date().toISOString(),
    };
    s.latestVersion = v;
    s.versions.push(v);
    return v as T;
  }

  // Campaign Draft & Preflight
  if (pathname === '/campaign-draft') {
    if (method === 'GET') return DRAFT as T;
    if (method === 'PUT') {
      const nextRev = (DRAFT?.revision ?? 0) + 1;
      const updatedAt = new Date().toISOString();
      DRAFT = { data: body.data as CampaignDraft, revision: nextRev, updatedAt };
      return { revision: nextRev, updatedAt } as T;
    }
    if (method === 'DELETE') {
      DRAFT = null;
      return undefined as T;
    }
  }
  if (pathname === '/campaigns/preflight' && method === 'POST') {
    const m = MAILINGS.find((x) => x.detail.id === body.mailingId) ?? MAILINGS[0];
    const l = body.listVersionId ? LISTS.find((x) => x.versions.some((v) => v.id === body.listVersionId)) : null;
    const j = JOURNEYS.find((x) => x.latestVersion?.id === body.journeyVersionId) ?? JOURNEYS[0];
    const s = STRATEGIES.find((x) => x.versions.some((v) => v.id === body.strategyVersionId)) ?? STRATEGIES[0];
    const sv = s.versions.find((v) => v.id === body.strategyVersionId) ?? s.latestVersion!;
    const count = l ? (l.latestVersion?.memberCount ?? 16) : m.detail.recordCount;
    const firstConn = CONNECTIONS.find((c) => c.id === j.latestVersion?.steps[0]?.connectionId);
    const tariff = firstConn?.tariff ?? null;
    const pf: Preflight = {
      audience: { type: l ? 'LIST' : 'MAILING', name: l ? l.name : m.detail.name, count },
      journey: { name: j.name, steps: j.latestVersion?.steps ?? [] },
      strategy: {
        name: s.name,
        version: sv.version,
        summary: [
          `Até ${sv.config.limits.total} tentativas no total e ${sv.config.limits.daily} por dia`,
          `Janela ${sv.config.calendar.start}–${sv.config.calendar.end} (${sv.config.calendar.timezone})`,
          `Retentativa após ${sv.config.retry.intervalMinutes} min (até ${sv.config.retry.maxPerDestination} por destino)`,
        ],
      },
      nextWindow: new Date(Date.now() + 60_000).toISOString(),
      costEstimate: {
        value: tariff !== null ? count * tariff : null,
        premise:
          tariff !== null
            ? `Estimativa para 1 tentativa por contato no primeiro canal (${firstConn?.name}).`
            : 'Uma tentativa por contato no primeiro canal; tarifa não informada.',
      },
      warnings: CONTROL.globalSuspension ? ['Suspensão global ativa no Controle central.'] : [],
    };
    return pf as T;
  }

  // Campaigns
  if (pathname === '/campaigns' && method === 'GET') {
    const status = searchParams.get('status') ?? '';
    const items = CAMPAIGNS.filter((c) => !status || c.status === status);
    return { items } as T;
  }
  if (pathname === '/campaigns' && method === 'POST') {
    if (!body.name?.trim()) {
      throw new ApiError({ type: 'validation', title: 'Verifique os campos', status: 422, fieldErrors: { name: 'Informe o nome da campanha' } });
    }
    const m = MAILINGS.find((x) => x.detail.id === body.mailingId) ?? MAILINGS[0];
    const l = body.listVersionId ? LISTS.find((x) => x.versions.some((v) => v.id === body.listVersionId)) : null;
    const j = JOURNEYS.find((x) => x.latestVersion?.id === body.journeyVersionId) ?? JOURNEYS[0];
    const s = STRATEGIES.find((x) => x.versions.some((v) => v.id === body.strategyVersionId)) ?? STRATEGIES[0];
    const sv = s.versions.find((v) => v.id === body.strategyVersionId) ?? s.latestVersion!;
    const status: CampaignStatus = body.startMode === 'NOW' ? 'RUNNING' : body.startMode === 'SCHEDULE' ? 'SCHEDULED' : 'READY';
    const members = l ? (l.latestVersion?.memberCount ?? 16) : m.detail.recordCount;
    const now = new Date().toISOString();
    const camp: CampaignDetail = {
      id: nextUuid(),
      name: body.name,
      description: body.description ?? null,
      status,
      statusLabel: CAMPAIGN_STATUS_LABEL[status],
      operationalState: status === 'RUNNING' ? 'PROCESSING' : 'IDLE',
      operationalExplanation:
        status === 'RUNNING'
          ? 'Processando: reservas e envios em andamento.'
          : status === 'SCHEDULED'
            ? 'Aguardando horário agendado para iniciar.'
            : 'Campanha pronta para início.',
      audience: { type: l ? 'LIST' : 'MAILING', name: l ? l.name : m.detail.name },
      journeyName: j.name,
      strategyName: s.name,
      strategyVersion: sv.version,
      createdAt: now,
      startedAt: status === 'RUNNING' ? now : null,
      scheduledAt: body.scheduledAt ?? null,
      progress: { members, finished: 0, active: members },
      mailing: { id: m.detail.id, name: m.detail.name },
      listVersion: l?.latestVersion ? { id: l.latestVersion.id, version: l.latestVersion.version, membershipMode: l.latestVersion.membershipMode } : null,
      journey: { id: j.id, version: j.latestVersion?.version ?? 1, steps: j.latestVersion?.steps ?? [] },
      strategy: { id: s.id, version: sv.version, config: sv.config },
    };
    CAMPAIGNS.unshift(camp);
    DRAFT = null;
    return camp as T;
  }
  const campActionMatch = pathname.match(/^\/campaigns\/([^/]+)\/(start|pause|resume|close)$/);
  if (campActionMatch && method === 'POST') {
    const c = CAMPAIGNS.find((x) => x.id === campActionMatch[1]) ?? CAMPAIGNS[0];
    const act = campActionMatch[2];
    if (act === 'start' || act === 'resume') {
      c.status = 'RUNNING';
      c.statusLabel = CAMPAIGN_STATUS_LABEL.RUNNING;
      c.startedAt ??= new Date().toISOString();
      c.operationalState = 'PROCESSING';
      c.operationalExplanation = 'Processando: reservas e envios em andamento.';
    } else if (act === 'pause') {
      c.status = 'PAUSED';
      c.statusLabel = CAMPAIGN_STATUS_LABEL.PAUSED;
      c.operationalState = 'IDLE';
      c.operationalExplanation = 'Campanha pausada: novas reservas suspensas.';
    } else if (act === 'close') {
      c.status = 'CLOSED';
      c.statusLabel = CAMPAIGN_STATUS_LABEL.CLOSED;
      c.operationalState = 'IDLE';
      c.operationalExplanation = `Campanha encerrada (${body?.reason ?? 'sem motivo'}).`;
    }
    return c as T;
  }
  const campMatch = pathname.match(/^\/campaigns\/([^/]+)$/);
  if (campMatch && method === 'GET') {
    return (CAMPAIGNS.find((c) => c.id === campMatch[1]) ?? CAMPAIGNS[0]) as T;
  }
  const campAttemptsMatch = pathname.match(/^\/campaigns\/([^/]+)\/attempts$/);
  if (campAttemptsMatch && method === 'GET') {
    const cid = campAttemptsMatch[1];
    const state = searchParams.get('state') ?? '';
    const all = Array.from(ATTEMPTS.values())
      .map((a) => a.attempt)
      .filter((a) => (!a.campaign || a.campaign.id === cid || cid === CAMPAIGNS[0]?.id) && (!state || a.state === state));
    return { items: all, nextCursor: null, total: all.length } as T;
  }
  const campEligMatch = pathname.match(/^\/campaigns\/([^/]+)\/eligibility$/);
  if (campEligMatch && method === 'GET') {
    const reasonFilter = (searchParams.get('reason') ?? '') as ReasonCode | '';
    const rows: EligibilityRow[] = CONTACTS.slice(0, 12).map((c, idx) => {
      const blocked = c.blocks.some((b) => !b.revokedAt);
      const reasons: ReasonCode[] = blocked
        ? ['DNC']
        : idx === 1
          ? ['ACTIVE_RESERVATION']
          : idx === 2
            ? ['RECONCILIATION']
            : idx % 3 === 0
              ? ['AWAITING_RETRY']
              : [];
      const eligible = reasons.length === 0;
      return {
        enrollmentId: uuid(600 + idx),
        contact: { id: c.id, externalId: c.externalId, name: c.name },
        enrollmentState: idx === 4 ? 'DONE_SUCCESS' : 'ACTIVE',
        stage: 0,
        channelType: 'VOICE',
        destinationMasked: c.destinations[0]?.addressMasked ?? null,
        eligible,
        primaryReason: reasons[0] ?? null,
        reasons,
        counters: { total: c.historyTotal, today: idx % 2, totalLimit: 10, dailyLimit: 3 },
        nextEligibleAt: eligible ? new Date().toISOString() : new Date(Date.now() + 1800_000).toISOString(),
        strategyVersion: 1,
      };
    });
    const filtered = reasonFilter ? rows.filter((r) => r.reasons.includes(reasonFilter)) : rows;
    const elig: Eligibility = {
      evaluatedAt: new Date().toISOString(),
      cards: {
        members: rows.length,
        eligibleNow: rows.filter((r) => r.eligible).length,
        reserved: 0,
        pending: 1,
        reconciliation: 1,
        finished: 2,
      },
      reasons: [
        { reason: 'DNC', count: 1 },
        { reason: 'ACTIVE_RESERVATION', count: 1 },
        { reason: 'RECONCILIATION', count: 1 },
        { reason: 'AWAITING_RETRY', count: 3 },
      ],
      items: filtered,
      nextCursor: null,
    };
    return elig as T;
  }
  const campIndMatch = pathname.match(/^\/campaigns\/([^/]+)\/indicators$/);
  if (campIndMatch && method === 'GET') {
    const ind: Indicators = {
      sent: 14,
      contactsWorked: 11,
      cpcContacts: 5,
      cpcRate: 5 / 11,
      conversions: 2,
      cost: { known: 1.28, coverage: { withCost: 12, total: 14 }, partial: true },
      costPerCpc: null,
      costPerConversion: null,
      pending: { reserved: 0, sent: 1, awaitingFeedback: 0, reconciliation: 1 },
      byChannel: [
        { channelType: 'WHATSAPP', sent: 8, cpc: 3, conversions: 1 },
        { channelType: 'VOICE', sent: 6, cpc: 2, conversions: 1 },
      ],
      byTabulation: [
        { code: 'CONVERSION', name: 'Acordo fechado', count: 2 },
        { code: 'CPC_NO_DEAL', name: 'Titular sem acordo', count: 3 },
        { code: 'NO_ANSWER', name: 'Não atendeu', count: 5 },
        { code: 'READ_NO_REPLY', name: 'Lida sem resposta', count: 2 },
      ],
    };
    return ind as T;
  }

  // Attempts & Operation
  if (pathname === '/operation/attempts' && method === 'GET') {
    const state = searchParams.get('state') ?? '';
    const campaignId = searchParams.get('campaignId') ?? '';
    const q = (searchParams.get('q') ?? '').toLowerCase();
    const items = Array.from(ATTEMPTS.values())
      .map((a) => a.attempt)
      .filter(
        (a) =>
          (!state || a.state === state) &&
          (!campaignId || a.campaign?.id === campaignId) &&
          (!q || (a.contact.name ?? '').toLowerCase().includes(q) || a.contact.externalId.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)),
      );
    return { items, nextCursor: null, total: items.length } as T;
  }
  const attemptMatch = pathname.match(/^\/attempts\/([^/]+)$/);
  if (attemptMatch && method === 'GET') {
    const found = ATTEMPTS.get(attemptMatch[1]) ?? Array.from(ATTEMPTS.values())[0];
    return found as T;
  }
  const reconcileMatch = pathname.match(/^\/attempts\/([^/]+)\/reconcile$/);
  if (reconcileMatch && method === 'POST') {
    const d = ATTEMPTS.get(reconcileMatch[1]);
    if (d) {
      const now = new Date().toISOString();
      const tab = body.tabulationCode ? TABULATIONS.find((t) => t.code === body.tabulationCode) ?? null : null;
      d.attempt.state = 'FINALIZED';
      d.attempt.stateLabel = ATTEMPT_STATE_LABEL.FINALIZED;
      d.attempt.finalizedAt = now;
      d.attempt.tabulation = tab ? { code: tab.code, name: tab.name } : null;
      d.attempt.nextAction = 'Reconciliação concluída';
      d.explanation = {
        whatHappened: `Reconciliado manualmente (${body.resolution}).`,
        why: body.reason,
        nextAction: 'Cliente liberado para avaliação normal da estratégia.',
      };
      d.timeline.push({
        id: d.timeline.length + 1,
        eventType: 'RECONCILED',
        label: `Reconciliação resolvida: ${tab ? tab.name : 'Falha confirmada'}`,
        fromState: 'RECONCILIATION',
        toState: 'FINALIZED',
        reasonCode: null,
        duplicate: false,
        occurredAt: now,
        receivedAt: now,
        data: body,
      });
      AUDITS.unshift({
        id: AUDITS.length + 1,
        at: now,
        user: { name: me.name },
        action: 'attempt.reconcile',
        entity: 'attempt',
        entityId: d.attempt.id,
        reason: body.reason,
        before: { state: 'RECONCILIATION' },
        after: { state: 'FINALIZED', resolution: body.resolution, tabulationCode: body.tabulationCode },
      });
    }
    return { ok: true } as T;
  }
  const simRepeatMatch = pathname.match(/^\/sim\/attempts\/([^/]+)\/repeat-last-event$/);
  if (simRepeatMatch && method === 'POST') {
    const d = ATTEMPTS.get(simRepeatMatch[1]);
    if (d) {
      const now = new Date().toISOString();
      d.timeline.push({
        id: d.timeline.length + 1,
        eventType: 'DELIVERY_CONFIRMED',
        label: 'Evento reenviado pelo simulador',
        fromState: d.attempt.state,
        toState: d.attempt.state,
        reasonCode: null,
        duplicate: true,
        occurredAt: now,
        receivedAt: now,
        data: {},
      });
    }
    return { ok: true } as T;
  }
  const simResultMatch = pathname.match(/^\/sim\/attempts\/([^/]+)\/result$/);
  if (simResultMatch && method === 'POST') {
    const d = ATTEMPTS.get(simResultMatch[1]);
    if (d) {
      const now = new Date().toISOString();
      const tab = TABULATIONS.find((t) => t.code === body.tabulationCode) ?? TABULATIONS[0];
      d.attempt.state = 'FINALIZED';
      d.attempt.stateLabel = ATTEMPT_STATE_LABEL.FINALIZED;
      d.attempt.finalizedAt = now;
      d.attempt.tabulation = { code: tab.code, name: tab.name };
      d.attempt.nextAction = 'Resultado aplicado pelo simulador';
      d.timeline.push({
        id: d.timeline.length + 1,
        eventType: 'RESULT',
        label: `Resultado simulado: ${tab.name}`,
        fromState: 'SENT',
        toState: 'FINALIZED',
        reasonCode: null,
        duplicate: false,
        occurredAt: now,
        receivedAt: now,
        data: { tabulationCode: tab.code },
      });
    }
    return { ok: true } as T;
  }

  // Contacts
  if (pathname === '/contacts' && method === 'GET') {
    const q = (searchParams.get('q') ?? '').toLowerCase();
    const filtered = CONTACTS.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.externalId.toLowerCase().includes(q),
    );
    const items: ContactRow[] = filtered.map((c, idx) => {
      const byChan = new Map<ChannelType, number>();
      for (const d of c.destinations) byChan.set(d.channelType, (byChan.get(d.channelType) ?? 0) + 1);
      return {
        id: c.id,
        externalId: c.externalId,
        name: c.name,
        blocked: c.blocks.some((b) => !b.revokedAt && b.scope === 'CONTACT'),
        destinations: Array.from(byChan.entries()).map(([channelType, count]) => ({ channelType, count })),
        attempts: { total: c.historyTotal, new: idx < 6 ? 1 : 0 },
        lastTabulation: idx === 1 ? { code: 'CONVERSION', name: 'Acordo fechado', at: '2026-10-20T10:15:00Z' } : null,
        campaigns: 1,
      };
    });
    return { items, nextCursor: null, total: items.length } as T;
  }
  const contactMatch = pathname.match(/^\/contacts\/([^/]+)$/);
  if (contactMatch && method === 'GET') {
    const c = CONTACTS.find((x) => x.id === contactMatch[1]) ?? CONTACTS[0];
    const contactAttempts = Array.from(ATTEMPTS.values())
      .map((a) => a.attempt)
      .filter((a) => a.contact.id === c.id);
    const detail: ContactDetail = {
      contact: {
        id: c.id,
        externalId: c.externalId,
        name: c.name,
        attributes: c.attributes,
        historyTotal: c.historyTotal,
        historyReferenceDate: c.historyReferenceDate,
      },
      destinations: c.destinations,
      blocks: c.blocks,
      counters: {
        historyTotal: c.historyTotal,
        newTotal: contactAttempts.length,
        today: contactAttempts.length,
        byChannel: [{ channelType: 'VOICE', count: contactAttempts.length }],
      },
      enrollments: [{ campaign: { id: CAMPAIGNS[0].id, name: CAMPAIGNS[0].name }, state: 'ACTIVE', stage: 0 }],
      attempts: contactAttempts,
    };
    return detail as T;
  }
  const addDestMatch = pathname.match(/^\/contacts\/([^/]+)\/destinations$/);
  if (addDestMatch && method === 'POST') {
    const c = CONTACTS.find((x) => x.id === addDestMatch[1]) ?? CONTACTS[0];
    const d: Destination = {
      id: nextUuid(),
      channelType: body.channelType,
      address: body.address,
      addressMasked: maskAddress(body.address),
      label: body.label || null,
      priority: body.priority ?? 1,
      valid: true,
      blocked: false,
    };
    c.destinations.push(d);
    return d as T;
  }
  const patchDestMatch = pathname.match(/^\/contacts\/([^/]+)\/destinations\/([^/]+)$/);
  if (patchDestMatch && method === 'PATCH') {
    const c = CONTACTS.find((x) => x.id === patchDestMatch[1]) ?? CONTACTS[0];
    const d = c.destinations.find((x) => x.id === patchDestMatch[2]);
    if (d) {
      if (body.valid !== undefined) d.valid = body.valid;
      if (body.priority !== undefined) d.priority = body.priority;
    }
    return (d ?? c.destinations[0]) as T;
  }

  // Control, Blocks & Audit
  if (pathname === '/control' && method === 'GET') return CONTROL as T;
  if (pathname === '/control' && method === 'PUT') {
    const before = { ...CONTROL };
    CONTROL = {
      dailyLimit: body.dailyLimit ?? null,
      totalLimit: body.totalLimit ?? null,
      globalSuspension: !!body.globalSuspension,
    };
    AUDITS.unshift({
      id: AUDITS.length + 1,
      at: new Date().toISOString(),
      user: { name: me.name },
      action: 'control.update',
      entity: 'workspace',
      entityId: WS.id,
      reason: body.reason ?? null,
      before,
      after: CONTROL,
    });
    return CONTROL as T;
  }
  if (pathname === '/blocks' && method === 'POST') {
    const c = CONTACTS.find((x) => x.id === body.contactId) ?? CONTACTS[0];
    const b: Block = {
      id: nextUuid(),
      scope: body.scope,
      destinationId: body.destinationId ?? null,
      reason: body.reason,
      origin: 'MANUAL',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    c.blocks.unshift(b);
    if (body.scope === 'DESTINATION' && body.destinationId) {
      const dest = c.destinations.find((d) => d.id === body.destinationId);
      if (dest) dest.blocked = true;
    }
    return b as T;
  }
  const revokeBlockMatch = pathname.match(/^\/blocks\/([^/]+)\/revoke$/);
  if (revokeBlockMatch && method === 'POST') {
    for (const c of CONTACTS) {
      const b = c.blocks.find((x) => x.id === revokeBlockMatch[1]);
      if (b) {
        b.revokedAt = new Date().toISOString();
        if (b.destinationId) {
          const dest = c.destinations.find((d) => d.id === b.destinationId);
          if (dest) dest.blocked = false;
        }
      }
    }
    return { ok: true } as T;
  }
  if (pathname === '/audit' && method === 'GET') {
    return { items: AUDITS, nextCursor: null } as T;
  }

  // Central de Decisão · Experimentos A/B (§21)
  if (pathname === '/experiments' && method === 'GET') {
    return {
      items: [
        {
          id: uuid(701),
          name: 'Teste de Cadência: WhatsApp Primeiro vs. Discador Direto',
          status: 'RUNNING',
          list: { id: LIST_ID, name: 'Atraso > 30 dias (SP/RJ)' },
          groupA: {
            name: 'A (WhatsApp → Discador)',
            journeyName: 'WhatsApp → Discador',
            strategyName: 'Demonstração 24x7',
            evaluated: 80,
            conversions: 18,
            rate: 0.225,
            wilsonInterval: [0.148, 0.326],
            costPerConversion: 1.85,
          },
          groupB: {
            name: 'B (Discador Direto)',
            journeyName: 'Discador',
            strategyName: 'Padrão cobrança',
            evaluated: 80,
            conversions: 11,
            rate: 0.137,
            wilsonInterval: [0.078, 0.231],
            costPerConversion: 2.45,
          },
          winner: null,
          conclusionNote: 'Intervalos de Wilson sobrepostos [14.8%–32.6%] vs [7.8%–23.1%]. Amostra em maturação — resultado estatisticamente inconclusivo.',
          createdAt: '2026-10-21T10:00:00Z',
        },
      ],
    } as T;
  }
  if (pathname.match(/^\/experiments\/([^/]+)\/simulate-batch$/) && method === 'POST') {
    return { ok: true } as T;
  }
  if (pathname === '/experiments' && method === 'POST') {
    return { id: nextUuid() } as T;
  }

  // Central de Decisão · Otimização & Recomendações (§22)
  if (pathname === '/optimization' && method === 'GET') {
    const cid = searchParams.get('campaignId');
    const camp = CAMPAIGNS.find((c) => c.id === cid) ?? CAMPAIGNS[0];
    const recs = CONTACTS.slice(0, 10).map((c, idx) => ({
      contactId: c.id,
      externalId: c.externalId,
      name: c.name,
      channel: idx % 2 === 0 ? 'WhatsApp' : 'Discador',
      destinationMasked: c.destinations[0]?.addressMasked ?? '1198****01',
      bestTimeWindow: idx % 3 === 0 ? '10:00 – 12:00' : '14:00 – 16:30',
      evidencesCount: 3 + (idx % 4),
      historicRate: 0.25 + (idx * 0.04),
      estimatedCostPerSuccess: 0.45 + (idx * 0.15),
      policyUsed: 'Menor custo por CPC (mínimo 3 evidências)',
    }));
    return {
      items: recs,
      policy: 'Menor custo por CPC (com fallback para ordem do template)',
      notes: [
        'Amostra mínima de 3 evidências satisfeita para os candidatos exibidos.',
        'Horários calculados a partir de eventos com CPC anterior no mesmo cluster.',
      ],
    } as T;
  }

  // Central de Decisão · Custos & Conciliação (§20)
  if (pathname === '/costs' && method === 'GET') {
    const list = Array.from(ATTEMPTS.values()).map((a, idx) => ({
      attemptId: a.attempt.id,
      campaignName: a.attempt.campaign?.name ?? CAMPAIGNS[0].name,
      contactName: a.attempt.contact.name ?? 'Cliente',
      channel: a.attempt.channelType === 'VOICE' ? 'Discador' : 'WhatsApp',
      connectionName: a.attempt.connectionName,
      tariffPreserved: a.attempt.tariffSnapshot,
      estimatedCost: a.attempt.tariffSnapshot,
      confirmedCost: idx === 0 ? 0.048 : idx === 1 ? 0.115 : null,
      status: idx < 2 ? ('CONFIRMED' as const) : ('ESTIMATED' as const),
      invoiceRef: idx < 2 ? 'FAT-2026-10-CONECT' : null,
      createdAt: a.attempt.createdAt,
    }));
    return {
      items: list,
      summary: {
        totalConfirmed: 0.163,
        totalEstimated: 0.36,
        coverageCount: 2,
        pendingCount: list.length - 2,
      },
    } as T;
  }
  if (pathname === '/costs/reconcile-batch' && method === 'POST') {
    return { ok: true } as T;
  }

  return {} as T;
}
