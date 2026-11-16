# Modelo de Dados: Envio de Campanha Limitado por Troncos de Saída

**Feature**: `002-campaign-trunk-dialer`  
**Date**: 2026-11-15  

## 1. Alterações em Entidades Persistidas (PostgreSQL 16)

### 1.1 `campaigns` (extensão de esquema — migração `018_campaign_trunk_dialer.sql`)

| Campo | Tipo | Padrão | Regras / Validação |
| --- | --- | --- | --- |
| `trunk_ids` | `text[]` | `'{}'` | Lista de IDs de troncos de saída permitidos para a campanha. `{}` = modo automático (todos os troncos ativos/online visíveis ao workspace). Editável exclusivamente por `MANAGER` / `ADMIN` / `SUPER_ADMIN`. |
| `dial_multiplier` | `numeric(4,2)` | `1.00` | Multiplicador aplicado sobre os canais/troncos livres (`0.50` a `5.00`, `CHECK (dial_multiplier >= 0.50 AND dial_multiplier <= 5.00)`). Editável exclusivamente por `MANAGER` / `ADMIN` / `SUPER_ADMIN`. |

### 1.2 `attempts` (extensão de esquema — rastreabilidade de tronco por tentativa)

| Campo | Tipo | Padrão | Regras / Validação |
| --- | --- | --- | --- |
| `trunk_id` | `text` | `NULL` | ID do tronco de saída alocado para a tentativa de discagem por voz (preenchido no envio/evento de retorno para auditoria, contabilização de ocupação e correlação). |

### 1.3 Índices adicionados

- `idx_attempts_active_trunk ON attempts (workspace_id, trunk_id, state) WHERE state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')` — acelera a contagem de reservas pré-gateway por tronco e workspace durante cada tick do worker.

---

## 2. Entidades e Projeções em Memória / Tempo Real

### 2.1 `TrunkAvailability` (Voice Gateway + API)

| Campo | Tipo | Origem | Descrição |
| --- | --- | --- | --- |
| `id` | `string` | `TrunkManager` | Identificador único do tronco SIP |
| `name` | `string` | `TrunkManager` | Nome amigável exibido na UI |
| `direction` | `'inbound' \| 'outbound' \| 'both'` | `TrunkManager` | Somente `'outbound'` ou `'both'` contam como saída |
| `active` | `boolean` | `TrunkManager` | Se o tronco não está pausado administrativamente |
| `online` | `boolean` | `TrunkManager.status` | `true` se não registrado (`register=false`) e carregado no FreeSWITCH, ou `state === 'REGED'` / `status === 'UP'` quando `register=true` |
| `maxChannels` | `number` | `TrunkManager` | Capacidade simultânea configurada (`>= 1`; fallback `1` quando ausente) |
| `activeCalls` | `number` | `TrunkManager.activeCalls` | Chamadas em curso ocupando este tronco (campanhas + manuais) |
| `availableChannels` | `number` | Calculado | `active && online && direction !== 'inbound' ? max(0, maxChannels - activeCalls) : 0` |
| `statusMessage` | `string \| null` | `TrunkManager.status` | Motivo legível caso indisponível (ex.: `'PAUSED'`, `'DOWN'`, `'NOREG'`) |

### 2.2 `CampaignDialerConfig` (Contrato compartilhado `@voll/shared`)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `trunkIds` | `string[]` | Array de IDs válidos (vazio = automático; cada ID deve existir dentre os troncos visíveis do workspace quando fornecido) |
| `dialMultiplier` | `number` | Número entre `0.5` e `5.0`, padrão `1.0` |

### 2.3 `CampaignDialerStatus` (Projeção em tempo real para `US3`)

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `campaignId` | `string (uuid)` | ID da campanha |
| `loadedTotal` | `number` | Total de contatos materializados/elegíveis na fila da campanha (`enrollments`) |
| `activeDialing` | `number` | Tentativas em andamento (`RESERVED`, `SENT`, `AWAITING_FEEDBACK`, `RECONCILIATION`) |
| `queuedWaitingTrunk` | `number` | Inscrições `ACTIVE` aptas aguardando liberação de tronco/cota para serem enviadas |
| `completedOrSkipped` | `number` | Contatos já concluídos (`DONE_SUCCESS`, `DONE_FAIL`, `CANCELLED`) |
| `availableTrunkSlots` | `number` | Soma das vagas livres nos troncos elegíveis da campanha no instante |
| `totalTrunkChannels` | `number` | Capacidade total configurada nos troncos selecionados (ou todos do workspace se automático) |
| `dialMultiplier` | `number` | Multiplicador ativo da campanha (`>= 0.5 && <= 5.0`) |
| `effectiveQuota` | `number` | `floor(availableTrunkSlots * dialMultiplier)` |
| `waitingReason` | `'NONE' \| 'NO_ELIGIBLE_TRUNKS' \| 'ALL_TRUNKS_BUSY' \| 'OUTSIDE_CALENDAR' \| 'PAUSED' \| 'GLOBAL_SUSPENSION'` | Diagnóstico imediato exibido no acompanhamento da campanha |
| `canEditDialerConfig` | `boolean` | `true` somente para perfis gerenciais (`MANAGER`, `ADMIN`, `SUPER_ADMIN`); `false` para `OPERATOR` e demais |
| `trunks` | `TrunkAvailability[]` | Lista dos troncos elegíveis considerados no cálculo |

---

## 3. Fluxo de Estados e Controle de Concorrência

```text
[Lista / Mailing]
   │ (ao iniciar campanha ou dinâmica)
   ▼
[enrollments: ACTIVE] ──(tick do worker: calcula vagas livres nos troncos visíveis)
   │
   ├── vagasLivres == 0 ──► Permanece em [ACTIVE] (waitingReason = NO_ELIGIBLE_TRUNKS / ALL_TRUNKS_BUSY)
   │
   └── vagasLivres > 0 (cota = floor(vagasLivres * dialMultiplier))
         │ revalida bloqueios (DNC), validade, calendário e unicidade por contato
         ▼
      [attempts: RESERVED] + [outbox: PENDING]
         │ worker dispatchOne -> voiceAppAdapter.send(trunkIds)
         ▼
      [Voice Gateway POST /v1/calls]
         ├── seleciona tronco elegível com vaga -> trunkManager.tryAcquire(trunkId) -> [SENT / AWAITING_FEEDBACK]
         └── sem vaga momentânea (429 trunk_capacity_exceeded) -> TransientConnectorError -> retenta / libera sem perder contato
         │
         ▼ (término da chamada / webhook FINALIZED ou RELEASED)
      trunkManager.release(trunkId) + próximo ciclo reserva próximo enrollment ACTIVE (<= 5s)
```
