---

description: "Task list for Consolidar Abas de Canais e CRUD Completo (Básico ao Avançado)"
---

# Tasks: Consolidar Abas de Canais e CRUD Completo (Básico ao Avançado)

**Input**: Design documents from `/specs/008-consolidate-channels-crud/`  
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/008-consolidate-channels-crud/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/008-consolidate-channels-crud/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/008-consolidate-channels-crud/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/008-consolidate-channels-crud/data-model.md), [channels-crud.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/008-consolidate-channels-crud/contracts/channels-crud.md)

**Organization**: Tasks are grouped by user story (`US1`, `US2`, `US3`) to enable independent implementation and verification (`1C`, `2A`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to User Story (`US1`, `US2`, `US3`)

---

## Phase 1: Setup (Baseline Verification)

**Purpose**: Confirm clean TypeScript and gateway baseline before modifying shared contracts and channel CRUD.

- [X] T001 Verify baseline typecheck and gateway syntax (`npm run typecheck && npm run check:gateway`) at repository root

---

## Phase 2: Foundational (Shared Contracts, Web Types & Mock Backend)

**Purpose**: Establish shared Zod schemas, web TypeScript types, and mock backend parity before UI/API changes.

**⚠️ CRITICAL**: Must complete before Phase 3/4 UI & API implementation.

- [X] T002 Add `ChannelTechnicalOverridesSchema`, `ConnectionTestRequestSchema`, `ConnectionTestResultSchema`, and extend `ConnectionCreateSchema` / `ConnectionUpdateSchema` (`provider`, `technical`) in `packages/shared/src/index.ts`, then regenerate schemas via `npm run contracts`
- [X] T003 [P] Extend `Connection` and add `ConnectionTestResult` type (`technical`, `hasAuthToken`, `hasVoiceAppToken`, `hasSmtpPassword`) in `apps/web/src/lib/types.ts`
- [X] T004 [P] Mirror `technical` overrides, masked secret preservation on `PATCH /connections/:id`, and `POST /connections/:id/test` + `POST /connections/test` in `apps/web/src/lib/mock-backend.ts`

**Checkpoint**: Shared contracts, web types, and mock backend ready.

---

## Phase 3: User Story 1 - Visão Única de Canais sem Fragmentação em Abas (Priority: P1) 🎯 MVP

**Goal**: Eliminate the two-tab split (*Conectores & Conexões* vs *Configurar Endereços Técnicos*) so `/canais` opens directly into the consolidated channel list.

**Independent Test**: Access `/canais` as Super Admin and workspace Admin; verify there is no `<Tabs>` bar and all channel cards/table actions render directly.

- [X] T005 [US1] Remove `<Tabs>` (*Conectores & Conexões* / *Configurar Endereços Técnicos*) and `TechnicalEndpointsTab` from `ChannelsPage`, rendering the consolidated channel list (Cards + Table) and header actions directly in `apps/web/src/pages/Channels.tsx`

**Checkpoint**: `/canais` is a single unified page with zero tab switching (`1C`).

---

## Phase 4: User Story 2 & User Story 3 - CRUD Completo por Canal e Absorção Técnica (Priority: P1/P2)

**Goal**: Enable full per-channel CRUD (Create, View, Edit Basic + Advanced/Technical, Connectivity Test, Enable/Disable, Delete) in a single progressive-disclosure modal (`2A`), preserving masked secrets and removing global UI redundancy (`1C`).

**Independent Test**: Create a channel with basic + advanced fields, run **Testar Conectividade**, edit only basic fields and verify secrets remain masked, edit protocol technical fields and verify persistence, then delete an unused channel.

- [X] T006 [P] [US2] Create API tests covering `POST /connections`, `PATCH /connections/:id` (basic + `technical` updates + masked secret preservation), `DELETE /connections/:id`, and `POST /connections/:id/test` in `apps/api/test/connections-crud.test.ts`
- [X] T007 [US2] Update `connectionDto`, `POST /connections`, and `PATCH /connections/:id` in `apps/api/src/modules/catalog.ts` to persist `provider`, `endpointUrl`, `callerId`, `authToken` (preserving secrets via `isRealSecret`), and `config.technical` overrides with masked secret flags
- [X] T008 [US3] Implement per-channel connectivity test endpoints `POST /connections/:id/test` and `POST /connections/test` in `apps/api/src/modules/catalog.ts` (validating `VOICE`/`WEBRTC` `/v1/health`, `WHATSAPP`, `SMS`, `EMAIL`, `RCS` with `2500ms` timeout and `workspace_channel_endpoints` fallback)
- [X] T009 [US2] Unify `NewConnectionDialog` and `EditConnection` into a shared `ChannelFormModal` in `apps/web/src/pages/Channels.tsx` with **Configurações Básicas** always visible at top (Nome, Tipo, Provedor, Situação Ativa, BINA, Agente Padrão) and collapsible **"Configurações Avançadas & Endereços Técnicos"** (collapsed by default in Basic mode, expanded by default in Advanced mode per `2A`)
- [X] T010 [US3] Wire protocol-specific technical fields (`VOICE`, `WEBRTC`, `WHATSAPP`, `SMS`, `EMAIL`, `RCS`, `SIMULATED`, Super Admin Tarifação) with masked secret preservation and inline **Testar Conectividade** result feedback inside `ChannelFormModal` in `apps/web/src/pages/Channels.tsx`
- [X] T011 [US2] Clean up residual duplication in `apps/web/src/pages/Channels.tsx` and audit all card/table actions, modal labels, and `pt-BR` tooltips against Constitution Principle IV (no inline explanatory prose)

**Checkpoint**: Full end-to-end basic-to-advanced CRUD + connectivity testing works per channel without leaving `/canais`.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Verify contracts, typecheck, syntax, architecture tests, build, and quickstart flows.

- [X] T012 Run `npm run contracts && npm run typecheck && npm run check:gateway && npm run test:arch && npm test -w @voll/voice-gateway`
- [X] T013 Run full production build (`npm run build`) across `@voll/shared`, `@voll/api`, and `@voll/web`
- [ ] T014 Validate scenarios in `specs/008-consolidate-channels-crud/quickstart.md` (and `@voll/api` `connections-crud.test.ts` where PostgreSQL is available) — _Pendente execução em ambiente com PostgreSQL/UI ativos_

---

## Dependencies & Execution Order

- **Phase 1 (`T001`)** → **Phase 2 (`T002`, then `T003` & `T004` in parallel)** → **Phase 3 (`T005`)** & **Phase 4 (`T006`–`T011`)** → **Phase 5 (`T012`–`T014`)**.
- Backend (`T007`, `T008`) and Frontend (`T005`, `T009`, `T010`, `T011`) can proceed cleanly once `T002` completes.

## Parallel Example

```bash
# After T002 completes:
Task T003: "Extend Connection types in apps/web/src/lib/types.ts"
Task T004: "Update mock-backend.ts for technical overrides & test endpoint"
Task T006: "Create apps/api/test/connections-crud.test.ts"
```
