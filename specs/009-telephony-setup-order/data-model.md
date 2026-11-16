# Data Model: Ordem Guiada de Configuração de Telefonia

**Feature**: `009-telephony-setup-order` | **Date**: 2026-11-16

Nenhuma tabela nova e nenhuma migração: tudo é derivado de recursos existentes. Os tipos abaixo vivem em `packages/shared/src/index.ts`.

## `TelephonySetupStepId`

`'trunk' | 'agent' | 'channel' | 'routes' | 'extension' | 'test'` — nesta ordem canônica (`TELEPHONY_SETUP_ORDER`).

## `TelephonySetupStep`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `TelephonySetupStepId` | Etapa |
| `order` | `number` | 1..6 |
| `label` | `string` | Nome pt-BR |
| `status` | `'pending' \| 'complete' \| 'problem'` | Derivado dos recursos |
| `optional` | `boolean` | `true` só para `extension` |
| `readOnly` | `boolean` | `true` quando o usuário não pode agir (ex.: tronco para admin comum) |
| `reason` | `string \| null` | Motivo para pending/problem (vai para tooltip) |
| `href` | `string \| null` | Rota da tela que resolve a etapa (`/telefonia?tab=trunks`, `/agentes-de-voz`, `/canais`, `/telefonia?tab=routes`, `/telefonia?tab=extensions`) |
| `count` | `number` | Quantidade de recursos que satisfazem a etapa |

## `TelephonySetupStatus`

| Campo | Tipo | Descrição |
|---|---|---|
| `mode` | `'basic' \| 'advanced'` | Modo para o qual as etapas foram filtradas |
| `steps` | `TelephonySetupStep[]` | Etapas visíveis, em ordem |
| `nextStepId` | `TelephonySetupStepId \| null` | Primeira etapa não opcional com `pending` ou `problem` |
| `pendingCount` | `number` | Etapas não opcionais com `pending` ou `problem` |
| `warnings` | `TelephonySetupWarning[]` | Incoerências específicas (FR-005) |
| `partial` | `boolean` | `true` se o gateway não respondeu e parte do snapshot ficou indisponível |

## `TelephonySetupWarning`

| Campo | Tipo | Descrição |
|---|---|---|
| `code` | `'outbound_route_without_trunk' \| 'inbound_route_agent_missing' \| 'inbound_route_agent_inactive' \| 'channel_without_coverage'` | Tipo da incoerência |
| `resourceId` | `string` | Rota/canal afetado |
| `resourceName` | `string` | Nome para exibição |
| `message` | `string` | Texto pt-BR curto |

## Snapshot de entrada (interno à API, não exposto)

`SetupSnapshot`: `trunks[] {id, active, online, hasFreeChannels}`, `agents[] {id, engineValid}`, `channels[] {id, channelType, active, tenantId}`, `inboundRoutes[] {id, enabled, tenantId, connectionId, channelType}`, `outboundRoutes[] {id, enabled, trunkId}`, `extensions[] {id}`, `recentCalls[] {status, durationSec}`, `gatewayReachable`.

## Catálogo de modelos por motor (US4)

`OPENAI_ENGINE_MODELS: Record<'openai' | 'openai_live', { default: string; options: { id: string; label: string }[] }>`

| Motor | Padrão | Opções |
|---|---|---|
| `openai` | `gpt-realtime-2.1-mini` | somente `gpt-realtime-2.1-mini` |
| `openai_live` | `gpt-live-1-mini` | somente `gpt-live-1-mini` |

IDs sujeitos à verificação na documentação oficial (ver research §6). Valores legados já salvos são preservados e exibidos como opção extra, sem migração.
