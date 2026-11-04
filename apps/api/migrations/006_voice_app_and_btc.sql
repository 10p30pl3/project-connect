-- Voll Connect — Migração 006: Voice-App Integration, Concurrency Claims & Best Time to Call (BTC)

-- 1. Endpoints técnicos por workspace (elimina estado global mutável em memória)
CREATE TABLE IF NOT EXISTS workspace_channel_endpoints (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Claim atômico no Outbox (desacopla envio HTTP de locks transacionais longos)
ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claim_lease_until timestamptz;

CREATE INDEX IF NOT EXISTS outbox_claim_pick_idx
  ON outbox (status, available_at, claim_lease_until)
  WHERE status = 'PENDING';

-- 3. Best Time to Call (BTC) materializado diretamente nas inscrições para busca O(log N)
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS btc_start_minute smallint,
  ADD COLUMN IF NOT EXISTS btc_end_minute smallint,
  ADD COLUMN IF NOT EXISTS btc_timezone text,
  ADD COLUMN IF NOT EXISTS btc_source text;

CREATE INDEX IF NOT EXISTS enrollments_btc_pick_idx
  ON enrollments (campaign_id, next_eligible_at, btc_start_minute, btc_end_minute)
  WHERE state = 'ACTIVE';

-- 4. Idempotência por workspace no commit de importação de mailings
ALTER TABLE mailings
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS mailings_ws_idempotency_idx
  ON mailings (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 5. Monitoramento e controle de chamadas em voo por conexão
CREATE INDEX IF NOT EXISTS attempts_conn_inflight_idx
  ON attempts (connection_id, state)
  WHERE state IN ('RESERVED', 'SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION');
