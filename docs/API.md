# API do MVP — contrato entre `apps/api` e `apps/web`

Base: `http://localhost:3333/api`. JSON em UTF-8. Autenticação por cookie httpOnly `vc_session` (JWT) emitido em `/auth/login`; o front usa `credentials: 'include'`. Em dev o Vite faz proxy de `/api` → `:3333`, então tudo é mesma origem.

Erros: `application/problem+json` no formato `ApiProblem` (`packages/shared`). `422` traz `fieldErrors` (`"limits.daily": "mensagem"`), `409` conflito (revisão de rascunho, versão), `401` sem sessão, `403` perfil sem permissão.

Tipos de entrada: os schemas Zod em `packages/shared/src/index.ts` (o nome do schema está ao lado de cada rota). Datas: ISO 8601 UTC. Valores desconhecidos vêm como `null` — nunca convertidos em 0.

Perfis (§17.1): `ADMIN` tudo; `MANAGER` mailings, listas, jornadas, estratégias, campanhas; `SUPERVISOR` operar campanhas (pausar/retomar), reconciliar, bloquear; `OPERATOR` consultar e registrar resultado; `ANALYST` leitura e indicadores. Leitura é liberada a todos os perfis autenticados.

## Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | /auth/login | `LoginSchema` | `{ user: Me }` + cookie |
| POST | /auth/logout | — | 204 |
| GET | /auth/me | — | `Me = { id, email, name, role, organization:{id,name}, workspace:{id,name,timezone} }` |
| GET | /users | — | `{ items: User[] }` (ADMIN) |
| POST | /users | `CreateUserSchema` | `User` (ADMIN) |

## Visão geral
| GET | /overview | — | `{ campaigns:{running,paused,ready,scheduled,completed}, attempts:{active,reconciliation,sentToday}, contacts:number, mailings:number, globalSuspension:boolean }` |

## Mailings e importação (§16.1, §26.5, §27.2)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | /mailings | — | `{ items: { id,name,createdAt,recordCount,lastVersion:{version,validRows,rejectedRows,createdAt} }[] }` |
| GET | /mailings/:id | — | `{ id,name,createdAt,recordCount,versions:[{id,version,totalRows,validRows,rejectedRows,createdAt}], columns: string[] }` |
| GET | /mailings/:id/records?cursor&limit&q | — | `Paginated<{ id,rowNumber,contactId,externalId,name,fields:Record<string,unknown>,blocked:boolean }>` |
| GET | /mailings/:id/versions/:versionId/rejected.csv | — | CSV (linha, valores, motivos) |
| POST | /imports/preview | `ImportPreviewSchema` | `ImportPreview` (abaixo) |
| POST | /imports | `ImportCommitSchema` | `{ mailingId, versionId, validRows, rejectedRows }`; 422 se houver rejeitados e `acceptPartial=false`, ou zero válidos |

`ImportPreview = { delimiter, headers: string[], totalRows, suggestedMapping: ColumnMapping[], rows: { rowNumber, values: Record<string,string>, errors: string[] }[] (até 200), validRows, rejectedRows, schemaErrors: string[] }`

Regras: identificador externo obrigatório e texto (zeros preservados); telefones 10–15 dígitos (normaliza removendo não dígitos; não aceita notação científica); até 5 telefones, 3 digitais (WhatsApp/SMS), 1 e-mail; número repetido no mesmo canal para o mesmo contato é erro; mesmo número em telefonia e digital é permitido. Máx. 2 MB / 2.000 linhas no MVP. Reimportação do mesmo `external_id` reutiliza o contato e não apaga destinos/histórico.

## Listas (§7, §16.2)
| GET | /lists | — | `{ items: { id,name,mailing:{id,name},latestVersion:{id,version,membershipMode,memberCount,publishedAt} }[] }` |
| GET | /lists/:id | — | lista + `versions[]` com `filters`, `sort` |
| POST | /lists/preview | `ListPreviewSchema` | `{ selected:number, excluded:{ reason:ReasonCode,count }[], sample:{contactId,externalId,name,fields}[] (até 50), fields:{key,type}[] }` — já aplica validação e DNC |
| POST | /lists | `ListPublishSchema` | `{ listId, listVersionId, version, memberCount }` (nova lista ou nova versão se `listId`) |
| GET | /lists/versions/:versionId/members?cursor | — | `Paginated<{contactId,externalId,name,fields}>` |

## Catálogo
| GET | /tabulations | — | `{ items: { id,code,name,isCpc,isConversion,isOptOut,invalidatesDestination,channelTypes }[] }` |
| GET | /connections | — | `{ items: { id,name,channelType,provider,tariff:number|null,tariffUpdatedAt,active,simulation }[] }` |
| PATCH | /connections/:id | `ConnectionUpdateSchema` | conexão (ADMIN) |
| GET | /journeys | — | `{ items: { id,name,latestVersion:{id,version,steps:JourneyStep[] & {connectionName}} }[] }` |
| POST | /journeys | `JourneyCreateSchema` | jornada (MANAGER) |
| GET | /strategies | — | `{ items: { id,name,protected,latestVersion:{id,version,config,publishedAt} }[] }` |
| GET | /strategies/:id | — | estratégia + `versions[]` |
| POST | /strategies | `StrategyCreateSchema` | estratégia v1 (MANAGER) |
| POST | /strategies/:id/versions | `StrategyPublishSchema` | nova versão; 403 se `protected` (§25: exige cópia) |

## Assistente Preparar campanha (§27)
| GET | /campaign-draft | — | `{ data: CampaignDraft, revision, updatedAt } | null` |
| PUT | /campaign-draft | `SaveDraftSchema` | `{ revision, updatedAt }`; 409 se `revision` desatualizada |
| DELETE | /campaign-draft | — | 204 |
| POST | /campaigns/preflight | `CreateCampaignSchema` (parcial ok) | `{ audience:{type:'MAILING'|'LIST',name,count}, journey:{name,steps}, strategy:{name,version,summary}, nextWindow: string|null, costEstimate:{ value:number|null, premise:string }, warnings: string[] }` |
| POST | /campaigns | `CreateCampaignSchema`, header `Idempotency-Key` | `Campaign`; mesma chave → mesma campanha; remove o rascunho |

## Campanhas (§4, §8, §26.6)
| GET | /campaigns?status | — | `{ items: CampaignSummary[] }` |
| GET | /campaigns/:id | — | `CampaignDetail` |
| POST | /campaigns/:id/start | — | inicia (READY/SCHEDULED) |
| POST | /campaigns/:id/pause | — | pausa (impede novas reservas e envios; continua recebendo retornos) |
| POST | /campaigns/:id/resume | — | retoma |
| POST | /campaigns/:id/close | `{ reason }` | encerra; cancela reservas não enviadas |
| GET | /campaigns/:id/attempts?state&cursor&limit | — | `Paginated<AttemptRow>` |
| GET | /campaigns/:id/eligibility?reason&cursor | — | `{ evaluatedAt, cards:{members,eligibleNow,reserved,pending,reconciliation,finished}, reasons:{reason,count}[], items: EligibilityRow[], nextCursor }` |
| GET | /campaigns/:id/indicators | — | `Indicators` |
| GET | /campaigns/:id/indicators.csv | — | CSV (sanitizado contra fórmulas) |

```
CampaignSummary = { id,name,status,statusLabel,operationalState,operationalExplanation, audience:{type,name}, journeyName, strategyName, strategyVersion, createdAt, startedAt, progress:{members,finished,active} }
CampaignDetail = CampaignSummary & { description, mailing:{id,name}, listVersion:{id,version,membershipMode}|null, journey:{id,version,steps}, strategy:{id,version,config}, scheduledAt }
AttemptRow = { id, contact:{id,externalId,name}, channelType, connectionName, destinationMasked, stage, state, stateLabel, tabulation:{code,name}|null, createdAt, sentAt, finalizedAt, nextAction }
EligibilityRow = { enrollmentId, contact:{id,externalId,name}, enrollmentState, stage, channelType, destinationMasked|null, eligible:boolean, primaryReason:ReasonCode|null, reasons:ReasonCode[], counters:{ total:number|null, today:number, totalLimit, dailyLimit }, nextEligibleAt, strategyVersion }
Indicators = { sent, contactsWorked, cpcContacts, cpcRate:number|null, conversions, cost:{ known:number, coverage:{withCost,total}, partial:boolean }, costPerCpc:number|null, costPerConversion:number|null, pending:{reserved,sent,awaitingFeedback,reconciliation}, byChannel:{channelType,sent,cpc,conversions}[], byTabulation:{code,name,count}[] }
```
`operationalState` ∈ `WAITING_RELEASE` (suspensão global), `WAITING_WINDOW` (fora do calendário), `WAITING_RETURNS`, `PROCESSING`, `BASE_PROCESSED`, `IDLE`; `operationalExplanation` é o texto pronto (§26.6).

## Tentativas e operação (§18, §23, §26.7)
| GET | /attempts/:id | — | `{ attempt: AttemptRow & { traceId, strategyVersionId, journeyVersionId, tariffSnapshot, costConfirmed, leaseUntil, feedbackDeadline, providerAttemptId }, explanation:{ whatHappened, why, nextAction }, timeline: { id, eventType, label, fromState, toState, reasonCode, duplicate, occurredAt, receivedAt, data }[] }` |
| POST | /attempts/:id/reconcile | `ResolveReconciliationSchema` | resolve reconciliação (SUPERVISOR) |
| GET | /operation/attempts?state&campaignId&q&cursor | — | `Paginated<AttemptRow & {campaign:{id,name}}>` (todas as campanhas) |

## Contatos (§3 T01/T02, §16.1)
| GET | /contacts?q&cursor&limit | — | `Paginated<{ id,externalId,name,blocked,destinations:{channelType,count}[], attempts:{total:number|null,new:number}, lastTabulation:{code,name,at}|null, campaigns:number }>` |
| GET | /contacts/:id | — | `{ contact:{id,externalId,name,attributes,historyTotal,historyReferenceDate}, destinations:{id,channelType,addressMasked,address,label,priority,valid,blocked}[], blocks:{id,scope,destinationId,reason,origin,createdAt,revokedAt}[], counters:{ historyTotal:number|null, newTotal, today, byChannel:{channelType,count}[] }, enrollments:{campaign:{id,name},state,stage}[], attempts: AttemptRow[] (20 últimas) }` |
| POST | /contacts/:id/destinations | `DestinationCreateSchema` | destino; 409 se duplicado no canal |
| PATCH | /contacts/:id/destinations/:destId | `{ valid?:boolean, priority?:number }` | destino |

## Controle central (§19)
| GET | /control | — | `{ dailyLimit, totalLimit, globalSuspension }` |
| PUT | /control | `InstitutionalLimitsSchema` | idem (ADMIN), auditado |
| POST | /blocks | `BlockCreateSchema` | bloqueio (SUPERVISOR+); cancela reservas não enviadas do contato/destino |
| POST | /blocks/:id/revoke | `BlockRevokeSchema` | (ADMIN) |
| GET | /audit?cursor | — | `Paginated<{ id,at,user:{name},action,entity,entityId,reason,before,after }>` |

## Conector (público, sem cookie)
| POST | /connectors/:connectionId/events | `ConnectorEventSchema` + header `X-Voll-Signature: sha256=<hmac(body, webhook_secret)>` | `{ accepted:true, duplicate:boolean }` |

## Simulador (somente ambiente de desenvolvimento)
| POST | /sim/attempts/:id/repeat-last-event | — | reenvia o último webhook (demonstra idempotência) |
| POST | /sim/attempts/:id/result | `{ tabulationCode }` | força um resultado para a tentativa enviada |
