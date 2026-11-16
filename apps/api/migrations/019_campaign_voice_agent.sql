-- Seleção opcional de agente de voz específico por campanha
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS voice_agent_id text;
