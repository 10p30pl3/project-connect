-- Voll Connect Next-Gen: Esteira de Inteligência de Contato, Operação Dual (Produção + Laboratório) e Otimização de CPC

CREATE TABLE IF NOT EXISTS cpc_study_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  code text NOT NULL,
  family text NOT NULL, -- H-A | H-G | H-C | H-T | H-L
  title text NOT NULL,
  description text NOT NULL,
  public_evidence text NOT NULL,
  candidate_variables text NOT NULL,
  internal_test text NOT NULL,
  allowed_decision text NOT NULL,
  benchmark_tool text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  production_weight numeric(6,3) NOT NULL DEFAULT 1.000,
  lab_weight numeric(6,3) NOT NULL DEFAULT 1.150,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS mailing_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  mailing_id uuid NOT NULL REFERENCES mailings(id),
  mode text NOT NULL DEFAULT 'PARALLEL_BOTH', -- PARALLEL_BOTH | PRODUCTION | LABORATORY
  purpose_code text NOT NULL DEFAULT 'COBRANCA',
  purpose_prompt text NOT NULL,
  reference_date date NOT NULL DEFAULT current_date,
  lab_sample_pct numeric(5,2) NOT NULL DEFAULT 25.00,
  planned_days_waves int NOT NULL DEFAULT 3,
  completed_waves int NOT NULL DEFAULT 0,
  max_attempts_per_contact int NOT NULL DEFAULT 4,
  max_acceptable_cpc_brl numeric(12,4) NOT NULL DEFAULT 1.8000,
  channel_tariffs jsonb NOT NULL DEFAULT '{}'::jsonb,
  production_list_version_id uuid REFERENCES list_versions(id),
  production_campaign_id uuid REFERENCES campaigns(id),
  lab_campaign_id uuid REFERENCES campaigns(id),
  sample_calc jsonb NOT NULL DEFAULT '{}'::jsonb,
  cohort_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  production_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  lab_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_to_production boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  promoted_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mailing_intelligence_runs_ws_idx ON mailing_intelligence_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mailing_intelligence_runs_mailing_idx ON mailing_intelligence_runs (mailing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_experiment_waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES mailing_intelligence_runs(id) ON DELETE CASCADE,
  wave_number int NOT NULL,
  day_label text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED', -- PLANNED | DISPATCHED | COMPLETED
  sample_size int NOT NULL DEFAULT 0,
  dispatched_count int NOT NULL DEFAULT 0,
  confirmed_cpc_count int NOT NULL DEFAULT 0,
  observed_cpc_rate numeric(6,4) NOT NULL DEFAULT 0,
  observed_cost_per_cpc_brl numeric(12,4) NOT NULL DEFAULT 0,
  production_baseline_cpc_brl numeric(12,4) NOT NULL DEFAULT 0,
  expected_gain_pct numeric(6,2) NOT NULL DEFAULT 0,
  hypotheses_tested jsonb NOT NULL DEFAULT '[]'::jsonb,
  adjustments_applied jsonb NOT NULL DEFAULT '[]'::jsonb,
  executed_at timestamptz,
  UNIQUE (run_id, wave_number)
);

CREATE TABLE IF NOT EXISTS contact_cpc_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES mailing_intelligence_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  mailing_id uuid NOT NULL REFERENCES mailings(id),
  mailing_record_id uuid NOT NULL REFERENCES mailing_records(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  operating_track text NOT NULL DEFAULT 'PRODUCTION', -- PRODUCTION | LABORATORY
  lab_wave_number int,
  priority_rank int NOT NULL DEFAULT 1,
  priority_score int NOT NULL DEFAULT 50,
  decision_status text NOT NULL,
  decision_reason text NOT NULL,
  estimated_cpc_prob numeric(6,4) NOT NULL DEFAULT 0,
  expected_cost_to_cpc_brl numeric(12,4) NOT NULL DEFAULT 0,
  expected_cost_per_cpc_brl numeric(12,4) NOT NULL DEFAULT 0,
  brute_force_cpc_brl numeric(12,4) NOT NULL DEFAULT 0,
  primary_channel text,
  preferred_destination text,
  local_time_window text NOT NULL,
  timezone_iana text NOT NULL DEFAULT 'America/Sao_Paulo',
  age_bracket text NOT NULL DEFAULT 'UNKNOWN',
  ddd text,
  uf text,
  macro_region text,
  city_tier text,
  phone_intent_tier text NOT NULL DEFAULT 'P2_VOZ_COM_WARMUP',
  locator_score int NOT NULL DEFAULT 75,
  dispatched_to_actuator boolean NOT NULL DEFAULT false,
  human_reviewed boolean NOT NULL DEFAULT false,
  human_review_reason text,
  -- Os 8 blocos completos de devolução (§6 do estudo)
  blocks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, contact_id)
);
CREATE INDEX IF NOT EXISTS contact_cpc_plans_run_idx ON contact_cpc_plans (run_id, priority_rank);
CREATE INDEX IF NOT EXISTS contact_cpc_plans_track_idx ON contact_cpc_plans (run_id, operating_track, priority_rank);
