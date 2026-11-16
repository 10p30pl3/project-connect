# Feature Specification: Edição de Configurações e Histórico de Alterações de Campanha

**Feature Branch**: `005-campaign-config-audit`  
**Created**: 2026-11-15  
**Status**: Draft  
**Input**: User description: "em campanhas, deve ser possivel editar as configuracoes. qualquer configuracao deve ser registrada no historico da campanha, pessoa, data-hora e o que foi modificado"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Editar configurações da campanha (Priority: P1)

Como supervisor ou operador autorizado, quero editar as configurações de uma campanha existente (como nome, descrição, público/lista, jornada, estratégia, calendário de funcionamento e agendamento) diretamente na página de detalhes da campanha, para ajustar a operação sem precisar criar uma nova campanha do zero.

**Why this priority**: Sem a capacidade de edição direta, qualquer ajuste operacional (trocar calendário, ajustar estratégia, alterar agendamento ou corrigir nome/descrição) obriga a duplicar ou recriar campanhas, interrompendo a continuidade dos indicadores e contatos.

**Independent Test**: Pode ser testada abrindo os detalhes de uma campanha, alterando uma ou mais configurações (por exemplo, calendário e descrição), salvando e verificando que os novos valores passaram a valer na campanha.

**Acceptance Scenarios**:

1. **Given** uma campanha existente em rascunho, agendada, em execução ou pausada, **When** um usuário com permissão abre a ação de editar configurações, altera um ou mais campos permitidos e confirma o salvamento, **Then** o sistema persiste as novas configurações, atualiza a visualização da campanha e passa a aplicar as novas regras nos próximos acionamentos.
2. **Given** uma campanha encerrada/finalizada ou arquivada, **When** o usuário acessa os detalhes da campanha, **Then** o sistema impede a edição das configurações operacionais (ou informa claramente que campanhas encerradas/arquivadas são somente leitura).
3. **Given** um usuário sem permissão de edição, **When** acessa os detalhes da campanha, **Then** a ação de editar configurações não fica disponível para execução.
4. **Given** o usuário abre a edição de configurações e clica em salvar sem alterar nenhum valor, **When** a ação é submetida, **Then** o sistema não registra uma alteração vazia no histórico.

---

### User Story 2 - Registro automático de auditoria no histórico da campanha (Priority: P1)

Como gestor ou auditor operacional, quero que toda e qualquer modificação feita nas configurações de uma campanha seja registrada automaticamente no histórico da própria campanha, informando quem fez a alteração, a data e hora exatas e o que foi modificado, para garantir rastreabilidade completa das decisões operacionais.

**Why this priority**: Mudanças de estratégia, calendário, jornada ou público impactam diretamente os disparos e custos. Sem saber quem alterou, quando alterou e o que mudou (valor anterior e novo valor), não há governança nem diagnóstico de incidentes.

**Independent Test**: Pode ser testada editando dois campos distintos de uma campanha (ex.: estratégia e calendário) com um usuário autenticado e verificando imediatamente que o registro correspondente aparece no histórico com nome/identificação da pessoa, data-hora completa e lista exata dos campos alterados (antes → depois).

**Acceptance Scenarios**:

1. **Given** um usuário autenticado altera o calendário de funcionamento e o nome da campanha e salva, **When** a operação é concluída, **Then** o sistema grava atomicamente um registro no histórico da campanha contendo: identificação da pessoa responsável, data e hora completas (com hora, minuto e segundo) e cada campo modificado com seu valor anterior e novo valor.
2. **Given** uma campanha já possui configurações definidas em sua versão atual, **When** o usuário altera apenas um campo (ex.: descrição) mantendo os demais iguais, **Then** o registro de histórico lista exclusivamente o campo efetivamente modificado, sem poluir o histórico com campos inalterados.
3. **Given** uma falha ao persistir a alteração ou no registro de auditoria, **When** o salvamento é processado, **Then** a operação é revertida integralmente para que nenhuma mudança de configuração ocorra sem seu respectivo registro de histórico.

---

### User Story 3 - Consultar o histórico de modificações na tela da campanha (Priority: P2)

Como operador ou gestor, quero visualizar uma aba ou seção dedicada de **Histórico** dentro da página da campanha (ao lado de Visão geral, Tentativas, Elegibilidade e reservas e Indicadores), ordenada da alteração mais recente para a mais antiga, para consultar rapidamente todo o ciclo de mudanças daquela campanha.

**Why this priority**: O registro de auditoria só gera valor operacional quando é facilmente consultável no contexto da própria campanha, sem depender de acesso técnico ao banco de dados ou logs externos.

**Independent Test**: Pode ser testada acessando a aba **Histórico** de uma campanha que passou por edições e verificando a exibição cronológica decrescente com pessoa, data-hora e resumo "De → Para" de cada alteração.

**Acceptance Scenarios**:

1. **Given** uma campanha com múltiplas alterações registradas, **When** o usuário abre a aba **Histórico** na tela da campanha, **Then** o sistema exibe os registros em ordem cronológica decrescente (mais recente primeiro), mostrando para cada entrada: pessoa (nome/e-mail ou identificador), data e hora (dia/mês/ano, hora:minuto:segundo) e a lista de modificações (campo, valor anterior e novo valor).
2. **Given** uma campanha recém-criada que ainda não sofreu edições de configuração, **When** o usuário abre a aba **Histórico**, **Then** o sistema exibe o evento inicial de criação da campanha (ou estado vazio claro indicando nenhuma modificação posterior).

---

### Edge Cases

- **Campanha em execução (`RUNNING`)**: alterações de calendário, estratégia, jornada ou público devem valer para os próximos disparos/reservas sem corromper tentativas já em curso.
- **Alteração simultânea**: se dois usuários editarem a mesma campanha ao mesmo tempo, ambos os salvamentos válidos devem gerar registros distintos e ordenados no histórico, preservando a integridade dos dados.
- **Remoção de campo opcional**: quando um campo que tinha valor (ex.: descrição ou calendário específico) é limpo/removido, o histórico deve registrar claramente a mudança do valor anterior para vazio/`—` (ou padrão).
- **Edição via ação rápida vs formulário completo**: qualquer ponto do sistema que altere configurações da campanha (edição na tela da campanha, troca de status/agendamento ou atualização parcial) deve passar pelo mesmo mecanismo de registro no histórico.
- **Identificação do autor**: quando o usuário estiver autenticado, registrar seu nome e e-mail/identificador; em execuções automáticas de sistema (se houver), identificar explicitamente como ação automática/sistema.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir editar as configurações de uma campanha existente (nome, descrição, público/lista, jornada, estratégia, calendário de funcionamento e agendamento quando aplicável) diretamente a partir da tela de detalhes da campanha.
- **FR-002**: O sistema MUST restringir a edição de configurações apenas a usuários com permissão de escrita/gestão operacional e bloquear alterações em campanhas encerradas ou arquivadas.
- **FR-003**: O sistema MUST comparar o estado anterior e o novo estado da campanha a cada salvamento e identificar exatamente quais campos foram modificados.
- **FR-004**: O sistema MUST registrar automaticamente uma entrada no histórico da campanha sempre que houver pelo menos uma modificação efetiva de configuração.
- **FR-005**: Cada registro no histórico da campanha MUST armazenar e exibir:
  - **Pessoa**: nome e/ou identificador (e-mail/ID) do usuário responsável pela modificação;
  - **Data e hora**: timestamp completo com data, hora, minuto e segundo no fuso horário operacional;
  - **O que foi modificado**: lista estruturada contendo o nome legível do campo alterado, o valor anterior e o novo valor.
- **FR-006**: O sistema MUST garantir atomicidade entre a atualização da configuração da campanha e a gravação do registro no histórico (nenhuma edição pode ser salva sem registro de auditoria).
- **FR-007**: O sistema MUST disponibilizar a aba **Histórico** na página de detalhes da campanha exibindo os registros em ordem cronológica decrescente (mais recente primeiro), seguindo o padrão visual de alta densidade sem textos explicativos inline no corpo da tela (usando tooltips `(?)` quando necessário).
- **FR-008**: O sistema MUST ignorar/evitar a criação de registros de histórico vazios quando o usuário confirmar o salvamento sem ter alterado nenhum valor.

### Key Entities *(include if feature involves data)*

- **Campanha**: entidade operacional que concentra nome, descrição, vínculo com mailing/lista de público, versão de jornada, versão de estratégia, calendário de funcionamento, agendamento e status.
- **Registro de Histórico da Campanha**: registro imutável vinculado a uma campanha específica, contendo identificador único, identificação do autor (pessoa), data-hora exata da modificação, tipo de evento (criação, edição de configuração, mudança de status) e lista detalhada de alterações (`campo`, `valorAnterior`, `valorNovo`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das alterações de configuração salvas em campanhas geram exatamente 1 registro correspondente no histórico da campanha contendo pessoa, data-hora (com segundos) e diff legível dos campos alterados.
- **SC-002**: Usuários autorizados conseguem editar configurações de uma campanha existente e visualizar o registro correspondente na aba **Histórico** em menos de 30 segundos, sem necessidade de recriar a campanha.
- **SC-003**: 0% de salvamentos sem mudanças efetivas produzem entradas duplicadas ou vazias no histórico da campanha.
- **SC-004**: 100% das tentativas de edição por usuários sem permissão ou em campanhas encerradas/arquivadas são bloqueadas antes de alterar qualquer dado.

## Assumptions

- O usuário autenticado na sessão atual possui nome e e-mail/identificador disponíveis para gravação imediata como autor da alteração.
- A edição de campanha é aplicável a campanhas nos estados `DRAFT`, `SCHEDULED`, `RUNNING` e `PAUSED` (não arquivadas); campanhas `COMPLETED` ou `CANCELLED` permanecem somente leitura para preservar integridade histórica.
- A alteração de **Mailing base** após o início da campanha pode permanecer bloqueada caso já existam contatos inscritos/tentativas, mantendo editáveis nome, descrição, lista/filtro de público (quando aplicável), jornada, estratégia, calendário de funcionamento e agendamento — esse detalhamento fino será validado na fase de planejamento (`/speckit-plan`).
- A visualização do histórico seguirá a Diretriz IV da Constituição do projeto (interface de alta densidade em `pt-BR`, com orientações conceituais exclusivamente em tooltips `(?)`).
