# Diretrizes e Memória do Projeto — Voll Connect (`voice-app`)

## Padrão Obrigatório para Todos os Provedores de IA de Voz (STS / S2S Bridges)

Todo motor de IA conversacional integrado ao gateway (como [`OpenAIS2SBridge`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/index.js) e [`ElevenLabsS2SBridge`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/media/elevenlabs-s2s-bridge.js), ou qualquer futuro provedor como Gemini Live, Ultravox, Deepgram, etc.) **DEVE obrigatoriamente implementar o pipeline acústico e de controle In-Call completo abaixo**, mantendo 100% de paridade funcional:

1. **Tom Inicial Sonar (`425Hz` por `700ms`) & Calibração Acústica (`EnergyManager`)**:
   - Antes de iniciar/liberar a fala do agente (quando o AMD ativo não tiver sido executado previamente), emitir a sonda `tone_stream://v=0;%(700,0,425)` com `isToneProbe = true`.
   - Medir amostras de eco e piso de ruído via [`EnergyManager`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/utils/energy-manager.js).
   - Detectar automaticamente o modo do dispositivo (`viva_voz` vs `fone_ouvido`) e alternar o `echo_cancellation` no FreeSWITCH (`true` para viva-voz, `false` para fone).
   - Classificar o perfil de ruído ambiente em `SILENCE`, `OFFICE`, `STREET` ou `TV` e ajustar os limiares de VAD e silêncio.
   - Iniciar a saudação da IA somente após o término da sonda Sonar para evitar colisão de áudio ou perda de pacotes.

2. **Chaveamento Dinâmico de Filtro de Voz (`CrosstalkFilter` & Biometria Neural)**:
   - Suportar todos os modos de filtro: `atual`/`dsp` (YIN Pitch F0 + RMS Gate via [`CrosstalkFilter`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/utils/crosstalk-filter.js)), `wespeaker` (CAM++), `ecapa` (ECAPA-TDNN) e `none`.
   - Realizar chaveamento automático (`switchCrosstalkFilter('ecapa', ...)`) quando a calibração Sonar detectar ambiente ruidoso (`OFFICE`, `STREET`, `TV`) ou quando o piso de ruído em tempo real subir (`noiseFloor >= 200`).

3. **Proteção Dinâmica da Saudação Inicial (`bargeinGraceSec` / Barge-In Grace Period)**:
   - Cortar a leitura do microfone do cliente no FreeSWITCH (`uuid_audio <uuid> start read mute`) no início da chamada enquanto a saudação inicial estiver em andamento (`isGreetingInProgress = true`, `isMicMutedByGrace = true`).
   - Bloquear qualquer tentativa de barge-in local ou remoto (`canTriggerBargeIn()`) e não enviar áudio do microfone do cliente para a IA durante a carência da saudação.
   - Calcular a duração real do áudio da saudação (`greetingAudioBytes / 16` ms em PCM 8kHz 16-bit) e abrir o canal do cliente (`openCustomerChannel('greeting_completed')` -> `uuid_audio <uuid> stop read`) assim que o playout terminar no FreeSWITCH (com fallback de segurança caso o agente não envie áudio inicial).

4. **Gravação Estéreo Dual-Stream (`.wav`) + Transcrição em Tempo Real (`.txt` e SSE)**:
   - Utilizar [`CallRecorder`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/utils/call-recorder.js) acoplado ao [`WsMediaBridge`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/media/ws-media-bridge.js) (Canal Esquerdo = Cliente via `writeUserChunk`, Canal Direito = IA via `pushAudioChunk` -> `pushAiChunk`).
   - Suportar `controlRecording(action)` com `start`, `pause`, `resume` e `stop`.
   - Em cada turno de fala (`recordTranscriptTurn`), atualizar o [`CallHistoryManager`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/utils/call-history-manager.js) via `recordCallUpdate(callId, { transcriptTurnsCount, lastTurn })` para alimentar a tabela e o modal de transcrição em tempo real via SSE.

5. **Controles In-Call, AMD, DTMF, Custos e Segurança**:
   - **AMD**: Integração com [`WhisperSession`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/media/whisper-client.js) nos modos `active` e `shadow` (com `FAST-LOCK` pós-AMD).
   - **DTMF**: Captura via ESL com debounce (`1200ms` ou envio imediato com `#`) e suporte a `sendDtmf(digits, direction)` (`inbound` e `outbound`).
   - **Comandos de Chamada**: `setMute`, `setHold`, `transfer` (`blind` e `refer`), `say`, `interruptAgent`, `playAudioFile` e `getCallInfo(includeTranscript)` com contrato padronizado para o dashboard.
   - **Timers de Segurança & Custos**: Aviso prévio falado aos ~170s (`warningDurationTimer`), desligamento rígido aos 180s (`maxDurationTimer`) e contabilização em [`aiCostTracker`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/utils/ai-cost-tracker.js).

## Prompt Padrão de Teste para Todos os Agentes

Todos os agentes (existentes e novos) utilizam como padrão o prompt institucional de atendimento e qualificação da **Voll Solutions** (`DEFAULT_VOLL_PROMPT` em [`utils/tenant-manager.js`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/utils/tenant-manager.js) e `VOLL_DEFAULT_PROMPT` em [`public/dashboard.html`](file:///Users/macm/Library/CloudStorage/OneDrive-VollSolutions/Documents/code/voice-app/public/dashboard.html)), tanto nos motores OpenAI Realtime (`session.update.instructions`) quanto ElevenLabs STS (`contextual_update`).

