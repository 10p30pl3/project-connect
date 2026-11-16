# Data Model: Arquitetura Telefonia (Canal, Agentes e Rotas)

**Feature**: `006-telephony-channel-agent-routes` | **Date**: 2026-11-15

## 1. Contratos Compartilhados (`packages/shared`)

- **`InboundRouteChannelScope`**: `'*' | 'VOICE' | 'WEBRTC'`
- **`InboundRouteSchema` / `InboundRouteUpsertSchema`**:
  - `id?: string`
  - `name: string` (`min 1, max 80`)
  - `channelType: z.enum(['*', 'VOICE', 'WEBRTC']).default('*')`
  - `connectionId: z.string().default('*')` (UUID do Canal em `connections` ou `'*'`)
  - `trunkId: z.string().default('*')` (ID do tronco SIP no gateway ou `'*'`)
  - `didPattern: z.string().default('*')` (DID / número WhatsApp / identificador alvo)
  - `callerPattern: z.string().default('*')` (Caller ID / número do chamador)
  - `originPattern: z.string().default('*')` (Origem / domínio Web Widget, ex.: `https://loja.*` ou `*`)
  - `tenantId: z.string().min(1)` (Agente IA de destino)
  - `priority: z.number().int().min(1).optional()`
  - `maxChannels: z.number().int().min(1).nullable().optional()`
  - `amdMode?: 'tenant_default' | 'enabled' | 'disabled'`
  - `recordingEnabled?: 'tenant_default' | 'enabled' | 'disabled'`
  - `crosstalkFilterMode?: 'tenant_default' | 'atual' | 'wespeaker' | 'ecapa' | 'none'`
  - `bargeinGraceSec?: number | null`
  - `active: z.boolean().default(true)`
- **`InboundRouteSimulateSchema`**:
  - `channelType: z.enum(['VOICE', 'WEBRTC']).default('VOICE')`
  - `connectionId?: string`
  - `trunkId?: string`
  - `did?: string`
  - `callerId?: string`
  - `origin?: string`
- **`VoiceRoutingSource`**: `'inbound_route' | 'channel_default' | 'workspace_default' | 'campaign_override' | 'outbound_route'`
- **`VoiceAgentUsageSummarySchema`**:
  - `agentId: string`
  - `channels: Array<{ id: string; name: string; channelType: string; active: boolean }>`
  - `routes: Array<{ id: string; name: string; channelType: string; active: boolean }>`
  - `campaigns: Array<{ id: string; name: string; status: string }>`
  - `templates: Array<{ id: string; name: string }>`
  - `totalReferences: number`

## 2. Entidades e Relacionamentos Existentes (Consolidados)

### A. Canal (`connections` — PostgreSQL)
- Papel exclusivo: **Transporte & Ponto de Entrada/Saída**.
- Mantém `id`, `workspace_id`, `name`, `channel_type` (`VOICE | WHATSAPP | SMS | EMAIL | WEBRTC`), `provider`, `active`, credenciais/configurações WebRTC & Meta, e `config.tenantId` (referência opcional para o **Agente padrão** — fallback caso nenhuma **Rota de Entrada** específica ou sobrescrita de **Campanha** prevaleça).
- Validação multi-tenant: `config.tenantId` e `InboundRoute.tenantId` validados contra `workspace_voice_resources` (`403` cross-workspace).

### B. Agente de Voz (`tenant` no Gateway + `workspace_voice_resources`)
- Papel exclusivo: **Persona IA, Voz, Filtros Acústicos, AMD/STT e Limites (`maxDurationSec`, `maxConcurrentCalls`)**.
- Não armazena vínculos rígidos de volta para canais individuais: sua visibilidade de uso (`VoiceAgentUsageSummary`) é derivada dinamicamente consultando `connections`, `routes` e `campaigns` do mesmo `workspace_id`.
- Invariante de integridade referencial: exclusão (`DELETE /telephony/tenants/:id`) bloqueada com HTTP `409 Conflict` enquanto `totalReferences > 0`.

### C. Rotas de Entrada (`routes` no Gateway + ownership `workspace_voice_resources`)
- Governam **SIP (`VOICE`)**, **WebRTC Web Widget (`WEBRTC`)** e **WhatsApp Calling (`WEBRTC`)**.
- Avaliação determinística ordenada por `priority ASC`:
  1. `r.active === true`
  2. `r.channelType === '*' || r.channelType === ctx.channelType`
  3. `r.connectionId === '*' || !r.connectionId || r.connectionId === ctx.connectionId`
  4. `r.trunkId === '*' || !r.trunkId || r.trunkId === ctx.trunkId` (quando SIP)
  5. `matchPattern(r.didPattern, ctx.did)`
  6. `matchPattern(r.callerPattern, ctx.callerId)`
  7. `matchPattern(r.originPattern, ctx.origin)` (relevante em Web Widget)
- Resultado: primeira regra vencedora define `tenantId` (`source = 'inbound_route'`); se nenhuma vencer, fallback para `connection.config.tenantId` (`'channel_default'`), e por último primeiro agente ativo do workspace (`'workspace_default'`).

### D. Rotas de Saída (`outbound-routes` no Gateway + ownership `workspace_voice_resources`)
- Papel exclusivo: **Seleção de Troncos PSTN e normalização de prefixo/DDD** para chamadas ativas (`VOICE`).
- Ordem de precedência na campanha/chamada ativa:
  - **Agente**: `campaign.voice_agent_id` (`campaign_override`) → `connection.config.tenantId` (`channel_default`) → padrão do workspace (`workspace_default`).
  - **Troncos / Rota de Saída**: se `campaign.trunk_ids` não vazio, filtra rotas de saída elegíveis para aqueles troncos (`campaign_override`); senão usa `OutboundRouteManager.matchOutbound({ destination })` (`outbound_route`) → fallback tronco padrão.

## 3. Migração / Compatibilidade Retroativa

- Regras de entrada já salvas em `routes.json` sem `channelType`, `connectionId` ou `originPattern` assumem default `'*'` (retrocompatíveis sem migração destrutiva).
- Como nenhum schema SQL precisa de quebra, contratos de banco existentes (`connections`, `campaigns`, `workspace_voice_resources`, `whatsapp_calling_sessions`) permanecem intactos; toda validação é compatibilizada via schemas em `@voll/shared` e endpoints em `telephony.ts` / `voice-gateway`.
