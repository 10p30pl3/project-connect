# API & Gateway Contracts: Canal, Agentes e Rotas

**Feature**: `006-telephony-channel-agent-routes` | **Date**: 2026-11-15

## 1. Rotas de Entrada Unificadas (`GET/POST/PUT/DELETE /api/telephony/routes` & `/api/telephony/routes/simulate`)

- **Payload de Criação/Edição (`InboundRouteUpsertSchema`)**:
  - Aceita `channelType: '*' | 'VOICE' | 'WEBRTC'` (default `'*'`), `connectionId: string` (UUID ou `'*'`), `trunkId`, `didPattern`, `callerPattern`, `originPattern` (default `'*'`), `tenantId`, `priority`, `maxChannels`, `amdMode`, `recordingEnabled`, `crosstalkFilterMode`, `bargeinGraceSec`, `active`.
  - **Segurança multi-tenant (`POST/PUT /telephony/routes`)**: valida que `tenantId`, `connectionId` (quando `!== '*'`), e `trunkId` (quando `!== '*'`) pertencem ao mesmo `workspace_id` (HTTP `403` caso pertença a outro workspace).
- **`POST /api/telephony/routes/simulate`**:
  - Body (`InboundRouteSimulateSchema`): `{ channelType: 'VOICE' | 'WEBRTC', connectionId?, trunkId?, did?, callerId?, origin? }`.
  - Resposta `200`:
    ```json
    {
      "matchedRule": { "id": "r-...", "name": "...", "priority": 10 },
      "resolvedTenantId": "agent-1",
      "source": "inbound_route | channel_default | workspace_default | none",
      "trace": [{ "rule": "r-...", "name": "...", "matched": true, "reason": "casou" }]
    }
    ```
  - Aplica exatamente a mesma função de precedência usada por `POST /public/webrtc/offer`, `POST /webhooks/whatsapp-calling/:connectionId` e chamadas SIP do gateway.

## 2. Resolução em Runtime (SIP, WebRTC e WhatsApp Calling)

- **Função compartilhada na API (`resolveInboundVoiceRouting`)**:
  - Invocada por `POST /api/public/webrtc/offer` (`channelType: 'WEBRTC'`, `connectionId: conn.id`, `origin`, `callerId`) e `POST /api/webhooks/whatsapp-calling/:connectionId` (`channelType: 'WEBRTC'`, `connectionId: conn.id`, `did: conn.config.whatsappPhoneNumberId`, `callerId: ev.from`).
  - Passos:
    1. Consulta as regras de entrada ativas do gateway pertencentes ao workspace (`callGateway` com timeout curto e fail-open caso gateway não responda ou lista vazia).
    2. Avalia em ordem de `priority ASC` usando `channelType`, `connectionId`, `trunkId`, `did`, `callerId`, `origin`.
    3. Se casar e regra trouxer `tenantId` válido no workspace → retorna `{ tenantId, source: 'inbound_route', ruleId, ruleName }`.
    4. Fallback: se `conn.config.tenantId` preenchido → `{ tenantId, source: 'channel_default' }`.
    5. Fallback: primeiro agente ativo do workspace → `{ tenantId, source: 'workspace_default' }`.
    6. Caso nenhum agente exista → retorna `null` (API responde HTTP `422` `no_active_voice_agent`).
- **Gateway (`apps/voice-gateway/utils/route-manager.js`)**:
  - `RouteManager.match` e `RouteManager.simulate` avaliam também `channelType`, `connectionId` e `originPattern` (tratando ausentes/null como `'*'` para compatibilidade SIP).

## 3. Proteção e Mapa de Vínculos de Agentes (`/api/telephony/tenants`)

- **`GET /api/telephony/tenants/:id/usages`**:
  - Retorna `VoiceAgentUsageSummarySchema`: `{ agentId, channels: [...], routes: [...], campaigns: [...], templates: [...], totalReferences }` restrito estritamente ao `workspaceId` do ator (`403` se agente pertencer a outro workspace).
- **`GET /api/telephony/tenants`**:
  - Inclui opcionalmente resumo `usageCount` (ou endpoint em lote `GET /api/telephony/tenants/usages`) para exibição rápida de vínculos na tela `Agentes de Voz`.
- **`DELETE /api/telephony/tenants/:id`**:
  - Antes de remover no gateway, consulta `getVoiceAgentUsages(workspaceId, id)`.
  - Se `totalReferences > 0`, rejeita com HTTP `409 Conflict` e detalhes listando canais, rotas e campanhas vinculados (`error: 'agent_in_use'`, `usages`).

## 4. Visibilidade de Precedência Outbound em Campanhas (`GET /api/telephony/outbound-routes` & `/campaigns`)

- **`voice-app.ts`**: registra nos `metadata` da chamada enviada ao gateway: `agentSource: 'campaign_override' | 'channel_default' | 'workspace_default'` e `trunkSource: 'campaign_override' | 'outbound_route' | 'channel_default'`, garantindo observabilidade ponta a ponta (`Principle VII`).
