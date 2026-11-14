-- Voll Plan — Migração 012: Índices de performance em attempts e bypass transacional seguro em forbid_mutation

CREATE INDEX IF NOT EXISTS attempts_workspace_created_idx
  ON attempts (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attempts_enrollment_idx
  ON attempts (enrollment_id);

-- Permite que transações administrativas autorizadas (ex: /system/reset) executem
-- SET LOCAL voll.allow_mutation = 'on' sem adquirir AccessExclusiveLock via ALTER TABLE.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('voll.allow_mutation', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'registro somente-inserção (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
