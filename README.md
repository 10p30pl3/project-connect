# Voll Connect — MVP

Gestão de listas e acionamentos para discador, WhatsApp, SMS e e-mail. Esta é a **fatia vertical P0** do [Plano funcional v2.2](docs/): importar mailing → público (todos ou lista filtrada) → jornada e estratégia → campanha → motor de execução com conector simulado → operação, elegibilidade, tentativas e indicadores.

## Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React 19 + TypeScript + Vite, TanStack Query/Table, React Hook Form + Zod, Radix UI, Tailwind 4 |
| API | Fastify 5 + TypeScript, Zod, `pg` com SQL explícito |
| Motor | Worker Node (mesmo código da API) com outbox, `FOR UPDATE SKIP LOCKED` e webhooks idempotentes |
| Banco | PostgreSQL 16 |
| Contratos | `packages/shared` (enums, rótulos pt-BR e schemas Zod usados pelos dois lados) e [`docs/API.md`](docs/API.md) |

## Como rodar

Requisitos: Node 20+ e Docker (ou um PostgreSQL 16 local).

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres via docker compose (cria voll_connect e voll_connect_test)
npm run db:migrate
npm run db:seed      # organização, usuários, tabulações, conexões simuladas, jornadas, estratégias e mailing de exemplo
npm run dev          # API :3333 + worker + web :5173
```

Acesse http://localhost:5173. **Não há tela de login**: com `AUTH_DISABLED=true` (padrão do `.env.example`) o app abre direto como Administrador, e o menu do usuário permite **ver como** Gestor, Supervisor, Operador ou Analista. Para reativar o login, defina `AUTH_DISABLED=false` (usuários do seed: `admin@`, `gestor@`, `supervisor@`, `operador@`, `analista@voll.local`, senha `Voll@2026`). Em `NODE_ENV=production` o login é sempre exigido.

Para ver o motor funcionando fora do horário comercial, crie uma campanha com a estratégia **Demonstração 24x7**.

## Testes

```bash
npm test             # 30 testes de API/motor contra Postgres real (voll_connect_test)
npm run typecheck
npm run build
npm run test:e2e     # Playwright; requer API, worker e web rodando (npm run dev)
```

Os testes do motor cobrem os critérios de aceite do plano (AC01–AC08, AC12, AC24, AC25, OP01, CT01, CS01/CS02, OB03, §26.5). O mapa critério → teste está em [`apps/api/README.md`](apps/api/README.md).

## Estrutura

```
apps/api       API Fastify, worker do motor, migrações SQL, seed e testes
apps/web       SPA React (assistente Preparar campanha, operação, contatos, catálogo, controle central)
packages/shared contratos compartilhados
docs/API.md    contrato HTTP entre front e back
```

## Fora desta entrega

Retorno agendado, Central de decisão (A/B, otimização, conciliação de faturas), observabilidade avançada, visualizações salvas, conectores reais (o contrato `connectors/adapter.ts` está pronto para plugá-los), prompt de regras em linguagem natural nas listas e calendário com faixas por dia.
