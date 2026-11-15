# Quickstart Validation Guide: Production Voice Baseline

**Feature**: `001-production-voice-baseline` | **Date**: 2026-11-15

## Prerequisites
- Node.js 20+ and Docker (PostgreSQL 16 for API/worker tests)
- `npm install` completed at repository root

## 1. Automated Verification Gates
```bash
npm run typecheck
npm run check:gateway
npm run build
npm test
```
Expected: All TypeScript checks, 42+ gateway JS syntax checks, production builds, and unit/integration tests pass with zero failures.

## 2. Recording & Duration Cap Validation (`FR-001`, `FR-008`)
1. Place a test call to an agent/extension with `stt.enabled: false` (e.g. `9000` / `default`) and no explicit `recording.enabled: false`.
2. Speak and interrupt the agent mid-sentence (`barge-in`), then let the call run or hang up.
3. Verify `/v1/recordings` (and **Telefonia & Gravações**) lists the new `.wav` + `.txt` recording with `recordingFile !== null` and PII redaction applied.
4. Configure `maxDurationSec: 30` on a test agent; verify wrap-up cue triggers around `15s` and call terminates cleanly at `30s` with `hangupBy: duration_cap`.

## 3. Concurrency & Security Validation (`FR-002`, `FR-004`, `FR-005`)
1. Set `maxConcurrentCalls: 1` on a test tenant and place two simultaneous calls; verify the first stays active and the second returns `486`/`429` (re-queued if outbound campaign).
2. Request `/v1/calls/history` and `/v1/recordings` without `Authorization` header (or `?token=`); verify HTTP `401`.
3. Deliver a webhook with an invalid `X-Webhook-Signature`; verify rejection.

## 4. WebRTC Portal Proxy Validation (`FR-012`)
1. Open **Canais** in `apps/web` over HTTPS (or `localhost`).
2. Verify the **WebRTC / Web Widget** card is visible, shows HTTPS readiness status, and `POST /api/telephony/webrtc/token` succeeds without exposing port `8090`.
