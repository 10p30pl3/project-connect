# Data Model: Canal WebRTC (Web & WhatsApp Calling)

**Feature**: `004-webrtc-channel-visibility` | **Date**: 2026-11-15

## 1. Enums e Tipos Compartilhados (`packages/shared`)

- **`CHANNEL_TYPES` (Outbound Campaigns/Journeys — inalterado)**:
  - `['VOICE', 'WHATSAPP', 'SMS', 'EMAIL']` (`ChannelType`)
  - Continua governando `journeys`, `campaigns`, `contact_destinations`, `tabulations` e `cpc-plan-engine`.

- **`CONNECTION_CHANNEL_TYPES` (Canais gerenciáveis em `Configuração → Canais`)**:
  - `['VOICE', 'WHATSAPP', 'SMS', 'EMAIL', 'WEBRTC']` (`ConnectionChannelType`)
  - Rótulos (`CONNECTION_CHANNEL_LABEL`): inclui `WEBRTC: 'WebRTC (Web & WhatsApp)'`.

- **`WEBRTC_MODES`**:
  - `['WEB', 'WHATSAPP_CALLING', 'BOTH']` (`WebRtcChannelMode`)

## 2. Entidade `connections` (PostgreSQL + Config JSONB)

A tabela existente `connections` preserva suas colunas atuais:
- `id`: `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id`: `uuid NOT NULL REFERENCES workspaces(id)`
- `name`: `text NOT NULL`
- `channel_type`: `channel_type NOT NULL` (passa a aceitar `'WEBRTC'` após `020_webrtc_channel_enum.sql`)
- `provider`: `text NOT NULL` (`'WEBRTC_NATIVE'` para canais WebRTC)
- `active`: `boolean NOT NULL DEFAULT true`
- `webhook_secret`: `text NOT NULL`
- `tariff`: `numeric` (somente leitura para não-SuperAdmin)
- `config`: `jsonb NOT NULL DEFAULT '{}'`

### Estrutura de `connections.config` para `channel_type = 'WEBRTC'`

```ts
{
  tenantId?: string;              // ID do Agente de Voz IA (workspace_voice_resources)
  webrtcMode: 'WEB' | 'WHATSAPP_CALLING' | 'BOTH';
  publicWidgetKey: string;        // Ex: "wrtc_..." (único por canal; gerado automaticamente)
  allowedOrigins: string[];       // Lista opcional de origens CORS/widget (vazio = qualquer origem HTTPS/localhost ou controlado pelo site)
  whatsappPhoneNumberId?: string; // Meta Phone Number ID para WhatsApp Business Calling
  whatsappBusinessAccountId?: string; // Opcional (WABA ID)
  whatsappVerifyToken?: string;   // Token para verificação GET do webhook Meta (auto-gerado se omitido)
  whatsappAppSecret?: string;     // Segredo Meta para validar HMAC X-Hub-Signature-256 (mascarado no GET)
  whatsappAccessToken?: string;   // Bearer token Graph API para responder SDP accept/terminate (mascarado no GET)
}
```

### Regras de Validação e Mascaramento
- `publicWidgetKey`: gerado automaticamente em `POST /connections` quando `channelType === 'WEBRTC'` (ou em backfill se ausente), imutável exceto por rotação explícita opcional.
- `allowedOrigins`: array de strings normalizadas (`trim()`, removendo barra final `/`).
- Segredos (`whatsappAppSecret`, `whatsappAccessToken`, `whatsappVerifyToken`):
  - Nunca retornados em texto claro no DTO de listagem/edição (`GET /connections`, `PATCH /connections/:id`, `POST /connections`): retornam sinalizadores booleanos (`hasWhatsappAccessToken`, `hasWhatsappAppSecret`) e versão mascarada (`••••1234` ou `'***'`), mantendo `whatsappVerifyToken` legível apenas quando o administrador precisa copiá-lo para colar no painel da Meta (ou botão "Copiar token de verificação").
  - Se `PATCH /connections/:id` receber campo ausente ou igual ao valor mascarado (`'***'`), mantém o segredo já salvo no banco.
- `tenantId`: validado contra `workspace_voice_resources WHERE resource_type='agent' AND resource_id=$1`; rejeita com HTTP `403` caso pertença a outro `workspace_id`.

## 3. Tabela de Correlação de Sessões WhatsApp Calling (`whatsapp_calling_sessions`)

Para correlacionar eventos assíncronos da Meta (`whatsapp_call_id`) com sessões ativas no gateway (`gateway_call_id`), suportar `terminate` bidirecional e garantir idempotência de webhooks:

- `whatsapp_call_id`: `text PRIMARY KEY`
- `workspace_id`: `uuid NOT NULL REFERENCES workspaces(id)`
- `connection_id`: `uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE`
- `gateway_call_id`: `text NOT NULL`
- `caller_phone`: `text`
- `status`: `text NOT NULL DEFAULT 'CONNECTING'` (`'CONNECTING' | 'ACTIVE' | 'ENDED' | 'FAILED'`)
- `created_at`: `timestamptz NOT NULL DEFAULT now()`
- `ended_at`: `timestamptz`

### Transições de Estado (`whatsapp_calling_sessions`)
1. Webhook `event = 'connect'` (novo `whatsapp_call_id`) → cria linha `CONNECTING` → obtém `sdpAnswer` do gateway → envia `accept` para Meta Graph API → atualiza para `ACTIVE` (ou `ENDED`/`FAILED` se falhar).
2. Reentrega duplicada de webhook `event = 'connect'` para mesmo `whatsapp_call_id` já em `CONNECTING`/`ACTIVE`/`ENDED` → retorna `{ accepted: true, duplicate: true }` sem criar nova chamada.
3. Webhook `event = 'terminate'` → se sessão ainda `CONNECTING` ou `ACTIVE`, encerra no gateway (`DELETE /v1/webrtc/:gatewayCallId`) e marca `ENDED`.
4. Encerramento originado pelo gateway/agente (callback ou duração máxima) → envia `action: 'terminate'` à Graph API da Meta e marca `ENDED`.

## 4. Migrações SQL Incrementais

- **`apps/api/migrations/020_webrtc_channel_enum.sql`**:
  - `ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'WEBRTC';`
- **`apps/api/migrations/021_webrtc_channel_seed.sql`**:
  - Cria tabela `whatsapp_calling_sessions` (e índice por `connection_id`, `gateway_call_id`).
  - Backfill idempotente em `connections`: para cada workspace existente que ainda não possua registro com `channel_type = 'WEBRTC'`, insere `'Canal WebRTC · Web & WhatsApp Calling'` (`channel_type = 'WEBRTC'`, `provider = 'WEBRTC_NATIVE'`, `active = true`, `webrtcMode = 'BOTH'`, `publicWidgetKey` único, e `tenantId` preenchido com o primeiro agente ativo do workspace em `workspace_voice_resources` quando existir).
