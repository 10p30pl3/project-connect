# Interface Contracts: Production Voice Baseline

**Feature**: `001-production-voice-baseline` | **Date**: 2026-11-15

## 1. Shared Schema Contracts (`packages/shared`)
- `voice-agent-tenant.schema.json`:
  - `recording: { enabled?: boolean }` (default `true`).
  - `limits: { maxDurationSec: number (default 180), maxConcurrentCalls: number (default 200) }`.
- `connector-event.schema.json`:
  - Preserves all existing fields (`callId`, `attemptId`, `outcome`, `durationSec`, `costUsd`, `recordingUrl`, `transcript`).
  - Adds optional `failureStage` and `correlationId` (backward-compatible).

## 2. WebRTC Portal Reverse Proxy (`apps/api` + `deploy/nginx.conf`)
All routes are additive and authenticate via standard session/JWT (or scoped widget token for public embed):
- `POST /api/telephony/webrtc/token` → proxies to `voice-gateway` `POST /v1/webrtc/token`
- `POST /api/telephony/webrtc/offer` → proxies to `voice-gateway` `POST /v1/webrtc/offer`
- `POST /api/telephony/webrtc/:callId/ice` → proxies to `voice-gateway` `POST /v1/webrtc/:callId/ice`
- `DELETE /api/telephony/webrtc/:callId` → proxies to `voice-gateway` `DELETE /v1/webrtc/:callId`
- `GET /voll-voice-widget.js` (`nginx.conf` → `api:3333/api/telephony/webrtc/widget.js` → `voice-gateway`)

## 3. Capacity Rejection & Re-queue Contract
- **Inbound SIP**: When `activeCalls(tenantId) >= tenant.maxConcurrentCalls`, gateway responds `486 Busy Here` (or `503`) and logs `REJECTED_CAPACITY`.
- **Outbound HTTP (`POST /v1/calls`)**: Returns HTTP `429` (`{ error: 'tenant_capacity_exceeded', retryAfterSec: 15 }`). `apps/api` outbound worker treats `429`/`503` as retryable and re-queues the attempt without marking the contact failed.

## 4. Webhook Signing Contract
- Outbound webhooks from `apps/voice-gateway` and `apps/api` sign the raw JSON body using `HMAC-SHA256` with the connection's `webhook_secret`:
  - `X-Webhook-Signature: sha256=<hmac>`
  - `X-Webhook-Timestamp: <unix_sec>`
- `apps/api` connector webhook receiver enforces signature verification whenever `webhook_secret` is configured on the connection.
