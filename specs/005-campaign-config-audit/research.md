# Phase 0 Research: Edição de Configurações e Histórico de Alterações de Campanha

## 1. Onde armazenar o histórico de alterações da campanha?

- **Decision**: Reutilizar a tabela existente `audit_log` (`apps/api/migrations/001_init.sql`) com `entity = 'campaign'` e `entity_id = campaign.id`, adicionando um índice composto em `audit_log (workspace_id, entity, entity_id, at DESC)` na migration `017_campaign_history_index.sql`.
- **Rationale**: `audit_log` já possui trigger `forbid_mutation()` (`BEFORE UPDATE OR DELETE`), referência `user_id REFERENCES users(id)`, coluna `at timestamptz NOT NULL DEFAULT now()`, `action text`, `reason text`, `before jsonb` e `after jsonb`. Reaproveitá-la evita duplicar infraestrutura de auditoria e mantém consistência com o painel de auditoria global.
- **Alternatives considered**: Criar uma nova tabela `campaign_history`. Rejeitado por duplicar exatamente as colunas e a proteção append-only já existentes em `audit_log`.

## 2. Como representar "o que foi modificado" com clareza humana e precisão?

- **Decision**: Calcular o diff no backend antes de gravar o `audit()`, comparando os valores atuais e novos de cada campo configurável (`name`, `description`, `listVersionId`, `journeyVersionId`, `strategyVersionId`, `calendarId`, `scheduledAt`) e resolvendo rótulos legíveis (ex.: nome da jornada + versão, nome da estratégia + versão, nome do calendário, nome da lista). Gravar em `audit_log.after` o objeto `{ snapshot, changes: Array<{ field, label, before, after }> }`.
- **Rationale**: Se armazenarmos apenas UUIDs brutos (`journey_version_id`), o operador não sabe qual jornada era antes e qual passou a ser depois, especialmente se o nome da jornada mudar no futuro. Gravar o rótulo resolvido no momento da alteração garante leitura imediata e histórica fiel.
- **Alternatives considered**: Calcular diff apenas no frontend comparando `before` e `after` JSON. Rejeitado porque o frontend não teria os nomes resolvidos de versões antigas sem múltiplas chamadas extras.

## 3. O que fazer quando o usuário salva sem alterar nada?

- **Decision**: No `PATCH /campaigns/:id`, se `changes.length === 0`, não executar `UPDATE` nem `INSERT INTO audit_log`, retornando `{ campaign, changed: false, changes: [] }`.
- **Rationale**: Atende diretamente ao requisito `FR-008` e `SC-003`, evitando poluir o histórico com eventos vazios.
- **Alternatives considered**: Gravar um evento "salvo sem alterações". Rejeitado por gerar ruído operacional.

## 4. Quais campos podem ser editados em cada status de campanha?

- **Decision**:
  - Campanhas `COMPLETED`, `CANCELLED` ou com `archived_at IS NOT NULL`: edição bloqueada (`HTTP 409`).
  - Campanhas `DRAFT`, `READY`, `SCHEDULED`, `RUNNING`, `PAUSED`: editáveis `name`, `description`, `listVersionId` (null = toda a base do mailing), `journeyVersionId`, `strategyVersionId`, `calendarId` (null = padrão da estratégia) e `scheduledAt` (para `DRAFT`/`READY`/`SCHEDULED`).
  - `mailingId` permanece fixo após a criação da campanha para preservar a integridade dos contatos e matrículas (`enrollments`).
- **Rationale**: Preserva consistência referencial de `enrollments`/`attempts` enquanto libera todos os parâmetros operacionais que supervisores precisam ajustar em campo.
- **Alternatives considered**: Permitir trocar `mailingId` em `RUNNING`. Rejeitado por risco de inconsistência com `mailing_records` já matriculados.
