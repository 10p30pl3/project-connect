# Mapa Arquitetural e Matriz de Dependências — Voll Plan / Voll Connect SaaS

Documento canônico de governança arquitetural inspirado no padrão `saas monitor`, definindo limites de camadas, isolamento multi-tenant, segurança criptográfica, particionamento e contratos imutáveis entre API, Worker, Gateway de Voz e Frontend Web.

---

## Camada 0 — Núcleo Compartilhado e Configuração
- **`packages/shared/src/index.ts`**:
  - Fonte única da verdade para `ROLES` (`SUPER_ADMIN`, `SUPER_ADMIN_VIEWER`, `ADMIN`, `MANAGER`, `SUPERVISOR`, `OPERATOR`, `ANALYST`), `ROLE_LABEL`, `isSuperAdminRole` e `isReadOnlyRole`.
- **`apps/api/src/config/env-validator.ts`**:
  - Fail-fast com Zod (`validateEnv()`) na inicialização de `buildApp()`: valida `DATABASE_URL`, `JWT_SECRET` (mínimo 32 caracteres aleatórios em `production`) e `TOKEN_ENCRYPTION_KEY`.
- **`apps/api/src/db/pool.ts` & `apps/api/src/db/migrate.ts`**:
  - Pool PostgreSQL limitado (`DB_POOL_MAX`, `statement_timeout = 30000ms`), migrations sequenciais transacionais (`001`..`011`).

## Camada 1 — Segurança, Criptografia, Idempotência e Partições
- **`apps/api/src/lib/crypto.ts`**:
  - `encryptSecret` / `decryptSecret` (AES-256-GCM com IV aleatório de 96 bits + AuthTag), `safeTokenCompare` (SHA-256 + `crypto.timingSafeEqual`), `maskSecret` e `sha256Hex`.
  - Consumido por `modules/ai.ts`, `modules/telephony.ts` (BYOK OpenAI/ElevenLabs) e `auth/context.ts` / `modules/auth.ts` (`user_sessions.token_hash`).
- **`apps/api/src/lib/idempotency.ts`**:
  - `idempotencyGuard(routeKey)` + `registerIdempotencyHook(app)` persistindo em `api_idempotency_records` (TTL 24h, replay `X-Idempotent-Replay: true` e bloqueio `409 Conflict` em colisão de payload).
  - Aplicado em provisioning de empresas (`POST /api/auth/workspaces`), atualização tarifária (`PUT /api/billing/plans/:workspaceId`) e originação de chamadas (`POST /api/telephony/calls`).
- **`apps/api/src/db/partition-service.ts`**:
  - Gerencia particionamento mensal nativo por `RANGE (occurred_at)` da tabela `tenant_billing_ledger` (`ensureUpcomingPartitions` de `-1` a `+3` meses + `_default` de contingência) e expõe `getPartitionStats()`.

## Camada 2 — Autenticação, Multi-Tenancy e Regras SaaS
- **`apps/api/src/auth/context.ts`**:
  - `authenticate`: resolve `SessionUser` via JWT HttpOnly + `user_sessions` (expiração deslizante de 8h) ou modo laboratório (`AUTH_DISABLED=true` + `X-Demo-Role`).
  - Respeita `X-Workspace-Id`: valida associação `user_workspaces` para clientes ou livre navegação auditável para `SUPER_ADMIN` / `SUPER_ADMIN_VIEWER`.
  - **Bloqueio Global Somente-Leitura**: `enforceViewerReadOnly` bloqueia com HTTP `403` qualquer mutação (`POST`, `PUT`, `PATCH`, `DELETE`) para `SUPER_ADMIN_VIEWER`, exceto `/api/auth/login`, `/api/auth/logout` e `/api/auth/select-workspace`.
- **`apps/api/src/modules/auth.ts`**:
  - `/auth/me`, `/auth/workspaces`, `/auth/select-workspace` e `POST /auth/workspaces` (criação atômica de workspace + plano comercial `tenant_billing_plans` + tabulações padrão + `user_workspaces`).

## Camada 3 — Módulos de Domínio, Telefonia Híbrida e Billing
- **`apps/api/src/modules/telephony.ts`**:
  - Espelho multi-tenant do gateway `voice-app`: sincroniza posse em `workspace_voice_resources` (`agent`, `extension`, `route`, `outbound_route`, `trunk`).
  - **Troncos Híbridos**: troncos `GLOBAL_DEFAULT` (`is_global_default = true`) são visíveis a todos os workspaces em modo somente-leitura com credenciais mascaradas; empresas criam e operam livremente seus troncos `TENANT_BYOK` e chaves IA BYOK criptografadas.
  - **Sanitização Estrita**: clientes recebem `viewMode: 'CLIENT_TIME_ONLY'` sem campos `costUsd`, `costBrl`, `inputTokens`, `outputTokens` ou `totalTokens` em `/telephony/calls*`, `/telephony/ai-providers` e `/telephony/ai-costs*`.
- **`apps/api/src/modules/billing.ts`**:
  - Sincroniza chamadas (`TELEPHONY_PSTN`, `AMD_DSP`), engines STS (`AI_REALTIME`), assistente (`AI_LLM`) e consumíveis omnichannel (`WHATSAPP`, `SMS`, `EMAIL`) no ledger particionado `tenant_billing_ledger`.
  - **`GET /api/billing/summary`**:
    - `SUPER_ADMIN` / `SUPER_ADMIN_VIEWER` → `viewMode: 'SUPER_ADMIN_FULL'` (tarifas por tenant, custos em US$/R$, consumíveis, receita estimada e margem líquida).
    - Clientes (`ADMIN`, `MANAGER`, `SUPERVISOR`, `OPERATOR`, `ANALYST`) → `viewMode: 'CLIENT_TIME_ONLY'` (estritamente segundos/minutos consumidos, franquia contratada, saldo restante, tempo por agente e tempo por chamada).
  - **`PUT /api/billing/plans/:workspaceId`**: restrito a `SUPER_ADMIN` (`requireSuperAdmin`).
- **`voice-app/utils/api-router.js`**:
  - Cache em memória de `5s` para `GET /v1/recordings` invalidado em `call_end` e exclusões, com filtro multi-tenant `?tenantIds=...`.

## Frontend Web (`apps/web/src/`)
- **`vite.config.ts` / `main.tsx` / `router.tsx`**: `React.lazy` com reload automático anti-chunk-stale (`lazyNamed` + `vite:preloadError`), `version.json` no build e `manualChunks` (`react`, `vendor`, `radix`, `icons`).
- **`components/Layout.tsx`**: `WorkspaceSwitcher` (`X-Workspace-Id` + modal de nova empresa), `UserMenu` com todos os 7 papéis, banner de advertência `SUPER_ADMIN_VIEWER` e navegação `/consumo` dinâmica (`Billing & Consumo` vs `Consumo de Tempo`).
- **`pages/Billing.tsx` & `pages/telephony/*`**: UI estritamente alinhada ao contrato `SUPER_ADMIN_FULL` vs `CLIENT_TIME_ONLY` + `GLOBAL_DEFAULT` vs `TENANT_BYOK`.

## Matriz de Impacto (Efeito Dominó)
| Alteração | Arquivos Impactados | Verificação Exigida |
| --- | --- | --- |
| Novos perfis em `ROLES` | `packages/shared`, `auth/context.ts`, `web/src/lib/permissions.ts`, migration SQL `user_role` | `npm run typecheck && npm run test:arch` |
| Novo recurso no gateway de voz | `workspace_voice_resources` check constraint + `modules/telephony.ts` | Smoke test `/telephony/*` por dois workspaces |
| Alteração de esquema no billing | `migrations/011+`, `partition-service.ts`, `modules/billing.ts`, `pages/Billing.tsx` | `GET /api/billing/summary` como `SUPER_ADMIN` e `ADMIN` |
| Deploy Contabo em produção | `deploy/deploy.sh` (backup `pg_dump` rotação 3 cópias + migrate + `docker builder prune -af`) | `/api/health`, `/api/observability/partitions` |
