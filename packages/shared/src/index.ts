/**
 * Contratos compartilhados entre API e Web (Voll Connect MVP).
 * Fonte única para enums, schemas de entrada (Zod) e formatos de resposta.
 * Referências entre parênteses apontam para o Plano funcional v2.2.
 */
import { z } from 'zod';

// ------------------------------------------------------------------ enums
export const ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR', 'ANALYST'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gestor',
  SUPERVISOR: 'Supervisor',
  OPERATOR: 'Operador',
  ANALYST: 'Analista',
};

export const CHANNEL_TYPES = ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_LABEL: Record<ChannelType, string> = {
  VOICE: 'Discador',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  EMAIL: 'E-mail',
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
  'NEXT_DESTINATION', // alternar para o próximo destino do mesmo canal
  'NEXT_STEP',        // avançar para a próxima etapa da jornada
  'FINISH_SUCCESS',   // encerrar inscrição com sucesso
  'FINISH_FAIL',      // encerrar inscrição sem sucesso
] as const;
export type TabulationAction = (typeof TABULATION_ACTIONS)[number];
export const TABULATION_ACTION_LABEL: Record<TabulationAction, string> = {
  RETRY: 'Retentar',
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
});

export const ImportCommitSchema = ImportPreviewSchema.extend({
  name: z.string().min(1, 'Informe o nome do mailing'),
  mapping: z.array(ColumnMappingSchema).min(1),
  /** obrigatório quando há rejeitados (§26.5): confirma importação parcial */
  acceptPartial: z.boolean().default(false),
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
export const StrategyPublishSchema = z.object({ config: StrategyConfigSchema });

export const JourneyCreateSchema = z.object({
  name: z.string().min(1),
  steps: z.array(JourneyStepSchema).min(1),
});

export const ConnectionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  tariff: z.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
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
    .optional(),
});

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

export const CreateCampaignSchema = z
  .object({
    name: z.string().min(1, 'Informe o nome da campanha'),
    description: z.string().optional(),
    mailingId: z.string().uuid(),
    listVersionId: z.string().uuid().nullable().optional(),
    journeyVersionId: z.string().uuid(),
    strategyVersionId: z.string().uuid(),
    startMode: z.enum(['NOW', 'SCHEDULE', 'READY']),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.startMode === 'SCHEDULE') {
      if (!c.scheduledAt) ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Informe data e hora' });
      else if (new Date(c.scheduledAt).getTime() <= Date.now())
        ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'A data deve ser futura' });
    }
  });

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
export const ConnectorEventSchema = z.object({
  eventId: z.string().min(1),
  providerAttemptId: z.string().min(1),
  type: z.enum(CONNECTOR_EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  tabulationCode: z.string().optional(),
  cost: z.number().min(0).optional(),
});
export type ConnectorEvent = z.infer<typeof ConnectorEventSchema>;

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
