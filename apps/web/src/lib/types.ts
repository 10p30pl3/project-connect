// Formatos de resposta conforme docs/API.md
import type {
  AttemptState,
  CampaignDraft,
  CampaignStatus,
  ChannelType,
  ColumnMapping,
  EnrollmentState,
  JourneyStep,
  ReasonCode,
  Role,
  StrategyConfig,
  ListFilter,
} from '@voll/shared';

export type Me = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organization: { id: string; name: string };
  workspace: { id: string; name: string; timezone: string };
};
export type User = { id: string; email: string; name: string; role: Role; active?: boolean; createdAt?: string };

export type Paginated<T> = { items: T[]; nextCursor: string | null; total?: number };

export type Overview = {
  campaigns: { running: number; paused: number; ready: number; scheduled: number; completed: number };
  attempts: { active: number; reconciliation: number; sentToday: number };
  contacts: number;
  mailings: number;
  globalSuspension: boolean;
};

export type MailingSummary = {
  id: string;
  name: string;
  createdAt: string;
  recordCount: number;
  lastVersion: { version: number; validRows: number; rejectedRows: number; createdAt: string } | null;
};
export type MailingVersion = { id: string; version: number; totalRows: number; validRows: number; rejectedRows: number; createdAt: string };
export type MailingDetail = { id: string; name: string; createdAt: string; recordCount: number; versions: MailingVersion[]; columns: string[] };
export type MailingRecord = {
  id: string;
  rowNumber: number;
  contactId: string;
  externalId: string;
  name: string | null;
  fields: Record<string, unknown>;
  blocked: boolean;
};

export type ImportPreview = {
  delimiter: string;
  headers: string[];
  totalRows: number;
  suggestedMapping: ColumnMapping[];
  rows: { rowNumber: number; values: Record<string, string>; errors: string[] }[];
  validRows: number;
  rejectedRows: number;
  schemaErrors: string[];
};
export type ImportResult = { mailingId: string; versionId: string; validRows: number; rejectedRows: number };

export type ListVersionInfo = { id: string; version: number; membershipMode: 'SNAPSHOT' | 'DYNAMIC'; memberCount: number; publishedAt: string };
export type ListSummary = { id: string; name: string; mailing: { id: string; name: string }; latestVersion: ListVersionInfo | null };
export type ListDetail = ListSummary & {
  versions: (ListVersionInfo & { filters: ListFilter[]; sort: { field: string; dir: 'asc' | 'desc' }[] })[];
};
export type ListPreview = {
  selected: number;
  excluded: { reason: ReasonCode; count: number }[];
  sample: { contactId: string; externalId: string; name: string | null; fields: Record<string, unknown> }[];
  fields: { key: string; type: string }[];
};
export type ListPublishResult = { listId: string; listVersionId: string; version: number; memberCount: number };
export type ListMember = { contactId: string; externalId: string; name: string | null; fields: Record<string, unknown> };

export type Tabulation = {
  id: string;
  code: string;
  name: string;
  isCpc: boolean;
  isConversion: boolean;
  isOptOut: boolean;
  invalidatesDestination: boolean;
  channelTypes: ChannelType[];
};
export type Simulation = {
  outcomes: Record<string, number>;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  duplicateRate: number;
  noReturnRate: number;
};
export type Connection = {
  id: string;
  name: string;
  channelType: ChannelType;
  provider: string;
  tariff: number | null;
  tariffUpdatedAt: string | null;
  active: boolean;
  simulation?: Simulation | null;
};
export type JourneyStepView = JourneyStep & { connectionName?: string };
export type Journey = { id: string; name: string; latestVersion: { id: string; version: number; steps: JourneyStepView[] } | null };
export type StrategyVersion = { id: string; version: number; config: StrategyConfig; publishedAt: string };
export type Strategy = { id: string; name: string; protected: boolean; latestVersion: StrategyVersion | null };
export type StrategyDetail = Strategy & { versions: StrategyVersion[] };

export type DraftEnvelope = { data: CampaignDraft; revision: number; updatedAt: string } | null;

export type Preflight = {
  audience: { type: 'MAILING' | 'LIST'; name: string; count: number };
  journey: { name: string; steps: JourneyStepView[] };
  strategy: { name: string; version: number; summary: string | string[] | Record<string, unknown> };
  nextWindow: string | null;
  costEstimate: { value: number | null; premise: string };
  warnings: string[];
};

export type OperationalState = 'WAITING_RELEASE' | 'WAITING_WINDOW' | 'WAITING_RETURNS' | 'PROCESSING' | 'BASE_PROCESSED' | 'IDLE';
export type CampaignSummary = {
  id: string;
  name: string;
  status: CampaignStatus;
  statusLabel: string;
  operationalState: OperationalState;
  operationalExplanation: string;
  audience: { type: 'MAILING' | 'LIST'; name: string };
  journeyName: string;
  strategyName: string;
  strategyVersion: number;
  createdAt: string;
  startedAt: string | null;
  progress: { members: number; finished: number; active: number };
};
export type CampaignDetail = CampaignSummary & {
  description: string | null;
  mailing: { id: string; name: string };
  listVersion: { id: string; version: number; membershipMode: 'SNAPSHOT' | 'DYNAMIC' } | null;
  journey: { id: string; version: number; steps: JourneyStepView[] };
  strategy: { id: string; version: number; config: StrategyConfig };
  scheduledAt: string | null;
};
export type Campaign = CampaignDetail;

export type AttemptRow = {
  id: string;
  contact: { id: string; externalId: string; name: string | null };
  channelType: ChannelType;
  connectionName: string;
  destinationMasked: string;
  stage: number;
  state: AttemptState;
  stateLabel: string;
  tabulation: { code: string; name: string } | null;
  createdAt: string;
  sentAt: string | null;
  finalizedAt: string | null;
  nextAction: string;
  campaign?: { id: string; name: string };
};
export type EligibilityRow = {
  enrollmentId: string;
  contact: { id: string; externalId: string; name: string | null };
  enrollmentState: EnrollmentState;
  stage: number;
  channelType: ChannelType | null;
  destinationMasked: string | null;
  eligible: boolean;
  primaryReason: ReasonCode | null;
  reasons: ReasonCode[];
  counters: { total: number | null; today: number; totalLimit: number; dailyLimit: number };
  nextEligibleAt: string | null;
  strategyVersion: number;
};
export type Eligibility = {
  evaluatedAt: string;
  cards: { members: number; eligibleNow: number; reserved: number; pending: number; reconciliation: number; finished: number };
  reasons: { reason: ReasonCode; count: number }[];
  items: EligibilityRow[];
  nextCursor: string | null;
};
export type Indicators = {
  sent: number;
  contactsWorked: number;
  cpcContacts: number;
  cpcRate: number | null;
  conversions: number;
  cost: { known: number; coverage: { withCost: number; total: number }; partial: boolean };
  costPerCpc: number | null;
  costPerConversion: number | null;
  pending: { reserved: number; sent: number; awaitingFeedback: number; reconciliation: number };
  byChannel: { channelType: ChannelType; sent: number; cpc: number; conversions: number }[];
  byTabulation: { code: string; name: string; count: number }[];
};

export type TimelineEvent = {
  id: string | number;
  eventType: string;
  label: string;
  fromState: AttemptState | null;
  toState: AttemptState | null;
  reasonCode: string | null;
  duplicate: boolean;
  occurredAt: string;
  receivedAt: string;
  data: Record<string, unknown>;
};
export type AttemptDetail = {
  attempt: AttemptRow & {
    traceId: string;
    strategyVersionId: string;
    journeyVersionId: string;
    tariffSnapshot: number | null;
    costConfirmed: number | null;
    leaseUntil: string | null;
    feedbackDeadline: string | null;
    providerAttemptId: string | null;
  };
  explanation: { whatHappened: string; why: string; nextAction: string };
  timeline: TimelineEvent[];
};

export type ContactRow = {
  id: string;
  externalId: string;
  name: string | null;
  blocked: boolean;
  destinations: { channelType: ChannelType; count: number }[];
  attempts: { total: number | null; new: number };
  lastTabulation: { code: string; name: string; at: string } | null;
  campaigns: number;
};
export type Destination = {
  id: string;
  channelType: ChannelType;
  addressMasked: string;
  address: string;
  label: string | null;
  priority: number;
  valid: boolean;
  blocked: boolean;
};
export type Block = {
  id: string;
  scope: 'CONTACT' | 'DESTINATION';
  destinationId: string | null;
  reason: string;
  origin: string;
  createdAt: string;
  revokedAt: string | null;
};
export type ContactDetail = {
  contact: {
    id: string;
    externalId: string;
    name: string | null;
    attributes: Record<string, unknown>;
    historyTotal: number | null;
    historyReferenceDate: string | null;
  };
  destinations: Destination[];
  blocks: Block[];
  counters: { historyTotal: number | null; newTotal: number; today: number; byChannel: { channelType: ChannelType; count: number }[] };
  enrollments: { campaign: { id: string; name: string }; state: EnrollmentState; stage: number }[];
  attempts: AttemptRow[];
};

export type Control = { dailyLimit: number | null; totalLimit: number | null; globalSuspension: boolean };
export type AuditRow = {
  id: string | number;
  at: string;
  user: { name: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
};
