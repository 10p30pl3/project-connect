---

description: "Task list for feature 002-campaign-trunk-dialer implementation"
---

# Tasks: Envio de Lista de Campanha Limitado por Troncos de Saída

**Input**: Design documents from `specs/002-campaign-trunk-dialer/`  
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/002-campaign-trunk-dialer/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/002-campaign-trunk-dialer/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/002-campaign-trunk-dialer/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/002-campaign-trunk-dialer/data-model.md), [contracts/](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/002-campaign-trunk-dialer/contracts)

**Organization**: Tasks grouped by user story (`US1`, `US2`, `US3`) for independent implementation and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story mapping (`[US1]`, `[US2]`, `[US3]`; Setup/Foundational/Polish have no story label)

---

## Phase 1: Setup (Contratos Compartilhados & Migração SQL)

**Purpose**: Definir contratos compartilhados no `@voll/shared`, regenerar JSON Schemas e criar a migração do banco PostgreSQL.

- [X] T001 Define `CampaignDialerConfigSchema` (`trunkIds: string[] max(50) default []`, `dialMultiplier: number min(0.5) max(5) default 1`), `TrunkAvailability`, `CampaignDialerStatus`, and extend `CreateCampaignSchema` & `VoiceCallRequestSchema` (`trunkIds?: string[]`) in `packages/shared/src/index.ts`
- [X] T002 Regenerate JSON Schemas (`packages/shared/contracts/voice-call-request.schema.json`) by running `npm run contracts` in repository root (depends on T001)
- [X] T003 [P] Create migration `apps/api/migrations/018_campaign_trunk_dialer.sql` adding `campaigns.trunk_ids text[] NOT NULL DEFAULT '{}'`, `campaigns.dial_multiplier numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (dial_multiplier >= 0.50 AND dial_multiplier <= 5.00)`, `attempts.trunk_id text`, and partial index `idx_attempts_active_trunk ON attempts (workspace_id, trunk_id, state) WHERE state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')`

---

## Phase 2: Foundational (Infraestrutura de Capacidade de Troncos no Gateway & API)

**Purpose**: Instrumentar contagem, seleção e liberação real de canais por tronco no Voice Gateway e construir o resolvedor de disponibilidade multi-tenant no backend da API.

**⚠️ CRITICAL**: Nenhuma User Story pode iniciar antes da conclusão desta fase.

- [X] T004 Implement `selectAvailableTrunk({ trunkIds, patternTrunkId })`, `getAvailability()` (enforcing `direction !== 'inbound'`, `active === true`, `online === true` via cached Sofia status `<= 3s`, `maxChannels >= 1` fallback `1`, `availableChannels = max(0, maxChannels - activeCalls)`), and `maxChannels` default `1` fallback when unspecified in `apps/voice-gateway/utils/trunk-manager.js`
- [X] T005 Update `apps/voice-gateway/utils/outbound-route-manager.js` to allow filtering/matching outbound routes constrained by an optional `trunkIds` allowlist when selecting the outbound gateway
- [X] T006 Expose `GET /v1/trunks/availability`, enrich `GET /v1/trunks` with `activeCalls` & `availableChannels`, validate `trunkIds` allowlist on `POST /v1/calls`, and return HTTP `429` (`{ error: 'trunk_capacity_exceeded', retryAfterSec: 5 }`) when no eligible trunk has free slots in `apps/voice-gateway/utils/api-router.js`
- [X] T007 Instrument `originateOutboundCall` in `apps/voice-gateway/index.js` to select the eligible outbound trunk, call `trunkManager.tryAcquire(selectedTrunkId)`, inject header `X-Trunk-ID` into `fsPool.originateCall`, attach `trunkId` to call metadata/history, and guarantee single `trunkManager.release(selectedTrunkId)` in cleanup/hangup/error paths (depends on T004, T006)
- [X] T008 [P] Create `apps/api/src/engine/trunk-capacity.ts` to query gateway `/v1/trunks/availability` (fallback `/v1/trunks`), intersect with workspace-visible trunks (`workspace_voice_resources` + ownership sync), subtract pre-gateway in-flight reservations (`attempts` in `RESERVED`/`SENT`), and expose `createWorkspaceTrunkBudgetPool()` + `computeCampaignQuota({ trunks, selectedTrunkIds, dialMultiplier, activeOnCampaign })`
- [X] T009 [P] Extend `loadCampaignRuntime` in `apps/api/src/engine/eligibility.ts` to load `campaigns.trunk_ids` (`trunkIds`) and `campaigns.dial_multiplier` (`dialMultiplier`) into runtime context

**Checkpoint**: Gateway controla vagas por tronco em `originateOutboundCall`, e API calcula cota real por workspace/campanha com isolamento multi-tenant.

---

## Phase 3: User Story 1 - Carga da Lista e Envio Inicial Dimensionado pelos Troncos Disponíveis (Priority: P1) 🎯 MVP

**Goal**: Carregar os contatos elegíveis da lista da campanha e enviar ao módulo de discagem (`voiceAppAdapter` -> `/v1/calls`) exatamente a cota suportada pelos troncos disponíveis no momento e pelo multiplicador configurado pelo Gestor.

**Independent Test**: Campanha com lista de 20 contatos elegíveis iniciada quando há 3 vagas de tronco (`1x`) reserva e envia exatamente `3` tentativas mantendo `17` `enrollments` em `ACTIVE`; com `dialMultiplier = 2.0`, envia `6`.

### Implementation for User Story 1

- [X] T010 [US1] Update `runReservations(campaignId, now, trunkPool?)` in `apps/api/src/engine/reserve.ts` so reservation `budget` respects `Math.min(strategyBudget, campaignTrunkQuota)` computed via `apps/api/src/engine/trunk-capacity.ts` (never sending more than eligible trunk slots × `dialMultiplier` nor pending `ACTIVE` queue)
- [X] T011 [US1] Update `voiceAppAdapter.send` in `apps/api/src/connectors/voice-app.ts` to include campaign `trunkIds` in `VoiceCallRequest` payload sent to `POST /v1/calls` (and store allocated `trunk_id` on `attempts` when returned/reported)
- [X] T012 [US1] Update `POST /campaigns` and `SUMMARY_SQL`/`detail` in `apps/api/src/modules/campaigns.ts` to accept/return `trunkIds` (default `[]`) and `dialMultiplier` (default `1`), validate visible trunks for `workspaceId` (`422`), and reject (`403 forbidden_dialer_config`) if non-manager (`OPERATOR`/`SUPERVISOR`/`ANALYST`) submits custom `trunkIds` or `dialMultiplier`
- [X] T013 [P] [US1] Add unit tests in `apps/voice-gateway/test/trunk-dialer.test.js` covering `TrunkManager.getAvailability`, `selectAvailableTrunk` with `trunkIds` allowlist, outbound `tryAcquire`/`release`, and `429 trunk_capacity_exceeded`
- [X] T014 [P] [US1] Add integration test in `apps/api/test/campaign-trunk-dialer.test.ts` validating US1: campaign loads 20-contact list and dispatches exact trunk-limited batch (`3` slots at `1x`, `6` at `2x`) leaving remaining enrollments queued as `ACTIVE`

**Checkpoint**: MVP operacional — carga da lista + envio inicial limitado pela capacidade real dos troncos funciona ponta a ponta com testes passando.

---

## Phase 4: User Story 2 - Reposição Contínua e Pausa Automática Sem Troncos (Priority: P2)

**Goal**: Garantir reposição automática em até 5s sempre que uma chamada encerra e libera vaga, compartilhamento justo de troncos entre campanhas simultâneas, espera segura (0 envios) quando 0 troncos estão disponíveis e recuperação sem perda diante de `429`.

**Independent Test**: Lista de 6 contatos com 2 vagas disponíveis envia `2`; quando `activeCalls = 2` (0 livres), envia `0`; quando 1 chamada termina (`1` livre), envia o próximo contato em `<= 5s`; 2 campanhas simultâneas dividem no máximo o total livre de troncos.

### Implementation for User Story 2

- [X] T015 [US2] Update `tick()` in `apps/api/src/engine/maintenance.ts` to share a per-workspace `WorkspaceTrunkBudgetPool` across all `RUNNING` campaigns in the same tick, deducting newly reserved slots per campaign so concurrent campaigns never overshoot aggregate workspace trunk capacity
- [X] T016 [US2] Handle HTTP `429` (`trunk_capacity_exceeded`) from gateway in `apps/api/src/connectors/voice-app.ts` by throwing `TransientConnectorError` so `dispatchOne` in `apps/api/src/engine/dispatch.ts` backs off cleanly without losing or completing the contact prematurely
- [X] T017 [US2] Add non-blocking scheduler wake/trigger in `apps/api/src/modules/connectors.ts` when webhook receives terminal voice event (`FINALIZED`/`RELEASED`) so freed trunk slots trigger reservation replenishment within `<= 5s` (`SC-002`)
- [X] T018 [P] [US2] Extend `apps/api/test/campaign-trunk-dialer.test.ts` with tests for zero-trunk hold (`0` dispatches when `availableChannels = 0` keeping `enrollments` intact), automatic replenishment when trunk frees up, `429` transient retry preservation, and multi-campaign contention cap

**Checkpoint**: Reposição contínua, espera segura em 0 troncos e isolamento entre múltiplas campanhas validados.

---

## Phase 5: User Story 3 - Governança pelo Gestor e Visibilidade em Tempo Real (Priority: P3)

**Goal**: Permitir que apenas o Gestor escolha troncos e ajuste o multiplicador na campanha (bloqueando Operadores com `403` na API e modo somente leitura na UI), e exibir painel em tempo real com carregados, em discagem, aguardando tronco e troncos disponíveis (`<= 5s`).

**Independent Test**: `MANAGER` altera `trunkIds` e `dialMultiplier` via `PUT /api/campaigns/:id/dialer-config` (`200`) e pela tela de campanha; `OPERATOR` recebe `403` na API e vê apenas resumo somente leitura na UI junto aos contadores ao vivo em `CampaignDetail.tsx`.

### Implementation for User Story 3

- [X] T019 [US3] Implement `PUT /api/campaigns/:id/dialer-config` (restricted to `MANAGER` / `ADMIN` / `SUPER_ADMIN`, rejecting `OPERATOR` with `403 Forbidden`, auditing `campaign.dialer_config`) and `GET /api/campaigns/:id/dialer-status` (`loadedTotal`, `activeDialing`, `queuedWaitingTrunk`, `completedOrSkipped`, `availableTrunkSlots`, `totalTrunkChannels`, `dialMultiplier`, `effectiveQuota`, `waitingReason`, `canEditDialerConfig`, `trunks[]`) in `apps/api/src/modules/campaigns.ts`
- [X] T020 [P] [US3] Implement `GET /api/telephony/trunks/availability` in `apps/api/src/modules/telephony.ts` returning workspace-scoped outbound `TrunkAvailability[]` and aggregate free channels
- [X] T021 [US3] Update campaign wizard in `apps/web/src/pages/NewCampaign.tsx` to load `/telephony/trunks/availability` and render trunk multi-select (`Automático` fallback vs explicit trunks) and `Multiplicador de Discagem` editable strictly when role is `MANAGER`/`ADMIN`/`SUPER_ADMIN` (read-only badge for `OPERATOR`, tooltip-only guidance per Constitution Principle IV)
- [X] T022 [US3] Update `apps/web/src/pages/CampaignDetail.tsx` to poll `/campaigns/:id/dialer-status` every `3s` while `RUNNING` (`<= 5s`), display high-density cards/badges (`Carregados`, `Em Discagem`, `Aguardando Tronco`, `Troncos Disponíveis`, `Cota Efetiva`, `waitingReason`), and allow inline editing of `trunkIds`/`dialMultiplier` exclusively for `canEditDialerConfig === true` (`MANAGER`/`ADMIN`/`SUPER_ADMIN`)
- [X] T023 [P] [US3] Add RBAC & dialer status API tests in `apps/api/test/campaign-trunk-dialer.test.ts` verifying `403 Forbidden` when `OPERATOR` attempts `POST /campaigns` (with `trunkIds`/`dialMultiplier`) or `PUT /campaigns/:id/dialer-config`, `200` for `MANAGER`, and accurate counts from `GET /campaigns/:id/dialer-status`

**Checkpoint**: Governança Gestor vs. Operador e observabilidade em tempo real completas e verificáveis independentemente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificação integral dos portões de qualidade da Constituição, contratos, sintaxe, builds e execução completa da suíte de testes.

- [X] T024 Run contract generation, TypeScript typecheck, gateway syntax check, and full builds: `npm run contracts && npm run typecheck && npm run check:gateway && npm run build`
- [X] T025 Run full automated test suites (`npm test` against `voll_connect_test` and `npm --prefix apps/voice-gateway test`) and verify all scenarios from `specs/002-campaign-trunk-dialer/quickstart.md` *(verified on 194.163.151.91 Postgres 16 `voll_connect_test`: `test/campaign-trunk-dialer.test.ts` 3/3, `test/engine.test.ts` 15/15, `test/voice-app-connector.test.ts` 10/10, `test/trunk-capacity-unit.test.ts` 4/4, `test/architecture-map.test.ts` 4/4, `test/btc-importer.test.ts` 9/9, and `@voll/voice-gateway` 20/20 passed; pre-existing failures in `api.test.ts` (2) and `telephony.test.ts` (2) from migration 011 seed/ownership are unrelated)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Sem dependências — iniciar imediatamente (`T001` → `T002`; `T003` em paralelo).
- **Phase 2 (Foundational)**: Depende de Phase 1 — bloqueia todas as user stories (`T004`–`T007` no Gateway em sequência/paralelo com `T008`–`T009` na API).
- **Phase 3 (US1 - P1 MVP)**: Depende de Phase 2 — entrega carga da lista + envio inicial dimensionado por troncos.
- **Phase 4 (US2 - P2)**: Depende de `T010`–`T011` (US1) para estender pool multi-campanha, wake em webhook terminal e tratamento de `429`.
- **Phase 5 (US3 - P3)**: Depende de Phase 2 (e opcionalmente usa projeções de US1/US2) — `T019` e `T020` na API podem rodar em paralelo antes de `T021`–`T022` no Web.
- **Phase 6 (Polish)**: Depende de todas as fases desejadas estarem concluídas.

### Parallel Opportunities

- **Phase 1**: `T003` (SQL migration) em paralelo com `T001`–`T002` (contratos).
- **Phase 2**: `T008` (`trunk-capacity.ts`) e `T009` (`eligibility.ts`) em paralelo com o trabalho no `apps/voice-gateway` (`T004`–`T007`).
- **Phase 3 (US1)**: `T013` (testes gateway) e `T014` (testes API) em paralelo após `T007` e `T012`.
- **Phase 5 (US3)**: `T019` (`campaigns.ts`), `T020` (`telephony.ts`) em paralelo; em seguida `T021` (`NewCampaign.tsx`) e `T022` (`CampaignDetail.tsx`) em paralelo.

---

## Parallel Example: Foundational + US1

```bash
# Após T001–T003 (Phase 1):
# Gateway e API avançam em paralelo em arquivos distintos:
Task T004: "apps/voice-gateway/utils/trunk-manager.js"
Task T008: "apps/api/src/engine/trunk-capacity.ts"
Task T009: "apps/api/src/engine/eligibility.ts"

# Em US1, testes do gateway e da API rodam em paralelo:
Task T013: "apps/voice-gateway/test/trunk-dialer.test.js"
Task T014: "apps/api/test/campaign-trunk-dialer.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Concluir Phase 1 (`T001`–`T003`) e Phase 2 (`T004`–`T009`).
2. Implementar Phase 3 (`T010`–`T014` — US1).
3. **STOP and VALIDATE**: Confirmar com `T013` e `T014` que uma lista de contatos só dispara na quantidade exata de troncos/vagas livres e respeita `dialMultiplier`.

### Incremental Delivery

1. Setup + Foundational (`T001`–`T009`) → Base de capacidade por tronco pronta.
2. User Story 1 (`T010`–`T014`) → Envio dimensionado pelos troncos (MVP).
3. User Story 2 (`T015`–`T018`) → Reposição contínua `<= 5s`, espera com `0` troncos e disputa justa entre campanhas.
4. User Story 3 (`T019`–`T023`) → Governança exclusiva do Gestor (`403` para Operador) + monitoramento na UI.
5. Polish (`T024`–`T025`) → Gates completos da Constituição.
