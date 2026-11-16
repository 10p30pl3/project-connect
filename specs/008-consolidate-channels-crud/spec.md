# Feature Specification: Consolidar Abas de Canais e CRUD Completo (Básico ao Avançado)

**Feature Branch**: `008-consolidate-channels-crud`  
**Created**: 2026-11-16  
**Status**: Draft  
**Input**: User description: "consolidar as duas abas de canais em uma so. a ideia e que seja possivel fazer crud de um canal, desde configuracoes basicas ate as avancadas"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visão Única de Canais sem Fragmentação em Abas (Priority: P1)

Como usuário ou administrador acessando **Canais & Integrações** (`/canais`), quero visualizar diretamente a listagem consolidada de canais (em cartões ou tabela) sem precisar alternar entre duas abas distintas (*Conectores & Conexões* e *Configurar Endereços Técnicos*), para encontrar e gerenciar tudo em um único lugar.

**Why this priority**: Elimina a duplicidade e confusão atual entre "conexões de canal" e "endereços técnicos", entregando o fluxo unificado solicitado.

**Independent Test**: Acessar `/canais` como Super Admin e como Admin de workspace; confirmar que não há barra de abas dividindo a tela em duas seções, e que a lista única de canais e suas ações primárias (Criar, Editar, Habilitar/Desabilitar, Excluir, Testar) estão imediatamente acessíveis.

**Acceptance Scenarios**:

1. **Given** usuário autenticado (inclusive Super Admin) acessa `/canais`, **When** a página carrega, **Then** não são exibidas as duas abas (*Conectores & Conexões* / *Configurar Endereços Técnicos*), exibindo diretamente a visão consolidada de canais.
2. **Given** usuário está na visão consolidada de `/canais`, **When** alterna entre visualização em cartões e tabela, **Then** todos os canais ativos e inativos exibem suas informações essenciais (nome, tipo, provedor, status, endpoint/identificador e vínculo de agente padrão quando aplicável) e ações rápidas de gerenciamento.

---

### User Story 2 - CRUD Completo de Canal (Configurações Básicas até Avançadas) (Priority: P1)

Como administrador, quero criar, visualizar, editar e excluir um canal em um fluxo único que abranja desde **configurações básicas** (nome, tipo de canal, provedor, status, BINA/caller ID, agente de voz padrão) até **configurações avançadas e técnicas** (URL de endpoint/API, webhooks, tokens/credenciais, limites de concorrência/tarifação, configurações específicas de protocolo como Phone Number ID/WABA ID, WebRTC allowed origins, e teste de conectividade), sem precisar sair do cadastro do canal.

**Why this priority**: É o núcleo da solicitação: permitir o ciclo CRUD completo do canal de ponta a ponta no mesmo formulário/fluxo.

**Independent Test**: Criar um novo canal preenchendo configurações básicas e expandindo/preenchendo configurações avançadas; salvar, reabrir para edição, testar conectividade, atualizar um campo técnico, desabilitar e excluir (quando não houver bloqueio de histórico/jornada).

**Acceptance Scenarios**:

1. **Given** usuário clica em **Novo canal**, **When** preenche os campos básicos e opcionalmente preenche os campos avançados/técnicos (endpoints, tokens, webhooks, limites), **Then** o canal é criado com todas as configurações persistidas de forma atômica.
2. **Given** usuário clica em **Configurar** (ou editar) em um canal existente, **When** altera tanto dados básicos quanto parâmetros avançados/técnicos (ou aciona **Testar conectividade** no próprio canal), **Then** o sistema valida os campos por tipo de canal, salva as alterações mantendo segredos mascarados quando não alterados e reflete imediatamente o resultado na listagem.
3. **Given** usuário solicita **Excluir** em um canal sem dependências ativas, **When** confirma a exclusão, **Then** o canal é removido; caso possua jornadas ativas ou histórico de tentativas, o sistema informa o bloqueio de forma clara e sugere desabilitar o canal.

---

### User Story 3 - Eliminação da Tela Global Redundante com Absorção Técnica por Canal (Priority: P2)

Como Super Admin ou administrador, quero que os parâmetros técnicos antes isolados na aba *Configurar Endereços Técnicos* (endpoints de API/Gateway, webhooks de status/CDR, verify tokens, credenciais e limites de concorrência/pool por canal) estejam disponíveis diretamente no CRUD de cada canal (junto ao botão **Testar Conectividade**), eliminando a configuração global paralela em `/canais`.

**Why this priority**: Elimina de vez a fragmentação entre "endereço técnico global" e "canal específico" (`1C`), garantindo que cada canal seja autossuficiente do básico ao avançado.

**Independent Test**: Acessar `/canais` como Super Admin, confirmar que a aba *Configurar Endereços Técnicos* não existe mais, abrir o CRUD de um canal (ex.: WhatsApp ou Voz) e confirmar que todos os campos técnicos equivalentes e o botão *Testar Conectividade* estão disponíveis e persistidos no próprio canal.

**Acceptance Scenarios**:

1. **Given** Super Admin acessa `/canais`, **When** cria ou edita um canal de qualquer protocolo (WhatsApp, Voz, WebRTC, SMS, E-mail, RCS), **Then** pode configurar e testar todos os endereços técnicos, webhooks, credenciais e limites/cotas diretamente no formulário do canal, sem depender de aba ou modal global separado.
2. **Given** existem configurações técnicas legadas previamente salvas em infraestrutura global, **When** canais existentes são editados ou operam, **Then** valores padrão continuam servindo de fallback seguro caso o canal não os sobrescreva, sem exibir tela global redundante na interface.

---

### Edge Cases

- **Segredos e Tokens em Edição**: Ao editar um canal existente que já possui token/credencial salva, os campos sensíveis devem permanecer mascarados e NÃO serem apagados ou sobrescritos por placeholder vazio se o usuário editar apenas campos básicos.
- **Alternância de Tipo de Canal / Provedor no Cadastro**: Ao trocar o tipo de canal (ex.: Voz SIP ↔ WebRTC ↔ WhatsApp ↔ SMS ↔ E-mail ↔ RCS) durante a criação, campos técnicos irrelevantes para aquele protocolo não devem ser exigidos na validação.
- **Modo Básico vs Modo Avançado**: Usuários em modo básico devem conseguir criar/editar um canal com simplicidade (básico em destaque e defaults automáticos), podendo expandir as configurações avançadas quando necessário, sem perder acesso ao CRUD.
- **Permissões (Leitura vs Escrita vs Super Admin)**: Usuários sem permissão de edição (`connections.write`) visualizam os canais em modo leitura, sem botões de criar/editar/excluir ou alterações de infraestrutura global.
- **Exclusão com Vínculos**: Tentativa de exclusão de canal referenciado por jornadas, rotas ou histórico de acionamentos deve retornar erro amigável sem corromper dados históricos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A página **Canais & Integrações** (`/canais`) MUST remover a navegação em duas abas (*Conectores & Conexões* e *Configurar Endereços Técnicos*), apresentando diretamente a listagem consolidada de canais.
- **FR-002**: O sistema MUST oferecer CRUD completo (**Criar**, **Listar/Visualizar**, **Editar**, **Habilitar/Desabilitar**, **Excluir**) de canais unificando configurações básicas e configurações avançadas/técnicas em um único fluxo por canal.
- **FR-003**: O formulário de criação e edição de canal MUST organizar claramente as **Configurações Básicas** (nome, tipo de canal, provedor, situação ativa, identificador/BINA, agente padrão quando aplicável) e as **Configurações Avançadas / Técnicas** (URL de endpoint/API, webhooks, verify token, credenciais/tokens, limites/tarifação e parâmetros específicos de protocolo).
- **FR-004**: O fluxo de edição/configuração do canal MUST preservar segredos já cadastrados quando os campos sensíveis não forem modificados pelo usuário.
- **FR-005**: O sistema MUST permitir validar/testar conectividade diretamente no contexto do canal configurado, exibindo status e latência sem exigir navegação para outra aba.
- **FR-006**: A aba *Configurar Endereços Técnicos* e qualquer painel global paralelo em `/canais` MUST ser removida (`1C`), absorvendo no CRUD de cada canal os parâmetros técnicos por protocolo (URL de API/Gateway, Webhook, Verify Token, credenciais/tokens, WebRTC WSS/CDR quando aplicável e limites de concorrência/tarifação), mantendo compatibilidade de fallback no backend para configurações legadas não sobrescritas.
- **FR-007**: O formulário unificado de CRUD do canal MUST seguir o modelo de revelação progressiva (`2A`): **Configurações Básicas** sempre visíveis no topo (Nome, Tipo de Canal, Provedor, Situação Ativa, BINA/Identificador, Agente Padrão) e uma seção expansível **"Configurações Avançadas & Endereços Técnicos"** recolhida por padrão no *Modo Básico* e expandida por padrão no *Modo Avançado*.
- **FR-008**: Toda cópia visível ao usuário MUST estar em português (`pt-BR`), respeitando o Princípio IV da Constituição (orientações conceituais exclusivamente em tooltips `(?)`, sem parágrafos explicativos no corpo da interface).

### Key Entities *(include if feature involves data)*

- **Canal (`Connection`)**: Entidade operacional única configurada por workspace e protocolo (`VOICE`, `WEBRTC`, `WHATSAPP`, `SMS`, `EMAIL`, `RCS`), reunindo atributos básicos (nome, provedor, status, BINA, agente padrão) e atributos técnicos/avançados (endpoint, webhooks, tokens mascarados, limites, parâmetros de protocolo).
- **Configuração Global de Gateways (`ChannelEndpointConfig`)**: Conjunto de endereços e credenciais padrão da plataforma por protocolo (Voice-App, WebRTC WSS, CDR Webhook, Graph API, SMS, E-mail, RCS), utilizado como fallback ou configuração compartilhada de infraestrutura.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das operações de criação, edição básica, configuração técnica/avançada, toggle de status e exclusão de um canal são concluídas dentro da visão única de `/canais`, com zero alternância entre abas na página principal.
- **SC-002**: O número de cliques para abrir e editar qualquer parâmetro básico ou técnico de um canal existente cai para no máximo 2 cliques a partir da listagem de `/canais`.
- **SC-003**: Nenhum parâmetro operacional existente antes da consolidação (campos de canal ou teste de conectividade) fica inacessível após a remoção da segunda aba.
- **SC-004**: 100% dos textos e tooltips da tela consolidada seguem `pt-BR` sem textos explicativos inline no corpo dos cards ou campos.

## Assumptions

- O modelo de autenticação, permissões (`connections.read`, `connections.write`, `isSuperAdminRole`) e isolamento multi-workspace existentes serão mantidos integralmente.
- As integrações dependentes de canais (como vinculação de agente padrão, atalho para **Rotas** no Modo Avançado e seleção de canais em Campanhas/Jornadas) continuam funcionando sem quebra de compatibilidade.
- Contratos compartilhados em `packages/shared` serão atualizados caso novos campos por canal ou payloads de teste sejam adicionados no backend.
