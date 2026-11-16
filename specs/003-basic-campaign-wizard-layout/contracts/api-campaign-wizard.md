# API Contracts: Seleção de Agente por Campanha & Rascunho do Assistente

**Feature**: `003-basic-campaign-wizard-layout` | **Date**: 2026-11-15

## 1. `POST /api/campaigns`

### Acréscimo ao Request Body (`CreateCampaignSchema`)

```json
{
  "name": "Cobrança Novembro",
  "description": "Disparo de aviso",
  "mailingId": "uuid",
  "listVersionId": null,
  "journeyVersionId": "uuid",
  "strategyVersionId": "uuid",
  "calendarId": "uuid",
  "voiceAgentId": "agent-cobranca-v3",
  "startMode": "NOW",
  "scheduledAt": null
}
```

- `voiceAgentId?: string | null` (`max 120`): opcional.
  - Se omitido ou `null`: a campanha herda o agente vinculado à conexão de voz no momento do disparo.
  - Se informado: o servidor valida posse em `workspace_voice_resources` (`resource_type = 'agent' AND resource_id = $voiceAgentId`). Caso o recurso pertença a outro workspace, retorna **HTTP `403`**.
  - Registra `voiceAgentId` no log de auditoria `campaign.create`.

### Resposta (`201 Created` / `200 OK` idempotente e `GET /api/campaigns/:id`)

Inclui os campos adicionais na representação da campanha:

```json
{
  "id": "uuid",
  "name": "Cobrança Novembro",
  "voiceAgentId": "agent-cobranca-v3"
}
```

## 2. Despacho no Gateway de Voz (`voiceAppAdapter.send` → `POST /v1/calls`)

Mantém o JSON Schema oficial (`VoiceCallRequestSchema`), alterando apenas a resolução de `tenantId`:

1. Se `campaign.voice_agent_id` estiver definido (`!= null && != ''`):
   - `VoiceCallRequest.tenantId = campaign.voice_agent_id`.
   - Não altera `connections.config.tenantId` nem outras campanhas.
2. Caso contrário:
   - Mantém resolução atual (`connection.id` quando agente embarcado em sync, ou `connection.config.tenantId || 'default'`).

## 3. Persistência do Rascunho (`GET / PUT / DELETE /api/campaign-draft`)

Contrato canônico único entre `apps/api/src/modules/campaigns.ts` e `apps/web/src/pages/NewCampaign.tsx` (`SaveDraftSchema` / `DraftEnvelope`):

- `GET /api/campaign-draft` → `null` ou `{ "data": CampaignDraft, "revision": number, "updatedAt": string }`
- `PUT /api/campaign-draft` → Request `{ "data": CampaignDraft, "revision": number }`, Response `{ "revision": number, "updatedAt": string }` (ou `409 Conflict` em revisão desatualizada)
- `DELETE /api/campaign-draft` → `204 No Content`

## 4. Endpoints Existentes Reutilizados no Modo Básico

- `GET /api/connections`: lista canais configurados em **Configuração → Canais**; o assistente básico filtra `active === true` para exibir em **Canal simples**.
- `GET /api/telephony/tenants`: lista agentes ativos pertencentes ao workspace para seleção por campanha em **Agente**.
- `GET /api/journeys` e `POST /api/journeys`: busca jornada de etapa única compatível com a conexão selecionada ou cria automaticamente `"Canal · <Nome da Conexão>"` com `steps: [{ channelType, connectionId, feedbackTimeoutMinutes }]`.
- `GET /api/strategies`: resolve automaticamente a estratégia simples ativa padrão para o usuário do Modo Básico.
- `GET /api/calendars`: lista calendários ativos para seleção direta no bloco **Calendário**.
