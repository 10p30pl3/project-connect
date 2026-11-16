# Feature Specification: Revisão de UX/UI para Modos Básico e Avançado

**Feature Branch**: `007-ux-ui-modes-cleanup`  
**Created**: 2026-11-15  
**Status**: Draft  
**Input**: User description: "revisar o layout como UX - UI para os modos basico e avancado. deve ser visual limpo e facil de entender, sem friccao. retirar redundancias, textos explicativos devem estar em tooltip. controles especiais somente super admin"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navegação limpa e sem redundâncias entre Modo Básico e Avançado (Priority: P1)

Como usuário (operador, gestor ou administrador de tenant), quero alternar entre os modos **Básico** e **Avançado** em uma interface visualmente limpa, sem rótulos duplicados ou seções repetidas na barra lateral e nos cabeçalhos, para encontrar rapidamente as ações principais sem fricção.

**Why this priority**: A barra lateral, o seletor de modo e os cabeçalhos estão presentes em todas as telas; eliminar redundâncias visuais e simplificar a hierarquia traz impacto imediato em toda a experiência de uso.

**Independent Test**: Abrir a aplicação no modo Básico e alternar para o modo Avançado na barra lateral (desktop) e na tela Mais (mobile), verificando que o seletor não repete o rótulo do modo ativo, os grupos do menu não exibem títulos redundantes com o único item interno e os itens exibidos correspondem exatamente ao nível selecionado.

**Acceptance Scenarios**:

1. **Given** usuário autenticado no modo Básico, **When** visualiza a barra lateral e a barra de ações, **Then** o seletor de nível exibe apenas o controle segmentado (`Básico` | `Avançado`) com um ícone de ajuda em tooltip explicando a diferença entre os modos, sem repetir o nome do modo ativo em dois lugares.
2. **Given** um grupo de navegação que possui apenas um item visível com o mesmo nome do grupo (como `Sistema`), **When** o menu lateral é renderizado, **Then** não há duplicação desnecessária de rótulo entre cabeçalho do grupo e item, mantendo leitura limpa.
3. **Given** usuário alternando entre **Básico** e **Avançado**, **When** está em uma rota exclusiva do modo Avançado e volta para o modo Básico, **Then** a navegação permanece coerente e oferece retorno claro para a visão essencial sem deixar menus quebrados ou vazios.

---

### User Story 2 - Textos explicativos movidos para tooltips mantendo telas enxutas (Priority: P1)

Como usuário operando campanhas, telefonia, agentes, canais e cadastros, quero que parágrafos explicativos, subtítulos conceituais longos e notas de instrução inline sejam substituídos por ícones de tooltip discretos (`?`), para que a tela fique limpa, objetiva e focada em dados e ações.

**Why this priority**: Parágrafos explicativos e banners informativos longos poluem o layout, aumentam a rolagem vertical e criam ruído visual; mover explicações para tooltips preserva a ajuda contextual sob demanda sem sacrificar a clareza.

**Independent Test**: Navegar pelas principais telas nos modos Básico e Avançado (`Visão geral`, `Campanhas`, `Detalhe da campanha`, `Nova campanha`, `Telefonia`, `Agentes de Voz`, `Canais`, `Calendários`, `Sistema`), confirmando que não existem blocos de texto conceitual inline e que ao passar/focar o ícone `?` a explicação aparece em tooltip acessível.

**Acceptance Scenarios**:

1. **Given** qualquer tela principal ou modal de configuração nos modos Básico e Avançado, **When** a tela é renderizada, **Then** títulos, formulários e cards não exibem parágrafos introdutórios ou notas conceituais inline; explicações permanecem encapsuladas em tooltips junto ao respectivo rótulo ou título.
2. **Given** usuário com dúvida sobre um campo, métrica ou seção, **When** passa o cursor ou foca o ícone de tooltip (`?`), **Then** o texto explicativo conciso é exibido em popover/tooltip legível e sem cortar conteúdo na viewport.
3. **Given** mensagens operacionais dinâmicas de erro, validação ou estado bloqueante da ação atual (ex.: motivo de pausa ou erro de formulário), **When** ocorrem, **Then** permanecem visíveis diretamente na tela como feedback acionável (sem ocultar erros críticos em tooltip).

---

### User Story 3 - Controles especiais restritos exclusivamente ao Super Admin (Priority: P1)

Como responsável pela plataforma SaaS, quero garantir que controles especiais de plataforma, custos/tarifas de provedor, engenharia de infraestrutura e ferramentas administrativas avançadas fiquem visíveis e acessíveis apenas para usuários com perfil **Super Admin**, para evitar exposição indevida e confusão aos usuários finais dos clientes.

**Why this priority**: Expor controles de plataforma, tarifas de venda, parâmetros internos de infraestrutura ou ações administrativas especiais para perfis de cliente viola a separação de papéis e sobrecarrega o usuário comum mesmo no modo Avançado.

**Independent Test**: Acessar a aplicação autenticado como `ADMIN` (ou `MANAGER`/`SUPERVISOR`/`OPERATOR`) no modo Avançado e verificar que controles especiais (como gestão de tenants/impersonação, tarifas/custos internos, diagnóstico de infraestrutura/sistema global e engenharia SIP/DSP interna) ficam ocultos; ao acessar como `SUPER_ADMIN`, esses controles ficam disponíveis.

**Acceptance Scenarios**:

1. **Given** usuário sem perfil `SUPER_ADMIN` (mesmo `ADMIN` do workspace) usando o modo Básico ou Avançado, **When** navega pelo menu lateral, `Sistema`, `Telefonia`, `Billing & Consumo` e `Detalhe da campanha`, **Then** controles especiais de plataforma, custos/margens internos, engenharia SIP/DSP global e ações exclusivas de super admin não são exibidos.
2. **Given** usuário com perfil `SUPER_ADMIN`, **When** acessa a plataforma, **Then** visualiza os controles especiais de administração global, tarifas/custos e diagnóstico avançado, com indicação clara de escopo administrativo quando aplicável.
3. **Given** usuário sem perfil `SUPER_ADMIN` tentando acessar diretamente uma rota restrita via URL, **When** a página carrega, **Then** a interface bloqueia a exibição dos controles especiais e orienta o retorno de forma limpa.

---

### Edge Cases

- Usuário no modo Avançado sem perfil `SUPER_ADMIN`: deve ver recursos avançados de operação (listas, jornadas, estratégias, tabulação, relatórios, inteligência operacional), mas **nunca** controles especiais exclusivos de `SUPER_ADMIN`.
- Usuário `SUPER_ADMIN` no modo Básico: mantém acesso às ações essenciais do dia a dia sem poluição visual, mas controles especiais de Super Admin que dependem de visibilidade administrativa respeitam o perfil e permanecem limpos.
- Textos de feedback obrigatório (erros de validação de campo, confirmação de ações destrutivas, estado operacional crítico de campanha) NÃO devem ser movidos para tooltip — apenas textos explicativos/conceituais.
- Layout responsivo (desktop e mobile, incluindo tela `Mais`): ausência de overflow horizontal, botões alinhados e tooltips utilizáveis também via clique/toque ou foco de teclado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST revisar o layout dos modos **Básico** e **Avançado** para eliminar redundâncias visuais na barra lateral, tela `Mais`, cabeçalhos de página, abas e cards de resumo.
- **FR-002**: O seletor de nível de interface (`Básico` | `Avançado`) MUST apresentar visual limpo, sem repetir o rótulo do modo ativo fora do botão selecionado, utilizando tooltip para explicar a diferença entre os modos.
- **FR-003**: Textos explicativos, descrições conceituais de páginas/seções e instruções auxiliares inline MUST ser movidos para componentes de tooltip (`?`) acionáveis por hover, foco ou clique, mantendo apenas títulos curtos, valores e controles essenciais visíveis.
- **FR-004**: Mensagens críticas de erro, validação de formulário e estado operacional ativo MUST permanecer visíveis inline para não prejudicar a compreensão imediata de falhas ou bloqueios.
- **FR-005**: Todos os controles especiais de plataforma, administração multi-tenant, tarifas/custos internos de provedor/PSTN/IA, configurações globais de sistema e ajustes técnicos exclusivos de infraestrutura MUST ser exibidos exclusivamente para usuários com perfil `SUPER_ADMIN`.
- **FR-006**: Usuários sem perfil `SUPER_ADMIN` (incluindo `ADMIN`, `MANAGER`, `SUPERVISOR`, `OPERATOR`, `ANALYST`) MUST NOT visualizar controles especiais nem no modo Básico nem no modo Avançado, tanto na navegação quanto dentro das abas e modais das páginas.
- **FR-007**: O modo **Básico** MUST manter visíveis apenas os fluxos essenciais do dia a dia (visão geral, campanhas, contatos, mailings, calendários, canais, agentes de voz, telefonia simplificada e consumo de tempo), com formulários diretos e sem fricção.
- **FR-008**: O modo **Avançado** MUST liberar os módulos operacionais completos (modelos, inteligência, listas, jornadas, estratégias, tabulação, relatórios, limites e auditoria operacional) mantendo o mesmo padrão limpo, sem parágrafos explicativos inline e sem controles exclusivos de `SUPER_ADMIN`.

### Key Entities

- **ExperienceMode (`basic` | `advanced`)**: Nível de complexidade visual da interface escolhido pelo usuário para filtrar módulos e densidade de campos sem alterar permissões de segurança.
- **Role / Super Admin Gate (`SUPER_ADMIN`)**: Controle de autorização baseado em perfil que restringe controles especiais de plataforma, custos internos e administração global exclusivamente ao Super Admin.
- **Contextual Tooltip (`InfoTooltip`)**: Elemento discreto de ajuda contextual (`?`) que encapsula textos explicativos sob demanda, mantendo a interface livre de ruído textual.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos textos explicativos e subtítulos conceituais identificados nas telas principais nos modos Básico e Avançado são encapsulados em tooltips, removendo blocos de texto descritivo inline.
- **SC-002**: 100% dos controles especiais de plataforma, custos internos e administração global ficam ocultos para perfis não `SUPER_ADMIN` em ambos os modos (Básico e Avançado) e visíveis para `SUPER_ADMIN`.
- **SC-003**: Redução perceptível de ruído visual e redundâncias na barra lateral, cabeçalhos e formulários, validada visualmente em desktop e mobile em ambos os modos sem regressão funcional ou erros de layout.
- **SC-004**: Fluxos principais no modo Básico (criar/editar campanha, visualizar consumo de tempo, operar telefonia simplificada) são executados sem textos longos ou controles técnicos desnecessários.

## Assumptions

- A separação entre **nível da interface** (`basic` vs `advanced`, preferência visual do usuário) e **permissão de acesso** (`SUPER_ADMIN` vs perfis do cliente) continua sendo respeitada de forma ortogonal: o modo Avançado nunca eleva privilégios de quem não é Super Admin.
- A validação de segurança definitiva continua no backend (`requireRoles`), cabendo a esta especificação garantir consistência completa de UX/UI no frontend para não exibir nem induzir acesso a controles especiais.
- O padrão visual segue o sistema de design existente do Voll Plan (Tailwind CSS + componentes `ui.tsx`, incluindo `InfoTooltip`), mantendo todos os textos em pt-BR.
