# Implementation Plan: Visibilidade, Cadastro e Operação do Canal WebRTC (Web & WhatsApp Calling)

**Branch**: `004-webrtc-channel-visibility` | **Date**: 2026-11-15 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/004-webrtc-channel-visibility/spec.md)

**Input**: Feature specification from `/specs/004-webrtc-channel-visibility/spec.md`

## Summary

Tornar o canal **WebRTC** visível, auto-provisionado e gerenciável como tipo próprio (`WEBRTC`) em **Configuração → Canais** (Modos Básico e Avançado), unificando o atendimento em tempo real via **Web (Widget público com chave por canal)** e **WhatsApp Business Calling receptivo** (webhook Meta validado por HMAC, negociação de SDP no `voice-gateway` e resposta via Graph API), enquanto mantém `WEBRTC` isolado fora dos seletores de campanhas e jornadas outbound.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+ ESM em `apps/api` e `packages/shared`, React 19 + Vite 6 em `apps/web`), JavaScript CommonJS em `apps/voice-gateway`  
**Primary Dependencies**: Fastify 5, Zod, `pg` (PostgreSQL 16), TanStack Query, Lucide React, Node `node:crypto` (`HMAC-SHA256`), `ws` / WebRTC media bridge no gateway  
**Storage**: PostgreSQL 16 (`connections`, `workspace_voice_resources`, nova tabela `whatsapp_calling_sessions`, migrações sequenciais `020` e `021`)  
**Testing**: Vitest em `@voll/api` e `@voll/voice-gateway` (`npm test -w @voll/api`, `npm test -w @voll/voice-gateway`) + `npm run typecheck`, `npm run check:gateway`, `npm run build`  
**Target Platform**: Linux Docker Compose (Ubuntu/194 + túnel reverso gateway local) e navegador web desktop/mobile  
**Project Type**: Monorepo multi-package (`packages/shared`, `apps/api`, `apps/web`, `apps/voice-gateway`)  
**Performance Goals**: Negociação de oferta WebRTC / WhatsApp SDP em tempo real (<500ms no proxy/gateway local), resposta de desafio/webhook Meta idempotente sem bloquear áudio ativo  
**Constraints**: Separação obrigatória entre criação de enum `WEBRTC` (`020`) e backfill (`021`) devido às transações do `migrate.ts`; segredos Meta sempre mascarados na UI/API; explicações apenas em tooltips `(?)` (Princípio IV); falha fechada na assinatura `X-Hub-Signature-256` e validação `publicWidgetKey` + `allowedOrigins`  
**Scale/Scope**: Todos os workspaces novos e existentes; múltiplos canais `WEBRTC` por workspace (ex.: Web Widget e WhatsApp Calling)

## Constitution Check

*GATE: Verified before Phase 0 and re-checked post Phase 1 design.*

- **I. Shared Contracts & Explicit Schemas**: **PASS** — `CONNECTION_CHANNEL_TYPES`, `WEBRTC_MODES`, `ConnectionCreateSchema`, `ConnectionUpdateSchema`, `PublicWebRtcOfferSchema` e `InternalWebRtcEndedSchema` definidos em `packages/shared` com regeneração via `npm run contracts`.
- **II. Idempotent Execution & Explicit Persistence**: **PASS** — Migração `021` realiza backfill idempotente; `whatsapp_calling_sessions` garante idempotência por `whatsapp_call_id` contra reentregas duplicadas da Meta usando SQL explícito.
- **III. Real-Time Voice Performance & Fail-Open Reliability**: **PASS** — Reaproveita `WebRtcMediaBridge` e `WebRtcEndpointAdapter` não bloqueantes do `voice-gateway` para sessões Web e WhatsApp Calling.
- **IV. High-Density UI & Tooltip-Only Guidance**: **PASS** — Remoção do card estático separado e uso exclusivo de `tooltip="..."` / `<InfoTooltip />` em `pt-BR` na tela `Channels.tsx` (Modos Básico e Avançado).
- **V. External API Security & Multi-Tenant Isolation**: **PASS** — Validação estrita `workspace_voice_resources` no vínculo de `tenantId`; segredos Meta mascarados no DTO; `publicWidgetKey` por canal com validação opcional de `allowedOrigins` e rate-limit por IP; webhook Meta verificado via `X-Hub-Signature-256` (`timingSafeEqual`).
- **VI. Explicit Call Duration & Concurrency Limits**: **PASS** — Sessões WebRTC/WhatsApp iniciadas no gateway continuam sujeitas ao `maxDurationSec` e limites do `tenantId` vinculado ao canal, com término sincronizado (`terminate` à Meta quando encerrado pelo gateway).
- **VII. End-to-End Transaction Observability**: **PASS** — Auditoria em `connection.create/update/delete` e correlação `whatsappCallId <-> gatewayCallId <-> workspaceId <-> connectionId` registrada em `whatsapp_calling_sessions` e logs estruturados.

## Project Structure

### Documentation (this feature)

```text
specs/004-webrtc-channel-visibility/
├── spec.md                              # Especificação clarificada (/speckit-specify + /speckit-clarify)
├── plan.md                              # Este documento (/speckit-plan)
├── research.md                          # Decisões arquiteturais (Phase 0)
├── data-model.md                        # Entidades, mascaramento, state machine WhatsApp Calling (Phase 1)
├── quickstart.md                        # Roteiro de validação e testes (Phase 1)
├── checklists/
│   └── requirements.md                  # Checklist validado (16/16)
└── contracts/
    ├── api-webrtc-channel.md            # Contratos de API, widget público, webhook Meta & gateway
    └── ui-webrtc-channel.md             # Contratos de UI em Canais & isolamento outbound
```

### Source Code (repository root)

```text
packages/shared/src/
└── index.ts                             # CONNECTION_CHANNEL_TYPES ('WEBRTC'), WEBRTC_MODES, schemas de conexão

apps/api/
├── migrations/
│   ├── 020_webrtc_channel_enum.sql      # ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'WEBRTC'
│   └── 021_webrtc_channel_seed.sql      # Tabela whatsapp_calling_sessions + backfill idempotente WEBRTC
├── src/
│   ├── db/seed.ts                       # Provisiona canal WEBRTC padrão em novos workspaces
│   ├── modules/
│   │   ├── auth.ts                      # Auto-provisionamento WEBRTC ao criar workspace
│   │   ├── catalog.ts                   # Persistência/mascaramento WebRTC + WhatsApp Calling em /connections
│   │   ├── telephony.ts                 # Rotas públicas /public/webrtc/* com resolução por publicWidgetKey
│   │   └── whatsapp-calling.ts          # Webhook GET/POST Meta WhatsApp Calling + Graph API SDP + terminate
│   └── server.ts                        # Registro das rotas public/webhook
└── test/
    └── webrtc-channel.test.ts           # Testes unitários e de integração (connections, widget key, Meta calling)

apps/voice-gateway/
├── index.js                             # Suporte a metadata source='whatsapp_calling' e callback de término
├── public/voll-voice-widget.js          # Leitura de data-widget-key e uso de /api/public/webrtc/*
└── utils/api-router.js                  # Compatibilidade de rotas /v1/webrtc/* para chamadas WhatsApp e widget

apps/web/src/
├── lib/
│   ├── types.ts                         # Tipos WebRTC / mascaramento WhatsApp em Connection
│   └── mock-backend.ts                  # Suporte WEBRTC em demo offline
└── pages/
    ├── Channels.tsx                     # Canal WEBRTC na listagem, modal Novo/Editar, widget key, WhatsApp Calling
    ├── Journeys.tsx                     # Garantir filtro outbound exclusivo (exclui WEBRTC)
    └── NewCampaign.tsx                  # Garantir filtro outbound exclusivo (exclui WEBRTC)
```

**Structure Decision**: Reaproveitamento integral da estrutura existente do monorepo (`@voll/shared`, `@voll/api`, `@voll/web`, `@voll/voice-gateway`), sem introduzir novos pacotes ou serviços separados.

## Complexity Tracking

Nenhuma violação à Constituição detectada; nenhuma exceção necessária.
