# Quickstart & Validation: Arquitetura Canal, Agentes e Rotas

**Feature**: `006-telephony-channel-agent-routes` | **Date**: 2026-11-15

## 1. Pré-requisitos e Checks Estáticos

```bash
npm run contracts
npm run typecheck
npm run check:gateway
npm run build
```

## 2. Testes Automatizados

```bash
# Testes de unidade do voice-gateway (incluindo RouteManager com channelType/connectionId/originPattern)
npm test -w @voll/voice-gateway

# Testes de arquitetura e rotas na API (contra voll_connect_test com PostgreSQL ativo)
npm run test:arch
npm test -w @voll/api -- test/channel-agent-routes.test.ts
```

## 3. Roteiro de Validação Ponta a Ponta (`P1`–`P3`)

1. **Navegação e Modos (`Q1-A`, `Q3-A`)**:
   - No **Modo Básico**: abrir o menu lateral `Configuração`; confirmar que aparecem **Canais** e **Agentes de Voz**, enquanto **Rotas** permanece oculto; criar/vincular agente padrão em um canal de voz ou WebRTC.
   - Alternar para o **Modo Avançado**: confirmar que **Rotas** aparece em `Configuração` ao lado de **Canais** e **Agentes de Voz**, abrindo `/rotas` com as abas **Rotas de Entrada** e **Rotas de Saída**.
2. **Reutilização e Proteção de Agente (`US1`, `FR-003`, `FR-006`)**:
   - Criar 1 **Agente de Voz** e vinculá-lo a: 1 canal `VOICE`, 1 canal `WEBRTC`, 1 **Rota de Entrada** e 1 **Campanha**.
   - Em **Agentes de Voz**, confirmar exibição dos vínculos (`Canais`, `Rotas`, `Campanhas`) e tentar excluir o agente: confirmar bloqueio (HTTP `409`) listando exatamente as referências ativas.
3. **Precedência Receptiva para SIP, WebRTC e WhatsApp Calling (`US2`, `Q2-A`)**:
   - Configurar um canal `WEBRTC` com `Agente padrão = B`.
   - Criar uma **Rota de Entrada** para esse canal com `originPattern = "https://vip.cliente.com"` apontando para `Agente = A`.
   - Testar no simulador de `/rotas` e em `POST /api/public/webrtc/offer`:
     - Chamada com origem `https://vip.cliente.com` → resolve para **Agente A** (`source: 'inbound_route'`).
     - Chamada com outra origem permitida → resolve para **Agente B** (`source: 'channel_default'`).
4. **Precedência Ativa em Campanha (`US2`, `FR-005`)**:
   - Em **Nova campanha**, selecionar um canal com `Agente padrão = B` e confirmar badge `Herdado do Canal (B)`.
   - Sobrescrever para `Agente = C` e troncos específicos e confirmar badge `Sobrescrito na Campanha` no inspetor.
