-- Migração 007: Modelos de Campanhas (Campaign Templates)
-- Permite salvar jornadas, estratégias e acionamento como modelo reutilizável, sem amarrar mailing ou filtros.

CREATE TABLE IF NOT EXISTS campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  purpose_code TEXT,
  journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL,
  journey_version_id UUID REFERENCES journey_versions(id) ON DELETE SET NULL,
  strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
  strategy_version_id UUID REFERENCES strategy_versions(id) ON DELETE SET NULL,
  start_mode TEXT NOT NULL DEFAULT 'NOW',
  source_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  source_campaign_name TEXT,
  usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_templates_workspace ON campaign_templates(workspace_id, updated_at DESC);
