<!--
Sync Impact Report:
- Version change: 1.0.0 -> 1.1.0 (MINOR: strengthened real-time voice performance and external API security; added Principles VI and VII)
- Modified principles:
  - III. Real-Time Voice Reliability & Fail-Open Recording -> III. Real-Time Voice Performance & Fail-Open Reliability
  - V. Security, Isolation & Multi-Tenant Boundaries -> V. External API Security & Multi-Tenant Isolation
- Added sections:
  - Principle VI. Explicit Call Duration & Concurrency Limits
  - Principle VII. End-to-End Transaction Observability
- Removed sections: none
- Follow-up TODOs: none
-->
# Voll Plan Constitution

## Core Principles

### I. Shared Contracts & Explicit Schemas
Every cross-service boundary between `apps/web`, `apps/api`, `apps/voice-gateway`, and `services/whisper` MUST be governed by explicit Zod and JSON Schema contracts in `packages/shared`. Any change to call requests, connector webhook payloads, or tenant configurations MUST update `packages/shared/contracts` (`npm run contracts`) before or alongside implementation so both producers and consumers validate the same schema.

### II. Idempotent Execution & Explicit Persistence
Campaign execution, worker outbox processing, and telephony/channel webhooks MUST remain idempotent and concurrency-safe using PostgreSQL 16 explicit SQL (`FOR UPDATE SKIP LOCKED`, `api_idempotency_records`, and `connector_inbox`). State transitions and billing ledger entries MUST be atomic, auditable, and resilient to duplicate webhook deliveries or worker restarts.

### III. Real-Time Voice Performance & Fail-Open Reliability
Real-time voice performance is a primary product requirement: audio pipelines (`apps/voice-gateway` with Drachtio, FreeSWITCH, OpenAI Realtime, and ElevenLabs STS) MUST minimize end-to-end turn latency, keep media loops non-blocking, suppress echo/crosstalk, and execute barge-in deterministically. Auxiliary subsystems (`CallRecorder`, PII redaction, whisper/AMD telemetry) MUST fail open so active call audio never stalls or drops due to disk, transcription, or downstream HTTP latency.

### IV. High-Density UI & Tooltip-Only Guidance
In `apps/web`, operational screens (`PageHeader`, `Card`, `Field`) MUST NOT display inline explanatory paragraphs, instructional subtitles, or conceptual hints in the visual body. All conceptual explanations and field guidance MUST live exclusively inside `(?)` help tooltips (`tooltip="..."` / `<InfoTooltip />`) to preserve high operational density for supervisors and operators, with all user-facing copy in pt-BR.

### V. External API Security & Multi-Tenant Isolation
Because the platform relies on external APIs (OpenAI Realtime, ElevenLabs, SIP trunks, and outbound webhooks), security is non-negotiable: all production endpoints MUST enforce authentication (`NODE_ENV=production` requires login; `apps/voice-gateway` enforces `API_AUTH_TOKEN` on API and SSE routes), webhook signature/secret validation, and strict workspace/tenant scoping (`manageGuard`, `ensureOwnershipSynced`). External API keys, secrets, and `.env*` files MUST never be committed, hardcoded, or logged in plaintext, and public/WebRTC surfaces MUST run over TLS/HTTPS in production.

### VI. Explicit Call Duration & Concurrency Limits
Every voice tenant, campaign, and active call MUST enforce explicit, configurable maximum duration (`maxDurationSec`) and concurrency (`maxConcurrentCalls`) limits. When a call reaches its duration cap or a tenant hits its channel limit, the gateway and API MUST terminate or reject the session deterministically and release media/AI WebSocket resources immediately to prevent runaway external API usage or leaked channels.

### VII. End-to-End Transaction Observability
All transactions across HTTP APIs, worker outbox jobs, external AI/telephony API calls, webhook deliveries, and real-time voice sessions MUST be fully observable and traceable via correlation IDs (`callId`, `channelUuid`, `attemptId`, `workspaceId`). Every call and transaction MUST record structured lifecycle events, turn-level latency metrics, token/cost accounting (`aiCostTracker`, `tenant_billing_ledger`), hangup/failure reasons, and audit logs without leaking sensitive PII or secrets.

## Technical Stack & Architecture Constraints

- **Monorepo Workspaces**: `apps/web` (React 19, TypeScript, Vite, TanStack Query/Table, React Hook Form + Zod, Radix UI, Tailwind 4), `apps/api` (Fastify 5, TypeScript, Zod, `pg`), `apps/voice-gateway` (Node.js CommonJS, Drachtio SRF, FreeSWITCH ESL, WebRTC/WS media bridges), `services/whisper` (Python AMD, transcription, voice biometrics), and `packages/shared`.
- **Database & Migrations**: PostgreSQL 16 with versioned SQL migrations under `apps/api/migrations/` and automated pre-migration backups in production (`deploy/deploy.sh`).
- **Deployment Targets**: Docker Compose production stack (`deploy/docker-compose.prod.yml`) and Vercel (`vercel.json`) for `apps/api` and `apps/web`, paired with PM2-managed `voice-app` and reverse tunnel connectivity (`VOICE_APP_BASE_URL`) for the telephony node.

## Development Workflow & Quality Gates

- **Type & Syntax Verification**: Every code change MUST pass `npm run typecheck` across TypeScript workspaces (`@voll/shared`, `@voll/api`, `@voll/web`) and `npm run check:gateway` (`node scripts/check-syntax.js`) for `@voll/voice-gateway`.
- **Build & Automated Tests**: Production builds (`npm run build`) and automated tests (`npm test` against `voll_connect_test` and `@voll/voice-gateway` unit tests) MUST pass before deploying to production.
- **Spec-Driven Delivery**: New features SHOULD follow the Spec Kit workflow (`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`) anchored to this constitution.

## Governance

- This constitution supersedes ad-hoc conventions across all workspaces; pull requests, code reviews, and AI-assisted implementations MUST verify compliance with Principles I–VII and the quality gates above.
- Amendments require updating `.specify/memory/constitution.md` with a Semantic Versioning bump (`MAJOR` for incompatible principle removals/redefinitions, `MINOR` for new principles or material expansions, `PATCH` for clarifications) and updating `Last Amended`.
- Runtime UI/UX and agent behavior details remain documented in `agentes.md` and `README.md`, which MUST stay consistent with this constitution.

**Version**: 1.1.0 | **Ratified**: 2026-11-15 | **Last Amended**: 2026-11-15
