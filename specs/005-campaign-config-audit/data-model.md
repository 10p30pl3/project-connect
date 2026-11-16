# Data Model: Edição de Configurações e Histórico de Alterações de Campanha

## 1. Entidade `campaigns` (existente — `apps/api/migrations/001_init.sql` + `014` + `015`)

Campos editáveis via `PATCH /campaigns/:id`:

| Campo (DB) | Campo (API) | Tipo | Editável? | Observação |
|---|---|---|---|---|
| `name` | `name` | `text` | Sim | Não vazio (1–120 chars) |
| `description` | `description` | `text \| null` | Sim | `null` quando limpo |
| `list_version_id` | `listVersionId` | `uuid \| null` | Sim | `null` = todos os contatos do mailing |
| `journey_version_id` | `journeyVersionId` | `uuid` | Sim | Deve pertencer ao `workspace_id` |
| `strategy_version_id` | `strategyVersionId` | `uuid` | Sim | Deve pertencer ao `workspace_id` |
| `calendar_id` | `calendarId` | `uuid \| null` | Sim | `null` = padrão da estratégia |
| `scheduled_at` | `scheduledAt` | `timestamptz \| null` | Condicional | Editável quando `status IN ('DRAFT','READY','SCHEDULED')` |

Restrições:
- Edição bloqueada quando `archived_at IS NOT NULL` ou `status IN ('COMPLETED', 'CANCELLED')`.

## 2. Entidade `audit_log` (existente, append-only) + Índice (`017_campaign_history_index.sql`)

```sql
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_entity_at
  ON audit_log (workspace_id, entity, entity_id, at DESC, id DESC);
```

Estrutura lógica de cada registro de campanha (`entity = 'campaign'`, `entity_id = campaign.id`):

- `id`: `bigint` (sequencial)
- `organization_id`: `uuid`
- `workspace_id`: `uuid`
- `user_id`: `uuid | null` (join em `users` para obter `actorName` e `actorEmail`)
- `action`: `text` (`'campaign.created'`, `'campaign.updated'`, `'campaign.paused'`, `'campaign.resumed'`, `'campaign.stopped'`, `'campaign.archived'`, `'campaign.restored'`)
- `entity`: `'campaign'`
- `entity_id`: `text` (UUID da campanha)
- `reason`: `text | null` (motivo opcional informado pelo operador)
- `before`: `jsonb` (snapshot anterior dos campos legíveis)
- `after`: `jsonb`:
  ```json
  {
    "snapshot": { "...": "..." },
    "changes": [
      {
        "field": "calendarId",
        "label": "Calendário de funcionamento",
        "before": "Comercial Brasil",
        "after": "Horário Estendido (Cobrança)"
      }
    ]
  }
  ```
- `at`: `timestamptz` (data, hora, minuto e segundo exatos da modificação)
