# Interface Contracts: Motores de Voz e Parâmetros Avançados (`008-openai-live-realtime-params`)

## 1. Contrato Compartilhado (`packages/shared/src/index.ts`)

- `STS_ENGINES = ['openai', 'openai_live', 'elevenlabs'] as const`
- `VoiceAgentTenantSchema` aceita:
  - `stsEngine: z.enum(STS_ENGINES)`
  - Campos avançados opcionais de OpenAI (`openaiPromptId`, `openaiVadType`, `openaiVadEagerness`, `openaiTemperature`, `openaiSpeed`, `openaiMaxOutputTokens`, `openaiTranscriptionModel`, `openaiTranscriptionLanguage`, `openaiInterruptResponse`)
  - Campos avançados opcionais de ElevenLabs (`elevenlabsStability`, `elevenlabsSimilarityBoost`, `elevenlabsSpeed`, `elevenlabsOptimizeLatency`)
  - Campos de VAD compartilhados (`vadThreshold`, `prefixPaddingMs`, `silenceDurationMs`)

## 2. Gateway (`apps/voice-gateway`)

- `POST /v1/tenants` / `PUT /v1/tenants/:id` (`tenant-manager.js` / `api-router.js`):
  - Aceita e persiste `stsEngine` (`'openai' | 'openai_live' | 'elevenlabs'`) e todos os novos campos avançados com defaults seguros.
- Sessão OpenAI (`apps/voice-gateway/index.js`):
  - Para `stsEngine === 'openai'` ou `'openai_live'`, envia `session.update` aplicando:
    - `audio.input.turn_detection`: se `openaiVadType === 'semantic_vad'`, envia `{ type: 'semantic_vad', eagerness: openaiVadEagerness ?? 'medium', interrupt_response: openaiInterruptResponse ?? true }`; caso contrário `{ type: 'server_vad', threshold, prefix_padding_ms, silence_duration_ms, interrupt_response }`.
    - `audio.input.transcription`: `{ model: openaiTranscriptionModel ?? 'whisper-1', ...(language !== 'auto' ? { language } : {}) }`.
    - `audio.output.speed` (quando diferente de `1` ou definido), `temperature` (quando suportado), `max_output_tokens` (quando definido).
- Sessão ElevenLabs (`apps/voice-gateway/media/elevenlabs-s2s-bridge.js`):
  - Aplica `elevenlabsStability`, `elevenlabsSimilarityBoost`, `elevenlabsSpeed`, `elevenlabsOptimizeLatency` em `conversation_config_override.tts` quando configurados no tenant.

## 3. Interface Web (`apps/web/src/pages/telephony/TenantsTab.tsx`)

- Select **Motor de Voz (STS)**:
  - `OpenAI Realtime API` (`openai`)
  - `OpenAI Live API` (`openai_live`)
  - `ElevenLabs Conversational AI (STS)` (`elevenlabs`)
- Seção colapsável **Parâmetros avançados**:
  - Exibe bloco **Parâmetros da API (OpenAI Realtime / OpenAI Live)** quando `stsEngine` é `'openai'` ou `'openai_live'`.
  - Exibe bloco **Parâmetros da API (ElevenLabs STS)** quando `stsEngine` é `'elevenlabs'`.
  - Todos os campos possuem `InfoTooltip` (`?`) e validação numérica inline.
