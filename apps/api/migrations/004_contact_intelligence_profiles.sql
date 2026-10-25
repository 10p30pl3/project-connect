-- Voll Connect Next-Gen: Base Cumulativa de Inteligência de Contato (Golden Record)
-- Memória histórica e comportamental viva por contato no workspace

CREATE TABLE IF NOT EXISTS contact_intelligence_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  best_time_window text,
  best_hour_utc int,
  best_day_of_week int, -- 0 (domingo) a 6 (sábado)
  preferred_channel channel_type,
  locator_score int NOT NULL DEFAULT 75 CHECK (locator_score BETWEEN 0 AND 100),
  phone_intent_tier text NOT NULL DEFAULT 'P2_HIBRIDO_DIGITAL_VOZ',
  total_attempts_lifetime int NOT NULL DEFAULT 0,
  total_confirmed_cpcs int NOT NULL DEFAULT 0,
  last_cpc_at timestamptz,
  last_cpc_tabulation text,
  quarantined_destinations text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, contact_id)
);

CREATE INDEX IF NOT EXISTS cip_contact_idx ON contact_intelligence_profiles (contact_id);
CREATE INDEX IF NOT EXISTS cip_ws_cpc_idx ON contact_intelligence_profiles (workspace_id, total_confirmed_cpcs DESC);
