# Research & Architecture Decisions: Canal WebRTC (Web & WhatsApp Calling)

**Feature**: `004-webrtc-channel-visibility` | **Date**: 2026-11-15

## 1. Por que o canal WebRTC "já existe mas não aparece" e como unificá-lo

- **Achado**:
  - `apps/voice-gateway` já implementa `WebRtcMediaBridge`, `WebRtcEndpointAdapter`, SDK `/voll-voice-widget.js`, `/v1/webrtc/token`, `/v1/webrtc/offer`, `/v1/webrtc/:callId/ice` e `DELETE /v1/webrtc/:callId`.
  - `apps/api/src/modules/telephony.ts` expõe proxies autenticados (`/telephony/webrtc/*`).
  - `apps/web/src/pages/Channels.tsx` exibe apenas um cartão técnico estático `"Canal WebRTC & Web Voice Widget"` ao final da página, mas:
    1. O enum PostgreSQL `channel_type` (`001_init.sql`) e `CHANNEL_TYPES` (`packages/shared`) não incluem `'WEBRTC'`.
    2. `NewConnectionDialog` em `Channels.tsx` não possui provedor/tipo `WEBRTC`.
    3. `seed.ts` não provisiona uma conexão `WEBRTC`, e não há migração preenchendo workspaces existentes.
    4. `POST /connections` em `apps/api/src/modules/catalog.ts` descartava campos de configuração (`endpointUrl`, `callerId`, `authToken`, `tenantId`), salvando apenas `{ simulation: DEFAULT_SIMULATION }`.

- **Decision**: Adicionar `'WEBRTC'` como tipo de canal próprio para conexões (`ConnectionChannelType = ChannelType | 'WEBRTC'`), preservar `CHANNEL_TYPES` (`'VOICE' | 'WHATSAPP' | 'SMS' | 'EMAIL'`) para contatos, jornadas, campanhas e inteligência CPC, e corrigir `POST/PATCH /connections` para persistir configurações reais e credenciais mascaradas do canal WebRTC.
- **Rationale**: Atende `FR-001` e `FR-008` sem quebrar nenhuma tipagem exaustiva de `Record<ChannelType, ...>` em `Journeys.tsx`, `NewCampaign.tsx`, `ContactDetail.tsx` ou `cpc-plan-engine.ts`, garantindo que canais `WEBRTC` apareçam na listagem principal de **Canais** mas nunca poluam seletores outbound de campanhas/jornadas.
- **Alternatives considered**:
  - Adicionar `'WEBRTC'` diretamente dentro de `CHANNEL_TYPES` global: rejeitado porque forçaria WebRTC em destinos de contato, regras CPC e seletores de campanha/jornada, além de quebrar Q2-A.
  - Usar `channelType: 'VOICE'` + `provider: 'WEBRTC'`: rejeitado pelo usuário em Q2-A (solicitou tipo próprio `WEBRTC`).

## 2. Evolução Segura do Enum PostgreSQL `channel_type` (`migrate.ts`)

- **Achado**: Em `apps/api/src/db/migrate.ts`, cada arquivo `.sql` é executado dentro de uma única transação (`BEGIN` … `COMMIT`). No PostgreSQL 16, adicionar um valor a um enum (`ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'WEBRTC'`) e utilizá-lo em `INSERT`/`UPDATE` na mesma transação falha com erro SQL `55P04` (`unsafe use of new value "WEBRTC" of enum type channel_type`).
- **Decision**: Separar em duas migrações sequenciais:
  1. `020_webrtc_channel_enum.sql`: `ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'WEBRTC';`
  2. `021_webrtc_channel_seed.sql`: `INSERT INTO connections ...` idempotente (`WHERE NOT EXISTS (SELECT 1 FROM connections c WHERE c.workspace_id = w.id AND c.channel_type = 'WEBRTC')`) criando o canal WebRTC padrão já **Ativo** para cada workspace existente e vinculando ao primeiro `workspace_voice_resources` (`resource_type = 'agent'`) quando houver.
- **Rationale**: Garante `COMMIT` do novo valor de enum antes do backfill, funcionando de forma 100% compatível com o runner `migrate.ts` existente.
- **Alternatives considered**: Alterar `migrate.ts` para pular transações por diretiva especial: desnecessário e mais arriscado do que duas migrações limpas.

## 3. Fluxo Público do Web Voice Widget com Chave Pública por Canal

- **Achado**:
  - `apps/voice-gateway/utils/api-router.js` (`L718-735`) já valida `body.publicWidgetKey`, `allowedOrigins` e rate-limit por IP, mas hoje consulta apenas `tenantManager.listTenants()`, que é global ao gateway e não conhece `connections` individuais por workspace do PostgreSQL.
  - Em `apps/api`, `/telephony/webrtc/*` está atrás de `operateGuard`, bloqueando visitantes anônimos em sites externos.
- **Decision**:
  - Armazenar em `connections.config` para canais `WEBRTC`: `webrtcMode` (`'WEB' | 'WHATSAPP_CALLING' | 'BOTH'`), `publicWidgetKey` (gerada automaticamente no backend via `crypto.randomBytes(18).toString('base64url')` com prefixo `wrtc_`), e `allowedOrigins: string[]`.
  - Expor endpoints públicos dedicados em `apps/api` (`/public/webrtc/widget.js`, `/public/webrtc/offer`, `/public/webrtc/:callId/ice`, `DELETE /public/webrtc/:callId`) que:
    1. Resolvem a conexão `WEBRTC` ativa pela `publicWidgetKey` no PostgreSQL (rejeitando `active = false`, `webrtcMode === 'WHATSAPP_CALLING'`, ou origem `Origin`/`Referer` não autorizada em `allowedOrigins` com HTTP `403`).
    2. Aplicam rate-limit por IP na API + repassam ao gateway autenticados por `API_AUTH_TOKEN` usando **exclusivamente** o `tenantId` vinculado à conexão (ou primeiro agente ativo do workspace quando nulo) e `sessionToken` emitido internamente pelo gateway (ou `tenantId` resolvido de forma confiável no proxy).
    3. Atualizam `apps/voice-gateway/public/voll-voice-widget.js` para ler `data-widget-key` / `?key=` da tag `<script>`, enviar `publicWidgetKey` para `/api/public/webrtc/offer` e repassar `controlToken` nos comandos ICE/DELETE.
- **Rationale**: Mantém a tabela `connections` do PostgreSQL como fonte de verdade multi-tenant por workspace (Princípio V), sem precisar duplicar estado de conexões no JSON local do `voice-gateway` e permitindo múltiplos canais `WEBRTC` com agentes diferentes por marca/site.
- **Alternatives considered**: Sincronizar cada `connection` para `tenants.json` no gateway: cria duas fontes de verdade e risco de dessincronização quando o gateway é reiniciado.

## 4. Integração Ponta a Ponta de WhatsApp Business Calling Receptivo

- **Achado**: A Meta WhatsApp Business Calling API envia eventos de chamada recebida (`object: "whatsapp_business_account"`, `entry[].changes[].field === "calls"`, `statuses`/`calls` com `event: "connect"`, `call_id`, `from`, `session: { sdp, sdp_type: "offer" }` e `event: "terminate"`) para o webhook HTTPS configurado no Meta App Dashboard, autenticado via `X-Hub-Signature-256` (HMAC-SHA256 com App Secret) e verificado via desafio `GET` (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`). Para aceitar a chamada, a plataforma envia a resposta SDP gerada pelo gateway para a Graph API (`POST https://graph.facebook.com/v21.0/{phone_number_id}/calls` com `action: "pre_accept"` / `"accept"` e `session: { sdp_type: "answer", sdp }`, ou `"terminate"` ao encerrar).
- **Decision**:
  - Cada canal `WEBRTC` com `webrtcMode` `'WHATSAPP_CALLING'` ou `'BOTH'` armazena em `config`: `whatsappPhoneNumberId`, `whatsappBusinessAccountId`, `whatsappVerifyToken` (gerado automaticamente caso omitido), `whatsappAppSecret` e `whatsappAccessToken` (sempre **mascarados** nas respostas `GET /connections` como `'***'`, preservando valores existentes em `PATCH` quando enviados omitidos ou mascarados).
  - Criar rotas dedicadas em `apps/api/src/modules/whatsapp-calling.ts`:
    - `GET /webhooks/whatsapp-calling/:connectionId`: responde `hub.challenge` quando `hub.verify_token` corresponde ao `whatsappVerifyToken` do canal.
    - `POST /webhooks/whatsapp-calling/:connectionId`: verifica `X-Hub-Signature-256` contra `whatsappAppSecret` (falha fechada HTTP `401` se configurado ou se ausente em produção), valida idempotência pelo `call_id` + evento (`connector_inbox` ou mapa de sessões ativas), verifica `active === true` e `webrtcMode !== 'WEB'`.
    - Para `event === 'connect'`: solicita ao gateway `POST /v1/webrtc/offer` passando `sdpOffer`, `tenantId` do canal e `metadata: { source: 'whatsapp_calling', connectionId, workspaceId, whatsappCallId, from }`, obtém `sdpAnswer` e `callId` do gateway e chama Graph API `accept` (com `session: { sdp_type: 'answer', sdp: sdpAnswer }`). Mantém correlação `whatsappCallId <-> gatewayCallId`.
    - Para `event === 'terminate'` ou falha: encerra a sessão correspondente no gateway (`DELETE /v1/webrtc/:callId`) de forma idempotente.
    - Quando a chamada encerra do lado do gateway (ex.: duração máxima Princípio VI ou despedida do agente), webhook interno/callback do gateway pode notificar a API para enviar `terminate` à Meta se a chamada veio de `whatsapp_calling`.
- **Rationale**: Reaproveita integralmente `WebRtcMediaBridge` e `WebRtcEndpointAdapter` já existentes no `apps/voice-gateway` sem reinventar pipeline RTP/Opus/DTLS no Node da API, preservando isolamento multi-tenant, auditoria e segredos mascarados (Princípios I, II, V, VI, VII).
- **Alternatives considered**: Tratar WhatsApp Calling via SIP Bridge externo no Meta Cloud: exigiria configuração extra de SIP TLS externo na Meta e perderia a unificação direta no mesmo canal WebRTC solicitada pelo usuário.

## 5. UX em `Configuração → Canais` (Modos Básico & Avançado, Princípio IV)

- **Decision**:
  - Adicionar seção/opção **WebRTC (Web & WhatsApp Calling)** em `NewConnectionDialog`, `EditConnection` e nos cards/tabela de `Channels.tsx` com badge de tipo `WebRTC`.
  - Substituir o bloco estático `"Canal WebRTC & Web Voice Widget"` isolado por ferramentas integradas dentro de cada canal `WEBRTC` ativo/cadastrado (botão copiar tag `<script src=".../api/public/webrtc/widget.js" data-widget-key="...">`, botão copiar URL de webhook Meta `/api/webhooks/whatsapp-calling/:id`, badge `HTTPS Pronto` vs `Requer HTTPS (Microfone)` e modal/seletor de Agente IA), removendo textos explicativos inline em favor de `tooltip="..."` / `<InfoTooltip />`.
- **Rationale**: Elimina duplicidade visual, habilita múltiplos canais WebRTC por workspace (ex.: Widget institucional + WhatsApp Calling) e cumpre 100% do Princípio IV em Modo Básico e Modo Avançado.
