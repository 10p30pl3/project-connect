-- Voll Plan — Migração 008: Reagendamento com Titular (CALLBACK_SCHEDULED) e Caixa Postal (VOICEMAIL)

-- 1. Coluna de compromisso de retorno com data/hora combinada na inscrição
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS scheduled_callback_at timestamptz;

CREATE INDEX IF NOT EXISTS enrollments_scheduled_callback_idx
  ON enrollments (campaign_id, scheduled_callback_at)
  WHERE state = 'ACTIVE' AND scheduled_callback_at IS NOT NULL;

-- 2. Tabulações oficiais de Reagendamento e Caixa Postal para todos os workspaces existentes
INSERT INTO tabulations (workspace_id, code, name, is_cpc, is_conversion, is_opt_out, invalidates_destination, channel_types)
SELECT 
  w.id,
  'CALLBACK_SCHEDULED',
  'Reagendamento solicitado',
  true,
  false,
  false,
  false,
  ARRAY['VOICE']::channel_type[]
FROM workspaces w
ON CONFLICT (workspace_id, code) DO NOTHING;

INSERT INTO tabulations (workspace_id, code, name, is_cpc, is_conversion, is_opt_out, invalidates_destination, channel_types)
SELECT 
  w.id,
  'VOICEMAIL',
  'Caixa postal',
  false,
  false,
  false,
  false,
  ARRAY['VOICE']::channel_type[]
FROM workspaces w
ON CONFLICT (workspace_id, code) DO NOTHING;
