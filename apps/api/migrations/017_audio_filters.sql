-- 017_audio_filters.sql
-- Persistência dos controles avançados de filtros de áudio e DSP por workspace.

CREATE TABLE IF NOT EXISTS workspace_audio_filters (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
