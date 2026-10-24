# @voll/api — API e motor do Voll Connect (MVP)

Fastify 5 + Zod + PostgreSQL 16 (SQL explícito via `pg`). Contrato HTTP em [`docs/API.md`](../../docs/API.md); tipos e schemas em `packages/shared`.

## Rodar

```bash
cp .env.example .env            # na raiz do monorepo
npm run db:up                   # Postgres via docker compose (ou use um local)
npm run db:migrate && npm run db:seed
npm run dev:api                 # http://localhost:3333/api
npm run dev:worker              # motor (reserva, envio, webhooks simulados, manutenção)
npm test -w @voll/api           # testes de invariantes contra voll_connect_test
```

Login do seed: `admin@voll.local` / `Voll@2026` (também `gestor@`, `supervisor@`, `operador@`, `analista@voll.local`, mesma senha).
Para ver o motor funcionando fora do horário comercial, use a estratégia **Demonstração 24x7** com a jornada **Discador** e o mailing **Carteira exemplo**.

## Arquitetura do motor (`src/engine`)

| Arquivo | Papel | Plano |
|---|---|---|
| `eligibility.ts` | `evaluateEnrollment` (função pura, única regra) + carga em lote dos contextos. Usada pela reserva **e** por `GET /campaigns/:id/eligibility` | §4.2 |
| `reserve.ts` | Transação por cliente: `contacts FOR UPDATE` → reavalia → tentativa `RESERVED` + capacidade `PROVISIONAL` + outbox. Índice único parcial `attempts_one_active_per_contact` é a última barreira | §4.2 (3–6), AC01 |
| `dispatch.ts` | Consome a outbox (`SKIP LOCKED`), revalida (pausa, DNC, destino, lease, suspensão) e chama o adaptador. Aceite → `SENT`, consumo `CONFIRMED` uma vez, fotografia da tarifa. Inconclusivo → reconciliação | §4.2 (7), §18.2 |
| `results.ts` | Webhook normalizado: inbox com dedupe `(conexão, eventId)`, transições, regra da **versão de estratégia da tentativa**, opt-out | §4.2 (8), §10.2 |
| `maintenance.ts` | Tick do worker: leases vencidas, prazo de feedback → reconciliação, agendadas, conclusão automática, entrega dos webhooks simulados por HTTP assinado | §4.3 |
| `materialize.ts` / `membership.ts` | Inscrições a partir de mailing, fotografia ou lista dinâmica (idempotente) | §7 |

Conectores (`src/connectors`): `adapter.ts` define o contrato (`ACCEPTED`/`REJECTED`/`INCONCLUSIVE`, erro transitório com backoff); `simulated.ts` é um provedor fictício que agenda webhooks reais (pesos por tabulação, duplicatas, ausência de retorno).

Todo estado vive no banco: o worker pode reiniciar ou rodar em mais de uma instância.

## Invariante → teste

| Regra | Teste (`test/`) |
|---|---|
| AC01/OP01 reservas concorrentes → uma só | engine: `AC01/OP01` |
| AC02 lease vencida não consome nem custa | engine: `AC02` |
| AC03/CT01 DNC após reserva cancela; DNC prevalece | engine: `AC03/CT01`, `AC03: bloqueio pela API` |
| AC04/OB03 webhook repetido sem efeito | engine: `AC04/OB03` |
| AC05/OP05 sem retorno → reconciliação | engine: `AC05/OP05` |
| AC06/OP02 pausada processa retornos, não envia | engine: `AC06/OP02` |
| AC07 teto diário compartilhado | engine: `AC07`; limite institucional §19 |
| AC08/AC24 vários eventos = um envio; tardio não reabre | engine: `AC08/AC24` |
| AC25 versão da estratégia preservada; versão imutável | engine: `AC25` |
| §6.2 alternância e esgotamento de destinos | engine: `§6.2` |
| CS01/CS02 tarifa fotografada; desconhecida ≠ 0 | engine: `CS01/CS02` |
| Opt-out encerra inscrições em todas as campanhas | engine: `opt-out` |
| AC12 destino duplicado | api: `contatos e destinos` |
| §26.5 importação parcial, zeros à esquerda, rejeitados | api: `importação` |
| HMAC inválido 401, perfil 403, 422 com `fieldErrors` | api: `autenticação`, `validação`, `webhook` |
| §27 rascunho (409), idempotência de criação, data passada | api: `assistente e campanhas` |
| Fluxo completo com webhooks reais e duplicatas | api: `ponta a ponta` |

## Limitações conhecidas do MVP

- Calendário com uma única faixa de horário para todos os dias selecionados (o seed não representa "sábado até 14h").
- Retorno agendado (callback), experimentos A/B, otimização e conciliação de faturas não fazem parte desta fatia.
- Lista dinâmica é reavaliada pelo worker a cada ~10 s sobre o mesmo mailing; não há anexação de registros a um mailing existente (cada importação cria um mailing).
- Conector real ainda não existe; o contrato `ConnectorAdapter` está pronto para recebê-lo.
- Sessão por cookie JWT sem refresh/revogação; workspace único por organização.
