# Research: Ordem Guiada de Configuração de Telefonia

**Feature**: `009-telephony-setup-order` | **Date**: 2026-11-16

## 1. Ordem canônica das etapas

- **Decision**: Tronco → Agente de Voz → Canal → Rotas (Entrada e Saída) → Ramal → Teste de chamada. Tronco e Agente são independentes entre si; ambos precedem Canal e Rotas. Ramal é opcional.
- **Rationale**: Reflete as dependências reais já existentes no código: Rota de Saída referencia `trunkId`; Rota de Entrada referencia `tenantId` (agente) e opcionalmente `connectionId`; o Canal guarda o agente padrão (`config.tenantId`); o Ramal guarda o agente em `extension` do agente (campo `Ramal Interno`). A precedência de atendimento já é Rota > Canal > Workspace (feature 006).
- **Alternatives considered**: Canal antes do Agente (rejeitado: o canal precisa de agente para atender); Rotas antes do Canal (rejeitado: rota de entrada pode filtrar por canal).

## 2. Como calcular o status das etapas (sem persistir nada)

- **Decision**: Endpoint de leitura `GET /telephony/setup-status` que monta um *snapshot* do workspace (troncos, agentes, canais, rotas de entrada/saída, ramais, ligações recentes) e passa por uma função pura `computeSetupSteps(snapshot, { mode, isSuper })` que devolve as etapas com `status` (`pending | complete | problem`), `reason`, `nextAction` e `href`.
- **Rationale**: Estado derivado dos recursos reais nunca fica desatualizado e não exige migração nem escrita (sem impacto de idempotência, Princípio II). A função pura é testável sem PostgreSQL, que não existe no ambiente local de desenvolvimento.
- **Alternatives considered**: Tabela `setup_progress` com checkboxes manuais (rejeitada: diverge da realidade e exige manutenção).

### Regras de status

| Etapa | Completa quando | Problema quando | Pendente quando |
|---|---|---|---|
| Tronco | ≥1 tronco ativo e registrado/online (ou IP-auth) | tronco existe mas offline/sem canais livres | nenhum tronco |
| Agente | ≥1 agente com motor válido | agente sem motor/modelo válido | nenhum agente |
| Canal | ≥1 canal VOICE/WEBRTC ativo com cobertura de atendimento (agente padrão **ou** rota de entrada aplicável) | canal ativo sem nenhuma cobertura | nenhum canal de voz |
| Rotas | ≥1 rota de entrada válida **e** (rota de saída válida ou tronco padrão) | rota aponta para agente/tronco inexistente ou inativo | nenhuma rota (e Modo Avançado) |
| Ramal | ≥1 ramal (opcional) | — | nenhum ramal (nunca bloqueia o "próximo passo") |
| Teste | ≥1 ligação concluída recente no workspace | última tentativa falhou | nenhuma ligação |

- Canal exclusivamente WebRTC/Widget dispensa a etapa Tronco (FR-008).
- No Modo Básico só são calculadas Agente, Canal e Teste; Tronco e Rotas são marcadas `automatic` (não exibidas).

## 3. Quem vê o quê (Q1 = A)

- **Decision**: Tronco é gerenciado apenas por Super Admin. Para admin comum, a etapa mostra status e motivo, sem atalho de criação (`href` nulo, `readOnly: true`).
- **Rationale**: Mantém a regra atual de infraestrutura compartilhada e o isolamento entre workspaces (Princípio V).

## 4. Apresentação (Q2 = A) e avisos (Q3 = A)

- **Decision**: Componente `TelephonySetupGuide` (painel de checklist) fixo no topo de `Telefonia`; indicador discreto (badge `(n pendentes)` com link) em `Canais` e `Agentes de Voz`. Avisos de dependência aparecem como `Alert tone="warn"` nos formulários de rota/canal, **sem bloquear** o salvamento.
- **Rationale**: Atende FR-012/FR-006 com mínimo de interferência e respeita o Princípio IV (explicações só em tooltips `(?)`).
- **Alternatives considered**: Wizard modal (rejeitado em 2A); bloqueio (rejeitado em 3A).

## 5. Ordem das abas de Telefonia (US3)

- **Decision**: Modo Avançado: Troncos SIP & Provedores → Rotas → Ramais SIP → Gravações → Provedor IA & Custos → Motores DSP. Modo Básico: apenas Gravações.
- **Rationale**: A navegação reforça a sequência recomendada. Gravações permanece ao lado de Ramais, como o usuário pediu antes.

## 6. OpenAI Live API (US4 — outro assunto, incluído por pedido)

- **Decision**: Reaproveitar o trabalho já commitado em `specs/008-openai-live-realtime-params` (motor `openai_live`, parâmetros avançados por motor). Esta feature só acrescenta um **catálogo único de modelos por motor** (`OPENAI_ENGINE_MODELS`) em `packages/shared`, consumido pelo `TenantsTab`, para que o motor Live liste apenas modelos Live e o Realtime apenas modelos Realtime, com padrão por motor.
- **Rationale**: `openaiModel` já é `z.string()` e trafega até o gateway; não há necessidade de novo contrato de campos. O catálogo evita listas duplicadas hardcoded no componente.
- **Pendência de verificação**: os IDs `gpt-realtime-2.1-mini` (Realtime) e `gpt-live-1-mini` (Live) hoje usados na UI vieram de resumo de busca na web, não da documentação oficial. **Confirmar na documentação oficial da OpenAI antes de implementar** e, se divergirem, ajustar apenas o catálogo. Confirmar também que o gateway repassa o `openaiModel` do agente `openai_live` ao endpoint Realtime/Live sem trocar por `OPENAI_REALTIME_MODEL`.
- **Alternatives considered**: Duplicar parâmetros do 008 nesta feature (rejeitado: divergência); campo de texto livre para o modelo (rejeitado: erro de digitação).
