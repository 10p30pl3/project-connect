# Feature Specification: Production Voice Baseline (Vapi & Bland Benchmark)

**Feature Branch**: `001-production-voice-baseline`
**Created**: 2026-11-15
**Status**: Draft
**Input**: User description: "faz um benchmark de solucoes como vapi e bland para funcoes iniciais necessarias para colocar em producao"

## Clarifications

### Session 2026-11-15

- Q: Como o sistema deve encerrar uma chamada que atinge o limite máximo de duração (`maxDurationSec`), e qual deve ser o limite padrão quando não houver valor explícito no agente? → A: Aviso automático nos últimos 15s e desligamento forçado no limite exato, com padrão de `180s` quando não configurado (preservando configurações existentes).
- Q: Restrição geral de evolução do sistema → A: Nenhuma funcionalidade já construída pode ser removida ou quebrada; melhorias e novos recursos devem ser estritamente aditivos e retrocompatíveis.
- Q: A gravação estéreo (`.wav` + `.txt` com redação de PII) deve ficar ativa por padrão em todos os ramais/agentes, ou depender de habilitação manual? → A: Ativa por padrão para todos os agentes/ramais (desacoplada do STT externo), com opção explícita para desativar por agente.
- Q: Quando um agente/tenant atingir o limite máximo de chamadas simultâneas (`maxConcurrentCalls`), como tratar novas chamadas inbound e outbound? → A: Rejeitar imediatamente chamadas inbound com código de ocupado (`486`/`503`) e reagendar/enfileirar chamadas outbound na fila da campanha.
- Q: Como o canal WebRTC (chamadas pelo navegador / Web Voice Widget) deve ser exposto nesta entrega inicial de produção? → A: Incluir proxy seguro de sinalização/widget WebRTC pelo portal principal (funcionando em HTTPS) e visibilidade explícita na tela Canais.

## Benchmark Summary (Vapi vs. Bland AI vs. Production Baseline)

| Capability Area | Vapi Benchmark | Bland AI Benchmark | Required Initial Production Baseline |
| :--- | :--- | :--- | :--- |
| **Voice Performance & Turn-Taking** | Sub-500ms pipeline latency, configurable interruption (barge-in) & endpointing | Proprietary low-latency speech pipeline tuned for outbound pacing | Sub-800ms median turn latency, deterministic barge-in, echo/crosstalk suppression, silence/idle recovery |
| **Call Duration & Concurrency Limits** | Concurrent line caps per tier, per-minute usage guards | Plan-gated concurrent call limits, campaign pacing caps | Explicit max call duration, max concurrent calls per tenant, silence timeout, deterministic teardown |
| **External API Security & Auth** | Bearer API keys, scoped client tokens, SOC 2 / enterprise isolation | API key auth, `X-Webhook-Signature` (HMAC-SHA256) verification | Authenticated control/stream surfaces, signed webhooks, TLS for public/WebRTC, masked secrets, tenant isolation |
| **Transaction Observability** | Per-layer cost/latency breakdown (STT, LLM, TTS, telephony), live event streams | Call outcome dashboard, transcripts, extracted variables, live/post-call streams | Correlated IDs across every hop, turn-level latency & cost breakdown, stereo recordings, PII-redacted transcripts, failure reasons |
| **Campaign & Channel Readiness** | Modular voice agents, tool calling, WebRTC/SIP SDKs, transfers | Visual Pathways, mass outbound dialing, warm transfers, voicemail handling | Draft/publish agent versioning, pre-launch simulation, outbound pacing, SIP + WebRTC channel parity, call transfer & AMD |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real-Time Voice Performance & Natural Turn-Taking (Priority: P1)

A caller or recipient interacts with an AI voice agent over telephony or browser audio and experiences natural, responsive conversation without awkward pauses, self-interruption from speaker echo, or ignored interruptions when the user speaks over the agent.

**Why this priority**: Real-time voice quality is the core product experience; if latency spikes or barge-in fails, callers hang up regardless of downstream features.

**Independent Test**: Place live inbound and outbound test calls across speakerphone and handset modes, interrupt the agent mid-sentence multiple times, and verify response latency, interruption speed, and zero echo self-triggers.

**Acceptance Scenarios**:

1. **Given** an active call where the AI agent is speaking, **When** the human caller speaks clearly for at least 60ms, **Then** the agent stops speaking within 250ms and processes the caller's new utterance without completing the interrupted sentence.
2. **Given** an active call on speakerphone (`viva-voz`) with agent audio playing, **When** only residual echo returns on the microphone channel, **Then** the system suppresses the echo and does not trigger false interruptions or ghost responses.
3. **Given** an active call experiencing silence from the caller, **When** silence persists beyond the configured idle threshold, **Then** the agent issues a configurable check-in prompt or closes the call gracefully with a clear reason.

---

### User Story 2 - Explicit Call Duration, Concurrency & Cost Guardrails (Priority: P1)

An operations administrator configures hard limits for maximum call duration and simultaneous active calls per tenant/campaign so external AI and telephony usage cannot run unbounded due to hung sessions, loops, or traffic spikes.

**Why this priority**: External real-time AI and telephony APIs bill per second/token; missing hard caps creates direct financial exposure and channel exhaustion in production.

**Independent Test**: Configure a tenant with a 30-second max call duration and concurrency limit of 1, start calls exceeding those bounds, and verify deterministic hangup at 30s and rejection/queuing of the second simultaneous call.

**Acceptance Scenarios**:

1. **Given** a tenant with an explicit maximum call duration configured (or defaulting to `180s` when omitted), **When** an active call reaches 15 seconds before the limit, **Then** the system triggers a wrap-up warning and, upon reaching the exact limit, terminates the call deterministically and releases all media and external AI connections within 2 seconds.
2. **Given** a tenant at its maximum concurrent call capacity, **When** a new call arrives for that tenant, **Then** inbound calls are rejected immediately with busy/capacity signaling (`486`/`503`) and outbound campaign calls are re-queued for retry without degrading active calls.
3. **Given** an active external AI session whose remote socket stalls or stops responding, **When** the turn/stream watchdog expires, **Then** the system closes the session cleanly, records the failure reason, and frees the concurrency slot.

---

### User Story 3 - External API Security, Signed Webhooks & Tenant Isolation (Priority: P1)

A security-conscious platform operator deploys voice services connected to external AI providers and customer webhook receivers with strict authentication, encrypted public transport, signed webhook payloads, and zero cross-tenant data leakage.

**Why this priority**: Production exposure of unauthenticated media controls, unsigned webhooks, or external API credentials compromises customer data and incurs unauthorized API spend.

**Independent Test**: Attempt unauthenticated requests to control/stream endpoints, send a tampered webhook signature, and verify both are rejected while authorized single-tenant operations succeed without exposing secrets.

**Acceptance Scenarios**:

1. **Given** production mode is active, **When** a client accesses call control, live monitoring streams, or recordings without valid credentials, **Then** the request is denied with an authorization failure and logged in the security audit trail.
2. **Given** an outbound webhook configured with a signing secret, **When** the platform delivers call lifecycle or post-call events, **Then** every delivery includes a verifiable cryptographic signature header and timestamp so receivers can reject tampered or replayed payloads.
3. **Given** stored external provider API keys and PII in call data, **When** configuration, logs, or transcripts are viewed by operators, **Then** API keys remain masked/write-only and sensitive PII (tax IDs, payment cards, emails) is redacted in transcripts.

---

### User Story 4 - End-to-End Transaction Observability & Recordings (Priority: P1)

A supervisor investigates any live or completed call and sees a single correlated timeline showing call setup, turn-by-turn latency, external AI token/minute costs, stereo audio recording, redacted transcript, and exact hangup cause.

**Why this priority**: Production voice systems cannot be debugged or billed accurately without correlated observability across telephony, external AI APIs, and campaign outcomes.

**Independent Test**: Complete a multi-turn call and verify that a single correlation ID links the campaign attempt, live monitor metrics, stereo audio playback, transcript turns with latency labels, cost breakdown, and final hangup reason.

**Acceptance Scenarios**:

1. **Given** any initiated call (inbound, outbound, or web), **When** the call progresses and finishes, **Then** every lifecycle event, external API request, and webhook delivery shares a persistent correlation ID traceable from start to finish.
2. **Given** a completed call on any enabled voice tenant, **When** the supervisor opens Call History & Recordings, **Then** they can play back dual-channel stereo audio (caller left, agent right), read the timestamped transcript with per-turn response latency, and inspect itemized duration and cost metrics.
3. **Given** a failed or prematurely dropped call, **When** the supervisor inspects the call record, **Then** the exact stage of failure (signaling, media setup, external AI provider, duration cap, or operator hangup) is explicitly recorded.

---

### User Story 5 - Production Agent Lifecycle, Transfers & Outbound Readiness (Priority: P2)

A team prepares a voice agent for live traffic by editing drafts safely, running pre-publish simulations, routing calls across telephony or browser audio, handling human handoffs, and distinguishing voicemail from live humans.

**Why this priority**: Inspired by Vapi's modular readiness and Bland's campaign workflows, safe publishing and call handoffs prevent broken prompts from reaching live customers.

**Independent Test**: Edit an agent draft without affecting the published version, run a pre-publish evaluation, publish the version, and verify live calls use the newly published configuration and support transfer to a human extension.

**Acceptance Scenarios**:

1. **Given** a published voice agent serving live traffic, **When** an editor saves changes to a draft, **Then** active and new calls continue using the published version until the editor explicitly runs validation and clicks Publish.
2. **Given** an active call where the caller requests a human or hits an escalation rule, **When** a transfer action is triggered, **Then** the call bridges cleanly to the target human extension or external number without dropping the caller.
3. **Given** an outbound campaign call, **When** answering machine detection (AMD) identifies a voicemail greeting, **Then** the system follows the tenant's configured policy (hang up, leave message, or shadow-log) and records the exact disposition.

### Edge Cases

- What happens when an external AI provider returns rate-limit (`429`) or transient server errors (`5xx`) mid-call? The system must terminate or fail over gracefully within a bounded timeout, notify the caller or operator, and log the provider error code.
- What happens when disk recording fails or storage is full during an active call? Recording fails open so the live voice conversation continues uninterrupted while logging a recording-health alert.
- What happens when a browser WebRTC caller connects over an insecure (`http://`) origin? The UI clearly informs the operator that HTTPS is required for microphone capture rather than failing silently.
- What happens when a call ends abruptly before the media stream connects? The concurrency slot is released immediately, and the call record is finalized with duration `0s` and the signaling failure reason.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST enforce configurable per-tenant and per-call maximum call duration limits (defaulting to `180s` when omitted), delivering a wrap-up cue 15 seconds before expiration and automatically terminating expired calls while releasing all external sessions and media channels.
- **FR-011**: System MUST preserve full backward compatibility with all existing production features (campaigns, outbox, calendars, SIP trunks/extensions, existing AI bridges, recordings, and history) so improvements are strictly additive and non-breaking.
- **FR-012**: System MUST expose authenticated WebRTC signaling and web-widget delivery through the main portal/API reverse proxy (for HTTPS origins) with explicit visibility and status inside Channels, without exposing internal voice-gateway ports directly to the public internet.
- **FR-002**: System MUST enforce configurable per-tenant maximum concurrent call limits across inbound, outbound, and browser calls, rejecting excess inbound calls immediately (`486`/`503`) and re-queuing excess outbound campaign attempts deterministically.
- **FR-003**: System MUST provide low-latency real-time voice turn-taking with configurable interruption (barge-in) sensitivity, echo/crosstalk suppression, and silence/idle timeout handling.
- **FR-004**: System MUST require valid authentication on all control, live-monitoring, history, and recording endpoints in production and isolate data strictly by workspace/tenant.
- **FR-005**: System MUST mask external API credentials in all UI responses and logs and sign all outbound lifecycle/post-call webhooks with verifiable HMAC-SHA256 signatures.
- **FR-006**: System MUST assign and propagate unique correlation identifiers across campaign attempts, telephony signaling, external AI sessions, webhooks, and recordings.
- **FR-007**: System MUST capture and display per-call observability: lifecycle timeline, per-turn response latency, itemized external AI/telephony cost and token usage, and explicit termination/failure reasons.
- **FR-008**: System MUST record dual-channel stereo audio and timestamped, PII-redacted transcripts **by default for all voice tenants** (decoupled from optional external STT, with an explicit per-tenant opt-out flag), using fail-open persistence and preserving all existing recordings.
- **FR-009**: System MUST separate agent draft editing from published production versions and require explicit publish actions to update live call behavior.
- **FR-010**: System MUST support live call transfer (warm/cold SIP or extension handoff) and configurable answering machine detection (AMD) dispositions for outbound campaigns.

### Key Entities

- **Voice Agent / Tenant**: Configuration profile defining voice engine, prompt/persona, language, max call duration, max concurrent calls, recording policy, and published vs. draft versions.
- **Call Session**: Real-time transaction instance linking correlation IDs, caller/callee, direction, start/end timestamps, active state, and termination reason.
- **Turn Telemetry & Cost Record**: Per-turn and per-call metrics capturing user/agent transcript turns, response latency, token consumption, and itemized monetary cost.
- **Call Recording**: Paired dual-channel audio artifact and PII-redacted transcript linked to a Call Session and governed by retention/deletion controls.
- **Webhook Subscription**: Outbound event endpoint configuration holding target URL, subscribed lifecycle events, and HMAC signing secret.

## Assumptions

- Initial production deployments operate with a single primary voice gateway cluster per region connected to external AI speech-to-speech/LLM providers and SIP trunks.
- Answering machine detection and optional external transcription run as auxiliary services; core real-time conversation and stereo recording must remain operational even if auxiliary services are offline.
- Browser-based WebRTC access in production will be served behind an HTTPS-terminated reverse proxy or domain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Median agent response latency (end of user speech to first agent audio frame) remains under **800ms** on stable connections, and valid user interruptions halt agent playback within **250ms**.
- **SC-002**: **100%** of calls exceeding their configured maximum duration terminate within **2 seconds** of the limit, with zero leaked concurrency slots or orphaned external AI sessions.
- **SC-003**: **100%** of production API/stream endpoints reject unauthenticated requests, and **100%** of outbound webhook deliveries carry verifiable cryptographic signatures with zero plaintext API keys exposed in UI or logs.
- **SC-004**: **100%** of completed calls produce a traceable transaction record containing correlation ID, duration, termination reason, and itemized cost within **5 seconds** of call end.
- **SC-005**: Recording persistence achieves **99.9%+** availability on enabled tenants while maintaining **0%** call drops caused by recording I/O errors.
