# Research & Gap Analysis: Production Voice Baseline (Vapi & Bland Benchmark)

**Feature**: `001-production-voice-baseline` | **Date**: 2026-11-15

## 1. Benchmark Findings (Vapi vs. Bland AI)

### Decision: Hybrid Modular + Campaign-Ready Architecture (Additive Evolution)
- **Decision**: Adopt Vapi's granular per-call observability, real-time turn latency tracking, and WebRTC/SIP modularity alongside Bland AI's outbound pacing, concurrency/duration guardrails, and HMAC-signed webhooks (`X-Webhook-Signature`), while strictly preserving all existing Voll Plan / `voice-gateway` capabilities (`FR-011`).
- **Rationale**: Voll Plan already has the core building blocks (`apps/api` outbox/worker, `apps/voice-gateway` with OpenAI Realtime + ElevenLabs STS + `CrosstalkFilter` + `CallRecorder`, and `packages/shared` contracts). Only targeted, additive deltas are required to reach full Vapi/Bland production parity.
- **Alternatives considered**:
  - *Rebuilding on a third-party SaaS (Vapi/Bland directly)*: Rejected because Voll Plan already runs on-premise FreeSWITCH/Drachtio + custom `CrosstalkFilter` + local Postgres ledger, and migrating would lose existing multi-tenant SIP/campaign infrastructure.

## 2. Codebase Gap Analysis (What Exists vs. Additive Deltas)

### 2.1 Call Duration Limits (`FR-001`)
- **Existing**: `apps/voice-gateway/index.js` enforces `this.maxDurationSec` (default `180s`) with a pre-hangup warning timer and hard hangup timer; `apps/api/src/connectors/voice-app.ts` passes `limits.maxDurationSec` (currently falling back to `300s`).
- **Decision**: Standardize default `maxDurationSec` fallback to `180` across both `voice-app.ts` and `voice-gateway`, and adjust `warningLeadSec` to `15s` (when `maxDurationSec > 20`) so callers/agents always get a 15-second wrap-up cue before deterministic hangup.
- **Alternatives considered**: Hard silent cut at `180s` (rejected in Clarifications Q1).

### 2.2 Concurrency Limits (`FR-002`)
- **Existing**: `apps/voice-gateway/utils/tenant-manager.js` tracks `maxConcurrentCalls` (default `200`) and CPS.
- **Decision**: Ensure inbound SIP INVITEs exceeding `maxConcurrentCalls` return SIP `486 Busy Here` / `503 Service Unavailable` immediately with a logged capacity event, while `apps/api` outbound worker treats `429`/`503` capacity responses from `voice-gateway` as retryable/re-queued attempts rather than permanent failures.
- **Alternatives considered**: Queuing inbound SIP calls in ringing state (rejected in Clarifications Q3).

### 2.3 Default Stereo Recording Decoupled from STT (`FR-008`)
- **Existing**: `apps/voice-gateway/index.js` (`L1034`) currently gates `CallRecorder` behind `if (this.whisperSession && this.whisperSession.isSttEnabled)`. As a result, tenants with `stt.enabled: false` (like `default` / `9000`) produce `recordingFile: null`.
- **Decision**: Change the gate to `if (this.tenant.recording?.enabled !== false && !this.isToneProbe)` so dual-channel `.wav` + PII-redacted `.txt` recording is ON by default for all tenants, decoupled from optional external Whisper STT, while preserving fail-open disk handling and explicit per-tenant opt-out (`recording.enabled: false`).
- **Alternatives considered**: Enabling `stt.enabled: true` on `9000` in `tenants.json` only (rejected because future tenants would still silently skip recording).

### 2.4 External API Security & Signed Webhooks (`FR-004`, `FR-005`)
- **Existing**: `apps/voice-gateway/utils/api-router.js` enforces `API_AUTH_TOKEN` (including `?token=` for SSE); `apps/voice-gateway/utils/voll-webhook.js` signs payloads with `sha256=` HMAC; `apps/api` enforces JWT/cookie auth in `NODE_ENV=production`.
- **Decision**: Enforce HMAC signature + timestamp verification on incoming connector webhooks when `webhook_secret` is configured, ensure all external AI/provider API keys are masked in API responses (`hasKey` / `****`) and never logged, and add `X-Webhook-Signature` support for outbound customer event webhooks.
- **Alternatives considered**: IP allowlist only (insufficient across cloud/tunnel topologies).

### 2.5 End-to-End Transaction Observability (`FR-006`, `FR-007`)
- **Existing**: `callId`, `channelUuid`, `attemptId`, `delayMs`, `aiCostTracker`, `tenant_billing_ledger`, and `LiveVoiceMonitor` exist.
- **Decision**: Propagate `attemptId` / `correlationId` consistently across `POST /v1/calls` → `calls_history.jsonl` → webhook events → `attempts` table, and ensure premature/provider failures (`429`/`5xx`/signaling/duration cap) always emit structured failure stage & reason codes.

### 2.6 WebRTC Portal Proxy & Channel Visibility (`FR-012`)
- **Existing**: `apps/voice-gateway` already implements `/v1/webrtc/token`, `/v1/webrtc/offer`, `/v1/webrtc/:id/ice`, `DELETE /v1/webrtc/:id`, and `public/voll-voice-widget.js`. However, `apps/api` and `deploy/nginx.conf` do not proxy them, and `Channels.tsx` only shows `VOICE`, `WHATSAPP`, `SMS`, `EMAIL`.
- **Decision**: Add authenticated `/api/telephony/webrtc/*` proxy routes in `apps/api/src/modules/telephony.ts` and `/voll-voice-widget.js` proxy in `deploy/nginx.conf`, plus a visible **WebRTC / Web Widget** card in `Channels.tsx` (with tooltip-only guidance per Constitution IV and an HTTPS warning badge when accessed over plain `http://`).
- **Alternatives considered**: Exposing port `8090` directly on the public internet (rejected per Constitution V and FR-012).
