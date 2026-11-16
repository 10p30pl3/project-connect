-- Adiciona o tipo de canal próprio WEBRTC ao enum channel_type.
-- Isolado em migração própria para respeitar a regra transacional de enum do PostgreSQL no migrate.ts.
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'WEBRTC';
