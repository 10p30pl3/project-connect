# Phase 0 Research: Assistente de Campanha Simplificado no Modo Básico e Layout Reorganizado

**Feature**: `003-basic-campaign-wizard-layout` | **Date**: 2026-11-15  
**Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/spec.md)

## R1. Seleção de Agente por Campanha (`campaigns.voice_agent_id`)

- **Decision**: Adicionar a coluna opcional `voice_agent_id text` na tabela `campaigns` (`019_campaign_voice_agent.sql`), aceita em `CreateCampaignSchema` (`packages/shared`) e validada quanto à posse pelo workspace (`workspace_voice_resources`), passando a ter precedência sobre o agente padrão da conexão (`connections.config.tenantId` / `voiceAgent`) em `voiceAppAdapter.send()`.
- **Rationale**: Atende diretamente à clarificação Q1 (**Escolha por campanha**) de forma idempotente e isolada: múltiplas campanhas simultâneas usando a mesma conexão `VOICE_APP` podem apontar para agentes distintos sem sobrescrever `connections.config` e sem efeitos colaterais em campanhas já em andamento. Quando `voice_agent_id` for `NULL`, mantém-se 100% compatível com o vínculo padrão da conexão/gateway.
- **Alternatives considered**:
  - *Alterar `connections.config.tenantId` antes de criar a campanha*: rejeitado porque criaria condição de corrida entre campanhas paralelas e alteraria o agente de campanhas existentes.
  - *Armazenar apenas dentro de `strategy_versions.config.voiceOverrides`*: rejeitado porque estratégias são versionadas e compartilhadas entre campanhas, enquanto o usuário escolhe o agente especificamente para a campanha atual no passo **Acionamento**.

## R2. Listagem de Canais Ativos e Criação Automática de Jornada de Canal Simples

- **Decision**: No bloco **Canal simples** do **Modo Básico**, listar as conexões ativas configuradas em **Configuração → Canais** (`GET /connections`, filtrando `c.active === true`), pré-selecionar o canal compatível e resolver automaticamente nos bastidores uma **jornada de etapa única** (`steps.length === 1 && steps[0].connectionId === conn.id`, reutilizando uma jornada existente do workspace ou criando-a via `POST /journeys` sob demanda) junto da estratégia ativa simples padrão compatível (`simples` / `limits.total <= 6`, ou fallback para a primeira estratégia ativa).
- **Rationale**: Preserva integralmente o modelo de execução do motor (`campaign.journey_version_id` e `campaign.strategy_version_id` obrigatórios em `campaigns` e `enrollments`), evitando que o usuário do Modo Básico precise visitar `/jornadas` ou `/estrategias` (que permanecem no Modo Avançado) e evitando duplicação desnecessária de jornadas quando uma jornada de etapa única para aquela conexão já existe.
- **Alternatives considered**:
  - *Tornar `journey_version_id` e `strategy_version_id` opcionais no banco e no motor de elegibilidade*: rejeitado porque alteraria desnecessariamente os invariantes centrais do motor (`eligibility.ts`, `reserve.ts`, `attempts`) para um fluxo que é naturalmente representável como jornada de 1 etapa.

## R3. Acesso à Tela `Configuração → Canais` no Modo Básico

- **Decision**: Alterar `minMode` do item `{ to: '/canais', label: 'Canais', ... }` em `NAV_GROUPS` (`apps/web/src/components/Layout.tsx`) de `'advanced'` para `'basic'` e atualizar a descrição resumida do Modo Básico em `EXPERIENCE_MODE_META` (`apps/web/src/lib/experience-mode.tsx`).
- **Rationale**: Atende diretamente à clarificação Q2 (**FR-005b**), permitindo ao usuário no Modo Básico cadastrar, ativar ou inspecionar seus canais (`/canais`) antes ou durante a criação de campanhas sem precisar alternar para o Modo Avançado.
- **Alternatives considered**:
  - *Exibir atalho de modal inline dentro de `NewCampaign.tsx` sem liberar `/canais` no menu*: rejeitado porque o requisito explícito exige a opção **Canais** acessível também em **Configuração → Canais** no Modo Básico.

## R4. Organização Visual em Duas Colunas (Opção B Adaptada) e Dicas em Tooltip

- **Decision**: Implementar layout padrão de duas colunas em desktop (`lg:grid-cols-12`, coluna principal `lg:col-span-7` com blocos empilhados verticalmente + coluna lateral fixa/sticky `lg:col-span-5` exibindo **Detalhamento da seleção** em tempo real conforme bloco/opção em foco ou selecionada), migrando textos conceituais longos do corpo das telas para `tooltip="..."` / `<InfoTooltip />` (Princípio IV). Em telas menores (`< lg`), as colunas empilham naturalmente (`grid-cols-1`).
- **Rationale**: Atende exatamente à clarificação Q3 (**Opção B adaptada**) combinada com o **Princípio IV** da constituição: a coluna esquerda mantém leitura sequencial clara sem poluição horizontal ou parágrafos extensos, enquanto a coluna direita dá visibilidade imediata dos atributos técnicos/operacionais da opção escolhida (agente, canal, calendário, estratégia, jornada, agendamento ou troncos) antes de avançar. Além disso, unifica o padrão de detecção de conexão de voz em `NewCampaign.tsx` corrigindo a verificação legada `c.channelType === 'VOICE_APP'` para checar `c.provider === 'VOICE_APP' || c.channelType === 'VOICE'`.
- **Alternatives considered**:
  - *Grade de 3 colunas horizontais sem coluna de detalhe lateral (Opção A / C)*: descartada pelo usuário na Q3 por preferir a lista empilhada com inspetor detalhado à direita.

## R5. Persistência Confiável do Rascunho e Segurança na Alternância de Modo

- **Decision**: Alinhar `NewCampaign.tsx` ao contrato real de `/campaign-draft` definido em `SaveDraftSchema` (`{ data, revision }` / `{ data, revision, updatedAt }` de `apps/web/src/lib/types.ts` e `apps/api/src/modules/campaigns.ts`), guardar preferências de modo simples (`selectedConnectionId`, `voiceAgentId`, `voiceAgentName`, `calendarId`, etc.) em `draft.extra`, e garantir via efeito reativo que alternar de **Avançado → Básico** enquanto `step === 'AUDIENCE'` redirecione imediatamente para `'ACTIVATION'` (quando `mailingId` estiver definido) ou `'MAILING'`, preservando todos os demais campos do rascunho.
- **Rationale**: Identificamos que `NewCampaign.tsx` utilizava payload divergente (`{ draft, clientRevision }` em vez de `{ data, revision }`), o que causava rejeição na API real. Corrigir esse contrato torna a persistência entre recargas e alternâncias de modo (`FR-010`) confiável contra PostgreSQL 16.
- **Alternatives considered**:
  - *Manter estado apenas em `localStorage`*: rejeitado porque o backend já possui tabela `campaign_drafts` com controle otimista de revisão e endpoints REST dedicados.
