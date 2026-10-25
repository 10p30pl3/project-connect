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
import { buildContactIntelligenceRationale } from './intelligence-rationale';
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

const FIRST_NAMES = [
  'Ana', 'Lucas', 'Carlos', 'Fernanda', 'José', 'Patrícia', 'Antônio', 'Beatriz',
  'Rodrigo', 'Silvia', 'Felipe', 'Helena', 'Marcos', 'Camila', 'Gabriel', 'Juliana',
  'Rafael', 'Mariana', 'Thiago', 'Aline', 'Matheus', 'Renata', 'Gustavo', 'Larissa',
  'Eduardo', 'Vanessa', 'Vinícius', 'Amanda', 'Leonardo', 'Bruna', 'Marcelo', 'Tatiane',
  'Diego', 'Priscila', 'Danilo', 'Letícia', 'Fábio', 'Sabrina', 'Ricardo', 'Carolina',
  'Sebastião', 'Aparecida', 'Raimundo', 'Francisca', 'Geraldo', 'Maria', 'João', 'Pedro',
  'Luiz', 'Vera', 'Wagner', 'Sônia', 'Cláudio', 'Eliane', 'Sérgio', 'Marlene', 'Jorge', 'Rosa',
];

const LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira',
  'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes',
  'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade',
  'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas', 'Cardoso', 'Ramos',
  'Gonçalves', 'Santana', 'Teixeira', 'Castro', 'Moraes', 'Cavalcanti', 'Pinto', 'Monteiro',
];

const HUBS = [
  { ddd: '11', uf: 'SP', city: 'São Paulo' },
  { ddd: '21', uf: 'RJ', city: 'Rio de Janeiro' },
  { ddd: '31', uf: 'MG', city: 'Belo Horizonte' },
  { ddd: '41', uf: 'PR', city: 'Curitiba' },
  { ddd: '51', uf: 'RS', city: 'Porto Alegre' },
  { ddd: '71', uf: 'BA', city: 'Salvador' },
  { ddd: '81', uf: 'PE', city: 'Recife' },
  { ddd: '85', uf: 'CE', city: 'Fortaleza' },
  { ddd: '61', uf: 'DF', city: 'Brasília' },
  { ddd: '62', uf: 'GO', city: 'Goiânia' },
  { ddd: '91', uf: 'PA', city: 'Belém' },
  { ddd: '92', uf: 'AM', city: 'Manaus' },
  { ddd: '19', uf: 'SP', city: 'Campinas' },
  { ddd: '47', uf: 'SC', city: 'Joinville' },
];

const AGES = [21, 23, 28, 31, 34, 38, 42, 49, 54, 63, 68, 74];

const CONTACTS: FullContact[] = Array.from({ length: 1000 }, (_, idx) => {
  const i = idx + 1;
  const id = uuid(100 + i);
  const externalId = String(i).padStart(6, '0');
  const fn = FIRST_NAMES[i % FIRST_NAMES.length];
  const ln1 = LAST_NAMES[(i * 3) % LAST_NAMES.length];
  const ln2 = LAST_NAMES[(i * 7 + 1) % LAST_NAMES.length];
  const name = `${fn} ${ln1} ${ln2}`;
  const hub = HUBS[i % HUBS.length];
  const age = AGES[i % AGES.length];

  let intent = 'P2_HIBRIDO_DIGITAL_VOZ';
  if (age < 25) intent = i % 3 === 0 ? 'P1_ALTA_PROPENSAO_VOZ' : 'P3_DIGITAL_FIRST';
  else if (age < 35) intent = i % 2 === 0 ? 'P1_ALTA_PROPENSAO_VOZ' : 'P2_HIBRIDO_DIGITAL_VOZ';
  else if (age < 60) intent = i % 3 === 0 ? 'P2_HIBRIDO_DIGITAL_VOZ' : 'P1_ALTA_PROPENSAO_VOZ';
  else intent = 'P1_ALTA_PROPENSAO_VOZ';

  const numPart = String(80000000 + ((i * 179) % 19999999)).slice(0, 8);
  const phoneRaw = `55${hub.ddd}9${numPart}`;
  const phoneMasked = `(${hub.ddd}) 9${numPart.slice(0, 4)}-${numPart.slice(4)}`;

  const destinations: Destination[] = [
    {
      id: uuid(2000 + i * 4 + 1),
      channelType: 'VOICE',
      address: phoneRaw,
      addressMasked: phoneMasked,
      label: 'Telefone Principal',
      priority: 1,
      valid: true,
      blocked: false,
    },
  ];

  if (age >= 60 && i % 2 === 0) {
    const fixedNum = String(2000000 + ((i * 83) % 799999)).slice(0, 3) + String(i * 10).slice(0, 4).padStart(4, '0');
    const fixedRaw = `55${hub.ddd}3${fixedNum}`;
    const fixedMasked = `(${hub.ddd}) 3${fixedNum.slice(0, 3)}-${fixedNum.slice(3)}`;
    destinations.push({
      id: uuid(2000 + i * 4 + 2),
      channelType: 'VOICE',
      address: fixedRaw,
      addressMasked: fixedMasked,
      label: 'Telefone Fixo Residencial',
      priority: 2,
      valid: true,
      blocked: false,
    });
  }

  if (age < 60 || i % 3 !== 0) {
    destinations.push({
      id: uuid(2000 + i * 4 + 3),
      channelType: 'WHATSAPP',
      address: phoneRaw,
      addressMasked: phoneMasked,
      label: 'WhatsApp Verificado',
      priority: 1,
      valid: true,
      blocked: false,
    });
  }

  if (i % 4 !== 0) {
    const email = `${fn.toLowerCase()}.${ln1.toLowerCase()}${i}@exemplo.com.br`;
    destinations.push({
      id: uuid(2000 + i * 4 + 4),
      channelType: 'EMAIL',
      address: email,
      addressMasked: email.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
      label: 'E-mail Titular',
      priority: 3,
      valid: true,
      blocked: false,
    });
  }

  const isDnc = i === 11 || i % 59 === 0;
  const blocks: Block[] = isDnc
    ? [
        {
          id: uuid(5000 + i),
          scope: 'CONTACT',
          destinationId: null,
          reason: 'Bloqueio Procon / Não Me Perturbe (DNC Nacional)',
          origin: 'MANUAL',
          createdAt: '2026-10-18T14:20:00Z',
          revokedAt: null,
        },
      ]
    : [];

  const debt = Number((180 + ((i * 233) % 7800)).toFixed(2));
  const overdue = 15 + ((i * 13) % 165);
  const score = 320 + ((i * 37) % 580);

  return {
    id,
    externalId,
    name,
    attributes: {
      cidade: hub.city,
      uf: hub.uf,
      idade: age,
      valor_divida: debt,
      dias_atraso: overdue,
      ddd: hub.ddd,
      score,
      phone_intent: intent,
    },
    historyTotal: i % 5 === 0 ? null : (i * 2) % 6,
    historyReferenceDate: i % 5 === 0 ? null : '2026-10-20',
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
      name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)',
      createdAt: '2026-10-18T12:00:00Z',
      recordCount: CONTACTS.length,
      columns: ['cidade', 'uf', 'idade', 'valor_divida', 'dias_atraso', 'score', 'phone_intent'],
      versions: [
        {
          id: MAILING_VER_ID,
          version: 1,
          totalRows: CONTACTS.length + 5,
          validRows: CONTACTS.length,
          rejectedRows: 5,
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
    name: 'Atraso > 30 dias (Faixa Prioritária 680 Contatos)',
    mailing: { id: MAILING_ID, name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    latestVersion: {
      id: LIST_VER_ID,
      version: 1,
      membershipMode: 'SNAPSHOT',
      memberCount: 680,
      publishedAt: '2026-10-19T09:30:00Z',
    },
    versions: [
      {
        id: LIST_VER_ID,
        version: 1,
        membershipMode: 'SNAPSHOT',
        memberCount: 680,
        publishedAt: '2026-10-19T09:30:00Z',
        filters: [{ field: 'dias_atraso', op: 'gt', value: 30 }],
        sort: [{ field: 'valor_divida', dir: 'desc' }],
      },
    ],
  },
];

const CAMPAIGN_1_ID = uuid(80);
const CAMPAIGN_2_ID = uuid(81);
const CAMPAIGN_3_ID = uuid(82);

const CAMPAIGNS: CampaignDetail[] = [
  {
    id: CAMPAIGN_1_ID,
    name: 'Cobrança Outubro — Faixa 30+ dias (1.000 Contatos)',
    purposeCode: 'COBRANCA',
    description: 'Acionamento multicanal inteligente (WhatsApp + Discador) com foco em recuperação amigável e PIX.',
    status: 'RUNNING',
    statusLabel: CAMPAIGN_STATUS_LABEL.RUNNING,
    operationalState: 'PROCESSING',
    operationalExplanation: 'Processando: ondas automáticas e distribuição inteligente dentro da janela operacional.',
    audience: { type: 'MAILING', name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    journeyName: 'WhatsApp → Discador',
    strategyName: 'Demonstração 24x7',
    strategyVersion: 1,
    createdAt: '2026-10-20T10:00:00Z',
    startedAt: '2026-10-20T10:05:00Z',
    scheduledAt: null,
    progress: { members: 1000, finished: 180, active: 820 },
    mailing: { id: MAILING_ID, name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    listVersion: null,
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
    name: 'Venda Ativa — Oferta Fibra & Celular (800 Contatos)',
    purposeCode: 'VENDAS',
    description: 'Campanha de expansão comercial e upgrade de velocidade com WhatsApp interativo e discagem consultiva.',
    status: 'RUNNING',
    statusLabel: CAMPAIGN_STATUS_LABEL.RUNNING,
    operationalState: 'PROCESSING',
    operationalExplanation: 'Processando: acionamentos prioritários em janelas de receptividade (almoço e fim de tarde).',
    audience: { type: 'MAILING', name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    journeyName: 'WhatsApp → Discador',
    strategyName: 'Demonstração 24x7',
    strategyVersion: 1,
    createdAt: '2026-10-21T09:00:00Z',
    startedAt: '2026-10-21T09:15:00Z',
    scheduledAt: null,
    progress: { members: 800, finished: 240, active: 560 },
    mailing: { id: MAILING_ID, name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    listVersion: null,
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
    id: CAMPAIGN_3_ID,
    name: 'Confirmação de Agendamentos — Lembretes D-1 e D-0 (600 Contatos)',
    purposeCode: 'AGENDAMENTOS',
    description: 'Redução de no-show: Lembrete 1 dia antes (D-1 com botões de confirmação) e no dia (D-0 informativo 2h antes).',
    status: 'RUNNING',
    statusLabel: CAMPAIGN_STATUS_LABEL.RUNNING,
    operationalState: 'PROCESSING',
    operationalExplanation: 'Cadência ativa: lembretes de véspera (D-1) e do dia (D-0) sincronizados com as datas de agendamento.',
    audience: { type: 'MAILING', name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    journeyName: 'WhatsApp Prioritário',
    strategyName: 'Demonstração 24x7',
    strategyVersion: 1,
    createdAt: '2026-10-22T08:00:00Z',
    startedAt: '2026-10-22T08:10:00Z',
    scheduledAt: null,
    progress: { members: 600, finished: 390, active: 210 },
    mailing: { id: MAILING_ID, name: 'Mailing Piloto 1.000 Contatos (Inteligência de CPC)' },
    listVersion: null,
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
    { id: uuid(407), contactIdx: 7, channel: 'WHATSAPP', connName: 'WhatsApp simulado', state: 'RESERVED', tabCode: null, cost: null, tariff: 0.05, camp: CAMPAIGNS[0] },
    { id: uuid(408), contactIdx: 8, channel: 'VOICE', connName: 'Discador simulado', state: 'AWAITING_FEEDBACK', tabCode: null, cost: null, tariff: 0.12, camp: CAMPAIGNS[0] },
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
        : s.state === 'RESERVED'
          ? 'Despacho exclusivo reservado para o conector'
          : s.state === 'AWAITING_FEEDBACK'
            ? 'Aguardando confirmação final / tabulação do canal'
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
    const workingRecords = attempts.filter((a) => ['RESERVED', 'SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION'].includes(a.state));
    const workingContactIds = new Set(workingRecords.map((a) => a.contact.id));
    const activeCamp = CAMPAIGNS.find((c) => c.status === 'RUNNING') ?? CAMPAIGNS[0];
    const queueCandidates = CONTACTS.filter(
      (c) => !workingContactIds.has(c.id) && !c.blocks.some((b) => !b.revokedAt),
    ).slice(0, 8);

    const nextInQueue = queueCandidates.map((c, idx) => {
      const hasWa = c.destinations.some((d) => d.channelType === 'WHATSAPP');
      const channelType: ChannelType = idx % 2 === 0 && hasWa ? 'WHATSAPP' : 'VOICE';
      const dest = c.destinations.find((d) => d.channelType === channelType) ?? c.destinations[0];
      const eligibleNow = idx < 5 && !CONTROL.globalSuspension;
      return {
        enrollmentId: uuid(650 + idx),
        position: idx + 1,
        contact: { id: c.id, externalId: c.externalId, name: c.name },
        campaign: { id: activeCamp.id, name: activeCamp.name },
        audienceName: activeCamp.audience.name,
        stage: idx < 4 ? 0 : 1,
        channelType,
        destinationMasked: dest?.addressMasked ?? '—',
        counters: {
          total: c.historyTotal !== null ? c.historyTotal + (idx % 2) : null,
          today: idx % 2,
          totalLimit: activeCamp.strategy.config.limits.total,
          dailyLimit: activeCamp.strategy.config.limits.daily,
        },
        nextEligibleAt: eligibleNow
          ? new Date().toISOString()
          : new Date(Date.now() + (idx + 1) * 420_000).toISOString(),
        eligibleNow,
      };
    });

    const ov: Overview = {
      campaigns: {
        running: CAMPAIGNS.filter((c) => c.status === 'RUNNING').length,
        paused: CAMPAIGNS.filter((c) => c.status === 'PAUSED').length,
        ready: CAMPAIGNS.filter((c) => c.status === 'READY').length,
        scheduled: CAMPAIGNS.filter((c) => c.status === 'SCHEDULED').length,
        completed: CAMPAIGNS.filter((c) => c.status === 'COMPLETED' || c.status === 'CLOSED').length,
      },
      attempts: {
        active: workingRecords.length,
        reconciliation: attempts.filter((a) => a.state === 'RECONCILIATION').length,
        sentToday: attempts.length,
      },
      contacts: CONTACTS.length,
      mailings: MAILINGS.length,
      globalSuspension: CONTROL.globalSuspension,
      workingRecords,
      nextInQueue,
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
    const items = CAMPAIGNS.filter((c) => (status ? c.status === status : c.status !== 'ARCHIVED'));
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
      purposeCode: body.purposeCode ?? body.extra?.purposeCode ?? 'COBRANCA',
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
  const campActionMatch = pathname.match(/^\/campaigns\/([^/]+)\/(start|pause|resume|close|archive)$/);
  if (campActionMatch && method === 'POST') {
    const c = CAMPAIGNS.find((x) => x.id === campActionMatch[1]) ?? CAMPAIGNS[0];
    const act = campActionMatch[2];
    const beforeStatus = c.status;
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
      c.operationalExplanation = `Campanha encerrada (${body?.reason ?? 'parada pelo usuário'}).`;
    } else if (act === 'archive') {
      c.status = 'ARCHIVED';
      c.statusLabel = CAMPAIGN_STATUS_LABEL.ARCHIVED;
      c.operationalState = 'IDLE';
      c.operationalExplanation = 'Campanha arquivada (histórico preservado).';
    }
    AUDITS.unshift({
      id: AUDITS.length + 1,
      at: new Date().toISOString(),
      user: { name: me.name },
      action: `campaign.${act}`,
      entity: 'campaign',
      entityId: c.id,
      reason: body?.reason ?? null,
      before: { status: beforeStatus },
      after: { status: c.status },
    });
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
    const cursor = searchParams.get('cursor');
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') ?? '50', 10)));
    const filtered = CONTACTS.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.externalId.toLowerCase().includes(q),
    );
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const pageContacts = filtered.slice(offset, offset + limit);
    const nextCursor = offset + limit < filtered.length ? String(offset + limit) : null;
    const items: ContactRow[] = pageContacts.map((c, idx) => {
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
        intelligence: buildContactIntelligenceRationale(c),
      };
    });
    return { items, nextCursor, total: filtered.length } as T;
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
      intelligence: buildContactIntelligenceRationale(c),
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
    const optCfg = camp.strategy.config.optimization ?? { enabled: true, policy: 'LOWEST_COST_PER_CPC' as const, minEvidences: 3 };
    const recs = CONTACTS.slice(0, 10).map((c, idx) => ({
      contactId: c.id,
      externalId: c.externalId,
      name: c.name,
      channel: idx % 2 === 0 ? 'WhatsApp' : 'Discador',
      destinationMasked: c.destinations[0]?.addressMasked ?? '1198****01',
      bestTimeWindow: idx % 3 === 0 ? '10:00 – 12:00' : '14:00 – 16:30',
      evidencesCount: Math.max(optCfg.minEvidences, 3) + (idx % 4),
      historicRate: 0.25 + (idx * 0.04),
      estimatedCostPerSuccess: 0.45 + (idx * 0.15),
      policyUsed: optCfg.enabled ? `Política: ${optCfg.policy}` : 'Ordem fixa do template',
    }));
    return {
      enabled: optCfg.enabled,
      policyCode: optCfg.policy,
      minEvidences: optCfg.minEvidences,
      strategyId: camp.strategy.id,
      strategyName: camp.strategyName,
      strategyVersion: camp.strategyVersion,
      items: recs,
      policy:
        optCfg.policy === 'HIGHEST_HISTORIC_RATE'
          ? 'Maior taxa histórica de atendimento (CPC)'
          : optCfg.policy === 'BEST_TIME_WINDOW'
            ? 'Melhor janela horária observada'
            : optCfg.policy === 'TEMPLATE_ORDER'
              ? 'Ordem fixa da jornada / prioridade do destino'
              : 'Menor custo estimado por CPC / sucesso',
      notes: [
        `Amostra mínima de ${optCfg.minEvidences} evidências satisfeita para os candidatos exibidos.`,
        'Horários calculados a partir de eventos com CPC anterior no mesmo cluster.',
      ],
    } as T;
  }
  if (pathname === '/optimization/configure' && method === 'POST') {
    const camp = CAMPAIGNS.find((c) => c.id === body.campaignId) ?? CAMPAIGNS[0];
    const strat = STRATEGIES.find((s) => s.id === camp.strategy.id) ?? STRATEGIES[0];
    const nextConfig: StrategyConfig = {
      ...camp.strategy.config,
      optimization: {
        enabled: body.enabled ?? true,
        policy: body.policy ?? 'LOWEST_COST_PER_CPC',
        minEvidences: Number(body.minEvidences ?? 3),
      },
    };
    const nextVer: StrategyVersion = {
      id: nextUuid(),
      version: strat.versions.length + 1,
      config: nextConfig,
      publishedAt: new Date().toISOString(),
    };
    strat.latestVersion = nextVer;
    strat.versions.push(nextVer);
    camp.strategyVersion = nextVer.version;
    camp.strategy = { id: strat.id, version: nextVer.version, config: nextConfig };
    return { ok: true, version: nextVer.version } as T;
  }
  if (pathname === '/optimization/apply' && method === 'POST') {
    AUDITS.unshift({
      id: AUDITS.length + 1,
      at: new Date().toISOString(),
      user: { name: me.name },
      action: 'optimization.apply_recommendation',
      entity: 'campaign',
      entityId: body.campaignId ?? CAMPAIGNS[0].id,
      reason: body.contactId ? `Recomendação aplicada ao contato ${body.contactId.slice(-4)}` : 'Recomendações consultivas aplicadas ao lote da fila',
      before: { mode: 'CONSULTIVE_PENDING' },
      after: { mode: 'APPLIED_BY_MANAGER', appliedCount: body.count ?? 1 },
    });
    return { ok: true } as T;
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

  // Esteira de Inteligência de Contato & CPC (/intelligence/*)
  if (pathname === '/intelligence/study' && method === 'GET') {
    return {
      studyReference: {
        title: 'Estudo de Inteligência de Contato & Otimização de CPC no Brasil',
        definition: 'CPC = Contato com a Pessoa Certa confirmado por tabulação',
        sources: ['TIC Domicílios 2025 (CETIC.br / NIC.br)', 'IBGE Censo 2022', 'Anatel / ABR Telecom', 'ANPD / LGPD Art. 20'],
        ticDomicilios2025: [
          {
            ageBracket: 'AGE_16_24',
            label: '16 a 24 anos (Geração Z)',
            internetUsersPct: 96,
            nonUsersPct: 4,
            instantMessagingPct: 93,
            socialNetworksPct: 90,
            mobileOnlyPct: 68,
            mobileDataCapExhaustedPct: 44,
            primaryChannelRecommendation: 'WHATSAPP',
            voiceRole: 'Evitar voz fria; usar WhatsApp ou RCS com autoatendimento',
            operationalImplications: 'Rejeição severa a chamadas desconhecidas; alta resposta assíncrona em mensageria.',
          },
          {
            ageBracket: 'AGE_35_44',
            label: '35 a 44 anos (Adulto Economicamente Ativo)',
            internetUsersPct: 93,
            nonUsersPct: 7,
            instantMessagingPct: 94,
            socialNetworksPct: 82,
            mobileOnlyPct: 58,
            mobileDataCapExhaustedPct: 34,
            primaryChannelRecommendation: 'WHATSAPP',
            voiceRole: 'Voz eficaz em janela de almoço (12h-14h) e pós-18h com bina local',
            operationalImplications: 'Equilíbrio entre WhatsApp comercial e voz consultiva.',
          },
          {
            ageBracket: 'AGE_60_PLUS',
            label: '60 anos ou mais (Idosos / Aposentados)',
            internetUsersPct: 62,
            nonUsersPct: 38,
            instantMessagingPct: 83,
            socialNetworksPct: 61,
            mobileOnlyPct: 81,
            mobileDataCapExhaustedPct: 29,
            primaryChannelRecommendation: 'VOICE',
            voiceRole: 'Canal soberano pela manhã (09h-11h30); fixo residencial ainda relevante',
            operationalImplications: '38% desconectados exigem voz; entre os 62% conectados, 83% usam WhatsApp no celular.',
          },
        ],
        macroRegions: [
          {
            region: 'SUDESTE',
            label: 'Sudeste (DDD 11–19, 21–28, 31–38)',
            states: ['SP', 'RJ', 'MG', 'ES'],
            connectivityPct: 89,
            mobileDataConstraintPct: 29,
            preferredWindows: '10:00–12:00 / 14:00–17:30 / 18:30–19:45 (WhatsApp)',
            channelMixGuidance: 'Alta saturação de chamadas spam (DDD 11). Exige bina local/Branded Call ou abertura via WhatsApp.',
          },
          {
            region: 'NORDESTE',
            label: 'Nordeste (DDD 71–79, 81–89)',
            states: ['BA', 'SE', 'PE', 'AL', 'PB', 'RN', 'CE', 'PI', 'MA'],
            connectivityPct: 81,
            mobileDataConstraintPct: 48,
            preferredWindows: '08:30–11:30 / 18:30–20:30 (Wi-Fi residencial)',
            channelMixGuidance: 'WhatsApp texto leve (zero-rating) + Voz com DDD regional.',
          },
        ],
        globalBenchmark: [
          {
            vendor: 'Aspect ALM / Alvaria',
            countryOrigin: 'EUA (Global)',
            flagshipCapability: 'Shift Matrix Recycling & Best-Time-to-Call (BTTC)',
            coreConcept: 'Divide o dia em turnos e proíbe repetir tentativa no mesmo turno após Não Atende.',
            vollConnectAdoption: 'Matriz de Reciclagem de Turno implementada no Bloco 4 do plano.',
          },
          {
            vendor: 'Olos Tecnologia',
            countryOrigin: 'Brasil',
            flagshipCapability: 'Olos Locator & Olos Channel (Omnichannel)',
            coreConcept: 'Higienização e ranking de telefones (Locator Score) acoplado a agente digital.',
            vollConnectAdoption: 'Locator Score por destino + transbordo automático Voz <-> WhatsApp.',
          },
          {
            vendor: 'TitanX',
            countryOrigin: 'EUA',
            flagshipCapability: 'Phone-Intent Scoring (P1..P4)',
            coreConcept: 'Classifica propensão comportamental de atender telefone.',
            vollConnectAdoption: 'Tiers P1_ALTA_PROPENSAO_VOZ a P4_QUARENTENA.',
          },
        ],
        roadmapPhases: [
          { phase: 'Fase 0', title: 'Saneamento e Definição Invariante de CPC', objective: 'CPC = Pessoa Certa confirmada por tabulação', deliverable: 'Base higienizada' },
          { phase: 'Fase 5', title: 'Solver de Custo Esperado por CPC (ECPC)', objective: 'Minimizar R$/CPC confirmado', deliverable: 'Plano em 8 Blocos' },
          { phase: 'Fase 6', title: 'Operação Dual: Produção + Laboratório', objective: 'Disparo imediato + ondas amostrais reais', deliverable: 'Promoção validada' },
        ],
      },
      hypotheses: [
        {
          code: 'H-A1',
          family: 'AGE_FINANCE',
          title: 'Preferência Assíncrona Geração Z (16–24 anos)',
          description: 'Jovens de 16–24 anos têm 96% de acesso à internet e 93% de uso de mensageria, mas rejeitam voz fria.',
          publicEvidence: 'TIC Domicílios 2025 (C1/C5): 96% online, 93% mensageria instantânea.',
          candidateVariables: 'idade, generation_inferred',
          internalTest: 'Comparar CPC e R$/CPC entre WhatsApp-First vs. Voz Direta.',
          allowedDecision: 'Canal Primário = WHATSAPP; suprimir 1ª tentativa em voz fria.',
          benchmarkTool: 'TrueAccord HeartBeat / Genesys AI',
          enabled: true,
          productionWeight: 1.0,
          labWeight: 1.15,
        },
        {
          code: 'H-A4',
          family: 'AGE_FINANCE',
          title: 'Bimodalidade Sênior 60+ (38% Offline vs. 83% WhatsApp nos Conectados)',
          description: 'No público 60+, 38% não usam internet, porém entre os 62% conectados, 83% usam WhatsApp.',
          publicEvidence: 'TIC Domicílios 2025: 62% internet em 60+, 81% apenas celular.',
          internalTest: 'Testar abertura matinal em Voz (fixo/móvel) com fallback WhatsApp.',
          candidateVariables: 'idade >= 60, has_landline, has_whatsapp',
          allowedDecision: 'Se possui fixo: Voz Manhã (09h–11h30); se móvel c/ WhatsApp: híbrido.',
          benchmarkTool: 'Olos Locator / Altitude uCI',
          enabled: true,
          productionWeight: 1.0,
          labWeight: 1.1,
        },
      ],
    } as T;
  }

  if (pathname === '/intelligence/runs' && (method === 'GET' || method === 'POST')) {
    const sampleRun = {
      id: uuid(880),
      mailingId: MAILINGS[0].detail.id,
      mailingName: MAILINGS[0].detail.name,
      mode: 'PARALLEL_BOTH',
      purposeCode: 'COBRANCA',
      purposePrompt: 'Renegociação amigável priorizando menor custo por CPC confirmado por tabulação.',
      referenceDate: '2026-10-25',
      labSamplePct: 25,
      plannedDaysWaves: 3,
      completedWaves: 2,
      maxAttemptsPerContact: 4,
      maxAcceptableCpcBrl: 1.8,
      productionListVersionId: LIST_VER_ID,
      sampleCalc: {
        totalPopulation: 20,
        sampleSize: 6,
        samplePctEffective: 30,
        perWaveSize: 2,
        confidenceLevelPct: 95,
        marginOfErrorPct: 5,
        stratificationAxes: ['Macro-Região (DDD)', 'Faixa Etária TIC 2025', 'Tier de Intenção Telefônica (P1..P4)'],
      },
      cohortSummary: {
        totalReceived: 20,
        eligibleCount: 18,
        excludedCount: 2,
        coveragePct: 90,
        estimatedCpcRatePct: 31.4,
        expectedCostPerCpcBrl: 0.48,
        bruteForceCostPerCpcBrl: 1.12,
        savingsVsBruteForcePct: 57.1,
        byAgeBracket: { AGE_16_24: 3, AGE_25_34: 5, AGE_35_44: 5, AGE_45_59: 4, AGE_60_PLUS: 3 },
        byMacroRegion: { SUDESTE: 9, NORDESTE: 4, SUL: 3, CENTRO_OESTE: 2, NORTE: 2 },
        byPrimaryChannel: { WHATSAPP: 11, VOICE: 6, SMS: 1 },
        byPhoneIntentTier: { P1_ALTA_PROPENSAO_VOZ: 5, P2_HIBRIDO_DIGITAL_VOZ: 8, P3_DIGITAL_FIRST: 5, P4_QUARENTENA: 2 },
      },
      productionSummary: {
        trackCount: 12,
        dispatchedToActuatorsCount: 12,
        expectedCostPerCpcBrl: 0.48,
        estimatedCpcRatePct: 31.4,
        status: 'DISPATCHED_TO_ACTUATORS',
        note: 'Modo Produção passou por 100% da esteira de inteligência e enviou imediatamente 12 contatos elegíveis aos acionadores (sem aguardar ondas de teste).',
      },
      labSummary: {
        sampleCount: 6,
        plannedWaves: 3,
        completedWaves: 2,
        baselineProductionCpcBrl: 0.48,
        currentLabCostPerCpcBrl: 0.37,
        observedLabCpcRatePct: 38.2,
        expectedCostReductionPct: 22.9,
        expectedCpcRateLiftPp: 6.8,
        projectedMonthlySavingsBrl: 1980,
        readyToPromote: true,
        promotedAt: null,
        recommendation: 'O Laboratório reduziu o Custo por CPC Confirmado em 22.9% (R$ 0,37 vs R$ 0,48) e elevou a taxa de CPC em +6.8 p.p. Pronto para colocar em Produção.',
      },
      status: 'READY_TO_PROMOTE',
      promotedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      waves: [
        {
          id: uuid(881),
          waveNumber: 1,
          dayOffset: 1,
          status: 'COMPLETED',
          sampleContactsCount: 3,
          attemptsCount: 3,
          confirmedCpcCount: 1,
          cpcRate: 0.333,
          totalCostBrl: 0.44,
          costPerConfirmedCpcBrl: 0.44,
          productionBaselineCpcBrl: 0.48,
          costReductionPct: 8.3,
          cpcLiftPp: 1.9,
          adjustmentsApplied: ['H-C3 (Zero-Rating WhatsApp Norte/Nordeste): peso elevado de 1.00 para 1.18'],
          executedAt: '2026-10-25T10:05:00Z',
        },
        {
          id: uuid(882),
          waveNumber: 2,
          dayOffset: 2,
          status: 'COMPLETED',
          sampleContactsCount: 3,
          attemptsCount: 3,
          confirmedCpcCount: 2,
          cpcRate: 0.667,
          totalCostBrl: 0.3,
          costPerConfirmedCpcBrl: 0.37,
          productionBaselineCpcBrl: 0.48,
          costReductionPct: 22.9,
          cpcLiftPp: 6.8,
          adjustmentsApplied: ['H-T1 (Reciclagem Estrita de Turno Aspect ALM): bloqueio de repetição no mesmo turno'],
          executedAt: '2026-10-25T10:10:00Z',
        },
      ],
    };
    if (method === 'POST') return sampleRun as T;
    return { items: [sampleRun] } as T;
  }

  if (pathname.match(/^\/intelligence\/runs\/([^/]+)$/) && method === 'GET') {
    const res = await handleMockApi<{ items: any[] }>('/intelligence/runs', { method: 'GET' });
    return res.items[0] as T;
  }

  if (pathname.match(/^\/intelligence\/runs\/([^/]+)\/plans$/) && method === 'GET') {
    const items = CONTACTS.slice(0, 12).map((c, idx) => {
      const isDnc = c.blocks.some((b) => !b.revokedAt && b.scope === 'CONTACT');
      const ddd = String(c.attributes.ddd ?? '11');
      const uf = String(c.attributes.uf ?? 'SP');
      const city = String(c.attributes.cidade ?? 'São Paulo');
      const age = Number(c.attributes.idade ?? 35);
      const intent = String(c.attributes.phone_intent ?? 'P2_HIBRIDO_DIGITAL_VOZ');
      const bracket = age >= 60 ? 'AGE_60_PLUS' : age >= 45 ? 'AGE_45_59' : age >= 35 ? 'AGE_35_44' : age >= 25 ? 'AGE_25_34' : 'AGE_16_24';
      const channel = intent === 'P1_ALTA_PROPENSAO_VOZ' ? 'VOICE' : 'WHATSAPP';
      const window = age >= 60 ? '08:30 – 11:30' : age < 25 ? '12:00 – 13:30 (Wi-Fi)' : '17:30 – 19:30';
      const p = { ddd, uf, city, age, bracket, intent, channel, window };

      const track = idx < 8 ? ('PRODUCTION' as const) : ('LABORATORY' as const);
      const prob = isDnc ? 0 : Number((0.28 + (idx % 4) * 0.08).toFixed(2));
      const costPerCpc = isDnc ? 0 : Number((0.35 + (idx % 3) * 0.08).toFixed(2));
      const bruteCost = isDnc ? 0 : Number((1.10 + (idx % 3) * 0.25).toFixed(2));
      const savingsPct = isDnc ? 0 : Number(((1 - costPerCpc / bruteCost) * 100).toFixed(1));

      return {
        id: uuid(890 + idx),
        runId: uuid(880),
        contactId: c.id,
        externalId: c.externalId,
        contactName: c.name,
        track,
        decisionStatus: isDnc ? 'SUPRIMIDO_DNC_LGPD' : idx < 4 ? 'INCLUIDO_PRIORITARIO' : 'INCLUIDO_PADRAO',
        priorityRank: isDnc ? 9999 : idx + 1,
        ddd: p.ddd,
        uf: p.uf,
        macroRegion: p.ddd === '11' || p.ddd === '21' || p.ddd === '31' || p.ddd === '19' ? 'SUDESTE' : p.ddd === '71' || p.ddd === '85' || p.ddd === '81' ? 'NORDESTE' : p.ddd === '41' || p.ddd === '51' ? 'SUL' : p.ddd === '92' ? 'NORTE' : 'CENTRO_OESTE',
        ibgeCityTier: 'CAPITAL_METROPOLIS',
        ceticAgeBracket: p.bracket,
        inferredAge: p.age,
        locatorScore: isDnc ? 30 : 80 + (idx % 18),
        phoneIntentTier: p.intent,
        primaryChannel: isDnc ? null : p.channel,
        fallbackChannel: isDnc ? null : p.channel === 'VOICE' ? 'WHATSAPP' : 'VOICE',
        bestShift: p.window.includes('09:') || p.window.includes('08:') ? 'MANHA_09_12' : p.window.includes('12:') ? 'ALMOCO_12_14' : 'FIM_TARDE_17_20',
        bestTimeWindow: p.window,
        maxAttempts: 3,
        estimatedCpcProb: prob,
        expectedCostPerCpcBrl: costPerCpc,
        ConfidenceLevel: 'ALTO',
        dispatchedToActuator: track === 'PRODUCTION' && !isDnc,
        blocks: {
          bloco1_status_decisao: {
            status: isDnc ? 'SUPRIMIDO_DNC_LGPD' : idx < 4 ? 'INCLUIDO_PRIORITARIO' : 'INCLUIDO_PADRAO',
            statusLabel: isDnc ? 'Suprimido (DNC Procon / Não Me Perturbe)' : idx < 4 ? 'Incluído · Prioridade Ouro' : 'Incluído · Prioridade Padrão',
            rankingPrioridade: isDnc ? 9999 : idx + 1,
            trilhaOperacional: track,
            despachadoParaAcionador: track === 'PRODUCTION' && !isDnc,
            motivoDecisao: isDnc ? 'Bloqueio legal obrigatório no Procon Nacional' : 'Menor custo esperado por CPC confirmado na esteira.',
          },
          bloco2_perfil_inferido: {
            ddd: p.ddd,
            uf: p.uf,
            macroRegiao: p.ddd === '11' ? 'SUDESTE' : 'NORDESTE',
            macroRegiaoLabel: p.ddd === '11' ? 'Sudeste' : 'Nordeste',
            porteMunicipioIbge: 'CAPITAL_METROPOLIS',
            porteMunicipioLabel: `${p.city} (${p.uf})`,
            idadeInferida: p.age,
            faixaEtariaCetic: p.bracket,
            faixaEtariaLabel: p.bracket === 'AGE_60_PLUS' ? '60+ anos (Sênior)' : p.bracket === 'AGE_16_24' ? '16 a 24 anos (Geração Z)' : `${p.age} anos`,
            probabilidadeConectividadePct: p.bracket === 'AGE_60_PLUS' ? 62 : 95,
            probabilidadeRestricaoPacoteDadosPct: p.uf === 'AM' || p.uf === 'BA' ? 48 : 28,
            locatorScore: isDnc ? 30 : 88,
            phoneIntentTier: p.intent,
            phoneIntentLabel: p.intent === 'P1_ALTA_PROPENSAO_VOZ' ? 'P1 · Alta Propensão a Voz' : p.intent === 'P3_DIGITAL_FIRST' ? 'P3 · Digital-First (WhatsApp)' : 'P2 · Híbrido Multicanal',
          },
          bloco3_recomendacao_canal: {
            canalPrimario: isDnc ? null : p.channel,
            canalPrimarioLabel: isDnc ? 'Suprimido' : p.channel === 'VOICE' ? 'Discador (Voz Local)' : 'WhatsApp Comercial',
            destinoPrimarioMascarado: c.destinations[0]?.addressMasked ?? '1198****01',
            canalSecundarioFallback: isDnc ? null : p.channel === 'VOICE' ? 'WHATSAPP' : 'VOICE',
            canalSecundarioLabel: isDnc ? 'Nenhum' : p.channel === 'VOICE' ? 'WhatsApp' : 'Voz',
            destinoSecundarioMascarado: c.destinations[1]?.addressMasked ?? null,
            exigeBinaLocalMatchDdd: true,
            exigeBrandedCall: p.channel === 'VOICE',
          },
          bloco4_janela_horaria: {
            melhorTurno: p.window.includes('09:') ? 'MANHA_09_12' : 'FIM_TARDE_17_20',
            janelaPrimaria: p.window,
            janelaSecundaria: '14:30 – 17:00',
            fusoHorarioUtcOffset: p.uf === 'AM' ? -4 : -3,
            regraReciclagemTurno: 'Aspect ALM Shift Matrix: proibido repetir chamada no mesmo turno.',
          },
          bloco5_sequencia_cadencia: {
            maximoTentativas: 3,
            intervaloMinimoHoras: 6,
            regraParadaImediata: 'Parada imediata após CPC confirmado por tabulação.',
            passos: [
              { tentativa: 1, diaOffset: 1, turno: 'MANHA_09_12', janela: p.window, canal: p.channel, acao: p.channel === 'WHATSAPP' ? 'Abertura amigável com opção de chave PIX' : 'Discagem com DDD local e identificação de titularidade', condicaoTransicao: 'Aguardar 6h' },
              { tentativa: 2, diaOffset: 2, turno: 'TARDE_14_17', janela: '14:30 – 16:30', canal: p.channel === 'VOICE' ? 'WHATSAPP' : 'VOICE', acao: 'Transbordo para canal complementar', condicaoTransicao: 'Reciclar turno' },
            ],
          },
          bloco6_abordagem_linguagem: {
            propositoOperacao: 'COBRANCA',
            tomDeVoz: p.age >= 60 ? 'Respeitoso, claro e pausado' : 'Direto, empático e prático',
            comprimentoMensagem: 'Curto (até 220 caracteres com botão de ação rápida)',
            roteiroAberturaSugerido: `Olá ${c.name}, identificamos uma proposta para regularização com 40% de desconto à vista.`,
            gatilhoPsicologico: 'Alívio imediato e retirada de negativação em até 24h',
          },
          bloco7_economia_cpc: {
            probabilidadeCpcConfirmado: prob,
            custoUnitarioCanalPrimarioBrl: p.channel === 'VOICE' ? 0.12 : 0.24,
            custoEsperadoPorCpcConfirmadoBrl: costPerCpc,
            custoBruteForceBaselineBrl: bruteCost,
            economiaEstimadaPct: savingsPct,
            tetoMaximoAceitavelBrl: 1.8,
          },
          bloco8_explicabilidade_governanca: {
            hipotesesAtivadas: p.bracket === 'AGE_60_PLUS' ? ['H-A4 (Sênior 60+)', 'H-G1', 'H-T1'] : ['H-A1 (Geração Z/Jovem)', 'H-C3 (Zero-Rating)', 'H-T5'],
            evidenciasPublicasCitadas: ['TIC Domicílios 2025 (CETIC.br)', 'Alvaria ALM Shift Matrix'],
            nivelConfianca: 'ALTO',
            auditoriaLgpdArt20: 'Decisão 100% auditável com revisão humana disponível em um clique.',
            revisaoHumanaAplicada: false,
            notaRevisaoHumana: null,
          },
        },
        humanOverride: null,
      };
    });
    return { items } as T;
  }

  if (pathname.match(/^\/intelligence\/runs\/([^/]+)\/lab\/next-wave$/) && method === 'POST') {
    const res = await handleMockApi<any>('/intelligence/runs', { method: 'POST' });
    return res as T;
  }

  if (pathname.match(/^\/intelligence\/runs\/([^/]+)\/lab\/promote$/) && method === 'POST') {
    const res = await handleMockApi<any>('/intelligence/runs', { method: 'POST' });
    res.status = 'PROMOTED_TO_PRODUCTION';
    res.promotedAt = new Date().toISOString();
    res.labSummary.promotedAt = res.promotedAt;
    return res as T;
  }

  return {} as T;
}
