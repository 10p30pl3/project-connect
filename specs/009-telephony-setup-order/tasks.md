---

description: "Task list for Ordem Guiada de Configuração de Telefonia e OpenAI Live API"
---

# Tasks: Ordem Guiada de Configuração de Telefonia (009-telephony-setup-order)

**Input**: Design documents from `/specs/009-telephony-setup-order/`  
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/009-telephony-setup-order/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/009-telephony-setup-order/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/009-telephony-setup-order/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/009-telephony-setup-order/data-model.md), [setup-status.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/009-telephony-setup-order/contracts/setup-status.md)

**Organization**: Tasks are grouped by User Story (`US1`–`US4`) with foundational shared contracts first and polish checks at the end.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to User Story (`US1`, `US2`, `US3`, `US4`)

---

## Phase 1: Setup (Baseline Verification)

**Purpose**: Confirm clean TypeScript and gateway baseline before adding shared contracts and setup guidance.

- [X] T001 Verify baseline contracts, workspace typecheck, and gateway syntax (`npm run contracts && npm run typecheck && npm run check:gateway`) at repository root

---

## Phase 2: Foundational (Shared Contracts, Web Types & Mock Mirror)

**Purpose**: Establish shared Zod schemas, canonical setup order, OpenAI engine model catalog, web types, and mock backend parity before story implementation.

**⚠️ CRITICAL**: Must complete before Phase 3–6 work.

- [X] T002 Define `TELEPHONY_SETUP_ORDER` (`'trunk' | 'agent' | 'channel' | 'routes' | 'extension' | 'test'`), `TelephonySetupStepIdSchema`, `TelephonySetupStepSchema`, `TelephonySetupWarningSchema`, `TelephonySetupStatusSchema`, `OPENAI_ENGINE_MODELS`, and `defaultOpenAiModel(engine)` in `packages/shared/src/index.ts`, then run `npm run contracts`
- [X] T003 [P] Export `TelephonySetupStepId`, `TelephonySetupStep`, `TelephonySetupWarning`, and `TelephonySetupStatus` types in `apps/web/src/lib/types.ts`
- [X] T004 [P] Mirror `GET /telephony/setup-status` (calculating `steps`, `nextStepId`, `pendingCount`, `warnings`, `mode`, `partial: false`) in `apps/web/src/lib/mock-backend.ts`

**Checkpoint**: Shared schemas, model catalog, web types, and mock backend ready.

---

## Phase 3: User Story 1 - Saber o que configurar e em que ordem (Priority: P1) 🎯 MVP

**Goal**: Calculate live workspace setup progress via pure backend logic and render a fixed setup checklist panel (`TelephonySetupGuide`) at the top of Telefonia with real-time status, tooltips (`?`), and resolve links.

**Independent Test**: Open Telefonia in an empty workspace → confirm steps appear in canonical order (`Tronco → Agente → Canal → Rotas → Ramal → Teste`), `nextStepId` highlights the first pending/problem step, common admins see trunk `readOnly: true`, Basic mode filters to Agent/Channel/Test, and gateway offline degrades gracefully with `partial: true`.

### Tests for User Story 1

- [X] T005 [P] [US1] Create unit tests for `computeSetupSteps(snapshot, { mode, isSuper })` covering empty workspace, progressive completion, problem detection (offline trunk, invalid engine), read-only trunk for non-Super Admin (`Q1=A`), Basic vs Advanced filtering (`FR-007`), WebRTC-only trunk exemption (`FR-008`), optional extension, incoherence warnings (`FR-005`), and `partial: true` gateway fallback in `apps/api/test/telephony-setup.test.ts`

### Implementation for User Story 1

- [X] T006 [US1] Implement `computeSetupSteps` (pure function), incoherence detectors (`outbound_route_without_trunk`, `inbound_route_agent_missing`, `inbound_route_agent_inactive`, `channel_without_coverage`), and `loadSetupSnapshot(workspaceId)` (parallel DB + short-timeout gateway fetches with fail-open `gatewayReachable: false`) in `apps/api/src/lib/telephony-setup.ts`
- [X] T007 [US1] Expose `GET /telephony/setup-status` (`?mode=basic|advanced`) scoped by `actor(req).workspaceId` with structured log (`workspaceId`, `pendingCount`, `partial`) in `apps/api/src/modules/telephony.ts`
- [X] T008 [US1] Create `TelephonySetupGuide` (fixed checklist card with ordered steps, status badges, `nextStepId` highlight, `pt-BR` `(?)` tooltip reasons, and links respecting `readOnly`) and `SetupIndicator` (`pendingCount` badge linking to `/telefonia`) in `apps/web/src/components/TelephonySetupGuide.tsx`
- [X] T009 [US1] Render `TelephonySetupGuide` at the top of `TelephonyPage` (keeping query synced with `telephony` and `connections` mutations) in `apps/web/src/pages/Telephony.tsx`

**Checkpoint**: User Story 1 delivers full ordered visibility and next-step guidance independently (MVP).

---

## Phase 4: User Story 2 - Avisar sobre Configurações Incoerentes sem Bloqueio (Priority: P2)

**Goal**: Surface non-blocking dependency warnings (`Q3=A`) with quick shortcuts inside Route and Channel forms/cards when referenced trunks, agents, or inbound coverages are missing/inactive.

**Independent Test**: In a workspace with no active trunk, open "Nova Rota de Saída" and verify a warning `Alert` + shortcut appears while Save remains enabled; verify a `VOICE` channel with no `tenantId` and no matching inbound route displays `channel_without_coverage` notice with quick action.

- [X] T010 [P] [US2] Add non-blocking `Alert tone="warn"` dependency notices (`outbound_route_without_trunk` when creating/editing Outbound Routes with zero active/online trunks, and inactive/missing agent notice in Inbound Routes) without disabling Save in `apps/web/src/pages/telephony/SettingsTabs.tsx`
- [X] T011 [P] [US2] Display `channel_without_coverage` warning indicator with quick shortcut (define default agent or open Routes) for `VOICE`/`WEBRTC` channels lacking both `tenantId` and matching inbound route in `apps/web/src/pages/Channels.tsx` and `apps/web/src/components/ChannelFormModal.tsx`

**Checkpoint**: Incoherent configurations are visibly flagged before failed calls, without blocking saves.

---

## Phase 5: User Story 3 - Navegação das Telas na Ordem de Configuração (Priority: P3)

**Goal**: Order Advanced Telefonia tabs following the canonical sequence (`Troncos SIP & Provedores → Rotas → Ramais SIP → Gravações → Provedor IA & Custos → Motores DSP`) and place `SetupIndicator` on Canais and Agentes de Voz.

**Independent Test**: In Advanced mode, open `/telefonia` and verify tab order matches the setup chain and `?tab=` deep-links work (`?tab=trunks`, `?tab=routes`, `?tab=extensions`); open `/canais` and `/agentes-de-voz` and verify `SetupIndicator` appears when `pendingCount > 0`.

- [X] T012 [US3] Reorder Advanced tabs in `TelephonyPage` (`Troncos SIP & Provedores`, `Rotas`, `Ramais SIP (1000–1010)`, `Gravações`, `Provedor IA & Custos` / `Chaves de IA (BYOK)`, `Motores DSP & 14 Features`), keep Basic mode showing `Gravações`, and support `?tab=` deep-linking in `apps/web/src/pages/Telephony.tsx`
- [X] T013 [P] [US3] Render `<SetupIndicator />` in the `PageHeader` actions of `ChannelsPage` (`apps/web/src/pages/Channels.tsx`) and `VoiceAgentsPage` (`apps/web/src/pages/VoiceAgents.tsx`) when `pendingCount > 0`

**Checkpoint**: Navigation reinforces the setup sequence across Telefonia, Canais, and Agentes de Voz.

---

## Phase 6: User Story 4 - Catálogo e Seleção do Modelo OpenAI Live API no Agente de Voz (Priority: P3)

**Goal**: Verify official OpenAI Live API vs Realtime API model IDs, centralize per-engine model options in `@voll/shared`, ensure gateway passes the agent's selected `openaiModel` cleanly, and wire `TenantsTab` to the shared catalog preserving legacy values.

**Independent Test**: Edit a Voice Agent, select `OpenAI Live API` → verify only Live model options appear and engine defaults apply; switch to `OpenAI Realtime` → verify Realtime model list replaces Live list; save and reload → confirm persistence without affecting existing agents.

- [X] T014 [US4] Confirm official OpenAI Live API vs Realtime API model IDs in OpenAI docs, finalize `OPENAI_ENGINE_MODELS` in `packages/shared/src/index.ts`, and verify `apps/voice-gateway/index.js` + `apps/voice-gateway/utils/tenant-manager.js` forward the agent's configured `openaiModel` without falling back over an explicit `openai_live` selection
- [X] T015 [US4] Update `TenantsTab.tsx` (`toForm()`, engine change handler, and `Modelo OpenAI` `<Select>`) to consume `OPENAI_ENGINE_MODELS` and `defaultOpenAiModel(engine)` from `@voll/shared` while preserving any legacy saved model ID as a fallback option in `apps/web/src/pages/telephony/TenantsTab.tsx`

**Checkpoint**: OpenAI Live API model selection is cleanly isolated from OpenAI Realtime and persisted end-to-end.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Regenerate contracts, run all static checks, pure unit tests, gateway tests, and production builds.

- [X] T016 Run full verification: `npm run contracts && npm run typecheck && npm run check:gateway && npm run test:arch && npm test -w @voll/voice-gateway && npm test -w @voll/api -- test/telephony-setup.test.ts && npm run build`
- [ ] T017 Validate quickstart scenarios in `specs/009-telephony-setup-order/quickstart.md` and audit Constitution Principles I–VII compliance (pt-BR copy, tooltips only, fail-open, multi-workspace isolation) — _Pendente validação visual em ambiente com servidor ativo_

---

## Dependencies & Execution Order

- **Phase 1 (`T001`)** → **Phase 2 (`T002`, then `T003` & `T004` in parallel)** → Stories (`US1`, `US2`, `US3`, `US4`) → **Phase 7 (`T016`–`T017`)**.
- **User Story Dependencies**:
  - **US1 (P1 MVP)** depends on Phase 2 (`T002`–`T004`).
  - **US2 (P2)** depends on `T007` (`GET /telephony/setup-status` `warnings` payload) and `T004` (mock parity).
  - **US3 (P3)** depends on `T008` (`SetupIndicator`) for `T013`, while `T012` (tab ordering in `Telephony.tsx`) can run anytime after/with `T009`.
  - **US4 (P3)** is independent after `T002` (`OPENAI_ENGINE_MODELS` in `packages/shared`).

## Parallel Example

```bash
# After T002 completes:
Task T003: "Export setup types in apps/web/src/lib/types.ts"
Task T004: "Mirror GET /telephony/setup-status in apps/web/src/lib/mock-backend.ts"
Task T005: "Create pure unit tests in apps/api/test/telephony-setup.test.ts"
Task T014: "Verify OpenAI Live/Realtime model IDs & gateway forwarding"
```

## Implementation Strategy

- **MVP First**: Complete Phase 1 + Phase 2 + Phase 3 (`T001`–`T009`) first and verify `telephony-setup.test.ts` passes cleanly.
- **Incremental Delivery**: Add Phase 4 (`US2` non-blocking form warnings), Phase 5 (`US3` tab ordering + indicators), and Phase 6 (`US4` Live API catalog), then run Phase 7 full verification (`T016`–`T017`).
