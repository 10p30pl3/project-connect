# Research: Consolidar Abas de Canais e CRUD Completo (Básico ao Avançado)

**Feature**: `008-consolidate-channels-crud`  
**Date**: 2026-11-16

## 1. Consolidação das Abas em `/canais` (`1C`)

- **Decision**: Remover integralmente a barra de `<Tabs>` (*Conectores & Conexões* e *Configurar Endereços Técnicos*) e o componente `TechnicalEndpointsTab` de `apps/web/src/pages/Channels.tsx`, tornando a página **Canais & Integrações** uma visão única com listagem consolidada (cartões e tabela) e CRUD unificado por canal.
- **Rationale**: A divisão em duas abas obrigava o operador/administrador a configurar o mesmo canal em dois lugares desconectados (cadastro da conexão em uma aba e endereços técnicos globais por protocolo na outra). Com a decisão `1C`, cada canal (`Connection`) torna-se a fonte de verdade completa do básico ao avançado.
- **Alternatives considered**:
  - Manter drawer global "Gateways Globais" (`1A`) ou mover para `/sistema` (`1B`) — rejeitados conforme escolha `1C` do usuário.
- **Backward Compatibility**: Endpoints legados `GET/POST /channels/technical-endpoints` continuam disponíveis na API apenas como fallback silencioso para conectores legados que ainda leem `workspace_channel_endpoints`, sem exposição de aba ou painel redundante na UI.

## 2. Organização do CRUD Unificado de Canal (`2A`)

- **Decision**: Unificar o formulário de criação (`NewConnectionDialog`) e edição (`EditConnection`) em um componente compartilhado (`ChannelFormModal` / seções modulares em `Channels.tsx`) com revelação progressiva:
  1. **Configurações Básicas** (sempre visíveis): Nome, Tipo de Canal (`VOICE`, `WEBRTC`, `WHATSAPP`, `SMS`, `EMAIL`, `RCS`), Provedor, Situação (`Ativa`/`Inativa`), BINA/Identificador Padrão e Agente de Voz Padrão (quando aplicável).
  2. **Configurações Avançadas & Endereços Técnicos** (seção expansível/colapsável): recolhida por padrão no **Modo Básico** (`!isAtLeast('advanced')`) e expandida por padrão no **Modo Avançado** (`isAtLeast('advanced')`), contendo URL de Endpoint/API, Tokens/Credenciais (preservando segredos mascarados), Webhooks e Verify Token, parâmetros específicos de protocolo (WhatsApp Graph API/Phone ID/WABA, Voice-App URL/Token/WSS/CDR/Cotas, WebRTC Mode/Allowed Origins/Widget Key, SMS SMPP/DLR/Sender ID, E-mail SMTP/TLS/Remetente/Eventos, RCS RBM/Agent ID/Webhook, Simulação Sandbox), Tarifação (Super Admin) e botão **Testar Conectividade**.
- **Rationale**: Evita duplicação entre criação e edição (`NewConnectionDialog` vs `EditConnection` hoje têm quase 700 linhas duplicadas), reduz atrito no Modo Básico e entrega controle total no Modo Avançado.
- **Alternatives considered**:
  - Modal com duas sub-abas fixas (`Básico` | `Avançado`) idênticas em todos os modos (`2B`) — rejeitada por esconder menos contexto para quem usa Modo Avançado e exigir troca de aba para salvar.

## 3. Persistência e Atualização Parcial no Backend (`PATCH /connections/:id`)

- **Decision**: Estender `ConnectionCreateSchema` e `ConnectionUpdateSchema` em `packages/shared/src/index.ts` com campos técnicos tipados por protocolo (`technical`) e corrigir `PATCH /connections/:id` em `apps/api/src/modules/catalog.ts` para atualizar `provider`, `endpointUrl`, `callerId`, `authToken` (via `isRealSecret()` para nunca apagar segredos mascarados) e `config.technical`.
- **Rationale**: Hoje `PATCH /connections/:id` ignora `endpointUrl`, `authToken`, `provider` e campos técnicos de WhatsApp/SMS/E-mail/RCS/Voice-App, impossibilitando o CRUD técnico completo após a criação.
- **Alternatives considered**:
  - Salvar campos técnicos em `workspace_channel_endpoints` separado por tipo — rejeitado porque quebraria o isolamento por canal quando há mais de um canal do mesmo tipo no workspace.

## 4. Teste de Conectividade por Canal

- **Decision**: Adicionar `POST /connections/:id/test` (e `POST /connections/test` para rascunhos antes de salvar) em `apps/api/src/modules/catalog.ts` (e espelho em `apps/web/src/lib/mock-backend.ts`), testando o endpoint/protocolo configurado naquele canal específico (`VOICE`/`WEBRTC` via `/v1/health`, `WHATSAPP`/`SMS`/`EMAIL`/`RCS` validando URL/credenciais/alcance HTTP ou configuração SMTP/SMPP) com resposta estruturada (`ok`, `status`, `code`, `latencyMs`, `details`).
- **Rationale**: Ao remover a aba global de Endereços Técnicos, o botão **Testar** passa a operar no contexto exato do canal que está sendo criado ou editado.
