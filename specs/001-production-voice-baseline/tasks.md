---

description: "Actionable, dependency-ordered task list for Production Voice Baseline (Vapi & Bland Benchmark)"
---

# Tasks: Production Voice Baseline (Vapi & Bland Benchmark)

**Input**: Design documents from `/specs/001-production-voice-baseline/`
**Prerequisites**: [plan.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/001-production-voice-baseline/plan.md), [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/001-production-voice-baseline/spec.md), [research.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/001-production-voice-baseline/research.md), [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/001-production-voice-baseline/data-model.md), [production-voice-contracts.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/001-production-voice-baseline/contracts/production-voice-contracts.md)

**Tests**: Verification tasks are included per story/gate using existing workspace test runners (`npm run typecheck`, `npm run check:gateway`, `npm test`, `npm run build`).

**Organization**: Tasks are grouped by user story (`US1`–`US5`) so each increment can be implemented, tested, and deployed independently without breaking existing features (`FR-011`).

## Phase 1: Setup (Shared Infrastructure & Contracts)

**Purpose**: Establish baseline verification and additive shared contract updates without breaking existing consumers.

- [X] T001 Verify baseline workspace health by running `npm run typecheck` and `npm run check:gateway` from repository root `package.json`
- [X] T002 [P] Add additive `recording: { enabled?: boolean }` (default `true`) and standardized `limits` (`maxDurationSec` default `180`, min `15`, max `3600`; `maxConcurrentCalls` default `200`, min `1`) to `packages/shared/src/index.ts`
- [X] T003 [P] Add optional additive `failureStage` (`signaling` | `media` | `ai_provider` | `capacity` | `duration_cap` | `none`) and `correlationId` fields to `packages/shared/contracts/connector-event.schema.json` and `packages/shared/contracts/voice-agent-tenant.schema.json`
- [X] T004 Regenerate and validate shared contracts via `npm run contracts` in `packages/shared/package.json` (depends on T002, T003)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core tenant defaults and correlation propagation needed before story-level guardrails and observability.

**⚠️ CRITICAL**: Must complete before User Story phases begin.

- [X] T005 Standardize `maxDurationSec` default to `180`, `maxConcurrentCalls` default to `200`, and `recording: { enabled: true }` default in `apps/voice-gateway/utils/tenant-manager.js`
- [X] T006 [P] Align fallback `maxDurationSec` from `300` to `180` and propagate `correlationId` (`attemptId`) in `apps/api/src/connectors/voice-app.ts`

**Checkpoint**: Shared contracts and tenant/connector defaults are aligned and backward-compatible.

---

## Phase 3: User Story 1 - Real-Time Voice Performance & Natural Turn-Taking (Priority: P1) 🎯 MVP

**Goal**: Preserve sub-800ms median turn-taking, deterministic `<250ms` barge-in, echo suppression, and graceful idle/silence handling without regressions.

**Independent Test**: Run `CrosstalkFilter` unit tests (`apps/voice-gateway/test/`) and place live inbound/outbound test calls on `9000`, `9001`, and `9002` verifying mid-sentence interruption and silence check-in.

- [X] T007 [P] [US1] Verify and lock barge-in thresholds (`600-650` RMS dynamic cap, `650` RMS / 2 frames, `wasRecentlySpeaking(800)`) with regression assertions in `apps/voice-gateway/utils/crosstalk-filter.js` and `apps/voice-gateway/test/`
- [X] T008 [P] [US1] Add configurable idle/silence check-in and graceful hangup timeout guard in `apps/voice-gateway/index.js` and `apps/voice-gateway/media/elevenlabs-s2s-bridge.js`
- [X] T009 [US1] Verify provider `429`/`5xx` and stalled external WebSocket turn watchdog closes cleanly and logs `failureStage: 'ai_provider'` in `apps/voice-gateway/index.js`

**Checkpoint**: User Story 1 is independently testable with zero echo ghost-triggers and clean provider-error recovery.

---

## Phase 4: User Story 2 - Explicit Call Duration, Concurrency & Cost Guardrails (Priority: P1)

**Goal**: Enforce `180s` default max call duration with a `15s` wrap-up cue, deterministic teardown `<2s`, and capacity rejection/re-queuing at `maxConcurrentCalls`.

**Independent Test**: Test a 30s `maxDurationSec` call (confirming 15s cue + hard hangup at 30s) and `maxConcurrentCalls: 1` (confirming `486`/`503` on 2nd inbound and `429` re-queue on 2nd outbound).

- [X] T010 [US2] Update pre-hangup warning lead time to `15s` (`Math.min(15, Math.max(5, Math.floor(this.maxDurationSec / 2)))` when `maxDurationSec > 20`) and ensure `hangupBy: 'duration_cap'` / `failureStage: 'duration_cap'` in `apps/voice-gateway/index.js`
- [X] T011 [P] [US2] Ensure inbound SIP INVITE rejects with `486 Busy Here` / `503` and logs `REJECTED_CAPACITY` (`failureStage: 'capacity'`) when `activeCalls >= maxConcurrentCalls` in `apps/voice-gateway/index.js`
- [X] T012 [P] [US2] Return HTTP `429` (`{ error: 'tenant_capacity_exceeded', retryAfterSec: 15 }`) on outbound `POST /v1/calls` when tenant capacity is full in `apps/voice-gateway/utils/api-router.js`
- [X] T013 [US2] Handle HTTP `429`/`503` from `voice-gateway` as retryable/re-queued attempts without marking contacts failed in `apps/api/src/connectors/voice-app.ts`

**Checkpoint**: Both duration limits and concurrency caps are enforced deterministically across inbound and outbound flows.

---

## Phase 5: User Story 3 - External API Security, Signed Webhooks & Tenant Isolation (Priority: P1)

**Goal**: Enforce authenticated control/stream endpoints, masked external API keys, and verifiable `X-Webhook-Signature` (`sha256=`) + `X-Webhook-Timestamp` verification.

**Independent Test**: Send unauthenticated requests to `/v1/calls/history` and `/v1/recordings` (expect `401`) and tampered/stale webhook payloads (expect rejection).

- [X] T014 [P] [US3] Include `X-Webhook-Timestamp` alongside `X-Webhook-Signature` (`sha256=<hex_hmac_sha256>`) on outbound webhook deliveries in `apps/voice-gateway/utils/voll-webhook.js`
- [X] T015 [P] [US3] Enforce HMAC signature and timestamp replay window (`<= 300s`) verification on incoming connector webhooks when `webhook_secret` is set in `apps/api/src/modules/telephony.ts` (and connector webhook handler)
- [X] T016 [US3] Audit and enforce masked/write-only credential responses (`hasKey` / `****`) for external AI provider configs in `apps/voice-gateway/utils/api-router.js` and `apps/api/src/modules/telephony.ts`

**Checkpoint**: All external API boundaries and webhooks are authenticated, signed, and secret-safe.

---

## Phase 6: User Story 4 - End-to-End Transaction Observability & Recordings (Priority: P1)

**Goal**: Ensure stereo `.wav` + PII-redacted `.txt` recordings run by default for all tenants (decoupled from optional STT) and every transaction carries correlated IDs, latency, cost, and `failureStage`.

**Independent Test**: Place a call on `9000` (`stt.enabled: false`), verify `/v1/recordings` lists the new `.wav` + `.txt` with `recordingFile !== null`, and verify correlated `callId` / `attemptId` / `failureStage` in history.

- [X] T017 [US4] Decouple `CallRecorder` startup from `this.whisperSession.isSttEnabled` to `if (this.tenant.recording?.enabled !== false && !this.isToneProbe)` while keeping fail-open disk handling in `apps/voice-gateway/index.js`
- [X] T018 [P] [US4] Propagate `correlationId`, `failureStage`, itemized `costUsd`/`costBrl`/`totalTokens`, and `recordingFile` consistently into `calls_history.jsonl` and webhook payloads in `apps/voice-gateway/index.js` and `apps/voice-gateway/utils/call-history-manager.js`
- [X] T019 [P] [US4] Expose `failureStage` and `correlationId` cleanly in Call History details in `apps/web/src/pages/telephony/CallsTab.tsx` (using tooltip-only guidance per Constitution IV)

**Checkpoint**: 100% of enabled tenants (including `9000`) record stereo audio + PII-redacted transcripts with full transaction traceability.

---

## Phase 7: User Story 5 - Production Agent Lifecycle & WebRTC Portal Parity (Priority: P2)

**Goal**: Expose authenticated `/api/telephony/webrtc/*` reverse-proxy routes, `/voll-voice-widget.js`, and visible **WebRTC / Web Widget** status in `Channels.tsx` without exposing port `8090` publicly.

**Independent Test**: Open **Canais** in `apps/web`, verify the **WebRTC / Web Widget** card and HTTPS notice appear, and verify `POST /api/telephony/webrtc/token` proxies to `voice-gateway` via `apps/api`.

- [X] T020 [P] [US5] Add authenticated `/api/telephony/webrtc/token`, `/api/telephony/webrtc/offer`, `/api/telephony/webrtc/:callId/ice`, `DELETE /api/telephony/webrtc/:callId`, and `/api/telephony/webrtc/widget.js` proxy routes in `apps/api/src/modules/telephony.ts`
- [X] T021 [P] [US5] Add `/voll-voice-widget.js` proxy location to `api:3333` in `deploy/nginx.conf`
- [X] T022 [US5] Add visible **WebRTC / Web Widget** channel card (with `tooltip="..."` help, HTTPS readiness check, and copyable embed/proxy URL) in `apps/web/src/pages/Channels.tsx`

**Checkpoint**: WebRTC channel and widget are visible and securely proxied through the main portal.

---

## Phase 8: Polish & Cross-Cutting Verification

**Purpose**: Full-stack quality gates, regression check (`FR-011`), and production deployment validation.

- [X] T023 Run `npm run typecheck`, `npm run check:gateway`, `npm run build`, and `npm test` across all workspaces
- [ ] T024 Validate all scenarios in `specs/001-production-voice-baseline/quickstart.md` against `192.168.15.36` (voice gateway) and `194.163.151.91` (production Docker stack)

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Starts immediately (`T001`–`T004`).
- **Foundational (Phase 2)**: Depends on Phase 1 (`T005`–`T006`); blocks all User Stories.
- **User Stories (Phases 3–7)**: All depend on Phase 2 completion; `US1`–`US4` (P1) can run in parallel or sequentially, followed by `US5` (P2).
- **Polish (Phase 8)**: Depends on completion of desired User Stories (`T023`–`T024`).

### Parallel Opportunities
- `T002` and `T003` (shared contracts) can run in parallel.
- `T005` and `T006` (gateway vs API defaults) can run in parallel.
- `T007` and `T008` (US1), `T011` and `T012` (US2), `T014` and `T015` (US3), `T018` and `T019` (US4), `T020` and `T021` (US5) can run in parallel within their phases.

## Implementation Strategy

### MVP First (P1 Core Production Guardrails)
1. Complete Phase 1 + Phase 2 (`T001`–`T006`).
2. Complete `US4` recording fix (`T017`) + `US2` duration/concurrency (`T010`–`T013`) + `US3` webhook security (`T014`–`T016`) + `US1` voice stability (`T007`–`T009`).
3. Validate via `quickstart.md` and deploy to `192.168.15.36` + `194.163.151.91`.
4. Add `US5` WebRTC portal proxy + **Canais** card (`T020`–`T022`) and re-deploy.

---

## Phase 9: Convergence

- [X] T025 Persist `correlationId` (`attemptId || callId`) and `failureStage` (`signaling` | `media` | `ai_provider` | `capacity` | `duration_cap` | `none`) in `apps/voice-gateway/utils/call-history-manager.js`, all `recordCallEnd` call sites in `apps/voice-gateway/index.js`, and `buildConnectorEvent` in `apps/voice-gateway/utils/voll-contract.js` per FR-006, FR-007, Constitution VII (partial)
- [X] T026 Set explicit `this.failureStage` on `maxDurationTimer` (`duration_cap`) and external AI WebSocket `error`/timeout closures (`ai_provider`) in `apps/voice-gateway/index.js` per FR-001, FR-003, FR-007 (partial)
- [ ] T027 Deploy updated code to `192.168.15.36` (`voice-app`) and `194.163.151.91` (`deploy/deploy.sh`) and execute live `quickstart.md` verification per T024 (missing)
