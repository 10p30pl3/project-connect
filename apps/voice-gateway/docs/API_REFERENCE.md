# Revisão e Catálogo Completo de APIs da Plataforma de Voz (`/v1`)

> **Visão Geral:** A plataforma de voz expõe uma API RESTful completa na porta `:8090` (roteada por `utils/api-router.js` e integrada ao `WsMediaServer`), além de controle por **Headers SIP** e **WebSockets de Mídia/IA**. Todos os principais comandos de mercado de plataformas CPaaS e Voice AI (*Twilio, Jambonz, Vapi, Retell, Asterisk ARI*) estão implementados e ativos.

---

## 1. Resumo Executivo: Todos os Comandos de Mercado Disponíveis

| Categoria | Método | Endpoint REST | Comando de Mercado Equivalente | Descrição |
| :--- | :---: | :--- | :--- | :--- |
| **Observabilidade** | `GET` | `/health` | *Healthcheck* | Status rápido do Worker, Drachtio, Pool FreeSWITCH e chamadas por Tenant. |
| **Observabilidade** | `GET` | `/v1/status` | *Cluster Status* | Saúde completa incluindo o Pool Whisper (`:8082`) e contadores globais. |
| **Observabilidade** | `GET` | `/v1/cluster/nodes` | *Media Nodes* | Lista detalhada dos nós FreeSWITCH e Whisper (carga, latência e falhas). |
| **Observabilidade** | `GET` | `/v1/commands` | *OpenAPI / Discovery* | Catálogo autodescritivo de todas as rotas e comandos disponíveis. |
| **Chamadas (CPaaS)** | `GET` | `/v1/calls` | *List Active Calls* | Lista todas as chamadas em andamento com perfil acústico e estado da IA. |
| **Chamadas (CPaaS)** | `POST` | `/v1/calls` | **`originate` / Outbound Call** | Dispara uma chamada SIP ativa (`to`, `from`, `tenantId`, `amd`, `stt`, `instructions`). |
| **Chamadas (CPaaS)** | `GET` | `/v1/calls/:callId` | *Inspect Call* | Estado completo da chamada + histórico de transcrição em tempo real. |
| **Chamadas (CPaaS)** | `DELETE` | `/v1/calls/:callId` | **`hangup`** | Desliga a chamada imediatamente. |
| **Chamadas (CPaaS)** | `POST` | `/v1/calls/:callId/hangup` | **`hangup` (com motivo)** | Desliga a chamada informando `reason` customizado para auditoria. |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/say` | **`say` / `whisper` / `inject`** | Injeta fala ou instrução de sistema em tempo real na sessão da OpenAI. |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/interrupt` | **`barge-in` / `kill_audio`** | Corta instantaneamente a voz da IA (`killAudio` + `response.cancel`). |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/transfer` | **`transfer` / `refer`** | Transfere a chamada (Blind Transfer via FreeSWITCH ou SIP `REFER`). |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/dtmf` | **`send_dtmf`** | Envia tons DTMF RFC2833 na linha (`outbound`) ou simula tecla para a IA (`inbound`). |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/play` | **`play_audio`** | Toca um arquivo `.wav` ou `tone_stream://` diretamente no canal FreeSWITCH. |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/mute` | **`mute`** | Silencia o microfone do canal no FreeSWITCH. |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/unmute` | **`unmute`** | Reativa o microfone do canal no FreeSWITCH. |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/hold` | **`hold`** | Coloca a chamada em espera (`uuid_hold`). |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/unhold` | **`unhold`** | Retoma a chamada em espera (`uuid_hold off`). |
| **Comandos In-Call** | `POST` | `/v1/calls/:callId/recording` | **`record` (`start`/`pause`/`resume`/`stop`)** | Inicia, pausa (PCI-DSS/LGPD), retoma ou para a gravação Estéreo `.wav` + `.txt`. |
| **Comandos In-Call** | `GET` | `/v1/calls/:callId/transcript` | **`live_transcript`** | Retorna o diálogo em tempo real dividido em `Cliente:` e `Atendente:` com data/hora. |
| **Compliance & Arquivos** | `GET` | `/v1/recordings` | *List Recordings* | Lista todas as gravações `.wav` e transcrições `.txt` armazenadas. |
| **Compliance & Arquivos** | `GET` | `/v1/recordings/:id/audio` | *Download Stereo WAV* | Faz streaming/download do arquivo `.wav` Estéreo (Canal L=Cliente, R=Atendente). |
| **Compliance & Arquivos** | `GET` | `/v1/recordings/:id/transcript` | *Get Dialogue Transcript* | Retorna a transcrição dialogada com Data/Hora em JSON estruturado ou `.txt`. |
| **Compliance & Arquivos** | `DELETE` | `/v1/recordings/:id` | *LGPD Erase Recording* | Apaga definitivamente o áudio `.wav` e a transcrição `.txt` do disco. |
| **Multi-Tenant** | `GET` | `/v1/tenants` | *List Tenants* | Lista todos os clientes/tenants, limites de canais/CPS e chamadas ativas. |
| **Multi-Tenant** | `GET` | `/v1/tenants/:id` | *Get Tenant* | Detalhes de configuração de um tenant específico. |
| **Multi-Tenant** | `POST` | `/v1/tenants` | *Create/Upsert Tenant* | Cria ou atualiza um tenant em tempo real com persistência e *hot-reload*. |
| **Multi-Tenant** | `PUT` | `/v1/tenants/:id` | *Update Tenant* | Atualiza prompt, voz, DIDs, AMD, STT ou limites de um tenant. |
| **Multi-Tenant** | `DELETE` | `/v1/tenants/:id` | *Delete Tenant* | Remove um tenant cadastrado. |
