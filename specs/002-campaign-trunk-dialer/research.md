# Pesquisa e Decisões Técnicas: Envio de Campanha Limitado por Troncos de Saída

**Feature**: `002-campaign-trunk-dialer`  
**Date**: 2026-11-15  

## 1. Cálculo de capacidade disponível em troncos de saída (`FR-002`, `FR-003`, `FR-004`, `FR-006`)

- **Decision**: Calcular a disponibilidade combinando o estado em tempo real dos troncos no `apps/voice-gateway` (`TrunkManager`: `active`, status de registro `REGED`/`NOREG` conforme `register`, `direction !== 'inbound'`, `maxChannels` com fallback para `1` se não configurado, e `activeCalls` por tronco) com reservas pré-gateway recém-emitidas no PostgreSQL (`attempts` em `RESERVED` ou `SENT` ainda não refletidas no contador ativo do gateway) dentro de um pool compartilhado por workspace no ciclo do `worker`.
- **Rationale**:
  - `TrunkManager` já possui o mapa `activeCalls` e os métodos `tryAcquire`/`release`, mas atualmente os chama apenas em chamadas de entrada (`index.js`), não em `originateOutboundCall`. Instrumentar `originateOutboundCall` para adquirir e liberar o tronco de saída fecha o ciclo real de ocupação, contabilizando inclusive discagens manuais (`POST /v1/calls`) e múltiplas campanhas simultâneas.
  - Subtrair reservas locais pré-gateway (`RESERVED`/`SENT`) dentro do `tick()` evita que múltiplas execuções ou múltiplos `reserveEnrollment` no mesmo segundo excedam a cota antes de o FreeSWITCH estabelecer a chamada.
  - Aplicar o multiplicador da campanha (`dialMultiplier`, padrão `1.0`) sobre as vagas livres agregadas (`floor(vagasLivres * dialMultiplier)`) atende exatamente `FR-003` e `FR-004` mantendo `0` envios sempre que `vagasLivres === 0`.
- **Alternatives considered**:
  - *Contar apenas no banco (`attempts` em estado ativo)*: rejeitado porque discagens manuais diretas no gateway, quedas/desativações de tronco (`toggle`, queda SIP `DOWN`/`FAIL_WAIT`) e mudanças de `maxChannels` não são refletidas apenas na tabela `attempts`.
  - *Consultar FreeSWITCH ESL (`sofia xmlstatus`) a cada reserva individual*: rejeitado por latência e risco de sobrecarga; fazer um fetch consolidado por workspace a cada tick (2s) com cache curto de status de registro (`2–5s`) garante `< 5s` de reação (`SC-002`) sem bloquear o event loop.

## 2. Seleção de troncos na campanha e fallback automático (`FR-005`)

- **Decision**: Persistir `trunk_ids text[] NOT NULL DEFAULT '{}'` e `dial_multiplier numeric(4,2) NOT NULL DEFAULT 1.0` na tabela `campaigns`. Se `trunk_ids` estiver vazio (`[]`), o motor usa automaticamente todos os troncos visíveis ao workspace (via `workspace_voice_resources`) que estejam ativos, aptos para saída (`direction IN ('outbound','both')`) e operacionais. Se `trunk_ids` não estiver vazio, considera estritamente a interseção desses IDs com os troncos elegíveis/visíveis ao workspace.
- **Rationale**:
  - Reutiliza o isolamento multi-tenant existente em `apps/api/src/modules/telephony.ts` (`workspace_voice_resources`, `ensureOwnershipSynced`), impedindo que uma campanha acesse troncos privados de outro workspace.
  - Mantém compatibilidade retroativa com campanhas já criadas (que recebem `[]` e `1.0`, operando automaticamente em modo `1x` sobre os troncos livres).
- **Alternatives considered**:
  - *Armazenar apenas dentro de `strategy_versions.config`*: rejeitado porque estratégias são versionadas/compartilhadas entre campanhas e o requisito define claramente que a configuração de troncos e multiplicador pertence à campanha e pode ser ajustada pelo Gestor sem recriar estratégia.

## 3. Propagação e enforce de tronco até o Voice Gateway (`VoiceCallRequest`)

- **Decision**: Estender `VoiceCallRequestSchema` em `packages/shared` (`npm run contracts`) com o campo opcional `trunkIds?: string[]` (troncos permitidos pela campanha) e repassá-lo pelo `voiceAppAdapter`. No `apps/voice-gateway`, antes de originar a chamada em `POST /v1/calls` e dentro de `originateOutboundCall`, escolher o tronco livre elegível (respeitando `trunkIds` e `outboundRouteManager`), chamar `trunkManager.tryAcquire(selectedTrunkId)`, propagar o header SIP `X-Trunk-ID` para o FreeSWITCH (`freeswitch-pool.js`) e garantir `trunkManager.release(selectedTrunkId)` em qualquer término ou erro. Caso nenhum tronco elegível tenha vaga no momento da originação, responder `429 trunk_capacity_exceeded` para que `dispatchOne` trate como `TransientConnectorError` (sem perder o contato).
- **Rationale**:
  - Garante defesa em profundidade (Constituição Princípios I, II e VI): tanto o orquestrador de campanha quanto o gateway respeitam os mesmos troncos e limites simultâneos, e o contrato JSON Schema compartilhado (`voice-call-request.schema.json`) permanece a única fonte de verdade.
  - Em caso de contenção pontual (ex.: ligação manual ocupando o último canal milissegundos após o check do worker), a tentativa retorna `TransientConnectorError` e volta à fila respeitando backoff/revalidação sem perda de contato.
- **Alternatives considered**:
  - *Confiar apenas no dialplan XML estático do FreeSWITCH sem informar `trunkIds` ao gateway*: rejeitado porque impediria isolar uma campanha para usar apenas os troncos selecionados pelo Gestor quando há múltiplos troncos no servidor.

## 4. Governança estrita entre Gestor e Operador (`FR-012`, `SC-004`)

- **Decision**:
  - No backend (`apps/api`), exigir papel gerencial (`MANAGER`, `ADMIN`, `SUPER_ADMIN`, rejeitando explicitamente `OPERATOR`, `SUPERVISOR` e `ANALYST` com HTTP `403 Forbidden`) para criar ou atualizar `trunkIds` e `dialMultiplier` em campanhas (`POST /campaigns`, `PUT /campaigns/:id/dialer-config`, `PATCH /campaigns/:id`) e rascunhos, mantendo bloqueio total sobre rotas `/telephony/trunks*`. Caso um `OPERATOR` consiga submeter payload contendo `trunkIds` ou `dialMultiplier`, a API rejeita imediatamente com `403`.
  - No frontend (`apps/web`), exibir o seletor de troncos e o campo de multiplicador editáveis apenas quando o perfil autenticado tiver papel gerencial (`MANAGER`, `ADMIN`, `SUPER_ADMIN`); para `OPERATOR`, renderizar os parâmetros atuais exclusivamente como resumo em modo somente leitura, seguindo UI de alta densidade (Constituição Princípio IV: sem textos explicativos no corpo, orientações apenas em `tooltip="..."`).
- **Rationale**: Alinha integralmente com a decisão do usuário ("o operador não escolhe a quantidade de troncos, quem escolhe é o gestor") e com os papéis já definidos em `packages/shared` (`MANAGER = 'Gestor'`, `OPERATOR = 'Operador'`).
- **Alternatives considered**:
  - *Ocultar apenas na interface web*: rejeitado por violar segurança básica e Princípio V; validação obrigatória também no backend garante `SC-004` (100% das alterações bloqueadas para Operador).

## 5. Reposição contínua < 5s e observabilidade da fila (`US2`, `US3`, `SC-002`, `SC-004`)

- **Decision**:
  - Manter o ciclo do worker (`WORKER_TICK_MS=2000`) avaliando disponibilidade de troncos e preenchendo as novas vagas a cada 2s, complementado por um trigger não-bloqueante em memória quando o webhook de conector recebe evento terminal (`FINALIZED`/`RELEASED`) na API rodando no mesmo host (ou próximo tick <= 2s quando worker separado), assegurando latência de reposição abaixo de 5s (`SC-002`).
  - Expor `GET /campaigns/:id/dialer-status` retornando contadores em tempo real (`loadedTotal`, `activeDialing`, `queuedWaitingTrunk`, `eligibleTotal`, `ineligibleOrFinished`, `availableTrunkSlots`, `totalTrunkChannels`, `dialMultiplier`, `effectiveQuota`, `waitingReason`, `trunks[]`) consultado pelo frontend a cada 3s enquanto houver campanha `RUNNING` (`SC-004`).
- **Rationale**: Evita polling agressivo desnecessário quando parada e cumpre com folga a janela máxima de 5s na tela e no motor.
