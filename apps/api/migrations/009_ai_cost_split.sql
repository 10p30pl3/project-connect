-- Voll Plan — Migração 009: custo de IA separado do custo de telefonia (consolidação com o gateway de voz)
-- cost_confirmed continua sendo o custo do canal em BRL (tarifa/fatura); ai_cost_usd guarda o custo do
-- modelo de IA informado pelo gateway, em USD. Os dois nunca são somados.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS ai_cost_usd numeric(14,6) CHECK (ai_cost_usd >= 0);
COMMENT ON COLUMN attempts.ai_cost_usd IS 'Custo de IA da tentativa em USD, informado pelo gateway de voz (ConnectorEvent.aiCostUsd)';
