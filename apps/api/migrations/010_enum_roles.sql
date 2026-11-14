-- Voll Plan — Migração 010: Perfis Globais SaaS (Super Admin / Suporte Read-Only)
-- Executada isoladamente porque PostgreSQL exige commit de novos valores de ENUM antes do uso.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN_VIEWER';
