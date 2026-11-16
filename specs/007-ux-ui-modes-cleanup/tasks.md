---

description: "Task list for Revisão de UX/UI para Modos Básico e Avançado"
---

# Tasks: Revisão de UX/UI para Modos Básico e Avançado

**Input**: Design documents from `/specs/007-ux-ui-modes-cleanup/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ux-ui-modes.md`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)

---

## Phase 1: Foundational (Experience Mode & Super Admin Visibility Contract)

**Purpose**: Estabelecer os tipos e guardas reutilizáveis que sustentam navegação limpa e isolamento de controles especiais de Super Admin.

- [x] T001 Extend `NavItem` with `superAdminOnly?: boolean` and filter navigation items by `isAtLeast(it.minMode ?? 'basic') && (!it.superAdminOnly || isSuper)` in `apps/web/src/components/Layout.tsx`, plus reusable `SuperAdminGuard` UI helper in `apps/web/src/components/ui.tsx`
- [x] T002 [P] Refine `EXPERIENCE_MODE_META` copy in `apps/web/src/lib/experience-mode.tsx` to concise pt-BR descriptions suited for `InfoTooltip`

**Checkpoint**: Contrato de visibilidade (`minMode` + `superAdminOnly`) pronto para uso em navegação e páginas.

---

## Phase 2: User Story 1 - Navegação limpa e sem redundâncias entre Modo Básico e Avançado (Priority: P1) 🎯 MVP

**Goal**: Eliminar rótulos duplicados no seletor de interface e na árvore de navegação, garantindo transição fluida entre os modos Básico e Avançado no desktop e mobile.

**Independent Test**: Alternar entre **Básico** e **Avançado** na barra lateral desktop e em `/mais` mobile; confirmar ausência de rótulo duplicado no seletor, presença do `?` em tooltip, ausência de grupo redundante e coerência dos menus.

- [x] T003 [US1] Simplify the desktop sidebar `Básico | Avançado` mode switcher (remove redundant active-mode label, add `<InfoTooltip />` beside header) and remove redundant single-item group heading duplication in `apps/web/src/components/Layout.tsx`
- [x] T004 [P] [US1] Update mobile mode switcher (remove duplicated mode label, add `<InfoTooltip />`) and apply `superAdminOnly` filtering in `apps/web/src/pages/More.tsx`
- [x] T005 [P] [US1] Review and streamline visual density between `basic` and `advanced` views, removing redundant badges/counters/duplicate copy in `apps/web/src/pages/Overview.tsx` and `apps/web/src/pages/Campaigns.tsx`

**Checkpoint**: Navegação e seletor de modo limpos em desktop e mobile.

---

## Phase 3: User Story 2 - Textos explicativos movidos para tooltips mantendo telas enxutas (Priority: P1)

**Goal**: Substituir subtítulos conceituais, parágrafos explicativos e notas auxiliares inline por `<InfoTooltip />` / `PageHeader.tooltip`, mantendo inline apenas erros, validações e estado operacional dinâmico.

**Independent Test**: Abrir `/tentativas`, `/calendarios`, `/agentes-de-voz`, `/telefonia`, `/campanhas/:id`, `/nova-campanha`, `/limites` e `/canais`; confirmar ausência de parágrafos conceituais inline e funcionamento dos tooltips `?`.

- [x] T006 [P] [US2] Replace conceptual `PageHeader` `subtitle` strings with `tooltip` props in `apps/web/src/pages/Attempts.tsx` and `apps/web/src/pages/Calendars.tsx`
- [x] T007 [P] [US2] Convert inline conceptual `<p>` descriptions and helper hints to `<InfoTooltip />` (keeping error/validation alerts inline) in `apps/web/src/pages/VoiceAgents.tsx`, `apps/web/src/pages/Channels.tsx`, and `apps/web/src/pages/Limits.tsx`
- [x] T008 [P] [US2] Move inline conceptual instructions/hints to `<InfoTooltip />` across campaign and strategy UI in `apps/web/src/pages/NewCampaign.tsx`, `apps/web/src/pages/CampaignDetail.tsx`, `apps/web/src/components/StrategyForm.tsx`, and `apps/web/src/pages/Tabulations.tsx`
- [x] T009 [P] [US2] Convert inline conceptual explanations and explanatory `Alert`s to `<InfoTooltip />` in `apps/web/src/pages/Billing.tsx`, `apps/web/src/pages/Observability.tsx`, and `apps/web/src/pages/Reports.tsx`

**Checkpoint**: Telas principais livres de ruído textual inline, com ajuda contextual acessível em tooltips.

---

## Phase 4: User Story 3 - Controles especiais restritos exclusivamente ao Super Admin (Priority: P1)

**Goal**: Ocultar e proteger controles especiais de plataforma, provisionamento multi-tenant, infraestrutura global e tarifas/custos internos para qualquer perfil que não seja `SUPER_ADMIN` (inclusive no modo Avançado).

**Independent Test**: Testar com perfil `ADMIN` no modo **Avançado**: confirmar que `/sistema`, `+ Nova` empresa, nós de infra global (`FreeSWITCH`/`Drachtio`/`Whisper`), engenharia SIP/DSP interna e tarifas/custos R$ não aparecem; alternar para `SUPER_ADMIN` e confirmar que todos ficam acessíveis.

- [x] T010 [US3] Restrict `+ Nova` workspace provisioning button (remove `demoMode && role === 'ADMIN'` bypass) and internal `Tarifa Venda PSTN` field strictly to `isSuperAdminRole(me?.role)` in `apps/web/src/components/Layout.tsx`
- [x] T011 [P] [US3] Mark `/sistema` nav item as `superAdminOnly: true`, wrap `SystemPage` in `SuperAdminGuard` for direct URL access, and move explanatory `<p>` text to `InfoTooltip` in `apps/web/src/pages/System.tsx`
- [x] T012 [P] [US3] Gate global telephony infrastructure node KPIs (`FreeSWITCH`, `Drachtio`, `Whisper`), internal cluster health, and global engineering/cost controls strictly with `isSuperAdminRole(me?.role)` (instead of only `isAtLeast('advanced')`), and convert inline explanatory texts to `InfoTooltip` in `apps/web/src/pages/Telephony.tsx` and `apps/web/src/pages/telephony/SettingsTabs.tsx`
- [x] T013 [P] [US3] Audit and ensure internal AI/PSTN costs, margin controls, and Super Admin-only diagnostic widgets stay hidden for non-`SUPER_ADMIN` roles in both `basic` and `advanced` modes in `apps/web/src/pages/Billing.tsx`, `apps/web/src/pages/CampaignDetail.tsx`, and `apps/web/src/pages/Reports.tsx`

**Checkpoint**: Separação estrita entre cliente (`Básico` / `Avançado`) e controles especiais de `SUPER_ADMIN` validada em navegação, UI e rotas.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Garantir conformidade de tipos, arquitetura, build e inspeção visual end-to-end no navegador.

- [x] T014 Run `npm run typecheck`, `npm run test:arch -w @voll/api`, `npm test -w @voll/voice-gateway`, and `npm run build`
- [x] T015 Execute visual verification flows from `specs/007-ux-ui-modes-cleanup/quickstart.md` in browser (`VITE_DEMO_MOCK=true` on `http://localhost:4173`) comparing `ADMIN` (Básico & Avançado) vs `SUPER_ADMIN`, tooltips `?`, and layout cleanliness on desktop and mobile

---

## Dependencies & Execution Order

- **Phase 1 (T001–T002)** → base obrigatória antes das fases US1–US3.
- **Phase 2 (US1: T003–T005)** → depende de `T001` (`NavItem.superAdminOnly`) e `T002`.
- **Phase 3 (US2: T006–T009)** → pode iniciar em paralelo após Phase 1; cuidado apenas em não conflitar edições simultâneas em arquivos compartilhados com Phase 4 (`Telephony.tsx`, `Billing.tsx`, `CampaignDetail.tsx`).
- **Phase 4 (US3: T010–T013)** → depende de `T001` (`SuperAdminGuard`, `superAdminOnly`).
- **Phase 5 (T014–T015)** → depende da conclusão das Phases 1–4.

## Parallel Execution Example

```bash
# Phase 3 independent page sweeps (disjoint files):
Task T006: Attempts.tsx, Calendars.tsx
Task T007: VoiceAgents.tsx, Channels.tsx, Limits.tsx
Task T008: NewCampaign.tsx, StrategyForm.tsx, Tabulations.tsx
```

## Implementation Strategy

1. **Foundational + US1 (`T001`–`T005`)**: limpa imediatamente barra lateral, seletor `Básico | Avançado` e entrada do sistema.
2. **US2 (`T006`–`T009`)**: elimina textos explicativos inline movendo-os para `<InfoTooltip />`.
3. **US3 (`T010`–`T013`)**: fecha todas as fronteiras de controles especiais para `SUPER_ADMIN`.
4. **Verification (`T014`–`T015`)**: valida `typecheck`, testes, `build` e inspeção visual real no navegador.
