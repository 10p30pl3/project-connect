---

description: "Task list for Edição de Configurações e Histórico de Alterações de Campanha"
---

# Tasks: Edição de Configurações e Histórico de Alterações de Campanha

**Input**: Design documents from `/specs/005-campaign-config-audit/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/campaign-config-audit.md`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)

---

## Phase 1: Setup (Database Index)

**Purpose**: Preparar índice de consulta eficiente em `audit_log` mantendo sequência de migrações (`001`..`017`).

- [x] T001 Create migration `apps/api/migrations/020_campaign_history_index.sql` adding `idx_audit_log_workspace_entity_at` on `audit_log (workspace_id, entity, entity_id, at DESC, id DESC)`

---

## Phase 2: Foundational (Shared Contracts & Types)

**Purpose**: Definir schemas Zod e tipos compartilhados antes da implementação de API, mock e UI.

**⚠️ CRITICAL**: Bloqueia todas as user stories.

- [x] T002 Add `UpdateCampaignSchema`, `CampaignHistoryChange`, and `CampaignHistoryItem` to `packages/shared/src/index.ts`
- [x] T003 [P] Re-export `CampaignHistoryChange`, `CampaignHistoryItem`, and `UpdateCampaignInput` in `apps/web/src/lib/types.ts`

**Checkpoint**: Contratos compartilhados prontos e compilando (`npm run typecheck -w @voll/shared`).

---

## Phase 3: User Story 1 - Editar configurações da campanha (Priority: P1) 🎯 MVP

**Goal**: Permitir editar nome, descrição, lista/público, jornada, estratégia, calendário de funcionamento e agendamento de campanhas existentes diretamente na tela de detalhes.

**Independent Test**: Abrir `/campanhas/:id` de uma campanha editável, clicar em **Editar configurações**, alterar calendário e nome, salvar e confirmar que os novos valores aparecem na tela e nos dados da campanha.

- [x] T004 [US1] Implement `PATCH /campaigns/:id` with `UpdateCampaignSchema` validation, `requireRoles(...CAN.manageData)`, workspace scoping, reference validation, and `409` guard for archived/`COMPLETED`/`CANCELLED` campaigns in `apps/api/src/modules/campaigns.ts`
- [x] T005 [P] [US1] Implement `PATCH /campaigns/:id` handler in `apps/web/src/lib/mock-backend.ts` updating campaign fields and rejecting archived/`COMPLETED`/`CANCELLED` campaigns
- [x] T006 [US1] Add **Editar configurações** action button (gated by `can('control.write')` and editable status) and `EditCampaignModal` form (name, description, list, journey, strategy, calendar, scheduledAt, optional reason) in `apps/web/src/pages/CampaignDetail.tsx`

**Checkpoint**: US1 funcional e testável de forma independente.

---

## Phase 4: User Story 2 - Registro automático e atômico no histórico (Priority: P1)

**Goal**: Registrar automaticamente na mesma transação toda modificação efetiva de configuração com pessoa, data-hora exata e diff legível (`before` → `after`), ignorando salvamentos sem alterações.

**Independent Test**: Editar 2 campos de uma campanha e confirmar que exatamente 1 registro é gravado com usuário, timestamp com segundos e apenas os 2 campos alterados; salvar sem mudar nada e confirmar que nenhum novo registro é criado.

- [x] T007 [US2] Implement readable snapshot & field diff builder (`computeCampaignConfigChanges`) resolving `listName`, `journeyName` + version, `strategyName` + version, `calendarName`, `name`, `description`, and `scheduledAt` in `apps/api/src/modules/campaigns.ts`
- [x] T008 [US2] Wrap `UPDATE campaigns` and `audit(tx, actor, 'campaign.updated', 'campaign', id, ...)` inside `withTransaction` in `PATCH /campaigns/:id`, returning `{ campaign, changed: false, changes: [] }` without writing `audit_log` when `changes.length === 0` in `apps/api/src/modules/campaigns.ts`
- [x] T009 [US2] Ensure campaign creation and lifecycle actions (`POST /campaigns`, pause, resume, stop, archive, restore) also record consistent `entity = 'campaign'` entries in `audit_log` in `apps/api/src/modules/campaigns.ts`
- [x] T010 [P] [US2] Record campaign history entries (`CAMPAIGN_HISTORY`) with actor, ISO timestamp, reason, and `changes[]` diff on `POST /campaigns`, `PATCH /campaigns/:id`, and lifecycle actions in `apps/web/src/lib/mock-backend.ts`

**Checkpoint**: US1 e US2 funcionam juntas com auditoria garantida e atômica.

---

## Phase 5: User Story 3 - Aba Histórico na tela da campanha (Priority: P2)

**Goal**: Exibir a aba **Histórico** em `/campanhas/:id` listando em ordem cronológica decrescente quem alterou, quando (data, hora, minuto e segundo) e o que foi modificado.

**Independent Test**: Acessar `/campanhas/:id` → aba **Histórico** e verificar a exibição ordenada (mais recente primeiro) com pessoa, timestamp `dd/mm/aaaa, hh:mm:ss` e diff `valorAnterior → valorNovo`.

- [x] T011 [US3] Implement `GET /campaigns/:id/history` joining `audit_log` with `users` ordered by `at DESC, id DESC` and returning `CampaignHistoryItem[]` in `apps/api/src/modules/campaigns.ts`
- [x] T012 [P] [US3] Implement `GET /campaigns/:id/history` in `apps/web/src/lib/mock-backend.ts`
- [x] T013 [US3] Add **Histórico** tab and `HistoryTab` component in `apps/web/src/pages/CampaignDetail.tsx` displaying `actorName`/`actorEmail`, `fmtFullDateTimeSec(item.at)`, action badge, optional reason, and structured `before → after` field changes

**Checkpoint**: Todas as user stories (US1, US2, US3) completas e integradas.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Garantir conformidade de tipos, arquitetura, build e validação visual dos fluxos de `quickstart.md`.

- [x] T014 Run `npm run typecheck`, `npm run test:arch -w @voll/api`, and `npm run build` across all workspaces
- [x] T015 Verify end-to-end flows from `specs/005-campaign-config-audit/quickstart.md` in browser (`VITE_DEMO_MOCK=true`): edit campaign configs, verify no-op save skips history, inspect **Histórico** tab timestamps and diffs, and verify read-only guard on completed/archived campaigns

---

## Dependencies & Execution Order

- **Phase 1 (T001)** → independent, can run immediately.
- **Phase 2 (T002 → T003)** → blocks Phase 3, 4, 5.
- **Phase 3 (US1: T004, T005, T006)** → depends on Phase 2; `T005` (`mock-backend.ts`) can run in parallel with `T004` (`campaigns.ts`).
- **Phase 4 (US2: T007–T010)** → depends on `T004`/`T005`; `T010` (`mock-backend.ts`) can run in parallel with `T007`–`T009`.
- **Phase 5 (US3: T011–T013)** → depends on Phase 4; `T012` (`mock-backend.ts`) can run in parallel with `T011`.
- **Phase 6 (T014–T015)** → depends on Phases 1–5.

## Implementation Strategy

- **MVP First**: Phase 1 + Phase 2 + Phase 3 (US1) + Phase 4 (US2) garantem edição segura com auditoria atômica.
- **Incremental UI**: Phase 5 (US3) entrega a aba visual **Histórico** diretamente na tela da campanha, seguida da validação final na Phase 6.
