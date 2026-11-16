# API & Schema Contracts: Campaign Config Edit & History

## 1. Shared Zod Schemas (`packages/shared/src/index.ts`)

### `UpdateCampaignSchema`
```ts
export const UpdateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  listVersionId: z.string().uuid().nullable().optional(),
  journeyVersionId: z.string().uuid().optional(),
  strategyVersionId: z.string().uuid().optional(),
  calendarId: z.string().uuid().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  reason: z.string().trim().max(240).optional(),
});
```

### `CampaignHistoryChange` & `CampaignHistoryItem`
```ts
export type CampaignHistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type CampaignHistoryItem = {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  reason: string | null;
  at: string; // ISO 8601 com segundos
  changes: CampaignHistoryChange[];
};
```

## 2. HTTP Endpoints (`apps/api/src/modules/campaigns.ts`)

### `PATCH /campaigns/:id`
- **Auth**: `requireRoles(...CAN.manageData)` + escopo `workspace_id = req.auth.workspaceId`.
- **Body**: `UpdateCampaignSchema`.
- **Behavior**:
  1. Carrega campanha atual com `FOR UPDATE` dentro de `withTransaction`.
  2. Se não encontrada → `404`; se arquivada ou `status IN ('COMPLETED', 'CANCELLED')` → `409`.
  3. Valida referências (`listVersionId`, `journeyVersionId`, `strategyVersionId`, `calendarId`) pertencentes ao mesmo `workspace_id`.
  4. Calcula `changes` comparando cada campo enviado contra o estado atual (com nomes resolvidos).
  5. Se `changes.length === 0` → retorna `200 { campaign, changed: false, changes: [] }` sem gravar `audit_log`.
  6. Se `changes.length > 0` → executa `UPDATE campaigns` + `audit(tx, actor, 'campaign.updated', 'campaign', id, { reason, before, after: { snapshot, changes } })` na mesma transação e retorna `200 { campaign, changed: true, changes }`.

### `GET /campaigns/:id/history`
- **Auth**: leitura autenticada no mesmo `workspace_id`.
- **Query**: `limit` (opcional, padrão `100`, máx `200`).
- **Response `200`**:
  ```json
  {
    "items": [
      {
        "id": "42",
        "action": "campaign.updated",
        "actorId": "...",
        "actorName": "Ricardo Silva",
        "actorEmail": "admin@voll.local",
        "reason": "Ampliação de horário até 20h",
        "at": "2026-11-15T21:40:12.345Z",
        "changes": [
          {
            "field": "calendarId",
            "label": "Calendário de funcionamento",
            "before": "Comercial Brasil",
            "after": "Horário Estendido (Cobrança)"
          }
        ]
      }
    ]
  }
  ```
