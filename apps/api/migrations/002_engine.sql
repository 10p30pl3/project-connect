-- Rotação justa de candidatos: inscrições avaliadas recentemente vão para o fim da fila.
ALTER TABLE enrollments ADD COLUMN last_evaluated_at timestamptz;
CREATE INDEX enrollments_rotation_idx ON enrollments (campaign_id, last_evaluated_at NULLS FIRST, order_key) WHERE state = 'ACTIVE';

-- Materialização: controla se a base estática já foi inscrita.
ALTER TABLE campaigns ADD COLUMN materialized_at timestamptz;
ALTER TABLE campaigns ADD COLUMN close_reason text;

-- Eventos de simulação entregues também guardam o eventId para "repetir último evento".
ALTER TABLE sim_scheduled_events ADD COLUMN provider_attempt_id text;
CREATE INDEX sim_scheduled_events_provider_idx ON sim_scheduled_events (provider_attempt_id);
