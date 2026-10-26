-- Voll Connect — Escalabilidade para Milhões de Registros & Performance Operacional
-- Índices compostos, parciais e trigramas (GIN) para eliminar Full Table Scans em alta volumetria.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Contatos: ordenação paginada por workspace + busca textual ILIKE instantânea via GIN Trigram
CREATE INDEX IF NOT EXISTS contacts_ws_name_ext_idx
  ON contacts (workspace_id, name ASC NULLS LAST, external_id ASC);

CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx
  ON contacts USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contacts_external_id_trgm_idx
  ON contacts USING gin (external_id gin_trgm_ops);

-- 2. Bloqueios (DNC): lookup imediato por destination_id (evita Seq Scan em webhooks e elegibilidade)
CREATE INDEX IF NOT EXISTS blocks_destination_active_idx
  ON blocks (destination_id)
  WHERE revoked_at IS NULL AND destination_id IS NOT NULL;

-- 3. Inscrições (Enrollments): índice por contact_id (essencial para Opt-Out imediato e ficha do contato)
-- e índice para contagem rápida de elegíveis por janela no resumo de campanhas
CREATE INDEX IF NOT EXISTS enrollments_contact_idx
  ON enrollments (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS enrollments_campaign_ready_idx
  ON enrollments (campaign_id, next_eligible_at)
  WHERE state = 'ACTIVE';

-- 4. Tentativas (Attempts): índices para o Worker (feedback_deadline a cada 2s), Overview e Monitor Operacional
CREATE INDEX IF NOT EXISTS attempts_feedback_timeout_idx
  ON attempts (feedback_deadline)
  WHERE state IN ('SENT', 'AWAITING_FEEDBACK');

CREATE INDEX IF NOT EXISTS attempts_ws_created_idx
  ON attempts (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS attempts_ws_state_created_idx
  ON attempts (workspace_id, state, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS attempts_ws_sent_at_idx
  ON attempts (workspace_id, sent_at DESC)
  WHERE sent_at IS NOT NULL;

-- 5. Consumos de Capacidade (Counter Consumptions): lookup por campanha + contato + destino
CREATE INDEX IF NOT EXISTS counter_consumptions_campaign_contact_dest_idx
  ON counter_consumptions (campaign_id, contact_id, destination_id)
  WHERE kind <> 'RELEASED';

CREATE INDEX IF NOT EXISTS counter_consumptions_contact_confirmed_idx
  ON counter_consumptions (contact_id, effective_at DESC)
  WHERE kind = 'CONFIRMED';

-- 6. Membros de Lista (Snapshot): paginação ordenada O(log N) por order_key
CREATE INDEX IF NOT EXISTS list_members_version_order_idx
  ON list_members (list_version_id, order_key ASC);

-- 7. Auditoria e Inbox: paginação por cursor O(log N)
CREATE INDEX IF NOT EXISTS audit_log_org_id_idx
  ON audit_log (organization_id, id DESC);

CREATE INDEX IF NOT EXISTS connector_inbox_attempt_idx
  ON connector_inbox (attempt_id, id DESC)
  WHERE attempt_id IS NOT NULL;
