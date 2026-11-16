# Implementation Plan: Consolidar Abas de Canais e CRUD Completo (Básico ao Avançado)

**Branch**: `008-consolidate-channels-crud` | **Date**: 2026-11-16 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/008-consolidate-channels-crud/spec.md)  
**Input**: Feature specification from `/specs/008-consolidate-channels-crud/spec.md` (`1C`, `2A`)

## Summary

Consolidar as duas abas atuais de **Canais & Integrações** (`/canais`) — *Conectores & Conexões* e *Configurar Endereços Técnicos* — em uma **visão única**, removendo a aba/painel global redundante (`1C`) e unificando criação, edição, teste de conectividade, habilitação e exclusão de cada canal em um **CRUD completo** com revelação progressiva (`2A`): **Configurações Básicas** sempre visíveis no topo + seção expansível **"Configurações Avançadas & Endereços Técnicos"** (recolhida por padrão no Modo Básico e expandida no Modo Avançado).

## Technical Context

**Language/Version**: TypeScript 5.7 (Node 20+ / React 19)  
**Primary Dependencies**: Fastify 5, Zod, TanStack Query, Radix UI, Lucide React, Tailwind 4  
**Storage**: PostgreSQL 16 (`connections` com `config JSONB`; fallback legado em `workspace_channel_endpoints`)  
**Testing**: Vitest (`@voll/api` unit/integration/arch), TypeScript `tsc --noEmit`, Vite build  
**Target Platform**: Linux Docker (API + Nginx Web)  
**Project Type**: Monorepo npm workspaces (`@voll/shared`, `@voll/api`, `@voll/web`)  
**Performance Goals**: Renderização instantânea da tela única de canais; teste de conectividade com timeout explícito (`2500ms`) para não travar a UI  
**Constraints**: Preservar segredos mascarados em `PATCH /connections/:id`; manter compatibilidade com vínculos de campanhas, jornadas, rotas e mock backend  
**Scale/Scope**: Foco em `packages/shared`, `apps/api/src/modules/catalog.ts`, `apps/web/src/lib/mock-backend.ts`, `apps/web/src/lib/types.ts` e `apps/web/src/pages/Channels.tsx`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Shared Contracts & Explicit Schemas**: **PASS** — `ConnectionCreateSchema`, `ConnectionUpdateSchema`, `ChannelTechnicalOverridesSchema` e `ConnectionTestRequestSchema` serão definidos em `packages/shared/src/index.ts`.
- **II. Idempotent Execution & Explicit Persistence**: **PASS** — `POST/PATCH/DELETE /connections` utilizam transações SQL explícitas (`tx(...)`, `FOR UPDATE`, auditoria e trava de exclusão em tentativas/jornadas).
- **III. Real-Time Voice Performance & Fail-Open Reliability**: **PASS** — Fallbacks legados de `workspace_channel_endpoints` continuam suportados no servidor para não interromper sessões ativas.
- **IV. High-Density UI & Tooltip-Only Guidance**: **PASS** — Toda orientação de campo/seção permanece exclusivamente em tooltips `(?)` em `pt-BR`, sem texto explicativo inline no corpo da tela.
- **V. External API Security & Multi-Tenant Isolation**: **PASS** — Todas as rotas `/connections` exigem autenticação + `workspaceId` scoping + `CAN.admin`; segredos retornam mascarados e nunca são sobrescritos por placeholders.
- **VI. Explicit Call Duration & Concurrency Limits**: **PASS** — Campos de cota simultânea (`maxConcurrent`, `maxConcurrentPerWorkspace`) de voz ficam editáveis diretamente no bloco avançado do canal `VOICE`/`WEBRTC`.
- **VII. End-to-End Transaction Observability**: **PASS** — `audit()` registra criação, atualização, exclusão e campos não-sensíveis alterados; testes de conectividade retornam latência e código HTTP.

**Post-Design Re-Check**: Todos os princípios I–VII permanecem atendidos sem violações ou exceções.

## Project Structure

### Documentation (this feature)

```text
specs/008-consolidate-channels-crud/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── contracts/
    └── channels-crud.md
```

### Source Code (repository root)

```text
packages/shared/src/index.ts              # Schemas de technical overrides, ConnectionCreate/Update e ConnectionTest
apps/api/src/modules/catalog.ts           # PATCH completo (preservando segredos), DTO mascarado, POST /connections/:id/test e /connections/test
apps/api/test/connections-crud.test.ts    # Testes de CRUD completo, preservação de segredos e teste de conectividade por canal
apps/web/src/lib/types.ts                 # Tipo Connection estendido com technical e flags has*
apps/web/src/lib/mock-backend.ts          # Suporte a technical overrides e teste de conectividade no mock
apps/web/src/pages/Channels.tsx           # Remoção de Tabs + TechnicalEndpointsTab; ChannelFormModal unificado (básico + expansível avançado)
```

**Structure Decision**: Reutilização direta da arquitetura monorepo existente (`@voll/shared` → `@voll/api` → `@voll/web`), substituindo os formulários duplicados de criação/edição em `Channels.tsx` por um modal/formulário único reutilizável.

## Complexity Tracking

Nenhuma violação de constituição identificada.
