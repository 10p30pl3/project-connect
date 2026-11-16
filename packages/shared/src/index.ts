/**
 * Contratos compartilhados entre API e Web (Voll Plan MVP).
 * Fonte única para enums, schemas de entrada (Zod) e formatos de resposta.
 * Referências entre parênteses apontam para o Plano funcional v2.2.
 */
import { z } from 'zod';

// ------------------------------------------------------------------ enums
export const ROLES = [
  'SUPER_ADMIN',
  'SUPER_ADMIN_VIEWER',
  'ADMIN',
  'MANAGER',
  'SUPERVISOR',
  'OPERATOR',
  'ANALYST',
] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  SUPER_ADMIN_VIEWER: 'Suporte (Leitura)',
  ADMIN: 'Administrador',
  MANAGER: 'Gestor',
  SUPERVISOR: 'Supervisor',
  OPERATOR: 'Operador',
  ANALYST: 'Analista',
};

export function isSuperAdminRole(role?: string | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER';
}

export function isReadOnlyRole(role?: string | null): boolean {
  return role === 'SUPER_ADMIN_VIEWER';
}

export const CHANNEL_TYPES = ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_LABEL: Record<ChannelType, string> = {
  VOICE: 'Discador',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  EMAIL: 'E-mail',
};

export const CONNECTION_CHANNEL_TYPES = ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL', 'WEBRTC'] as const;
export type ConnectionChannelType = (typeof CONNECTION_CHANNEL_TYPES)[number];
export const CONNECTION_CHANNEL_LABEL: Record<ConnectionChannelType, string> = {
  ...CHANNEL_LABEL,
  WEBRTC: 'WebRTC',
};

export const WEBRTC_MODES = ['WEB', 'WHATSAPP_CALLING', 'BOTH'] as const;
export type WebRtcMode = (typeof WEBRTC_MODES)[number];
export const WEBRTC_MODE_LABEL: Record<WebRtcMode, string> = {
  WEB: 'Somente Web Widget',
  WHATSAPP_CALLING: 'Somente WhatsApp Calling',
  BOTH: 'Web Widget + WhatsApp Calling',
};

export const CAMPAIGN_STATUS = ['READY', 'SCHEDULED', 'RUNNING', 'PAUSED', 'CLOSED', 'COMPLETED', 'ARCHIVED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[number];
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  READY: 'Pronta',
  SCHEDULED: 'Agendada',
  RUNNING: 'Em execução',
  PAUSED: 'Pausada',
  CLOSED: 'Encerrada',
  COMPLETED: 'Concluída',
  ARCHIVED: 'Arquivada',
};

export const ATTEMPT_STATES = [
  'RESERVED', 'SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION', 'FINALIZED', 'RELEASED', 'CANCELLED',
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];
export const ACTIVE_ATTEMPT_STATES: AttemptState[] = ['RESERVED', 'SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION'];
export const ATTEMPT_STATE_LABEL: Record<AttemptState, string> = {
  RESERVED: 'Reservado',
  SENT: 'Enviado',
  AWAITING_FEEDBACK: 'Aguardando feedback',
  RECONCILIATION: 'Reconciliação',
  FINALIZED: 'Finalizado',
  RELEASED: 'Liberado',
  CANCELLED: 'Cancelado',
};

export const ENROLLMENT_STATES = ['ACTIVE', 'DONE_SUCCESS', 'DONE_FAIL', 'CANCELLED'] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];
export const ENROLLMENT_STATE_LABEL: Record<EnrollmentState, string> = {
  ACTIVE: 'Ativa',
  DONE_SUCCESS: 'Concluída com sucesso',
  DONE_FAIL: 'Concluída sem sucesso',
  CANCELLED: 'Cancelada',
};

/** Motivos de inelegibilidade (§4.2) + complementos identificados na revisão. */
export const REASON_CODES = [
  'DNC',
  'DESTINATION_BLOCKED',
  'INVALID_RECORD',
  'NO_DESTINATION',
  'INCOMPLETE_HISTORY',
  'OUTSIDE_CALENDAR',
  'FUTURE_CALLBACK',
  'AWAITING_RETRY',
  'TOTAL_LIMIT',
  'DAILY_LIMIT',
  'CHANNEL_EXHAUSTED',
  'ACTIVE_RESERVATION',
  'RECONCILIATION',
  'CAMPAIGN_PAUSED',
  'FLOW_ENDED',
  'GLOBAL_SUSPENSION',
  'CHANNEL_UNAVAILABLE',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const REASON_LABEL: Record<ReasonCode, string> = {
  DNC: 'DNC / bloqueio do cliente',
  DESTINATION_BLOCKED: 'Destino bloqueado',
  INVALID_RECORD: 'Registro inválido',
  NO_DESTINATION: 'Sem destino válido para o canal',
  INCOMPLETE_HISTORY: 'Histórico incompleto',
  OUTSIDE_CALENDAR: 'Fora do calendário',
  FUTURE_CALLBACK: 'Retorno agendado futuro',
  AWAITING_RETRY: 'Aguardando retentativa',
  TOTAL_LIMIT: 'Limite total atingido',
  DAILY_LIMIT: 'Limite diário atingido',
  CHANNEL_EXHAUSTED: 'Tentativas do canal esgotadas',
  ACTIVE_RESERVATION: 'Tentativa ativa em outra campanha',
  RECONCILIATION: 'Em reconciliação',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  FLOW_ENDED: 'Fluxo encerrado',
  GLOBAL_SUSPENSION: 'Suspensão global',
  CHANNEL_UNAVAILABLE: 'Canal indisponível',
};

/** Ação da estratégia para cada tabulação (§4.2 passo 8, §6.2 passo 12). */
export const TABULATION_ACTIONS = [
  'RETRY',            // retentar o mesmo destino após o intervalo
  'SCHEDULE_CALLBACK', // agendar retorno em data/hora combinada com titular
  'NEXT_DESTINATION', // alternar para o próximo destino do mesmo canal
  'NEXT_STEP',        // avançar para a próxima etapa da jornada
  'FINISH_SUCCESS',   // encerrar inscrição com sucesso
  'FINISH_FAIL',      // encerrar inscrição sem sucesso
] as const;
export type TabulationAction = (typeof TABULATION_ACTIONS)[number];
export const TABULATION_ACTION_LABEL: Record<TabulationAction, string> = {
  RETRY: 'Retentar',
  SCHEDULE_CALLBACK: 'Agendar retorno',
  NEXT_DESTINATION: 'Alternar destino',
  NEXT_STEP: 'Avançar etapa',
  FINISH_SUCCESS: 'Encerrar com sucesso',
  FINISH_FAIL: 'Encerrar sem sucesso',
};

/** Política de otimização consultiva e ordenação de destinos (§22). */
export const OPTIMIZATION_POLICIES = [
  'TEMPLATE_ORDER',
  'LOWEST_COST_PER_CPC',
  'HIGHEST_HISTORIC_RATE',
  'BEST_TIME_WINDOW',
] as const;
export type OptimizationPolicy = (typeof OPTIMIZATION_POLICIES)[number];
export const OPTIMIZATION_POLICY_LABEL: Record<OptimizationPolicy, string> = {
  TEMPLATE_ORDER: 'Ordem fixa da jornada / prioridade do destino',
  LOWEST_COST_PER_CPC: 'Menor custo estimado por CPC / sucesso',
  HIGHEST_HISTORIC_RATE: 'Maior taxa histórica de atendimento (CPC)',
  BEST_TIME_WINDOW: 'Melhor janela horária observada (Best Time to Contact)',
};

// ------------------------------------------------------------------ strategy config
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const CALLER_ID_STRATEGIES = ['FIXED', 'LOCAL_PRESENCE_DDD', 'ROUND_ROBIN'] as const;

export const VoiceAgentOverridesSchema = z.object({
  greeting: z.string().max(1000).optional(),
  instructionsAppend: z.string().max(4000).optional(),
  voice: z.string().max(80).optional(),
  maxDurationSec: z.number().int().min(10).max(3600).optional(),
  callerIdStrategy: z.enum(CALLER_ID_STRATEGIES).optional(),
  idleTimeoutSeconds: z.number().int().min(3).max(30).optional(),
});
export type VoiceAgentOverrides = z.infer<typeof VoiceAgentOverridesSchema>;

export const StrategyConfigSchema = z
  .object({
    calendar: z.object({
      days: z.array(z.number().int().min(0).max(6)).min(1, 'Selecione ao menos um dia'), // 0=domingo
      start: hhmm,
      end: hhmm,
      timezone: z.string().default('America/Sao_Paulo'),
    }),
    limits: z.object({
      total: z.number().int().positive('Deve ser positivo'),
      daily: z.number().int().positive('Deve ser positivo'),
      scope: z.enum(['WORKSPACE', 'CAMPAIGN']).default('WORKSPACE'),
      /** Política de histórico incompleto (§5.2): bloquear (padrão) ou usar só o conhecido. */
      incompleteHistory: z.enum(['BLOCK', 'USE_KNOWN']).default('USE_KNOWN'),
    }),
    retry: z.object({
      intervalMinutes: z.number().int().min(1),
      maxPerDestination: z.number().int().min(1),
    }),
    distribution: z.object({
      batchSize: z.number().int().min(1).max(500).default(20),
      maxPending: z.number().int().min(1).max(5000).default(50),
      leaseSeconds: z.number().int().min(10).max(3600).default(60),
    }),
    optimization: z
      .object({
        enabled: z.boolean().default(true),
        policy: z.enum(OPTIMIZATION_POLICIES).default('LOWEST_COST_PER_CPC'),
        minEvidences: z.number().int().min(1).max(50).default(3),
      })
      .optional(),
    /** overrides opcionais de comportamento de voz aplicados por esta estratégia/campanha */
    voiceOverrides: VoiceAgentOverridesSchema.optional(),
    /** código da tabulação -> ação */
    tabulationRules: z.record(z.string(), z.enum(TABULATION_ACTIONS)),
  })
  .superRefine((c, ctx) => {
    if (c.limits.daily > c.limits.total)
      ctx.addIssue({ code: 'custom', path: ['limits', 'daily'], message: 'O limite diário não pode superar o total' });
    if (c.calendar.end <= c.calendar.start)
      ctx.addIssue({ code: 'custom', path: ['calendar', 'end'], message: 'O horário final deve ser posterior ao inicial' });
  });
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

export const JourneyStepSchema = z.object({
  channelType: z.enum(CHANNEL_TYPES),
  connectionId: z.string().uuid(),
  feedbackTimeoutMinutes: z.number().int().min(1).max(10080),
});
export type JourneyStep = z.infer<typeof JourneyStepSchema>;

// ------------------------------------------------------------------ inputs (requests)
export const LoginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(ROLES),
  password: z.string().min(8, 'Mínimo de 8 caracteres'),
});

/** Campos do cadastro para onde uma coluna do CSV pode ser mapeada (§16.1). */
export const MAPPING_TARGETS = [
  'external_id', 'name',
  'phone1', 'phone2', 'phone3', 'phone4', 'phone5',
  'digital1', 'digital2', 'digital3',
  'email',
  'history_total',
  'best_contact_start',
  'best_contact_end',
  'best_contact_duration',
  'best_contact_timezone',
  'attribute', // campo adicional preservado em attributes
  'ignore',
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];

export const FIELD_TYPES = ['text', 'number', 'date', 'boolean'] as const;

export const ColumnMappingSchema = z.object({
  column: z.string(),
  target: z.enum(MAPPING_TARGETS),
  /** nome do atributo quando target = attribute */
  attributeName: z.string().optional(),
  type: z.enum(FIELD_TYPES).default('text'),
  required: z.boolean().default(false),
  /** para digital1..3: WHATSAPP ou SMS */
  digitalType: z.enum(['WHATSAPP', 'SMS']).optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export const ImportPreviewSchema = z.object({
  content: z.string().min(1, 'Envie um CSV ou cole o conteúdo').max(2_000_000, 'Máximo de 2 MB'),
  delimiter: z.enum(['auto', ',', ';', '\t', '|']).default('auto'),
  hasHeader: z.boolean().default(true),
  mapping: z.array(ColumnMappingSchema).optional(),
  defaultTimezone: z.string().default('America/Sao_Paulo'),
  defaultWindowDurationMinutes: z.number().int().positive().max(720).optional(),
});

export const ImportCommitSchema = ImportPreviewSchema.extend({
  name: z.string().min(1, 'Informe o nome do mailing'),
  mapping: z.array(ColumnMappingSchema).min(1),
  /** obrigatório quando há rejeitados (§26.5): confirma importação parcial */
  acceptPartial: z.boolean().default(false),
  idempotencyKey: z.string().optional(),
});

export const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'] as const;
export const ListFilterSchema = z.object({
  field: z.string().min(1), // chave em typed_fields/attributes ou 'name', 'external_id'
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ListFilter = z.infer<typeof ListFilterSchema>;
export const ListSortSchema = z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) });

export const ListPreviewSchema = z.object({
  mailingId: z.string().uuid(),
  filters: z.array(ListFilterSchema).default([]),
  sort: z.array(ListSortSchema).default([]),
});
export const ListPublishSchema = ListPreviewSchema.extend({
  name: z.string().min(1, 'Informe o nome da lista'),
  membershipMode: z.enum(['SNAPSHOT', 'DYNAMIC']),
  /** para publicar nova versão de uma lista existente */
  listId: z.string().uuid().optional(),
});

export const StrategyCreateSchema = z.object({
  name: z.string().min(1),
  config: StrategyConfigSchema,
  /** criar como cópia de outra estratégia */
  copyOf: z.string().uuid().optional(),
});
export const StrategyPublishSchema = z.object({
  name: z.string().min(1).optional(),
  config: StrategyConfigSchema,
});

export const JourneyCreateSchema = z.object({
  name: z.string().min(1),
  steps: z.array(JourneyStepSchema).min(1),
});
export type JourneyCreate = z.infer<typeof JourneyCreateSchema>;

export const JourneyVersionCreateSchema = z.object({
  name: z.string().min(1).optional(),
  steps: z.array(JourneyStepSchema).min(1),
});
export type JourneyVersionCreate = z.infer<typeof JourneyVersionCreateSchema>;

export const ConnectionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  tariff: z.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
  provider: z.string().optional(),
  endpointUrl: z.string().nullable().optional(),
  callerId: z.string().nullable().optional(),
  authToken: z.string().nullable().optional(),
  tenantId: z.string().max(120).nullable().optional(),
  webrtcMode: z.enum(WEBRTC_MODES).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  whatsappPhoneNumberId: z.string().max(80).nullable().optional(),
  whatsappBusinessAccountId: z.string().max(80).nullable().optional(),
  whatsappVerifyToken: z.string().max(160).nullable().optional(),
  whatsappAppSecret: z.string().max(240).nullable().optional(),
  whatsappAccessToken: z.string().max(512).nullable().optional(),
  rotateWidgetKey: z.boolean().optional(),
  simulation: z
    .object({
      /** pesos por resultado simulado */
      outcomes: z.record(z.string(), z.number().min(0)),
      minDelaySeconds: z.number().int().min(0),
      maxDelaySeconds: z.number().int().min(0),
      /** probabilidade (0-1) de reenviar o mesmo webhook (testa idempotência) */
      duplicateRate: z.number().min(0).max(1),
      /** probabilidade (0-1) de nunca devolver retorno (gera reconciliação) */
      noReturnRate: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
});

export const ConnectionCreateSchema = z.object({
  name: z.string().min(1, 'Informe o nome da conexão').max(100),
  channelType: z.enum(CONNECTION_CHANNEL_TYPES),
  provider: z.string().min(1).default('SIMULATED'),
  tariff: z.number().min(0, 'A tarifa deve ser maior ou igual a zero').nullable().optional(),
  endpointUrl: z.string().nullable().optional(),
  callerId: z.string().nullable().optional(),
  authToken: z.string().nullable().optional(),
  tenantId: z.string().max(120).nullable().optional(),
  webrtcMode: z.enum(WEBRTC_MODES).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  whatsappPhoneNumberId: z.string().max(80).nullable().optional(),
  whatsappBusinessAccountId: z.string().max(80).nullable().optional(),
  whatsappVerifyToken: z.string().max(160).nullable().optional(),
  whatsappAppSecret: z.string().max(240).nullable().optional(),
  whatsappAccessToken: z.string().max(512).nullable().optional(),
  simulation: z
    .object({
      outcomes: z.record(z.string(), z.number().min(0)),
      minDelaySeconds: z.number().int().min(0),
      maxDelaySeconds: z.number().int().min(0),
      duplicateRate: z.number().min(0).max(1),
      noReturnRate: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
});
export type ConnectionCreate = z.infer<typeof ConnectionCreateSchema>;

export const PublicWebRtcOfferSchema = z.object({
  publicWidgetKey: z.string().min(4).max(160),
  sdpOffer: z.string().min(10),
  caller: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type PublicWebRtcOffer = z.infer<typeof PublicWebRtcOfferSchema>;

export const InternalWebRtcEndedSchema = z.object({
  reason: z.string().max(160).optional(),
  durationSec: z.number().min(0).optional(),
  endedBy: z.enum(['agent', 'caller', 'timeout', 'error']).optional(),
});
export type InternalWebRtcEnded = z.infer<typeof InternalWebRtcEndedSchema>;

export const ContactCreateSchema = z.object({
  name: z.string().min(1, 'Informe o nome do contato'),
  externalId: z.string().min(1, 'Informe o identificador ou CPF/CNPJ'),
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type ContactCreate = z.infer<typeof ContactCreateSchema>;

export const TabulationCreateSchema = z.object({
  code: z
    .string()
    .min(1, 'Código é obrigatório')
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/, 'Código deve conter apenas letras, números e sublinhados')
    .transform((v) => v.toUpperCase()),
  name: z.string().min(1, 'Nome é obrigatório').max(100),
  isCpc: z.boolean().default(false),
  isConversion: z.boolean().default(false),
  isOptOut: z.boolean().default(false),
  invalidatesDestination: z.boolean().default(false),
  channelTypes: z.array(z.enum(['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'])).default(['VOICE', 'WHATSAPP', 'SMS', 'EMAIL']),
});
export type TabulationCreate = z.infer<typeof TabulationCreateSchema>;

export const TabulationUpdateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100).optional(),
  isCpc: z.boolean().optional(),
  isConversion: z.boolean().optional(),
  isOptOut: z.boolean().optional(),
  invalidatesDestination: z.boolean().optional(),
  channelTypes: z.array(z.enum(['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'])).optional(),
});
export type TabulationUpdate = z.infer<typeof TabulationUpdateSchema>;

export const CampaignDraftSchema = z.object({
  step: z.enum(['MAILING', 'AUDIENCE', 'ACTIVATION', 'CAMPAIGN']),
  mailingId: z.string().uuid().nullable().optional(),
  sourceListVersionId: z.string().uuid().nullable().optional(),
  audienceMode: z.enum(['ALL', 'LIST']).nullable().optional(),
  listVersionId: z.string().uuid().nullable().optional(),
  journeyVersionId: z.string().uuid().nullable().optional(),
  strategyVersionId: z.string().uuid().nullable().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  startMode: z.enum(['NOW', 'SCHEDULE', 'READY']).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CampaignDraft = z.infer<typeof CampaignDraftSchema>;
export const SaveDraftSchema = z.object({ data: CampaignDraftSchema, revision: z.number().int().min(0) });

export const OPERATION_PURPOSES = [
  'COBRANCA',
  'VENDAS',
  'AGENDAMENTOS',
  'CONFIRMACAO_SERVICO',
  'ATENDIMENTO_SUPORTE',
  'PESQUISA_RELACIONAMENTO',
] as const;
export type OperationPurpose = (typeof OPERATION_PURPOSES)[number];

export const PRIMARY_OPERATION_PURPOSES = ['COBRANCA', 'VENDAS', 'AGENDAMENTOS'] as const;

export const AUDIENCE_SEGMENTS = ['B2C', 'B2B', 'MIXED'] as const;
export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];

export const CalendarWindowSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1, 'Selecione pelo menos um dia'),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inicial inválido (HH:MM)'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário final inválido (HH:MM)'),
  })
  .superRefine((w, ctx) => {
    if (w.end <= w.start) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'O horário final deve ser posterior ao inicial' });
    }
  });
export type CalendarWindow = z.infer<typeof CalendarWindowSchema>;

export const CalendarCreateSchema = z.object({
  name: z.string().min(1, 'Informe o nome do calendário').max(100),
  description: z.string().max(500).nullable().optional(),
  timezone: z.string().min(1).default('America/Sao_Paulo'),
  windows: z.array(CalendarWindowSchema).min(1, 'Configure pelo menos uma janela de horário'),
  holidayPolicy: z.enum(['BLOCK', 'ALLOW']).default('BLOCK'),
  active: z.boolean().default(true),
});
export type CalendarCreate = z.infer<typeof CalendarCreateSchema>;

export const CalendarHolidayCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)'),
  name: z.string().min(1, 'Informe o nome do feriado/exceção').max(150),
  action: z.enum(['BLOCK', 'ALLOW', 'LIMIT']).default('BLOCK'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});
export type CalendarHolidayCreate = z.infer<typeof CalendarHolidayCreateSchema>;

export interface CalendarHoliday {
  id: string;
  date: string;
  name: string;
  action: 'BLOCK' | 'ALLOW' | 'LIMIT';
  startTime?: string | null;
  endTime?: string | null;
}

export interface OperationCalendar {
  id: string;
  name: string;
  description?: string | null;
  timezone: string;
  windows: CalendarWindow[];
  holidayPolicy: 'BLOCK' | 'ALLOW';
  active: boolean;
  archivedAt?: string | null;
  holidays: CalendarHoliday[];
  createdAt?: string;
  updatedAt?: string;
}

export const CampaignDialerConfigSchema = z.object({
  trunkIds: z.array(z.string().min(1)).max(50).default([]),
  dialMultiplier: z.number().min(0.5, 'Multiplicador mínimo é 0,5x').max(5, 'Multiplicador máximo é 5x').default(1),
});
export type CampaignDialerConfig = z.infer<typeof CampaignDialerConfigSchema>;

export interface TrunkAvailability {
  id: string;
  name: string;
  direction: 'inbound' | 'outbound' | 'both';
  active: boolean;
  online: boolean;
  maxChannels: number;
  activeCalls: number;
  availableChannels: number;
  statusMessage?: string | null;
}

export type CampaignDialerWaitingReason =
  | 'NONE'
  | 'NO_ELIGIBLE_TRUNKS'
  | 'ALL_TRUNKS_BUSY'
  | 'OUTSIDE_CALENDAR'
  | 'PAUSED'
  | 'GLOBAL_SUSPENSION';

export interface CampaignDialerStatus {
  campaignId: string;
  trunkIds: string[];
  dialMultiplier: number;
  loadedTotal: number;
  activeDialing: number;
  queuedWaitingTrunk: number;
  completedOrSkipped: number;
  availableTrunkSlots: number;
  totalTrunkChannels: number;
  effectiveQuota: number;
  waitingReason: CampaignDialerWaitingReason;
  canEditDialerConfig: boolean;
  trunks: TrunkAvailability[];
}

export function isDialerManagerRole(role?: string | null): boolean {
  return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export const CreateCampaignSchema = z
  .object({
    name: z.string().min(1, 'Informe o nome da campanha'),
    description: z.string().optional(),
    mailingId: z.string().uuid(),
    listVersionId: z.string().uuid().nullable().optional(),
    journeyVersionId: z.string().uuid(),
    strategyVersionId: z.string().uuid(),
    calendarId: z.string().uuid().nullable().optional(),
    voiceAgentId: z.string().min(1).max(120).nullable().optional(),
    purposeCode: z.enum(OPERATION_PURPOSES).optional(),
    audienceSegment: z.enum(AUDIENCE_SEGMENTS).optional(),
    startMode: z.enum(['NOW', 'SCHEDULE', 'READY']),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    trunkIds: z.array(z.string().min(1)).max(50).optional(),
    dialMultiplier: z.number().min(0.5).max(5).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.startMode === 'SCHEDULE') {
      if (!c.scheduledAt) ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Informe data e hora' });
      else if (new Date(c.scheduledAt).getTime() <= Date.now())
        ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'A data deve ser futura' });
    }
  });

export const UpdateCampaignSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da campanha').max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  listVersionId: z.string().uuid().nullable().optional(),
  journeyVersionId: z.string().uuid().optional(),
  strategyVersionId: z.string().uuid().optional(),
  calendarId: z.string().uuid().nullable().optional(),
  voiceAgentId: z.string().min(1).max(120).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  trunkIds: z.array(z.string().min(1)).max(50).optional(),
  dialMultiplier: z.number().min(0.5).max(5).optional(),
  reason: z.string().trim().max(240).optional(),
});
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

export interface CampaignHistoryChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface CampaignHistoryItem {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  reason: string | null;
  at: string;
  changes: CampaignHistoryChange[];
}

export const CampaignTemplateCreateSchema = z.object({
  name: z.string().min(1, 'Informe o nome do modelo'),
  description: z.string().optional().nullable(),
  journeyVersionId: z.string().optional().nullable(),
  journeyId: z.string().optional().nullable(),
  strategyVersionId: z.string().optional().nullable(),
  strategyId: z.string().optional().nullable(),
  calendarId: z.string().optional().nullable(),
  purposeCode: z.enum(OPERATION_PURPOSES).optional().nullable(),
  startMode: z.enum(['NOW', 'SCHEDULE', 'READY']).optional().nullable(),
  sourceCampaignId: z.string().optional().nullable(),
});
export type CampaignTemplateCreate = z.infer<typeof CampaignTemplateCreateSchema>;

export interface CampaignTemplate {
  id: string;
  name: string;
  description?: string | null;
  purposeCode?: OperationPurpose | null;
  journeyId: string;
  journeyName: string;
  journeyVersionId?: string;
  strategyId: string;
  strategyName: string;
  strategyVersionId?: string;
  strategyVersion?: number;
  calendarId?: string | null;
  calendarName?: string | null;
  startMode?: 'NOW' | 'SCHEDULE' | 'READY';
  sourceCampaignId?: string | null;
  sourceCampaignName?: string | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export const BlockCreateSchema = z.object({
  scope: z.enum(['CONTACT', 'DESTINATION']),
  contactId: z.string().uuid(),
  destinationId: z.string().uuid().optional(),
  reason: z.string().min(3, 'Informe o motivo'),
});
export const BlockRevokeSchema = z.object({ reason: z.string().min(3, 'Informe o motivo') });

export const DestinationCreateSchema = z.object({
  channelType: z.enum(CHANNEL_TYPES),
  address: z.string().min(1),
  label: z.string().optional(),
  priority: z.number().int().min(1).max(99).default(1),
});

export const ResolveReconciliationSchema = z.object({
  resolution: z.enum(['CONFIRM_FAILED', 'TABULATE']),
  tabulationCode: z.string().optional(),
  reason: z.string().min(3, 'Informe o motivo'),
});

export const InstitutionalLimitsSchema = z
  .object({
    dailyLimit: z.number().int().positive().nullable(),
    totalLimit: z.number().int().positive().nullable(),
    globalSuspension: z.boolean(),
    reason: z.string().min(3, 'Informe o motivo'),
  })
  .superRefine((c, ctx) => {
    if (c.dailyLimit != null && c.totalLimit != null && c.dailyLimit > c.totalLimit)
      ctx.addIssue({ code: 'custom', path: ['dailyLimit'], message: 'O limite diário não pode superar o total' });
  });

/** Webhook normalizado que os conectores enviam para POST /connectors/:id/events (§10.2). */
export const CONNECTOR_EVENT_TYPES = [
  'DELIVERY_CONFIRMED',
  'RESULT',         // resultado conclusivo com tabulationCode
  'OPT_OUT',
  'RESULT_UNKNOWN',
] as const;
export const AMD_RESULT_TYPES = ['HUMAN', 'VOICEMAIL', 'SILENCE', 'UNKNOWN'] as const;

export const LatencyTurnTelemetrySchema = z.object({
  userEndAt: z.number().optional(),
  aiStartAt: z.number().optional(),
  responseMs: z.number().min(0),
  endpointingMs: z.number().min(0).optional(),
  aiTurnaroundMs: z.number().min(0).optional(),
});

export const ConnectorEventSchema = z.object({
  eventId: z.string().min(1),
  providerAttemptId: z.string().min(1),
  attemptId: z.string().uuid().optional(),
  type: z.enum(CONNECTOR_EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  tabulationCode: z.string().optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  /** Custo de telefonia/canal da tentativa, em BRL (substitui a estimativa pela tarifa). */
  cost: z.number().min(0).optional(),
  /** Custo de IA (modelo de voz/texto) da tentativa, em USD. Nunca somado a `cost`. */
  aiCostUsd: z.number().min(0).optional(),
  summary: z.string().max(2000).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  recordingUrl: z.string().url().optional(),
  amdResult: z.enum(AMD_RESULT_TYPES).optional(),
  extractedData: z.record(z.string(), z.unknown()).optional(),
  intermediaryData: z.record(z.string(), z.unknown()).optional(),
  latencyStats: z
    .object({
      p50Ms: z.number().min(0).optional(),
      lastMs: z.number().min(0).optional(),
      maxMs: z.number().min(0).optional(),
      turnsCount: z.number().int().min(0).optional(),
      history: z.array(LatencyTurnTelemetrySchema).max(100).optional(),
    })
    .optional(),
  failureStage: z.enum(['signaling', 'media', 'ai_provider', 'capacity', 'duration_cap', 'none']).optional(),
  correlationId: z.string().min(1).max(200).optional(),
});
export type ConnectorEvent = z.infer<typeof ConnectorEventSchema>;

/**
 * Ordem de chamada Voll Plan -> gateway de voz (`POST /v1/calls`, header `Idempotency-Key = attemptId`).
 * Contrato único: o adaptador `connectors/voice-app.ts` monta este payload e o `apps/voice-gateway`
 * valida o mesmo schema (JSON Schema gerado em `packages/shared/contracts/`).
 */
export const VoiceCallRequestSchema = z.object({
  attemptId: z.string().uuid(),
  traceId: z.string().min(1),
  connectionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  /** destino em E.164 */
  to: z.string().regex(/^\+?[0-9]{8,15}$/, 'destino deve ter 8 a 15 dígitos'),
  from: z.string().regex(/^\+?[0-9]{8,15}$/),
  callerId: z.string().regex(/^\+?[0-9]{8,15}$/),
  callerIdPool: z.array(z.string().regex(/^\+?[0-9]{8,15}$/)).optional(),
  tenantId: z.string().min(1),
  contact: z.object({
    externalId: z.string().min(1),
    name: z.string(),
    variables: z.record(z.string(), z.unknown()),
  }),
  campaign: z.object({ id: z.string().uuid() }),
  limits: z.object({ maxDurationSec: z.number().int().min(10).max(3600) }),
  /** códigos de tabulação que o gateway pode devolver nesta tentativa (snapshot da estratégia) */
  allowedTabulations: z.array(z.string().min(1)).optional(),
  /** lista opcional de troncos de saída permitidos para esta chamada; vazio/omitido usa rota padrão */
  trunkIds: z.array(z.string().min(1)).max(50).optional(),
  /** overrides opcionais por campanha/estratégia */
  agentOverrides: VoiceAgentOverridesSchema.optional(),
  /** versão do agente de voz cadastrado na conexão; o gateway recusa se o tenant estiver em outra versão */
  agentVersion: z.number().int().min(1).optional(),
  /** rastreabilidade explícita da regra de precedência (Campanha > Canal > Workspace / Rota de Saída) */
  agentSource: z.enum(['campaign_override', 'channel_default', 'workspace_default']).optional(),
  trunkSource: z.enum(['campaign_override', 'outbound_route', 'channel_default']).optional(),
  callback: z.object({ url: z.string().url(), secret: z.string().min(16) }),
});
export type VoiceCallRequest = z.infer<typeof VoiceCallRequestSchema>;

const E164 = z.string().regex(/^\+?[0-9]{8,15}$/, 'Use de 8 a 15 dígitos, com DDI (ex.: +551130001000)');

export const CustomVoiceToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{1,63}$/, 'Nome de tool inválido'),
  description: z.string().min(3).max(500),
  method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  parameters: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
  fillerSpeech: z.string().max(240).optional(),
  timeoutMs: z.number().int().min(500).max(10000).default(4000),
});
export type CustomVoiceTool = z.infer<typeof CustomVoiceToolSchema>;

export const PronunciationRuleSchema = z.object({
  pattern: z.string().min(1).max(80),
  replacement: z.string().min(1).max(160),
  matchType: z.enum(['exact', 'regex']).default('exact'),
});

export const EndpointingPlanSchema = z.object({
  waitSeconds: z.number().min(0.1).max(3).default(0.4),
  smartEndpointing: z.boolean().default(true),
});

export const InterruptionPlanSchema = z.object({
  enabled: z.boolean().default(true),
  minWords: z.number().int().min(1).max(10).default(2),
  minVoiceMs: z.number().int().min(80).max(1500).default(260),
  backoffMs: z.number().int().min(0).max(3000).default(350),
});

export const PathwayNodeSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  type: z.enum(['conversation', 'tool', 'dtmf', 'transfer', 'end']).default('conversation'),
  prompt: z.string().max(4000).default(''),
  transitions: z.array(z.object({ condition: z.string().max(300), targetNodeId: z.string().min(1).max(64) })).default([]),
});

export const PathwaySchema = z.object({
  startNodeId: z.string().max(64).optional(),
  nodes: z.array(PathwayNodeSchema).max(40).default([]),
  globalNodes: z
    .array(z.object({ id: z.string().min(1).max(64), trigger: z.string().min(2).max(200), prompt: z.string().max(2000), action: z.enum(['opt_out', 'transfer', 'end']).default('transfer') }))
    .max(15)
    .default([]),
});

export const GuardrailsSchema = z.object({
  mandatoryDisclosures: z.array(z.string().max(400)).max(10).default([]),
  forbiddenTopics: z.array(z.string().max(400)).max(20).default([]),
  escalationKeywords: z.array(z.string().max(120)).max(20).default([]),
  onViolation: z.enum(['warn', 'block_and_rephrase']).default('warn'),
});

export const SquadAgentSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  instructions: z.string().min(10).max(10000),
  voice: z.string().max(80).optional(),
  handoffHint: z.string().max(300).optional(),
});

/**
 * Agente de voz cadastrado na Conexão de voz do Voll Plan (cadastro único, fase 3 da consolidação).
 * Não carrega credenciais: chaves da OpenAI/ElevenLabs ficam no ambiente do gateway.
 */
export const VoiceAgentSchema = z
  .object({
    name: z.string().min(1, 'Informe o nome do agente').max(120),
    engine: z.enum(['openai', 'elevenlabs']).default('openai'),
    openaiModel: z.string().max(80).optional(),
    voice: z.string().max(80).optional(),
    elevenlabsVoiceId: z.string().max(80).optional(),
    elevenlabsModel: z.string().max(80).optional(),
    instructions: z.string().min(20, 'Descreva o roteiro do agente (mínimo de 20 caracteres)').max(20000),
    greeting: z.string().max(1000).optional(),
    firstMessageMode: z.enum(['assistant-speaks-first', 'assistant-waits-for-user']).default('assistant-speaks-first'),
    maxDurationSec: z.number().int().min(30).max(900).default(180),
    amd: z
      .object({
        enabled: z.boolean().default(true),
        mode: z.enum(['active', 'shadow']).default('active'),
        voicemailAction: z.enum(['hangup', 'leave_message']).default('hangup'),
        voicemailMessage: z.string().max(1000).optional(),
      })
      .default({}),
    stt: z.object({ enabled: z.boolean().default(true) }).default({}),
    bargeinLevel: z.number().int().min(1).max(5).default(3),
    defaultCallerId: E164,
    allowedCallerIds: z.array(E164).default([]),
    callerIdStrategy: z.enum(CALLER_ID_STRATEGIES).default('FIXED'),
    idleMessages: z.array(z.string().min(1).max(300)).max(5).default([]),
    idleTimeoutSeconds: z.number().int().min(3).max(30).default(8),
    structuredDataSchema: z.record(z.string(), z.unknown()).nullable().optional(),
    endpointingPlan: EndpointingPlanSchema.default({}),
    interruptionPlan: InterruptionPlanSchema.default({}),
    pronunciationRules: z.array(PronunciationRuleSchema).max(100).default([]),
    tools: z.array(CustomVoiceToolSchema).max(15).default([]),
    dtmfConfig: z.object({ sendEnabled: z.boolean().default(true), collectEnabled: z.boolean().default(true) }).default({}),
    crossCallMemoryEnabled: z.boolean().default(false),
    piiRedactionEnabled: z.boolean().default(false),
    transferConfig: z
      .object({
        defaultTarget: z.string().max(200).optional(),
        mode: z.enum(['blind', 'warm']).default('blind'),
        sipHeaders: z.record(z.string(), z.string()).default({}),
      })
      .default({}),
    mode: z.enum(['prompt', 'pathway']).default('prompt'),
    pathway: PathwaySchema.nullable().optional(),
    guardrails: GuardrailsSchema.default({}),
    squadAgents: z.array(SquadAgentSchema).max(10).default([]),
  })
  .superRefine((a, ctx) => {
    if (a.allowedCallerIds.length && !a.allowedCallerIds.includes(a.defaultCallerId))
      ctx.addIssue({ code: 'custom', path: ['defaultCallerId'], message: 'O caller ID padrão precisa estar na lista de autorizados' });
  });
export type VoiceAgent = z.infer<typeof VoiceAgentSchema>;

/**
 * Agente publicado no gateway (`PUT /v1/tenants/:connectionId`). O tenant do gateway passa a ser a
 * conexão de voz do Voll Plan, que pertence a um único workspace.
 */
export const VoiceAgentTenantSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    vollWorkspaceId: z.string().uuid(),
    vollAgentVersion: z.number().int().min(1),
    stsEngine: z.enum(['openai', 'elevenlabs']),
    openaiModel: z.string().optional(),
    voice: z.string().optional(),
    elevenlabsVoiceId: z.string().optional(),
    elevenlabsModel: z.string().optional(),
    instructions: z.string().min(20),
    greetingInstructions: z.string().nullable(),
    firstMessageMode: z.enum(['assistant-speaks-first', 'assistant-waits-for-user']).optional(),
    maxDurationSec: z.number().int().min(15).max(3600).default(180),
    maxConcurrentCalls: z.number().int().min(1).optional(),
    recording: z.object({ enabled: z.boolean().default(true) }).optional(),
    amd: z.object({
      enabled: z.boolean(),
      mode: z.enum(['active', 'shadow']),
      voicemailAction: z.enum(['hangup', 'leave_message']).optional(),
      voicemailMessage: z.string().max(1000).optional(),
    }),
    stt: z.object({ enabled: z.boolean() }),
    bargeinLevel: z.number().int().min(1).max(5),
    allowedCallerIds: z.array(E164),
    callerIdStrategy: z.enum(CALLER_ID_STRATEGIES).optional(),
    idleMessages: z.array(z.string().min(1).max(300)).max(5).optional(),
    idleTimeoutSeconds: z.number().int().min(3).max(30).optional(),
    structuredDataSchema: z.record(z.string(), z.unknown()).nullable().optional(),
    endpointingPlan: EndpointingPlanSchema.optional(),
    interruptionPlan: InterruptionPlanSchema.optional(),
    pronunciationRules: z.array(PronunciationRuleSchema).max(100).optional(),
    tools: z.array(CustomVoiceToolSchema).max(15).optional(),
    dtmfConfig: z.object({ sendEnabled: z.boolean(), collectEnabled: z.boolean() }).optional(),
    crossCallMemoryEnabled: z.boolean().optional(),
    piiRedactionEnabled: z.boolean().optional(),
    transferConfig: z
      .object({
        defaultTarget: z.string().max(200).optional(),
        mode: z.enum(['blind', 'warm']),
        sipHeaders: z.record(z.string(), z.string()),
      })
      .optional(),
    mode: z.enum(['prompt', 'pathway']).optional(),
    pathway: PathwaySchema.nullable().optional(),
    guardrails: GuardrailsSchema.optional(),
    squadAgents: z.array(SquadAgentSchema).max(10).optional(),
    /** tenant de campanha: não atende ramal nem DID de entrada */
    extension: z.null(),
    dids: z.array(z.string()).max(0),
    publicWidgetKey: z.string().nullable().optional(),
    allowedOrigins: z.array(z.string()).optional(),
    active: z.boolean(),
  })
  .strict();
export type VoiceAgentTenant = z.infer<typeof VoiceAgentTenantSchema>;

/** Resposta do gateway a `POST /v1/calls`. 202 = aceita; 200 = repetição da mesma tentativa. */
export const VoiceCallAcceptedSchema = z.object({
  ok: z.literal(true),
  status: z.literal('ACCEPTED'),
  providerAttemptId: z.string().min(1),
  callId: z.string().min(1).optional(),
  duplicate: z.boolean().optional(),
});

// ------------------------------------------------------------------ helpers
export type Paginated<T> = { items: T[]; nextCursor: string | null; total?: number };

/** Erro padronizado (RFC 9457 simplificado). */
export type ApiProblem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** erros por campo: caminho "a.b" -> mensagem */
  fieldErrors?: Record<string, string>;
};

export function maskAddress(address: string): string {
  if (address.includes('@')) {
    const [u, d] = address.split('@');
    return `${u.slice(0, 2)}***@${d}`;
  }
  return address.length <= 4 ? '****' : `${address.slice(0, 4)}****${address.slice(-2)}`;
}

// ==================================================================
// VOLL CONNECT NEXT-GEN: ESTEIRA DE INTELIGÊNCIA DE CPC & OPERAÇÃO DUAL
// ==================================================================

export const OPERATING_MODES = ['PARALLEL_BOTH', 'PRODUCTION', 'LABORATORY'] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];
export const OPERATING_MODE_LABEL: Record<OperatingMode, string> = {
  PARALLEL_BOTH: 'Paralelo: Produção + Laboratório (Recomendado)',
  PRODUCTION: 'Modo Produção (Esteira Completa → Envio Imediato)',
  LABORATORY: 'Modo Laboratório (Amostra Viável → Testes Reais em Ondas)',
};

export const AUDIENCE_SEGMENT_LABEL: Record<AudienceSegment, string> = {
  B2C: 'B2C · Pessoa Física (Consumidor Final)',
  B2B: 'B2B · Pessoa Jurídica (Empresas & Decisores)',
  MIXED: 'Misto · Híbrido (CPF e CNPJ)',
};

export type AudienceSegmentMetadata = {
  code: AudienceSegment;
  title: string;
  shortTitle: string;
  tagline: string;
  targetDescription: string;
  operatingHours: string;
  primaryChannels: string;
  approach: string;
  keyDocument: string;
  paymentMethod: string;
};

export const AUDIENCE_SEGMENT_METADATA: Record<AudienceSegment, AudienceSegmentMetadata> = {
  B2C: {
    code: 'B2C',
    title: 'Pessoa Física (Consumidor)',
    shortTitle: 'B2C',
    tagline: 'Titulares individuais, contas residenciais e pessoas físicas (CPF).',
    targetDescription: 'Consumidores finais e titulares residenciais cadastrados sob CPF.',
    operatingHours: 'TIC Domicílios 2025: Almoço (11h30–13h30), Noite Wi-Fi Residencial (18h00–20h45) e Sábados (09h00–13h00).',
    primaryChannels: 'WhatsApp Conversacional, SMS curto e Discador com BINA DDD Local.',
    approach: 'Acordos com PIX instantâneo, links de autosserviço e respeito à franquia móvel (H-G3).',
    keyDocument: 'CPF / Nome',
    paymentMethod: 'PIX Instantâneo / Cartão de Crédito',
  },
  B2B: {
    code: 'B2B',
    title: 'Pessoa Jurídica (Empresas)',
    shortTitle: 'B2B',
    tagline: 'Empresas, sócios, diretores, compras e departamento financeiro/contas a pagar (CNPJ).',
    targetDescription: 'Organizações empresariais, decisores e gestores financeiros cadastrados sob CNPJ.',
    operatingHours: 'Horário Comercial Corporativo: Segunda a Sexta, 08h30 às 18h00. Bloqueio estrito de noites e finais de semana.',
    primaryChannels: 'E-mail Corporativo Institucional (#1), WhatsApp Business Formal e Voz com Identificação Corporativa.',
    approach: 'Envio de 2ª via de boleto/DDA com código de barras, nota fiscal faturada e alinhamento corporativo.',
    keyDocument: 'CNPJ / Razão Social',
    paymentMethod: 'Boleto Faturado / DDA / Transferência TED/PIX PJ',
  },
  MIXED: {
    code: 'MIXED',
    title: 'Base Híbrida / Mista',
    shortTitle: 'Misto',
    tagline: 'Base contendo tanto pessoas físicas (B2C) quanto jurídicas (B2B). Roteamento dinâmico.',
    targetDescription: 'Mailing híbrido com CPF e CNPJ. O motor aplica a estratégia adequada para cada contato.',
    operatingHours: 'Roteamento dinâmico: B2B em horário comercial (08h30–18h) e B2C nas janelas TIC Domicílios.',
    primaryChannels: 'Mix Multicanal Dinâmico (E-mail + WhatsApp + Discador).',
    approach: 'Detecção automática por CPF/CNPJ aplicando a régua correspondente por registro.',
    keyDocument: 'CPF ou CNPJ',
    paymentMethod: 'PIX (PF) ou Boleto/DDA (PJ)',
  },
};

export const OPERATION_PURPOSE_LABEL: Record<OperationPurpose, string> = {
  COBRANCA: 'Cobrança e Recuperação de Crédito',
  VENDAS: 'Vendas, Oferta Comercial e Up-sell',
  AGENDAMENTOS: 'Agendamentos e Confirmação de Presença',
  CONFIRMACAO_SERVICO: 'Confirmação Transacional / Agendamento',
  ATENDIMENTO_SUPORTE: 'Atendimento e Suporte ao Cliente',
  PESQUISA_RELACIONAMENTO: 'Pesquisa e Relacionamento Preventivo',
};

export type PurposeMetadata = {
  code: OperationPurpose;
  title: string;
  shortTitle: string;
  tagline: string;
  metricLabel: string;
  secondaryMetricLabel: string;
  recommendedChannel: string;
  cadenceSummary: string;
  benchmarkUnitCostBrl: number;
  optimizedUnitCostBrl: number;
  expectedRatePct: number;
  savingsOrGainPct: number;
};

export const PURPOSE_METADATA: Record<'COBRANCA' | 'VENDAS' | 'AGENDAMENTOS', PurposeMetadata> = {
  COBRANCA: {
    code: 'COBRANCA',
    title: 'Cobrança e Recuperação de Crédito',
    shortTitle: 'Cobrança',
    tagline: 'Localização de titular, renegociação amigável e acordos com PIX.',
    metricLabel: 'Custo por CPC Otimizado',
    secondaryMetricLabel: 'Taxa Estimada de CPC',
    recommendedChannel: 'WhatsApp Oficial + Discador BINA Local',
    cadenceSummary: 'Aspect ALM Shift Matrix (turnos alternados, mínimo 6h entre tentativas)',
    benchmarkUnitCostBrl: 5.60,
    optimizedUnitCostBrl: 3.18,
    expectedRatePct: 38.4,
    savingsOrGainPct: 43.2,
  },
  VENDAS: {
    code: 'VENDAS',
    title: 'Vendas, Oferta Comercial e Up-sell',
    shortTitle: 'Venda',
    tagline: 'Ofertas ativas, upgrade de planos e conversão consultiva de leads.',
    metricLabel: 'Custo por Conversão / Lead',
    secondaryMetricLabel: 'Taxa de Conversão Estimada',
    recommendedChannel: 'WhatsApp Interativo (Catálogo) + Discador Consultivo',
    cadenceSummary: 'Janelas nobres de receptividade (almoço e 17h30–20h30)',
    benchmarkUnitCostBrl: 14.50,
    optimizedUnitCostBrl: 8.20,
    expectedRatePct: 16.5,
    savingsOrGainPct: 35.0,
  },
  AGENDAMENTOS: {
    code: 'AGENDAMENTOS',
    title: 'Agendamentos e Confirmação de Presença',
    shortTitle: 'Agendamentos',
    tagline: 'Confirmação de consultas, visitas técnicas e redução drástica de no-show.',
    metricLabel: 'Custo por Confirmação',
    secondaryMetricLabel: 'Taxa de Comparecimento / Presença',
    recommendedChannel: 'WhatsApp Oficial com Botões (Sim / Reagendar) + SMS Fallback',
    cadenceSummary: 'Lembrete 1 dia antes (D-1 com botões) + Lembrete no dia (D-0 informativo 2h antes)',
    benchmarkUnitCostBrl: 1.80,
    optimizedUnitCostBrl: 0.42,
    expectedRatePct: 78.5,
    savingsOrGainPct: 52.0,
  },
};

export const CETIC_AGE_BRACKETS = ['16_24', '25_34', '35_44', '45_59', '60_PLUS', 'UNKNOWN'] as const;
export type CeticAgeBracket = (typeof CETIC_AGE_BRACKETS)[number];
export const CETIC_AGE_BRACKET_LABEL: Record<CeticAgeBracket, string> = {
  '16_24': '16–24 anos (Geração Z)',
  '25_34': '25–34 anos (Millennials Jovens / Gen Z)',
  '35_44': '35–44 anos (Millennials Maduros)',
  '45_59': '45–59 anos (Geração X)',
  '60_PLUS': '60+ anos (Baby Boomers / Sênior)',
  UNKNOWN: 'Idade não informada (Prior Contextual)',
};

export const MACRO_REGIONS = ['SUDESTE', 'SUL', 'NORDESTE', 'CENTRO_OESTE', 'NORTE'] as const;
export type MacroRegion = (typeof MACRO_REGIONS)[number];

export const IBGE_CITY_TIERS = ['METROPOLE', 'POLO_REGIONAL', 'INTERIOR_PEQUENO'] as const;
export type IbgeCityTier = (typeof IBGE_CITY_TIERS)[number];
export const IBGE_CITY_TIER_LABEL: Record<IbgeCityTier, string> = {
  METROPOLE: 'Metrópole / Capital (> 1M hab.)',
  POLO_REGIONAL: 'Polo Regional / Cidade Média (100k–1M hab.)',
  INTERIOR_PEQUENO: 'Interior / Pequeno Porte (< 100k hab.)',
};

export const PHONE_INTENT_TIERS = [
  'P1_VOZ_DIRETA',
  'P2_VOZ_COM_WARMUP',
  'P3_DIGITAL_ASSINCRONO',
  'P4_BAIXO_ALCANCE',
] as const;
export type PhoneIntentTier = (typeof PHONE_INTENT_TIERS)[number];
export const PHONE_INTENT_LABEL: Record<PhoneIntentTier, string> = {
  P1_VOZ_DIRETA: 'P1 · Alta Propensão a Voz Direta (Local DID)',
  P2_VOZ_COM_WARMUP: 'P2 · Voz Destravada por Warm-up Pré-Chamada',
  P3_DIGITAL_ASSINCRONO: 'P3 · Digital-First Assíncrono (WhatsApp / E-mail)',
  P4_BAIXO_ALCANCE: 'P4 · Baixo Alcance / Destino Frágil',
};

export const PLAN_DECISION_STATUS = [
  'INCLUIDO_PRIORITARIO',
  'INCLUIDO_PADRAO',
  'INCLUIDO_ECONOMICO',
  'SUSPENSO_TEMPORARIO',
  'EXCLUIDO_SUPRESSAO',
] as const;
export type PlanDecisionStatus = (typeof PLAN_DECISION_STATUS)[number];
export const PLAN_DECISION_LABEL: Record<PlanDecisionStatus, string> = {
  INCLUIDO_PRIORITARIO: 'Incluído · Prioridade Ouro (Menor ECPC)',
  INCLUIDO_PADRAO: 'Incluído · Prioridade Padrão',
  INCLUIDO_ECONOMICO: 'Incluído · Trilha Econômica (Baixo Custo)',
  SUSPENSO_TEMPORARIO: 'Suspenso Temporariamente (Retorno / Janela)',
  EXCLUIDO_SUPRESSAO: 'Excluído (Supressão Obrigatória / Sem Destino)',
};

export const HYPOTHESIS_FAMILIES = ['H-A', 'H-G', 'H-C', 'H-T', 'H-L'] as const;
export type HypothesisFamily = (typeof HYPOTHESIS_FAMILIES)[number];
export const HYPOTHESIS_FAMILY_LABEL: Record<HypothesisFamily, string> = {
  'H-A': '3.1 Idade, Geração e Maturidade Digital (H-A1..A6)',
  'H-G': '3.2 Região, Município, Pacote de Dados e Contexto (H-G1..G5)',
  'H-C': '3.3 Canal, Contexto, Warm-up e Identidade (H-C1..C8)',
  'H-T': '3.4 Horário Local, Reciclagem de Turno e Sequência (H-T1..T6)',
  'H-L': '3.5 Qualidade da Lista (Locator) e Custos Efetivos (H-L1..L6)',
};

export const StartIntelligenceRunSchema = z.object({
  mailingId: z.string().uuid('Selecione um mailing válido'),
  mode: z.enum(OPERATING_MODES).default('PARALLEL_BOTH'),
  purposeCode: z.enum(OPERATION_PURPOSES).default('COBRANCA'),
  audienceSegment: z.enum(AUDIENCE_SEGMENTS).default('B2C').optional(),
  purposePrompt: z
    .string()
    .min(5, 'Descreva a finalidade e o contexto da operação no prompt inicial')
    .max(1000)
    .default('Renegociação amigável de faturas em aberto com foco em encontrar o titular pelo menor custo de CPC.'),
  referenceDate: z.string().optional(),
  labSamplePct: z.number().min(5).max(50).default(25),
  plannedDaysWaves: z.number().int().min(2).max(7).default(3),
  maxAttemptsPerContact: z.number().int().min(1).max(10).default(4),
  maxAcceptableCpcBrl: z.number().min(0.05).max(50).default(1.8),
  autoDispatchProduction: z.boolean().default(true),
  channelTariffs: z
    .object({
      VOICE: z.number().min(0).default(0.12),
      WHATSAPP: z.number().min(0).default(0.28),
      SMS: z.number().min(0).default(0.05),
      EMAIL: z.number().min(0).default(0.01),
    })
    .optional(),
});
export type StartIntelligenceRunInput = z.infer<typeof StartIntelligenceRunSchema>;

export const UpdateHypothesisSchema = z.object({
  enabled: z.boolean().optional(),
  productionWeight: z.number().min(0).max(3).optional(),
  labWeight: z.number().min(0).max(3).optional(),
  reason: z.string().min(3, 'Informe a justificativa do ajuste').optional(),
});

export const OverrideContactPlanSchema = z.object({
  status: z.enum(PLAN_DECISION_STATUS).optional(),
  primaryChannel: z.enum(CHANNEL_TYPES).optional(),
  localTimeWindow: z.string().optional(),
  reason: z.string().min(3, 'Informe o motivo da revisão humana (LGPD/ANPD)'),
});

export const PromoteLabToProductionSchema = z.object({
  reason: z.string().min(3, 'Informe o motivo da promoção para Produção').default('Ganhos estatísticos validados nas ondas do Modo Laboratório'),
});

// ==================================================================
// ASSISTENTE DE IA CONVERSACIONAL (OPENAI API INTEGRATION)
// ==================================================================
export const AiChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;

export const AiCampaignExtractedFilterSchema = z.object({
  field: z.string(),
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string(),
});
export type AiCampaignExtractedFilter = z.infer<typeof AiCampaignExtractedFilterSchema>;

export const AiCampaignExtractedSortSchema = z.object({
  field: z.string(),
  dir: z.enum(['asc', 'desc']),
  label: z.string(),
});
export type AiCampaignExtractedSort = z.infer<typeof AiCampaignExtractedSortSchema>;

export const AiCampaignExtractedStateSchema = z.object({
  purposeCode: z.enum(OPERATION_PURPOSES).nullable().optional(),
  audienceSegment: z.enum(AUDIENCE_SEGMENTS).nullable().optional(),
  campaignName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  recommendedChannels: z.array(z.enum(CHANNEL_TYPES)).optional(),
  operatingDays: z.array(z.number().int().min(0).max(6)).optional(),
  operatingStart: z.string().optional(),
  operatingEnd: z.string().optional(),
  maxAttemptsPerContact: z.number().int().min(1).max(20).optional(),
  maxAcceptableCpcBrl: z.number().min(0.05).max(100).optional(),
  extractedFilters: z.array(AiCampaignExtractedFilterSchema).optional(),
  extractedSort: AiCampaignExtractedSortSchema.optional(),
  cadenceSummary: z.string().optional(),
});
export type AiCampaignExtractedState = z.infer<typeof AiCampaignExtractedStateSchema>;

export const AiCampaignChatRequestSchema = z.object({
  messages: z.array(AiChatMessageSchema).min(1),
  currentState: AiCampaignExtractedStateSchema.optional(),
  selectedMailingId: z.string().nullable().optional(),
  selectedMailingName: z.string().nullable().optional(),
  selectedMailingCount: z.number().nullable().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});
export type AiCampaignChatRequest = z.infer<typeof AiCampaignChatRequestSchema>;

export const AiCampaignChatResponseSchema = z.object({
  reply: z.string(),
  provider: z.enum(['OPENAI', 'LOCAL_ASSISTANT']),
  model: z.string(),
  missingInfo: z.enum(['PURPOSE', 'MAILING', 'AUDIENCE_SEGMENT', 'CHANNELS', 'SCHEDULE']).nullable(),
  readyToReview: z.boolean(),
  suggestedReplies: z.array(z.string()).default([]),
  extracted: AiCampaignExtractedStateSchema,
});
export type AiCampaignChatResponse = z.infer<typeof AiCampaignChatResponseSchema>;

// ---------------------------------------------------------------- Configuração Técnica de Endereços dos Canais
export const ChannelEndpointConfigSchema = z.object({
  whatsapp: z.object({
    apiBaseUrl: z.string().default('https://graph.facebook.com/v19.0'),
    phoneNumberId: z.string().default('108293847561029'),
    wabaId: z.string().default('992817264510293'),
    webhookUrl: z.string().default('https://api.vollconnect.com.br/webhooks/whatsapp'),
    verifyToken: z.string().default('voll_wa_verify_token_prod'),
    apiVersion: z.string().default('v19.0'),
  }),
  voice: z.object({
    sipServer: z.string().default('sip.voip.vollconnect.com.br'),
    sipPort: z.number().int().default(5060),
    sipTransport: z.enum(['UDP', 'TCP', 'TLS']).default('TLS'),
    webrtcGatewayUrl: z.string().default('wss://webrtc.vollconnect.com.br/ws'),
    cdrWebhookUrl: z.string().default('https://api.vollconnect.com.br/webhooks/cdr'),
    defaultCallerId: z.string().default(''),
    outboundProxy: z.string().default('proxy.voip.vollconnect.com.br:5061'),
    voiceAppBaseUrl: z.string().default(''),
    voiceAppToken: z.string().default(''),
    maxConcurrent: z.number().int().min(1).default(30),
    maxConcurrentPerWorkspace: z.number().int().min(1).default(10),
  }),
  sms: z.object({
    smppHost: z.string().default('smpp.zenvia.vollconnect.com.br'),
    smppPort: z.number().int().default(2775),
    systemType: z.string().default('SMPP'),
    dlrWebhookUrl: z.string().default('https://api.vollconnect.com.br/webhooks/sms/dlr'),
    defaultSenderId: z.string().default('28080'),
  }),
  email: z.object({
    smtpHost: z.string().default('smtp.sendgrid.net'),
    smtpPort: z.number().int().default(587),
    smtpSecurity: z.enum(['STARTTLS', 'SSL', 'TLS']).default('STARTTLS'),
    fromAddress: z.string().default('notificacoes@vollconnect.com.br'),
    fromName: z.string().default('Voll Plan Operações'),
    eventsWebhookUrl: z.string().default('https://api.vollconnect.com.br/webhooks/email/events'),
  }),
  rcs: z.object({
    rbmApiUrl: z.string().default('https://rcsbusinessmessaging.googleapis.com/v1'),
    agentId: z.string().default('voll-connect-assistant@rbm.goog'),
    webhookUrl: z.string().default('https://api.vollconnect.com.br/webhooks/rcs'),
  }),
});

export type ChannelEndpointConfig = z.infer<typeof ChannelEndpointConfigSchema>;

export const DEFAULT_CHANNEL_ENDPOINTS: ChannelEndpointConfig = {
  whatsapp: {
    apiBaseUrl: 'https://graph.facebook.com/v19.0',
    phoneNumberId: '108293847561029',
    wabaId: '992817264510293',
    webhookUrl: 'https://api.vollconnect.com.br/webhooks/whatsapp',
    verifyToken: 'voll_wa_verify_token_prod',
    apiVersion: 'v19.0',
  },
  voice: {
    sipServer: 'sip.voip.vollconnect.com.br',
    sipPort: 5060,
    sipTransport: 'TLS',
    webrtcGatewayUrl: 'wss://webrtc.vollconnect.com.br/ws',
    cdrWebhookUrl: 'https://api.vollconnect.com.br/webhooks/cdr',
    defaultCallerId: '',
    outboundProxy: 'proxy.voip.vollconnect.com.br:5061',
    voiceAppBaseUrl: '',
    voiceAppToken: '',
    maxConcurrent: 30,
    maxConcurrentPerWorkspace: 10,
  },
  sms: {
    smppHost: 'smpp.zenvia.vollconnect.com.br',
    smppPort: 2775,
    systemType: 'SMPP',
    dlrWebhookUrl: 'https://api.vollconnect.com.br/webhooks/sms/dlr',
    defaultSenderId: '28080',
  },
  email: {
    smtpHost: 'smtp.sendgrid.net',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    fromAddress: 'notificacoes@vollconnect.com.br',
    fromName: 'Voll Plan Operações',
    eventsWebhookUrl: 'https://api.vollconnect.com.br/webhooks/email/events',
  },
  rcs: {
    rbmApiUrl: 'https://rcsbusinessmessaging.googleapis.com/v1',
    agentId: 'voll-connect-assistant@rbm.goog',
    webhookUrl: 'https://api.vollconnect.com.br/webhooks/rcs',
  },
};

// ---------------------------------------------------------------- Arquitetura Telefonia: Canal, Agentes e Rotas (006)
export const INBOUND_ROUTE_CHANNEL_SCOPES = ['*', 'VOICE', 'WEBRTC'] as const;
export type InboundRouteChannelScope = (typeof INBOUND_ROUTE_CHANNEL_SCOPES)[number];

export const VOICE_ROUTING_SOURCES = [
  'inbound_route',
  'channel_default',
  'workspace_default',
  'campaign_override',
  'outbound_route',
  'none',
] as const;
export type VoiceRoutingSource = (typeof VOICE_ROUTING_SOURCES)[number];

export const InboundRouteUpsertSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().min(1, 'Informe o nome da rota').max(80),
  channelType: z.enum(INBOUND_ROUTE_CHANNEL_SCOPES).default('*'),
  connectionId: z.string().max(80).default('*'),
  trunkId: z.string().max(80).default('*'),
  didPattern: z.string().max(120).default('*'),
  callerPattern: z.string().max(120).default('*'),
  originPattern: z.string().max(200).default('*'),
  tenantId: z.string().min(1, 'Selecione o Agente de Voz de destino').max(120),
  priority: z.number().int().min(1).max(10000).optional(),
  maxChannels: z.number().int().min(1).nullable().optional(),
  amdMode: z.enum(['tenant_default', 'enabled', 'disabled']).optional(),
  recordingEnabled: z.enum(['tenant_default', 'enabled', 'disabled']).optional(),
  crosstalkFilterMode: z.enum(['tenant_default', 'atual', 'wespeaker', 'ecapa', 'none']).optional(),
  bargeinGraceSec: z.number().min(0).max(10).nullable().optional(),
  active: z.boolean().default(true),
});
export type InboundRouteUpsert = z.infer<typeof InboundRouteUpsertSchema>;

export const InboundRouteSimulateSchema = z.object({
  channelType: z.enum(['VOICE', 'WEBRTC']).default('VOICE'),
  connectionId: z.string().max(80).optional(),
  trunkId: z.string().max(80).optional(),
  did: z.string().max(120).optional(),
  callerId: z.string().max(120).optional(),
  origin: z.string().max(240).optional(),
});
export type InboundRouteSimulate = z.infer<typeof InboundRouteSimulateSchema>;

export const VoiceAgentUsageSummarySchema = z.object({
  agentId: z.string(),
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      channelType: z.string(),
      active: z.boolean(),
    }),
  ),
  routes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      channelType: z.string(),
      active: z.boolean(),
    }),
  ),
  campaigns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
    }),
  ),
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
  totalReferences: z.number().int().min(0),
});
export type VoiceAgentUsageSummary = z.infer<typeof VoiceAgentUsageSummarySchema>;



