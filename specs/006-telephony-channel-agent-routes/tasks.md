---

description: "Actionable, dependency-ordered tasks for unifying Telefonia architecture across Canais, Agentes de Voz, and Rotas"
---

# Tasks: Revisão da Arquitetura de Telefonia (Canal, Agentes e Rotas)

**Input**: Design documents from `/specs/006-telephony-channel-agent-routes/`  
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/006-telephony-channel-agent-routes/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/006-telephony-channel-agent-routes/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/006-telephony-channel-agent-routes/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/006-telephony-channel-agent-routes/data-model.md), [contracts/](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/006-telephony-channel-agent-routes/contracts/)

**Organization**: Tasks are grouped by user story (`US1`, `US2`, `US3`) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story mapping (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths included in every task description

---

## Phase 1: Setup (Baseline & Verification)

**Purpose**: Verify baseline workspace health before modifying shared routing, voice agent, and UI modules.

- [X] T001 Verify clean baseline across all workspaces (`npm run typecheck && npm run check:gateway`) in `/Users/macm/Library/Mobile Documents/com~apple~CloudDocs/Documents/code/project-connect/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared Zod contracts, TypeScript UI types, and mock backend parity required across `US1`–`US3`.

**⚠️ CRITICAL**: Complete this phase before implementing user story backend and UI work.

- [X] T002 Export `INBOUND_ROUTE_CHANNEL_SCOPES = ['*', 'VOICE', 'WEBRTC']`, `VOICE_ROUTING_SOURCES`, `InboundRouteUpsertSchema` (`channelType`, `connectionId`, `trunkId`, `didPattern`, `callerPattern`, `originPattern`, `tenantId`, `priority`, `maxChannels`, `active`), `InboundRouteSimulateSchema` (`channelType`, `connectionId?`, `trunkId?`, `did?`, `callerId?`, `origin?`), and `VoiceAgentUsageSummarySchema` in `packages/shared/src/index.ts`
- [X] T003 [P] Extend `InboundRoute` interface (`channelType?`, `connectionId?`, `originPattern?`), add `VoiceAgentUsageSummary` and `InboundRouteSimulationResult` types in `apps/web/src/pages/telephony/types.tsx`
- [X] T004 [P] Add mock `/telephony/tenants/:id/usages`, extended `/telephony/routes` (`channelType`, `connectionId`, `originPattern`) + `/telephony/routes/simulate` precedence simulation, and HTTP `409` delete protection when an agent is in use in `apps/web/src/lib/mock-backend.ts`

**Checkpoint**: Shared contracts and UI/mock types ready; user stories `US1`–`US3` can proceed cleanly.

---

## Phase 3: User Story 1 - Separação Clara entre Canal (Transporte), Agentes (IA) e Rotas (Orquestração) (Priority: P1) 🎯 MVP

**Goal**: Separate responsibilities cleanly across **Canais**, **Agentes** (`Agentes de Voz`), and **Rotas** (`Rotas de Entrada` + `Rotas de Saída`), exposing agent usage references (`Canais`, `Rotas`, `Campanhas`) and blocking deletion of in-use agents with HTTP `409 Conflict`.

**Independent Test**: Create 1 independent voice agent, bind it as default agent in a `Canal` (`VOICE` or `WEBRTC`), reference it in an `InboundRoute` and a `Campaign`, confirm `GET /telephony/tenants/:id/usages` lists all references, confirm `DELETE /telephony/tenants/:id` returns HTTP `409` listing active bindings, and confirm UI renders `"Agente padrão"` and usage counts without duplicating the agent.

### Tests for User Story 1

- [X] T005 [P] [US1] Create integration test suite covering `GET /telephony/tenants/:id/usages`, multi-channel reuse of a single agent across `connections`/`routes`/`campaigns`/`campaign_templates`, cross-workspace HTTP `403` isolation, and HTTP `409` `agent_in_use` rejection on `DELETE /telephony/tenants/:id` in `apps/api/test/channel-agent-routes.test.ts`

### Implementation for User Story 1

- [X] T006 [US1] Implement `getVoiceAgentUsages(workspaceId, agentId?)` scanning `connections`, `routes`, `campaigns`, and `campaign_templates`, expose `GET /telephony/tenants/:id/usages` (and `GET /telephony/tenants/usages` batch summary), and guard `DELETE /telephony/tenants/:id` with HTTP `409` listing active bindings in `apps/api/src/modules/telephony.ts`
- [X] T007 [US1] Update `TenantsTab` to display active usage badges (`Canais`, `Rotas`, `Campanhas`) per agent, usage detail tooltip/popover with links, and actionable HTTP `409` conflict alert on attempted deletion in `apps/web/src/pages/telephony/TenantsTab.tsx`
- [X] T008 [P] [US1] Update `VoiceAgents.tsx` to remove inline explanatory body prose per Principle IV (`tooltip="..."`) and display workspace linkage health badges alongside `TenantsTab` in `apps/web/src/pages/VoiceAgents.tsx`
- [X] T009 [P] [US1] Clarify `"Agente padrão"` / fallback wording (`Sem agente padrão (usa rotas ou padrão do workspace)`) in `Channels.tsx` cards and `BindVoiceAgentModal` per Principle IV in `apps/web/src/pages/Channels.tsx`

**Checkpoint**: `US1` delivers clear role separation (`Canal` = transport + default agent fallback; `Agentes` = reusable IA + usage protection) ready to verify independently.

---

## Phase 4: User Story 2 - Regra Única e Previsível de Precedência em Chamadas Receptivas e Ativas (Priority: P2)

**Goal**: Enforce a single deterministic precedence engine across SIP, WebRTC Web Widget, WhatsApp Calling (`Rota de Entrada > Canal > Workspace`), and Outbound Campaigns (`Campanha > Rota de Saída / Canal > Workspace`), extending `RouteManager` and API/UI observability.

**Independent Test**: Configure a `WEBRTC` or `VOICE` channel with default Agent B, add an `InboundRoute` matching `channelType`/`connectionId`/`originPattern`/`didPattern` pointing to Agent A; verify `/telephony/routes/simulate` and `/public/webrtc/offer` / `/webhooks/whatsapp-calling/:id` resolve Agent A (`source: 'inbound_route'`) on matching calls and Agent B (`source: 'channel_default'`) otherwise; verify outbound `voice-app.ts` records `agentSource` & `trunkSource` metadata and `NewCampaign.tsx` shows inherited vs overridden badges.

### Tests for User Story 2

- [X] T010 [P] [US2] Create unit tests verifying `RouteManager.match` & `RouteManager.simulate` matching for `channelType` (`'*' | 'VOICE' | 'WEBRTC'`), `connectionId`, `originPattern`, `didPattern`, and backwards-compatible loading of legacy `routes.json` rules without the new fields in `apps/voice-gateway/test/route-manager-channels.test.js`
- [X] T011 [P] [US2] Add API test cases in `apps/api/test/channel-agent-routes.test.ts` validating inbound precedence (`Rota de Entrada > Canal > Workspace`) across `/telephony/routes/simulate`, `/public/webrtc/offer`, and `/webhooks/whatsapp-calling/:connectionId`, plus cross-workspace HTTP `403` guard on `POST/PUT /telephony/routes`

### Implementation for User Story 2

- [X] T012 [US2] Extend `RouteManager` (`match` and `simulate` supporting `channelType`, `connectionId`, `originPattern` with wildcard `'*'` backwards compatibility) and update `/v1/routes` + `/v1/routes/simulate` handlers in `apps/voice-gateway/utils/route-manager.js` and `apps/voice-gateway/utils/api-router.js`
- [X] T013 [US2] Propagate gateway inbound routing metadata (`channelType: 'VOICE' | 'WEBRTC'`, `connectionId`, `origin`) and outbound precedence provenance (`agentSource`, `trunkSource`) in `apps/voice-gateway/index.js`
- [X] T014 [US2] Implement `resolveInboundVoiceRouting` (`Rota de Entrada > Agente padrão do Canal > Agente padrão do Workspace`, fail-open to channel default if gateway route lookup errors), enforce `InboundRouteUpsertSchema`/`InboundRouteSimulateSchema` + cross-workspace `tenantId`/`connectionId`/`trunkId` HTTP `403` validation in `/telephony/routes*`, and wire `POST /public/webrtc/offer` to `resolveInboundVoiceRouting` in `apps/api/src/modules/telephony.ts`
- [X] T015 [P] [US2] Update `POST /webhooks/whatsapp-calling/:connectionId` to resolve incoming calls via `resolveInboundVoiceRouting` (`channelType: 'WEBRTC'`, `connectionId: conn.id`, `did: whatsappPhoneNumberId`, `callerId: from`) and include `agentSource`/`routeId` in gateway offer metadata in `apps/api/src/modules/whatsapp-calling.ts`
- [X] T016 [P] [US2] Record explicit `agentSource` (`campaign_override` | `channel_default` | `workspace_default`) and `trunkSource` (`campaign_override` | `outbound_route` | `channel_default`) in outbound call dispatch metadata in `apps/api/src/connectors/voice-app.ts`
- [X] T017 [US2] Query `GET /telephony/outbound-routes` (when in Advanced mode) and display explicit inheritance vs override indicators for Voice Agent (`Herdado do Canal` vs `Sobrescrito na Campanha`) and Outbound Route/Trunks (`Automático por Rotas de Saída` listing active routes vs `Troncos da Campanha`) in `apps/web/src/pages/NewCampaign.tsx` and `apps/web/src/components/CampaignWizardInspector.tsx`

**Checkpoint**: Both inbound (SIP, WebRTC, WhatsApp Calling) and outbound (Campaigns/Outbound Routes) resolve predictably via the unified precedence rules with full provenance.

---

## Phase 5: User Story 3 - Navegação Unificada (Canais, Agentes e Rotas), Atalhos Contextuais e Modos Básico/Avançado (Priority: P3)

**Goal**: Expose **Rotas** as a dedicated top-level Configuration page (`/rotas`) alongside **Canais** and **Agentes de Voz** in Advanced mode (while keeping Basic mode focused on **Canais** + **Agentes** per `Q1-A` and `Q3-A`), with contextual shortcuts between cards and multichannel route simulator.

**Independent Test**: In Advanced mode, confirm `Rotas` appears under `Configuração` alongside `Canais` and `Agentes de Voz`, opens `/rotas` with `Rotas de Entrada` (SIP/WebRTC/WhatsApp filters + simulator) and `Rotas de Saída`, confirm shortcut links from `Channels.tsx` and `NewCampaign.tsx` open `/rotas` filtered properly; toggle to Basic mode and confirm `Rotas` is hidden in the sidebar and cards use automatic routing seamlessly.

### Implementation for User Story 3

- [X] T018 [US3] Refactor `RoutesTab` and `OutboundRoutesTab` into reusable exported panels supporting `channelType`, `connectionId` (`connections` select), `originPattern`, query pre-filters (`?connectionId=...`), and multichannel precedence simulator (`channelType`, `connectionId`, `origin`, `did`, `callerId`) in `apps/web/src/pages/telephony/SettingsTabs.tsx`
- [X] T019 [US3] Create unified `RoutesPage` rendering `Rotas de Entrada` and `Rotas de Saída` tabs, `PageHeader` with `pt-BR` tooltip (`Principle IV`), and contextual link back to `Canais` and `Agentes de Voz` in `apps/web/src/pages/Routes.tsx`
- [X] T020 [P] [US3] Register `/rotas` lazy route in `apps/web/src/router.tsx` and add `{ to: '/rotas', label: 'Rotas', minMode: 'advanced' }` in `Configuração` group right after `Agentes de Voz` in `apps/web/src/components/Layout.tsx`
- [X] T021 [P] [US3] Add Advanced-mode-only contextual `"Rotas"` navigation shortcuts on `VOICE`/`WEBRTC` channel cards in `apps/web/src/pages/Channels.tsx` and outbound routes shortcut in `apps/web/src/pages/NewCampaign.tsx` (hidden in Basic mode per `Q3-A`)
- [X] T022 [US3] Replace nested `routes` / `outbound-routes` management clutter inside `/telefonia` (`SettingsTabs.tsx`) with clean summary + `"Gerenciar em Rotas →"` shortcut (preserving `?tab=routes` redirect/link compatibility), remove any visible `"Tenant"` terminology in UI labels in favor of **Canais** / **Agentes** / **Rotas**, and audit all labels/tooltips against Constitution Principle IV in `apps/web/src/pages/telephony/SettingsTabs.tsx`

**Checkpoint**: Users navigate seamlessly across **Canais**, **Agentes** and **Rotas** in Advanced mode, while Basic mode remains streamlined.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Regenerate contracts, run static checks, unit/integration suites, production build, and validate end-to-end against `quickstart.md`.

- [X] T023 Regenerate contracts and verify workspace typecheck and gateway syntax (`npm run contracts && npm run typecheck && npm run check:gateway`) in `/Users/macm/Library/Mobile Documents/com~apple~CloudDocs/Documents/code/project-connect/package.json`
- [ ] T024 Run `@voll/voice-gateway` unit tests (`npm test -w @voll/voice-gateway`), `@voll/api` architecture tests (`npm run test:arch`), and `@voll/api` integration tests (`npm test -w @voll/api` against PostgreSQL when available) — _Nota: `test:arch` (4/4) e `@voll/voice-gateway` (23/23) passaram; `@voll/api` DB (`channel-agent-routes.test.ts`) falhou localmente por ausência de PostgreSQL (`ECONNREFUSED 127.0.0.1:5432`)_
- [X] T025 Run full production build (`npm run build`) across `@voll/shared`, `@voll/api`, and `@voll/web`
- [ ] T026 Validate manual scenarios in `specs/006-telephony-channel-agent-routes/quickstart.md` (and verify Constitution Principles I–VII compliance) — _Pendente execução manual em ambiente com banco/gateway ativos_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Runs first (`T001`).
- **Foundational (Phase 2)**: `T003` and `T004` run in parallel right after/with `T002` (`T002` defines shared Zod contracts). **BLOCKS** `US1`–`US3`.
- **User Story 1 (Phase 3 — P1 MVP)**: Depends on Phase 2 (`T002`–`T004`); `T005`, `T008`, `T009` can run in parallel alongside `T006`/`T007`.
- **User Story 2 (Phase 4 — P2)**: Depends on Phase 2 (`T002`–`T004`); gateway (`T010`, `T012`, `T013`) and API (`T011`, `T014`–`T016`) + campaign UI (`T017`) follow test-first order.
- **User Story 3 (Phase 5 — P3)**: Depends on Phase 2 (`T003`, `T004`) and `T014` backend route schema support; `T018` unlocks `T019` and `T022`, while `T020` and `T021` run in parallel.
- **Polish (Phase 6)**: Runs after Phases 1–5 (`T023` → `T024` → `T025` → `T026`).

### Parallel Example: User Story 1 & User Story 2

```bash
# US1 parallel tasks after Phase 2:
Task T005: "Create apps/api/test/channel-agent-routes.test.ts (agent usages & 409 conflict)"
Task T008: "Update apps/web/src/pages/VoiceAgents.tsx (Principle IV tooltips + usage badges)"
Task T009: "Update apps/web/src/pages/Channels.tsx (Agente padrão / fallback copy)"

# US2 parallel tests & dispatches:
Task T010: "Create apps/voice-gateway/test/route-manager-channels.test.js"
Task T015: "Wire resolveInboundVoiceRouting in apps/api/src/modules/whatsapp-calling.ts"
Task T016: "Add agentSource & trunkSource provenance in apps/api/src/connectors/voice-app.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (`T001`) + Phase 2 (`T002`–`T004`).
2. Complete Phase 3 (`T005`–`T009`) to establish clean **Canal** vs **Agentes** separation, usage visibility, and safe `409` deletion guard.
3. Validate `US1` before adding cross-channel precedence rules (`US2`) and top-level **Rotas** navigation (`US3`).

### Incremental Delivery

1. **MVP (`US1`)** → Role separation + Agent usage graph & deletion guard.
2. **`US2`** → Single deterministic precedence engine (`Rota > Canal > Workspace` & `Campanha > Rota > Canal`) across SIP, WebRTC, WhatsApp Calling, and Outbound Campaigns.
3. **`US3`** → Dedicated `/rotas` page in `Configuração` (Advanced mode), Basic mode simplicity, and contextual links across `Canais`, `Agentes` and `Campanhas`.
4. **Phase 6** → Contracts, typecheck, tests, build, and `quickstart.md` validation.
