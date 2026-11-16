# UI Contracts: Assistente em Duas Colunas (Opção B Adaptada) e Navegação por Modo

**Feature**: `003-basic-campaign-wizard-layout` | **Date**: 2026-11-15

## 1. Menu Lateral (`apps/web/src/components/Layout.tsx`)

- Grupo **Configuração**:
  - `{ to: '/canais', label: 'Canais', minMode: 'basic' }` — **DEVE** estar visível e navegável tanto no **Modo Básico** quanto no **Modo Avançado** (`FR-005b`).

## 2. Stepper e Roteamento de Etapas (`apps/web/src/pages/NewCampaign.tsx`)

| Modo Ativo | Etapas Exibidas no Stepper | Ação "Continuar" da Etapa 1 (Mailing) |
| --- | --- | --- |
| `basic` | `1. Mailing` → `2. Acionamento` → `3. Resumo` | Seta `audienceMode: 'ALL'`, `listVersionId: null` e navega para `ACTIVATION` (`2. Acionamento`). |
| `advanced` | `1. Mailing` → `2. Público (filtro)` → `3. Acionamento` → `4. Revisar e finalizar` | Navega para `AUDIENCE` (`2. Público (filtro)`). |

- **Alternância `advanced → basic` com `step === 'AUDIENCE'`**:
  - Redireciona automaticamente para `ACTIVATION` (se `mailingId` estiver definido) ou `MAILING`, mantendo o rascunho intacto (`FR-010`).

## 3. Estrutura em Duas Colunas (`FR-009` — Opção B Adaptada)

Todas as etapas principais (`Mailing`, `Público` no Avançado, `Acionamento` e `Resumo`) utilizam o grid responsivo:

- **Desktop (`>= lg`)**: `grid-cols-1 lg:grid-cols-12 gap-6 items-start`
  - **Coluna Principal (Esquerda — `lg:col-span-7 space-y-4`)**: cartões de seleção e formulário **empilhados verticalmente**, com cabeçalhos limpos e explicações conceituais exclusivamente via `tooltip="..."` / `<InfoTooltip />` (zero parágrafos descritivos inline no corpo, em conformidade com o **Princípio IV**).
  - **Coluna de Detalhamento (Direita — `lg:col-span-5 lg:sticky lg:top-6`)**: cartão/painel contextual fixo que detalha em tempo real a **opção escolhida ou seção em foco** na coluna esquerda (incluindo atalhos no cabeçalho do painel para alternar a inspeção entre as opções já selecionadas da etapa).
- **Mobile/Tablet (`< lg`)**: empilhamento natural em coluna única (seleção seguida do detalhamento).

## 4. Regras de Visibilidade por Etapa

### 4.1 Etapa `Acionamento`

- **Modo Básico**:
  - **Esquerda (empilhados)**:
    1. **1. Agente**: lista agentes ativos do workspace (`GET /telephony/tenants`, além de agente embarcado em conexões `VOICE_APP` quando aplicável), pré-selecionando o agente vinculado ao canal escolhido (com opção de sobrescrever apenas para esta campanha ou seguir padrão quando não aplicável a canais digitais).
    2. **2. Canal simples**: lista canais ativos configurados em **Configuração → Canais** (`active === true`), com atalho discreto para `/canais`. Sem abas de multicanal nem editor de estratégia.
    3. **3. Calendário**: lista calendários ativos configurados no workspace (`GET /calendars`).
  - **Direita (Detalhamento da seleção)**:
    - Exibe detalhes da opção ativa/selecionada (`Agente`: motor STS, modelo, voiceId, caller ID padrão, prévia de instruções; `Canal simples`: provedor, tipo de canal, status ativo, tarifa se super admin; `Calendário`: dias/horários, fuso horário, política de feriados).

- **Modo Avançado**:
  - **Esquerda (empilhados)**:
    1. **Agente por campanha**
    2. **Jornada de Canais (Simples / Multicanal)** + canais configurados
    3. **Estratégia & Regras (Simples / Completa)**
    4. **Calendário de Funcionamento**
  - **Direita (Detalhamento da seleção)**:
    - Inspeciona em tempo real o bloco focado/selecionado (detalhes do agente, passos da jornada selecionada, resumo de limites/cooldown/tabulações da estratégia ou janelas do calendário).

### 4.2 Etapa `Resumo` (`CAMPAIGN`)

- **Modo Básico**:
  - **Esquerda (empilhados)**: somente **Identificação** (`Nome da campanha *`, `Descrição (opcional)`) e **Agendamento** (`Iniciar imediatamente` vs `Agendar data futura`).
  - **Direita (Detalhamento da seleção)**: resumo consolidado e claro da opção/configuração escolhida para o disparo (**Mailing + Base 100%**, **Agente selecionado**, **Canal simples selecionado**, **Calendário** e **Data/hora do agendamento**), sem exibir cards técnicos de pilares, preflight de troncos/gateway, multiplicador do discador ou botão *Salvar como modelo*.
- **Modo Avançado**:
  - **Esquerda (empilhados)**: `Identificação`, `Agendamento`, `Resumo dos Pilares`, `Preflight de Voz`, `Troncos de Saída & Ritmo do Discador` (editável por Gestor; leitura para Operador) e ação `Salvar como modelo`.
  - **Direita (Detalhamento da seleção)**: inspetor ao vivo acompanhando identificação/agendamento, capacidade de troncos x multiplicador ou resumo técnico completo dos pilares antes da criação.
