# Contrato de Interface: Gateway de Voz & Troncos (`apps/voice-gateway` <-> `@voll/shared`)

**Contract Schema**: `packages/shared/contracts/voice-call-request.schema.json` (gerado por `npm run contracts`)

## 1. Extensão de `VoiceCallRequest` (`POST /v1/calls`)

Adiciona o campo opcional no objeto `VoiceCallRequestSchema`:
```json
"trunkIds": {
  "type": "array",
  "items": { "type": "string", "minLength": 1 },
  "description": "Lista opcional de troncos de saída permitidos para esta chamada; vazio/omitido usa rota padrão do gateway."
}
```
> Também incluído na especificação do contrato JSON gerado em `packages/shared/contracts/voice-call-request.schema.json`.

## 2. Seleção, Aquisição e Liberação de Tronco no `POST /v1/calls`

1. Ao receber uma ordem `POST /v1/calls`:
   - Se `body.trunkIds` tiver IDs não vazios, o gateway seleciona o primeiro tronco dessa lista que esteja `active === true`, `online === true`, `direction !== 'inbound'` e com vaga livre (`activeCalls < maxChannels`), considerando também casamento com `outboundRouteManager` quando aplicável.
   - Se `body.trunkIds` estiver vazio/omitido, identifica o tronco pela rota de saída compatível (`outboundRouteManager.match(to)`) ou primeiro tronco de saída ativo/online disponível.
2. Chama `trunkManager.tryAcquire(selectedTrunkId)`:
   - Se **não houver nenhum tronco elegível com vaga livre**:
     - Responde **`429 Too Many Requests`**:
       ```json
       {
         "error": "trunk_capacity_exceeded",
         "retryAfterSec": 5,
         "message": "Todos os troncos de saída elegíveis estão ocupados ou indisponíveis."
       }
       ```
     - No adaptador da API (`voice-app.ts`), `429` lança `TransientConnectorError`, fazendo `dispatchOne` reagendar/liberar sem descartar o contato da fila.
   - Se **adquirir vaga com sucesso**:
     - Define header SIP `X-Trunk-ID: <selectedTrunkId>` na chamada enviada ao FreeSWITCH (`freeswitch-pool.js`).
     - Registra `trunkId` nos metadados/eventos da chamada (`callHistoryManager` e webhook `ConnectorEvent`).
     - Garante chamada única `trunkManager.release(selectedTrunkId)` em qualquer término (`BYE`, erro de originação, cancelamento ou timeout).

## 3. Novo Endpoint de Disponibilidade no Gateway

### `GET /v1/trunks/availability`
Retorna em chamada única leve (status em memória + snapshot/cache curto de registro Sofia `<= 3s`) a disponibilidade atual de todos os troncos:
```json
{
  "trunks": [
    {
      "id": "directcall",
      "name": "DirectCall",
      "direction": "both",
      "active": true,
      "online": true,
      "maxChannels": 30,
      "activeCalls": 4,
      "availableChannels": 26,
      "status": "UP",
      "state": "REGED"
    }
  ],
  "summary": {
    "totalTrunks": 1,
    "onlineOutboundTrunks": 1,
    "totalChannels": 30,
    "activeCalls": 4,
    "availableChannels": 26
  }
}
```
> Também o endpoint existente `GET /v1/trunks` passa a incluir `activeCalls` e `availableChannels` em cada item de `trunks`.
