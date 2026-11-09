---
trigger: always_on
description: Padrão obrigatório de pipeline acústico (Sonar 425Hz, AEC, Filtros DSP/ECAPA, Barge-in Grace) e controles In-Call para todos os provedores de IA de voz (OpenAI, ElevenLabs e futuros motores STS).
---

# Padrão Obrigatório de Features para Provedores de IA de Voz (STS)

Sempre que criar, manter ou ajustar qualquer bridge de IA conversacional (ex: `OpenAIS2SBridge`, `ElevenLabsS2SBridge` ou novos provedores), garanta que TODAS as features abaixo estejam presentes e idênticas:

1. **Tom Inicial Sonar (425Hz por 700ms)**: Medição de eco e piso de ruído via `EnergyManager`, detecção Viva-Voz vs. Fone de Ouvido (com ativação/desativação dinâmica de `echo_cancellation` no FreeSWITCH) e classificação em `SILENCE`, `OFFICE`, `STREET` ou `TV`.
2. **Chaveamento Dinâmico de Filtro de Voz**: Suporte aos modos `atual`/`dsp` (YIN Pitch F0 + RMS Gate), `wespeaker` (CAM++), `ecapa` (ECAPA-TDNN) e `none`, com troca automática para `ECAPA` em ambientes ruidosos (`OFFICE`, `STREET`, `TV` ou `noiseFloor >= 200`).
3. **Proteção Dinâmica da Saudação Inicial (`bargeinGraceSec`)**: Mute de leitura no FreeSWITCH (`uuid_audio start read mute`) durante a saudação inicial, cálculo da duração exata dos bytes de áudio enviados pela IA e abertura automática do canal (`openCustomerChannel`) ao término da reprodução.
4. **Gravação Estéreo Dual-Stream (`.wav`) + Transcrição em Tempo Real (`.txt` e SSE)**: Integração com `CallRecorder`, `callHistoryManager.recordCallUpdate` a cada fala do Atendente/Cliente e suporte a `controlRecording` (`start`, `pause`, `resume`, `stop`).
5. **Controles In-Call Completos**: DTMF com debounce (`1200ms` ou `#` imediato), `setMute`, `setHold`, `transfer` (`blind` e `refer`), `say`, `interruptAgent`, `AMD` com Whisper local, rastreamento de custos (`aiCostTracker`) e Timers de Segurança (aviso aos 170s + corte rígido aos 180s).
