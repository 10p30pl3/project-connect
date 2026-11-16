-- Configuração de troncos e multiplicador por campanha + rastreabilidade de tronco por tentativa
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS trunk_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dial_multiplier numeric(4,2) NOT NULL DEFAULT 1.00
    CHECK (dial_multiplier >= 0.50 AND dial_multiplier <= 5.00);

ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS trunk_id text;

CREATE INDEX IF NOT EXISTS idx_attempts_active_trunk
  ON attempts (workspace_id, trunk_id, state)
  WHERE state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION');
