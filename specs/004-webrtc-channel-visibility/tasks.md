---

description: "Actionable, dependency-ordered tasks for WEBRTC channel visibility, provisioning, public Web Widget keys, and inbound WhatsApp Business Calling"
---

# Tasks: Visibilidade, Cadastro e Operação do Canal WebRTC (Web & WhatsApp Calling)

**Input**: Design documents from `/specs/004-webrtc-channel-visibility/`  
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/004-webrtc-channel-visibility/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/004-webrtc-channel-visibility/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/004-webrtc-channel-visibility/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/004-webrtc-channel-visibility/data-model.md), [contracts/](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/004-webrtc-channel-visibility/contracts/)

**Organization**: Tasks are grouped by user story (`US1`, `US2`, `US3`) to enable independent implementation and testing of each increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story mapping (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Infrastructure & Baseline)

**Purpose**: Verify baseline workspace health and prepare sequential SQL migrations safe for PostgreSQL enum transactions.

- [X] T001 Verify clean TypeScript and gateway baseline (`npm run typecheck && npm run check:gateway`) in `/Users/macm/Library/Mobile Documents/com~apple~CloudDocs/Documents/code/project-connect/package.json`
- [X] T002 Create enum migration adding `'WEBRTC'` (`ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'WEBRTC';`) isolated from data inserts per `migrate.ts` transaction rules in `apps/api/migrations/021_webrtc_channel_enum.sql`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core shared types/schemas, idempotent workspace provisioning, `whatsapp_calling_sessions` table, connection persistence with masked Meta secrets, and frontend/mock type alignment required before `US1`–`US3`.

**⚠️ CRITICAL**: Complete this phase before implementing user story UI and runtime flows.

- [X] T003 [P] Export `CONNECTION_CHANNEL_TYPES = ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL', 'WEBRTC']`, `CONNECTION_CHANNEL_LABEL`, `WEBRTC_MODES = ['WEB', 'WHATSAPP_CALLING', 'BOTH']`, `PublicWebRtcOfferSchema`, `InternalWebRtcEndedSchema`, and extend `ConnectionCreateSchema` (`name` min 1 max 100, `channelType: z.enum(CONNECTION_CHANNEL_TYPES)`, `provider` default `'SIMULATED'`, `tenantId: z.string().max(120).nullable().optional()`, `webrtcMode`, `allowedOrigins: z.array(z.string()).optional()`, optional `whatsappPhoneNumberId`, `whatsappBusinessAccountId`, `whatsappVerifyToken`, `whatsappAppSecret`, `whatsappAccessToken`) and `ConnectionUpdateSchema` while keeping `CHANNEL_TYPES` (`VOICE`, `WHATSAPP`, `SMS`, `EMAIL`) outbound-only in `packages/shared/src/index.ts`
- [X] T004 Create migration creating `whatsapp_calling_sessions` (`whatsapp_call_id text PRIMARY KEY`, `workspace_id uuid NOT NULL REFERENCES workspaces(id)`, `connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE`, `gateway_call_id text NOT NULL`, `caller_phone text`, `status text NOT NULL DEFAULT 'CONNECTING'`, `created_at timestamptz NOT NULL DEFAULT now()`, `ended_at timestamptz`) plus idempotent backfill inserting `'Canal WebRTC · Web & WhatsApp Calling'` (`channel_type = 'WEBRTC'`, `provider = 'WEBRTC_NATIVE'`, `active = true`, `webrtcMode = 'BOTH'`, unique `publicWidgetKey = 'wrtc_' || ...`, auto-bound to first active `workspace_voice_resources` agent if present) for every existing workspace without a `'WEBRTC'` connection in `apps/api/migrations/022_webrtc_channel_seed.sql`
- [X] T005 [P] Update workspace seeding (`seedWorkspace` / CLI seed) and new workspace provisioning (`INSERT INTO workspaces`) to automatically insert a default active `'WEBRTC'` connection (`provider = 'WEBRTC_NATIVE'`, `webrtcMode = 'BOTH'`, unique `publicWidgetKey`) in `apps/api/src/db/seed.ts` and `apps/api/src/modules/auth.ts`
- [X] T006 Update `connectionDto`, `POST /connections`, and `PATCH /connections/:id` to persist `WEBRTC` configuration fields (`webrtcMode`, `allowedOrigins` normalized/trimmed, auto-generated `publicWidgetKey` `'wrtc_...'` and `whatsappVerifyToken`, `whatsappPhoneNumberId`, `whatsappBusinessAccountId`, secrets `whatsappAppSecret` & `whatsappAccessToken`), preserve existing secrets when PATCH sends `'***'` or omits them, return masked secret flags (`hasWhatsappAppSecret`, `hasWhatsappAccessToken`) instead of plaintext, and validate `tenantId` ownership against `workspace_voice_resources` (HTTP 403 cross-workspace) in `apps/api/src/modules/catalog.ts`
- [X] T007 [P] Update `Connection` TypeScript interface (`channelType: ConnectionChannelType`, `webrtcMode?`, `publicWidgetKey?`, `allowedOrigins?`, `whatsappPhoneNumberId?`, `whatsappBusinessAccountId?`, `whatsappVerifyToken?`, `hasWhatsappAppSecret?`, `hasWhatsappAccessToken?`) in `apps/web/src/lib/types.ts`
- [X] T008 [P] Update mock `/connections` seed, creation, update, and public widget/calling stubs to include a pre-provisioned active `'WEBRTC'` channel in `apps/web/src/lib/mock-backend.ts`

**Checkpoint**: Database schema, idempotent workspace provisioning, shared contracts, and secure `WEBRTC` connection persistence/masking are complete.

---

## Phase 3: User Story 1 - Exibir e Cadastrar o Canal WebRTC na Lista de Canais (Priority: P1) 🎯 MVP

**Goal**: Make `WEBRTC` visible immediately in **Configuração → Canais** (Cards and Table) and selectable as a first-class connector option (`WebRTC Nativo`) in **"+ Novo canal"** and **Editar canal** with automatic defaults.

**Independent Test**: Open **Configuração → Canais** (Basic & Advanced modes), confirm the auto-provisioned active `WEBRTC` channel appears immediately with `WebRTC` badge, open **"+ Novo canal"**, select **WebRTC Nativo (Web Widget & WhatsApp Calling)**, create a second `WEBRTC` channel without typing internal URLs, toggle active/inactive, and edit it.

### Implementation for User Story 1

- [X] T009 [US1] Add `WEBRTC_NATIVE` to `PROVIDER_LABEL`, `PROVIDER_SHORT_LABEL`, and add `Radio` icon/badge formatting (`CONNECTION_CHANNEL_LABEL['WEBRTC']`) across both Card and Table views in `apps/web/src/pages/Channels.tsx`
- [X] T010 [US1] Enable `Agente de voz` action button and `BindVoiceAgentModal` support for both `VOICE_APP` and `WEBRTC` (`provider === 'WEBRTC_NATIVE' || channelType === 'WEBRTC'`) connections in `apps/web/src/pages/Channels.tsx`
- [X] T011 [US1] Add `WEBRTC_NATIVE` option to `NewConnectionDialog` (auto-setting `channelType = 'WEBRTC'`, default name `'Canal WebRTC · Web & WhatsApp Calling'`, mode selector `'BOTH' | 'WEB' | 'WHATSAPP_CALLING'`, voice agent dropdown, optional `allowedOrigins`, and conditional Meta WhatsApp Calling inputs without requiring manual internal endpoint URLs) in `apps/web/src/pages/Channels.tsx`
- [X] T012 [US1] Extend `EditConnection` modal to support editing `WEBRTC` connections (`webrtcMode`, `allowedOrigins`, `tenantId`, Meta WhatsApp Calling fields preserving masked secrets `'***'`) in `apps/web/src/pages/Channels.tsx`

**Checkpoint**: User Story 1 delivers visible, auto-provisioned, and creatable/editable `WEBRTC` channels in **Configuração → Canais**.

---

## Phase 4: User Story 2 - Vinculação de Agente de Voz, Web Widget e WhatsApp Calling no Canal WebRTC (Priority: P2)

**Goal**: Deliver end-to-end public per-channel Web Widget authentication (`publicWidgetKey` + `allowedOrigins` + IP rate-limit) and inbound WhatsApp Business Calling webhook (`GET` challenge + `POST` HMAC-SHA256 + Gateway SDP negotiation + Meta Graph API `accept`/`terminate`), plus consolidated per-channel UI controls in `Channels.tsx`.

**Independent Test**: Copy a `WEBRTC` channel's `<script ... data-widget-key="...">` tag, test `POST /api/public/webrtc/offer` (allowed origin HTTP 200 routing to bound agent; forbidden origin HTTP 403; unknown/inactive key HTTP 401/403), test `GET`/`POST /api/webhooks/whatsapp-calling/:connectionId` with Meta `X-Hub-Signature-256` and mocked Graph API (`accept` on `connect`, duplicate idempotency, `terminate` hangup), and confirm integrated widget/webhook/HTTPS indicators appear directly on the `WEBRTC` channel card.

### Tests for User Story 2

- [X] T013 [P] [US2] Create automated API test suite covering `WEBRTC` provisioning & non-recreation after manual deletion, `POST/PATCH /connections` secret masking + cross-workspace HTTP 403 agent rejection, `/api/public/webrtc/offer`, `:callId/ice` & `DELETE :callId` (`publicWidgetKey`/`controlToken`/HTTP 422 missing-agent), `GET/POST /api/webhooks/whatsapp-calling/:connectionId` HMAC/422/SDP/idempotency, and `POST /api/internal/webrtc/:callId/ended` Bearer token auth in `apps/api/test/webrtc-channel.test.ts`

### Implementation for User Story 2

- [X] T014 [US2] Implement public Web Widget endpoints (`GET /public/webrtc/widget.js`, `POST /public/webrtc/offer` validated with `PublicWebRtcOfferSchema`, `POST /public/webrtc/:callId/ice`, `DELETE /public/webrtc/:callId`) resolving active `'WEBRTC'` connections by `config->>'publicWidgetKey'`, enforcing `webrtcMode !== 'WHATSAPP_CALLING'`, optional `allowedOrigins`, per-IP rate limiting, and resolving workspace-scoped `tenantId` to the gateway in `apps/api/src/modules/telephony.ts`
- [X] T015 [US2] Create inbound Meta WhatsApp Business Calling module (`GET /webhooks/whatsapp-calling/:connectionId` verify-token challenge, `POST /webhooks/whatsapp-calling/:connectionId` with `timingSafeEqual` `X-Hub-Signature-256` validation on `rawBody`, graceful `422` when workspace has no active agent, gateway `/v1/webrtc/offer` SDP negotiation passing `endedCallbackUrl`, Meta Graph API `POST /v21.0/{phoneNumberId}/calls` `accept`/`terminate`, idempotent `whatsapp_calling_sessions` tracking, and `POST /internal/webrtc/:callId/ended` validated with `InternalWebRtcEndedSchema` and `Authorization: Bearer <VOICE_APP_TOKEN|API_AUTH_TOKEN>` via `timingSafeEqual`) in `apps/api/src/modules/whatsapp-calling.ts`
- [X] T016 [P] [US2] Register public WebRTC, WhatsApp Calling webhook, and internal gateway callback routes (bypassing portal user session guard while enforcing route-level `publicWidgetKey`, Meta `X-Hub-Signature-256`, or `Bearer VOICE_APP_TOKEN`/`API_AUTH_TOKEN` auth) in `apps/api/src/app.ts`
- [X] T017 [P] [US2] Update embeddable SDK script to read `data-widget-key` / `?key=` from its `<script>` element, default signaling path to `/api/public/webrtc/offer` (`publicWidgetKey`), and propagate `controlToken` on ICE/hangup requests in `apps/voice-gateway/public/voll-voice-widget.js`
- [X] T018 [P] [US2] Update voice gateway session metadata & hangup lifecycle hook so sessions with `metadata.source === 'whatsapp_calling'` report completion back to `metadata.endedCallbackUrl` (or configured API callback base) using `Authorization: Bearer ${process.env.API_AUTH_TOKEN}` (validated via `InternalWebRtcEndedSchema`) and tag `direction: 'whatsapp_calling'` in `apps/voice-gateway/index.js` and `apps/voice-gateway/utils/api-router.js`
- [X] T019 [US2] Replace the standalone static `"Canal WebRTC & Web Voice Widget"` block at the bottom of `Channels.tsx` with integrated controls inside each `WEBRTC` channel card using `tooltip="..."` / `<InfoTooltip />` in `pt-BR` per Principle IV (per-channel `<script src=".../api/public/webrtc/widget.js" data-widget-key="...">` copy button, WhatsApp Calling webhook URL `/api/webhooks/whatsapp-calling/:id` + verify-token copy, HTTPS/Microphone readiness badge, and mode status badge) in `apps/web/src/pages/Channels.tsx`

**Checkpoint**: Both public Web Widget sessions (per-channel `publicWidgetKey`) and inbound WhatsApp Business Calling sessions operate end-to-end via the `WEBRTC` channel.

---

## Phase 5: User Story 3 - Isolamento nos Seletores de Campanhas e Jornadas Outbound + Modo Básico (Priority: P3)

**Goal**: Keep `WEBRTC` accessible in **Configuração → Canais** across Basic & Advanced modes using tooltip-only high-density UI (`Principle IV`), while strictly excluding `WEBRTC` connections from outbound **Jornadas** and **Nova campanha** channel selectors.

**Independent Test**: Toggle between Basic and Advanced modes: verify `WEBRTC` channels remain manageable in `/canais` with `(?)` tooltips and zero explanatory card paragraphs, and verify `/jornadas` and `/campanhas/nova` (`Canal simples` & steps) list only outbound channels (`VOICE`, `WHATSAPP`, `SMS`, `EMAIL`).

### Implementation for User Story 3

- [X] T020 [US3] Audit and enforce outbound channel filtering (`c.channelType !== 'WEBRTC'` / `CHANNEL_TYPES.includes(c.channelType)`) in campaign connection selectors in `apps/web/src/pages/NewCampaign.tsx`
- [X] T021 [P] [US3] Audit `Journeys` step/connection selectors to ensure only outbound `CHANNEL_TYPES` and non-`WEBRTC` connections are selectable in `apps/web/src/pages/Journeys.tsx`
- [X] T022 [US3] Audit `Channels.tsx` WebRTC sections (cards, modals, WhatsApp Calling & widget controls) to move any inline explanatory copy into `tooltip="..."` / `<InfoTooltip />` in `pt-BR` per Constitution Principle IV in `apps/web/src/pages/Channels.tsx`

**Checkpoint**: Outbound workflows remain strictly isolated from `WEBRTC`, and Basic/Advanced `Canais` screens comply with Principle IV.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Regenerate contracts, verify static type/syntax checks, run test suites and production builds, and validate against `quickstart.md`.

- [X] T023 Regenerate shared JSON contracts and verify full workspace typecheck and gateway syntax (`npm run contracts && npm run typecheck && npm run check:gateway`) in `/Users/macm/Library/Mobile Documents/com~apple~CloudDocs/Documents/code/project-connect/package.json`
- [ ] T024 Run API & Voice Gateway test suites (`npm test -w @voll/api && npm test -w @voll/voice-gateway`) verifying `apps/api/test/webrtc-channel.test.ts` and regression tests
- [X] T025 Run full production build (`npm run build`) across `@voll/shared`, `@voll/api`, and `@voll/web`
- [ ] T026 Validate manual end-to-end scenarios in `specs/004-webrtc-channel-visibility/quickstart.md` (and Constitution Principles I–VII compliance)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately (`T001`–`T002`).
- **Foundational (Phase 2)**: `T003`, `T005`, `T007`, `T008` can run in parallel once `T001` finishes; `T004` depends on `T002`; `T006` depends on `T003`. **BLOCKS** `US1`–`US3`.
- **User Story 1 (Phase 3 — P1 MVP)**: Depends on Phase 2 (`T003`–`T008`); sequential UI edits inside `Channels.tsx` (`T009` → `T010` → `T011` → `T012`).
- **User Story 2 (Phase 4 — P2)**: Depends on Phase 2 (and integrates visually into `Channels.tsx` after `US1`); `T013`, `T014`/`T015`, `T017`, `T018` operate on separate files and can run largely in parallel, followed by `T016` and `T019`.
- **User Story 3 (Phase 5 — P3)**: Depends on Phase 2 (`T003`); `T020` (`NewCampaign.tsx`), `T021` (`Journeys.tsx`), and `T022` (`Channels.tsx` after `T019`) ensure outbound isolation and Principle IV compliance.
- **Polish (Phase 6)**: Depends on Phases 1–5 (`T023` → `T024` → `T025` → `T026`).

### Parallel Example: Phase 2 & Phase 4

```bash
# Phase 2 parallel foundation after T002:
Task T003: "Extend packages/shared/src/index.ts with CONNECTION_CHANNEL_TYPES & WEBRTC schemas"
Task T004: "Create apps/api/migrations/021_webrtc_channel_seed.sql"
Task T005: "Auto-provision WEBRTC in seed.ts & auth.ts"
Task T007: "Update Connection type in apps/web/src/lib/types.ts"
Task T008: "Update mock-backend.ts WEBRTC support"

# Phase 4 parallel backend + gateway tasks:
Task T013: "Create apps/api/test/webrtc-channel.test.ts"
Task T014: "Public Web Widget routes in apps/api/src/modules/telephony.ts"
Task T015: "Inbound WhatsApp Calling webhook in apps/api/src/modules/whatsapp-calling.ts"
Task T017: "Update widget SDK key handling in apps/voice-gateway/public/voll-voice-widget.js"
Task T018: "Update gateway lifecycle hook in apps/voice-gateway/index.js & api-router.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (`T001`–`T002`) + Phase 2 (`T003`–`T008`).
2. Complete Phase 3 (`T009`–`T012`) so the `WEBRTC` channel immediately appears in **Configuração → Canais** and can be created, toggled, and bound to a voice agent.
3. Validate visibility in Basic & Advanced modes before expanding runtime integrations.

### Incremental Delivery

1. **MVP (`US1`)** → Real `WEBRTC` channel visibility & CRUD in `Configuração → Canais`.
2. **`US2`** → Per-channel public Web Widget keys + end-to-end inbound WhatsApp Business Calling webhook & gateway SDP integration + consolidated channel card controls.
3. **`US3`** → Strict outbound isolation in `NewCampaign.tsx` & `Journeys.tsx` + Principle IV tooltip cleanup.
4. **Phase 6** → Full contracts, typecheck, gateway check, tests, and production build.
