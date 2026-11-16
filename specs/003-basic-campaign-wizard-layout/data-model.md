# Data Model: Assistente de Campanha Simplificado no Modo Básico e Layout Reorganizado

**Feature**: `003-basic-campaign-wizard-layout` | **Date**: 2026-11-15  
**Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/spec.md)

## 1. Alterações no Esquema PostgreSQL

### Migração `019_campaign_voice_agent.sql`

```sql
-- Seleção opcional de agente de voz específico por campanha
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS voice_agent_id text;
```

- `campaigns.voice_agent_id`: identificador do agente/tenant de voz no gateway (`text NULL`). Quando preenchido, sobrescreve `connections.config->>'tenantId'` apenas para chamadas originadas por essa campanha (`voiceAppAdapter.send`). Quando `NULL`, utiliza o vínculo padrão da conexão/gateway.

## 2. Entidades e Estruturas Compartilhadas (`packages/shared`)

### 2.1 `Campaign` (`CreateCampaignSchema`, `CampaignSummary`, `CampaignDetail`)

| Campo | Tipo | Obrigatoriedade | Descrição |
| --- | --- | --- | --- |
| `voiceAgentId` | `string \| null` | Opcional | ID do agente/tenant de voz específico desta campanha (validado no servidor contra `workspace_voice_resources`). |
| `calendarId` | `string \| null` | Opcional | Calendário de funcionamento selecionado na etapa Acionamento. |
| `listVersionId` | `string \| null` | Opcional | `NULL` no fluxo padrão do Modo Básico (aplicação automática de 100% da base do mailing). |
| `trunkIds` / `dialMultiplier` | `string[]` / `number` | Opcional (somente Gestor) | Mantidos no Modo Avançado; no Modo Básico não são enviados pela UI, usando padrões do banco (`'{}'` e `1.00`). |

### 2.2 `CampaignDraft` & `Extra` (`NewCampaign.tsx` / `campaign_drafts.data`)

Campos mantidos no JSONB `campaign_drafts.data` preservados integralmente entre alternâncias de `ExperienceMode`:

| Campo em `draft` / `draft.extra` | Tipo | Papel |
| --- | --- | --- |
| `step` | `'MAILING' \| 'AUDIENCE' \| 'ACTIVATION' \| 'CAMPAIGN'` | Etapa atual do assistente. |
| `mailingId` | `string \| null` | Mailing selecionado ou recém-importado. |
| `audienceMode` | `'ALL' \| 'LIST' \| null` | No Modo Básico, avançar do Mailing força `'ALL'` (100% da base). |
| `journeyVersionId` | `string \| null` | No Modo Básico, resolvido automaticamente para uma jornada de etapa única associada à conexão selecionada. |
| `strategyVersionId` | `string \| null` | No Modo Básico, selecionado automaticamente entre as estratégias simples ativas do workspace. |
| `extra.selectedConnectionId` | `string \| undefined` | ID da conexão ativa selecionada no bloco **Canal simples** (ou foco do canal simples no Acionamento). |
| `extra.voiceAgentId` | `string \| null \| undefined` | ID do agente selecionado especificamente para a campanha (`''` / `undefined` = padrão do canal quando não aplicável). |
| `extra.voiceAgentName` | `string \| undefined` | Nome amigável do agente para exibição imediata no resumo e coluna de detalhe. |
| `extra.calendarId` / `extra.calendarName` | `string \| undefined` | Calendário escolhido para a operação. |

### 2.3 `ExperienceMode` (`apps/web/src/lib/experience-mode.tsx`)

| Valor | Etapas do Assistente | Menu **Configuração → Canais** | Controles em `Acionamento` | Controles em `Resumo` |
| --- | --- | --- | --- | --- |
| `'basic'` | **1. Mailing** → **2. Acionamento** → **3. Resumo** (3 etapas) | Visível e acessível (`minMode: 'basic'`) | Somente **Agente**, **Canal simples** (conexões ativas de `/canais`) e **Calendário** | Somente **Nome**, **Descrição** e **Agendamento** (+ coluna de detalhe) |
| `'advanced'` | **1. Mailing** → **2. Público (filtro)** → **3. Acionamento** → **4. Revisar e finalizar** (4 etapas) | Visível e acessível | Completo: **Agente por campanha**, **Jornadas (Simples e Multicanal)**, **Estratégias (Simples e Completa)** e **Calendário** | Completo: **Identificação**, **Pilares**, **Preflight de Voz**, **Troncos & Ritmo (Gestor)**, **Agendamento**, **Salvar como modelo** |

## 3. Regras de Validação e Transições de Estado

1. **Precedência do Agente na Originação (`voiceAppAdapter.send`)**:
   - Se `campaigns.voice_agent_id` não for nulo/vazio → envia `tenantId = campaigns.voice_agent_id` no `VoiceCallRequest`. Se `campaign_voice_agent_id !== connection.id`, não aplica `agentVersion` embarcado antigo da conexão, utilizando o tenant publicado no gateway.
   - Caso `campaigns.voice_agent_id` seja nulo → mantém o fluxo atual (`connection.id` quando agente embarcado em sync, ou `connection.config.tenantId || 'default'`).
2. **Isolamento Multi-Tenant de Agente (`workspace_voice_resources`)**:
   - Ao receber `voiceAgentId` em `POST /campaigns`, se houver registro em `workspace_voice_resources` (`resource_type = 'agent', resource_id = voiceAgentId`) com `workspace_id` diferente do ator, retorna `403 Forbidden`.
3. **Transição Segura de Etapas ao Alternar Modo**:
   - `mode === 'advanced'` → `mode === 'basic'` estando em `step === 'AUDIENCE'`: redireciona automaticamente para `'ACTIVATION'` (se `mailingId` presente) ou `'MAILING'`, sem apagar `listVersionId`, `journeyVersionId`, `strategyVersionId` ou `extra`.
   - Navegação em `MailingStep`:
     - No Modo Básico: ao clicar em continuar/avançar, fixa `audienceMode = 'ALL'`, `listVersionId = null` e move `step` para `'ACTIVATION'`.
     - No Modo Avançado: move `step` para `'AUDIENCE'`.
4. **Canal Simples em Canais Não-Voz**:
   - Quando a conexão escolhida em **Canal simples** tiver `channelType !== 'VOICE'` (ex.: `WHATSAPP`, `SMS`, `EMAIL`), o bloco **Agente** sinaliza claramente que a seleção de agente de voz não é exigida para o canal escolhido (permitindo avançar com `voiceAgentId: null`), enquanto continua listando agentes ativos caso o usuário alterne para canal de voz.
