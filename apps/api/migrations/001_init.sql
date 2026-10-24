-- Voll Connect MVP — fatia vertical P0
-- Subconjunto do modelo completo (entregaveis/voll_connect_schema.sql) com os mesmos nomes de conceitos.
-- Referências: plano v2.2 §2, §4, §5, §10, §16, §18, §19, §20, §27.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- enums
CREATE TYPE user_role AS ENUM ('ADMIN','MANAGER','SUPERVISOR','OPERATOR','ANALYST');
CREATE TYPE channel_type AS ENUM ('VOICE','WHATSAPP','SMS','EMAIL');
CREATE TYPE membership_mode AS ENUM ('SNAPSHOT','DYNAMIC');
CREATE TYPE campaign_status AS ENUM ('READY','SCHEDULED','RUNNING','PAUSED','CLOSED','COMPLETED');
CREATE TYPE enrollment_state AS ENUM ('ACTIVE','DONE_SUCCESS','DONE_FAIL','CANCELLED');
CREATE TYPE attempt_state AS ENUM ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION','FINALIZED','RELEASED','CANCELLED');
CREATE TYPE consumption_kind AS ENUM ('PROVISIONAL','CONFIRMED','RELEASED');
CREATE TYPE block_scope AS ENUM ('CONTACT','DESTINATION');
CREATE TYPE outbox_status AS ENUM ('PENDING','DONE','FAILED');
CREATE TYPE inbox_status AS ENUM ('RECEIVED','PROCESSED','ORPHAN','ERROR');

-- ---------------------------------------------------------------- tenancy & users
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  -- Controle central (§19): limites institucionais; NULL = usar o template
  institutional_daily_limit int CHECK (institutional_daily_limit > 0),
  institutional_total_limit int CHECK (institutional_total_limit > 0),
  global_suspension boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (institutional_daily_limit IS NULL OR institutional_total_limit IS NULL
         OR institutional_daily_limit <= institutional_total_limit)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- ---------------------------------------------------------------- contacts & destinations
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  external_id text NOT NULL,
  name text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- histórico importado (§5.2): NULL = desconhecido, nunca zero fabricado
  history_total int CHECK (history_total >= 0),
  history_reference_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);

CREATE TABLE contact_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  channel_type channel_type NOT NULL,
  address text NOT NULL,
  label text,
  priority int NOT NULL DEFAULT 1,
  valid boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'IMPORT',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, channel_type, address) -- AC12: sem duplicidade no mesmo canal
);
CREATE INDEX contact_destinations_contact_idx ON contact_destinations (contact_id);

-- DNC e bloqueios (§19.1): cliente inteiro ou destino específico
CREATE TABLE blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  scope block_scope NOT NULL,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  destination_id uuid REFERENCES contact_destinations(id),
  reason text NOT NULL,
  origin text NOT NULL DEFAULT 'MANUAL', -- MANUAL | OPT_OUT | IMPORT
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text,
  CHECK ((scope = 'DESTINATION') = (destination_id IS NOT NULL))
);
CREATE INDEX blocks_active_idx ON blocks (workspace_id, contact_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- mailings
CREATE TABLE mailings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mailing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailing_id uuid NOT NULL REFERENCES mailings(id),
  version int NOT NULL,
  field_mapping jsonb NOT NULL,
  headers jsonb NOT NULL,
  total_rows int NOT NULL,
  valid_rows int NOT NULL,
  rejected_rows int NOT NULL,
  rejected_report jsonb NOT NULL DEFAULT '[]'::jsonb, -- §26.5: linha original, valores e motivos
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailing_id, version)
);

CREATE TABLE mailing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailing_id uuid NOT NULL REFERENCES mailings(id),
  mailing_version_id uuid NOT NULL REFERENCES mailing_versions(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  row_number int NOT NULL,
  business_key text,
  raw_fields jsonb NOT NULL,
  typed_fields jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX mailing_records_mailing_idx ON mailing_records (mailing_id, row_number);
CREATE INDEX mailing_records_contact_idx ON mailing_records (contact_id);

-- ---------------------------------------------------------------- lists (views versionadas sobre mailing, §7)
CREATE TABLE lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  mailing_id uuid NOT NULL REFERENCES mailings(id),
  name text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id),
  version int NOT NULL,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort jsonb NOT NULL DEFAULT '[]'::jsonb,
  membership_mode membership_mode NOT NULL,
  member_count int NOT NULL,
  published_by uuid REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, version)
);

CREATE TABLE list_members ( -- somente fotografia da base
  list_version_id uuid NOT NULL REFERENCES list_versions(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  mailing_record_id uuid NOT NULL REFERENCES mailing_records(id),
  order_key int NOT NULL,
  PRIMARY KEY (list_version_id, contact_id)
);

-- ---------------------------------------------------------------- canais / conexões (§20.1)
CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  channel_type channel_type NOT NULL,
  provider text NOT NULL DEFAULT 'SIMULATED',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_secret text NOT NULL,
  -- custo de referência por tentativa enviada: NULL = desconhecido; 0 = gratuito (CS02)
  tariff numeric(14,4) CHECK (tariff >= 0),
  tariff_updated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- tabulações
CREATE TABLE tabulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  code text NOT NULL,
  name text NOT NULL,
  is_cpc boolean NOT NULL DEFAULT false,
  is_conversion boolean NOT NULL DEFAULT false,
  is_opt_out boolean NOT NULL DEFAULT false,
  invalidates_destination boolean NOT NULL DEFAULT false,
  channel_types channel_type[] NOT NULL DEFAULT ARRAY['VOICE','WHATSAPP','SMS','EMAIL']::channel_type[],
  UNIQUE (workspace_id, code)
);

-- ---------------------------------------------------------------- jornadas e estratégias (versões imutáveis)
CREATE TABLE journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE journey_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id),
  version int NOT NULL,
  -- [{ "channelType": "VOICE", "connectionId": "...", "feedbackTimeoutMinutes": 30 }]
  steps jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, version)
);

CREATE TABLE strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  protected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE strategy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES strategies(id),
  version int NOT NULL,
  config jsonb NOT NULL, -- ver packages/shared StrategyConfig
  published_by uuid REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, version)
);

-- imutabilidade de versões publicadas (§1)
CREATE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'versão publicada é imutável (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER list_versions_immutable BEFORE UPDATE ON list_versions FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER journey_versions_immutable BEFORE UPDATE ON journey_versions FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER strategy_versions_immutable BEFORE UPDATE ON strategy_versions FOR EACH ROW EXECUTE FUNCTION forbid_update();

-- ---------------------------------------------------------------- campanhas
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  status campaign_status NOT NULL DEFAULT 'READY',
  mailing_id uuid NOT NULL REFERENCES mailings(id),
  list_version_id uuid REFERENCES list_versions(id), -- NULL = todos os contatos do mailing
  journey_version_id uuid NOT NULL REFERENCES journey_versions(id),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  scheduled_at timestamptz,
  idempotency_key text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, idempotency_key)
);

-- rascunho do assistente Preparar campanha (§27.6) — concorrência otimista por revision
CREATE TABLE campaign_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  data jsonb NOT NULL,
  revision int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  mailing_record_id uuid REFERENCES mailing_records(id),
  cycle int NOT NULL DEFAULT 1,
  order_key int NOT NULL DEFAULT 0,
  stage int NOT NULL DEFAULT 0,
  destination_cursor int NOT NULL DEFAULT 0,
  state enrollment_state NOT NULL DEFAULT 'ACTIVE',
  next_eligible_at timestamptz NOT NULL DEFAULT now(),
  terminal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id, cycle) -- AC22: reprocessar não duplica inscrição
);
CREATE INDEX enrollments_pick_idx ON enrollments (campaign_id, order_key) WHERE state = 'ACTIVE';

-- ---------------------------------------------------------------- tentativas
CREATE TABLE attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  enrollment_id uuid NOT NULL REFERENCES enrollments(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  destination_id uuid NOT NULL REFERENCES contact_destinations(id),
  destination_address text NOT NULL, -- endereço usado na ocasião (§16.1)
  channel_type channel_type NOT NULL,
  connection_id uuid NOT NULL REFERENCES connections(id),
  stage int NOT NULL,
  state attempt_state NOT NULL DEFAULT 'RESERVED',
  state_reason text,
  reservation_token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_until timestamptz NOT NULL,
  sent_at timestamptz,
  feedback_deadline timestamptz,
  finalized_at timestamptz,
  tabulation_code text,
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  journey_version_id uuid NOT NULL REFERENCES journey_versions(id),
  list_version_id uuid REFERENCES list_versions(id),
  provider_attempt_id text,
  -- fotografia da tarifa (§20.1): NULL = desconhecido
  tariff_snapshot numeric(14,4),
  tariff_captured_at timestamptz,
  cost_confirmed numeric(14,4),
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- AC01 / OP01: uma tentativa ativa por cliente no workspace
CREATE UNIQUE INDEX attempts_one_active_per_contact
  ON attempts (workspace_id, contact_id)
  WHERE state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION');
CREATE UNIQUE INDEX attempts_provider_uq ON attempts (connection_id, provider_attempt_id) WHERE provider_attempt_id IS NOT NULL;
CREATE INDEX attempts_campaign_idx ON attempts (campaign_id, created_at DESC);
CREATE INDEX attempts_state_idx ON attempts (state, lease_until);
CREATE INDEX attempts_contact_idx ON attempts (contact_id, created_at DESC);

-- linha do tempo / ledger de eventos (append-only)
CREATE TABLE attempt_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  attempt_id uuid REFERENCES attempts(id),
  campaign_id uuid REFERENCES campaigns(id),
  contact_id uuid REFERENCES contacts(id),
  event_type text NOT NULL,
  from_state attempt_state,
  to_state attempt_state,
  reason_code text,
  external_event_id text,
  duplicate boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX attempt_events_attempt_idx ON attempt_events (attempt_id, id);
CREATE INDEX attempt_events_campaign_idx ON attempt_events (campaign_id, id DESC);

-- contadores compartilhados (§5): capacidade provisória vs consumo confirmado
CREATE TABLE counter_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  attempt_id uuid NOT NULL REFERENCES attempts(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  channel_type channel_type NOT NULL,
  destination_id uuid NOT NULL REFERENCES contact_destinations(id),
  kind consumption_kind NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id) -- AC08: uma tentativa consome uma vez
);
CREATE INDEX counter_consumptions_contact_idx ON counter_consumptions (workspace_id, contact_id, effective_at) WHERE kind <> 'RELEASED';

-- outbox persistente (§18.2)
CREATE TABLE outbox (
  id bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES attempts(id),
  status outbox_status NOT NULL DEFAULT 'PENDING',
  tries int NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE status = 'PENDING';

-- inbox de webhooks (deduplicação por conexão + id externo, §18.2)
CREATE TABLE connector_inbox (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  connection_id uuid NOT NULL REFERENCES connections(id),
  external_event_id text NOT NULL,
  attempt_id uuid REFERENCES attempts(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status inbox_status NOT NULL DEFAULT 'RECEIVED',
  error text,
  duplicate_count int NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (connection_id, external_event_id)
);

-- ---------------------------------------------------------------- conector simulado (provedor fictício)
CREATE TABLE sim_scheduled_events (
  id bigserial PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES connections(id),
  payload jsonb NOT NULL,
  deliver_at timestamptz NOT NULL,
  delivered_at timestamptz,
  tries int NOT NULL DEFAULT 0
);
CREATE INDEX sim_scheduled_events_due_idx ON sim_scheduled_events (deliver_at) WHERE delivered_at IS NULL;

-- ---------------------------------------------------------------- auditoria
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  workspace_id uuid REFERENCES workspaces(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  reason text,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registro somente-inserção (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER attempt_events_append_only BEFORE UPDATE OR DELETE ON attempt_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
