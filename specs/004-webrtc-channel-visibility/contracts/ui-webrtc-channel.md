# UI Contracts: Canal WebRTC em Canais & Isolamento Outbound

**Feature**: `004-webrtc-channel-visibility` | **Date**: 2026-11-15

## 1. Tela `Configuração → Canais` (`/canais` — Modos Básico e Avançado)

- **Visibilidade na Lista Principal (`Cards` e `Tabela`)**:
  - Exibe conexões com `channelType === 'WEBRTC'` com badge próprio `WebRTC (Web & WhatsApp)` e ícone `Radio`.
  - Mostra provedor `WebRTC Nativo · Web & WhatsApp Calling`, modalidade ativa (`Web Widget`, `WhatsApp Calling`, ou `Web & WhatsApp Calling`), agente IA vinculado (`tenantId`) e switch `Ativa / Inativa`.
  - Ações disponíveis (sujeitas a `canEdit` / `CAN.admin`):
    - Botão `Agente de voz` (abre modal de vínculo restrito aos agentes do workspace).
    - Botão `Habilitar / Desabilitar`, `Editar canal`, `Excluir canal`.
  - **Ferramentas WebRTC integradas diretamente nos canais `WEBRTC`**:
    - Indicador `HTTPS Pronto` / `Requer HTTPS (Microfone)`.
    - Quando modalidade inclui Web (`WEB` ou `BOTH`): botão rápido de cópia da tag `<script src="${origin}/api/public/webrtc/widget.js" data-widget-key="${publicWidgetKey}"></script>` + URL de sinalização pública.
    - Quando modalidade inclui WhatsApp Calling (`WHATSAPP_CALLING` ou `BOTH`): botão rápido de cópia da URL do webhook `${origin}/api/webhooks/whatsapp-calling/${c.id}` e status da configuração Meta (`Phone Number ID` + token configurado).
  - **Remoção da duplicidade visual**: O antigo cartão estático isolado `"Canal WebRTC & Web Voice Widget"` no final de `Channels.tsx` é substituído pela gestão real integrada dentro dos cartões de canal `WEBRTC`.

- **Modal `Nova Conexão ou Canal de API` (`NewConnectionDialog`)**:
  - Seletor `Provedor do conector` passa a incluir **`WebRTC Nativo (Web Widget & WhatsApp Calling)`** (`WEBRTC_NATIVE`).
  - Ao escolher `WEBRTC_NATIVE`:
    - Define `channelType = 'WEBRTC'` e `name = 'Canal WebRTC · Web & WhatsApp Calling'`.
    - Exibe campo `Modalidade de atendimento` (`Web Widget + WhatsApp Calling`, `Somente Web Widget`, `Somente WhatsApp Calling`), seletor `Agente IA responsável`, campo opcional `Origens permitidas (Web Widget)` e grupo colapsável/condicional `Credenciais WhatsApp Business Calling` (`Phone Number ID`, `WABA ID`, `Verify Token`, `App Secret`, `Access Token`) quando modo incluir WhatsApp Calling.

- **Modal `Editar canal` (`EditConnection`)**:
  - Para conexões `WEBRTC`: permite editar nome, modalidade WebRTC, agente vinculado (`tenantId`), `allowedOrigins` e atualizar/rotacionar credenciais WhatsApp Calling sem expor segredos antigos (placeholders mascarados preservam o segredo atual).

- **High-Density & Tooltips (Princípio IV)**:
  - Toda explicação conceitual em `Channels.tsx` para WebRTC e WhatsApp Calling deve usar `tooltip="..."` / `<InfoTooltip />`, evitando parágrafos explicativos longos nos corpos dos cartões.

## 2. Isolamento em Telas de Disparo Outbound (`FR-008`)

- **Jornadas (`/jornadas`)**:
  - Steps de jornada continuam usando `CHANNEL_TYPES` (`VOICE`, `WHATSAPP`, `SMS`, `EMAIL`). Canais `WEBRTC` retornados por `/connections` nunca são oferecidos como canal de etapa outbound.
- **Nova Campanha (`/campanhas/nova`)**:
  - Tanto em Modo Básico (`Canal simples`) quanto no Avançado, `activeConnections` filtra apenas `CHANNEL_TYPES` outbound (`VOICE`, `WHATSAPP`, `SMS`, `EMAIL`), excluindo `WEBRTC`.
