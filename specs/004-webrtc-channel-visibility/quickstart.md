# Quickstart & Validation Guide: Canal WebRTC (Web & WhatsApp Calling)

**Feature**: `004-webrtc-channel-visibility` | **Date**: 2026-11-15

## 1. Pré-requisitos e Migrações

1. Aplicar migrações SQL sequenciais (`020_webrtc_channel_enum.sql` seguido de `021_webrtc_channel_seed.sql`):
   ```bash
   npm run migrate -w @voll/api
   ```
2. Regenerar contratos JSON compartilhados e verificar tipagem + sintaxe do gateway:
   ```bash
   npm run contracts
   npm run typecheck
   npm run check:gateway
   ```

## 2. Testes Automatizados

1. Executar testes da API (incluindo suíte WebRTC/WhatsApp Calling contra `voll_connect_test` e testes unitários):
   ```bash
   npm test -w @voll/api
   ```
2. Executar testes do Voice Gateway:
   ```bash
   npm test -w @voll/voice-gateway
   ```
3. Build completo de produção:
   ```bash
   npm run build
   ```

## 3. Validação Funcional (End-to-End)

1. **Auto-provisionamento & Visibilidade (`FR-001`, `FR-002`, `FR-004`)**:
   - Abrir **Configuração → Canais** tanto no **Modo Básico** quanto no **Modo Avançado**.
   - Confirmar que o canal `Canal WebRTC · Web & WhatsApp Calling` (badge `WebRTC`, status `Ativo`) aparece na listagem principal sem necessidade de cadastro manual prévio.
   - Confirmar que o antigo cartão informativo separado não aparece duplicado fora da gestão de canais.

2. **Cadastro Manual & Vínculo de Agente (`FR-003`, `FR-005`, `FR-009`)**:
   - Clicar em **"+ Novo canal"**, selecionar provedor **WebRTC (Web & WhatsApp Calling)**, confirmar autopreenchimento do tipo `WEBRTC`, escolher modo (`Web Widget`, `WhatsApp Calling` ou `Ambos`) e agente de voz, e salvar.
   - Verificar presença de tooltips `(?)` sem parágrafos explicativos longos no corpo dos cartões.

3. **Widget Público por Canal (`FR-006`)**:
   - Copiar a tag `<script ... data-widget-key="...">` gerada no cartão do canal `WEBRTC`.
   - Testar abertura de oferta WebRTC pública com `publicWidgetKey` válida (`200`), origem fora de `allowedOrigins` quando configurada (`403`) e chave inexistente/canal inativo (`401`/`403`).

4. **WhatsApp Business Calling Receptivo (`FR-007`)**:
   - Configurar `whatsappPhoneNumberId`, `whatsappAccessToken`, `whatsappAppSecret` e `whatsappVerifyToken` em um canal `WEBRTC` com modo `WHATSAPP_CALLING` ou `BOTH`.
   - Validar desafio `GET /api/webhooks/whatsapp-calling/:connectionId` e entrega simulada de evento `connect` (`POST` assinado com `X-Hub-Signature-256`) encaminhando `sdpAnswer` para a Graph API mockada e mantendo idempotência em reentrega duplicada.

5. **Isolamento Outbound (`FR-008`)**:
   - Abrir **Jornadas → Nova jornada** e **Nova campanha → Acionamento** (Modo Básico e Avançado) e verificar que canais `WEBRTC` não aparecem nos seletores de disparo em lote.
