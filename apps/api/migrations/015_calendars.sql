-- Migração 015: Calendários de Funcionamento de Campanhas e Feriados/Exceções
-- Define os dias, janelas de horários, fuso horário e política de feriados para o funcionamento das campanhas.

CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  windows jsonb NOT NULL DEFAULT '[{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}]'::jsonb,
  holiday_policy text NOT NULL DEFAULT 'BLOCK',
  active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_calendars_workspace ON calendars(workspace_id, active) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS calendar_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  action text NOT NULL DEFAULT 'BLOCK',
  start_time time,
  end_time time,
  UNIQUE(calendar_id, date, name)
);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES calendars(id) ON DELETE SET NULL;

ALTER TABLE campaign_templates
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES calendars(id) ON DELETE SET NULL;

-- Presets padrão para todos os workspaces existentes
INSERT INTO calendars (workspace_id, name, description, timezone, windows, holiday_policy, active)
SELECT w.id, 'Comercial Brasil', 'Segunda a sexta em horário comercial padrão (08h às 18h).', 'America/Sao_Paulo',
       '[{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}]'::jsonb, 'BLOCK', true
FROM workspaces w ON CONFLICT (workspace_id, name) DO NOTHING;

INSERT INTO calendars (workspace_id, name, description, timezone, windows, holiday_policy, active)
SELECT w.id, 'Horário Estendido (Cobrança)', 'Segunda a sexta (08h–20h) e sábado (08h–14h) dentro da janela legal de cobrança.', 'America/Sao_Paulo',
       '[{"days":[1,2,3,4,5],"start":"08:00","end":"20:00"},{"days":[6],"start":"08:00","end":"14:00"}]'::jsonb, 'BLOCK', true
FROM workspaces w ON CONFLICT (workspace_id, name) DO NOTHING;

INSERT INTO calendars (workspace_id, name, description, timezone, windows, holiday_policy, active)
SELECT w.id, 'Cobrança Conservadora', 'Janela reduzida para operações sensíveis (09h às 17h, seg a sex).', 'America/Sao_Paulo',
       '[{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}]'::jsonb, 'BLOCK', true
FROM workspaces w ON CONFLICT (workspace_id, name) DO NOTHING;

INSERT INTO calendars (workspace_id, name, description, timezone, windows, holiday_policy, active)
SELECT w.id, 'Atendimento 24x7', 'Operação contínua todos os dias da semana, incluindo feriados.', 'America/Sao_Paulo',
       '[{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59"}]'::jsonb, 'ALLOW', true
FROM workspaces w ON CONFLICT (workspace_id, name) DO NOTHING;
