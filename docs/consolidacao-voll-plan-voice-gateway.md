# Consolidação Voll Plan + Voll Connect (voice-app)

## Status (09/11/2026, fases 0 a 6)

| Fase | Situação |
|---|---|
| 0. Salvar o código | Feito: estado atual da pasta voice-app importado (sem histórico, que contém chaves de API) |
| 1. Monorepo | Feito: `apps/voice-gateway`, `services/whisper`, docker-compose único (perfil `voice`) |
| 2. Contrato único | Feito: `VoiceCallRequest` e `ConnectorEvent` em `packages/shared`, JSON Schema em `packages/shared/contracts`, validação nos dois lados, teste de contrato no CI, eventId determinístico, custo de IA separado (`aiCostUsd`), sem IP/caller ID/token fixos |
| 3. Cadastro único | Feito: agente de voz (roteiro, motor, voz, AMD, transcrição, caller IDs) cadastrado e versionado na Conexão de voz, publicado no gateway como tenant `<connectionId>` (`PUT /v1/tenants/:id`, contrato `VoiceAgentTenant`). O adaptador só liga com a versão publicada; o gateway recusa tenant inexistente (422), versão diferente (409) e caller ID não autorizado (422). Chaves de IA nunca saem do gateway e são mascaradas nas respostas |
| 4. Interface única | Feito: botão **Agente de voz** em Canais e página **Telefonia** (ao vivo com encerrar chamada, histórico, gravações com áudio e transcrição, custo de IA, status do gateway). A API faz de intermediária, filtra por workspace e audita ouvir gravação e encerrar chamada. O `dashboard.html` fica como ferramenta técnica (troncos, ramais, rotas, diagnóstico) |
| 5. Desativar duplicados | Feito: disparos (`/v1/outreach`) e provedores SMS/WhatsApp (`/v1/providers`) do gateway respondem 410 para escrita; leitura do histórico continua. `LEGACY_OUTREACH_ENABLED=true` reativa temporariamente |
| 6. Persistência | Feito para agentes: o Postgres do Voll Plan é a fonte da verdade e o worker republica a cada minuto agente que sumiu ou mudou no gateway (nunca uma versão não liberada). Troncos, ramais e rotas SIP continuam em JSON no gateway: são configuração de infraestrutura de cada nó |
| Valores fixos do gateway | Feito: BINA e IP do laboratório saíram do código (`DEFAULT_CALLER_ID`, `SIP_INTERNAL_HOST`); sem caller ID a chamada de teste falha com mensagem clara |

### Pendências

- Testar o ciclo completo com FreeSWITCH, tronco e um número real (cinco contatos, como no plano v3).
- Ligar `API_AUTH_TOKEN` no gateway em produção (sem ele a API do gateway fica aberta na rede interna).
- Rever com o time os 4 testes do Voll Plan marcados como desatualizados.
- Trocar as chaves de OpenAI e ElevenLabs que estavam no histórico do `voice-lab-2` e arquivar o repositório.

Avaliação original abaixo.

## Os dois projetos

| | Voll Plan (`10p30pl3/project-connect`) | Voll Connect (`voice-app`, remoto `10p30pl3/voice-lab-2`) |
|---|---|---|
| Papel | Cérebro: mailing, listas, campanhas, estratégia, elegibilidade, reserva, contadores, DNC, indicadores, inteligência CPC/BTC | Execução de voz: gateway FreeSWITCH + Drachtio, agente de IA (OpenAI Realtime / ElevenLabs), AMD, STT, gravação, troncos, ramais, rotas |
| Stack | Monorepo TS (Fastify 5 + React 19 + PostgreSQL 16), 99 commits | Node CommonJS (index.js 2,5 mil linhas + utils), serviço Python whisper (AMD/STT/biometria), estado em arquivos JSON |
| Persistência | Postgres com ledger, outbox, migrações 001–008 | `config/*.json` (tenants, rotas, troncos, outreach, histórico) |
| UI | SPA React (Campanhas, Inteligência, Canais, Observabilidade…) | `public/dashboard.html` (388 KB, HTML único): Chamadas, Gravações, Agentes, Configurações, Desenvolvedores |
| Testes | 30+ testes de API/motor + teste do conector voice-app | `test-qa.js`, scripts Python de avaliação |

## O que já está integrado

- **Voll Plan → voice-app:** adaptador `connectors/voice-app.ts` chama `POST /v1/calls` com `Idempotency-Key = attemptId`, contato, variáveis, limites e `callback {url, secret}`; também `GET/DELETE /v1/calls/:id` para status e cancelamento.
- **voice-app → Voll Plan:** `utils/voll-webhook.js` devolve `RESULT` assinado com HMAC (`x-voll-signature`) no formato `ConnectorEventSchema`, com tabulação decidida pela IA (CONVERSION, CPC_NO_DEAL, WRONG_PERSON, OPT_OUT, CALLBACK_SCHEDULED + `scheduledAt`, VOICEMAIL, NO_ANSWER, BUSY, INVALID_NUMBER), resumo, duração e custo.
- voice-app deduplica originação por `attemptId` e responde 202 assíncrono; 429 quando não há nó FreeSWITCH saudável.

A integração funcional existe; o que falta é unificar repositório, contrato, cadastro e interface.

## Pontos de atenção encontrados

1. **Código no OneDrive com git quebrado:** a pasta `voice-app` está em OneDrive; 15 fontes e parte de `.git` estão só na nuvem e o OneDrive não respondeu ao download (`refs/heads/main` corrompida, `git status` falha). Risco real de perda de histórico.
2. **Contrato duplicado à mão:** payload de `/v1/calls` e do webhook definidos separadamente nos dois lados, sem schema compartilhado nem teste de contrato.
3. **eventId aleatório:** cada término gera `evt-<timestamp>-<random>`; dois caminhos de encerramento podem gerar dois RESULT para a mesma tentativa. O Voll Plan tolera (só registra o tardio), mas o id deveria ser determinístico (`<attemptId>:result`).
4. **Moeda do custo:** voice-app envia `cost` em USD (custo de IA); Voll Plan trata custo da tentativa em BRL por tarifa. Precisa separar custo de IA e custo de telefonia com moeda explícita.
5. **Defaults sensíveis no código:** IP `192.168.15.36`, caller ID `+5511989785888` e token `voll-token-prod` fixos no adaptador e no seed.
6. **Sobreposição de funções:**
   - `outreach-manager` (disparos voice/SMS/WhatsApp) duplica o motor de campanhas do Voll Plan, sem DNC, limites ou idempotência.
   - Provedores SMS/WhatsApp do voice-app duplicam Canais/Conexões do Voll Plan.
   - Tenants do voice-app (DIDs, prompt, voz) não se ligam a organização/workspace do Voll Plan.
   - Dois painéis: dashboard.html e SPA React.
7. **Estado em JSON** no voice-app: sem concorrência entre instâncias nem auditoria.

## Proposta de consolidação

**Princípio:** Voll Plan decide quem, quando e por qual canal; o voice-app executa a chamada de voz. Um repositório, dois serviços implantados separadamente.

```
project-connect/
  apps/api            Voll Plan API + motor (TS)
  apps/web            SPA única (Voll Plan + telas de Telefonia/IA de voz)
  apps/voice-gateway  voice-app (Node JS, mantém FreeSWITCH/Drachtio/IA)
  services/whisper    serviço Python (AMD/STT/biometria)
  packages/shared     contratos: VoiceCallRequest, ConnectorEvent, códigos de tabulação
```

| Fase | Entrega |
|---|---|
| 0. Salvar o código | Tirar o voice-app do OneDrive, recuperar o git (ou importar de `voice-lab-2`), commitar o estado atual |
| 1. Monorepo | Importar o voice-app como `apps/voice-gateway` preservando histórico; `services/whisper`; docker-compose único |
| 2. Contrato único | Schemas Zod em `packages/shared` para `/v1/calls` e webhook; voice-app valida com o JSON Schema gerado; teste de contrato no CI; eventId determinístico; custo com moeda e tipo |
| 3. Cadastro único | Agente de IA/tenant do voice-app vinculado à Conexão do Voll Plan; config (prompt, voz, DIDs, caller ID) gerenciada pelo Voll Plan e enviada ao gateway; remover defaults fixos |
| 4. Interface única | Telas do dashboard.html migradas para a SPA: chamadas ao vivo (SSE), gravações/transcrições, agentes, troncos/ramais/rotas, custos de IA; dashboard.html vira ferramenta técnica |
| 5. Desativar duplicados | `outreach-manager` e provedores SMS/WhatsApp do voice-app aposentados em favor do motor e dos conectores do Voll Plan |
| 6. Persistência | Configuração do gateway (tenants, rotas, troncos) no Postgres via API do Voll Plan; voice-app lê e cacheia |
