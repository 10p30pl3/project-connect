# Feature Specification: Revisão da Arquitetura de Telefonia (Canal, Agentes e Rotas)

**Feature Branch**: `006-telephony-channel-agent-routes`  

**Created**: 2026-11-15  

**Status**: Draft  

**Input**: User description: "estude a melhor forma de relacao entre canal, agente de voz, rotas para telefonia" + "revise a plataforma com esse desenho. mantenha o nome canal , agentes e rotas"

## Clarifications

### Session 2026-11-15

- **Q1 (Posicionamento de "Rotas") → A**: **Rotas** ganha entrada dedicada no menu lateral sob **Configuração** ao lado de **Canais** e **Agentes**, unificando **Rotas de Entrada** e **Rotas de Saída** em uma única área operacional com atalhos contextuais nos cartões de **Canal** e **Campanha**.
- **Q2 (Abrangência das Rotas) → A**: **Rotas de Entrada** governam todos os canais receptivos de voz e áudio em tempo real (**SIP**, **WebRTC Web Widget** e **WhatsApp Calling**), permitindo roteamento por canal, DID/número, origem/domínio ou metadado antes de cair no agente padrão do canal.
- **Q3 (Modo Básico vs Avançado) → A**: No **Modo Básico**, o usuário visualiza e opera apenas **Canais** e **Agentes** (operando com roteamento padrão automático); a área dedicada de **Rotas** customizadas e regras avançadas fica visível no **Modo Avançado**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Separação Clara entre Canal (Transporte), Agentes (Atendimento IA) e Rotas (Orquestração) (Priority: P1)

Um administrador ou supervisor acessa a plataforma para configurar e operar a telefonia da empresa. Atualmente, responsabilidades de transporte (**Canal**), comportamento de atendimento (**Agentes**) e direcionamento (**Rotas**) aparecem misturadas ou enterradas em submenus técnicos, dificultando entender o que comanda o quê quando uma ligação entra ou quando uma campanha dispara.

Com este desenho revisado, mantendo os nomes **Canal**, **Agentes** e **Rotas**:
- **Canal** passa a ser explicitamente o ponto de transporte e conectividade (Troncos/Provedores SIP, WebRTC para Web e WhatsApp Calling, e canais digitais), com vínculo opcional de um **Agente padrão** (fallback).
- **Agentes** concentra exclusivamente a inteligência, voz, prompt, transcrição, detecção de caixa postal e limites de sessão de atendimento IA, podendo ser reutilizado livremente em vários canais, rotas e campanhas sem duplicação.
- **Rotas** passa a concentrar as regras de direcionamento tanto de entrada (**Rotas de Entrada**: qual Canal/DID/origem vai para qual **Agente**) quanto de saída (**Rotas de Saída**: qual prefixo/destino/campanha utiliza quais troncos em ordem de prioridade e failover).

**Why this priority**: Estabelece o modelo mental e operacional único da plataforma em cima dos três pilares já nomeados (**Canal**, **Agentes**, **Rotas**), eliminando duplicidade de agentes e ambiguidade de configuração antes de refinar regras específicas.

**Independent Test**: Navegar pelas áreas de **Canal**, **Agentes** e **Rotas**, criar 1 agente independente, vincular esse mesmo agente como padrão em um **Canal** e também referenciá-lo em uma **Rota de Entrada** e em uma **Campanha**, confirmando que nenhuma alteração de prompt/voz exige duplicar o agente nem recriar o canal ou a rota.

**Acceptance Scenarios**:

1. **Given** um administrador configurando a plataforma, **When** acessa as telas e cartões de **Canal**, **Agentes** e **Rotas**, **Then** cada área apresenta exclusivamente suas responsabilidades (transporte no **Canal**, persona/IA e limites em **Agentes**, e regras de entrada/saída em **Rotas**) utilizando exatamente essa nomenclatura em toda a navegação e formulários.
2. **Given** um **Agente** já cadastrado no workspace, **When** o usuário vincula esse agente como padrão de um **Canal**, como destino de múltiplas **Rotas de Entrada** e como atendente de **Campanhas**, **Then** todas essas referências apontam para o mesmo registro de agente, e qualquer ajuste no agente reflete automaticamente em todos os canais, rotas e campanhas vinculados.
3. **Given** uma empresa configurada com **Canal** e **Agentes** antes da revisão, **When** a plataforma é atualizada, **Then** nenhum vínculo preexistente entre canal, agente, rota ou campanha é perdido.

---

### User Story 2 - Regra Única e Previsível de Precedência em Chamadas Receptivas e Ativas (Priority: P2)

Ao receber uma ligação externa ou iniciar um disparo ativo por voz, o operador precisa ter certeza absoluta de qual **Agente** atenderá à chamada e por qual **Rota/Tronco** ela trafegará, sem conflitos silenciosos entre o que está configurado na **Campanha**, na **Rota**, no **Canal** e no padrão da empresa.

Com esta entrega, todo fluxo de voz segue uma hierarquia explícita de precedência exibida de forma transparente na interface e aplicada na execução:
- **Fluxo Receptivo (Entrada):** `Rota de Entrada` (casando DID/origem/critério) → fallback `Agente padrão do Canal` → fallback `Agente padrão da empresa`.
- **Fluxo Ativo (Saída — Campanhas/Jornadas):**
  - Escolha do **Agente**: `Agente escolhido na Campanha` → fallback `Agente padrão do Canal` → fallback `Agente padrão da empresa`.
  - Escolha do caminho de discagem: `Seleção explícita de troncos na Campanha` (quando definida) → fallback `Rota de Saída` por prefixo/DDD → fallback `Tronco padrão do Canal/empresa`.

**Why this priority**: Garante comportamento determinístico em produção e torna diagnósticos simples tanto para atendimento receptivo quanto para discagem ativa em larga escala.

**Independent Test**: Configurar uma **Rota de Entrada** apontando para o Agente A em um **Canal** cujo agente padrão é o Agente B; simular/receber chamada que casa com a rota (atendida pelo Agente A) e outra sem rota específica (atendida pelo Agente B). Em seguida criar campanha escolhendo o Agente C sobre o mesmo canal e confirmar atendimento pelo Agente C.

**Acceptance Scenarios**:

1. **Given** um **Canal** com Agente padrão B e uma **Rota de Entrada** específica apontando o DID/origem X para o Agente A, **When** chega uma ligação correspondente ao critério X, **Then** o atendimento ocorre pelo Agente A; **When** chega ligação que não casa com nenhuma rota específica, **Then** o atendimento recai sobre o Agente B (ou padrão da empresa caso o canal não tenha agente fixo).
2. **Given** uma **Campanha** ou disparo ativo associado a um **Canal** de voz, **When** o usuário seleciona um **Agente** ou seleção de troncos diretamente na campanha, **Then** a interface exibe claramente qual opção foi herdada do **Canal**/**Rota** e qual está sendo sobrescrita especificamente pela campanha.
3. **Given** um destino discado por campanha sem seleção manual de troncos na campanha, **When** existem **Rotas de Saída** configuradas para aquele prefixo/DDD, **Then** a chamada seleciona os troncos na ordem de prioridade e failover definida na **Rota de Saída**, respeitando o isolamento multi-empresa.

---

### User Story 3 - Navegação Unificada (Canais, Agentes e Rotas), Atalhos Contextuais e Modos Básico/Avançado (Priority: P3)

Usuários precisam transitar naturalmente entre **Canal**, **Agentes** e **Rotas** sem procurar configurações escondidas em submenus técnicos. No **Modo Avançado**, o menu lateral de **Configuração** apresenta **Canais**, **Agentes** e **Rotas** no mesmo nível hierárquico (com **Rotas** unificando **Rotas de Entrada** e **Rotas de Saída** e simulação de resolução em uma tela dedicada). Nos cartões de **Canal** deve ser possível visualizar rapidamente o agente padrão vinculado e saltar para as **Rotas** associadas; nos **Agentes** deve ser possível ver quais canais, rotas e campanhas utilizam aquele agente. No **Modo Básico**, a experiência mantém apenas **Canal** e **Agentes**, ocultando a complexidade de **Rotas** customizadas e aplicando o roteamento padrão automático de forma transparente.

**Why this priority**: Transforma o modelo arquitetural em produtividade diária na interface operacional, dando visibilidade de primeira classe aos três pilares no **Modo Avançado** sem sobrecarregar operadores do **Modo Básico** e mantendo explicações apenas em tooltips `(?)`.

**Independent Test**: No **Modo Avançado**, acessar **Rotas** diretamente pelo menu lateral de **Configuração** (vendo Rotas de Entrada para SIP/WebRTC/WhatsApp Calling e Rotas de Saída + simulador), saltar de um **Canal** até suas **Rotas** e de um **Agente** até seus vínculos ativos; alternar para o **Modo Básico** e confirmar que apenas **Canais** e **Agentes** ficam visíveis enquanto as ligações continuam usando o agente do canal automaticamente.

**Acceptance Scenarios**:

1. **Given** um usuário operando no **Modo Avançado**, **When** abre o menu lateral de **Configuração**, **Then** encontra os três pilares no mesmo nível (**Canais**, **Agentes** e **Rotas**), e dentro de **Rotas** gerencia **Rotas de Entrada** (SIP, WebRTC e WhatsApp Calling) e **Rotas de Saída** sem precisar navegar para submenus internos de telefonia.
2. **Given** um usuário visualizando **Canal**, **Agentes** ou **Rotas**, **When** inspeciona um item (ex.: um canal ou um agente), **Then** consegue visualizar imediatamente os vínculos relacionados (agente padrão do canal, canais/rotas/campanhas que usam o agente) e navegar pelos atalhos contextuais mantendo alta densidade UI com explicações apenas em tooltips `(?)` em português.
3. **Given** um usuário operando no **Modo Básico**, **When** acessa a navegação de **Configuração**, **Then** visualiza apenas **Canais** e **Agentes** (com o item **Rotas** oculto) e suas chamadas utilizam automaticamente a hierarquia padrão sem exigir configuração manual de rotas.

---

### Edge Cases

- **Canal sem agente padrão nem rota correspondente**: Se uma ligação receptiva chegar a um canal sem rota compatível e sem agente padrão configurado, e a empresa não possuir agente padrão ativo, o sistema recusa a sessão de forma determinística e registra motivo auditável de indisponibilidade de agente.
- **Exclusão de Agente em uso**: Ao tentar excluir um **Agente** que ainda é referenciado como padrão de um **Canal**, destino de uma **Rota** ativa ou selecionado em uma **Campanha** em andamento, o sistema bloqueia a exclusão ou exige reatribuição explícita, listando onde o agente está em uso.
- **Conflito de prioridade entre múltiplas rotas**: Se mais de uma regra de rota casar com os critérios de entrada ou saída, a ordem explícita definida pelo administrador (ordem numérica/lista priorizada) decide deterministicamente a regra vencedora, e a ferramenta de simulação de rota explica qual regra ganhou e por quê.
- **Isolamento estrito entre empresas (multi-tenant)**: Nenhuma **Rota**, **Canal** ou **Campanha** de uma empresa pode referenciar **Agentes** ou **Troncos** exclusivos de outra empresa; apenas recursos da própria empresa ou explicitamente disponibilizados como padrão global são elegíveis.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A plataforma MUST adotar e manter explicitamente os nomes **Canal**, **Agentes** (ou **Agentes de Voz**) e **Rotas** em menus, títulos, cartões, seletores e fluxos operacionais relacionados à telefonia.
- **FR-002**: O domínio **Canal** MUST representar exclusivamente o transporte e a conectividade de entrada/saída, permitindo vincular no máximo um **Agente padrão** (opcional/fallback) por canal, sem incorporar lógica de prompts, filtros de áudio do agente ou regras complexas de discagem que pertencem a **Agentes** ou **Rotas**.
- **FR-003**: O domínio **Agentes** MUST centralizar todas as configurações de inteligência artificial, voz, instruções, detecção de secretária eletrônica (AMD), transcrição (STT), filtros de áudio e limites de concorrência/duração, mantendo cada agente independente e reutilizável por múltiplos **Canais**, **Rotas** e **Campanhas**.
- **FR-004**: O domínio **Rotas** MUST ter tela dedicada no menu de **Configuração** (no **Modo Avançado**), ao lado de **Canais** e **Agentes**, unificando **Rotas de Entrada** (critérios receptivos para canais **SIP**, **WebRTC Web Widget** e **WhatsApp Calling**, como canal de origem, DID/número, domínio/origem ou metadado → **Agente** ou ramal) e **Rotas de Saída** (critérios de prefixo/destino → sequência priorizada de troncos), mantendo ordenação explícita, ativação individual e simulador/diagnóstico de resolução.
- **FR-005**: A plataforma MUST aplicar regra única de precedência em runtime para todas as sessões de voz/áudio:
  - Receptivo (**SIP**, **WebRTC Web Widget** e **WhatsApp Calling**): **Rota de Entrada** compatível (avaliada em ordem de prioridade) → **Agente padrão do Canal** → **Agente padrão do workspace**.
  - Ativo (**Campanhas** / **Jornadas**): **Agente da Campanha** → **Agente padrão do Canal** → **Agente padrão do workspace**; e na discagem, seleção explícita de troncos da campanha (quando houver) → **Rota de Saída** compatível → tronco padrão.
- **FR-006**: A interface MUST tornar visível na criação e inspeção de **Campanhas**, **Canais** e **Rotas** a origem efetiva de cada vínculo (herdado do **Canal**/**Rota** vs sobrescrito manualmente), oferecer atalhos diretos entre **Canais**, **Agentes** e **Rotas**, e exibir em **Agentes** os vínculos ativos de canais, rotas e campanhas que o utilizam, impedindo exclusões acidentais sem desvinculação prévia.
- **FR-007**: A plataforma MUST preservar 100% do isolamento multi-empresa em vínculos entre **Canal**, **Agentes**, **Rotas** e **Campanhas**, bloqueando associações cruzadas entre workspaces não autorizados.
- **FR-008**: A plataforma MUST garantir migração segura sem perda ou quebra de **Canais**, **Agentes**, **Rotas** e **Campanhas** já existentes em produção, mantendo **Modo Básico** focado apenas em **Canal** + **Agentes** (com roteamento automático transparente e **Rotas** visível no **Modo Avançado**), e preservando interface de alta densidade com explicações exclusivamente em tooltips `(?)` em português (`pt-BR`).

### Key Entities *(include if feature involves data)*

- **Canal**: Entidade de conectividade do workspace (`VOICE`, `WEBRTC`, `WHATSAPP`, `SMS`, `EMAIL`) contendo credenciais/chaves do meio de transporte, status operacional e referência opcional para um **Agente padrão**.
- **Agente**: Entidade de atendimento de voz IA do workspace, independente de transporte, definindo prompt, voz, provedor de fala, configurações de áudio/transcrição e limites de duração/concorrência.
- **Rota**: Regra ordenada de direcionamento do workspace dividida em **Rota de Entrada** (critério receptivo → **Agente** ou destino interno) e **Rota de Saída** (padrão de destino → lista ordenada de troncos de saída).
- **Vínculo de Campanha**: Configuração ativa na campanha que escolhe o **Canal** de envio e opcionalmente sobrescreve o **Agente** e/ou troncos preferenciais dentro da hierarquia de precedência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% das chamadas receptivas e disparos ativos avaliados, o agente e o caminho de saída selecionados correspondem exatamente à regra de precedência única (`Rota` / `Campanha` → `Canal` → padrão do workspace), verificável tanto em execução quanto no simulador de rotas.
- **SC-002**: Um administrador consegue reutilizar um único **Agente** em pelo menos 2 **Canais** distintos, 1 **Rota de Entrada** e 1 **Campanha** sem duplicar cadastro de agente, completando a associação em menos de 1 minuto.
- **SC-003**: 100% das tentativas de associar um **Agente**, **Canal** ou **Rota** de outro workspace ou de excluir um **Agente** ativamente referenciado são bloqueadas com mensagem clara indicando os vínculos ativos.
- **SC-004**: Ao inspecionar qualquer **Canal**, **Agente** ou **Campanha**, o usuário identifica em menos de 5 segundos qual regra está ativa (se direta, herdada do canal ou definida por rota), sem necessidade de suporte técnico ou leitura de documentação externa.

## Assumptions

- Todos os termos visíveis ao usuário preservam obrigatoriamente a nomenclatura **Canal**, **Agentes** e **Rotas** (evitando termos técnicos internos como "tenant" nos rótulos finais em português).
- Contratos já ativos em produção (campanhas em execução, discagens em andamento, histórico de chamadas e gravações) continuam operando normalmente durante e após a transição.
- Alterações em **Agentes**, **Canais** e **Rotas** continuam sujeitas às permissões de perfil já existentes no workspace (leitura vs administração).
