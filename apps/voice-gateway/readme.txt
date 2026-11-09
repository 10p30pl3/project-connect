Voice App (Production-Ready Multi-Tenant Voice Gateway)
==========================================================

Este aplicativo atua como uma ponte (bridge) de voz de alta performance entre o FreeSWITCH (via mod_audio_fork e Drachtio MRF) e a OpenAI Realtime API (WebSocket bidirecional), oferecendo:
- Suporte nativo a Multi-Tenant (roteamento automático de clientes por DID / número discado ou header SIP).
- Servidor central de mídia WebSocket (porta única compartilhada para múltiplas chamadas simultâneas, sem conflito de portas EADDRINUSE).
- Handshake em paralelo com a OpenAI (Zero-Wait Greeting) reduzindo a latência de atendimento em ~1 segundo.
- Upsampling linear anti-aliasing (8kHz -> 24kHz) e downsampling com filtro de média móvel (24kHz -> 8kHz).
- Calibração acústica adaptativa (Sonar Mode com detecção Goertzel de viva-voz vs fone e supressão de eco).
- Reconexão resiliente automática com FreeSWITCH ESL em caso de reinicialização do container.
- Proteção contra chamadas zumbi e estouro de custos na OpenAI (limite máximo de duração de chamada e cancelamento imediato ao desconectar).
- Endpoint HTTP de Healthcheck (/health) para balanceadores e monitoramento.
- Encerramento gracioso (Graceful Shutdown com SIGTERM/SIGINT) finalizando chamadas ativas com BYE SIP limpo.

----------------------------------------------------------
1. CONFIGURANDO O AMBIENTE
----------------------------------------------------------
Copie o arquivo `.env-example` para `.env` e preencha as variáveis de ambiente necessárias:

- OPENAI_API_KEY: Chave de API da OpenAI (padrão global para tenants que não possuem chave própria).
- OPENAI_REALTIME_MODEL: Modelo padrão (ex: `gpt-realtime-mini`).
- OPENAI_PROMPT_ID: ID do prompt gerenciado na OpenAI (opcional).
- OPENAI_AGENT_INSTRUCTIONS: Instruções da IA caso não use prompt_id.
- MAX_CALL_DURATION_SEC: Trava de segurança para duração máxima da ligação em segundos (ex: 900 = 15min).
- MEDIA_WS_PORT: Porta HTTP/WS fixa compartilhada da ponte de mídia (ex: 8090).
- AUDIO_FORK_WS_HOST: IP acessível pelo FreeSWITCH para conectar ao WebSocket de mídia.
- DRACHTIO_HOST / DRACHTIO_PORT / DRACHTIO_SECRET: Conexão Drachtio SIP Server.
- FREESWITCH_HOST / FREESWITCH_PORT / FREESWITCH_SECRET: Conexão ESL FreeSWITCH.

----------------------------------------------------------
2. CONFIGURANDO CLIENTES (MULTI-TENANT)
----------------------------------------------------------
Você pode atender múltiplos clientes com vozes, instruções, chaves da OpenAI e prompts diferentes na mesma instância!
Para isso:
1. Copie `config/tenants.example.json` para `config/tenants.json`.
2. Configure os clientes mapeando os números telefônicos discados (DIDs) ou o header SIP `X-Tenant-ID`.
3. Chamadas para números não listados utilizam automaticamente a configuração padrão definida no `.env`.

----------------------------------------------------------
3. HEALTH CHECK E MONITORAMENTO
----------------------------------------------------------
O servidor expõe um endpoint HTTP para healthcheck e métricas básicas:
  GET http://<host>:<MEDIA_WS_PORT>/health

Exemplo de resposta:
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-10-22T21:00:00.000Z",
  "activeCalls": 3,
  "mediaPort": 8090,
  "drachtioConnected": true,
  "freeSwitchConnected": true,
  "shuttingDown": false
}

----------------------------------------------------------
4. EXECUTANDO EM DESENVOLVIMENTO
----------------------------------------------------------
1. `npm install`
2. `npm start` (inicia `node index.js`)

----------------------------------------------------------
5. EXECUTANDO EM PRODUÇÃO
----------------------------------------------------------
Opção A — Com PM2 (Recomendado para servidores com Node.js):
  1. Instale o PM2: `npm install -g pm2`
  2. Inicie o serviço: `pm2 start ecosystem.config.js`
  3. Verifique o status: `pm2 status` ou `pm2 logs voice-app`

Opção B — Bundle Standalone (Para servidores sem npm ou node_modules):
  1. Na máquina de dev, gere o pacote: `npm run build`
  2. Copie apenas o arquivo `dist/index.js`, o `.env` e a pasta `config/` para o servidor destino.
  3. Execute: `node dist/index.js`

----------------------------------------------------------
6. DOCKER COMPOSE (DRACHTIO E FREESWITCH)
----------------------------------------------------------
O arquivo `docker-compose.yml` inicia os containeres do Drachtio e FreeSWITCH.
Certifique-se de preencher `DRACHTIO_EXTERNAL_IP` e `DRACHTIO_SECRET` no `.env`.
Execute:
  docker-compose up -d
