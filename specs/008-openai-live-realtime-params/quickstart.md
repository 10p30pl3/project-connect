# Quickstart Validation: OpenAI Live e Parâmetros Avançados (`008-openai-live-realtime-params`)

## Pré-requisitos

```bash
npm run typecheck
npm run test:arch -w @voll/api
npm test -w @voll/voice-gateway
npm run build
```

Subir frontend em modo demonstração:

```bash
VITE_DEMO_MOCK=true npm run dev -w @voll/web -- --port 4173
```

## Cenários de Validação (`http://localhost:4173/agentes-de-voz`)

1. **Selecionar OpenAI Live**:
   - Abrir criação ou edição de agente de voz.
   - No campo **Motor de Voz (STS)**, verificar presença das 3 opções: `OpenAI Realtime API`, `OpenAI Live API` e `ElevenLabs Conversational AI (STS)`.
   - Selecionar `OpenAI Live API`, salvar e confirmar que a listagem exibe `OpenAI Live`.

2. **Parâmetros avançados específicos por API**:
   - Reabrir o agente e expandir **Parâmetros avançados**.
   - Com `OpenAI Realtime API` ou `OpenAI Live API` selecionado, confirmar exibição dos parâmetros equivalentes à ElevenLabs: `Prompt ID`, `Tipo de VAD` (`server_vad` / `semantic_vad`), `Sensibilidade VAD`, `Prefix Padding (ms)`, `Silêncio (ms)`, `Temperatura`, `Velocidade da fala`, `Máx. tokens`, `Modelo de transcrição`, `Idioma` e `Interrupção (Barge-in)`.
   - Alternar para `ElevenLabs Conversational AI (STS)` e confirmar que a seção **Parâmetros avançados** muda dinamicamente para exibir `Estabilidade`, `Similaridade`, `Velocidade`, `Otimização de latência`, `Sensibilidade VAD` e `Silêncio (ms)`.
   - Confirmar que cada parâmetro possui ícone `?` (`InfoTooltip`) e que alterar/salvar persiste os novos valores ao reabrir o modal.
