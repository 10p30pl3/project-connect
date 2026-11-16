# Feature Specification: Assistente de Campanha Simplificado no Modo Básico e Layout Reorganizado

**Feature Branch**: `003-basic-campaign-wizard-layout`  
**Created**: 2026-11-15  
**Status**: Draft  
**Input**: User description: "modo basico: nao tem filtro , acionamento: agente, canal simples, calendario. resumo: nome, descricao e agendamento. item avancado pode ter todos, organizar melhor o layout"

## Clarifications

### Session 2026-11-15

- Q: When selecting the **Agente** in the Acionamento step, should the user be able to pick any active Voice/AI agent in the workspace specifically for that campaign, or does it only show the agent linked to the selected channel connection? → A: Opção A — **Escolha por campanha**: listar todos os agentes ativos do workspace e aplicar o agente selecionado especificamente nas chamadas daquela campanha, pré-selecionando automaticamente o agente padrão do canal quando existir.
- Q: Which options should be displayed in the **Canal simples** selector during Basic mode campaign creation? → A: Os canais ativos configurados em **Configuração → Canais**; além disso, a tela/opção **Configuração → Canais** também deve estar visível e acessível no **Modo Básico**.
- Q: Which visual layout organization should be used for the wizard steps (**Acionamento** and **Resumo**)? → A: Opção B adaptada — **Coluna principal empilhada à esquerda com uma segunda coluna à direita detalhando a opção escolhida**, substituindo parágrafos longos por dicas contextuais (`?`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criação Rápida de Campanha no Modo Básico em 3 Etapas (Priority: P1)

Um usuário utilizando a plataforma no **Modo Básico** inicia o assistente de criação de campanha ("Nova campanha") para colocar uma operação no ar rapidamente sem lidar com segmentações complexas ou parâmetros técnicos avançados. Ele seleciona ou importa o Mailing (etapa 1), escolhe diretamente o **Agente**, um **Canal simples** e o **Calendário** na etapa de **Acionamento** (etapa 2 — pulando inteiramente a etapa de filtro/público), e finaliza na etapa de **Resumo** preenchendo apenas **Nome**, **Descrição** e **Agendamento** (etapa 3).

**Why this priority**: É o fluxo central pedido pelo usuário — elimina fricção na operação diária do Modo Básico, removendo a etapa de filtros que hoje confunde e alonga a criação de campanhas simples.

**Independent Test**: Com o Modo Básico ativo no sistema, um usuário autorizado abre "Nova campanha", seleciona um mailing com contatos válidos e avança diretamente para "Acionamento" (sem visualizar a etapa de filtro), escolhe agente, canal simples e calendário, e vê no "Resumo" somente nome, descrição e agendamento antes de criar a campanha com sucesso.

**Acceptance Scenarios**:

1. **Given** que a experiência do usuário está configurada no **Modo Básico**, **When** ele acessa a tela "Nova campanha", **Then** a barra de progresso exibe apenas 3 etapas (**Mailing**, **Acionamento** e **Resumo**), omitindo a etapa **Público (filtro)**.
2. **Given** que o usuário selecionou ou importou um Mailing no **Modo Básico**, **When** ele clica para avançar, **Then** o sistema considera automaticamente 100% dos contatos elegíveis da base selecionada (sem exigir criação de lista nem aplicação de filtros) e leva o usuário diretamente para a etapa **Acionamento**.
3. **Given** que o usuário está na etapa **Acionamento** no **Modo Básico**, **When** a tela é exibida, **Then** são apresentados exclusivamente os blocos de seleção de **Agente**, **Canal simples** (jornada de canal único, sem abas ou opções multicanal) e **Calendário de funcionamento**, sem expor blocos de estratégia avançada ou regras detalhadas de retentativa manual.
4. **Given** que o usuário está na etapa **Resumo** (Revisar e finalizar) no **Modo Básico**, **When** a tela é exibida, **Then** são exibidos exclusivamente os campos de **Nome da campanha**, **Descrição (opcional)** e **Agendamento** (início imediato ou data/hora futura) junto às ações de rascunho/criação, usando automaticamente os padrões operacionais definidos para o workspace nos bastidores.
5. **Given** que o usuário preencheu nome, selecionou agente, canal simples e calendário no **Modo Básico**, **When** ele cria a campanha, **Then** a campanha é persistida com 100% da base elegível do mailing selecionado, regras operacionais padrão compatíveis e calendário escolhido, ficando pronta ou em execução conforme o agendamento selecionado.

---

### User Story 2 - Preservação Completa de Itens no Modo Avançado e Reorganização Visual do Layout (Priority: P2)

Um Gestor ou operador especialista utilizando o **Modo Avançado** precisa ter acesso a **todos** os controles completos do assistente (Mailing, Público com filtros e modo fotografia/dinâmica, Acionamento completo com jornadas simples/multicanal, estratégias simples/completas, agente, calendário, além de resumo detalhado com pilares, diagnóstico de voz/troncos, seleção de troncos/multiplicador e salvamento como modelo), porém com um layout melhor organizado visualmente — seções alinhadas em grade clara, hierarquia visual consistente, menos textos explicativos longos na superfície da tela (migrados para dicas contextuais em tooltip) e menor necessidade de rolagem vertical excessiva.

**Why this priority**: Garante que o poder operacional completo continue disponível para quem precisa no Modo Avançado enquanto corrige problemas de organização e densidade visual tanto no Básico quanto no Avançado.

**Independent Test**: No Modo Avançado, um usuário verifica a presença das 4 etapas completas (incluindo Filtro/Ordenação, Jornadas Multicanal, Estratégia Completa, Diagnóstico e Troncos/Multiplicador para Gestor) dispostas em cartões alinhados com dicas em tooltip e cabeçalhos enxutos, sem sobreposição ou blocos desalinhados.

**Acceptance Scenarios**:

1. **Given** que o usuário está no **Modo Avançado**, **When** ele percorre o assistente "Nova campanha", **Then** todas as 4 etapas (**Mailing**, **Público (filtro)**, **Acionamento**, **Revisar e finalizar**) e todos os itens avançados ficam visíveis e funcionais.
2. **Given** qualquer uma das etapas principais do assistente (em Modo Básico ou Avançado), **When** o usuário seleciona ou foca um bloco/opção (como agente, canal, calendário, estratégia ou agendamento), **Then** a coluna principal à esquerda mantém os blocos empilhados de forma limpa e a segunda coluna à direita exibe o detalhamento vivo da opção escolhida, com explicações conceituais acessíveis sob demanda em dicas contextuais (`?`) sem parágrafos longos ocupando a área de seleção.
3. **Given** que um Gestor está na etapa final no **Modo Avançado**, **When** revisa a campanha, **Then** os controles avançados (resumo dos pilares, verificação de prontidão de voz, configuração de troncos de saída/multiplicador e opção de salvar como modelo) permanecem acessíveis em seções claramente delimitadas.

---

### User Story 3 - Alternância Segura de Modo Durante a Criação e Consistência de Rascunho (Priority: P3)

Um usuário que alterna o seletor global entre **Modo Básico** e **Modo Avançado** enquanto está no meio de um rascunho em "Nova campanha" não perde os dados já preenchidos e nunca fica preso em uma etapa inexistente no modo escolhido.

**Why this priority**: Evita perda de trabalho ou telas vazias caso o usuário mude de modo para consultar ou ajustar um item avançado e volte para concluir a campanha.

**Independent Test**: Ao iniciar no Modo Avançado na etapa "Público (filtro)" com mailing já escolhido e alternar para o Modo Básico, o assistente redireciona automaticamente para uma etapa válida do Modo Básico ("Acionamento" ou "Mailing") preservando o mailing e demais dados informados no rascunho.

**Acceptance Scenarios**:

1. **Given** que o usuário está na etapa **Público (filtro)** no **Modo Avançado** e alterna para o **Modo Básico**, **When** a interface atualiza o modo, **Then** o assistente sai da etapa oculta de filtro e posiciona o usuário automaticamente em **Acionamento** (se o mailing já estiver selecionado) ou **Mailing**, preservando o mailing selecionado.
2. **Given** que o usuário preencheu Mailing, Agente, Canal simples, Calendário, Nome e Descrição no **Modo Básico** e alterna para o **Modo Avançado**, **When** a interface atualiza o modo, **Then** todas as seleções feitas são mantidas no rascunho e os controles avançados já aparecem preenchidos com os respectivos valores.

---

### Edge Cases

- **Workspace sem agentes cadastrados ou agente inativo**: Quando não houver agente de voz publicado/ativo no workspace ao selecionar um canal simples de voz no Modo Básico, o bloco **Agente** deve indicar claramente a ausência e oferecer ação direta/orientação por tooltip ou seleção do comportamento padrão do canal, sem quebrar a tela nem impedir canais simples que não dependam de agente (como SMS, WhatsApp ou E-mail).
- **Workspace sem estratégia padrão ou calendário ativo**: Se o usuário avançar no Modo Básico sem que haja estratégia pré-selecionada manualmente, o sistema deve selecionar automaticamente a estratégia padrão ativa mais compatível com disparo simples do workspace (ou informar de forma clara caso nenhuma estratégia exista no workspace).
- **Abertura via lista ou modelo de campanha no Modo Básico**: Caso o usuário abra o assistente vindo de um link com filtro/lista pré-selecionada ou modelo complexo enquanto estiver no Modo Básico, os dados carregados do link/modelo não devem quebrar o fluxo; o usuário pode concluir pelo Modo Básico mantendo os valores aplicados ou alternar para Avançado se quiser editar filtros/multicanal.
- **Perfil de permissão (Operador vs. Gestor)**: As restrições de permissão já existentes na criação e configuração de campanhas permanecem válidas em ambos os modos (usuários sem permissão não podem alterar controles restritos ao Gestor mesmo alternando para o Modo Avançado).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O assistente de criação de campanha MUST adaptar suas etapas e campos de acordo com o modo de experiência ativo (**Básico** vs. **Avançado**).
- **FR-002**: No **Modo Básico**, o assistente MUST ocultar integralmente a etapa **Público (filtro)**, exibindo um fluxo linear de **3 etapas**: **1. Mailing**, **2. Acionamento** e **3. Resumo**.
- **FR-003**: No **Modo Básico**, ao selecionar ou importar um Mailing e avançar, o sistema MUST aplicar automaticamente o modo de público completo (100% dos contatos elegíveis da base selecionada, sem filtros nem necessidade de nomear ou publicar lista).
- **FR-004**: No **Modo Básico**, a etapa **Acionamento** MUST exibir apenas os 3 blocos de configuração solicitados, em layout limpo e organizado: **Agente**, **Canal simples** e **Calendário**.
- **FR-005**: No bloco **Canal simples** do **Modo Básico**, o sistema MUST listar diretamente os canais ativos configurados pelo usuário em **Configuração → Canais** (sem exibir abas ou fluxos multicanal), associando automaticamente nos bastidores uma jornada de etapa única para o canal escolhido e a estratégia operacional padrão compatível, sem exigir edição manual de jornada ou estratégia.
- **FR-005b**: A opção **Canais** do menu **Configuração** MUST estar disponível e acessível também no **Modo Básico** (não apenas no Modo Avançado), permitindo ao usuário básico cadastrar ou ajustar seus canais de envio diretamente.
- **FR-006**: No bloco **Agente** da etapa **Acionamento**, o usuário MUST conseguir selecionar qualquer agente ativo do workspace especificamente para a campanha (pré-selecionando automaticamente o agente padrão vinculado ao canal, quando houver), aplicando esse agente escolhido nas chamadas da campanha sem alterar o vínculo padrão de outras campanhas e sem expor configurações de engenharia de áudio, DSP ou parâmetros avançados de modelo no Modo Básico.
- **FR-007**: No **Modo Básico**, a etapa **Resumo** (etapa final) MUST exibir apenas os campos de **Nome da campanha**, **Descrição** e **Agendamento** (início imediato ou agendamento para data/hora futura), além das ações de salvar rascunho ou finalizar criação. Os blocos de resumo técnico dos pilares, diagnóstico de prontidão de troncos, multiplicador de discador e modal de modelo MUST ficar ocultos no Modo Básico (utilizando os padrões automáticos configurados pelo Gestor no workspace).
- **FR-008**: No **Modo Avançado**, o assistente MUST manter **todos** os recursos e etapas completos: **Mailing**, **Público (filtro)** (incluindo fotografia/dinâmica, construtor de filtros e ordenação, prévia detalhada de exclusões), **Acionamento** (seleção de **Agente por campanha**, canais configurados / jornadas simples e multicanal, estratégias simples e completas com configuração detalhada e calendário) e **Revisar e finalizar** (todos os campos e painéis avançados).
- **FR-009**: O layout das etapas do assistente (em ambos os modos) MUST adotar uma estrutura em duas colunas em desktop: coluna principal à esquerda com os blocos de seleção empilhados de forma limpa e objetiva, e uma **segunda coluna lateral à direita detalhando em tempo real a opção escolhida/em foco** (como atributos do agente, status e tipo do canal selecionado, janelas de funcionamento do calendário, ou prévia do agendamento/configurações da etapa). Explicações conceituais auxiliares MUST ser mantidas em dicas contextuais sob demanda (`?`) em vez de parágrafos contínuos na tela, empilhando-se responsivamente em telas menores.
- **FR-010**: Ao alternar entre **Modo Básico** e **Modo Avançado** com um rascunho aberto, o sistema MUST preservar todas as escolhas já efetuadas no rascunho e reposicionar automaticamente o usuário caso a etapa atual ("Público (filtro)") deixe de existir ao entrar no Modo Básico.

### Key Entities *(include if feature involves data)*

- **Campanha & Rascunho (`Campaign` / `CampaignDraft`)**: Campanha e estado temporário do assistente contendo etapa atual, mailing escolhido, configuração opcional de lista/filtro, seleção explícita de **Agente por campanha** (sobrescrevendo o agente padrão do canal para os disparos dessa campanha), canal/jornada, estratégia padrão ou customizada, calendário, identificação e agendamento.
- **Modo de Experiência (`ExperienceMode`)**: Preferência ativa do usuário (**Básico** ou **Avançado**) que controla a visibilidade de etapas e a densidade de controles exibidos no assistente.
- **Acionamento Simplificado**: Combinação selecionada no Modo Básico composta por **Agente**, **Canal simples** (jornada de canal único) e **Calendário**, vinculada automaticamente a uma estratégia operacional padrão do workspace.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No **Modo Básico**, usuários autorizados conseguem percorrer da escolha do Mailing até a confirmação da campanha em **3 etapas** (com zero interações em filtros ou estratégia avançada) em menos de **60 segundos**.
- **SC-002**: No **Modo Básico**, **100%** das telas exibem exclusivamente os controles previstos para o modo (**Mailing**; **Acionamento** com **Agente**, **Canal simples** e **Calendário**; **Resumo** com **Nome**, **Descrição** e **Agendamento**), sem vazar painéis de filtro, multicanal ou troncos avançados.
- **SC-003**: No **Modo Avançado**, **100%** dos recursos avançados existentes (filtros, fotografia/dinâmica, multicanal, estratégias detalhadas, preflight de voz, troncos/multiplicador e modelos) permanecem acessíveis e operacionais com layout alinhado e sem regressões funcionais.
- **SC-004**: Alternar entre **Modo Básico** e **Modo Avançado** no meio de um rascunho preserva **100%** dos dados já preenchidos e nunca deixa o usuário em tela em branco ou etapa inválida.

## Assumptions

- O comportamento padrão de **Estratégia** no Modo Básico reutiliza automaticamente a estratégia simples/padrão ativa já existente no workspace (preferencialmente a estratégia marcada como simples ou imediata padrão), permitindo que a campanha seja validada e disparada sem exigir que o usuário básico configure limites, retentativas ou regras de tabulação manualmente.
- Quando a campanha criada no Modo Básico utilizar canal simples que não requer agente de voz (ex.: disparo simples por canal digital sem agente vinculado), a seleção de agente pode ser opcional ou indicar "Não aplicável ao canal selecionado", mantendo o bloco presente e claro no passo de Acionamento.
- A seleção de troncos e o multiplicador do discador implementados para Gestores continuam visíveis apenas no Modo Avançado; no Modo Básico, novas campanhas herdam automaticamente os valores padrão seguros do workspace (todos os troncos elegíveis ativos e multiplicador padrão).
- As regras atuais de controle de acesso (RBAC por papel de usuário) continuam válidas independentemente do Modo Básico ou Avançado selecionado na interface.
