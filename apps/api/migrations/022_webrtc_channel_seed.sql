-- 1. Tabela de correlação e idempotência para sessões receptivas de WhatsApp Business Calling
CREATE TABLE IF NOT EXISTS whatsapp_calling_sessions (
  whatsapp_call_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  gateway_call_id text NOT NULL,
  caller_phone text,
  status text NOT NULL DEFAULT 'CONNECTING' CHECK (status IN ('CONNECTING', 'ACTIVE', 'ENDED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS wcs_connection_idx ON whatsapp_calling_sessions (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wcs_gateway_call_idx ON whatsapp_calling_sessions (gateway_call_id);

-- 2. Backfill idempotente do canal WEBRTC padrão em todos os workspaces existentes que ainda não possuem nenhum
INSERT INTO connections (workspace_id, name, channel_type, provider, config, webhook_secret, tariff, tariff_updated_at, active)
SELECT
  w.id,
  'Canal WebRTC · Web & WhatsApp Calling',
  'WEBRTC'::channel_type,
  'WEBRTC_NATIVE',
  jsonb_strip_nulls(
    jsonb_build_object(
      'webrtcMode', 'BOTH',
      'publicWidgetKey', 'wrtc_' || replace(gen_random_uuid()::text, '-', ''),
      'allowedOrigins', '[]'::jsonb,
      'whatsappVerifyToken', 'wtok_' || replace(gen_random_uuid()::text, '-', ''),
      'tenantId', (
        SELECT wvr.resource_id
          FROM workspace_voice_resources wvr
         WHERE wvr.resource_type = 'agent'
           AND (wvr.workspace_id = w.id OR wvr.is_global_default = true)
         ORDER BY (wvr.workspace_id = w.id) DESC, wvr.created_at ASC
         LIMIT 1
      )
    )
  ),
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  NULL,
  NULL,
  true
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1
    FROM connections c
   WHERE c.workspace_id = w.id
     AND c.channel_type = 'WEBRTC'::channel_type
);
