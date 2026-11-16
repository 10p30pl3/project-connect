# Implementation Plan: Revisão de UX/UI para Modos Básico e Avançado

**Branch**: `007-ux-ui-modes-cleanup` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/007-ux-ui-modes-cleanup/spec.md`

## Summary

Refatoração de UX/UI no frontend (`apps/web`) para tornar os modos **Básico** e **Avançado** visualmente limpos, sem redundâncias de navegação/rótulos e sem fricção:
1. Simplificar o seletor `Básico | Avançado` e a navegação lateral/mobile (`Layout.tsx`, `More.tsx`), eliminando repetições visuais e adicionando `superAdminOnly` em `NavItem`.
2. Mover textos explicativos, subtítulos conceituais e notas auxiliares inline nas páginas principais para `PageHeader.tooltip` / `<InfoTooltip />` (mantendo inline apenas erros, validações, estados operacionais dinâmicos e metadados factuais).
3. Restringir exclusivamente a `SUPER_ADMIN` (`isSuperAdminRole`) todos os controles especiais de plataforma, provisionamento multi-tenant (`+ Nova` empresa), `/sistema` (`System.tsx`), nós de infraestrutura global (`FreeSWITCH`, `Drachtio`, `Whisper`, engenharia SIP/DSP) e tarifas/custos internos.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19, Vite 6  
**Primary Dependencies**: `@voll/shared` (`isSuperAdminRole`, `ROLE_LABEL`), Tailwind CSS 4, Radix UI, Lucide React, TanStack Query  
**Storage**: `localStorage` (`voll-experience-mode`) para preferência visual; sem alterações em PostgreSQL  
**Testing**: `npm run typecheck`, `npm run test:arch -w @voll/api`, `npm run build`, verificação E2E/visual no navegador com `VITE_DEMO_MOCK=true`  
**Target Platform**: Web SPA (desktop + mobile responsivo)  
**Project Type**: Monorepo (`apps/web`, `packages/shared`, `apps/api`)  
**Constraints**:
- Princípio IV da Constituição: **zero** parágrafos explicativos ou subtítulos conceituais inline — apenas `InfoTooltip` (`?`) e copy pt-BR.
- Princípio V da Constituição: separação estrita Super Admin vs Cliente (`isSuperAdminRole`).
- Modo Avançado não pode conceder nem exibir controles exclusivos de `SUPER_ADMIN`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Shared Contracts & Explicit Schemas**: PASS — reutiliza `isSuperAdminRole` e `ROLES` de `@voll/shared`.
- **II. Idempotent Execution & Explicit Persistence**: PASS — sem impacto em persistência transacional.
- **III. Real-Time Voice Performance & Fail-Open Reliability**: PASS — sem alteração nos fluxos de mídia/gateway.
- **IV. High-Density UI & Tooltip-Only Guidance**: PASS — objetivo central da feature: eliminar textos explicativos inline e redundâncias, movendo explicações para `InfoTooltip`.
- **V. External API Security & Multi-Tenant Isolation**: PASS — reforça no frontend o isolamento de controles especiais apenas para `SUPER_ADMIN`.
- **VI. Explicit Call Duration & Concurrency Limits**: PASS — preserva controles existentes respeitando visibilidade por perfil.
- **VII. End-to-End Transaction Observability**: PASS — preserva telas de observabilidade/telemetria para perfis autorizados.

## Project Structure

### Documentation (this feature)

```text
specs/007-ux-ui-modes-cleanup/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ux-ui-modes.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/web/src/
├── components/
│   ├── Layout.tsx                 # Seletor Básico|Avançado limpo, superAdminOnly em NavItem, WorkspaceSwitcher restrito
│   ├── ui.tsx                     # PageHeader, Card, Field, InfoTooltip (reutilização consistente)
│   ├── StrategyForm.tsx           # Tooltips no lugar de notas explicativas inline
│   └── VoiceAgentPanel.tsx        # Limpeza visual entre Básico e Avançado
├── lib/
│   └── experience-mode.tsx        # Metadados concisos dos modos para tooltip
└── pages/
    ├── More.tsx                   # Seletor mobile limpo + filtro superAdminOnly
    ├── System.tsx                 # Guarda SuperAdminOnly + limpeza de textos inline
    ├── Telephony.tsx              # Nós de infra/engenharia global restritos a SUPER_ADMIN + limpeza de textos
    ├── telephony/SettingsTabs.tsx # Controles globais/custos restritos a SUPER_ADMIN + tooltips
    ├── Attempts.tsx               # Subtítulo conceitual -> PageHeader.tooltip
    ├── Calendars.tsx              # Subtítulo conceitual -> PageHeader.tooltip
    ├── VoiceAgents.tsx            # Parágrafos explicativos -> InfoTooltip
    ├── Campaigns.tsx              # Limpeza de textos explicativos auxiliares -> InfoTooltip
    ├── CampaignDetail.tsx         # Refinamento visual e tooltips
    ├── Overview.tsx               # Limpeza de redundâncias entre Básico e Avançado
    ├── Billing.tsx                # Separação estrita Consumo de Tempo (cliente) vs custos/tarifas (SUPER_ADMIN)
    ├── Limits.tsx                 # Limpeza de textos explicativos -> InfoTooltip
    ├── Observability.tsx          # Limpeza de textos explicativos -> InfoTooltip
    ├── Channels.tsx               # Limpeza de textos explicativos -> InfoTooltip
    └── NewCampaign.tsx            # Fluxo sem fricção nos modos Básico e Avançado
```

**Structure Decision**: Mudanças concentradas exclusivamente em `apps/web/src/`, reutilizando `InfoTooltip`, `PageHeader.tooltip` e `isSuperAdminRole` sem introduzir dependências externas.

## Post-Design Constitution Check

- Re-avaliação após Phase 1 (`research.md`, `data-model.md`, `contracts/ux-ui-modes.md`, `quickstart.md`): **PASS** sem desvios ou violações.

## Complexity Tracking

Nenhuma violação de constituição ou complexidade adicional justificada.
