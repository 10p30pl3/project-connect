# Data Model: OpenAI Live e Parâmetros Avançados por Motor (`008-openai-live-realtime-params`)

## 1. Enum de Motores de Voz (`StsEngine`)

| Valor | Rótulo UI | Descrição |
|---|---|---|
| `'openai'` | OpenAI Realtime API | Motor Realtime GA (`gpt-realtime-2.1-mini` / `gpt-realtime-2.1`) |
| `'openai_live'` | OpenAI Live API | Motor Live de baixa latência (`gpt-realtime` / `semantic_vad` por padrão) |
| `'elevenlabs'` | ElevenLabs Conversational AI (STS) | Motor Speech-to-Speech ElevenLabs |

## 2. Extensão do `TenantConfig` / `VoiceAgentTenantSchema`

Todos os novos campos são opcionais com defaults seguros no backend/gateway para retrocompatibilidade com agentes existentes.

### Parâmetros Avançados OpenAI (`openai` e `openai_live`)

| Campo | Tipo | Faixa / Valores | Default |
|---|---|---|---|
| `openaiPromptId` | `string \| null` | Prompt ID (`pmpt_...`) | `null` |
| `openaiVadType` | `'server_vad' \| 'semantic_vad'` | Tipo de detecção de turno | `'server_vad'` (`openai`) / `'semantic_vad'` (`openai_live`) |
| `openaiVadEagerness` | `'low' \| 'medium' \| 'high' \| 'auto'` | Agilidade do `semantic_vad` | `'medium'` |
| `vadThreshold` | `number` | `0.1` – `0.95` | `0.45` |
| `prefixPaddingMs` | `number` | `0` – `1000` | `160` |
| `silenceDurationMs` | `number` | `100` – `2000` | `280` |
| `openaiTemperature` | `number` | `0.6` – `1.2` | `0.8` |
| `openaiSpeed` | `number` | `0.25` – `1.5` | `1.0` |
| `openaiMaxOutputTokens` | `number \| null` | `64` – `4096` ou `null` (`inf`) | `null` |
| `openaiTranscriptionModel` | `'whisper-1' \| 'gpt-4o-mini-transcribe' \| 'gpt-4o-transcribe'` | Modelo de transcrição de entrada | `'whisper-1'` |
| `openaiTranscriptionLanguage` | `'pt' \| 'en' \| 'es' \| 'auto'` | Idioma de transcrição | `'pt'` |
| `openaiInterruptResponse` | `boolean` | Interromper resposta ao detectar fala | `true` |

### Parâmetros Avançados ElevenLabs (`elevenlabs`)

| Campo | Tipo | Faixa / Valores | Default |
|---|---|---|---|
| `elevenlabsAgentId` | `string \| null` | Agent ID ElevenLabs (`agent_...`) | `null` |
| `elevenlabsModel` | `string` | Modelo TTS/STS | `'eleven_turbo_v2_5'` |
| `elevenlabsVoiceId` | `string` | ID ou nome da voz | `'Rachel'` |
| `elevenlabsStability` | `number` | `0` – `1` | `0.5` |
| `elevenlabsSimilarityBoost` | `number` | `0` – `1` | `0.75` |
| `elevenlabsSpeed` | `number` | `0.7` – `1.2` | `1.0` |
| `elevenlabsOptimizeLatency` | `number` (int) | `0` – `4` | `3` |
| `vadThreshold` | `number` | `0.1` – `0.95` | `0.45` |
| `silenceDurationMs` | `number` | `100` – `2000` | `280` |
