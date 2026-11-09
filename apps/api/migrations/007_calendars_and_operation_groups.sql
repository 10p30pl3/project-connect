-- Configuração persistente de calendários e agrupamento operacional das tabulações.
ALTER TABLE tabulations
  ADD COLUMN IF NOT EXISTS operation_purpose text NOT NULL DEFAULT 'COBRANCA';

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS calendar_id uuid;

CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  windows jsonb NOT NULL DEFAULT '[{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}]'::jsonb,
  holiday_policy text NOT NULL DEFAULT 'BLOCK',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);
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
DO $$ BEGIN
  ALTER TABLE campaigns ADD CONSTRAINT campaigns_calendar_id_fkey
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
