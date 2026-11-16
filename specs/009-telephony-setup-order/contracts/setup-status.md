# Contrato: Status da Configuração de Telefonia

**Feature**: `009-telephony-setup-order` | **Schemas**: `packages/shared/src/index.ts`

## `GET /api/telephony/setup-status`

- **Auth**: usuário autenticado; escopo sempre do workspace ativo (`actor(req).workspaceId`). Somente leitura.
- **Query**: `mode?: 'basic' | 'advanced'` (se ausente, `advanced`).
- **200**: `TelephonySetupStatus` (ver `data-model.md`).
- **Fail-open**: se o gateway de voz não responder, a API responde `200` com `partial: true`; etapas que dependem do gateway (Tronco, Teste) vêm como `problem` com `reason: 'Gateway de voz indisponível'`, nunca `5xx`.
- **Isolamento**: troncos compartilhados aparecem só como contagem/status, sem credenciais; nenhum recurso de outro workspace entra no cálculo.

### Exemplo (Modo Avançado, workspace novo)

```json
{
  "mode": "advanced",
  "steps": [
    { "id": "trunk", "order": 1, "label": "Tronco SIP", "status": "pending", "optional": false, "readOnly": true, "reason": "Nenhum tronco ativo. Peça ao administrador da plataforma.", "href": null, "count": 0 },
    { "id": "agent", "order": 2, "label": "Agente de Voz", "status": "pending", "optional": false, "readOnly": false, "reason": "Nenhum agente criado.", "href": "/agentes-de-voz", "count": 0 }
  ],
  "nextStepId": "trunk",
  "pendingCount": 5,
  "warnings": [],
  "partial": false
}
```

## Avisos nos formulários (sem endpoint novo)

Os formulários de Rota de Entrada, Rota de Saída e Canal consomem `warnings` do mesmo endpoint e exibem `Alert tone="warn"` com atalho. **Não bloqueiam** o salvamento (Q3 = A).

## Catálogo de modelos (US4)

Sem endpoint: `OPENAI_ENGINE_MODELS` e `defaultOpenAiModel(engine)` exportados por `@voll/shared` e usados pelo `TenantsTab`. `VoiceAgentTenantSchema.openaiModel` permanece `z.string()` (aceita valores legados).

## Contrato de UI

- `TelephonySetupGuide`: lista ordenada, status por ícone/cor, etapa `nextStepId` destacada, `(?)` com `reason`, link `href` quando não `readOnly`.
- `SetupIndicator`: badge discreto com `pendingCount` e link para `/telefonia`, exibido em Canais e Agentes de Voz apenas quando `pendingCount > 0`.
- Todo texto em pt-BR; explicações apenas em tooltips (Princípio IV).
