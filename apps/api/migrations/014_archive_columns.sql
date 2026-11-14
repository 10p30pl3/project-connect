-- Voll Plan — Migração 014: Metadados de arquivamento em campanhas e mailings

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS previous_status campaign_status;

ALTER TABLE mailings
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text;

CREATE INDEX IF NOT EXISTS campaigns_workspace_status_idx
  ON campaigns (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS mailings_workspace_archived_idx
  ON mailings (workspace_id, archived_at, created_at DESC);
