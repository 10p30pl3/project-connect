---

description: "Task list for Re-inclusão da OpenAI Live e Parametrização Avançada dos Motores de Voz"
---

# Tasks: Re-inclusão da OpenAI Live e Parametrização Avançada dos Motores de Voz

**Input**: Design documents from `/specs/008-openai-live-realtime-params/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/voice-engines-params.md`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)

---

## Phase 1: Foundational (Shared Contracts & Frontend Types)

**Purpose**: Estabelecer `STS_ENGINES` (`openai` | `openai_live` | `elevenlabs`) e os campos avançados de cada motor antes da implementação no gateway e na UI.

- [x] T001 Add `STS_ENGINES = ['openai', 'openai_live', 'elevenlabs'] as const` and optional OpenAI Realtime/Live (`openaiPromptId`, `openaiVadType`, `openaiVadEagerness`, `openaiTemperature`, `openaiSpeed`, `openaiMaxOutputTokens`, `openaiTranscriptionModel`, `openaiTranscriptionLanguage`, `openaiInterruptResponse`, `vadThreshold`, `prefixPaddingMs`, `silenceDurationMs`) and ElevenLabs (`elevenlabsStability`, `elevenlabsSimilarityBoost`, `elevenlabsSpeed`, `elevenlabsOptimizeLatency`) fields to `VoiceAgentTenantSchema` in `packages/shared/src/index.ts`
- [x] T002 [P] Extend `TenantConfig` and `StsEngine` types with `openai_live` and the advanced engine parameter fields in `apps/web/src/pages/telephony/types.tsx`

**Checkpoint**: Contratos compartilhados compilando (`npm run typecheck -w @voll/shared`).

---

## Phase 2: User Story 1 - Seleção do motor OpenAI Live ao lado de OpenAI Realtime e ElevenLabs (Priority: P1) 🎯 MVP

**Goal**: Permitir selecionar, persistir, listar e executar chamadas com o motor **OpenAI Live** (`openai_live`) ao lado de **OpenAI Realtime** (`openai`) e **ElevenLabs STS** (`elevenlabs`).

**Independent Test**: Abrir criação/edição de agente em `/agentes-de-voz`, selecionar `OpenAI Live API`, salvar e confirmar que a listagem e os seletores de ramais/chamadas exibem `OpenAI Live`.

- [x] T003 [US1] Support `stsEngine: 'openai_live'` normalization, defaults, and persistence in `apps/voice-gateway/utils/tenant-manager.js` and `apps/voice-gateway/index.js`
- [x] T004 [P] [US1] Update mock tenant storage (`live1` seeded as `openai_live`) and `PUT/POST /telephony/tenants` handlers to support `openai_live` and advanced engine fields in `apps/web/src/lib/mock-backend.ts`
- [x] T005 [US1] Add `OpenAI Live API` (`openai_live`) option to the engine `<Select>` and update engine badge/labels in `apps/web/src/pages/telephony/TenantsTab.tsx`, `apps/web/src/pages/telephony/ExtensionsTab.tsx`, and `apps/web/src/pages/telephony/CallsTab.tsx`

**Checkpoint**: `OpenAI Live` selecionável, persistido e exibido em toda a interface e gateway.

---

## Phase 3: User Story 2 - Paridade de parametrização da OpenAI Realtime com a experiência ElevenLabs (Priority: P1)

**Goal**: Aplicar os parâmetros avançados de OpenAI Realtime/Live (`turn_detection` `server_vad`/`semantic_vad`, `eagerness`, `threshold`, `prefix_padding_ms`, `silence_duration_ms`, `temperature`, `speed`, `max_output_tokens`, `transcription`, `interrupt_response`) e ElevenLabs (`stability`, `similarity_boost`, `speed`, `optimize_streaming_latency`) na inicialização real das sessões no gateway.

**Independent Test**: Configurar parâmetros avançados de OpenAI Realtime/Live e ElevenLabs no tenant e validar via testes unitários no gateway que os payloads de sessão aplicam corretamente os valores configurados e preservam defaults para agentes legados.

- [x] T006 [US2] Build helper for OpenAI `session.update` engine params (`server_vad` vs `semantic_vad`, `eagerness`, `interrupt_response`, `temperature`, `audio.output.speed`, `max_output_tokens`, `transcription` model/language) and apply it in `apps/voice-gateway/index.js`
- [x] T007 [P] [US2] Apply `elevenlabsStability`, `elevenlabsSimilarityBoost`, `elevenlabsSpeed`, and `elevenlabsOptimizeLatency` in ElevenLabs session initialization (`conversation_config_override.tts`) in `apps/voice-gateway/media/elevenlabs-s2s-bridge.js`
- [x] T008 [US2] Add unit tests covering `openai_live` defaults, OpenAI Realtime/Live `session.update` payload building, and legacy tenant fallback in `apps/voice-gateway/test/openai-live-params.test.js`

**Checkpoint**: Paridade completa de parametrização aplicada e testada no `voice-gateway`.

---

## Phase 4: User Story 3 - Exposição dos parâmetros específicos de cada API em "Parâmetros avançados" (Priority: P1)

**Goal**: Expor dinamicamente na seção colapsável **Parâmetros avançados** do editor de agente apenas os parâmetros específicos do motor selecionado (`OpenAI Realtime`, `OpenAI Live` ou `ElevenLabs`), com rótulos em pt-BR e `InfoTooltip` (`?`) em cada campo.

**Independent Test**: Editar um agente em `/agentes-de-voz`, expandir **Parâmetros avançados**, alternar entre `OpenAI Realtime API`, `OpenAI Live API` e `ElevenLabs Conversational AI (STS)` e confirmar que apenas os parâmetros da API selecionada são exibidos com tooltips `?` e persistem ao salvar.

- [x] T009 [US3] Refactor the agent modal collapsible section into **Parâmetros avançados** showing dynamic API-specific parameter grids (`OpenAI Realtime / OpenAI Live` vs `ElevenLabs STS`) plus acoustic/SIP/DSP engineering controls, with `InfoTooltip` (`?`) on every field and numeric range validation in `apps/web/src/pages/telephony/TenantsTab.tsx`
- [x] T010 [P] [US3] Ensure switching engines in `TenantsTab.tsx` preserves existing per-engine parameter values in form state and applies sensible engine-specific defaults (e.g., `semantic_vad` for `openai_live`, `server_vad` for `openai`) in `apps/web/src/pages/telephony/TenantsTab.tsx`

**Checkpoint**: Interface limpa no corpo principal e parâmetros específicos de cada API expostos dinamicamente em **Parâmetros avançados**.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Garantir conformidade de tipos, testes e validação visual no navegador.

- [x] T011 Run `npm run typecheck`, `npm run test:arch -w @voll/api`, `npm test -w @voll/voice-gateway`, and `npm run build`
- [x] T012 Verify end-to-end flows from `specs/008-openai-live-realtime-params/quickstart.md` in browser (`VITE_DEMO_MOCK=true` on `http://localhost:4173/agentes-de-voz`): select `OpenAI Live API`, expand **Parâmetros avançados**, verify API-specific fields and tooltips for OpenAI vs ElevenLabs, save and confirm persistence

---

## Dependencies & Execution Order

- **Phase 1 (T001–T002)** → bloqueia Phases 2, 3 e 4.
- **Phase 2 (US1: T003–T005)** → depende de `T001`/`T002`; `T004` (`mock-backend.ts`) pode rodar em paralelo com `T003`.
- **Phase 3 (US2: T006–T008)** → depende de `T003`; `T007` (`elevenlabs-s2s-bridge.js`) pode rodar em paralelo com `T006`.
- **Phase 4 (US3: T009–T010)** → depende de `T005`.
- **Phase 5 (T011–T012)** → depende de todas as fases anteriores.

## Implementation Strategy

1. **T001–T005 (MVP OpenAI Live)**: contratos + gateway + seletor na UI.
2. **T006–T008 (Paridade OpenAI Realtime/Live vs ElevenLabs)**: payload real no gateway + testes unitários.
3. **T009–T010 (Parâmetros avançados dinâmicos na UI)**: seção dinâmica por API com tooltips `?`.
4. **T011–T012 (Validação)**: typecheck, testes, build e navegador.
