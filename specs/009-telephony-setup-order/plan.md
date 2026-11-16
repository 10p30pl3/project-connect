# Implementation Plan: Ordem Guiada de Configuração de Telefonia

**Branch**: `009-telephony-setup-order` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-telephony-setup-order/spec.md` (Q1=A, Q2=A, Q3=A)

## Summary

Entregar um guia de configuração de telefonia que ensina e verifica a ordem **Tronco → Agente → Canal → Rotas → Ramal → Teste**: um endpoint de leitura (`GET /telephony/setup-status`) calcula o status de cada etapa a partir dos recursos reais do workspace, e a interface mostra um checklist fixo no topo de Telefonia (com indicador discreto em Canais e Agentes de Voz), avisos de dependência sem bloqueio nos formulários e abas de Telefonia na ordem recomendada. Inclui, por pedido do usuário, um catálogo único de modelos por motor para a **OpenAI Live API** (US4), reaproveitando o trabalho da feature `008-openai-live-realtime-params`.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node 20+, React 19)

**Primary Dependencies**: Fastify 5, Zod, TanStack Query, Radix UI, Lucide, Tailwind 4

**Storage**: PostgreSQL 16 existente; **sem tabelas novas, sem migração** (status derivado)

**Testing**: Vitest (função pura sem banco), `tsc --noEmit`, Vite build, testes do gateway. Testes de integração com banco dependem de PostgreSQL, indisponível no ambiente local.

**Target Platform**: Linux Docker (API + Nginx Web), servidor de produção `194.163.151.91`

**Project Type**: Monorepo npm workspaces (`@voll/shared`, `@voll/api`, `@voll/web`, `@voll/voice-gateway`)

**Performance Goals**: `setup-status` responde em <500 ms com gateway saudável; consultas ao gateway com timeout curto e em paralelo

**Constraints**: Fail-open se o gateway cair (`partial: true`, nunca 5xx); isolamento por workspace; troncos só editáveis por Super Admin; zero parágrafos inline na UI

**Scale/Scope**: ~6 etapas, 4 códigos de aviso, 3 telas tocadas (Telefonia, Canais, Agentes de Voz)

## Constitution Check

*GATE: passa antes da pesquisa; reavaliado após o desenho.*

- **I. Shared Contracts**: PASS. `TelephonySetupStatusSchema`, `TelephonySetupStep`, `OPENAI_ENGINE_MODELS` em `packages/shared`; `npm run contracts` executado.
- **II. Idempotent Execution**: PASS. Endpoint somente leitura, sem escrita nem estado novo.
- **III. Voice Performance & Fail-Open**: PASS. Nenhuma alteração no caminho de áudio; falha do gateway degrada para `partial: true`.
- **IV. Tooltip-Only UI**: PASS. Motivos e orientações só em tooltips `(?)`; avisos são `Alert` curtos e acionáveis, sem prosa explicativa.
- **V. Security & Isolation**: PASS. Escopo por `workspaceId`; sem credenciais no payload; ação de tronco só para Super Admin.
- **VI. Limits**: PASS (não afetado).
- **VII. Observability**: PASS. Log estruturado com `workspaceId` e `pendingCount`; sem PII.

**Re-check pós-desenho**: sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/009-telephony-setup-order/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/setup-status.md
└── tasks.md   # gerado por /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/index.ts                    # schemas do status, TELEPHONY_SETUP_ORDER, OPENAI_ENGINE_MODELS
apps/api/src/lib/telephony-setup.ts             # computeSetupSteps (função pura) + montagem do snapshot
apps/api/src/modules/telephony.ts               # GET /telephony/setup-status
apps/api/test/telephony-setup.test.ts           # testes da função pura (sem banco)
apps/web/src/lib/mock-backend.ts                # espelho do endpoint no modo mock
apps/web/src/lib/types.ts                       # tipos do status
apps/web/src/components/TelephonySetupGuide.tsx # checklist + SetupIndicator
apps/web/src/pages/Telephony.tsx                # guia no topo e nova ordem de abas
apps/web/src/pages/Channels.tsx                 # indicador discreto + aviso de cobertura
apps/web/src/pages/VoiceAgents.tsx              # indicador discreto
apps/web/src/pages/telephony/SettingsTabs.tsx   # avisos nos formulários de rota
apps/web/src/pages/telephony/TenantsTab.tsx     # modelos por motor a partir do catálogo (US4)
```

**Structure Decision**: Lógica de decisão numa função pura em `apps/api/src/lib`, separada da coleta de dados, para ser testável sem PostgreSQL. A UI consome um único endpoint, evitando que cada tela reimplemente as regras.

## Complexity Tracking

Nenhuma violação a justificar.
