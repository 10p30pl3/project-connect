# Quickstart & Validation Guide: Assistente Simplificado no Modo Básico e Layout Reorganizado

**Feature**: `003-basic-campaign-wizard-layout` | **Spec**: [spec.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/spec.md)  
**Models & Contracts**: [data-model.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/data-model.md) · [api-campaign-wizard.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/contracts/api-campaign-wizard.md) · [ui-campaign-wizard.md](file:///Users/macm/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/code/project-connect/specs/003-basic-campaign-wizard-layout/contracts/ui-campaign-wizard.md)

## Pré-requisitos

- PostgreSQL 16 disponível para testes (`voll_connect_test`) com migrações aplicadas (incluindo `019_campaign_voice_agent.sql`).
- Dependências do monorepo instaladas (`npm ci` / `npm install`).

## 1. Validação Automatizada (Typecheck, Contratos, API & Build)

Execute os comandos abaixo a partir da raiz do repositório:

```bash
npm run contracts
npm run typecheck
npm run test -w @voll/api
npm run build
```

### Cobertura esperada nos testes da API

1. **`voiceAgentId` por campanha**:
   - `POST /api/campaigns` com `voiceAgentId` persistido em `campaigns.voice_agent_id` e retornado em `GET /api/campaigns/:id`.
   - `voiceAppAdapter.send` envia `tenantId = campaign.voice_agent_id` sem modificar `connections.config.tenantId`.
   - Tentativa de enviar `voiceAgentId` pertencente a outro workspace em `workspace_voice_resources` falha com HTTP `403`.
   - Campanha sem `voiceAgentId` (`null`) continua herdando o agente padrão da conexão.
2. **Persistência de rascunho (`/api/campaign-draft`)**:
   - Criação, atualização com revisão otimista e limpeza automática após criação da campanha.

## 2. Cenários de Validação Ponta a Ponta na Interface

1. **Menu `Configuração → Canais` no Modo Básico (`FR-005b`)**:
   - Selecione **Modo Básico** no seletor global do cabeçalho/lateral.
   - Verifique que o item **Configuração → Canais** (`/canais`) aparece no menu lateral e abre normalmente.
2. **Criação em 3 Etapas no Modo Básico (`FR-002` a `FR-007`)**:
   - Acesse `/campanhas/nova` em **Modo Básico**.
   - Verifique que o stepper exibe **3 etapas**: `1. Mailing`, `2. Acionamento`, `3. Resumo` (sem `Público (filtro)`).
   - Selecione um Mailing e clique para continuar: deve ir direto para `Acionamento` com 100% da base elegível aplicada.
   - Em `Acionamento`, confirme layout em **2 colunas**: à esquerda apenas `Agente`, `Canal simples` (listando canais ativos de `/canais`) e `Calendário`; à direita o painel de detalhamento atualizando conforme o item escolhido.
   - Em `Resumo`, confirme apenas `Identificação` (`Nome` e `Descrição`) e `Agendamento` à esquerda + detalhamento à direita, criando a campanha com sucesso.
3. **Alternância Segura Avançado ↔ Básico (`FR-010`)**:
   - No **Modo Avançado**, navegue até a etapa `2. Público (filtro)` após escolher um mailing e alterne o seletor global para **Modo Básico**.
   - Confirme redirecionamento imediato para `Acionamento` mantendo mailing e demais seleções no rascunho.
4. **Modo Avançado Completo (`FR-008`, `FR-009`)**:
   - Confirme presença das 4 etapas e de todos os controles avançados (Filtros/Dinâmica, Jornadas Multicanal, Estratégias Completas, Preflight de Voz, Troncos/Multiplicador para Gestor e Salvar como modelo) organizados no layout de 2 colunas com explicações em tooltips `(?)`.
