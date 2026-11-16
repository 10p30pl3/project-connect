# Quickstart & Guia de Validação: Envio de Campanha Limitado por Troncos

**Feature**: `002-campaign-trunk-dialer`  
**Pré-requisitos**: PostgreSQL rodando (`voll_connect_test` e `voll_connect`), migrações aplicadas (`018_campaign_trunk_dialer.sql`), contratos gerados (`npm run contracts`).

## 1. Verificações Estáticas e Contratos

```bash
npm run contracts
npm run typecheck
npm run check:gateway
npm run build
```
**Esperado**: Zero erros de schema, tipos ou sintaxe; `packages/shared/contracts/voice-call-request.schema.json` atualizado com `trunkIds`.

## 2. Cenários de Validação Automatizada (`npm test` + `@voll/voice-gateway`)

1. **US1 — Lote limitado por troncos disponíveis (`FR-001`..`FR-004`)**:
   - Criar campanha `RUNNING` com mailing/lista de 20 contatos elegíveis e gateway mockado reportando 1 tronco ativo com `maxChannels = 3`, `activeCalls = 0` (`availableChannels = 3`), multiplicador `1x`.
   - Executar 1 ciclo do motor (`tick()`): verificar que exatamente `3` tentativas são reservadas/enviadas (`outbox`) e `17` inscrições permanecem `ACTIVE` na fila.
   - Repetir com `dialMultiplier = 2.0` (configurado por Gestor): verificar cota calculada de `6` reservas.

2. **US2 — Reposição contínua e pausa automática com 0 troncos (`FR-006`, `FR-007`)**:
   - Com 3 chamadas ocupando o tronco (`activeCalls = 3`, `availableChannels = 0`), rodar `tick()`: verificar `0` novas reservas e `17` contatos preservados na fila.
   - Simular término de 1 chamada (`activeCalls = 2`, `availableChannels = 1`) e rodar `tick()`: verificar que exatamente `1` novo contato é reservado/enviado mantendo a ocupação.
   - Testar contenção entre 2 campanhas no mesmo tick compartilhando o mesmo tronco de 3 vagas: soma das reservas entre Campanha A e Campanha B não ultrapassa `3`.

3. **US3 & Governança Gestor vs. Operador (`FR-005`, `FR-012`)**:
   - Autenticado como `OPERATOR`, tentar criar campanha especificando `trunkIds` / `dialMultiplier` diferentes do padrão ou chamar `PUT /api/campaigns/:id/dialer-config`: verificar HTTP `403 Forbidden`.
   - Autenticado como `MANAGER`, chamar `PUT /api/campaigns/:id/dialer-config` com `{ trunkIds: ["directcall"], dialMultiplier: 1.5 }`: verificar HTTP `200 OK`, registro em auditoria e reflexão imediata em `GET /api/campaigns/:id/dialer-status` (`canEditDialerConfig: true` para `MANAGER`, `false` para `OPERATOR`).

4. **Voice Gateway — Aquisição e liberação de tronco por chamada de saída**:
   - Executar `npm --prefix apps/voice-gateway test`: validar `TrunkManager.selectAvailableTrunk`, aquisição em `originateOutboundCall`, recusa `429 trunk_capacity_exceeded` quando lotado e liberação após encerramento.
