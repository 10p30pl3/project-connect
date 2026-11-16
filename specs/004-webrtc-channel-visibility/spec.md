# Feature Specification: Visibilidade, Cadastro e Operação do Canal WebRTC (Web & WhatsApp Calling)

**Feature Branch**: `004-webrtc-channel-visibility`  

**Created**: 2026-11-15  

**Status**: Draft  

**Input**: User description: "verificar e adicionar novo canal webrtc, ja esta criado porem nao aparece" (Clarificações: Q1-A — provisionar automaticamente + manter criação manual em "+ Novo canal"; Q2-A — tipo próprio `WEBRTC`, visível e gerenciável em Canais para **Web (Widget/Navegador)** e **WhatsApp Calling**, sem poluir seletores de campanhas/jornadas outbound).

## Clarifications

### Session 2026-11-15

- Q: Qual nível de integração para WhatsApp Calling deve fazer parte desta feature no canal WebRTC? → A: Implementação completa ponta a ponta (exibir e cadastrar o canal WEBRTC, receber webhooks de chamadas do WhatsApp Cloud API, realizar troca de SDP com a Meta e conectar a chamada ao agente de voz no gateway).
- Q: No modo WhatsApp Calling deste canal WebRTC, quais direções de chamada de voz devem ser suportadas? → A: Apenas chamadas receptivas via WhatsApp (cliente liga pelo WhatsApp da empresa → webhook da Meta → gateway WebRTC → agente IA atende), além do Web Widget.
- Q: Qual deve ser o estado inicial do canal WebRTC provisionado automaticamente em workspaces novos e existentes? → A: Nascer Ativo imediatamente para Web Widget (usando o agente padrão da telefonia caso exista), com WhatsApp Calling opcional até o preenchimento das credenciais Meta.
- Q: Como deve funcionar a autenticação e a seleção de canal quando o Web Voice Widget for incorporado fora do portal? → A: Widget público com chave pública por canal no snippet (mais lista opcional de domínios/origens permitidas e rate-limit por IP), conectando visitantes externos diretamente ao agente daquele canal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exibir e Cadastrar o Canal WebRTC na Lista de Canais (Priority: P1)

Um administrador ou supervisor acessa **Configuração → Canais** para visualizar os canais de comunicação disponíveis no workspace e adicionar novos canais WebRTC. Atualmente, embora a capacidade técnica de chamadas via WebRTC (áudio no navegador / widget web) já exista na plataforma, ela aparece apenas como um cartão técnico informativo separado e **não** consta como canal gerenciável na lista principal de canais nem entre as opções ao clicar para cadastrar um novo canal.

Com esta entrega, todo workspace (novo ou existente) passa a exibir automaticamente o canal WebRTC pré-provisionado na lista de **Configuração → Canais**, e o usuário também pode criar canais WebRTC adicionais (por exemplo, um para o site/widget institucional e outro dedicado a **WhatsApp Calling**) por meio do botão **"+ Novo canal"**.

**Why this priority**: Resolve diretamente o bloqueio reportado pelo usuário: o canal WebRTC passa a ser visível na listagem principal de **Configuração → Canais** e cadastrável no fluxo padrão de criação de canais para atendimento Web e WhatsApp Calling.

**Independent Test**: Abrir **Configuração → Canais**, confirmar que o canal WebRTC já aparece na lista principal com tipo próprio (`WebRTC`), status, provedor e agente vinculado; em seguida abrir **"+ Novo canal"**, selecionar **WebRTC (Web & WhatsApp Calling)**, criar um segundo canal WebRTC e confirmar que ambos aparecem nos cartões e na tabela com ações de edição, habilitação/desabilitação e exclusão.

**Acceptance Scenarios**:

1. **Given** um workspace novo ou já existente ao acessar **Configuração → Canais**, **When** a listagem de canais é carregada, **Then** um canal do tipo próprio **WebRTC** já aparece provisionado e **Ativo** para **Web Widget** na lista principal (vinculado ao agente padrão de telefonia do workspace quando existir, sem perda de nenhum canal pré-existente e com WhatsApp Calling opcional até preenchimento das credenciais Meta).
2. **Given** um administrador na tela **Configuração → Canais**, **When** abre o formulário de adição de novo canal e escolhe o provedor/tipo **WebRTC**, **Then** o formulário seleciona automaticamente o tipo de canal próprio **WebRTC** e pré-preenche configurações padrão compatíveis (uso Web Widget / WhatsApp Calling), permitindo cadastrar um novo canal em segundos sem digitar URLs internas manualmente.
3. **Given** um canal WebRTC cadastrado em **Configuração → Canais**, **When** o usuário edita o canal ou alterna seu status ativo/inativo, **Then** as alterações são persistidas imediatamente e o estado do canal é atualizado tanto na visualização em blocos quanto em tabela.

---

### User Story 2 - Vinculação de Agente de Voz, Web Widget e WhatsApp Calling no Canal WebRTC (Priority: P2)

Ao gerenciar o canal WebRTC na tela **Canais**, o usuário precisa vincular facilmente qual agente de voz atenderá às chamadas recebidas via **Web (navegador/widget)** ou **WhatsApp Calling**, escolher ou visualizar a finalidade do canal (Web, WhatsApp Calling ou ambos), copiar o código de incorporação do widget web associado e visualizar a prontidão do ambiente (como exigência de HTTPS para microfone em acessos externos).

**Why this priority**: Consolida em um único canal gerenciável tanto o atendimento de áudio via navegador (Widget Web) quanto a entrada de chamadas de voz pelo WhatsApp Calling, evitando que a configuração fique dividida em cartões técnicos estáticos ou telas sem vínculo de agente.

**Independent Test**: Abrir um canal WebRTC em **Configuração → Canais**, vincular um agente de voz do workspace, preencher os dados de **WhatsApp Calling** (quando aplicável), copiar o snippet do widget e a URL do webhook exibidos no canal e confirmar que tanto chamadas Web Widget quanto eventos de chamada recebida da Meta são roteados ao agente de voz selecionado.

**Acceptance Scenarios**:

1. **Given** um canal WebRTC na listagem principal de **Configuração → Canais**, **When** o usuário abre o seletor de **Agente de voz**, **Then** visualiza todos os agentes de voz ativos do workspace e pode vincular ou alterar o agente responsável pelo canal, sendo bloqueada qualquer tentativa de associar agente de outro workspace.
2. **Given** um canal WebRTC cadastrado com suporte a **Web & WhatsApp Calling**, **When** o usuário visualiza ou edita os detalhes do canal, **Then** consegue escolher o modo de operação (**Web Widget**, **WhatsApp Calling** ou **Ambos**), configurar opcionalmente origens/domínios permitidos e credenciais do número WhatsApp Business, copiar o snippet único do widget (com chave pública vinculada ao canal) e verificar o indicador de ambiente seguro (`HTTPS Pronto` vs `Requer HTTPS (Microfone)`) diretamente no canal.
3. **Given** um visitante acessando um site externo que incorporou o snippet público de um canal WebRTC ativo (em origem permitida, quando configurada), **When** o visitante inicia a chamada pelo widget sem estar logado no portal, **Then** a plataforma valida a chave pública do canal, emite sessão temporária limitada (rate-limit por IP) e conecta o visitante diretamente ao agente de voz daquele canal específico.
4. **Given** um canal WebRTC ativo com modo **WhatsApp Calling** configurado e agente de voz vinculado, **When** um cliente liga pelo WhatsApp e a Meta envia o webhook de chamada recebida com oferta de mídia (SDP) para o canal, **Then** a plataforma autentica o webhook, negocia a resposta de mídia junto ao gateway de voz, devolve a aceitação da chamada à Meta e conecta o chamador em tempo real ao agente de voz vinculado (registrando duração, transcrição e eventos da sessão). Escopo desta entrega contempla atendimento **receptivo** no WhatsApp Calling (sem originar chamadas ativas pela plataforma para contatos WhatsApp).

---

### User Story 3 - Isolamento nos Seletores de Campanhas e Jornadas Outbound + Modo Básico (Priority: P3)

Usuários no Modo Básico e no Modo Avançado acessam **Configuração → Canais** e também utilizam os assistentes de **Nova campanha** e **Jornadas** para disparos em lote (outbound). Como o canal WebRTC destina-se ao atendimento de áudio em tempo real via **Web e WhatsApp Calling** (tipo próprio `WEBRTC`), ele deve permanecer totalmente visível e gerenciável em **Configuração → Canais** em ambos os modos (Básico e Avançado), porém **não** deve poluir os seletores de canais de disparo em lote de **Jornadas** e **Nova campanha → Canal simples**.

**Why this priority**: Mantém a organização limpa das etapas de disparo outbound (evitando que operadores selecionem o canal WebRTC/Widget achando ser um tronco SIP de disparo em massa), enquanto garante acesso total ao canal WebRTC em **Canais** para usuários do Modo Básico e Avançado.

**Independent Test**: Com um canal WebRTC ativo em **Configuração → Canais**, alternar entre Modo Básico e Modo Avançado: confirmar que em **Configuração → Canais** o canal WebRTC aparece normalmente para gestão em ambos os modos, e confirmar que em **Nova campanha → Acionamento → Canal simples** e em **Jornadas** são listados apenas os canais de disparo outbound (`Voz`, `WhatsApp`, `SMS`, `E-mail`), sem incluir `WEBRTC`.

**Acceptance Scenarios**:

1. **Given** um usuário operando no **Modo Básico** ou no **Modo Avançado**, **When** acessa **Configuração → Canais**, **Then** enxerga os canais `WEBRTC` com interface de alta densidade e explicações apenas em tooltips `(?)`.
2. **Given** ao menos um canal `WEBRTC` ativo em **Configuração → Canais**, **When** o usuário abre **Jornadas** ou **Nova campanha → Acionamento** (em Modo Básico ou Avançado), **Then** os seletores de canais de campanha exibem exclusivamente os canais elegíveis para envio outbound, não exibindo o canal `WEBRTC`.

---

### Edge Cases

- **Workspaces já existentes após atualização**: Ao aplicar a atualização em um ambiente já em produção, workspaces existentes recebem o canal WebRTC padrão automaticamente de forma idempotente (apenas se ainda não houver um canal WebRTC naquele workspace), sem duplicar registros em execuções repetidas e sem alterar nenhum canal já cadastrado.
- **Ausência de agentes de voz cadastrados**: Se o workspace ainda não tiver nenhum agente de voz criado, o canal WebRTC ainda pode ser exibido e cadastrado com vínculo de agente pendente/padrão, orientando via badge ou seletor a escolha assim que um agente for criado.
- **Acesso em ambiente HTTP sem TLS**: Quando o portal está acessível fora de `localhost` sem HTTPS, o canal WebRTC continua visível e configurável, sinalizando claramente a necessidade de HTTPS para captura de microfone no navegador.
- **Consolidação visual em Canais**: Evitar que o usuário veja um cartão informativo isolado duplicando o canal WebRTC real; informações úteis de incorporação (tag do widget, endpoint WebRTC e indicação WhatsApp Calling) devem estar integradas à experiência do canal WebRTC na lista de Canais.
- **Exclusão e recriação**: Caso o usuário exclua o canal WebRTC padrão do workspace, ele pode criar novos canais WebRTC livremente usando **"+ Novo canal"** sem que o sistema recrie o registro excluído à força após a carga inicial.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST reconhecer **WebRTC (`WEBRTC`)** como um tipo de canal próprio de primeira classe na plataforma, distinto de `Voz (SIP/Discador)`, `WhatsApp (Mensagens)`, `SMS` e `E-mail`, destinado a áudio em tempo real via **Web (navegador/widget)** e **WhatsApp Calling**.
- **FR-002**: O sistema MUST provisionar automaticamente um canal `WEBRTC` padrão já **Ativo** para **Web Widget** (vinculado ao agente padrão da telefonia quando disponível, com **WhatsApp Calling** opcional até configuração das credenciais Meta) na criação de novos workspaces e via migração idempotente para workspaces já existentes que ainda não possuam nenhum canal `WEBRTC`.
- **FR-003**: O sistema MUST incluir **WebRTC (Web & WhatsApp Calling)** como opção oficial no diálogo de cadastro **"+ Novo canal"** em **Configuração → Canais**, pré-preenchendo valores iniciais compatíveis para que o cadastro exija apenas confirmação de nome, finalidade (Web / WhatsApp Calling / Ambos) e agente de voz opcional.
- **FR-004**: O sistema MUST exibir os canais `WEBRTC` na listagem principal de **Configuração → Canais** (em blocos e em tabela), mostrando rótulo identificador (`WebRTC`), provedor/finalidade (**Web & WhatsApp Calling**), agente vinculado, status (`Ativo`/`Inativo`) e ações de habilitar/desabilitar, editar, vincular agente e excluir.
- **FR-005**: Cada canal `WEBRTC` MUST permitir vincular um agente de voz ativo do próprio workspace, validando estritamente o pertencimento ao workspace e rejeitando agentes de outros workspaces.
- **FR-006**: O sistema MUST apresentar de forma integrada no canal `WEBRTC` os recursos operacionais do canal — vínculo rápido de agente, modo de atendimento (**Web Widget**, **WhatsApp Calling** ou **Ambos**), chave pública exclusiva do canal no snippet incorporável (com suporte a lista opcional de domínios/origens permitidas, validação de origem e rate-limit por IP para visitantes externos sem login), configuração segura de número/credenciais WhatsApp Business quando aplicável, cópia rápida do snippet / URL de webhook e indicador de prontidão HTTPS para microfone — consolidando o antigo bloco estático informativo para evitar duplicidade visual.
- **FR-007**: Quando o modo **WhatsApp Calling** estiver habilitado no canal `WEBRTC`, o sistema MUST receber webhooks de chamadas **receptivas** do WhatsApp Cloud API (validando assinatura/token da Meta), processar a oferta de áudio WebRTC (SDP) no gateway de voz conectado ao agente de voz vinculado ao canal e responder à API da Meta para estabelecer e encerrar a chamada em tempo real (chamadas ativas outbound via WhatsApp ficam fora deste escopo).
- **FR-008**: Os seletores de criação de **Jornadas** e **Nova campanha → Acionamento (`Canal simples` / etapas)** MUST exibir apenas canais de disparo outbound (`VOICE`, `WHATSAPP`, `SMS`, `EMAIL`), mantendo o canal de tipo `WEBRTC` restrito à gestão de atendimento interativo Web / WhatsApp Calling em **Configuração → Canais** (e demais superfícies de telefonia/atendimento interativo).
- **FR-009**: A interface do canal `WEBRTC` MUST seguir o princípio de alta densidade UI, movendo quaisquer explicações conceituais para tooltips `(?)` em português (`pt-BR`) sem parágrafos explicativos longos no corpo dos cartões, respeitando permissões por perfil e funcionando tanto no **Modo Básico** quanto no **Modo Avançado**.

### Key Entities *(include if feature involves data)*

- **Canal de Comunicação (`Connection`)**: Entidade de canal do workspace que passa a aceitar o tipo próprio `WEBRTC` (ao lado de `VOICE`, `WHATSAPP`, `SMS`, `EMAIL`), armazenando nome, provedor WebRTC, estado ativo/inativo, agente vinculado (`tenantId`) e metadados específicos do canal WebRTC.
- **Configuração WebRTC (`Web & WhatsApp Calling`)**: Conjunto de atributos operacionais vinculados ao canal WebRTC, incluindo modalidade suportada (`Web Widget`, `WhatsApp Calling` ou `Ambos`), chave pública do widget por canal, lista opcional de domínios/origens autorizados, credenciais mascaradas de WhatsApp Calling e requisitos de origem segura (HTTPS).
- **Agente de Voz (`Voice Agent`)**: Agente IA do mesmo workspace associado ao canal WebRTC para atender sessões de áudio originadas via navegador (Web Widget) ou WhatsApp Calling.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos workspaces (novos e existentes após atualização) exibem o canal WebRTC na listagem principal de **Configuração → Canais** imediatamente após abrir a página, sem necessidade de configuração manual prévia.
- **SC-002**: Um usuário consegue adicionar um novo canal WebRTC (para Web Widget, WhatsApp Calling ou ambos) e vincular um agente de voz em menos de 30 segundos pelo botão **"+ Novo canal"**, sem digitar URLs técnicas manualmente.
- **SC-003**: 100% dos seletores de disparo outbound em **Nova campanha** e **Jornadas** mantêm a lista focada em canais de campanha (`Voz`, `WhatsApp`, `SMS`, `E-mail`), sem exibir falsos canais WebRTC como opção de envio em massa.
- **SC-004**: Tentativas de vincular um agente de voz de outro workspace a um canal WebRTC são bloqueadas em 100% dos casos.

## Assumptions

- A infraestrutura subjacente de WebRTC no servidor de telefonia (sinalização SDP/ICE, proxy autenticado do portal e script Web Voice Widget) já existe; esta entrega integra essa capacidade ao catálogo real de canais e estende o fluxo de sinalização WebRTC para atender chamadas de **WhatsApp Business Calling** via Meta Cloud API.
- Credenciais privadas da Meta para WhatsApp Calling (segredo de assinatura `App Secret` e `Access Token` da Graph API) são armazenadas de forma segura e retornadas mascaradas na interface administrativa, nunca expostas em logs ou respostas públicas; o `Verify Token` utilizado exclusivamente no desafio de cadastro do webhook no painel Meta permanece copiável pelo administrador autenticado.
- Em produção externa (fora de `localhost`), navegadores continuam exigindo HTTPS para captura de microfone; o painel sinaliza esse estado sem bloquear a visualização ou edição do canal.
- Canais já existentes (`VOICE`, `WHATSAPP`, `SMS`, `EMAIL`) e fluxos já implantados de campanhas e telefonia permanecem intactos.
