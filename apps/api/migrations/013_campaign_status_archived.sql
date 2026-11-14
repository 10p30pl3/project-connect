-- Voll Plan — Migração 013: Valor ARCHIVED em campaign_status
-- Executada isoladamente porque PostgreSQL exige commit de novos valores de ENUM antes do uso.

ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'ARCHIVED';
