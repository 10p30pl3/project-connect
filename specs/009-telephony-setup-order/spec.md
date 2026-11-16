# Feature Specification: Ordem Guiada de Configuração de Telefonia (Tronco → Agente → Canal → Rotas → Ramal)

**Feature Branch**: `009-telephony-setup-order`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "revisa a melhor forma de configurar canais e rotas, pensando principalmente telefonia: qual configuracao primeiro, tronco, rota, ramal, agente, etC?"

## Análise: qual configuração vem primeiro?

A telefonia da plataforma é uma cadeia de dependências. Cada peça só funciona quando as peças das quais depende já existem:

| Ordem | Peça | Depende de | Para que serve | Quem configura |
|---|---|---|---|---|
| 1 | **Tronco SIP / Provedor** | — | Conectividade com a operadora (entrada e saída de chamadas PSTN) | Infraestrutura (Super Admin); o admin do workspace só visualiza o status |
| 2 | **Agente de Voz** | — (independente do tronco) | Quem atende/conduz a conversa: motor de IA, voz, prompt, limites | Admin do workspace |
| 3 | **Canal** (Voz / WebRTC) | Agente (como padrão, opcional) | Ponto de entrada/saída lógico do workspace, com agente padrão e BINA | Admin do workspace |
| 4 | **Rotas** (Entrada e Saída) | Canal + Agente (entrada); Tronco (saída) | Decidem *qual agente atende* (entrada: DID/origem → agente) e *por qual tronco sai* (saída: padrão de número → tronco) | Admin do workspace (modo Avançado) |
| 5 | **Ramal interno** | Agente (opcional) | Ponto SIP interno (softphone/teste) que alcança um agente pelo número do ramal | Admin do workspace |
| 6 | **Teste de chamada** | Todos os anteriores | Prova fim a fim que a cadeia funciona | Admin / Supervisor |

**Ordem recomendada**: Tronco → Agente de Voz → Canal → Rotas (Entrada e Saída) → Ramal → Teste. Tronco e Agente são independentes e podem ser feitos em qualquer ordem entre si, mas ambos precisam existir antes do Canal e das Rotas. O Ramal é opcional (uso interno/teste) e vem por último porque só adiciona um acesso interno ao agente já pronto.

**Problema atual**: as peças estão espalhadas em telas diferentes (Agentes de Voz, Canais, Telefonia com abas de Troncos, Rotas e Ramais) sem indicar a ordem nem o que falta. O usuário não sabe por onde começar, e é possível criar uma rota apontando para um tronco ou agente inexistente/inativo sem aviso.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saber o que configurar e em que ordem (Priority: P1)

Como administrador configurando a telefonia pela primeira vez (ou depois de um problema), quero ver uma lista ordenada das etapas (Tronco, Agente, Canal, Rotas, Ramal, Teste) com o status de cada uma (pendente, completa, com problema) e um atalho direto para a tela correspondente, para saber exatamente qual é o próximo passo.

**Why this priority**: Responde diretamente à dúvida "qual configuração primeiro" e é o que reduz erro de configuração; entrega valor mesmo sem nenhuma outra história.

**Independent Test**: Em um workspace sem nada configurado, abrir o guia e confirmar que a primeira etapa pendente é destacada como "próximo passo", que cada etapa tem um atalho funcional e que, ao concluir uma etapa, o status muda para completo sem recarregar manualmente.

**Acceptance Scenarios**:

1. **Given** um workspace sem tronco, agente ou canal, **When** o administrador abre o guia de configuração, **Then** as etapas aparecem na ordem recomendada, todas pendentes, com a primeira etapa pendente destacada como próximo passo.
2. **Given** o tronco e o agente já configurados e nenhum canal, **When** o guia é exibido, **Then** Tronco e Agente aparecem completos e Canal aparece como próximo passo.
3. **Given** uma etapa com problema (ex.: tronco offline, agente sem motor válido), **When** o guia é exibido, **Then** a etapa é marcada com problema e indica o motivo em tooltip.
4. **Given** o modo Básico, **When** o guia é exibido, **Then** só aparecem as etapas pertinentes ao modo (Agente, Canal e Teste), com tronco e rotas tratados automaticamente.

---

### User Story 2 - Impedir configurações incoerentes (Priority: P2)

Como administrador, quero ser avisado, sem ser impedido de salvar, quando tento criar algo cuja dependência ainda não existe — por exemplo, uma Rota de Saída sem tronco, uma Rota de Entrada apontando para agente removido, ou um Canal de voz sem agente padrão e sem rota — para não descobrir o erro só na primeira chamada que falha.

**Why this priority**: Evita chamadas perdidas por configuração incompleta; depende da noção de ordem da Story 1.

**Independent Test**: Tentar criar uma Rota de Saída em um workspace sem troncos ativos e confirmar o aviso/bloqueio com atalho para criar o tronco; tentar excluir um agente usado em uma rota e confirmar que o vínculo é informado.

**Acceptance Scenarios**:

1. **Given** nenhum tronco ativo, **When** o administrador abre "Nova Rota de Saída", **Then** vê o aviso de dependência com atalho para configurar o tronco.
2. **Given** um Canal de voz sem agente padrão e sem nenhuma Rota de Entrada ativa que o cubra, **When** o guia é exibido, **Then** o Canal aparece como "incompleto: nenhuma chamada será atendida" com atalho para definir o agente padrão ou criar uma rota.
3. **Given** uma Rota de Entrada apontando para um agente inativo ou removido, **When** o guia é exibido, **Then** a etapa Rotas aparece com problema identificando a rota.

---

### User Story 3 - Navegação das telas segue a ordem de configuração (Priority: P3)

Como administrador, quero que as abas e itens de menu relacionados à telefonia apareçam na mesma ordem lógica de configuração (Tronco, Agente, Canal, Rotas, Ramal, Gravações), para que a própria navegação ensine a sequência correta.

**Why this priority**: Reforça o guia com a organização da interface, mas as histórias 1 e 2 já entregam valor sem ela.

**Independent Test**: Em Modo Avançado, abrir Telefonia e confirmar que as abas seguem a ordem recomendada e que o guia (Story 1) está acessível a partir de Telefonia, Canais e Agentes de Voz.

**Acceptance Scenarios**:

1. **Given** Modo Avançado, **When** o administrador abre Telefonia, **Then** as abas de Troncos, Rotas e Ramais aparecem na ordem recomendada, com Gravações mantida ao lado.
2. **Given** qualquer tela de Canais, Agentes de Voz ou Telefonia, **When** há etapa pendente do guia, **Then** um indicador discreto leva ao guia sem poluir a tela.

---

### User Story 4 - Configurar o modelo novo da OpenAI Live API no Agente de Voz (Priority: P3)

Como administrador, quero escolher o motor **OpenAI Live API** no cadastro do Agente de Voz, selecionar o modelo Live disponível e ajustar os parâmetros específicos desse motor, para usar o modelo novo da OpenAI sem misturá-lo com as opções do motor Realtime.

**Why this priority**: É um assunto independente da ordem de configuração de telefonia, incluído neste planejamento por pedido do usuário. Complementa a etapa "Agente de Voz" do guia, mas pode ser entregue e testado isoladamente.

**Independent Test**: Editar um Agente de Voz, trocar o motor para OpenAI Live API, confirmar que a lista de modelos mostra apenas modelos Live e que os parâmetros específicos aparecem; salvar, reabrir e confirmar persistência; trocar para OpenAI Realtime e confirmar que a lista de modelos muda.

**Acceptance Scenarios**:

1. **Given** um agente editado com o motor OpenAI Live API, **When** o administrador abre a lista de modelos, **Then** vê somente modelos Live, sem modelos Realtime.
2. **Given** um agente com motor OpenAI Realtime, **When** o administrador troca para OpenAI Live API, **Then** o modelo e o detector de fala assumem os padrões do motor Live e os valores são preservados ao salvar.
3. **Given** um agente já salvo com motor OpenAI Live API, **When** é reaberto, **Then** motor, modelo e parâmetros aparecem exatamente como foram salvos.
4. **Given** o motor OpenAI Live API selecionado, **When** o administrador testa a voz do agente, **Then** a amostra reflete a voz escolhida.

---

### Edge Cases

- Workspace com tronco compartilhado configurado pela infraestrutura: etapa Tronco aparece completa mesmo que o administrador do workspace não possa editá-lo.
- Tronco existe, mas está offline ou sem canais livres: etapa com problema, não "pendente".
- Canal apenas WebRTC/Web Widget não depende de tronco: etapa Tronco não é exigida para esse fluxo.
- Agente padrão do Canal e Rota de Entrada divergentes: vale a precedência já existente (Rota > Canal > Workspace); o guia só avisa se nenhuma cobertura existir.
- Ramal criado sem agente vinculado: permitido (uso interno), guia não trata como erro.
- Usuário sem permissão de escrita: guia em modo leitura, mostrando status sem atalhos de criação.
- Isolamento entre workspaces: status e atalhos refletem somente recursos do workspace ativo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST apresentar um guia de configuração de telefonia com as etapas na ordem recomendada: Tronco, Agente de Voz, Canal, Rotas (Entrada e Saída), Ramal e Teste de chamada.
- **FR-002**: O sistema MUST calcular e exibir o status de cada etapa (pendente, completa, com problema) a partir dos recursos reais do workspace, atualizando-o após cada alteração.
- **FR-003**: O sistema MUST destacar a primeira etapa pendente ou com problema como "próximo passo" e oferecer atalho direto para a tela onde ela é resolvida.
- **FR-004**: O sistema MUST indicar, para cada etapa pendente ou com problema, o motivo e a dependência não atendida em tooltip `(?)` em pt-BR.
- **FR-005**: O sistema MUST detectar e sinalizar configurações incoerentes: Rota de Saída sem tronco ativo, Rota de Entrada apontando para agente inexistente/inativo, Canal de voz sem nenhuma cobertura de atendimento (sem agente padrão e sem rota aplicável).
- **FR-006**: O sistema MUST apenas avisar (sem bloquear o salvamento) quando uma dependência estiver ausente ao criar Rotas e Canais, oferecendo atalho para resolvê-la.
- **FR-007**: No Modo Básico, o sistema MUST exibir apenas as etapas pertinentes (Agente, Canal, Teste), tratando Tronco e Rotas automaticamente conforme a decisão anterior de roteamento automático no modo Básico.
- **FR-008**: O sistema MUST dispensar a etapa Tronco para fluxos exclusivamente WebRTC/Web Widget e considerar Ramal opcional.
- **FR-009**: O sistema MUST organizar as abas de Telefonia e os atalhos entre Agentes de Voz, Canais e Rotas segundo a ordem recomendada.
- **FR-010**: O sistema MUST respeitar permissões e isolamento por workspace: leitura para quem não pode editar e nenhum dado de outro workspace no guia.
- **FR-011**: Toda orientação conceitual do guia MUST estar em tooltips `(?)` em pt-BR, sem parágrafos explicativos inline (Constituição, Princípio IV).
- **FR-013**: O cadastro de Agente de Voz MUST permitir selecionar o motor OpenAI Live API, listando apenas os modelos Live disponíveis e mantendo a lista de modelos Realtime separada para o motor Realtime.
- **FR-014**: O sistema MUST persistir e reapresentar corretamente o motor, o modelo e os parâmetros específicos do motor OpenAI Live API, sem alterar agentes existentes que usam OpenAI Realtime ou ElevenLabs.
- **FR-012**: O guia MUST ser um painel de checklist fixo no topo de Telefonia, com indicador discreto nas telas de Canais e Agentes de Voz quando houver etapa pendente.

### Key Entities *(include if feature involves data)*

- **Etapa de Configuração**: uma das seis peças da cadeia (Tronco, Agente, Canal, Rotas, Ramal, Teste), com ordem, dependências, status e atalho de resolução.
- **Status da Etapa**: pendente, completa ou com problema, derivado dos recursos reais do workspace (não armazenado manualmente).
- **Dependência**: relação entre etapas (ex.: Rota de Saída depende de Tronco ativo; Rota de Entrada depende de Canal e Agente ativo).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um administrador novo identifica o próximo passo de configuração em até 10 segundos após abrir o guia, sem consultar documentação.
- **SC-002**: Um administrador consegue ir de um workspace sem configuração até a primeira chamada de teste bem-sucedida seguindo apenas o guia, sem pedir suporte, em pelo menos 90% das tentativas.
- **SC-003**: 100% das configurações incoerentes listadas em FR-005 são sinalizadas antes da primeira chamada real.
- **SC-004**: A quantidade de chamadas sem atendimento causadas por rota/canal/agente mal configurado cai em pelo menos 50% após a entrega.
- **SC-006**: Um administrador configura um agente com o modelo OpenAI Live API, salva e reabre com todos os valores preservados em 100% das tentativas.
- **SC-005**: 100% dos textos do guia seguem pt-BR e o Princípio IV (apenas tooltips para orientação).

## Assumptions

- A cadeia de dependências descrita na análise reflete o comportamento atual: Rota > Canal > Workspace para entrada, Rota de Saída → tronco para saída, e Ramal opcionalmente associado a um agente.
- O status das etapas é derivado dos recursos existentes (tronco, agente, canal, rotas, ramal, histórico de teste) e não exige novo cadastro manual.
- Os papéis, permissões e o isolamento multi-workspace existentes são mantidos.
- A decisão anterior vale: Modo Básico mantém roteamento automático; Modo Avançado expõe Rotas em Telefonia.
- A história 4 (OpenAI Live API) é outro assunto, incluída neste planejamento por pedido do usuário; já existe trabalho relacionado em `specs/008-openai-live-realtime-params`, que deve ser reaproveitado em vez de duplicado.
- A lista exata de modelos Live disponíveis deve ser confirmada na documentação oficial da OpenAI durante o planejamento.
- O "Teste de chamada" reutiliza a capacidade de ligação de teste já existente na plataforma.
