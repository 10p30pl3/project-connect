# Implementation Plan: Revisão da Arquitetura de Telefonia (Canal, Agentes e Rotas)

**Branch**: `006-telephony-channel-agent-routes` | **Date**: 2026-11-15 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/006-telephony-channel-agent-routes/spec.md)

**Input**: Feature specification from `/specs/006-telephony-channel-agent-routes/spec.md`

## Summary

Consolidar e revisar a arquitetura operacional de telefonia mantendo os três nomes oficiais — **Canais** (transporte e agente padrão opcional), **Agentes de Voz** (inteligência IA reutilizável e limites) e **Rotas** (orquestração unificada de **Entrada** para SIP + WebRTC + WhatsApp Calling e **Saída** para troncos PSTN) — elevando **Rotas** para entrada dedicada `/rotas` no menu `Configuração` (no Modo Avançado), unificando a regra de precedência em runtime (`Rota > Canal > Workspace` no receptivo; `Campanha > Rota/Canal > Workspace` no ativo), expondo mapa de vínculos com bloqueio seguro de exclusão de agentes em uso, e mantendo o Modo Básico focado em **Canais** + **Agentes**.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+ ESM em `packages/shared` e `apps/api`, React 19 + Vite 6 em `apps/web`), JavaScript CommonJS em `apps/voice-gateway`  
**Primary Dependencies**: Fastify 5, Zod, `pg` (PostgreSQL 16), React Router 7, TanStack Query, Lucide React  
**Storage**: PostgreSQL 16 (`connections`, `campaigns`, `campaign_templates`, `workspace_voice_resources`, `whatsapp_calling_sessions`) + JSON stores sincronizados no gateway (`routes.json`, `outbound-routes.json`, `tenants.json`)  
**Testing**: Vitest (`@voll/api`), Node test runner (`@voll/voice-gateway`), `npm run contracts`, `npm run typecheck`, `npm run check:gateway`, `npm run build`  
**Target Platform**: Linux Docker Compose (Ubuntu `194.163.151.91`) + gateway de voz local via túnel reverso  
**Project Type**: Monorepo multi-package (`packages/shared`, `apps/api`, `apps/web`, `apps/voice-gateway`)  
**Performance Goals**: Resolução de precedência de entrada em tempo real sem degradação de latência na sinalização WebRTC/WhatsApp Calling/SIP (`fail-open` para fallback do canal se consulta opcional de rota falhar)  
**Constraints**: Preservar 100% os dados/contratos ativos em produção (`routes.json`, `connections`, `campaigns`); nomenclatura estrita **Canais**, **Agentes**, **Rotas** em `pt-BR` sem termos técnicos como `"Tenant"` na UI; explicações apenas em tooltips `(?)` (Princípio IV); isolamento multi-tenant rigoroso (Princípio V)  
**Scale/Scope**: Múltiplos workspaces, múltiplos canais (`VOICE`, `WEBRTC`) compartilhando N agentes de voz e regras ordenadas de rotas

## Constitution Check

*GATE: Verified before Phase 0 and re-checked post Phase 1 design.*

- **I. Shared Contracts & Explicit Schemas**: **PASS** — `InboundRouteUpsertSchema`, `InboundRouteSimulateSchema`, `VoiceRoutingSource` e `VoiceAgentUsageSummarySchema` definidos em `packages/shared/src/index.ts`.
- **II. Idempotent Execution & Explicit Persistence**: **PASS** — Regras de roteamento e checagem de integridade (`DELETE /telephony/tenants/:id` via SQL + gateway) são determinísticas, idempotentes e retrocompatíveis com `routes.json` legado.
- **III. Real-Time Voice Performance & Fail-Open Reliability**: **PASS** — `RouteManager.match` no gateway permanece síncrono/in-memory; `resolveInboundVoiceRouting` na API usa fallback seguro para `connection.config.tenantId` quando não houver regras ou o gateway estiver inacessível na leitura de rotas.
- **IV. High-Density UI & Tooltip-Only Guidance**: **PASS** — Nova tela `Routes.tsx` e ajustes em `VoiceAgents.tsx`, `Channels.tsx`, `TenantsTab.tsx`, `SettingsTabs.tsx` e `NewCampaign.tsx` removem prosa inline em cartões, eliminam `"Tenant"` visível ao usuário e encapsulam explicações em `tooltip="..."` / `<InfoTooltip />` em `pt-BR`.
- **V. External API Security & Multi-Tenant Isolation**: **PASS** — `POST/PUT /telephony/routes`, `GET /telephony/tenants/:id/usages` e `DELETE /telephony/tenants/:id` validam posse estrita em `workspace_voice_resources`, `connections`, `campaigns`, `campaign_templates` e `routes` do `workspaceId` do ator (`403` cross-workspace).
- **VI. Explicit Call Duration & Concurrency Limits**: **PASS** — Precedência mantém o `maxDurationSec` e `maxConcurrentCalls` do agente selecionado, além de `InboundRoute.maxChannels`.
- **VII. End-to-End Transaction Observability**: **PASS** — Simulador retorna trilha passo a passo (`trace`) + origem (`source`), e metadados de chamadas WebRTC/WhatsApp/outbound registram `agentSource` e `trunkSource`.

## Project Structure

### Documentation (this feature)

```text
specs/006-telephony-channel-agent-routes/
├── spec.md                                   # Especificação (/speckit-specify + clarificações 1A, 2A, 3A)
├── plan.md                                   # Este documento (/speckit-plan)
├── research.md                               # Decisões arquiteturais (Phase 0)
├── data-model.md                             # Entidades, schemas e regras de precedência (Phase 1)
├── quickstart.md                             # Roteiro de validação ponta a ponta (Phase 1)
├── checklists/
│   └── requirements.md                       # Checklist validado (16/16)
└── contracts/
    ├── api-channel-agent-routes.md           # Contratos API/Gateway de Rotas, Usos e Precedência
    └── ui-channel-agent-routes.md            # Contratos UI de Canal, Agentes, Rotas e Modo Básico/Avançado
```

### Source Code (repository root)

```text
packages/shared/src/
└── index.ts                                  # Schemas InboundRouteUpsert, InboundRouteSimulate, VoiceAgentUsageSummary, VoiceRoutingSource

apps/voice-gateway/
├── index.js                                  # Propaga context (channelType, connectionId, origin) ao RouteManager e metadata agentSource/trunkSource
├── utils/
│   ├── route-manager.js                      # Match & Simulate estendidos com channelType ('*'|'VOICE'|'WEBRTC'), connectionId e originPattern
│   └── api-router.js                         # Aceita channelType, connectionId, originPattern em /v1/routes & /v1/routes/simulate
└── test/
    └── route-manager-channels.test.js        # Testes unitários de precedência multicanal e leitura retrocompatível no RouteManager

apps/api/
├── src/
│   ├── connectors/
│   │   └── voice-app.ts                      # Registra agentSource e trunkSource explícitos nos metadata da chamada outbound
│   └── modules/
│       ├── telephony.ts                      # resolveInboundVoiceRouting, getVoiceAgentUsages, bloqueio 409 DELETE tenant, validação cross-workspace em /routes
│       └── whatsapp-calling.ts               # Usa resolveInboundVoiceRouting (Rota > Canal > Workspace) ao atender WhatsApp Calling
└── test/
    └── channel-agent-routes.test.ts          # Testes de integração: precedência SIP/WebRTC/WA, usos de agente, bloqueio 409 e isolamento multi-tenant

apps/web/src/
├── router.tsx                                # Registra rota /rotas (RoutesPage)
├── components/
│   ├── Layout.tsx                            # Adiciona item dedicado "Rotas" (/rotas, minMode: 'advanced') em Configuração ao lado de Canais e Agentes de Voz
│   └── CampaignWizardInspector.tsx           # Exibe origem efetiva (Herdado do Canal/Rota vs Sobrescrito na Campanha)
└── pages/
    ├── Routes.tsx                            # Nova tela unificada Rotas (abas Rotas de Entrada + Simulador multicanal, Rotas de Saída)
    ├── Channels.tsx                          # Vínculo explicitado como "Agente padrão", atalho contextual para /rotas (Avançado)
    ├── VoiceAgents.tsx                       # Remove prosa inline (Princípio IV) e exibe resumo de vínculos ativos
    ├── NewCampaign.tsx                       # Consulta GET /telephony/outbound-routes e indica herança vs sobrescrita + atalho /rotas (Avançado)
    └── telephony/
        ├── TenantsTab.tsx                    # Exibe chips de usos (Canais/Rotas/Campanhas/Modelos) e tratamento claro de bloqueio 409 na exclusão
        ├── SettingsTabs.tsx                  # Atualiza RoutesTab / OutboundRoutesTab para componentes reutilizáveis por Routes.tsx + atalho direto /rotas
        └── types.ts                          # Estende InboundRoute (channelType, connectionId, originPattern) e VoiceAgentUsageSummary
```

**Structure Decision**: Evolução limpa dos módulos existentes do monorepo sem criar novos serviços nem migrações destrutivas no banco, reutilizando o `RouteManager` e `OutboundRouteManager` do `voice-gateway` coordenados pela camada de ownership e precedência da API.

## Complexity Tracking

Nenhuma violação à Constituição detectada; nenhuma exceção necessária.
