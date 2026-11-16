# Feature Specification: Envio de Lista de Campanha Limitado por Troncos de Saída

**Feature Branch**: `002-campaign-trunk-dialer`  
**Created**: 2026-11-15  
**Status**: Draft  
**Input**: User description: "a campanha deve carregar uma lista de contatos, e esses contatos sao enviados para o modulo de discagem. a quantidade de registros enviados depende da quantidade de troncos de saida disponiveis"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Carga da lista e envio inicial dimensionado pelos troncos disponíveis (Priority: P1)

Com os troncos de saída e os parâmetros de capacidade previamente definidos pelo **Gestor**, um usuário autorizado inicia uma campanha vinculada a uma lista de contatos. Ao iniciar a campanha, o sistema carrega os contatos elegíveis da lista e envia para o módulo de discagem apenas uma quantidade de registros compatível com os troncos de saída disponíveis naquele momento, sem que o **Operador** escolha ou altere a quantidade ou seleção de troncos.

**Why this priority**: É o fluxo central pedido pelo usuário — conectar a lista de contatos da campanha ao módulo de discagem respeitando dinamicamente a capacidade real de saída definida e governada pelo Gestor.

**Independent Test**: Pode ser testado de forma independente com uma campanha vinculada a uma lista de 20 contatos elegíveis quando houver 3 troncos de saída disponíveis configurados pelo Gestor: ao iniciar a campanha (inclusive por um Operador, sem acesso à escolha de troncos), exatamente 3 contatos são enviados inicialmente ao módulo de discagem enquanto os 17 restantes permanecem na fila da campanha aguardando liberação.

**Acceptance Scenarios**:

1. **Given** uma campanha configurada com uma lista de 50 contatos elegíveis e 4 troncos de saída disponíveis no início (definidos pelo Gestor), **When** a campanha é iniciada, **Then** o sistema carrega a lista completa em sua fila de trabalho e envia exatamente 4 registros para o módulo de discagem (no padrão `1x`).
2. **Given** uma campanha com 20 contatos elegíveis e apenas 2 troncos de saída disponíveis (porque outros troncos estão ocupados em ligações ativas ou inativos), **When** a campanha é iniciada, **Then** somente 2 registros são enviados ao módulo de discagem e os demais permanecem pendentes em ordem sem gerar falhas por excesso de chamadas.
3. **Given** uma lista de contatos associada à campanha onde parte dos contatos está bloqueada, sem telefone válido ou já concluída em tentativa anterior, **When** a campanha carrega a lista, **Then** apenas contatos elegíveis entram na fila de discagem e a campanha informa claramente quantos contatos foram carregados vs. ignorados.

---

### User Story 2 - Reposição contínua conforme troncos ficam disponíveis e pausa automática sem troncos (Priority: P2)

Durante a execução da campanha, sempre que uma ligação termina e libera um tronco de saída, a campanha detecta a nova disponibilidade e envia o próximo contato pendente da lista para o módulo de discagem até que toda a fila seja percorrida ou que a campanha seja pausada/encerrada. Se não houver nenhum tronco disponível no momento, a campanha aguarda sem enviar novos registros e retoma automaticamente quando um tronco ficar livre.

**Why this priority**: Sem reposição progressiva e espera segura quando há zero capacidade, listas maiores que o número de troncos ficariam paradas ou perderiam contatos.

**Independent Test**: Pode ser testado iniciando uma campanha com 6 contatos e 2 troncos disponíveis: os 2 primeiros são discados; ao encerrar 1 chamada, o 3º contato é enviado automaticamente; quando todos os troncos ficam indisponíveis (0 livres), nenhum contato adicional é enviado até que pelo menos 1 tronco retorne ao estado disponível.

**Acceptance Scenarios**:

1. **Given** uma campanha em execução com 10 contatos pendentes na fila e 2 troncos ocupados por chamadas da própria campanha, **When** 1 chamada é encerrada e libera 1 tronco, **Then** a campanha envia imediatamente 1 novo contato pendente para o módulo de discagem mantendo 2 chamadas ativas no máximo.
2. **Given** uma campanha com contatos pendentes na fila e 0 troncos de saída disponíveis no momento (todos ocupados, desativados ou fora do ar), **When** o ciclo de envio verifica a capacidade, **Then** nenhum registro é enviado ao módulo de discagem e os contatos pendentes permanecem intactos na fila aguardando capacidade.
3. **Given** uma campanha que estava aguardando liberação de troncos e 3 troncos ficam disponíveis, **When** a disponibilidade é detectada e a campanha ainda está ativa dentro da janela permitida, **Then** até 3 novos registros são enviados ao módulo de discagem.

---

### User Story 3 - Governança de troncos pelo Gestor e visibilidade da fila em tempo real (Priority: P3)

O **Gestor** é o único responsável por definir os troncos de saída elegíveis e a política de capacidade/multiplicador da campanha; o **Operador** não escolhe nem altera a quantidade ou seleção de troncos. Ambos conseguem acompanhar em tempo real, na tela da campanha, quantos contatos foram carregados da lista, quantos já foram enviados ao módulo de discagem, quantos aguardam na fila por falta de tronco livre e quantos troncos de saída estão disponíveis naquele instante para a campanha.

**Why this priority**: Garante governança centralizada pelo Gestor sobre os recursos de telefonia (evitando que Operadores alterem limites ou alocação de troncos) e oferece transparência operacional para acompanhar o ritmo de discagem.

**Independent Test**: Pode ser testado autenticando-se como **Gestor** para definir os troncos/parâmetros da campanha e como **Operador** para verificar que os controles de seleção/quantidade de troncos e multiplicador não são editáveis pelo Operador, enquanto os contadores de carregados, em discagem, aguardando e troncos disponíveis aparecem atualizados para ambos.

**Acceptance Scenarios**:

1. **Given** um **Operador** acessando a criação, edição ou acompanhamento de uma campanha, **When** ele visualiza a seção de telefonia/capacidade de envio, **Then** o sistema não permite escolher nem alterar a quantidade ou seleção de troncos de saída nem o multiplicador da campanha, exibindo a configuração definida pelo Gestor apenas para consulta.
2. **Given** uma campanha ativa com fila em andamento, **When** o **Gestor** ou o **Operador** visualiza os detalhes da campanha, **Then** o sistema exibe de forma clara o total carregado da lista, os contatos em andamento no módulo de discagem, os pendentes aguardando tronco e os troncos disponíveis para a campanha.
3. **Given** um tronco de saída que cai ou tem sua configuração/quantidade alterada pelo **Gestor** durante a campanha, **When** a equipe consulta o painel da campanha, **Then** o indicador reflete imediatamente a alteração nos troncos disponíveis e mostra quantos contatos permanecem aguardando liberação de troncos.

---

### Edge Cases

- O que acontece quando uma campanha é iniciada com uma lista de contatos vazia ou sem nenhum contato com telefone elegível? A campanha não envia registros e sinaliza o motivo de conclusão/bloqueio ao operador.
- O que acontece quando múltiplas campanhas ativas disputam os mesmos troncos de saída ao mesmo tempo? O envio agregado das campanhas respeita a disponibilidade real dos troncos para evitar estouro da capacidade total, distribuindo novos envios apenas dentro das vagas livres.
- O que acontece se um contato for bloqueado (ex.: pedido de não perturbe) enquanto ainda aguardava na fila de espera por tronco? Antes de enviar o registro para o módulo de discagem, sua elegibilidade deve ser revalidada para que contatos recém-bloqueados não sejam discados.
- O que acontece se a campanha for pausada ou encerrada pelo operador enquanto há contatos pendentes na fila aguardando troncos? Novos envios para o módulo de discagem são interrompidos imediatamente, mantendo os registros não enviados preservados caso a campanha seja retomada (se pausada).
- O que acontece quando o módulo de discagem rejeita temporariamente um envio por ocupação momentânea de canal? O contato não é perdido nem marcado como concluído com sucesso; ele volta ao controle de reenvio/fila respeitando as regras da campanha.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST carregar todos os contatos elegíveis da lista vinculada à campanha ao iniciá-la, preservando a lista ordenada como fila de trabalho da campanha.
- **FR-002**: O sistema MUST calcular continuamente a quantidade de troncos de saída disponíveis antes de enviar registros da fila da campanha para o módulo de discagem.
- **FR-003**: O sistema MUST enviar ao módulo de discagem, em cada ciclo ou liberação, uma quantidade de registros que nunca exceda a cota calculada para a campanha com base nos troncos de saída disponíveis e no multiplicador configurado na campanha, nem a quantidade de contatos elegíveis pendentes na fila.
- **FR-004**: O sistema MUST calcular a capacidade disponível somando as vagas livres nos troncos de saída elegíveis (capacidade de chamadas simultâneas do tronco — padrão de 1 ligação simultânea por tronco quando não especificada — menos chamadas ativas em andamento nesses troncos) e aplicando um multiplicador/taxa de envio configurável exclusivamente pelo **Gestor** na campanha (padrão `1x`, permitindo ajuste pelo Gestor quando houver necessidade de overdial).
- **FR-005**: O sistema MUST permitir exclusivamente ao **Gestor** (e perfis administrativos equivalentes) selecionar ou limitar na configuração da campanha quais troncos de saída serão utilizados; quando nenhum tronco específico for selecionado (modo automático), o sistema MUST utilizar automaticamente todos os troncos de saída ativos e online disponíveis no workspace.
- **FR-006**: O sistema MUST contabilizar ocupações correntes de troncos geradas por chamadas ainda ativas (sejam da própria campanha, de outras campanhas ou discagens manuais) ao apurar quantos troncos estão livres.
- **FR-007**: Quando a quantidade de troncos de saída disponíveis for zero, o sistema MUST manter os contatos restantes na fila da campanha sem descartá-los e retomar o envio automaticamente assim que pelo menos um tronco elegível voltar a ficar disponível.
- **FR-008**: O sistema MUST revalidar a elegibilidade do contato (bloqueio/não-perturbe, validade do telefone, janela horária e status ativo da campanha) no momento efetivo de envio ao módulo de discagem.
- **FR-009**: O sistema MUST garantir que um mesmo contato não seja enviado em duplicidade simultânea para o módulo de discagem pela mesma campanha enquanto houver uma tentativa em andamento.
- **FR-010**: O sistema MUST pausar imediatamente novos envios da fila para o módulo de discagem caso a campanha seja pausada ou encerrada por usuário autorizado, preservando os contatos ainda não discados quando em pausa.
- **FR-011**: O sistema MUST exibir no acompanhamento da campanha a quantidade de contatos carregados, enviados/em discagem, aguardando na fila e os troncos disponíveis contabilizados para a campanha.
- **FR-012**: O sistema MUST impedir que usuários com perfil **Operador** escolham, editem ou alterem a quantidade de troncos, a seleção de troncos ou o multiplicador de discagem da campanha, restringindo essas configurações ao **Gestor** (mantendo visualização somente leitura para o Operador).

### Key Entities *(include if feature involves data)*

- **Campanha**: Iniciativa de contato ativa, pausada ou rascunho vinculada a uma lista/público, a um fluxo de atendimento por voz e às suas configurações de envio definidas pelo Gestor (seleção opcional de troncos de saída e multiplicador/taxa de discagem).
- **Lista de Contatos (Fila da Campanha)**: Conjunto de contatos elegíveis carregados para discagem pela campanha, mantendo situação por registro (pendente, enviado ao discador, em ligação, concluído ou ignorado por inelegibilidade).
- **Tronco de Saída**: Recurso de saída telefônica do ambiente com estado operacional (ativo, registrado/online, inativo ou ocupado) e capacidade de canais simultâneos (padrão 1) que define o limite base de envios paralelos suportados.
- **Envio de Discagem (Tentativa)**: Solicitação individual enviada pela campanha ao módulo de discagem para conectar um contato específico através de um tronco de saída disponível.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos envios realizados por uma campanha ao módulo de discagem respeitam em qualquer instante a cota derivada dos troncos de saída disponíveis e do multiplicador configurado na campanha (zero ocorrências de disparos acima da cota calculada no momento do envio).
- **SC-002**: Quando há contatos elegíveis na fila e ao menos 1 tronco é liberado após o término de uma chamada, o próximo registro pendente é enviado ao módulo de discagem em até 5 segundos, mantendo a ocupação próxima a 100% dos troncos disponíveis enquanto houver fila e janela ativa.
- **SC-003**: 100% dos contatos de uma lista maior que a quantidade de troncos (por exemplo, 500 contatos para 5 troncos) permanecem rastreados e são processados sem perda ou duplicidade simultânea após variações temporárias para zero troncos livres.
- **SC-004**: Gestores e Operadores conseguem visualizar na tela da campanha, com atraso máximo de 5 segundos, a proporção entre contatos carregados, em discagem, aguardando tronco e troncos disponíveis, sendo que 100% das alterações de seleção/quantidade de troncos ficam bloqueadas para perfis de Operador.

## Assumptions

- Cada campanha utiliza o módulo de discagem de voz já existente na plataforma para originar as chamadas de saída.
- A campanha já possui mecanismos de seleção de lista/mailing, agente de voz e janelas horárias de operação configuráveis no sistema.
- Quando uma campanha compete por troncos com discagens simultâneas no mesmo ambiente, a ocupação compartilhada deve ser respeitada de forma justa (por ordem de chegada/fila de eventos) até que haja definição específica de prioridade, caso necessária no futuro.
- Contatos que não atendem ou recebem sinal de ocupado seguem as regras de retentativa ou encerramento configuradas na estratégia da campanha, liberando imediatamente o tronco para o próximo registro da fila.
