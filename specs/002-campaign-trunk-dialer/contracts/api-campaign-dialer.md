# Contrato de API: Campanha & Capacidade por Troncos (`apps/api`)

**Shared Package**: `@voll/shared` (`packages/shared/src/index.ts`)

## 1. Schemas Compartilhados (`@voll/shared`)

### `CampaignDialerConfigSchema`
```ts
export const CampaignDialerConfigSchema = z.object({
  trunkIds: z.array(z.string().min(1)).max(50).default([]),
  dialMultiplier: z.number().min(0.5).max(5).default(1),
});
```

### Extensão de `CreateCampaignSchema`
- `trunkIds?: string[]` (opcional, padrão `[]`)
- `dialMultiplier?: number` (opcional, padrão `1`)
- **Regra de autorização (`FR-012`)**: se `trunkIds` (não vazio) ou `dialMultiplier` (`!== 1`) forem enviados por perfil não gerencial (`!['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role)`), responder `403 Forbidden` com `{ error: 'forbidden_dialer_config', message: 'Apenas Gestores podem definir troncos ou multiplicador da campanha.' }`.

---

## 2. Endpoints HTTP

### `PUT /api/campaigns/:id/dialer-config`
Atualiza a seleção de troncos elegíveis e/ou o multiplicador de discagem de uma campanha.

- **Auth & Roles**: Somente `MANAGER`, `ADMIN`, `SUPER_ADMIN` (`OPERATOR`, `SUPERVISOR`, `ANALYST` recebem `403 Forbidden`).
- **Request Body**: `CampaignDialerConfigSchema`
- **Validações**:
  - Cada `trunkId` em `trunkIds` deve existir dentre os troncos visíveis ao `workspaceId` (via `workspace_voice_resources`). Caso contrário: `422 Unprocessable Entity`.
- **Auditoria**: Grava evento `campaign.dialer_config` em `audit_logs` (`before` / `after`).
- **Response `200 OK`**:
  ```json
  {
    "campaignId": "uuid",
    "trunkIds": ["directcall"],
    "dialMultiplier": 1.0
  }
  ```

### `GET /api/campaigns/:id/dialer-status`
Retorna o estado instantâneo da fila de contatos carregados, chamadas em discagem e vagas nos troncos disponíveis para a campanha (`SC-004`).

- **Auth & Roles**: Todos os papéis autenticados com acesso ao workspace (`MANAGER`, `SUPERVISOR`, `OPERATOR`, `ANALYST`, `ADMIN`, `SUPER_ADMIN`).
- **Response `200 OK`**:
  ```json
  {
    "campaignId": "uuid",
    "trunkIds": [],
    "dialMultiplier": 1.0,
    "loadedTotal": 500,
    "activeDialing": 4,
    "queuedWaitingTrunk": 496,
    "completedOrSkipped": 0,
    "availableTrunkSlots": 4,
    "totalTrunkChannels": 30,
    "effectiveQuota": 4,
    "waitingReason": "NONE",
    "canEditDialerConfig": true,
    "trunks": [
      {
        "id": "directcall",
        "name": "DirectCall",
        "direction": "both",
        "active": true,
        "online": true,
        "maxChannels": 30,
        "activeCalls": 26,
        "availableChannels": 4,
        "statusMessage": "REGED / UP"
      }
    ]
  }
  ```

### `GET /api/telephony/trunks/availability`
Retorna os troncos de saída visíveis para o workspace com cálculo de canais disponíveis em tempo real.

- **Auth & Roles**: Usuários autenticados do workspace (`canEditDialerConfig` sinalizado conforme papel para a UI).
- **Response `200 OK`**:
  ```json
  {
    "trunks": [ /* TrunkAvailability[] */ ],
    "totalChannels": 30,
    "activeCalls": 2,
    "availableChannels": 28,
    "gatewayOnline": true
  }
  ```
