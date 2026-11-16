# API & Gateway Contracts: Canal WebRTC (Web & WhatsApp Calling)

**Feature**: `004-webrtc-channel-visibility` | **Date**: 2026-11-15

## 1. Gerenciamento de Conexões (`GET/POST/PATCH/DELETE /api/connections`)

- **Schemas Compartilhados (`packages/shared`)**:
  - `ConnectionCreateSchema`:
    - `channelType`: `z.enum(['VOICE', 'WHATSAPP', 'SMS', 'EMAIL', 'WEBRTC'])`
    - `provider`: inclui `'WEBRTC_NATIVE'`
    - `tenantId`: `z.string().max(120).nullable().optional()`
    - `webrtcMode`: `z.enum(['WEB', 'WHATSAPP_CALLING', 'BOTH']).optional()`
    - `allowedOrigins`: `z.array(z.string()).optional()`
    - `whatsappPhoneNumberId`: `z.string().nullable().optional()`
    - `whatsappBusinessAccountId`: `z.string().nullable().optional()`
    - `whatsappVerifyToken`: `z.string().nullable().optional()`
    - `whatsappAppSecret`: `z.string().nullable().optional()`
    - `whatsappAccessToken`: `z.string().nullable().optional()`
  - `ConnectionUpdateSchema`: aceita os mesmos campos opcionais (`webrtcMode`, `allowedOrigins`, credenciais Meta, `tenantId`, `active`, `name`, `tariff`).
  - **Segurança & Mascaramento**:
    - Em `POST /connections` com `channelType === 'WEBRTC'`: gera automaticamente `publicWidgetKey` (`wrtc_<hex/base64url>`) e `whatsappVerifyToken` se omitido; valida `tenantId` contra `workspace_voice_resources` (`403` se pertencer a outro workspace).
    - Em `GET /connections`, `POST /connections`, `PATCH /connections/:id`: `whatsappAppSecret` e `whatsappAccessToken` **nunca** retornam em claro (`masked` / flags `hasWhatsappAppSecret`, `hasWhatsappAccessToken`).
    - Em `PATCH /connections/:id`: valores ausentes ou `'***'` preservam o segredo existente no banco.

## 2. Rotas Públicas do Web Voice Widget (por Canal)

Usadas quando o cliente incorpora `<script src="https://<portal>/api/public/webrtc/widget.js" data-widget-key="wrtc_..."></script>` em sites externos:

- `GET /api/public/webrtc/widget.js`
  - Proxy/serve o SDK `voll-voice-widget.js` configurado para usar `/api/public/webrtc/*` e ler `data-widget-key` ou query `?key=`.
  - Headers: `Content-Type: application/javascript; charset=utf-8`, `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`.
- `POST /api/public/webrtc/offer`
  - Schema validado via `PublicWebRtcOfferSchema` (`packages/shared`): `{ publicWidgetKey: string, sdpOffer: string, caller?: string, metadata?: Record<string, unknown> }`
  - Validações:
    1. Rate-limit por IP (ex.: 15 tentativas/min → HTTP `429`).
    2. Busca conexão `WEBRTC` no PostgreSQL via `config->>'publicWidgetKey'`. Rejeita se inexistente (`401`), inativa (`403`), ou `webrtcMode === 'WHATSAPP_CALLING'` (`403`).
    3. Se `allowedOrigins` não estiver vazio, exige que `Origin` (ou origem extraída de `Referer`) esteja na lista (`403` se não autorizada).
    4. Resolve `tenantId = conn.config.tenantId || primeiro_agente_ativo_workspace` (falha `422` se nenhum agente ativo existir no workspace).
  - Resposta `200`: `{ ok: true, callId, sdpAnswer, type: 'answer', iceServers, controlToken }` (repassado do gateway).
- `POST /api/public/webrtc/:callId/ice` e `DELETE /api/public/webrtc/:callId`
  - Autorizados via `x-webrtc-control-token` (ou query/body `controlToken`) repassados ao gateway.

## 3. Webhooks & Controle WhatsApp Business Calling Receptivo

- `GET /api/webhooks/whatsapp-calling/:connectionId`
  - Verificação padrão Meta Webhook (`hub.mode === 'subscribe'`, `hub.verify_token`, `hub.challenge`):
    - Busca conexão `WEBRTC` ativa/configurada por `:connectionId`.
    - Se `hub.verify_token` corresponder a `config.whatsappVerifyToken`, retorna `200` com `text/plain` contendo `hub.challenge`. Caso contrário, HTTP `403`.
- `POST /api/webhooks/whatsapp-calling/:connectionId`
  - Autenticação:
    - Requer assinatura HMAC-SHA256 válida no header `X-Hub-Signature-256` (`sha256=<hex>`) calculada sobre `req.rawBody` usando `config.whatsappAppSecret`. Falha fechada (`401`) se ausente, inválida ou sem segredo configurado (em produção).
  - Validação da conexão e agente:
    - Exige `channel_type = 'WEBRTC'`, `active = true`, `webrtcMode IN ('WHATSAPP_CALLING', 'BOTH')`, e `whatsappPhoneNumberId` + `whatsappAccessToken` configurados.
    - Resolve `tenantId = conn.config.tenantId || primeiro_agente_ativo_workspace`; se nenhum agente de voz ativo existir no workspace, registra falha e encerra graciosamente (HTTP `422` `no_active_voice_agent`) sem acionar `/v1/webrtc/offer`.
  - Processamento de eventos Meta (`entry[].changes[].field === 'calls'`):
    - **`event === 'connect'`**:
      - Idempotência via `whatsapp_calling_sessions (whatsapp_call_id PRIMARY KEY)`. Se já existente, ignora reentrega (`duplicate: true`).
      - Solicita oferta/resposta SDP no gateway (`POST /v1/webrtc/offer` com `sdpOffer` da Meta, `tenantId` do canal e `metadata: { source: 'whatsapp_calling', connectionId, workspaceId, whatsappCallId, from }`).
      - Envia `POST https://graph.facebook.com/v21.0/${phoneNumberId}/calls` (`Authorization: Bearer ${whatsappAccessToken}`) com `{ messaging_product: 'whatsapp', call_id, action: 'accept', session: { sdp_type: 'answer', sdp: sdpAnswer } }` (precedido de `pre_accept` se necessário ou `accept` direto conforme API da Meta).
      - Registra em `whatsapp_calling_sessions` status `'ACTIVE'`. Se Meta retornar erro, encerra sessão no gateway e marca `'FAILED'`.
    - **`event === 'terminate'`**:
      - Localiza `gateway_call_id` em `whatsapp_calling_sessions`, chama `DELETE /v1/webrtc/${gatewayCallId}` no gateway e atualiza status para `'ENDED'`.
  - Resposta HTTP: `200 { accepted: true, processed, duplicates }`.

- **Callback de encerramento Gateway → API (`POST /api/internal/webrtc/:callId/ended`)**:
  - Schema validado via `InternalWebRtcEndedSchema` (`packages/shared`): `{ reason?: string, durationSec?: number, endedBy?: 'agent' | 'caller' | 'timeout' | 'error' }`.
  - Autenticação: o gateway envia `Authorization: Bearer ${process.env.API_AUTH_TOKEN}` para `metadata.endedCallbackUrl`; a API valida o token com `timingSafeEqual` contra `process.env.VOICE_APP_TOKEN || process.env.API_AUTH_TOKEN` (falha fechada HTTP `401` sempre que um segredo estiver configurado ou em `NODE_ENV=production`).
  - Quando chamada de origem `whatsapp_calling` encerra no gateway (ex.: duração máxima `maxDurationSec` ou `hangup` do agente), a API envia `action: 'terminate'` para a Meta Graph API e marca `ENDED` em `whatsapp_calling_sessions`.

## 4. Gateway (`apps/voice-gateway`)

- Preserva `/v1/webrtc/offer`, `/v1/webrtc/token`, `/v1/webrtc/:callId/ice`, `DELETE /v1/webrtc/:callId` e `/voll-voice-widget.js`.
- Ajusta `voll-voice-widget.js` para suportar `data-widget-key` / `?key=` apontando por padrão para `/api/public/webrtc/offer` (com fallback compatível para uso direto autenticado no portal).
- Garante propagação de `metadata.source === 'whatsapp_calling'` na criação da bridge (`direction: 'whatsapp_calling'`) e notificação de fim de sessão caso o gateway encerre primeiro.
