# Data Model: Production Voice Baseline

**Feature**: `001-production-voice-baseline` | **Date**: 2026-11-15

## 1. Core Entities & Extensions (Additive / Backward-Compatible)

### 1.1 Voice Agent / Tenant (`tenants.json` + `packages/shared` schema)
- **Existing fields preserved**: `id`, `name`, `extension`, `dids`, `stsEngine` (`openai` | `elevenlabs`), `voice`, `openaiModel`, `elevenlabsVoiceId`, `elevenlabsModel`, `instructions`, `greeting`, `amd`, `stt`, `crosstalkFilter`, `active`.
- **Standardized / Added rules**:
  - `maxDurationSec`: integer, default `180`, min `15`, max `3600`. Triggers wrap-up cue at `max(5, maxDurationSec - 15)` seconds and hard hangup at `maxDurationSec`.
  - `maxConcurrentCalls`: integer, default `200`, min `1`. Enforced per tenant across SIP inbound, outbound, and WebRTC sessions.
  - `recording`: `{ enabled: boolean }` — defaults to `true` when omitted (decoupled from `stt.enabled`).
  - `versionState`: `draft` vs `published` snapshot semantics in `connections.config` / `workspace_voice_resources`.

### 1.2 Call Session (`calls_history.jsonl` + `attempts`)
- **Identity & Correlation**:
  - `callId` (SIP Call-ID or `webrtc-...`)
  - `channelUuid` (FreeSWITCH UUID or WebRTC session UUID)
  - `attemptId` (optional, present for campaign outbound calls)
  - `workspaceId` & `tenantId`
- **Lifecycle States**:
  `INITIATED` → `RINGING` / `CONNECTING` → `ACTIVE` → (`TRANSFERRING` | `WRAPPING_UP`) → `COMPLETED` | `REJECTED_CAPACITY` | `FAILED_PROVIDER` | `FAILED_SIGNALING` | `TERMINATED_DURATION_CAP`
- **Termination Metadata**:
  - `hangupReason` (human-readable pt-BR reason)
  - `hangupBy` (`caller` | `agent` | `system` | `operator` | `duration_cap` | `provider_error`)
  - `failureStage` (`signaling` | `media` | `ai_provider` | `capacity` | `duration_cap` | `none`)

### 1.3 Turn Telemetry & Cost Record
- **Per-Turn**: `role` (`Cliente` | `Atendente`), `text` (PII-redacted), `timestamp`, `delayMs`, `delayLabel`.
- **Per-Call Aggregate**: `durationSec`, `totalTokens`, `inputTokens`, `outputTokens`, `costUsd`, `costBrl`, `recordingFile`, `transcriptFile`.

### 1.4 Call Recording
- **Files**: `<timestamp>_<tenantId>_<callId>.wav` (stereo 8kHz PCM L16: Left = Caller, Right = Agent) and `<timestamp>_<tenantId>_<callId>.txt` (PII-redacted dialog + timestamps + turn latency).
- **Invariants**:
  - Created whenever `tenant.recording?.enabled !== false` (independent of `stt.enabled`).
  - Fail-open: I/O errors log a warning without dropping the active call.

### 1.5 Webhook Subscription & Signed Delivery
- **Headers**:
  - `X-Webhook-Signature`: `sha256=<hex_hmac_sha256(secret, timestamp + "." + rawBody)>` (compatible with existing `sha256=<hex>` verification).
  - `X-Webhook-Timestamp`: Unix epoch seconds (reject replay > 300s skew).
  - `X-Correlation-Id`: `callId` / `attemptId`.
