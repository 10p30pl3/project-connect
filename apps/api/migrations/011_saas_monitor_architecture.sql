-- Voll Plan — Migração 011: Arquitetura Multi-Tenant SaaS, Segurança, Idempotência e Billing Particionado

-- 1. Papel global no usuário + metadados de empresa (workspace)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS global_role user_role;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS plan_code text NOT NULL DEFAULT 'GROWTH';

UPDATE workspaces
   SET is_master = true
 WHERE id = (
   SELECT id FROM workspaces
    ORDER BY (lower(name) LIKE '%principal%' OR lower(name) LIKE '%voll%') DESC, created_at ASC
    LIMIT 1
 )
 AND NOT EXISTS (SELECT 1 FROM workspaces WHERE is_master = true);

-- 2. Relação N:N usuário <-> empresas (workspaces) com papel por tenant
CREATE TABLE IF NOT EXISTS user_workspaces (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'OPERATOR',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS user_workspaces_ws_idx ON user_workspaces (workspace_id);

INSERT INTO user_workspaces (user_id, workspace_id, role, is_default)
SELECT u.id,
       w.id,
       u.role,
       (ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY w.is_master DESC, w.created_at ASC) = 1)
  FROM users u
  JOIN workspaces w ON w.organization_id = u.organization_id
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- 3. Sessões autenticadas com expiração por inatividade (8h) e workspace ativo
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '8 hours'),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires_at);

-- 4. Registro de idempotência para mutações financeiras, discagem e provisioning
CREATE TABLE IF NOT EXISTS api_idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  method text NOT NULL,
  route_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status_code int NOT NULL,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (workspace_id, method, route_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS api_idempotency_expires_idx ON api_idempotency_records (expires_at);

-- 5. Posse multi-tenant e troncos globais default do cluster de voz
CREATE TABLE IF NOT EXISTS workspace_voice_resources (
  resource_type text NOT NULL CHECK (resource_type IN ('agent', 'trunk', 'extension', 'route', 'outbound_route')),
  resource_id text NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  is_global_default boolean NOT NULL DEFAULT false,
  owner_mode text NOT NULL DEFAULT 'TENANT_BYOK' CHECK (owner_mode IN ('GLOBAL_DEFAULT', 'TENANT_BYOK')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS wvr_ws_type_idx ON workspace_voice_resources (workspace_id, resource_type);
CREATE INDEX IF NOT EXISTS wvr_global_idx ON workspace_voice_resources (is_global_default, resource_type) WHERE is_global_default = true;

-- 6. Planos comerciais, franquias de minutos e tarifas de billing por workspace
CREATE TABLE IF NOT EXISTS tenant_billing_plans (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'Voll Client Standard',
  monthly_included_minutes int NOT NULL DEFAULT 1000 CHECK (monthly_included_minutes >= 0),
  monthly_platform_fee_brl numeric(12,2) NOT NULL DEFAULT 0,
  voice_rate_per_min_brl numeric(10,4) NOT NULL DEFAULT 0.1400,
  voice_rate_client_per_min_brl numeric(10,4) NOT NULL DEFAULT 0.2500,
  ai_markup_multiplier numeric(6,2) NOT NULL DEFAULT 1.80,
  usd_to_brl_rate numeric(8,4) NOT NULL DEFAULT 5.8000,
  whatsapp_unit_brl numeric(10,4) NOT NULL DEFAULT 0.0800,
  sms_unit_brl numeric(10,4) NOT NULL DEFAULT 0.0650,
  email_unit_brl numeric(10,4) NOT NULL DEFAULT 0.0040,
  amd_unit_brl numeric(10,4) NOT NULL DEFAULT 0.0120,
  billing_cycle_day smallint NOT NULL DEFAULT 1 CHECK (billing_cycle_day BETWEEN 1 AND 28),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenant_billing_plans (workspace_id, plan_name)
SELECT id, CASE WHEN is_master THEN 'Voll Solutions Master' ELSE 'Voll Client Standard' END
  FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- 7. Ledger financeiro e de consumíveis particionado por mês (PostgreSQL native range partitioning)
CREATE TABLE IF NOT EXISTS tenant_billing_ledger (
  id bigserial,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_ref text NOT NULL,
  category text NOT NULL CHECK (category IN ('TELEPHONY_PSTN', 'AI_REALTIME', 'AI_LLM', 'WHATSAPP', 'SMS', 'EMAIL', 'AMD_DSP', 'STORAGE')),
  provider text NOT NULL DEFAULT 'voll',
  direction text,
  duration_seconds int NOT NULL DEFAULT 0,
  units numeric(14,4) NOT NULL DEFAULT 1,
  unit_label text NOT NULL DEFAULT 'un',
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  provider_cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  provider_cost_brl numeric(14,6) NOT NULL DEFAULT 0,
  client_charge_brl numeric(14,6) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at),
  UNIQUE (workspace_id, source_ref, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS tenant_billing_ledger_default
  PARTITION OF tenant_billing_ledger DEFAULT;

CREATE INDEX IF NOT EXISTS tbl_ws_occurred_idx ON tenant_billing_ledger (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS tbl_cat_occurred_idx ON tenant_billing_ledger (category, occurred_at DESC);

DO $$
DECLARE
  m_offset int;
  p_start timestamptz;
  p_end timestamptz;
  p_name text;
BEGIN
  FOR m_offset IN -1..3 LOOP
    p_start := date_trunc('month', now()) + make_interval(months => m_offset);
    p_end := date_trunc('month', now()) + make_interval(months => m_offset + 1);
    p_name := 'tenant_billing_ledger_' || to_char(p_start AT TIME ZONE 'UTC', 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF tenant_billing_ledger FOR VALUES FROM (%L) TO (%L)',
      p_name, p_start, p_end
    );
  END LOOP;
END $$;
