-- 016_voice_vapi_bland_features.sql
-- Persistência de gravação, AMD pós-ligação, dados estruturados, latência por turno,
-- pool/saúde de Caller ID e runs de Evals pré-publicação.

ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS amd_result TEXT,
  ADD COLUMN IF NOT EXISTS extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS latency_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS caller_id_stats (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL,
  ddd TEXT,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, caller_id)
);

CREATE TABLE IF NOT EXISTS voice_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  agent_version INTEGER NOT NULL DEFAULT 1,
  passed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_eval_runs_conn ON voice_eval_runs(connection_id, created_at DESC);
