# Research: Re-inclusão da OpenAI Live e Parametrização Avançada dos Motores de Voz (`008-openai-live-realtime-params`)

## 1. Motores Suportados (`stsEngine`)

- **Decision**: Expandir `stsEngine` em `packages/shared`, `apps/api`, `apps/voice-gateway` e `apps/web` de `'openai' | 'elevenlabs'` para `'openai' | 'openai_live' | 'elevenlabs'`.
- **Rationale**: Re-inclui **OpenAI Live** (`openai_live`) como motor de primeira classe mantendo compatibilidade total com agentes existentes `'openai'` (OpenAI Realtime) e `'elevenlabs'` (ElevenLabs STS). No gateway (`apps/voice-gateway/index.js`), `'openai'` e `'openai_live'` compartilham o pipeline WebSocket Realtime/Live da OpenAI com perfis padrão distintos (por exemplo, `openai_live` prioriza `semantic_vad` e modelo `gpt-realtime` / `gpt-4o-realtime-preview` com baixa latência de turno, enquanto `openai` usa `gpt-realtime-2.1-mini` + `server_vad` por padrão).
- **Alternatives considered**: Criar um bridge separado duplicando todo o código do `index.js`; rejeitado pois aumentaria duplicação de código e risco de divergência em AEC/Sonar/DTMF/Gravação.

## 2. Paridade de Parametrização OpenAI Realtime / Live vs ElevenLabs

- **Decision**: Padronizar blocos opcionais de parametrização avançada no `TenantConfig` e em `VoiceAgentTenantSchema` (sem quebrar agentes legados):
  - **OpenAI Realtime & OpenAI Live (`openai` / `openai_live`)**:
    - `openaiPromptId`: Prompt ID salvo na OpenAI (opcional)
    - `openaiVadType`: `'server_vad' | 'semantic_vad'`
    - `openaiVadEagerness`: `'low' | 'medium' | 'high' | 'auto'` (para `semantic_vad`)
    - `vadThreshold`: `0.1`–`0.95` (sensibilidade do `server_vad`)
    - `prefixPaddingMs`: `0`–`1000` ms
    - `silenceDurationMs`: `100`–`2000` ms
    - `openaiTemperature`: `0.6`–`1.2`
    - `openaiSpeed`: `0.25`–`1.5` (velocidade de fala na saída de áudio)
    - `openaiMaxOutputTokens`: número (`64`–`4096`) ou `null` (ilimitado/`inf`)
    - `openaiTranscriptionModel`: `'whisper-1' | 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe'`
    - `openaiTranscriptionLanguage`: `'pt' | 'en' | 'es' | 'auto'`
    - `openaiInterruptResponse`: boolean (barge-in / interrupção imediata da resposta)
  - **ElevenLabs STS (`elevenlabs`)**:
    - `elevenlabsAgentId`, `elevenlabsModel`, `elevenlabsVoiceId` (já existentes; `elevenlabsAgentId` e controles avançados)
    - `elevenlabsStability`: `0`–`1`
    - `elevenlabsSimilarityBoost`: `0`–`1`
    - `elevenlabsSpeed`: `0.7`–`1.2`
    - `elevenlabsOptimizeLatency`: `0`–`4`
    - `vadThreshold` / `silenceDurationMs` (fallback de detecção local/silêncio)
- **Rationale**: Cobre exatamente os parâmetros reais da OpenAI Realtime API (`session.update`) e da ElevenLabs Conversational AI (`conversation_config_override`), dando ao usuário controle equivalente entre os motores.
- **Alternatives considered**: Expor apenas `temperature`; rejeitado porque não atingiria paridade de experiência (VAD, velocidade, transcrição e limites de resposta são essenciais na ElevenLabs).

## 3. Exposição Dinâmica em "Parâmetros avançados" na UI

- **Decision**: No modal de criação/edição de agente (`apps/web/src/pages/telephony/TenantsTab.tsx`), manter a seção colapsável **"Parâmetros avançados"** (exibida logo abaixo das configurações principais) contendo:
  1. **Parâmetros da API selecionada** (`OpenAI Realtime`, `OpenAI Live` ou `ElevenLabs STS`), renderizados dinamicamente de acordo com `editing.form.stsEngine`, cada campo com `InfoTooltip` (`?`) e zero parágrafos inline.
  2. **Engenharia Acústica, SIP & DSP** (ramal, DIDs, crosstalk, limites, AMD), mantida organizada dentro da seção avançada (e controles internos respeitando a visibilidade adequada).
- **Rationale**: Mantém a tela principal limpa e expõe todos os parâmetros específicos de cada API exatamente onde o usuário espera encontrá-los (**Parâmetros avançados**).
- **Alternatives considered**: Abrir um segundo modal separado; rejeitado pois aumenta fricção de navegação.
