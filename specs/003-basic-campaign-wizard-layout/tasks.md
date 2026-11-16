---

description: "Actionable, dependency-ordered tasks for implementing the simplified Basic mode campaign wizard and adapted Option B two-column layout"
---

# Tasks: Assistente de Campanha Simplificado no Modo Básico e Layout Reorganizado

**Input**: Design documents from `/specs/003-basic-campaign-wizard-layout/`  
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/data-model.md), [contracts/](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/contracts/)

**Organization**: Tasks are grouped by user story (`US1`, `US2`, `US3`) to enable independent implementation and testing of each increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story mapping (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Infrastructure & Baseline)

**Purpose**: Prepare workspace baseline and verify schema/contract tooling before applying changes.

- [X] T001 Verify clean TypeScript and API baseline build with `npm run typecheck` in package root `/Users/macm/Library/Mobile Documents/com~apple~CloudDocs/Documents/code/project-connect/package.json`
- [X] T002 Create incremental PostgreSQL migration adding nullable `voice_agent_id text` column on `campaigns` in `apps/api/migrations/019_campaign_voice_agent.sql`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core contract, database persistence, gateway override, and RBAC/workspace isolation primitives required before UI and story workflows.

**⚠️ CRITICAL**: Complete this phase before implementing frontend wizard flows (`US1`–`US3`).

- [X] T003 [P] Add optional `voiceAgentId: z.string().min(1).max(120).nullable().optional()` to `CreateCampaignSchema` in `packages/shared/src/index.ts`
- [X] T004 [P] Add `voiceAgentId?: string | null` to `CampaignSummary` / `CampaignDetail` and export tenant/agent option types in `apps/web/src/lib/types.ts`
- [X] T005 [P] Add `voiceAgentId` support to mock campaign creation and campaign responses in `apps/web/src/lib/mock-backend.ts`
- [X] T006 Validate `voiceAgentId` ownership against `workspace_voice_resources` (`resource_type='agent'`, rejecting cross-workspace usage with HTTP 403), persist `voice_agent_id`, audit `voiceAgentId`, and return `voiceAgentId` in campaign DTOs in `apps/api/src/modules/campaigns.ts`
- [X] T007 Update `voiceAppAdapter.send` to read `cam.voice_agent_id AS campaign_voice_agent_id` and prioritize it as `VoiceCallRequest.tenantId` without modifying `connections.config` (avoiding stale embedded `agentVersion` when `campaign_voice_agent_id !== connection.id`) in `apps/api/src/connectors/voice-app.ts`

**Checkpoint**: Backend accepts, isolates, persists, and dispatches per-campaign `voiceAgentId`, while defaulting cleanly when `voiceAgentId` is `null`.

---

## Phase 3: User Story 1 - Criação Rápida de Campanha no Modo Básico em 3 Etapas e Acesso a Canais (Priority: P1) 🎯 MVP

**Goal**: Enable Basic mode users to configure channels in `Configuração → Canais`, complete campaign creation in 3 steps (`Mailing` → `Acionamento` → `Resumo` without filters), select a campaign-specific active agent and active channel from `/canais`, and publish with name, description, and schedule.

**Independent Test**: Activate Modo Básico, confirm `Canais` appears under `Configuração`, open `/campanhas/nova`, confirm 3-step stepper (`Mailing`, `Acionamento`, `Resumo`), pick a mailing and go straight to `Acionamento`, pick an active agent, active channel, and calendar, fill `Nome`, `Descrição`, and schedule in `Resumo`, and verify the created campaign persists 100% mailing audience, single-step journey, default simple strategy, and chosen `voiceAgentId`.

### Tests for User Story 1

- [X] T008 [P] [US1] Create integration and unit test suite covering `POST /campaigns` with `voiceAgentId`, cross-workspace HTTP 403 rejection, default fallback when `null`, and `voiceAppAdapter.send` `tenantId` override isolation in `apps/api/test/campaign-basic-agent.test.ts`

### Implementation for User Story 1

- [X] T009 [P] [US1] Update sidebar menu item `{ to: '/canais', label: 'Canais' }` from `minMode: 'advanced'` to `minMode: 'basic'` in `apps/web/src/components/Layout.tsx`
- [X] T010 [P] [US1] Update Basic mode metadata description in `EXPERIENCE_MODE_META.basic` to include `Canais` in `apps/web/src/lib/experience-mode.tsx`
- [X] T011 [US1] Align `/campaign-draft` envelope/payload handling to canonical `DraftEnvelope` (`{ data, revision, updatedAt }` / `{ data, revision }`) and add `selectedConnectionId`, `voiceAgentId`, `voiceAgentName` to local `Extra` state in `apps/web/src/pages/NewCampaign.tsx`
- [X] T012 [US1] Adapt `NewCampaignPage` stepper and `MailingStep` navigation for Basic mode (`3` steps: `Mailing`, `Acionamento`, `Resumo`; omit `Público (filtro)`; enforce `audienceMode: 'ALL'` and `listVersionId: null` on Basic advance) in `apps/web/src/pages/NewCampaign.tsx`
- [X] T013 [US1] Implement `ensureSimpleChannelJourney` helper and invisible compatible simple-strategy auto-resolution so selecting an active connection from `/canais` resolves a single-step journey (reusing existing 1-step match or creating via `POST /journeys`) in `apps/web/src/pages/NewCampaign.tsx`
- [X] T014 [US1] Implement Basic mode `ActivationStep` showing only `1. Agente` (listing active workspace agents via `GET /telephony/tenants` plus embedded connection agent if applicable, pre-selecting bound channel agent, graceful non-voice indicator), `2. Canal simples` (listing active connections from `GET /connections` with `/canais` link), and `3. Calendário` (active `GET /calendars`) in `apps/web/src/pages/NewCampaign.tsx`
- [X] T015 [US1] Implement Basic mode `ReviewStep` showing only `Identificação` (`Nome`, `Descrição`) and `Agendamento` (`Iniciar imediatamente` / `Agendar data futura`) while hiding Pillars cards, Voice Preflight, Trunk/Multiplier Dialer, and `Salvar como modelo`, sending `voiceAgentId` cleanly on `POST /campaigns` in `apps/web/src/pages/NewCampaign.tsx`

**Checkpoint**: User Story 1 delivers the full end-to-end 3-step Basic campaign wizard and `/canais` Basic mode access.

---

## Phase 4: User Story 2 - Preservação Completa no Modo Avançado e Layout em Duas Colunas (Opção B Adaptada) (Priority: P2)

**Goal**: Reorganize all wizard steps in both Basic and Advanced modes into the adapted Option B two-column layout (stacked primary blocks on the left + sticky right-hand column detailing the selected/focused option in real time + `(?)` tooltips replacing inline descriptive paragraphs) while keeping 100% of Advanced features intact.

**Independent Test**: In both Basic and Advanced modes, inspect all wizard steps at desktop (`>= lg`) and mobile (`< lg`) widths; verify stacked cards on the left with tooltip-only guidance (`?`), sticky right-hand inspector updating live as selections change (`Agente`, `Canal`, `Calendário`, `Jornada`, `Estratégia`, `Agendamento`, `Troncos`), and 100% presence/functionality of Advanced controls.

### Implementation for User Story 2

- [X] T016 [US2] Create two-column layout wrapper and interactive right-hand detail inspector (`Detalhamento da seleção` sticky column with section quick-switch pills and responsive mobile stacking) inside `apps/web/src/pages/NewCampaign.tsx`
- [X] T017 [US2] Wire live right-column detail views for `MailingStep` (mailing record counts/origin) and `AudienceStep` (Advanced filter preview, snapshot vs dynamic semantics, exclusion summary) in `apps/web/src/pages/NewCampaign.tsx`
- [X] T018 [US2] Wire live right-column detail views and stacked `Agente por campanha` + Advanced controls (`Jornadas Simples/Multicanal`, `Estratégias Simples/Completas + Regras`, `Calendário`) in `ActivationStep` in `apps/web/src/pages/NewCampaign.tsx`
- [X] T019 [US2] Wire live right-column detail views in `ReviewStep` for both Basic mode (consolidated campaign summary: Mailing 100%, Agente, Canal simples, Calendário, Agendamento) and Advanced mode (Pillars, Voice Preflight, Manager-only Trunks & Dialer Multiplier, `Salvar como modelo`) in `apps/web/src/pages/NewCampaign.tsx`
- [X] T020 [US2] Audit and migrate remaining inline explanatory paragraphs/subtitles inside wizard cards/steps to `tooltip="..."` / `<InfoTooltip />` (Constitution Principle IV) and fix `VoiceReadinessCard` connection detection (`c.provider === 'VOICE_APP' || c.channelType === 'VOICE'`) in `apps/web/src/pages/NewCampaign.tsx`
- [X] T021 [P] [US2] Display `voiceAgentId` badge/info on campaign detail header/summary card when a campaign uses a dedicated campaign agent override in `apps/web/src/pages/CampaignDetail.tsx`

**Checkpoint**: User Story 2 completes the adapted Option B two-column layout across Basic and Advanced modes with zero loss of Advanced features.

---

## Phase 5: User Story 3 - Alternância Segura de Modo e Consistência de Rascunho (Priority: P3)

**Goal**: Ensure switching `basic ↔ advanced` mid-draft never lands on an invalid/hidden step or discards already-entered campaign selections, and preserve deep links (`?lista=`, `?modeloId=`).

**Independent Test**: Start in Advanced mode, select a mailing and navigate to `AUDIENCE`, switch the header/sidebar toggle to Basic mode, and confirm automatic transition to `ACTIVATION` preserving `mailingId` and all entered fields; switch back to Advanced and verify all fields remain intact.

### Implementation for User Story 3

- [X] T022 [US3] Add reactive mode-switch guard redirecting `step === 'AUDIENCE'` to `'ACTIVATION'` (when `mailingId` exists) or `'MAILING'` when entering Basic mode without resetting `draft` or `extra` fields in `apps/web/src/pages/NewCampaign.tsx`
- [X] T023 [US3] Make `?lista=` and `?modeloId=` deep-link hydration respect active `mode` (routing `?lista=` to `'ACTIVATION'` in Basic mode while preserving `listVersionId` / `templateApplied`) and normalize `step` checks cleanly in `apps/web/src/pages/NewCampaign.tsx`
- [X] T024 [US3] Verify `goStep` validation messages and step navigation never reference `AUDIENCE` or block progression when strategy/journey are auto-resolved in Basic mode in `apps/web/src/pages/NewCampaign.tsx`

**Checkpoint**: Mode switching mid-draft and deep-link initialization work seamlessly across Basic and Advanced modes.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Run full verification gates across contracts, TypeScript, database migration tests, and production bundle builds.

- [X] T025 Regenerate and verify shared JSON contracts (`npm run contracts`) and run full workspace typecheck (`npm run typecheck`) from repository root
- [ ] T026 Run API unit and PostgreSQL integration test suite against `voll_connect_test` (`npm test -w @voll/api`) including `apps/api/test/campaign-basic-agent.test.ts`
- [X] T027 Run full production build (`npm run build`) verifying `@voll/shared`, `@voll/api`, and `@voll/web` compile cleanly with zero errors
- [ ] T028 Run manual/UI validation checks documented in `specs/003-basic-campaign-wizard-layout/quickstart.md` (and verify compliance with Constitution Principles I–VII)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately (`T001`–`T002`).
- **Foundational (Phase 2)**: Depends on Setup (`T002`); `T003`, `T004`, `T005` can run in parallel; `T006` and `T007` depend on `T002` & `T003` — **BLOCKS** backend integration in `US1` and `T008`.
- **User Story 1 (Phase 3 — P1 MVP)**: Depends on Phase 2; `T008`, `T009`, `T010` can run in parallel, followed by sequential updates in `NewCampaign.tsx` (`T011` → `T012` → `T013` → `T014` → `T015`).
- **User Story 2 (Phase 4 — P2)**: Depends on Phase 3 UI baseline in `NewCampaign.tsx` (`T016` → `T017` → `T018` → `T019` → `T020`); `T021` (`CampaignDetail.tsx`) can run in parallel once Phase 2 (`T004`, `T006`) is done.
- **User Story 3 (Phase 5 — P3)**: Depends on Phase 3 (`T012`–`T015`) in `NewCampaign.tsx` (`T022`–`T024`).
- **Polish (Phase 6)**: Depends on Phases 1–5 completion (`T025` → `T026` → `T027` → `T028`).

### Parallel Opportunities

- **Foundational**: `T003` (`packages/shared/src/index.ts`), `T004` (`apps/web/src/lib/types.ts`), and `T005` (`apps/web/src/lib/mock-backend.ts`) modify independent files.
- **US1**: `T008` (`apps/api/test/campaign-basic-agent.test.ts`), `T009` (`apps/web/src/components/Layout.tsx`), and `T010` (`apps/web/src/lib/experience-mode.tsx`) can run in parallel with backend/foundation completion.
- **US2**: `T021` (`apps/web/src/pages/CampaignDetail.tsx`) runs independently in parallel with `NewCampaign.tsx` refactoring (`T016`–`T020`).

---

## Parallel Example: Foundational + User Story 1 Kickoff

```bash
# After T002 migration creation, run parallel contract/type/UI-nav tasks:
Task T003: "Add voiceAgentId to CreateCampaignSchema in packages/shared/src/index.ts"
Task T004: "Update Campaign types in apps/web/src/lib/types.ts"
Task T005: "Support voiceAgentId in apps/web/src/lib/mock-backend.ts"
Task T009: "Expose Canais in Basic mode in apps/web/src/components/Layout.tsx"
Task T010: "Update Basic mode description in apps/web/src/lib/experience-mode.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (`T001`–`T002`) + Phase 2 (`T003`–`T007`).
2. Complete Phase 3 (`T008`–`T015`) to deliver the 3-step Basic campaign wizard, `/canais` access, simple channel single-step journey resolution, and per-campaign agent override.
3. Validate with `npm test -w @voll/api` and manual 3-step wizard test.

### Incremental Delivery

1. Deliver **MVP (`US1`)** → Fast 3-step Basic campaign creation & per-campaign agent backend.
2. Deliver **`US2`** → Adapted Option B two-column layout with dynamic right-hand detail panel across Basic and Advanced modes + tooltip-only UI cleanup.
3. Deliver **`US3`** → Seamless `basic ↔ advanced` mid-draft toggling and deep-link handling.
4. Run **Phase 6** verification gates (`contracts`, `typecheck`, `test`, `build`).
