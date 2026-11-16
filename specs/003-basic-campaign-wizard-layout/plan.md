# Implementation Plan: Assistente de Campanha Simplificado no Modo Básico e Layout Reorganizado

**Branch**: `003-basic-campaign-wizard-layout` | **Date**: 2026-11-15 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/spec.md)  
**Input**: Feature specification from `/specs/003-basic-campaign-wizard-layout/spec.md`

## Summary

Adaptar o fluxo de criação de campanhas (`/campanhas/nova`) ao seletor global de experiência (`basic` vs `advanced`) e reorganizar seu layout visual em estrutura de duas colunas (**Opção B adaptada**: coluna principal à esquerda com blocos empilhados e segunda coluna à direita detalhando em tempo real a opção escolhida, com dicas contextuais em `?`):
- No **Modo Básico**: fluxo linear em **3 etapas** (**1. Mailing** → **2. Acionamento** → **3. Resumo**), omitindo a etapa de filtros (aplicando automaticamente 100% da base elegível), exibindo em **Acionamento** apenas **Agente** (seleção específica para a campanha entre agentes ativos do workspace), **Canal simples** (listando os canais ativos configurados em **Configuração → Canais**, com criação/reuso automático de jornada de etapa única e estratégia simples padrão compatível) e **Calendário**, e em **Resumo** apenas **Nome**, **Descrição** e **Agendamento**.
- Liberação da opção **Configuração → Canais** (`/canais`) no menu lateral também para o **Modo Básico** (`minMode: 'basic'`), além de preservar **100%** dos itens avançados no **Modo Avançado** e garantir alternância segura entre modos sem perda de rascunho.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node.js 20+ ESM em `packages/shared`, `apps/api`, `apps/web`)  
**Primary Dependencies**: React 19, Vite, TanStack Query, Tailwind 4, Lucide icons (`apps/web`); Fastify 5, Zod, `pg` (`apps/api`)  
**Storage**: PostgreSQL 16 (nova migração `019_campaign_voice_agent.sql` adicionando `campaigns.voice_agent_id text`, e JSONB `campaign_drafts.data`)  
**Testing**: Vitest (`npm test -w @voll/api` contra `voll_connect_test`), `npm run typecheck`, `npm run build` (`vite build` + `tsup`), `npm run contracts`  
**Target Platform**: Aplicação Web SPA (`apps/web`) + API/Worker Node.js (`apps/api`) em Docker Compose (`deploy/docker-compose.prod.yml`) integrados ao gateway de voz (`VOICE_APP_BASE_URL`)  
**Project Type**: Web application monorepo (`packages/shared` + `apps/api` + `apps/web`)  
**Performance Goals**: Alternância entre etapas e atualização da coluna de detalhamento instantânea no cliente (`< 50ms`), criação de campanha em `<= 3` interações no Modo Básico (`< 60s`), zero bloqueio de mídia no gateway de voz  
**Constraints**: Conformidade estrita ao **Princípio IV** (zero parágrafos explicativos inline na UI, usando apenas `tooltip="..."` / `<InfoTooltip />` em pt-BR); isolamento multi-tenant de agentes via `workspace_voice_resources` (**Princípio V**); preservação de `connections.config` quando um agente específico é escolhido na campanha (`FR-006`)  
**Scale/Scope**: Assistente `NewCampaign.tsx`, navegação `Layout.tsx`, schemas `@voll/shared`, módulo `campaigns.ts` e conector `voice-app.ts`

## Constitution Check

*GATE: Avaliação pré-design e pós-design contra `.specify/memory/constitution.md` (v1.1.0).*

| Princípio | Verificação Pré-Design | Verificação Pós-Design | Status |
| --- | --- | --- | --- |
| **I. Shared Contracts & Explicit Schemas** | Novo campo `voiceAgentId` e contrato `/campaign-draft` devem estar alinhados em `@voll/shared`. | `CreateCampaignSchema` atualizado com `voiceAgentId` em `packages/shared/src/index.ts`; `NewCampaign.tsx` alinhado a `DraftEnvelope` (`{ data, revision, updatedAt }`) e `SaveDraftSchema`. | PASS |
| **II. Idempotent Execution & Explicit Persistence** | Criação de campanha e rascunho devem permanecer idempotentes e seguros em concorrência. | `POST /campaigns` mantém `idempotency_key` e transação única persistindo `voice_agent_id`; rascunho mantém revisão otimista (`409 Conflict`). | PASS |
| **III. Real-Time Voice Performance & Fail-Open Reliability** | Seleção de agente por campanha não pode adicionar latência ao áudio RTP no gateway. | `voice_agent_id` é resolvido na fila/despacho (`voiceAppAdapter.send` -> `VoiceCallRequest.tenantId`), antes da originação da chamada no gateway. | PASS |
| **IV. High-Density UI & Tooltip-Only Guidance** | Redesenho de layout deve remover textos extensos na superfície das telas e usar tooltips `(?)`. | Todos os cards da coluna esquerda em `NewCampaign.tsx` usam cabeçalhos enxutos e `tooltip="..."` / `<InfoTooltip />`; coluna direita mostra dados estruturados da seleção. | PASS |
| **V. External API Security & Multi-Tenant Isolation** | Usuário não pode vincular agente de voz pertencente a outro workspace em sua campanha. | `POST /campaigns` valida `voiceAgentId` contra `workspace_voice_resources` (`resource_type='agent'`) bloqueando uso cruzado com HTTP `403`. | PASS |
| **VI. Explicit Call Duration & Concurrency Limits** | Limites existentes de duração e canais continuam válidos no Básico e Avançado. | Gateway segue aplicando `maxDurationSec` e `maxConcurrentCalls` do tenant selecionado; modo básico herda troncos ativos e multiplicador `1x` seguros. | PASS |
| **VII. End-to-End Transaction Observability** | Escolha do agente por campanha deve ficar auditável e rastreável. | `campaigns.voice_agent_id` registrado em `audit` (`campaign.create`), exposto em `GET /campaigns/:id` e propagado como `tenantId` em `VoiceCallRequest`. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/003-basic-campaign-wizard-layout/
├── plan.md                                     # Este arquivo
├── research.md                                 # Decisões técnicas e alternativas avaliadas (Phase 0)
├── data-model.md                               # Esquema DB, entidades e transições (Phase 1)
├── quickstart.md                               # Roteiro de validação ponta a ponta (Phase 1)
├── contracts/
│   ├── api-campaign-wizard.md                  # Contratos REST & despacho de voiceAgentId
│   └── ui-campaign-wizard.md                   # Contratos visuais (Modo Básico vs Avançado & 2 colunas)
└── checklists/
    └── requirements.md                         # Checklist de qualidade da especificação (16/16)
```

### Source Code (repository root)

```text
packages/shared/
└── src/index.ts                                # CreateCampaignSchema.voiceAgentId

apps/api/
├── migrations/
│   └── 019_campaign_voice_agent.sql            # Coluna opcional campaigns.voice_agent_id
├── src/
│   ├── connectors/
│   │   └── voice-app.ts                        # Resolve tenantId priorizando campaigns.voice_agent_id
│   └── modules/
│       └── campaigns.ts                        # Valida posse do voiceAgentId, persiste e retorna nos DTOs
└── test/
    └── campaign-basic-agent.test.ts            # Testes de criação com voiceAgentId, isolamento 403 e despacho no voiceAppAdapter

apps/web/
└── src/
    ├── lib/
    │   ├── types.ts                            # voiceAgentId em CampaignSummary / CampaignDetail
    │   ├── experience-mode.tsx                 # Atualiza descrição do Modo Básico incluindo Canais
    │   └── mock-backend.ts                     # Suporte a voiceAgentId no mock para compatibilidade local
    ├── components/
    │   └── Layout.tsx                          # Configuração → Canais (/canais) com minMode: 'basic'
    └── pages/
        ├── NewCampaign.tsx                     # Fluxo 3 vs 4 etapas, Canal simples, Agente por campanha, layout 2 colunas Opção B adaptada e rascunho corrigido
        └── CampaignDetail.tsx                  # Exibição discreta do agente específico vinculado à campanha quando definido
```

**Structure Decision**: Reutiliza a arquitetura existente em monorepo (`@voll/shared`, `@voll/api`, `@voll/web`), isolando mudanças de esquema em uma migração incremental aditiva (`019`) e concentrando a reorganização visual no fluxo do assistente (`NewCampaign.tsx`) e menu (`Layout.tsx`) sem alterar componentes compartilhados de UI além do uso dos primitivos existentes.

## Complexity Tracking

> Nenhuma violação da Constituição identificada; tabela não aplicável.
