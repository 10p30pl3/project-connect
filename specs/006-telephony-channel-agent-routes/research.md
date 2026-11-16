# Research: Revisão da Arquitetura de Telefonia (Canal, Agentes e Rotas)

**Feature**: `006-telephony-channel-agent-routes` | **Date**: 2026-11-15

## 1. Separação de Responsabilidades e Nomenclatura Única

- **Decision**: Consolidar a plataforma sobre três domínios visíveis ao usuário mantendo exatamente os nomes **Canais** (`/canais`), **Agentes de Voz** (`/agentes-de-voz`) e **Rotas** (`/rotas`), onde **Canal** governa exclusivamente o transporte (`VOICE`, `WEBRTC`, `WHATSAPP`, `SMS`, `EMAIL`) e um **Agente padrão opcional**, **Agentes** governa a inteligência IA/voz/limites independente do meio, e **Rotas** unifica **Rotas de Entrada** e **Rotas de Saída**.
- **Rationale**: Atualmente `RoutesTab` e `OutboundRoutesTab` ficam ocultas dentro de `Telefonia → Configurações`, enquanto a criação de campanhas e a tela de canais misturam vínculo direto com decisões de roteamento. Elevar **Rotas** ao mesmo nível de **Canais** e **Agentes** no menu lateral `Configuração` (no Modo Avançado) alinha a UX ao modelo técnico subjacente.
- **Alternatives considered**: Manter Rotas apenas como sub-aba em `Telefonia → Configurações` (rejeitado por `Q1-A`) ou fundir regras de entrada/saída dentro de cada cartão de Canal (rejeitado porque dificultaria prioridade global entre múltiplos troncos/canais e criaria duplicação).

## 2. Motor Único de Precedência Receptiva (SIP + WebRTC Web Widget + WhatsApp Calling)

- **Decision**: Estender `RouteManager` (`apps/voice-gateway/utils/route-manager.js`) e criar o resolvedor compartilhado `resolveInboundVoiceRouting` em `apps/api/src/modules/telephony.ts` aplicando a precedência determinística:
  1. **Rota de Entrada** ativa de maior prioridade (menor número `priority`) pertencente ao workspace que case com `(channelType, connectionId, trunkId, did, callerId, origin)`.
  2. **Agente padrão do Canal** (`connections.config.tenantId`).
  3. **Agente padrão do Workspace** (primeiro agente do workspace ou global default em `workspace_voice_resources`).
- **Rationale**: Reutilizar e estender os campos opcionais (`channelType = '*' | 'VOICE' | 'WEBRTC'`, `connectionId = '*' | uuid`, `originPattern = '*'`) no `RouteManager` preserva 100% de compatibilidade com as regras SIP existentes (`routes.json`) enquanto estende suporte completo para **WebRTC Web Widget** e **WhatsApp Calling** (`Q2-A`), com modo fail-safe caso o gateway esteja offline na simulação de rotas ou consulta (fallback seguro para `connection.config.tenantId` sem bloquear Web Widget ou WhatsApp se não houver regras customizadas).
- **Alternatives considered**: Criar uma segunda tabela SQL separada para rotas WebRTC além de `routes.json` no gateway (rejeitado para evitar dois motores divergentes de Rotas de Entrada e duplicação de UI/simulador).

## 3. Precedência Ativa (Campanhas Outbound & Rotas de Saída)

- **Decision**: Formalizar a precedência em [voice-app.ts](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/apps/api/src/connectors/voice-app.ts) e torná-la visível em [NewCampaign.tsx](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/apps/web/src/pages/NewCampaign.tsx):
  - **Agente IA da chamada ativa**: `campaign.voice_agent_id` (sobrescrita da campanha) → `connection.config.tenantId` (agente padrão do Canal) → padrão do workspace.
  - **Caminho de discagem / Troncos**: `campaign.trunk_ids` (troncos selecionados explicitamente na campanha) → `OutboundRouteManager.matchOutbound({ destination, trunkIds })` no gateway → tronco padrão.
- **Rationale**: `voice-app.ts` já aplica essa resolução internamente, mas faltava transparência na UI indicando se o valor em vigor na campanha é **"Herdado do Canal"** ou **"Definido na Campanha"**, e qual rota de saída se aplica ao prefixo/DDD.
- **Alternatives considered**: Obrigar toda campanha a escolher agente e tronco manualmente sem herança (rejeitado porque aumenta atrito no Modo Básico).

## 4. Proteção contra Exclusão de Agente em Uso e Mapa de Vínculos

- **Decision**: Implementar agregador `getVoiceAgentUsages(workspaceId, agentId?)` em `apps/api/src/modules/telephony.ts` consultando:
  - `connections` (`config->>'tenantId'`)
  - `campaigns` (`voice_agent_id`, status ativo/não arquivado)
  - `routes` do gateway (`r.tenantId`, filtradas por `workspace_voice_resources`)
  Expor `GET /telephony/tenants/:id/usages` (e incluir contagem resumida na listagem de agentes) e bloquear `DELETE /telephony/tenants/:id` com HTTP `409 Conflict` quando houver vínculos ativos, listando exatamente quais canais, rotas ou campanhas dependem dele.
- **Rationale**: Evita quebra silenciosa de canais WebRTC/SIP ou campanhas em andamento ao remover um agente reutilizado em múltiplos pontos (`FR-006`, `SC-003`).
- **Alternatives considered**: Cascata automática que limpa `tenantId` em canais/rotas ao excluir (rejeitado pelo risco operacional de deixar produção sem atendimento).

## 5. Experiência Progressiva (Modo Básico vs Modo Avançado)

- **Decision**: Manter `minMode: 'basic'` para **Canais** (`/canais`) e **Agentes de Voz** (`/agentes-de-voz`), e configurar **Rotas** (`/rotas`) com `minMode: 'advanced'` no menu lateral `Configuração` de `Layout.tsx` (`Q3-A`). No Modo Básico, os cartões de Canal/Campanha mostram apenas a ligação direta **Canal ↔ Agente** sem menus ou botões de rotas customizadas, aplicando a precedência padrão automaticamente. No Modo Avançado, cartões de **Canal**, **Agentes** e **Nova Campanha** exibem atalhos contextuais para `/rotas`.
- **Rationale**: Atende diretamente `Q3-A` mantendo o Modo Básico enxuto e alinhado ao Princípio IV (alta densidade + tooltips `(?)` em `pt-BR`).
- **Alternatives considered**: Exibir Rotas no Modo Básico (rejeitado por `Q3-A`).
