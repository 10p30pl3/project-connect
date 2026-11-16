# Implementation Plan: Re-inclusão da OpenAI Live e Parametrização Avançada dos Motores de Voz

**Branch**: `008-openai-live-realtime-params` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/008-openai-live-realtime-params/spec.md`

## Summary

Re-incluir **OpenAI Live** (`openai_live`) ao lado de **OpenAI Realtime** (`openai`) e **ElevenLabs STS** (`elevenlabs`), equiparar a parametrização da OpenAI Realtime/Live à experiência da ElevenLabs e expor os parâmetros específicos de cada API na seção **Parâmetros avançados** do agente de voz:
1. Atualizar contratos compartilhados (`packages/shared/src/index.ts`) e tipos frontend (`apps/web/src/pages/telephony/types.tsx`).
2. Atualizar persistência/defaults e aplicação em sessão no `apps/voice-gateway` (`utils/tenant-manager.js`, `index.js`, `media/elevenlabs-s2s-bridge.js`) com testes unitários.
3. Atualizar `apps/web/src/pages/telephony/TenantsTab.tsx`, `ExtensionsTab.tsx`, `CallsTab.tsx` e `apps/web/src/lib/mock-backend.ts` para selecionar `OpenAI Live`, exibir rótulos corretos e expor os parâmetros específicos de cada motor sob **Parâmetros avançados** com `InfoTooltip`.

## Technical Context

**Language/Version**: TypeScript 5.7 (shared/api/web), Node.js 20 CommonJS (voice-gateway)  
**Primary Dependencies**: Zod (`@voll/shared`), React 19, TanStack Query, WebSocket (`ws`), Tailwind CSS 4  
**Storage**: `tenants.json` / `tenant-manager.js` no gateway + mock em memória (`mock-backend.ts`)  
**Testing**: `npm run typecheck`, `npm run test:arch -w @voll/api`, `npm test -w @voll/voice-gateway`, `npm run build`, verificação visual com `VITE_DEMO_MOCK=true`  
**Target Platform**: Node.js (`apps/api`, `apps/voice-gateway`) + Web SPA (`apps/web`)  
**Constraints**:
- Princípio I: Contratos compartilhados em `packages/shared`.
- Princípio III: Loop de áudio não-bloqueante no gateway; defaults seguros para agentes legados.
- Princípio IV: Zero parágrafos explicativos inline — usar `InfoTooltip` (`?`) em todos os parâmetros avançados.

## Constitution Check

- **I. Shared Contracts & Explicit Schemas**: PASS — `STS_ENGINES` e campos avançados tipados em `packages/shared/src/index.ts`.
- **II. Idempotent Execution & Explicit Persistence**: PASS — compatibilidade retroativa com tenants existentes.
- **III. Real-Time Voice Performance & Fail-Open Reliability**: PASS — parâmetros de sessão aplicados no handshake inicial sem bloquear mídia.
- **IV. High-Density UI & Tooltip-Only Guidance**: PASS — parâmetros expostos sob **Parâmetros avançados** com `InfoTooltip`.
- **V–VII**: PASS — sem alteração de chaves/segredos ou quebra de observabilidade.

## Project Structure

```text
packages/shared/src/index.ts                       # STS_ENGINES ('openai' | 'openai_live' | 'elevenlabs') + params no VoiceAgentTenantSchema
apps/voice-gateway/utils/tenant-manager.js         # Persistência e defaults por motor (openai / openai_live / elevenlabs)
apps/voice-gateway/index.js                        # session.update OpenAI Realtime & Live (VAD, speed, temperature, max_output_tokens, transcription)
apps/voice-gateway/media/elevenlabs-s2s-bridge.js  # Overrides TTS/latência ElevenLabs (stability, similarity, speed, optimizeLatency)
apps/voice-gateway/test/openai-live-params.test.js # Testes unitários de normalização e parâmetros de sessão
apps/web/src/pages/telephony/types.tsx             # Tipos TenantConfig estendidos
apps/web/src/pages/telephony/TenantsTab.tsx        # Select OpenAI Live + seção "Parâmetros avançados" dinâmica por API
apps/web/src/pages/telephony/ExtensionsTab.tsx     # Rótulo OpenAI Live nos ramais
apps/web/src/pages/telephony/CallsTab.tsx          # Rótulo OpenAI Live no seletor de chamadas
apps/web/src/lib/mock-backend.ts                   # Suporte a openai_live e novos campos avançados no mock
```

## Complexity Tracking

Nenhuma violação de constituição.
