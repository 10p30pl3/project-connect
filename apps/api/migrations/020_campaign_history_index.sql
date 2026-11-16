-- Índice para consulta rápida do histórico de alterações por campanha
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_entity_at
  ON audit_log (workspace_id, entity, entity_id, at DESC, id DESC);
