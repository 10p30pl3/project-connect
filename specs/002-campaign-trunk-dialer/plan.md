# Implementation Plan: Envio de Lista de Campanha Limitado por Troncos de Saída

**Branch**: `002-campaign-trunk-dialer` | **Date**: 2026-11-15 | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/002-campaign-trunk-dialer/spec.md)  
**Input**: Feature specification from `/specs/002-campaign-trunk-dialer/spec.md`

## Summary

Dimensionar dinamicamente o envio da fila de contatos de cada campanha (`enrollments` -> `reserve.ts` -> `dispatch.ts` -> `voiceAppAdapter`) de acordo com os **troncos de saída disponíveis em tempo real** no gateway de voz (`TrunkManager`), permitindo que exclusivamente o **Gestor** (`MANAGER` / `ADMIN` / `SUPER_ADMIN`) configure troncos específicos (ou automático com fallback para todos os troncos ativos e online do workspace) e o multiplicador/taxa de envio (`dialMultiplier`, padrão `1x`) na campanha, bloqueando qualquer edição por perfis `OPERATOR` e exibindo telemetria de fila x troncos livres na tela de campanha.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+ ESM em `packages/shared`, `apps/api`, `apps/web`) e Node.js CommonJS (`apps/voice-gateway`)  
**Primary Dependencies**: Fastify 5, Zod, `pg` (PostgreSQL 16), React 19, Vite, TanStack Query, Tailwind 4, Radix UI, Drachtio SRF / FreeSWITCH ESL (`apps/voice-gateway`)  
**Storage**: PostgreSQL 16 (migração `018_campaign_trunk_dialer.sql`) + persistência JSON (`sip-trunks.json`) e contadores ativos em memória no `TrunkManager`  
**Testing**: Node built-in test runner (`npm test` em `apps/api` contra `voll_connect_test` e `npm --prefix apps/voice-gateway test`), `npm run typecheck`, `npm run check:gateway`, `npm run contracts`  
**Target Platform**: Linux server via Docker Compose (`api`, `worker`, `web`, `db`) + nó de telefonia Node.js/FreeSWITCH conectado por `VOICE_APP_BASE_URL`  
**Project Type**: Web application monorepo (`packages/shared` + `apps/api` + `apps/voice-gateway` + `apps/web`)  
**Performance Goals**: Reação de reposição de vaga após encerramento de chamada em `<= 5s` (`WORKER_TICK_MS=2000` + wake on terminal webhook); atualização da telemetria de campanha em `<= 5s` (`polling 3s` quando `RUNNING`); zero overshooting entre múltiplas campanhas no mesmo tick  
**Constraints**: Nunca bloquear loop de mídia em chamadas ativas (Princípio III); respeitar isolamento multi-tenant de troncos via `workspace_voice_resources` (Princípio V); UI operacional de alta densidade com explicações apenas via `tooltip="..."` (Princípio IV); bloqueio estrito de edição por `OPERATOR` no backend e frontend (`FR-012`)  
**Scale/Scope**: Múltiplas campanhas simultâneas por workspace, filas de dezenas de milhares de contatos em PostgreSQL (`FOR UPDATE SKIP LOCKED`), dezenas a centenas de canais SIP concorrentes distribuídos pelos troncos do gateway

## Constitution Check

*GATE: Avaliação pré-design e pós-design contra `.specify/memory/constitution.md` (v1.1.0).*

| Princípio | Verificação Pré-Design | Verificação Pós-Design | Status |
| --- | --- | --- | --- |
| **I. Shared Contracts & Explicit Schemas** | Contrato `VoiceCallRequest` e config da campanha devem ficar em `@voll/shared` e JSON Schema (`npm run contracts`). | `CampaignDialerConfigSchema`, `CampaignDialerStatus`, `TrunkAvailability` definidos em `packages/shared/src/index.ts`; `VoiceCallRequestSchema` atualizado com `trunkIds` via `npm run contracts`. | PASS |
| **II. Idempotent Execution & Explicit Persistence** | Reservas e fila continuam usando PostgreSQL `FOR UPDATE SKIP LOCKED`, `outbox` idempotente e dedup por `attemptId`. | `trunk_ids` e `dial_multiplier` persistidos em `campaigns`; pool de vagas deduz reservas locais pré-gateway dentro do ciclo sem estado volátil crítico; `429 trunk_capacity_exceeded` tratado como erro transitório idempotente. | PASS |
| **III. Real-Time Voice Performance & Fail-Open Reliability** | Checagens de tronco não podem bloquear frames RTP ou bridges ativas. | `TrunkManager.activeCalls` opera em memória `O(1)`; consulta `/v1/trunks/availability` fica no plano de controle (`api`/`worker`), isolada do áudio em tempo real; aquisition/release usa `try/finally` seguro. | PASS |
| **IV. High-Density UI & Tooltip-Only Guidance** | Controles novos de campanha e painel de fila/troncos devem manter densidade operacional sem parágrafos explicativos inline. | `NewCampaign.tsx` e `CampaignDetail.tsx` usam `Field`/`Badge`/cards compactos com `tooltip="..."` e `<InfoTooltip />` em `pt-BR`. | PASS |
| **V. External API Security & Multi-Tenant Isolation** | Troncos respeitam posse por workspace; Operador não pode alterar troncos via API direta. | Filtragem obrigatória via `workspace_voice_resources`; RBAC explícito bloqueia `OPERATOR` com HTTP `403` em `POST /campaigns` (campos de tronco/multiplicador) e `PUT /campaigns/:id/dialer-config`. | PASS |
| **VI. Explicit Call Duration & Concurrency Limits** | Limite por tronco soma-se aos limites existentes de tenant (`maxConcurrentCalls`) e duração (`maxDurationSec`). | Checagem em camadas: vaga por tronco + multiplicador no worker, e `trunkManager.tryAcquire` + `tenantManager.tryAcquireSlot` no gateway, liberados no hangup/erro. | PASS |
| **VII. End-to-End Transaction Observability** | Registrar tronco escolhido e motivo de espera na fila (`NO_ELIGIBLE_TRUNKS`, `ALL_TRUNKS_BUSY`). | Coluna `attempts.trunk_id`, eventos `RESERVED`/`SENT`, auditoria `campaign.dialer_config` e endpoint `GET /campaigns/:id/dialer-status` expõem diagnósticos completos sem PII extra. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/002-campaign-trunk-dialer/
├── plan.md                                     # Este arquivo
├── research.md                                 # Decisões técnicas e alternativas avaliadas (Phase 0)
├── data-model.md                               # Esquema DB, entidades e transições (Phase 1)
├── quickstart.md                               # Roteiro de validação ponta a ponta (Phase 1)
├── contracts/
│   ├── api-campaign-dialer.md                  # Contratos REST & RBAC da API
│   └── voice-gateway-trunk-dispatch.md         # Contrato Gateway de Voz (/v1/trunks/availability e /v1/calls)
└── checklists/
    └── requirements.md                         # Checklist de qualidade da especificação
```

### Source Code (repository root)

```text
packages/shared/
├── src/index.ts                                # CampaignDialerConfigSchema, TrunkAvailability, CampaignDialerStatus, VoiceCallRequestSchema.trunkIds
└── contracts/
    └── voice-call-request.schema.json          # Regenerado via `npm run contracts`

apps/api/
├── migrations/
│   └── 018_campaign_trunk_dialer.sql           # campaigns.trunk_ids, campaigns.dial_multiplier, attempts.trunk_id + índice
├── src/
│   ├── engine/
│   │   ├── eligibility.ts                      # Carrega trunkIds e dialMultiplier em loadCampaignRuntime
│   │   ├── trunk-capacity.ts                   # Novo helper: resolve disponibilidade por workspace/campanha (gateway + reservas pré-gateway)
│   │   ├── reserve.ts                          # runReservations limitado por orçamento dinâmico de troncos + pool por workspace no tick
│   │   └── maintenance.ts                      # Passa pool compartilhado por workspace no tick(); autoComplete/espera segura
│   ├── connectors/
│   │   └── voice-app.ts                        # Envia trunkIds no VoiceCallRequest e trata 429 trunk_capacity_exceeded como TransientConnectorError
│   └── modules/
│       ├── campaigns.ts                        # RBAC Gestor vs Operador, PUT /campaigns/:id/dialer-config, GET /campaigns/:id/dialer-status
│       ├── telephony.ts                        # Reuso da filtragem workspace_voice_resources e GET /telephony/trunks/availability
│       └── connectors.ts                       # Trigger não-bloqueante ao finalizar tentativa para reposição rápida
└── test/
    └── campaign-trunk-dialer.test.ts           # Testes automatizados de carga, limite por troncos, 0 troncos, disputa e RBAC 403

apps/voice-gateway/
├── utils/
│   ├── trunk-manager.js                        # selectAvailableTrunk(), getAvailability(), cache curto sofia status, maxChannels fallback=1
│   ├── outbound-route-manager.js               # Seleção compatível com lista permitida `trunkIds`
│   └── api-router.js                           # GET /v1/trunks/availability, enriquecimento GET /v1/trunks, enforce trunkIds no POST /v1/calls
├── index.js                                    # Aquisição (`tryAcquire`) e liberação garantida (`release`) em originateOutboundCall + header X-Trunk-ID
└── test/
    └── trunk-dialer.test.js                    # Testes unitários do TrunkManager & api-router trunk capacity

apps/web/
└── src/pages/
    ├── NewCampaign.tsx                         # Bloco de Troncos & Multiplicador editável apenas por Gestor; somente leitura para Operador
    └── CampaignDetail.tsx                      # Painel de fila vs troncos disponíveis (polling <= 5s) + edição inline restrita ao Gestor
```

**Structure Decision**: Mantida a estrutura monorepo existente (`packages/shared` -> `apps/api` -> `apps/voice-gateway` -> `apps/web`), sem criar novos pacotes nem serviços, adicionando apenas um helper coeso (`apps/api/src/engine/trunk-capacity.ts`) e a migração SQL `018_campaign_trunk_dialer.sql`.

## Complexity Tracking

> Nenhuma violação à Constituição identificada — tabela intencionalmente vazia.
