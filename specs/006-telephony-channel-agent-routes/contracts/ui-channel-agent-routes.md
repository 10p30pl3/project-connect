# UI Contracts: Canal, Agentes e Rotas (Navegação, Vínculos e Modos)

**Feature**: `006-telephony-channel-agent-routes` | **Date**: 2026-11-15

## 1. Navegação Principal (`Layout.tsx` & `router.tsx`)

- **Grupo `Configuração` na Sidebar**:
  - `Canais` (`/canais`, `minMode: 'basic'`)
  - `Agentes de Voz` (`/agentes-de-voz`, `minMode: 'basic'`)
  - `Rotas` (`/rotas`, `minMode: 'advanced'`) — item dedicado ao lado de **Canais** e **Agentes de Voz**.
- **Comportamento por Modo (`Q3-A`)**:
  - **Modo Básico**: exibe **Canais** e **Agentes de Voz**; oculta **Rotas** na barra lateral e nos cartões simplificados (mantendo o roteamento padrão automático via agente vinculado ao canal).
  - **Modo Avançado**: exibe **Canais**, **Agentes de Voz** e **Rotas**, habilita atalhos contextuais entre eles e exibe origem efetiva de herança vs sobrescrita.
- **Retrocompatibilidade em `Telefonia` (`/telefonia`)**:
  - As abas internas de rotas em `/telefonia?tab=routes` / `outbound-routes` ou apontam via redirecionamento/botão direto para `/rotas`, mantendo uma única tela oficial para **Rotas** (tabs **Rotas de Entrada** e **Rotas de Saída**).

## 2. Tela Dedicada `Rotas` (`/rotas` — `Routes.tsx`)

- **`PageHeader`**: título **"Rotas"**, tooltip em `pt-BR` explicando que **Rotas de Entrada** direcionam chamadas receptivas (SIP, WebRTC e WhatsApp Calling) para **Agentes de Voz** por prioridade e **Rotas de Saída** escolhem troncos PSTN por prefixo/DDD.
- **Tab 1 — `Rotas de Entrada` (SIP, WebRTC & WhatsApp Calling)**:
  - Formulário/Tabela suporta filtro e criação por **Tipo de Canal** (`Todos *`, `Telefonia SIP (VOICE)`, `WebRTC / WhatsApp Calling (WEBRTC)`), **Canal específico** (`*` ou seleção dentre os `connections` do workspace), **Tronco** (quando SIP), **DID / Número** (`didPattern`), **Origem / Domínio Web** (`originPattern`, quando WebRTC), **Caller ID** (`callerPattern`), **Agente de Voz destino** (`tenantId`), prioridade (`priority`) e políticas opcionais.
  - **Simulador de Precedência em Tempo Real**: permite selecionar `Canal`, `DID/Número`, `Caller ID` e `Origem Web` para executar `POST /api/telephony/routes/simulate` e exibir qual regra venceu **ou** qual fallback (`Agente padrão do Canal` vs `Agente padrão do workspace`) atenderia a chamada.
- **Tab 2 — `Rotas de Saída`**:
  - Lista ordenada e edição de regras de saída (`pattern`, `trunkId`, `prepend`, `callerIdNumber`, prioridade e failover), com simulação de número de destino exibindo qual tronco discaria primeiro.

## 3. Tela `Canais` (`/canais` — `Channels.tsx`)

- Papel visual claro do **Canal**: transporte (`Provedor`, credenciais/chaves/webhook) + **Agente padrão (fallback)** (`tenantId`).
- Em `Channels.tsx` (cartões `VOICE` e `WEBRTC`):
  - O rótulo de vínculo explicita **`Agente padrão`** (ex.: `Agente padrão: Cobrança IA` ou `Sem agente padrão (usa rotas ou padrão do workspace)`).
  - No **Modo Avançado**: exibe badge/link contextual **`Rotas`** (`/rotas?connectionId=${c.id}`) indicando quantas regras de rota apontam para aquele canal ou levando direto à criação de rota para ele.

## 4. Tela `Agentes de Voz` (`/agentes-de-voz` — `VoiceAgents.tsx` & `TenantsTab.tsx`)

- **Zero parágrafos explicativos no corpo dos cartões (Princípio IV)**: mover descrições conceituais em `VoiceAgents.tsx` para `tooltip="..."`.
- **Visibilidade de Uso (`VoiceAgentUsageSummary`)**:
  - Cada cartão/linha de agente mostra chips/resumo de onde é usado (`X canais`, `Y rotas`, `Z campanhas`) com popover/detalhe listando os nomes e atalhos para `/canais`, `/rotas` ou `/campanhas`.
  - Ao tentar excluir um agente em uso (`DELETE /telephony/tenants/:id`), exibe diálogo claro impedindo a exclusão enquanto houver referências ativas, listando exatamente o que precisa ser desvinculado primeiro.

## 5. Assistente `Nova Campanha` (`NewCampaign.tsx` & `CampaignWizardInspector.tsx`)

- No **Modo Avançado** (seção de **Agente de Voz** e **Troncos / Rotas de Saída**):
  - Mostra explicitamente no seletor e no `CampaignWizardInspector`:
    - **`Agente de Voz`**: `Herdado do Canal (${agentName})` vs `Sobrescrito na Campanha (${agentName})`.
    - **`Caminho de Saída / Troncos`**: `Automático por Rotas de Saída (${routeName})` vs `Troncos selecionados na Campanha (${trunkNames})`, com link rápido para `/rotas?tab=outbound` quando em Avançado.
