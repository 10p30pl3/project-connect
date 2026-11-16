# Data Model: Consolidar Abas de Canais e CRUD Completo

**Feature**: `008-consolidate-channels-crud`  
**Date**: 2026-11-16

## Entidades e Campos

### 1. Canal (`connections` table + `Connection` DTO)

Armazenada em PostgreSQL na tabela `connections` (sem necessidade de migração destrutiva, pois parâmetros avançados residem em `connections.config JSONB`).

#### Campos Básicos
- `id`: `uuid` (PK)
- `workspaceId`: `uuid` (isolamento multi-tenant)
- `name`: `string` (`1..100`)
- `channelType`: `'VOICE' | 'WEBRTC' | 'WHATSAPP' | 'SMS' | 'EMAIL' | 'RCS'`
- `provider`: `string` (ex.: `'VOICE_APP' | 'WEBRTC_NATIVE' | 'META_CLOUD' | 'API_TRIGGER' | 'SIMULATED' | 'DIRECT_SIP' | 'SMPP' | 'SMTP' | 'RBM'`)
- `active`: `boolean`
- `callerId` (`config.defaultCallerId`): `string | null`
- `tenantId` (`config.tenantId`): `string | null` (agente de voz padrão para `VOICE` e `WEBRTC`)
- `tariff`: `number | null` (visível/editável apenas para Super Admin)

#### Campos Avançados / Técnicos (`config` JSONB)
- Comuns:
  - `endpointUrl`: `string | null` (URL da API / Gateway / Webhook de destino)
  - `authToken`: `string | null` (mascarado na leitura; preservado via `isRealSecret` na atualização)
- `VOICE` (`config.technical.voice`):
  - `voiceAppBaseUrl`: `string` (ou `endpointUrl`)
  - `voiceAppToken`: `string` (mascarado)
  - `webrtcGatewayUrl`: `string`
  - `cdrWebhookUrl`: `string`
  - `maxConcurrent`: `number` (default `30`)
  - `maxConcurrentPerWorkspace`: `number` (default `10`)
- `WEBRTC`:
  - `webrtcMode`: `'WEB' | 'WHATSAPP_CALLING' | 'BOTH'`
  - `publicWidgetKey`: `string` (rotacionável via `rotateWidgetKey`)
  - `allowedOrigins`: `string[]`
  - `webrtcGatewayUrl`, `cdrWebhookUrl` (opcionais em `config.technical.voice`)
  - Campos WhatsApp Calling quando `webrtcMode !== 'WEB'`: `whatsappPhoneNumberId`, `whatsappBusinessAccountId`, `whatsappVerifyToken`, `whatsappAppSecret` (mascarado), `whatsappAccessToken` (mascarado)
- `WHATSAPP` (`config.technical.whatsapp` + campos dedicados):
  - `apiBaseUrl`: `string` (default `'https://graph.facebook.com/v19.0'`)
  - `apiVersion`: `string` (default `'v19.0'`)
  - `whatsappPhoneNumberId`: `string`
  - `whatsappBusinessAccountId`: `string`
  - `webhookUrl`: `string`
  - `whatsappVerifyToken`: `string`
  - `whatsappAppSecret` / `whatsappAccessToken` (mascarados)
- `SMS` (`config.technical.sms`):
  - `smppHost`: `string`
  - `smppPort`: `number`
  - `systemType`: `string`
  - `dlrWebhookUrl`: `string`
  - `defaultSenderId`: `string`
- `EMAIL` (`config.technical.email`):
  - `smtpHost`: `string`
  - `smtpPort`: `number`
  - `smtpSecurity`: `'STARTTLS' | 'SSL' | 'TLS'`
  - `smtpUser`: `string`
  - `smtpPassword`: `string` (mascarado)
  - `fromAddress`: `string`
  - `fromName`: `string`
  - `eventsWebhookUrl`: `string`
- `RCS` (`config.technical.rcs`):
  - `rbmApiUrl`: `string`
  - `agentId`: `string`
  - `webhookUrl`: `string`
- `SIMULATED`:
  - `simulation`: `{ outcomes, minDelaySeconds, maxDelaySeconds, duplicateRate, noReturnRate }`

### 2. Regras de Preservação de Segredos e Validação

- Segredos nunca trafegam em texto plano nas respostas `GET /connections`, `POST /connections`, `PATCH /connections/:id` (retornam flags booleanas `hasAuthToken`, `hasWhatsappAppSecret`, `hasWhatsappAccessToken`, `hasVoiceAppToken`, `hasSmtpPassword` e strings mascaradas como `••••abcd`).
- Em `PATCH /connections/:id`: strings vazias ou com máscara (`••••`, `****`) são ignoradas pela função `isRealSecret`, preservando o valor armazenado; apenas `null` (limpeza explícita) remove o segredo.
- Em `DELETE /connections/:id`: bloqueado com HTTP `409 Conflict` se houver tentativas em `attempts` ou vínculo ativo em `journey_versions`.
