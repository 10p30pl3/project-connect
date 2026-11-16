# Contracts: Consolidar Abas de Canais e CRUD Completo

**Feature**: `008-consolidate-channels-crud`  
**Shared Contracts**: `packages/shared/src/index.ts`

## 1. Schemas Compartilhados (`@voll/shared`)

- `ChannelTechnicalOverridesSchema`: objeto parcial opcional contendo seções opcionais `whatsapp`, `voice`, `sms`, `email`, `rcs` (derivadas de `ChannelEndpointConfigSchema`, permitindo atualização parcial por canal).
- `ConnectionCreateSchema` e `ConnectionUpdateSchema`:
  - Mantêm todos os campos existentes (`name`, `channelType`, `provider`, `tariff`, `active`, `endpointUrl`, `callerId`, `authToken`, `tenantId`, `webrtcMode`, `allowedOrigins`, `whatsappPhoneNumberId`, `whatsappBusinessAccountId`, `whatsappVerifyToken`, `whatsappAppSecret`, `whatsappAccessToken`, `rotateWidgetKey`, `simulation`).
  - Adicionam `technical?: ChannelTechnicalOverrides` (para parâmetros específicos de protocolo).
  - `ConnectionUpdateSchema` passa a aceitar `provider` e persistir `endpointUrl`, `callerId`, `authToken` e `technical` em `PATCH /connections/:id`.
- `ConnectionTestRequestSchema`:
  - Aceita parâmetros opcionais de rascunho (`channelType`, `provider`, `endpointUrl`, `authToken`, `technical`) para testar antes mesmo de salvar, ou resolve a partir do registro `:id` salvo.
- `ConnectionTestResultSchema`:
  - `{ ok: boolean, channelType: ConnectionChannelType, status: string, code: number, latencyMs: number, details: string }`

## 2. Endpoints HTTP (`apps/api/src/modules/catalog.ts`)

| Método & Rota | Permissão | Finalidade |
|---|---|---|
| `GET /connections` | autenticado (`workspaceId`) | Lista canais do workspace com configurações básicas, `technical` mascarado e flags `has*` de segredos |
| `POST /connections` | `CAN.admin` (`connections.write`) | Cria canal com configurações básicas e avançadas (`technical`, WebRTC, WhatsApp, simulação) |
| `PATCH /connections/:id` | `CAN.admin` (`connections.write`) | Atualiza qualquer campo básico ou avançado/técnico do canal preservando segredos mascarados |
| `DELETE /connections/:id` | `CAN.admin` (`connections.write`) | Exclui canal sem dependências (`409` se em uso em tentativas ou jornadas) |
| `POST /connections/:id/test` | `CAN.admin` (`connections.write`) | Executa teste de conectividade no contexto do canal `:id` (aceitando overrides não salvos no corpo) |
| `POST /connections/test` | `CAN.admin` (`connections.write`) | Executa teste de conectividade para rascunho de novo canal durante criação |

## 3. Contrato de UI (`apps/web/src/pages/Channels.tsx`)

- **Remoção das abas**: `ChannelsPage` não renderiza `<Tabs>` nem `TechnicalEndpointsTab`.
- **CRUD Unificado**: `ChannelFormModal` atende tanto **Novo canal** quanto **Editar / Configurar canal** com:
  - Bloco superior **Configurações Básicas** (sempre visível).
  - Bloco expansível **Configurações Avançadas & Endereços Técnicos**:
    - Recolhido por padrão quando `experienceMode === 'basic'`.
    - Expandido por padrão quando `experienceMode === 'advanced'`.
    - Contém campos técnicos condicionais ao `channelType` + `provider` selecionados e botão **Testar Conectividade** exibindo resultado (`ok`, `latencyMs`, `status`, `details`).
- **Conformidade Princípio IV**: Sem parágrafos explicativos no corpo dos cards/campos; orientações apenas via `tooltip="..."` e `<InfoTooltip />` em `pt-BR`.
