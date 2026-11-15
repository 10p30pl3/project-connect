# Implementation Plan: Production Voice Baseline (Vapi & Bland Benchmark)

**Branch**: `001-production-voice-baseline` | **Date**: 2026-11-15 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/001-production-voice-baseline/spec.md)

**Input**: Feature specification from `/specs/001-production-voice-baseline/spec.md`

## Summary

Elevate the existing Voll Plan + `voice-gateway` stack to full Vapi/Bland AI production baseline readiness using strictly additive, backward-compatible changes (`FR-011`). Specifically: standardize `180s` max call duration with a 15-second wrap-up cue (`FR-001`), enforce capacity rejection (`486`/`429`) + outbound campaign re-queuing (`FR-002`), decouple default stereo recording from optional external Whisper STT (`FR-008`), enforce HMAC-SHA256 webhook verification and masked secrets (`FR-004`, `FR-005`), unify end-to-end correlation/failure-stage observability (`FR-006`, `FR-007`), and expose authenticated `/api/telephony/webrtc/*` reverse-proxy routes and **WebRTC / Web Widget** channel visibility in `apps/web` (`FR-012`).

## Technical Context

**Language/Version**: TypeScript 5.7 (Node 20+ ESM for `apps/api`, `packages/shared`, React 19 + Vite 6 for `apps/web`), Node.js CommonJS (`apps/voice-gateway`), Python (`services/whisper`)
**Primary Dependencies**: Fastify 5, `pg`, Zod, TanStack Query/Table, React Hook Form, Radix UI, Tailwind 4, Drachtio SRF, FreeSWITCH ESL, `ws`, `wrtc`
**Storage**: PostgreSQL 16 (`apps/api/migrations/`), disk WAV/TXT/JSONL (`apps/voice-gateway/recordings/`)
**Testing**: Node/Vitest/Postgres API tests (`npm test` in `@voll/api`), `CrosstalkFilter` & feature tests (`@voll/voice-gateway`), `tsc --noEmit`, `vite build`, `node scripts/check-syntax.js`
**Target Platform**: Linux Docker Compose (`deploy/docker-compose.prod.yml` on `194.163.151.91`) + PM2 telephony node (`192.168.15.36`) + Vercel (`vercel.json`)
**Project Type**: Monorepo web application + real-time voice gateway
**Performance Goals**: Median voice turn latency `< 800ms`, barge-in stop `< 250ms`, duration-cap teardown `< 2s`, record persistence within `5s` of hangup
**Constraints**: Zero breaking changes to existing campaigns, outbox, calendars, SIP trunks, AI bridges, or existing 183+ recordings (`FR-011`); tooltip-only UI guidance in `apps/web` (Constitution IV)
**Scale/Scope**: Multi-tenant workspaces, up to 200+ concurrent calls per tenant/node (`maxConcurrentCalls`), single-region primary voice cluster

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Shared Contracts & Explicit Schemas**: PASS — Additive schema updates go into `packages/shared` and `packages/shared/contracts` (`npm run contracts`).
- **II. Idempotent Execution & Explicit Persistence**: PASS — Outbound capacity retries (`429`/`503`) reuse existing outbox/attempt idempotency in PostgreSQL 16.
- **III. Real-Time Voice Performance & Fail-Open Reliability**: PASS — Keeps existing `CrosstalkFilter` + `FrameVad` barge-in pipeline and preserves fail-open `CallRecorder` when decoupled from STT.
- **IV. High-Density UI & Tooltip-Only Guidance**: PASS — New WebRTC card/controls in `Channels.tsx` will use `tooltip="..."` / `<InfoTooltip />` exclusively without explanatory paragraphs.
- **V. External API Security & Multi-Tenant Isolation**: PASS — WebRTC proxied behind authenticated `apps/api` + `nginx.conf` (no public port `8090` exposure), webhook HMAC enforced, secrets masked.
- **VI. Explicit Call Duration & Concurrency Limits**: PASS — `180s` default + `15s` wrap-up cue + deterministic `maxConcurrentCalls` rejection/re-queue.
- **VII. End-to-End Transaction Observability**: PASS — Unified correlation IDs (`callId`, `channelUuid`, `attemptId`) and explicit `failureStage` across gateway, webhooks, and DB.

## Project Structure

### Documentation (this feature)

```text
specs/001-production-voice-baseline/
├── plan.md              # This file
├── research.md          # Phase 0: Vapi/Bland benchmark + codebase gap analysis
├── data-model.md        # Phase 1: Entities, lifecycle states, invariants
├── quickstart.md        # Phase 1: Validation scenarios & gates
├── contracts/           # Phase 1: Shared schemas, WebRTC proxy, webhook & capacity contracts
│   └── production-voice-contracts.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root — targeted additive touchpoints)

```text
packages/shared/
├── src/index.ts
└── contracts/
    ├── connector-event.schema.json
    └── voice-agent-tenant.schema.json

apps/voice-gateway/
├── index.js                         # 15s wrap-up cue, recording default decoupled from STT, failureStage
├── utils/
│   ├── tenant-manager.js            # 180s default, recording default, capacity checks
│   ├── api-router.js                # 429 capacity response, recording opt-out support
│   └── voll-webhook.js              # HMAC-SHA256 + timestamp header

apps/api/
├── src/connectors/voice-app.ts      # 180s fallback, 429/503 retryable capacity handling, correlationId
└── src/modules/telephony.ts         # /api/telephony/webrtc/* proxy + widget.js + webhook signature check

apps/web/
└── src/pages/Channels.tsx           # WebRTC / Web Widget visibility card (tooltip-only, HTTPS notice)

deploy/
└── nginx.conf                       # /voll-voice-widget.js proxy to api:3333
```

## Post-Design Constitution Check

Re-evaluated after Phase 1 artifacts (`research.md`, `data-model.md`, `contracts/production-voice-contracts.md`, `quickstart.md`): all 7 principles remain satisfied with zero unjustified complexity or breaking changes.
