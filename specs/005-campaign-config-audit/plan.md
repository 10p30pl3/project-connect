# Implementation Plan: Edição de Configurações e Histórico de Alterações de Campanha

**Branch**: `005-campaign-config-audit` | **Date**: 2026-11-15 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/005-campaign-config-audit/spec.md)  
**Input**: Feature specification from `/specs/005-campaign-config-audit/spec.md`

## Summary

Permitir a edição de configurações de campanhas existentes (`PATCH /campaigns/:id`) diretamente na tela de detalhes da campanha, garantindo que **toda e qualquer modificação efetiva** seja registrada atomicamente na tabela append-only `audit_log` (`entity = 'campaign'`, `entity_id = campaignId`) com **pessoa** (`user_id` → `users`), **data-hora exata com segundos** (`at`) e **diff estruturado** (`before`, `after`, `changes[]`), além de expor a consulta em `GET /campaigns/:id/history` e uma nova aba **Histórico** em `CampaignDetail.tsx`.

## Technical Context

**Language/Version**: TypeScript 5.x (ESM) em Node.js 20 (`@voll/shared`, `@voll/api`, `@voll/web`)  
**Primary Dependencies**: Fastify 5, Zod (`@voll/shared`), `pg` (PostgreSQL 16), React 19, TanStack Query 5, Lucide Icons, Tailwind CSS 4  
**Storage**: PostgreSQL 16 (tabela existente `campaigns` e tabela imutável `audit_log` com trigger `forbid_mutation()`) + `mock-backend.ts` para modo demo  
**Testing**: `npm run typecheck`, `npm run test:arch -w @voll/api`, `npm test -w @voll/voice-gateway`, `npm run build`, verificação visual no navegador  
**Target Platform**: Linux Docker (`deploy/docker-compose.prod.yml`) + Web SPA  
**Project Type**: Monorepo npm workspaces (`packages/shared`, `apps/api`, `apps/web`)  
**Performance Goals**: Consulta de histórico `< 50 ms` via índice composto em `audit_log`; salvamento transacional único para `UPDATE campaigns` + `INSERT INTO audit_log`  
**Constraints**:  
- Princípio I (Contratos compartilhados): schemas Zod `UpdateCampaignSchema` e `CampaignHistoryItemSchema` em `packages/shared/src/index.ts`.  
- Princípio II (Persistência explícita e atômica): `withTransaction` em PostgreSQL; nunca permitir edição sem registro de auditoria.  
- Princípio IV (UI de alta densidade): sem parágrafos explicativos inline; usar `tooltip` `(?)` quando necessário, tudo em `pt-BR`.  
- Princípio VII (Observabilidade): timestamps com data, hora, minuto e segundo (`fmtFullDateTimeSec`).  
**Scale/Scope**: ~100–5.000 alterações por campanha; paginação/limite padrão de 100 eventos mais recentes na aba Histórico.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Shared Contracts & Explicit Schemas**: PASS — `UpdateCampaignSchema`, `CampaignChangeItem` e `CampaignHistoryItem` definidos em `packages/shared/src/index.ts` e re-exportados em `apps/web/src/lib/types.ts`.
- **II. Idempotent Execution & Explicit Persistence**: PASS — `PATCH /campaigns/:id` usa `withTransaction` (`SELECT ... FOR UPDATE` na campanha) + `audit()` na mesma transação; nenhuma mutação sem histórico.
- **III. Real-Time Voice Performance & Fail-Open Reliability**: PASS — Não interfere no pipeline de áudio em tempo real (`apps/voice-gateway`); alterações de estratégia/calendário passam a valer na próxima reserva da engine.
- **IV. High-Density UI & Tooltip-Only Guidance**: PASS — Modal de edição e aba **Histórico** seguem componentes `Modal`, `Field`, `Card`, `TableWrap`, `Badge` e `tooltip` `(?)` sem textos conceituais inline.
- **V. External API Security & Multi-Tenant Isolation**: PASS — `PATCH /campaigns/:id` protegido por `requireRoles(...CAN.manageData)` e escopo `workspace_id = req.auth.workspaceId`; `GET /campaigns/:id/history` filtrado por `workspace_id`.
- **VI. Explicit Call Duration & Concurrency Limits**: PASS (N/A direto; limites de estratégia continuam respeitados).
- **VII. End-to-End Transaction Observability**: PASS — Cada edição registra `user_id`, `at` (`timestamptz`), `action`, `reason` e diff `before`/`after` em `audit_log` imutável.

## Project Structure

### Documentation (this feature)

```text
specs/005-campaign-config-audit/
├── spec.md              # Especificação funcional (/speckit-specify)
├── plan.md              # Este plano (/speckit-plan)
├── research.md          # Phase 0: decisões de arquitetura e auditoria
├── data-model.md        # Phase 1: entidades, diff e índices
├── quickstart.md        # Phase 1: cenários de validação end-to-end
├── contracts/           # Phase 1: contratos de API e schemas Zod
│   └── campaign-config-audit.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
packages/shared/src/index.ts                   # UpdateCampaignSchema, CampaignHistoryChange, CampaignHistoryItem
apps/api/migrations/017_campaign_history_index.sql  # Índice em audit_log para consultas por campanha
apps/api/src/modules/campaigns.ts              # PATCH /campaigns/:id, GET /campaigns/:id/history, auditoria em ciclo de vida
apps/web/src/lib/types.ts                      # Re-export de tipos de histórico e edição
apps/web/src/lib/mock-backend.ts               # Mock de PATCH /campaigns/:id e GET /campaigns/:id/history
apps/web/src/pages/CampaignDetail.tsx          # Botão/Modal "Editar configurações" + aba "Histórico"
```

**Structure Decision**: Reaproveitar integralmente a tabela imutável `audit_log` e o helper `audit()` existentes em `apps/api/src/lib/audit.ts`, evitando criação de tabela paralela duplicada e garantindo imutabilidade via trigger `forbid_mutation()`.

## Complexity Tracking

Nenhuma violação à Constituição; não há desvios a justificar.
