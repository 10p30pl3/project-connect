Especificação para desenvolvimento das telas e da dinâmica de gestão de
listas e acionamentos. Versão 2.2, 24 de outubro de 2026. Destinatários:
Produto, UX, Engenharia, Integrações e QA da Voll Solutions.

A campanha é composta por mailing ou lista, jornada e template de
estratégia. As configurações avançadas pertencem exclusivamente à
estratégia. Este plano detalha as entidades, a operação, os controles,
os custos, os experimentos, a otimização e a observabilidade, com telas,
estados, integrações e critérios de aceite. O protótipo demonstra os
fluxos no navegador; a implementação de produção exige serviços
persistentes, processamento concorrente e conectores reais.

# 1 Decisões de produto e escopo

Nova campanha abre o assistente Preparar campanha. A sequência
obrigatória é Mailing, Público, Acionamento e Campanha. O nome e a
descrição da campanha são preenchidos apenas na revisão final. A
campanha só passa a existir após Salvar como pronta, Criar e iniciar ou
Criar e agendar. A seção 27 detalha o comportamento vigente e substitui
a ordem anterior do assistente. A jornada define o tipo de canal e a
Central de decisão vincula a conexão.

Usar somente os nomes Mailing, Lista, Contato, Tabulação, Jornada,
Estratégia, Campanha e Canal. Tipos de canal: Discador, WhatsApp, SMS e
E-mail. O transporte RCS pode ser configurado dentro da etapa de SMS
quando suportado pelo conector.

A versão publicada de uma estratégia é imutável. Uma campanha aponta
para o identificador e versão escolhidos e não armazena sobrescritas de
parâmetros. Trocar o template afeta novas entregas; uma tentativa em
andamento mantém a versão usada na reserva. Mudança de template não zera
contadores, remove DNC nem reabre inscrições concluídas.

Listas são views versionadas sobre um mailing. Sua modalidade pode ser
fotografia da base ou dinâmica. A modalidade pertence à lista e fica
identificada na campanha; a campanha não altera os filtros da lista.
Regras globais de bloqueio e limites institucionais sempre prevalecem.

O primeiro escopo produtivo inclui execução persistente, elegibilidade
explicável, reserva exclusiva, resultados idempotentes, contadores
compartilhados, telefones adicionais, agendamento de retorno,
modalidades de lista e indicadores operacionais. A Central de decisão
demonstra testes A/B, custos e recomendações consultivas. A execução
produtiva desses recursos, o treinamento automático de modelos e a
otimização autônoma de orçamento exigem serviços próprios e validação.

## 1 1 O que foi incorporado ao protótipo

  -----------------------------------------------------------------------
  **Conceito**      **Tela            **Interação       **Dependência de
                    navegável**       demonstrada**     produção**
  ----------------- ----------------- ----------------- -----------------
  C01 Elegibilidade Campanha, abas    Reservar, simular Banco
  e reservas        Visão geral e     envio e retorno,  transacional,
                    Elegibilidade e   expirar reserva e workers,
                    reservas          reconciliar       conectores e
                                                        idempotência
                                                        distribuída

  C02 Contadores    Contato e         Histórico         Ledger durável,
  compartilhados    Estratégia,       importado         carga histórica
                    Tentativas        separado dos      datada e
                                      novos envios;     atomicidade
                                      limites entre     
                                      campanhas         

  C03 Telefones e   Contato e         Adicionar e       Normalização,
  retorno           Estratégia,       validar telefone; calendário,
                    Telefones         agendar e         serviço de agenda
                                      cancelar retorno  e confirmação do
                                                        canal

  C04 Modalidades   Lista e Nova      Escolher          Atualização
  de lista          campanha, Base    modalidade,       incremental,
                                      publicar e        filas e
                                      simular novo      materialização de
                                      cliente no        membros
                                      mailing           

  C05 Indicadores   Campanha, Lista,  Agrupar           Eventos
                    Jornada e         tentativas, CPC,  produtivos,
                    Estratégia        conversões e      custos
                                      custo; exportar   conciliados e
                                      CSV               agregações por
                                                        versão

  C06 Propensão e   Contato e         Consultar origem, Pipeline de
  evidências        Estratégia,       evidências e      dados, registro e
                    Otimização        painel de         avaliação de
                                      validação         modelos
  -----------------------------------------------------------------------

O motor local usa um relógio de demonstração iniciado em 23 de outubro
de 2026 às 10h, com avanço manual de 15 minutos. A simulação automática
só progride enquanto a campanha está aberta no navegador. Não há
telefonia, mensagens, inteligência preditiva ou sincronização entre
dispositivos em execução real.

# 2 Entidades e responsabilidades

  -----------------------------------------------------------------------
  **Entidade**            **Responsabilidade**    **Relações e
                                                  persistência**
  ----------------------- ----------------------- -----------------------
  Contato                 Identidade persistente  Chave única por
                          do cliente, campos,     workspace e
                          destinos e histórico    identificador externo;
                                                  pode estar em várias
                                                  cargas e campanhas

  Mailing                 Carga original de       Versões de carga,
                          clientes e campos de    origem e registros;
                          negócio                 reimportação não apaga
                                                  o contato

  Lista                   Critérios de seleção,   Mailing de origem,
                          ordenação e modalidade  versão de filtros e
                          de atualização          membros ou regra de
                                                  atualização

  Tabulação               Descrever o resultado   Código estável, canais
                          de máquina ou humano    aplicáveis, identifica
                                                  CPC e vínculo com
                                                  tentativa

  Jornada                 Ordenar canais,         Versão publicada com
                          conteúdos, conexões e   etapas; nenhuma
                          esperas por feedback    política de retentativa
                                                  local

  Estratégia              Calendário, esforço,    Template versionado,
                          retentativas,           regras por tabulação e
                          elegibilidade e         política de destinos
                          tratamento de           
                          resultados              

  Campanha                Vincular base, jornada  Referências de versões,
                          e estratégia e          inscrições dos
                          controlar execução      clientes, estado e
                                                  indicadores

  Canal                   Configurar integração   Tipo, provedor,
                          de discador, WhatsApp,  identificador externo e
                          SMS ou e-mail           capacidades suportadas

  Inscrição               Estado de um contato na Uma por campanha,
                          campanha                contato e ciclo; etapa
                                                  atual, próxima
                                                  elegibilidade e término

  Tentativa               Unidade de acionamento  Reserva, envio,
                          ao destino              resultado, custo,
                                                  eventos e versões
                                                  usadas

  Retorno agendado        Compromisso de          Contato, campanha,
                          recontato solicitado    destino, horário,
                                                  origem e estado

  Evento                  Registro imutável de    Identificador único,
                          cada mudança ou retorno correlação, ocorrência,
                                                  recebimento e metadados
  -----------------------------------------------------------------------

O mailing pode conter múltiplos contratos do mesmo cliente. A reserva e
os limites por cliente usam contact_id; os dados e o resultado de
negócio podem continuar associados a contrato ou título. Não deduplicar
contratos diferentes pelo telefone. A identidade contratual é uma
decisão de integração a formalizar no mapeamento da carga.

# 3 Mapa das telas

  -----------------------------------------------------------------------
  **Tela**          **Entrada**       **Elementos e     **Saída**
                                      ações**           
  ----------------- ----------------- ----------------- -----------------
  T01 Contatos      Menu Contatos,    Campos de todas   Abrir detalhe sem
                    busca por nome ou as cargas, score, alterar o vínculo
                    ID                CPC, spam, sem    às campanhas
                                      contato,          
                                      tentativas, DNC e 
                                      dez últimas       
                                      tabulações        

  T02 Detalhe do    Abrir contato ou  Telefones,        Modais de
  contato           Ver cliente na    contadores,       destino, agenda e
                    campanha          retorno agendado, validação
                                      evidências do     
                                      score e histórico 

  T03 Lista         Menu Listas, Nova Prompt, critérios Publicar versão e
                    lista ou Abrir    interpretados,    usar na campanha
                    lista             filtros,          
                                      ordenação,        
                                      modalidade e      
                                      prévia            

  T04 Estratégia    Menu Estratégias, Dez grupos de     Template
                    Configurar ou     configuração      selecionável em
                    Criar cópia       avançada, regras  campanhas
                                      e publicação      

  T05 Nova campanha Botão Nova        Quatro passos com Pronta ou Em
                    campanha          base, modalidade  execução
                                      informada,        
                                      jornada e         
                                      estratégia        

  T06 Campanha em   Clique no nome da Clientes,         Consulta de
  operação          campanha          destinos, canal,  contato e
                                      status, tentativa evolução de
                                      e atualização;    tentativa
                                      pausa e retomada  

  T07 Elegibilidade Aba da campanha   Contagem por      Explicar seleção,
  e reservas                          motivo, fila de   reserva e
                                      clientes, destino bloqueio
                                      escolhido e       
                                      próxima ação      

  T08 Indicadores   Aba da campanha e Agrupamento por   Análise de
                    botões nas        lista, jornada ou esforço, CPC,
                    bibliotecas       estratégia e      conversão e custo
                                      exportação        

  T09 Canais        Menu Canais       Tipo, nome, URL,  Conexão
                                      protocolo,        disponível para
                                      capacidades e     etapas de jornada
                                      teste             
  -----------------------------------------------------------------------

Em produção, tabelas devem ter paginação pelo servidor, busca com atraso
curto de digitação e filtros preservados ao atualizar. Mudanças em linha
não podem tirar o foco do usuário. Exibir última sincronização, conexão
perdida e opção de reconectar. O protótipo limita amostras e usa
armazenamento do navegador.

# 4 C01 Elegibilidade e reserva de contatos

## 4 1 Objetivo e experiência

Servir somente contatos autorizados e disponíveis, impedindo duas
tentativas simultâneas não planejadas para o mesmo cliente. T07 explica
o motivo primário de cada exclusão e pode expandir todos os motivos
avaliados. T06 apresenta as tentativas em andamento, preservando o
acesso ao cliente e ao histórico.

A tabela de T07 contém cliente, ID, canal previsto, destino escolhido,
elegibilidade, contadores aplicados, próxima data elegível e versão da
política. Os cartões mostram membros da base, elegíveis agora, reservas
e reconciliações. Os totais devem derivar da mesma consulta e instante
lógico, sem misturar fotografia antiga com eventos atuais.

Configurar em T04, Distribuição e integração: tamanho do lote, máximo
pendente, validade da reserva, prazo de retorno, confirmação de
recebimento e política de reconciliação. Configurar dias, horários e
fuso em Calendário. T07 permite consulta e ações operacionais
autorizadas, sem editar esses valores.

## 4 2 Dinâmica e ordem de avaliação

1.  Resolver a inscrição, a modalidade da lista e as versões de jornada
    e estratégia. Buscar os campos atuais necessários e as restrições
    globais.

2.  Avaliar DNC e bloqueios obrigatórios, identidade válida, destino
    permitido e inscrição não encerrada. Registrar reason_codes estáveis
    para cada negativa.

3.  Verificar reserva, envio ou reconciliação existentes para o cliente
    em qualquer campanha do workspace. O padrão inicial é uma tentativa
    ativa por cliente.

4.  Verificar retorno agendado, prazo de retentativa, limites total e
    diário, janela móvel, teto por canal e por destino. Valores
    desconhecidos seguem a política explícita de histórico incompleto.

5.  Avaliar calendário e fuso, disponibilidade do canal e capacidade de
    entrega. Aplicar ordenação da lista e preferência por retorno
    agendado.

6.  Reservar inscrição e capacidade de contador na mesma transação. Uma
    segunda requisição concorrente recebe outro contato ou ausência de
    candidato, nunca o mesmo cliente reservado.

7.  Antes do envio, revalidar pausa, DNC, destino e validade da reserva.
    Confirmar aceitação do conector; registrar sent_at uma única vez e
    consumir os contadores correspondentes.

8.  Receber resultado correlacionado, normalizar tabulação e aplicar a
    versão da estratégia da tentativa. Finalizar, aguardar feedback,
    retentar, avançar etapa ou reconciliar.

Motivos mínimos: DNC, registro inválido, sem destino, histórico
incompleto, fora do calendário, retorno futuro, aguardando retentativa,
limite total, limite diário, limite móvel, canal esgotado, reserva
ativa, reconciliação, campanha pausada e fluxo encerrado.

## 4 3 Estados e transições

  -------------------------------------------------------------------------
  **Estado**        **Evento de       **Comportamento**   **Próxima
                    entrada**                             transição**
  ----------------- ----------------- ------------------- -----------------
  Elegível          Todas as          Pode disputar       Reservado
                    condições         capacidade          
                    satisfeitas                           

  Reservado         Seleção           Destino e versões   Enviado, liberado
                    transacional      congelados, sem     ou cancelado
                                      tentativa consumida 

  Enviado           Aceite do         Consome tentativa   Feedback,
                    conector          uma vez e aguarda   finalizado ou
                                      retorno             reconciliação

  Aguardando        Entrega técnica   Não implica CPC ou  Resposta, prazo
  feedback          confirmada        conversão           esgotado ou
                                                          bloqueio

  Reconciliação     Envio sem         Bloqueia novo envio Resultado
                    resultado         concorrente         confirmado, falha
                    confiável                             confirmada ou
                                                          resolução
                                                          autorizada

  Finalizado        Resultado         Fecha tentativa;    Nova
                    conclusivo        inscrição pode ter  elegibilidade ou
                                      próxima ação        término da
                                                          inscrição

  Liberado          Reserva expirou   Não consome         Nova seleção,
                    sem envio         tentativa           após revalidação

  Cancelado         Pausa ou DNC      Não executar        Reavaliação
                    antes de enviar   acionamento         permitida apenas
                                                          se a restrição
                                                          cessar
  -------------------------------------------------------------------------

Uma reserva expirada antes de enviar pode ser liberada. Se houve envio
ou dúvida sobre seu aceite, não liberar automaticamente para uma segunda
chamada. Consultar o conector ou exigir resolução. Prazo de feedback de
mensagem entregue é diferente de perda de confirmação técnica.

Pausar impede novas reservas e envios, mas mantém o recebimento e
processamento de resultados. Encerrar impede novas entregas e solicita
cancelamento do que ainda não foi enviado; chamadas já aceitas
permanecem rastreadas. Uma campanha só conclui automaticamente quando
não há inscrições acionáveis, tentativas pendentes ou retorno futuro.

## 4 4 Critérios de aceite

-   AC01: duas requisições concorrentes não reservam o mesmo cliente no
    mesmo workspace; capacidade de contador também é reservada
    atomicamente.

-   AC02: reserva não enviada que expira não incrementa tentativas nem
    custo.

-   AC03: DNC recebido após reservar impede envio e cancela retornos
    futuros. Resultado tardio não remove o bloqueio.

-   AC04: retorno repetido com o mesmo identificador não repete
    contagem, custo ou agendamento.

-   AC05: ausência de retorno após envio produz reconciliação e motivo
    visível na fila.

-   AC06: campanha pausada recebe resultados pendentes e não produz
    novos envios.

No protótipo, a exclusão ocorre em um ledger local com um único
processo. Atomicidade entre máquinas, disponibilidade contínua, execução
em segundo plano e reconciliação com provedor devem ser implementadas no
backend.

# 5 C02 Contadores compartilhados

## 5 1 Telas e parâmetros

T02 mostra histórico importado, novas tentativas da simulação, novas no
dia, campanhas com envio e detalhamento por canal e telefone. Em
produção, permitir consultar um período e distinguir tentativas,
contatos efetivos, mensagens entregues e CPC. Os valores desconhecidos
não devem aparecer como zero.

T04, Tentativas, concentra teto total, teto diário, janela móvel, teto
na janela, máximo por canal, máximo por telefone, intervalo mínimo e
escopo. O escopo pode ser cliente nesta campanha ou cliente no
workspace, subordinado a limites institucionais que não podem ser
afrouxados pelo template.

A configuração define quais resultados consomem indicadores
especializados. O contador de envio é distinto da classificação final: a
mesma tentativa pode gerar entregue, lida, resposta e CPC sem criar
quatro tentativas. Definir essas dimensões no catálogo de tabulações e
no normalizador de eventos.

## 5 2 Dinâmica

A chave do contador é formada por workspace, cliente e dimensões da
regra, como canal ou destino. Manter eventos de consumo e projeções para
total, dia operacional e intervalo móvel. Guardar timestamps em UTC e
calcular fronteiras diárias no fuso efetivo da política.

Na reserva, separar capacidade provisória dos consumos confirmados. Ao
receber aceite de envio, converter a capacidade em consumo. Na liberação
sem envio, devolver a capacidade. Isso impede que duas campanhas
ultrapassem um teto ao mesmo tempo.

Trocar estratégia ou versão não zera contadores. Um limite novo é
aplicado sobre o histórico existente. Se o total já supera o novo teto,
o cliente fica inelegível até o contador temporal expirar ou até
resolução autorizada para regra não institucional.

O histórico importado deve trazer contagem, período, data de referência,
origem e cobertura conhecida. Um acumulado sem timestamp pode informar
esforço total, mas não pode ser distribuído artificialmente pelos dias.
Caso não exista cobertura suficiente para uma regra obrigatória, a
política padrão é aguardar revisão. A alternativa de usar somente o
histórico conhecido deve estar explícita e depender da política global.

## 5 3 Exemplo e aceite

Exemplo: duas campanhas compartilham teto diário de três envios para o
mesmo cliente. Com dois consumos confirmados e uma reserva ativa, outra
campanha não obtém nova reserva. Se a reserva for liberada sem envio,
uma vaga volta a existir. Se for enviada, o total do dia permanece três,
independentemente do número de eventos retornados.

-   AC07: duas campanhas e dois canais consomem o mesmo teto
    compartilhado quando essa é a regra efetiva.

-   AC08: uma atualização de resultado da mesma tentativa não incrementa
    o contador de envio.

-   AC09: virada do dia usa o fuso configurado; a janela móvel usa o
    instante de cada envio.

-   AC10: reimportação e mudança de template não reiniciam histórico ou
    capacidade reservada.

-   AC11: histórico incompleto mostra origem e motivo de bloqueio;
    ausência não é convertida em zero.

O protótipo separa acumulado importado de envios locais e conta as novas
tentativas por data do relógio de demonstração. Não representa uma carga
histórica completa ou um controle distribuído.

# 6 C03 Telefones adicionais e retorno agendado

## 6 1 Dados e tela de destinos

T02 contém Gerenciar telefones. Cada destino possui identificador,
número normalizado, tipo, prioridade, validade, bloqueio, origem, data
de verificação e histórico próprio. O protótipo permite adicionar
destinos e marcar validade. Em produção, edição deve auditar valor
anterior, autor e motivo, sem apagar eventos do número antigo.

Normalizar para formato internacional e armazenar número como texto. Não
aceitar notação científica, número vazio ou duplicado no mesmo contato.
A validação sintática não comprova titularidade ou possibilidade de uso.
Um telefone inválido não torna todos os destinos do cliente inválidos;
um bloqueio de cliente pode impedir todos os canais.

T04, Telefones, define ordem, condição de troca, espera após
alternância, preservação do telefone de retorno e comportamento de
número inválido. Prioridade do cadastro serve como desempate; a
estratégia pode preferir principal, tipo de telefone, prioridade do
mailing ou evidência histórica.

## 6 2 Seleção e alternância

9.  Se houver retorno solicitado válido, selecionar o destino solicitado
    e verificar sua disponibilidade.

10. Excluir destinos inválidos ou bloqueados e verificar limites por
    telefone e por cliente.

11. Ordenar destinos conforme a estratégia e escolher o primeiro
    elegível. Se houver modelo histórico, usar somente evidências
    vigentes e suficientes.

12. Em falha, aplicar o tratamento da tabulação: retentar o número,
    alternar, encerrar somente o destino ou encerrar a inscrição.

13. Após esgotar os destinos de uma etapa, avançar na jornada ou
    concluir sem sucesso conforme a estratégia. Não reiniciar a
    sequência silenciosamente.

No protótipo, a seleção percorre prioridades e o teto por telefone; o
melhor telefone preditivo não é calculado. As opções avançadas
representam o contrato funcional a implementar, não um modelo produtivo
ativo.

## 6 3 Compromisso de retorno

T02 oferece Agendar retorno com campanha, telefone, data, hora, fuso e
observação. Exibir o relógio ou fuso utilizado. Em produção, a tabulação
Solicitou retorno agendado deve abrir esses campos no mesmo formulário,
vinculando o compromisso à tentativa originadora e exigindo os dados
antes de concluir o registro.

Somente um compromisso ativo por contato, campanha e finalidade no
primeiro escopo. Reagendar marca o compromisso anterior como substituído
e preserva seu histórico. Cancelar requer motivo. O novo horário precisa
ser futuro e compatível com calendário e limites; se não for, oferecer o
próximo horário permitido antes da confirmação.

Quando o horário chega, o retorno pode ter prioridade sobre novos
contatos conforme o template. Preservar telefone, campanha e vínculo com
a solicitação. A prioridade não autoriza ignorar DNC, teto de esforço,
pausa ou destino inválido. Se houver indisponibilidade, registrar o
motivo e alertar a supervisão.

Estados: Agendado, Elegível, Reservado, Enviado, Cumprido, Não atendido,
Reagendado, Cancelado e Expirado. Uma tolerância de atendimento é
configurada na estratégia; vencimento não pode gerar recontatos
ilimitados. O agendamento por si só não conta como nova tentativa.

## 6 4 Aceite e limites da demonstração

-   AC12: o mesmo número não pode ser duplicado; invalidar um destino
    preserva os demais.

-   AC13: o motor seleciona um telefone elegível e respeita seu teto sem
    extrapolar o teto do cliente.

-   AC14: reagendamento preserva o anterior e mantém apenas um
    compromisso ativo.

-   AC15: DNC cancela a agenda futura; a confirmação de contato tardia
    não a reativa.

-   AC16: retorno futuro bloqueia novos acionamentos daquele ciclo até
    sua elegibilidade ou cancelamento autorizado.

-   AC17: falha de atendimento segue o template e não cria uma série
    ilimitada de retornos.

A agenda do protótipo é local e demonstrativa, vinculada a campanhas que
já contêm o contato. O serviço produtivo deverá acordar compromissos em
segundo plano e integrar o formulário de tabulação com o agendamento de
forma transacional.

# 7 C04 Lista dinâmica e fotografia da base

## 7 1 Escolha e tela

T03 apresenta Atualização dos membros com duas opções. Fotografia da
base congela os membros na publicação. Dinâmica reavalia os membros
contra os dados atuais do mesmo mailing e do cadastro de contatos,
usando a versão publicada dos filtros. T05 e a aba Mailing da campanha
mostram a modalidade selecionada, sem permitir sobrescrever a regra na
campanha.

A publicação exige nome, origem válida, filtros interpretados ou
explicitamente definidos e prévia não vazia. Mostrar quantidade
selecionada, excluídos por motivo, última atualização, versão da regra e
ordenação. Prompt não interpretado não pode ser ignorado
silenciosamente; manter a última prévia válida e impedir publicação até
correção.

## 7 2 Fotografia da base

Na publicação, gravar list_version_id e um conjunto estável de IDs com a
ordem de seleção. Se a lista for usada depois, utilizar esse conjunto,
não uma nova execução dos filtros. Uma nova publicação cria outra versão
e outro conjunto, sem migrar campanhas existentes automaticamente.

A fotografia congela o pertencimento, não autoriza acionamento
irrevogável. DNC, destino, reserva, teto de esforço e calendário
continuam atuais e são revalidados no momento da entrega. Dados de
negócio utilizados no conteúdo devem ter política explícita de versão;
nunca misturar valor contratual congelado com cobrança atual sem
definição do integrador.

## 7 3 Lista dinâmica

A versão dos filtros continua fixa na campanha. Eventos de atualização
do mailing, mudança de score, tabulação ou bloqueio podem disparar
reavaliação incremental. Novos elegíveis entram como inscrições
disponíveis; quem deixa de satisfazer os critérios sai da fila de novos
acionamentos.

Não remover nem perder a correlação de quem já foi enviado. Uma
inscrição reservada ainda não enviada deve ser reavaliada antes de
confirmar a entrega. DNC interrompe novos envios imediatamente,
independentemente do ciclo de atualização da lista. Se um cliente já
concluído voltar a satisfazer o filtro, não iniciar outro ciclo sem
política de reentrada explícita.

Registrar quantidade incluída, removida e mantida por atualização,
instante e razão. No primeiro escopo, reentrada de inscrição concluída
fica desabilitada. Mudança de filtros exige nova versão; atualização dos
dados exige nova avaliação, sem alterar a identidade da versão da regra.

## 7 4 Critérios de aceite

-   AC18: cliente novo incluído no mailing aparece na lista dinâmica se
    satisfizer os filtros e não modifica a fotografia publicada.

-   AC19: alteração de score ou histórico pode remover um cliente da
    fila dinâmica, sem apagar tentativas iniciadas.

-   AC20: publicar novos filtros não altera campanhas vinculadas à
    versão anterior.

-   AC21: DNC bloqueia um membro de fotografia e de lista dinâmica antes
    de nova entrega.

-   AC22: reprocessar o mesmo evento de atualização não duplica a
    inscrição.

-   AC23: o editor apresenta a prévia das regras em edição; membros da
    versão publicada permanecem identificáveis separadamente.

No protótipo, Simular novo cliente acrescenta um registro fictício ao
mesmo mailing. A lista dinâmica é recalculada nas consultas; a
fotografia usa os membros gravados. Não há atualização por CDC, filas
distribuídas ou materialização em escala.

# 8 C05 Indicadores e acompanhamento

## 8 1 Telas e recortes

T06 mostra nomes em trabalho, telefone ou e-mail escolhido, canal,
último estado, tabulação e horário. T07 mostra exclusões e capacidade de
entrega. T08 mostra resultados por campanha, lista, jornada e
estratégia. Os botões de indicadores nas bibliotecas abrem visão
consolidada.

Em produção, permitir período, fuso, campanha, origem, versão de lista,
versão de estratégia, jornada, canal, resultado e motivo de exclusão. O
protótipo contém agrupamento por origem, jornada e estratégia; filtros
temporais, funil completo e comparação por versão são escopo produtivo.

## 8 2 Definições das métricas

  -----------------------------------------------------------------------
  **Indicador**           **Fórmula ou regra**    **Tratamento especial**
  ----------------------- ----------------------- -----------------------
  Tentativas enviadas     Quantidade de           Reserva sem envio não
                          attempt_id com aceite   entra
                          de envio                

  Clientes trabalhados    Contatos distintos com  Não confundir com
                          envio no recorte        quantidade de telefones

  CPC por cliente         Contatos distintos com  Entrega técnica não é
                          tabulação que           CPC
                          identifica CPC          

  Taxa de CPC por cliente Clientes CPC divididos  Denominador zero exibe
                          por clientes            ausência, não zero
                          trabalhados             fabricado

  Conversões              Conversões de negócio   Uma atualização de
                          deduplicadas por        evento não gera nova
                          identificador           venda ou acordo

  Custo total             Soma de cobranças       Não somar estimativa e
                          confirmadas ou          custo liquidado do
                          estimadas,              mesmo item
                          identificadas           

  Custo por CPC           Custo total dividido    Ausente quando não há
                          por clientes CPC        CPC

  Exclusões               Clientes por            Mostrar motivo primário
                          reason_code em um       e todos os motivos
                          instante de avaliação   separadamente

  Tempo para resultado    received_at final menos Distinguir duração da
                          sent_at                 interação de atraso do
                                                  retorno

  Pendências              Reservados, enviados e  Grupos de estado
                          em reconciliação        mutuamente exclusivos
  -----------------------------------------------------------------------

As agregações produtivas devem agrupar pelos identificadores e versões,
mesmo quando nomes se repetem. Definir visão de clientes únicos no
workspace separada da soma por campanha, pois o mesmo cliente pode
participar de duas campanhas. Na demonstração, CPC é deduplicado por
cliente dentro da campanha e a consolidação soma essas linhas; essa
limitação aparece na tela.

## 8 3 Dinâmica e exportação

Consumir o ledger de eventos em projeções de leitura. Atualizar tabelas
por eventos ou consulta incremental; referência inicial de UX: nova
informação visível em até três segundos após processada no backend.
Exibir estado da conexão e atraso observado, sem prometer tempo de
execução do canal.

CSV respeita filtros, fuso e permissões. Registrar instante da extração,
critérios e totais. Escapar campos corretamente e neutralizar conteúdo
que possa ser interpretado como fórmula por planilhas. Clientes e dados
pessoais detalhados devem depender da permissão de consulta; totais
agregados podem ter perfil distinto.

-   AC24: três retornos para a mesma tentativa geram um envio e
    atualizações de estado, não três tentativas.

-   AC25: a conversão de uma tentativa permanece atribuída à versão
    usada quando ela foi reservada, mesmo após troca de template.

-   AC26: custo por CPC fica ausente com denominador zero; custo
    estimado aparece identificado.

-   AC27: reconciliação não aparece como sucesso; ausência de dados não
    é preenchida com métricas fictícias.

-   AC28: tela e exportação usam a mesma definição de métricas e o mesmo
    recorte.

# 9 C06 Propensão de contato e evidências

## 9 1 Experiência no contato e na lista

T01 e T03 mostram score, origem e ausência quando não houver dado. T02
explica score, data de cálculo, versão e evidências disponíveis. O
protótipo diferencia valor informado no mailing e regra demonstrativa; o
painel de validação informa que não existe modelo preditivo conectado.

Em produção, armazenar valor, significado do alvo, origem,
model_version, scored_at, valid_until, janela histórica e motivos
explicativos. Score 80 não deve ser apresentado como 80% de
probabilidade sem calibração comprovada para aquele alvo. Propensão de
ser atendido, de obter CPC e de converter são alvos diferentes.

T03 filtra e ordena a lista por score, com desempate determinístico.
Dados sem score seguem alternativa explícita: rejeitar filtro mínimo,
ordenar ao final ou manter ordem do mailing quando a política assim
permitir. Informar quantos ficaram sem pontuação.

## 9 2 Estratégia e alternativa sem evidência

T04, Otimização, define objetivo, histórico mínimo, campo de score
externo, uso de melhor horário e telefone e alternativa sem histórico.
Um modelo não pode remover DNC, teto de tentativas, calendário ou
prioridade obrigatória de um retorno.

O melhor horário precisa de evidência temporal do contato ou segmento; o
melhor telefone considera histórico por destino e validade. Sem
cobertura suficiente, usar a ordem e agenda do template. Uma preferência
histórica não é autorização para acionar fora da janela permitida.

A regra demonstrativa do protótipo não é um modelo de previsão, nem deve
ser reutilizada em produção como se tivesse ganho comprovado. A camada
produtiva poderá importar score externo antes de desenvolver modelo
próprio, mantendo o mesmo contrato de evidências.

## 9 3 Registro e validação do modelo

Criar registro de modelos com estados Em avaliação, Validado, Publicado,
Suspenso e Substituído. Cada versão informa responsável, alvo, período
de treino, período de validação independente, quantidade de exemplos,
segmentos, variáveis e referência comparativa.

Avaliar desempenho fora da amostra de treino, ganho de CPC ou contato
sobre a referência, estabilidade por período e segmento, calibração
quando houver probabilidades e custo por resultado. Incluir controle de
vazamento temporal: resultados futuros não podem participar das
variáveis da mesma tentativa avaliada.

Aprovar limiares e amostra mínima antes do experimento. Publicar somente
após validação por Produto e Dados. Acompanhar deterioração e ausência
de features; se ocorrer falha ou expiração, usar a alternativa do
template e manter reason_code. Reprocessamento de score não altera
resultado histórico nem tenta prever retroativamente um evento ocorrido.

-   AC29: score ausente permanece ausente; o usuário vê a alternativa
    aplicada.

-   AC30: cada decisão registra score, origem e versão utilizados
    naquele instante.

-   AC31: modelo suspenso ou vencido não é usado em nova reserva; a
    alternativa do template é aplicada.

-   AC32: ganho, calibração ou estabilidade não aparecem como medidos
    sem amostra e avaliação correspondentes.

# 10 Contrato dos dados e eventos

## 10 1 Campos mínimos

  -----------------------------------------------------------------------
  **Recurso**             **Campos principais**   **Restrições**
  ----------------------- ----------------------- -----------------------
  Contact                 id, workspace_id,       Unique por workspace_id
                          external_id,            e external_id
                          attributes,             
                          history_coverage        

  ContactDestination      id, contact_id,         Endereço como texto;
                          channel_type, address,  histórico preservado
                          label, priority,        após alteração
                          validity, blocked       

  MailingRecord           id, mailing_version_id, Preservar todas as
                          contact_id,             colunas e origem
                          business_key,           
                          raw_fields              

  ListVersion             id, list_id,            Imutável após
                          mailing_id,             publicação
                          filters_ast, sort,      
                          membership_mode,        
                          published_at            

  ListMember              list_version_id,        Unique por identidade
                          contact_id,             de inscrição definida
                          business_key,           
                          order_key,              
                          evaluated_at,           
                          membership_state        

  StrategyVersion         id, strategy_id,        Imutável; validação
                          calendar, effort_rules, integral ao publicar
                          retry_rules,            
                          destination_policy      

  JourneyVersion          id, journey_id, steps,  Cada etapa referencia
                          feedback_deadlines,     canal compatível
                          max_duration            

  CampaignEnrollment      id, campaign_id,        Sem reentrada
                          contact_id, cycle_id,   automática no primeiro
                          stage,                  escopo
                          next_eligible_at,       
                          terminal_reason         

  Attempt                 id, enrollment_id,      Exclusão de ativo por
                          destination_id,         cliente conforme escopo
                          reservation_token,      global
                          lease_until, sent_at,   
                          state, version_refs     

  AttemptEvent            id, attempt_id,         Unique por conector e
                          connector_id,           external_event_id
                          external_event_id,      
                          event_type,             
                          occurred_at,            
                          received_at,            
                          payload_hash            

  CounterConsumption      id, attempt_id,         Unique por attempt_id e
                          rule_dimension,         dimensão
                          effective_at, amount    

  Callback                id, contact_id,         Um compromisso ativo
                          campaign_id,            por finalidade e ciclo
                          destination_id, due_at, 
                          timezone, status,       
                          origin_attempt_id       

  ScoreEvidence           contact_id, score_type, Ausência e expiração
                          score, source,          explícitas
                          model_version,          
                          scored_at, valid_until, 
                          evidence                
  -----------------------------------------------------------------------

IDs devem ser opacos e não conter telefone ou documento do cliente. Toda
chave e operação é delimitada pelo workspace. Datas de evento e
recebimento são distintas; a ordem de chegada não determina a verdade do
resultado.

## 10 2 Eventos normalizados

  -----------------------------------------------------------------------
  **Evento**              **Significado**         **Efeito esperado**
  ----------------------- ----------------------- -----------------------
  RESERVED                Cliente e capacidade    Cria validade de
                          reservados              reserva, sem consumo
                                                  definitivo

  DISPATCH_ACCEPTED       Canal aceitou o envio   Confirma consumo uma
                                                  vez

  DELIVERY_CONFIRMED      Mensagem entregue       Aguarda feedback, salvo
                          tecnicamente            objetivo explícito

  CONTACT_CONFIRMED       Contato ou CPC          Atualiza indicadores e
                          confirmado              aplica estratégia

  BUSINESS_SUCCESS        Resultado de negócio    Encerra inscrição e
                          confirmado              cancela acionamentos
                                                  futuros

  ATTEMPT_FAILED          Falha conclusiva        Retenta, alterna ou
                                                  avança conforme
                                                  template

  CALLBACK_REQUESTED      Cliente solicitou       Cria compromisso
                          recontato               vinculado à tentativa

  OPT_OUT                 Cliente bloqueou novos  Aplica DNC e cancela
                          contatos                reservas e agenda
                                                  futuras

  RESULT_UNKNOWN          Situação técnica        Reconcilia sem novo
                          inconclusiva            envio automático

  RESERVATION_RELEASED    Reserva não enviada foi Devolve capacidade
                          liberada                provisória
  -----------------------------------------------------------------------

Registrar evento recebido antes de aplicar efeitos derivados. Consumir
com idempotência e confirmar processamento. Uma entrega técnica atrasada
após conversão não reabre a inscrição. Opt-out prevalece para novos
acionamentos mesmo após retorno tardio de CPC ou sucesso. Conflitos
ficam auditados, sem sobrescrita silenciosa.

# 11 Serviços e interfaces de integração

Esta seção propõe contratos para detalhamento técnico; os endpoints não
estão implementados no protótipo. O conector converte formatos externos
para o contrato normalizado e declara suas capacidades, como consulta de
status, cancelamento, retorno assíncrono e limite de lote.

  ------------------------------------------------------------------------------
  **Operação proposta**          **Entrada**             **Resposta e efeito**
  ------------------------------ ----------------------- -----------------------
  POST                           request_id, capacidade, Lote de tentativas,
  /campaigns/{id}/reservations   canal permitido         token de reserva,
                                                         validade e versões

  POST                           reservation_token,      Confirma envio uma vez
  /attempts/{id}/dispatch-ack    external_request_id,    ou rejeita reserva
                                 accepted_at             vencida

  POST /connectors/{id}/events   event_id, attempt_id,   Ack idempotente e
                                 type, occurred_at,      processamento
                                 result_code, cost       correlacionado

  GET                            filtros, cursor,        Membros, motivos,
  /campaigns/{id}/eligibility    evaluated_at            destino e próxima
                                                         elegibilidade

  POST /contacts/{id}/callbacks  campanha, destino,      Cria ou substitui
                                 horário, fuso, origem   compromisso de forma
                                                         transacional

  POST /lists/{id}/versions      AST validada,           Versão publicada e
                                 ordenação, modalidade   contagem inicial

  POST /strategies/{id}/versions calendário, limites e   Versão completa
                                 políticas               validada, sem mutar
                                                         versões antigas

  GET /reports/outreach          período, dimensões,     Agregados e definição
                                 versões e fuso          do recorte
  ------------------------------------------------------------------------------

Usar chaves de idempotência em mutações repetíveis. Repetir uma
solicitação de reserva com o mesmo request_id retorna o mesmo resultado
ainda válido; não reservar outro lote inadvertidamente. Evento sem
tentativa conhecida é retido para investigação, sem criar contato ou
incrementar contador por inferência.

Distinguir rejeição permanente, ausência de capacidade e
indisponibilidade transitória. Aplicar backoff e limite de tentativas
técnicas de integração; repetição de transporte não equivale a um novo
acionamento do cliente. Definir timeout do envio e mecanismo de consulta
antes de liberar um registro inconclusivo.

O serviço de lista calcula pertencimento; o agendador calcula próxima
elegibilidade; o coordenador de tentativas mantém reservas e consumo; o
conector executa; o normalizador interpreta o retorno; as projeções
alimentam telas e relatórios. Um único coordenador decide retentativas
de negócio.

# 12 Regras transversais e estados de erro

Publicação deve validar nome, referências, calendário não vazio, horário
final posterior ao inicial, limites positivos, teto diário não superior
ao total, política de cada tabulação e canal compatível. Recursos não
suportados pelo conector ficam identificados e impedem publicação quando
necessários à política, em vez de aparentar execução.

DNC e bloqueios obrigatórios são consultados antes da reserva e do
envio. Falha de acesso à política global deve impedir novas entregas até
recuperação. A opção de origem de score ou prioridade não pode
neutralizar restrições. Revogação de destino afeta novos envios sem
apagar eventos históricos.

Reimportação do mesmo cliente reutiliza identidade e preserva contadores
e histórico. Campos ausentes não apagam dados conhecidos
automaticamente. Conflitos de valores precisam de regra de precedência
por fonte e data. A chave de contrato permanece distinta da chave de
cliente.

Perfis propostos: operador consulta e registra resultados; supervisor
gerencia agenda e execução; gestor publica listas e estratégias;
administrador configura canais e políticas globais. Mudanças de
template, cancelamento de agenda, resolução de reconciliação e alteração
de bloqueio exigem trilha de auditoria com usuário, instante e motivo.

A publicação pode usar validação otimista por versão. Se duas pessoas
editarem o mesmo rascunho, a segunda recebe conflito com comparação das
alterações. Nenhum salvamento deve substituir silenciosamente uma versão
publicada por outro usuário.

Referências iniciais de aceitação técnica: atualização visual em até
três segundos após o evento estar processado; paginação obrigatória;
ensaio com base de cem mil registros e concorrência de pelo menos dois
consumidores. Esses números são metas propostas para dimensionamento,
não medições do protótipo. Volume, throughput e retenção finais devem
ser fixados com Engenharia e Operações antes do piloto.

# 13 Roteiro para desenvolvimento

  ------------------------------------------------------------------------
  **Etapa**         **Entregas**      **Dependências**   **Saída
                                                         verificável**
  ----------------- ----------------- ------------------ -----------------
  P0 Fundação       Entidades,        Chaves de cliente  Cargas repetíveis
                    versões,          e contrato, fuso e sem perda de
                    inscrição, ledger contratos de canal histórico
                    e normalização de                    
                    destinos                             

  P0 Execução       Elegibilidade,    Fundação e um      Ciclo completo
                    reservas          conector real      com duplicidade e
                    atômicas,                            falha testadas
                    capacidade, envio                    
                    e retornos                           

  P0 Controle       Contadores        Ledger e políticas Sem sobrecontato
                    compartilhados,   globais            em concorrência
                    DNC, pausa e                         
                    reconciliação                        

  P1 Operação       Telefones,        Execução e agenda  Retorno respeita
                    retorno agendado  persistente        calendário;
                    e modalidades de                     listas atualizam
                    lista                                sem duplicar
                                                         inscrições

  P1 Visibilidade   Indicadores,      Eventos e custos   Números
                    exclusões e       normalizados       reconciliáveis
                    exportação                           com o ledger
                    auditada                             

  P2 Inteligência   Score externo     Dados de resultado Experimento com
                    versionado,       com cobertura      referência e
                    validação e       suficiente         alternativa
                    otimização                           segura
                    histórica                            
  ------------------------------------------------------------------------

Para cada etapa, criar histórias por conceito e tela, usando os
identificadores C01 a C06, T01 a T09 e AC01 a AC32. Engenharia deve
detalhar transações, índices, particionamento e retries técnicos; UX
deve validar mensagens, foco, acessibilidade e estados vazios; QA deve
executar cenários de negócio, concorrência e recuperação.

Não há estimativa de prazo ou esforço neste plano. As dependências acima
permitem decomposição e estimativa pelo time após fechar o primeiro
conector, volume esperado, cobertura do histórico e política de
identidade.

# 14 Cenários integrados de homologação

  -----------------------------------------------------------------------
  **Cenário**             **Preparação e ação**   **Resultado esperado**
  ----------------------- ----------------------- -----------------------
  H01 Campanhas           Mesmo cliente em duas   Uma única tentativa
  concorrentes            campanhas; reservar     ativa no escopo
                          simultaneamente         definido

  H02 Retorno duplicado   Enviar e repetir evento Uma tentativa, um custo
                          com o mesmo event_id    e um agendamento

  H03 Resultado           Enviar e interromper    Reconciliação visível,
  inconclusivo            retorno                 sem nova chamada

  H04 DNC durante espera  Reservar ou agendar;    Cancelar futuro e reter
                          aplicar opt-out         histórico

  H05 Vários destinos     Esgotar principal e     Alternar conforme
                          manter adicional válido template, sem zerar
                                                  teto do cliente

  H06 Retorno futuro      Agendar para depois;    Aguardar horário e
                          consultar elegibilidade priorizar quando
                          antes e depois          permitido

  H07 Duas modalidades    Publicar fotografia e   Somente dinâmica
                          dinâmica; adicionar     incorpora o novo membro
                          elegível ao mailing     

  H08 Versões             Publicar estratégia     Tentativa existente
                          nova com campanha em    mantém versão original
                          andamento               

  H09 Score ausente       Selecionar cliente sem  Alternativa explícita
                          evidência histórica     ou revisão, sem score
                                                  inventado

  H10 Histórico           Importar acumulado sem  Não fabricar contagem
  incompleto              período                 diária; cumprir
                                                  política de cobertura

  H11 Reconciliação       Resultado chega após    Resolver uma vez e
  tardia                  timeout e depois é      atualizar projeções
                          repetido                corretamente

  H12 Indicadores         Registrar acordo com    CPC e conversão
                          custo conhecido         deduplicados, custo por
                                                  CPC correto
  -----------------------------------------------------------------------

Roteiro no protótipo: abrir campanha em execução, desmarcar simulação
automática, reservar e simular envio, registrar acordo e conferir
Indicadores. Em outra tentativa, deixar sem retorno e avançar o relógio
para observar reconciliação. Abrir o contato para adicionar telefone ou
retorno. Em Listas, escolher modalidade e usar Simular novo cliente. Em
Estratégias, criar cópia para ajustar contadores, destinos e
distribuição.

# 15 Pontos a fechar antes do piloto

  -----------------------------------------------------------------------
  **Decisão**             **Encaminhamento        **Responsável
                          proposto**              funcional**
  ----------------------- ----------------------- -----------------------
  Chave de cliente e      Identificadores         Produto e Integrações
  contrato                separados e mapeamento  
                          por origem              

  Canal inicial           Selecionar provedor com Produto e Engenharia
                          aceite e consulta de    
                          status                  

  Cobertura histórica     Importar período e      Operações e Dados
                          origem; bloquear regra  
                          sem cobertura           
                          obrigatória             

  Teto institucional      Definir por cliente,    Operações e Produto
                          canal, destino e janela 

  Tolerância do retorno   Configurar na           Operações
                          estratégia e definir    
                          tratamento do           
                          vencimento              

  Identidade dos          Definir conversão de    Produto e Dados
  indicadores             negócio e atribuição    
                          entre campanhas         

  Atualização dinâmica    Fixar frequência,       Engenharia
                          eventos e latência      
                          operacional             

  Validação do score      Fixar alvo, referência, Dados e Produto
                          amostra e aprovação     
                          antes de publicar       
  -----------------------------------------------------------------------

O documento descreve o comportamento esperado do produto e identifica os
limites da demonstração. A liberação produtiva depende de homologar o
ciclo com dados controlados e um canal real, incluindo falhas, repetição
de eventos, disputa entre campanhas e recuperação após
indisponibilidade.

# 16 Atualização funcional da versão 2

Esta revisão consolida o nome Voll Connect, a importação por CSV ou
conteúdo colado, os múltiplos destinos, a tela unificada de listas e a
Central de decisão. Acrescenta cinco frentes de evolução e a seção de
Observabilidade. Quando houver diferença em relação às descrições
anteriores, as regras desta revisão prevalecem. A jornada inicial da
campanha permanece com quatro passos e as configurações avançadas
continuam exclusivamente no template de Estratégia.

## 16 1 Importação e cadastro de destinos

A importação possui três passos. Em Origem, informar nome do mailing,
escolher arquivo CSV ou colar conteúdo de planilha, indicar separador
automático ou explícito e confirmar se a primeira linha contém os nomes.
O protótipo aceita até 2 MB e 2.000 registros. Em Definição dos campos,
revisar origem, exemplos, nome, destino no cadastro, tipo e
obrigatoriedade de cada coluna. Em Conferência, consultar registros
prontos e inconsistências por linha. A conclusão fica bloqueada enquanto
existir inconsistência. O mailing preserva as colunas e os valores
originais, além do esquema e dos valores tipados.

Cada contato aceita até cinco números de telefonia, três destinos
digitais com tipo WhatsApp ou SMS com transporte RCS quando suportado, e
um e-mail independente. Um mesmo número pode existir na telefonia e no
digital. Repetir o mesmo número no mesmo canal não é permitido. Validar
entre dez e quinze dígitos; a interface recomenda informar DDI e DDD.
Identificadores permanecem texto para preservar zeros iniciais.
Telefone, telefone1, telefone2 até telefone5 e digital1 até digital3
podem ser mapeados. O operador identifica o tipo de cada destino
digital. Nomes como whatsapp1 e sms2 ajudam na sugestão inicial.

No cadastro, Editar destinos apresenta os cinco telefones, os três
números digitais e o e-mail. A alteração mantém tabulações, tentativas,
vínculos aos mailings e bloqueios de números já conhecidos. O histórico
de tentativas referencia o destino usado na ocasião, mesmo após
substituição no cadastro. O mailing não deve ser reescrito quando o
contato for atualizado. Em produção, tratar explicitamente conflitos de
atualização entre cargas e edição manual com origem, data e precedência
configurada.

## 16 2 Listas em uma única tela

A criação e a edição de listas apresentam nome, mailing, modalidade dos
membros, prompt, regras interpretadas, filtros, ordenação, métricas e
prévia dos contatos na mesma tela. Não há abas separadas para regras,
contatos e filtros. Interpretar e filtrar converte as condições
reconhecidas em filtros e atualiza a prévia. Alterar um filtro numérico
sincroniza o texto e marca a prévia como pendente até Aplicar filtros na
prévia. Uma condição desconhecida não deve ser descartada. A publicação
exige resolver erros, confirmar regras e ter pelo menos um contato
elegível.

# 17 Central de decisão

A Central de decisão reúne Operação, Controle central, Custos,
Experimentos A/B e Otimização. Operação e Observabilidade não substituem
os controles da campanha; tornam visível o que foi decidido e executado.
A interface identifica o ambiente como simulação local. Salvar
configuração no protótipo não provisiona serviço, integração ou modelo
de IA.

  -----------------------------------------------------------------------
  **Frente**        **Tela**          **Objeto          **Entrega
                                      principal**       produtiva
                                                        necessária**
  ----------------- ----------------- ----------------- -----------------
  Operação real     Central de        Reserva e         Banco
                    decisão e         tentativa         transacional,
                    Campanha                            fila, workers e
                                                        conectores

  Controle central  Controle central  Política e        Contadores
                                      bloqueio          atômicos,
                                                        autorização e
                                                        auditoria

  Custos completos  Canais e Custos   Tarifa e          Eventos de
                                      conciliação       cobrança e
                                                        importação de
                                                        faturas

  Experimentos      Experimentos A/B  Experimento e     Execução
                                      atribuição        controlada e
                                                        análise
                                                        estatística

  Otimização        Estratégia e      Política e        Histórico
                    Otimização        recomendação      validado e
                                                        serviço de
                                                        decisão

  Observabilidade   Logs avançados    Trace e evento    Coleta durável,
                                                        busca e alertas
  -----------------------------------------------------------------------

## 17 1 Perfis e permissões de produção

Administrador cadastra canais, políticas institucionais e permissões.
Gestor prepara estratégias, campanhas e experimentos dentro das
políticas. Supervisor acompanha tentativas e investiga falhas. Analista
consulta indicadores e dados autorizados. Ações de bloqueio, conciliação
de custo, publicação e exportação devem ter permissões independentes e
auditoria. O protótipo usa um perfil fixo de administrador e não
implementa controle de acesso por função. A aplicação produtiva deve
filtrar dados no servidor por organização e escopo do usuário.

# 18 Operação real e execução persistente

## 18 1 Tela e dinâmica

Operação apresenta reservas sem envio, tentativas aguardando retorno,
reconciliações e eventos correlacionados. O gestor pode suspender novas
reservas sem apagar tentativas em andamento. Liberar reservas retoma a
elegibilidade; não reenvia automaticamente tentativas inconclusivas. A
área de conectores vincula cada tipo de canal a uma conexão cadastrada.
A seleção determina a conexão usada no registro de custo do próximo
envio. Alterar o vínculo não modifica registros históricos.

A tabela mostra tentativa, campanha, cliente, destino, canal, estado e
próxima ação. Reservas permitem simular envio. Tentativas enviadas ou em
reconciliação permitem registrar retorno. Repetir último evento
demonstra idempotência, sem aumentar tentativas, conversões ou custos. O
botão Abrir operação leva à campanha. Logs avançados leva à seção de
Observabilidade.

## 18 2 Contrato de execução em produção

O serviço obtém um cliente elegível, reserva a unidade de trabalho em
transação, preserva versões de origem, jornada e estratégia e revalida
imediatamente antes do envio. Cada tentativa tem attempt_id único,
trace_id, organização, campanha, cliente, canal, destino, etapa, versão
das regras, chave de idempotência e validade da reserva. O envio usa uma
outbox persistente para evitar perda entre transação e comunicação
externa. Uma reserva vencida sem envio pode ser liberada. Um envio
aceito sem confirmação permanece em reconciliação; não deve originar
nova tentativa concorrente.

A resposta síncrona do conector distingue rejeitado, aceito e
inconclusivo. Um identificador do provedor deve ser vinculado à
tentativa. Webhooks podem chegar repetidos e fora de ordem. Autenticar
origem, validar esquema, deduplicar pela combinação de organização,
conexão e identificador do evento, registrar o recebimento e aplicar uma
transição permitida. Falha no processamento encaminha para fila de erros
com número de reprocessamentos e motivo. Reprocessar evento não equivale
a repetir o acionamento ao cliente.

O processamento precisa continuar sem navegador aberto e sobreviver à
reinicialização dos serviços. O protótipo preserva o estado no
navegador, usa relógio simulado e exige a aplicação aberta para avançar.
Não há worker distribuído, sincronização entre dispositivos ou entrega
externa.

## 18 3 Critérios de aceite

-   OP01 Duas campanhas concorrentes não recebem simultaneamente a mesma
    reserva exclusiva do cliente.

-   OP02 Suspender novas reservas preserva o histórico e mantém
    recebimento e reconciliação de envios existentes.

-   OP03 Falha antes do envio não consome tentativa; aceitação
    confirmada consome uma única vez.

-   OP04 Evento repetido ou retomada após reinício não duplica contato,
    contagem, conversão ou custo.

-   OP05 Estado inconclusivo permanece visível até reconciliação
    explícita.

-   OP06 Conector indisponível gera motivo técnico rastreável e não
    permite trocar de rota sem regra de contingência.

# 19 Controle central de contato

## 19 1 Tela e precedência

Controle central permite definir máximo diário e máximo total por
cliente para o workspace. Valores vazios mantêm a aplicação dos limites
do template. Um limite institucional preenchido pode restringir o
template, mas o template nunca amplia a permissão institucional.
Histórico total importado e tentativas novas são somados sem duplicar o
histórico; contagens diárias usam eventos com data conhecida. Histórico
insuficiente segue a política conservadora da estratégia.

A consulta por identificador apresenta o cliente, o bloqueio global,
histórico importado e novos envios. Aplicar bloqueio exige motivo e
abrangência: cliente em todos os canais, número de telefonia ou destino
digital identificado. Bloqueio global cancela reservas e retornos ainda
não enviados. Bloqueio de destino impede novos envios para aquele
endereço no escopo definido, inclusive substituição automática que
voltasse a selecioná-lo. A tentativa já enviada permanece no histórico;
seu retorno pode ser processado sem reabrir o fluxo bloqueado.

A trilha registra data, responsável, ação, identificadores afetados,
motivo e valores anteriores e posteriores em produção. No protótipo, a
trilha registra alterações feitas pela Central e ações relacionadas a
envio e custo, com perfil fixo de administrador. A produção deve ampliar
a cobertura para todas as superfícies de alteração, inclusive API,
importação, edição de contatos e publicação de estratégias.

## 19 2 Critérios de aceite

-   CT01 DNC prevalece sobre score, experimento, campanha, retorno e
    recomendação.

-   CT02 Aplicar um limite não apaga tentativas anteriores nem reinicia
    contadores.

-   CT03 Nenhuma publicação de template altera política institucional
    sem permissão própria.

-   CT04 Toda alteração de bloqueio exige motivo, autor e registro de
    auditoria; desbloqueio exige revisão da origem da restrição.

-   CT05 A concorrência no último crédito de tentativa deve permitir
    somente um consumo confirmado.

# 20 Custos e conciliação

## 20 1 Cadastro e fotografia da tarifa

Canais permite definir custo de referência por tentativa em reais com
até quatro casas decimais e observação. Vazio significa desconhecido;
zero significa explicitamente gratuito. Cada envio preserva conexão,
tipo de canal, valor unitário, moeda, versão ou data da tarifa e
instante da captura. A versão do custo não deve depender do nome
editável da conexão. Em produção, criar identificador imutável de versão
da tarifa. O protótipo usa a data da alteração como referência de
versão.

O custo de referência usa a unidade tentativa enviada. Cobrança por
minuto, categoria de mensagem, entrega, sessão, volume e faixa precisa
de adaptador específico; um custo médio cadastrado deve ser identificado
como estimativa. Na ausência de vínculo ou tarifa, o custo do envio
permanece desconhecido. Não preencher zero automaticamente. Reservas sem
envio não geram custo de tentativa.

## 20 2 Tela de custos

A seção apresenta custo conhecido, cobertura dos envios, quantidade
confirmada e quantidade sem custo conhecido. A tabela mostra tentativa,
canal, conexão, tarifa preservada, estimativa, valor confirmado e ação
Conciliar. Informar valor não negativo e referência de fatura ou retorno
é obrigatório. O valor confirmado substitui a estimativa no custo
efetivo, sem somar os dois. Correções mantêm a fotografia original e
geram nova entrada de auditoria.

Indicadores agrupam por versão de estratégia e mostram envios, clientes
CPC, conversões, custo conhecido e custos unitários. Custo por CPC
divide custo efetivo por clientes CPC; custo por conversão divide por
clientes convertidos. Não calcular custo unitário com denominador zero
ou cobertura incompleta. Na consolidação, o protótipo deduplica cliente
dentro da campanha e soma as campanhas; não representa clientes únicos
do workspace. Exportar indicadores preserva cobertura e unidades
ausentes.

## 20 3 Conciliação produtiva

Receber eventos de cobrança ou arquivos do provedor com identificador da
conexão, tentativa ou evento, moeda, valor, unidade, quantidade, período
e referência. Importar em área de conferência, correlacionar,
identificar órfãos, divergências e duplicidades e permitir aprovação.
Conciliação deve ser idempotente por item de cobrança e permitir ajustes
rastreáveis. Custos de infraestrutura, agentes ou impostos somente
entram quando explicitamente definidos no modelo financeiro. A versão
atual não importa faturas nem calcula tributos.

## 20 4 Critérios de aceite

-   CS01 Alterar tarifa de um canal não muda o custo estimado de um
    envio anterior.

-   CS02 Confirmar custo zero preserva zero; valor desconhecido continua
    distinto.

-   CS03 Repetir o mesmo evento de custo não duplica a cobrança.

-   CS04 Valor confirmado substitui estimativa, e toda correção preserva
    autor, referência e histórico.

-   CS05 Indicadores com cobertura incompleta mostram custo parcial e
    omitem custo unitário.

# 21 Experimentos de estratégias e jornadas

## 21 1 Criação e distribuição

Novo experimento exige nome, lista publicada, estratégia e jornada para
grupos A e B e amostra mínima por grupo. A interface atual usa
distribuição de 50% por função determinística do identificador do
experimento e do cliente. Essa divisão não garante quantidades
exatamente iguais em amostras pequenas. Exigir diferença de pelo menos
uma estratégia ou jornada. Congelar base, versões, tarifas de referência
e atribuições ao criar. Uma nova carga não deve mover clientes entre
grupos.

O cliente é a unidade de atribuição, incluindo seus múltiplos destinos.
Um cliente nunca pertence a A e B dentro do mesmo experimento. Pausar
preserva os grupos e os resultados. Retomar processa apenas clientes
ainda pendentes. DNC deve ser revalidado antes de qualquer ação. Em
produção, clientes simultaneamente elegíveis a experimentos
incompatíveis precisam de exclusão ou política de precedência para
evitar contaminação.

## 21 2 Resultados e limites da simulação

A métrica principal da interface é conversão por cliente avaliado.
Mostrar quantidade avaliada, conversões, taxa, intervalo de Wilson de
95%, custo por conversão e clientes excluídos. A comparação continua
inconclusiva quando faltar amostra mínima ou avaliação dos membros.
Mesmo com amostra, intervalos sobrepostos não geram indicação de
diferença. Um sinal favorável fica restrito ao cenário avaliado e exige
revisão; não publica estratégia nem inicia campanha automaticamente.

Simular próximo lote avalia até vinte clientes por ação com resultados
determinísticos fictícios. O cenário fixa probabilidades ilustrativas de
20% para A e 27% para B e não mede o desempenho dos templates
escolhidos. Esses registros ficam em uma coleção separada e nunca
alimentam tentativas reais, CPC operacional ou modelos. O custo
ilustrativo considera uma única tentativa no primeiro canal da jornada,
com tarifa congelada; não representa o custo completo de todas as
etapas. Quando faltar tarifa, o custo unitário fica ausente.

## 21 3 Desenho produtivo do experimento

Antes de ativar, registrar hipótese, métrica principal, unidade de
randomização, segmento, amostra calculada, diferença mínima relevante,
nível de confiança, período de observação e regra de encerramento.
Dimensionar amostra por taxa de referência e poder estatístico, com
apoio analítico. Reservar grupos simultâneos e comparáveis;
opcionalmente estratificar por faixa de score, atraso e origem. Não
testar várias mudanças se a equipe precisar atribuir o efeito a uma
única variável.

Aguardar a mesma janela de maturação para resultados dos dois grupos.
Tratar exclusões, perdas e resultados tardios conforme regra previamente
definida e registrar os denominadores usados. Revisões repetidas exigem
desenho sequencial apropriado; o intervalo exibido no protótipo não
implementa esse desenho. Aplicar limites de orçamento e bloqueios
institucionais. A decisão de promover uma versão deve registrar
responsável e evidência, considerando resultado e custo, sem escolher
apenas a menor tarifa.

## 21 4 Critérios de aceite

-   EX01 Atribuição é exclusiva por cliente e permanece estável em
    pausa, retomada e reprocessamento.

-   EX02 Nenhum resultado fictício aparece nos indicadores operacionais
    ou no treinamento de modelos.

-   EX03 Dados insuficientes ou incompletos exibem conclusão
    inconclusiva.

-   EX04 DNC posterior à atribuição impede o acionamento e registra a
    exclusão no grupo original.

-   EX05 Promover uma alternativa exige ação explícita e não altera
    tentativas em andamento.

# 22 Recomendação e otimização

## 22 1 Política no template

Estratégia na seção Otimização permite escolher menor custo por CPC ou
menor custo por conversão e mínimo de resultados por destino, com piso
de três registros no protótipo. A campanha lê a política da versão
selecionada e não recebe sobrescrita local. A alternativa para evidência
insuficiente é manter a ordem e os destinos permitidos pela estratégia.
O limiar é configurável para demonstração e não constitui validação
estatística de um modelo.

## 22 2 Tela consultiva

O gestor seleciona uma campanha e consulta clientes, próximo canal
permitido, destino, resultados conhecidos, custo estimado por resultado
e evidência de horário. Primeiro executar elegibilidade; clientes
bloqueados exibem o motivo e não entram como candidatos acionáveis. A
consulta não muda a ordem de execução, a jornada ou os parâmetros da
campanha. A interface classifica os candidatos para revisão, mantendo
DNC, calendário, estágio e limites.

O protótipo usa tentativas locais concluídas para o mesmo canal e
destino. A estimativa divide a tarifa atual pela taxa histórica de CPC
ou conversão quando houver amostra mínima, pelo menos um sucesso e
tarifa conhecida. Se essas condições não forem atendidas, omitir o valor
e explicar a alternativa utilizada. O horário sugerido é a faixa com
melhor taxa histórica entre grupos com evidência mínima; não autoriza
envio fora do calendário. Exibir versão do template e quantidade de
evidências para permitir avaliação humana.

## 22 3 Evolução produtiva

Separar os alvos atender, obter CPC e converter. Registrar modelo,
versão, período, conjunto de validação independente, variáveis, validade
do score e motivos da recomendação. Melhor número, canal e horário
exigem evidência própria e comparação com uma referência simples.
Avaliar calibração, estabilidade, ganho por segmento, taxa de opt-out e
custo por resultado. Histórico observacional pode refletir seleção
anterior e não demonstra efeito causal.

Gerar recommendation_id com candidatos considerados, descartes e
motivos, política vigente, custo esperado e incerteza. A recomendação
produtiva pode sugerir alteração para um novo template ou experimento.
Autorizar execução automática apenas depois de validação, limites de
orçamento, monitoramento e possibilidade de suspensão. O protótipo não
treina modelo, não aplica mudanças automaticamente e não promete ganho.

## 22 4 Critérios de aceite

-   OT01 Um destino bloqueado nunca aparece como recomendação acionável.

-   OT02 Ausência de tarifa, sucesso ou evidência suficiente produz
    alternativa explícita, sem probabilidade inventada.

-   OT03 A política da campanha corresponde à versão do template
    selecionada.

-   OT04 Cada recomendação produtiva registra evidências, versão e
    motivos; resultados fictícios são excluídos.

-   OT05 Alterações sugeridas não modificam campanhas nem estratégias
    publicadas sem ação autorizada.

# 23 Observabilidade e logs avançados

## 23 1 Objetivo e acesso

Observabilidade permite responder o que aconteceu com cada tentativa,
por que ela foi selecionada ou bloqueada, qual conexão foi usada, quais
retornos chegaram e como o resultado e o custo foram consolidados. A
seção fica no menu principal e pode ser aberta a partir da Central de
decisão ou da campanha, já filtrada pela campanha. O acesso ao histórico
técnico não deve depender de a tentativa ter concluído com sucesso.

A tela contém busca por attempt_id, trace_id, cliente, destino,
identificador do evento ou texto técnico; filtros por campanha, canal,
estado da tentativa, severidade e intervalo de início da tentativa;
atualização automática; atualização manual; limpeza dos filtros;
paginação e exportação. O protótipo exibe quinze tentativas por página.
As linhas apresentam tentativa e trace, campanha, versão da estratégia,
cliente, destino mascarado, canal, estado, quantidade de eventos,
duração conhecida e ação Rastrear.

## 23 2 Linha do tempo por tentativa

Rastrear abre o detalhe com identidade da tentativa, origem, versões,
estado, custo estimado e confirmado e linha do tempo ordenada. Registrar
elegibilidade aprovada, reserva, expiração sem envio, revalidação,
cancelamento, envio aceito, fotografia da tarifa, retorno recebido,
correlação, evento duplicado ignorado, tabulação, resultado tardio,
reconciliação e ajustes administrativos. A ocorrência de erro não
substitui eventos anteriores. Eventos duplicados permanecem visíveis
para diagnóstico, embora não gerem novo efeito operacional.

Decisões que impedem criar tentativa aparecem na área Eventos sem
tentativa atribuída, vinculadas à campanha e motivo. Não inventar
attempt_id para um contato que nunca chegou à reserva. Em produção,
criar decision_id para essas avaliações e vincular ao contato quando
houver identificação, permitindo investigar bloqueios antes de qualquer
envio. A ausência de tentativa não significa ausência de avaliação.

O detalhe permite consultar JSON estruturado com dados mascarados e
exportar uma tentativa. A exportação geral inclui as tentativas do
filtro e seus eventos, mantendo indicação de simulação. O conjunto atual
de filtros tem como unidade a tentativa; a severidade seleciona
tentativas que possuem ao menos um evento daquela severidade. A linha do
tempo conserva os demais eventos da tentativa para preservar contexto.
Eventos sem tentativa aplicam filtros compatíveis e aparecem somente sem
filtro específico de canal ou estado.

## 23 3 Esquema obrigatório dos eventos em produção

  -----------------------------------------------------------------------
  **Grupo**                           **Campos obrigatórios ou
                                      condicionais**
  ----------------------------------- -----------------------------------
  Identidade                          event_id, organization_id,
                                      trace_id, attempt_id ou
                                      decision_id, correlation_id

  Origem                              serviço, instância, conector,
                                      ambiente, versão do esquema

  Contexto                            campanha, cliente, origem e versão,
                                      jornada e etapa, estratégia e
                                      versão

  Tempo                               occurred_at, received_at,
                                      processed_at em UTC, duração quando
                                      disponível

  Decisão                             tipo, severidade, estado anterior,
                                      estado novo, código e motivo

  Integração                          provider_event_id,
                                      provider_attempt_id,
                                      idempotency_key, HTTP status quando
                                      aplicável

  Custo                               tarifa e versão, estimado,
                                      confirmado, moeda, referência de
                                      conciliação

  Diagnóstico                         categoria do erro, número de
                                      reprocessamentos, referência da
                                      fila de erros

  Proteção                            classificação do dado,
                                      mascaramento, autor e permissão
                                      para consulta
  -----------------------------------------------------------------------

Nem todo campo existe em toda etapa. Antes do envio não há
provider_attempt_id; em uma reserva não enviada não há latência de
resposta do provedor. Campos desconhecidos ficam nulos e têm motivo
explicado. O protótipo registra os campos disponíveis no motor local e
não inventa status HTTP, identificador externo real ou SLA.

## 23 4 Métricas e alertas

Exibir volume de tentativas, eventos, erros, reservas, pendências e
reconciliações. Latências devem ser separadas em tempo na fila, reserva
até envio, envio até aceite, aceite até retorno e tempo total. Na
interface atual, p95 até conclusão usa relógio simulado e somente
tentativas com envio e conclusão registrados. Identificar essa limitação
junto ao indicador. Tentativas sem conclusão continuam pendentes e não
recebem duração final artificial.

Em produção, instrumentar taxas de erro por conexão e código, tamanho e
idade da fila, atraso dos webhooks, reservas expiradas, eventos
duplicados, órfãos, divergências de custo e tempo em reconciliação.
Permitir alertas com limiar, janela, destino, responsável e procedimento
de resposta. Alertas produtivos e telemetria distribuída estão
especificados para implementação, sem envio real de notificações no
protótipo.

## 23 5 Segurança e retenção

Mascarar telefone, identificador digital e e-mail por padrão. Não
registrar token, chave de API, senha, cabeçalho de autorização ou
conteúdo integral de mensagens. Referenciar payloads protegidos por
identificador, com armazenamento e permissões próprios quando
necessários. A exportação deve respeitar o mesmo escopo e mascaramento
da consulta e gerar auditoria em produção.

O serviço deve ter retenção configurável por tipo de evento e política
da organização, acesso por função e separação entre organizações. A
política deve definir armazenamento pesquisável, arquivo, descarte e
tratamento de dados pessoais conforme orientação jurídica. Não assumir
um prazo legal universal. Auditoria de alteração e log técnico são
coleções distintas, correlacionáveis, com proteção contra alteração não
autorizada. A versão local mantém registros no navegador e não oferece
garantia de durabilidade ou imutabilidade de produção.

## 23 6 Critérios de aceite

-   OB01 Toda tentativa criada aparece na consulta, inclusive cancelada,
    expirada e sem retorno.

-   OB02 A linha do tempo permite reconstruir reserva, envio e retornos
    sem sobrescrever eventos anteriores.

-   OB03 Repetir um webhook registra duplicidade e não duplica
    resultado, tentativa ou custo.

-   OB04 Evento tardio é correlacionado sem reabrir indevidamente um
    fluxo finalizado ou bloqueado.

-   OB05 Busca por attempt_id e trace_id retorna a mesma tentativa e
    seus eventos disponíveis.

-   OB06 Filtros, paginação, atualização e exportação mantêm o mesmo
    conjunto de tentativas.

-   OB07 Destinos permanecem mascarados na tela e no arquivo exportado;
    segredos nunca são incluídos.

-   OB08 Tentativas anteriores à instrumentação indicam histórico
    parcial quando não houver eventos suficientes.

-   OB09 Métricas de latência distinguem relógio simulado, operação
    real, pendência e duração final.

-   OB10 Eventos sem reserva são consultáveis por motivo e campanha sem
    criar tentativas fictícias.

# 24 Sequência de implementação e homologação

Implementar primeiro identidade, banco, ledger, reserva, outbox,
conectores, retorno idempotente e instrumentação básica. Em seguida
aplicar limites centrais e auditoria. Depois integrar tarifas e
conciliação. Experimentos produtivos dependem da consistência de
atribuição e resultado; otimização depende de evidência histórica
validada. Observabilidade acompanha cada fase e é requisito da entrega
operacional.

A homologação deve executar uma jornada completa com cinco telefones e
três destinos digitais, bloqueio de um número, DNC global, disputa entre
campanhas, expiração antes do envio, reinício de worker, retorno
repetido, retorno fora de ordem, ausência de resposta, conciliação com
valor zero e alteração de tarifa após envio. Verificar atribuição A/B
exclusiva, isolamento de resultados fictícios e recomendação sem
histórico. Para cada cenário, localizar a tentativa ou decisão nos logs,
exportar o recorte e conferir contagens, versões, custos e mascaramento.

# 25 Organização progressiva da interface

A interface apresenta primeiro as tarefas essenciais e mantém os
controles completos na mesma tela. Não existem versões funcionais
separadas para usuários iniciantes e avançados.

-   Navegação em Operação (visão geral, campanhas, central de decisão e
    observabilidade), Dados (contatos, mailings e listas) e Configuração
    (jornadas, estratégias, tabulações e canais). O item atual é
    identificado semanticamente e o menu permite rolagem em telas
    menores.

-   Visão geral oferece acesso às tarefas de criar campanha, importar
    mailing e preparar lista.

-   Estratégias apresentam limites total/diário, horário, dias e resumo
    por canal. A seção expansível Configurações avançadas preserva todos
    os parâmetros existentes e a seção selecionada durante a edição.
    Templates predefinidos continuam protegidos e exigem uma cópia para
    personalização.

-   Listas mantêm prompt, regras interpretadas e prévia sempre visíveis.
    Filtros e ordenação manuais são expansíveis, sem mudança de tela e
    sem alteração das regras já aplicadas. A expansão é preservada
    durante ajustes da lista.

-   Observabilidade apresenta busca, campanha, canal e status;
    severidade e período ficam em Filtros avançados, que abre
    automaticamente quando há um desses filtros ativo. Os detalhes
    estruturados da tentativa continuam expansíveis.

-   Central de ajuda orienta tarefas e oferece glossário sob demanda.

-   Assistente de campanha usa nomes estáveis: Mailing, Público,
    Acionamento, Campanha. A tabela usa Conexão em vez de Discador.

-   Janelas mantêm o foco do teclado em seu interior e o devolvem à
    origem ao fechar; Escape fecha a janela. Seções expansíveis são
    controles nativos operáveis por teclado.

-   Legibilidade reforçada em rótulos, tabelas e textos auxiliares, com
    foco visível e áreas de ação maiores. Não representa certificação
    completa de acessibilidade.

Aceite: criar e consultar campanhas sem abrir parâmetros avançados;
acessar todos os parâmetros anteriores ao expandir; alternar seções sem
recolhimento involuntário; regras e prévia de listas continuam
coerentes; filtros avançados ativos permanecem identificáveis; navegação
por Tab não alcança o fundo de uma janela aberta.

# 26 Melhorias de usabilidade e produtividade

Esta seção consolida os ajustes identificados na revisão de UX e
prevalece sobre descrições anteriores quando houver divergência sobre
importação parcial, revisão da campanha, rascunhos e navegação móvel. O
objetivo é reduzir retrabalho para quem começa e diminuir tarefas
repetitivas para quem opera diariamente. A separação funcional continua
obrigatória: campanhas selecionam componentes; parâmetros avançados são
publicados em estratégias.

## 26 1 Rascunho da campanha e saída protegida

A criação mantém um rascunho automático contendo nome, descrição, etapa
atual, base, jornada, estratégia e contexto de duplicação. Alterações de
campos e seleções são salvas sem exigir um botão adicional. Um indicador
informa que o rascunho foi salvo. Ao retornar a Nova campanha, a
interface retoma a etapa anterior e solicita revisão das seleções, pois
bases e templates podem ter mudado.

Cancelar ou navegar para outra área durante a criação abre uma janela
com Continuar editando, Salvar rascunho e sair e Descartar. Fechar a
janela equivale a continuar editando. Descartar remove apenas o
rascunho; não remove campanhas, contatos ou históricos. Começar outra
exige confirmação para substituir o rascunho atual. Depois de criar a
campanha com sucesso, o rascunho é removido. Falhas de validação não o
removem.

No protótipo existe um rascunho de campanha por navegador. Em produção,
persistir por usuário e organização, registrar revisão e data da
alteração, tratar conflito entre abas ou dispositivos e apresentar
falhas de salvamento de forma explícita. A limpeza do navegador não pode
ser tratada como exclusão de dados de produção.

Aceite: preencher nome e objetivo, avançar, sair salvando e retomar com
os mesmos valores; atualizar a página e retomar; cancelar a saída sem
perda; descartar somente após escolha explícita; criar com sucesso e não
reapresentar o rascunho antigo. Bases ou versões indisponíveis devem ser
sinalizadas antes da criação.

## 26 2 Validação junto aos campos

Erros obrigatórios permanecem junto ao campo, que recebe foco e
identificação semântica de valor inválido. A mensagem é associada ao
controle para leitura assistiva. O conteúdo preenchido é preservado. Uma
mensagem temporária não deve ser o único meio de explicar a falha.

Aplicar à identificação da campanha, seleção da base, componentes da
campanha, nome e origem da importação, nome de visualização e
configurações da estratégia. O limite diário deve ser positivo e não
pode superar o total; o horário final deve ser posterior ao inicial.
Quando o problema envolver uma configuração avançada, apresentar uma
mensagem persistente na área de configuração, mantendo todos os valores.
A validação no servidor de produção deve reproduzir as regras do
formulário.

Aceite: tentar continuar sem nome mantém a etapa, mostra a instrução
junto ao campo e move o foco; informar total menor que o diário impede a
publicação; corrigir e publicar limpa a indicação anterior. Nenhum
ajuste inválido gera versão publicada.

## 26 3 Escolha informada da estratégia

Ao selecionar a estratégia no passo Jornada e estratégia, mostrar nome,
versão, limite total por cliente, limite diário, dias, janela de
horário, fuso e tentativas e intervalos dos canais utilizados pela
jornada. O resumo muda ao trocar o template. Não permitir editar esses
parâmetros na campanha. Explicar que bloqueios e limites globais
prevalecem sobre o template.

Aceite: selecionar estratégias diferentes altera o resumo sem sair da
criação; uma jornada de canal simples apresenta o canal escolhido;
retentativas e horários publicados na campanha correspondem ao template
selecionado. Uma duplicação identifica a versão preservada da campanha
de origem.

## 26 4 Revisão única e previsão do acionamento

Usar títulos estáveis nas quatro etapas: Mailing, Público, Acionamento,
Campanha. A etapa atual deve ser anunciada semanticamente. A revisão
reúne Quem será contatado, Como será acionado, Quais limites serão
respeitados e Previsão do primeiro acionamento. Cada seção oferece um
acesso para editar a seleção correspondente, preservando o restante do
rascunho.

A base informa tipo, nome e quantidade. A jornada informa nome e
sequência de canais. A estratégia informa versão e política em linguagem
simples. A previsão é calculada pelo calendário e relógio da
demonstração. Mostrar alertas de suspensão global, ausência de conexão
padrão e contatos com histórico incompleto quando a política exigir
revisão. Distinguir previsão de calendário de elegibilidade individual;
não prometer execução enquanto houver bloqueio, falta de capacidade ou
destino inválido.

Salvar como pronta cria a campanha sem iniciar. Iniciar campanha
habilita a operação conforme as regras existentes. Não usar instruções
exclusivas de discador para uma jornada com canais digitais. Em
produção, a previsão deve usar o fuso efetivo, calendário de feriados,
disponibilidade dos conectores e validação atual dos componentes no
servidor.

Aceite: a revisão não repete os mesmos componentes em cartões e resumo
paralelo; Editar base retorna ao passo correto; fora do horário
permitido, informar a próxima janela; com suspensão global, informar que
o acionamento aguarda liberação. Uma tentativa continua sujeita à
revalidação antes do envio.

## 26 5 Importação parcial e recuperação dos rejeitados

A conferência separa total recebido, válidos e inconsistentes. Quando
houver ao menos um válido, habilitar Importar válidos e manter Ajustar
campos, Revisar origem e Baixar rejeitados. O botão deve concordar com a
quantidade. Não interpretar um botão desabilitado como autorização para
ignorar erros.

Antes de importar parcialmente, pedir confirmação com as quantidades que
serão incluídas e excluídas. O relatório dos rejeitados contém número da
linha original, cabeçalhos, valores recebidos e motivos. A confirmação
cadastra somente registros válidos e associa o relatório ao mailing
resultante, disponível para download posterior. Linhas rejeitadas não
entram no cadastro de contatos por essa operação. O histórico de
identificadores existentes continua preservado.

Não permitir importação quando nenhum registro for válido ou quando o
esquema estiver inconsistente. Corrigir os rejeitados e enviá-los em uma
nova carga é um fluxo explícito; não executar reimportação automática.
Em produção, registrar o lote, autor, horário, contagens e referência ao
relatório, com controle de acesso e retenção aplicáveis aos dados de
clientes.

Aceite: uma carga com um válido e um inválido exige confirmação, importa
um contato e preserva o relatório do outro; cancelar não cadastra
registros; o relatório mantém a linha original mesmo quando o mailing
contém somente válidos; CSV com aspas, separadores e zeros à esquerda
permanece íntegro.

## 26 6 Estado operacional compreensível

Separar o status administrativo da campanha de uma explicação
operacional. Aguardando liberação informa suspensão global. Aguardando
retornos informa reservas, envios ou reconciliações pendentes.
Aguardando próxima janela informa restrição de calendário. Processamento
concluído exige encerramento do fluxo dos membros atuais. Base
processada com execução habilitada explica por que progresso de 100 por
cento não encerra automaticamente uma campanha, sobretudo em listas
dinâmicas.

Não classificar uma campanha como concluída apenas porque o contador
visual de progresso chegou ao máximo. Retornos pendentes, entradas
dinâmicas e resultados de negócio têm ciclos próprios. A explicação é
derivada do estado operacional e não altera os contadores ou dispara
acionamentos.

Aceite: uma campanha em execução com base processada exibe explicação;
uma tentativa em reconciliação não é descrita como sucesso; pausa impede
novos acionamentos sem ocultar retornos em andamento. A versão de
produção deve calcular a situação no serviço operacional, sem depender
de contadores ilustrativos.

## 26 7 Tentativas explicadas e investigação contextual

O detalhe da tentativa começa pelo cliente, canal, O que aconteceu, Por
que está assim e Próxima ação. A linha do tempo utiliza rótulos como
Contato reservado, Enviado ao canal e Retorno associado à tentativa.
Identificadores, códigos originais e registro estruturado ficam em
Detalhes técnicos. A exportação mantém códigos e dados mascarados para
investigação.

A próxima ação deriva do estado e da estratégia preservada: aguardar
retorno, conferir com o canal, reavaliar retentativa, avaliar o próximo
canal ou manter o fluxo encerrado. Não apresentar entrega como
conversão. Histórico parcial deve ser identificado. Contatos em operação
e o cadastro do cliente oferecem Ver tentativa, permitindo chegar à
explicação sem procurar manualmente um identificador nos logs.

Aceite: abrir a tentativa a partir do cliente e da operação chega ao
mesmo histórico; reconciliação informa que novo envio está bloqueado;
retorno duplicado aparece sem novo custo ou consumo; o registro técnico
permanece disponível sem dominar a leitura inicial. Atualizações da
tabela devem preservar o foco da ação quando ela continuar disponível.

## 26 8 Visualizações salvas e colunas

Permitir nomear, selecionar e excluir visualizações no contexto de
campanhas, contatos, mailing, lista e observabilidade. Cada visualização
preserva a busca e os filtros pertinentes. Em listas, preservar
critérios e ordenação já aplicados; exigir aplicação de regras pendentes
antes de salvar. Aplicar uma visualização de lista não publica a lista
nem altera campanhas existentes.

Contatos e bases permitem selecionar colunas. Identificação do contato e
bloqueio de contato permanecem visíveis; a ação de abrir o cadastro
permanece na tabela central. Todas as colunas originais continuam
disponíveis. Preferências são associadas ao contexto para evitar aplicar
uma configuração de colunas incompatível a outra tabela.

No protótipo, preferências e visualizações são locais. Em produção,
salvar por usuário e organização, validar campos removidos do esquema,
definir permissões para compartilhamento e indicar filtros ativos,
inclusive quando estiverem em uma seção recolhida. Dados não informados
continuam distintos de zero.

Aceite: salvar busca e colunas, alterá-las e recuperar a visualização;
recarregar sem perder preferências; impedir ocultação das colunas
obrigatórias; excluir uma visualização sem excluir contatos ou
campanhas. Um filtro salvo para uma lista não modifica outra.

## 26 9 Busca de parâmetros e versões da estratégia

A busca global da estratégia encontra parâmetros de seções diferentes,
regras de tabulação e controles por canal. Cada resultado informa a
seção de destino e a abre com Configurações avançadas expandida. A busca
existente dentro da seção continua disponível.

Comparar versões apresenta parâmetro, valor publicado e valor do
rascunho, somente onde houver diferença. Preservar uma cópia imutável
das versões conhecidas antes de substituí-las e após cada publicação.
Campanhas e tentativas existentes mantêm suas versões. A comparação não
publica, restaura nem aplica ajustes automaticamente.

O protótipo conhece versões disponíveis no navegador e snapshots de
campanhas; não reconstrói versões anteriores ausentes. Em produção,
armazenar todas as versões com autor, data e motivo, inclusive após
edição em outro dispositivo. Evitar repetir diferenças de parâmetros
espelhados, como total e diário.

Aceite: buscar telefone encontra opções de seções distintas; buscar um
canal encontra suas tentativas e intervalo; alterar limite diário e
comparar destaca a diferença uma única vez; publicar uma nova versão não
modifica a versão anterior nem as tentativas em andamento.

## 26 10 Duplicação com revisão

Duplicar abre um rascunho na revisão, com o nome acrescido de Cópia.
Mostrar a campanha de origem e comparar nome, base, jornada e
estratégia, identificando Alterado ou Mantido. O usuário pode voltar às
seleções antes de salvar ou iniciar. Se já houver rascunho, confirmar a
substituição.

Preservar a estratégia e a jornada da origem enquanto a seleção não for
trocada. Não copiar resultados, reservas, tentativas ou compromissos de
retorno. A base selecionada é reavaliada e sua versão atual deve
aparecer na revisão. DNC e limites compartilhados continuam impedindo
contatos indevidos, mesmo quando a nova campanha tem outro
identificador.

Aceite: clicar Duplicar não cria campanha ativa nem envia contatos;
duplicar um canal simples e uma jornada multicanal funciona; trocar o
template remove a preservação do template anterior; criar a cópia produz
histórico operacional independente e mantém os bloqueios comuns.

## 26 11 Navegação móvel e acessibilidade

Usar cinco destinos fixos na barra móvel: Início, Campanhas, Listas,
Tentativas e Mais. Mais abre Operação, Dados e Configuração, incluindo
Canais e Configurações. Os destinos principais não dependem de rolagem
horizontal. O item atual deve ser identificado. Formulários e ações de
revisão se reorganizam sem perder controles.

Janelas mantêm o foco em seu interior, Escape fecha e o foco retorna à
origem quando ela permanece na página. Seções expansíveis continuam
operáveis por teclado. Erros são persistentes, legíveis e associados ao
campo. Não depender somente da cor para comunicar seleção, bloqueio ou
falha.

Aceite: em 390 por 844 pixels, todos os cinco destinos ficam acessíveis;
Mais permite chegar aos canais; em teclado, Tab e Shift Tab não alcançam
o fundo de uma janela aberta; corrigir um campo não apaga outros
valores. Completar auditoria assistiva e de contraste em produção; os
testes pontuais do protótipo não constituem certificação.

## 26 12 Validação com usuários e implantação

Os ajustes devem ser homologados com operadores iniciantes e
experientes. Usar tarefas de criar campanha sem ajuda, retomar rascunho,
importar carga com erros, preparar lista, ajustar estratégia e explicar
uma tentativa. Registrar conclusão, necessidade de ajuda, erros,
retornos de etapa e compreensão do efeito de Iniciar campanha. Não
apresentar metas de tempo como resultados já medidos.

Antes da produção, implementar persistência e isolamento por
organização, concorrência dos rascunhos, permissões das visualizações,
histórico completo de versões e armazenamento protegido dos relatórios.
Manter conectores, custos e execução demonstrativos identificados
enquanto esses serviços não estiverem disponíveis. Publicar os ajustes
em conjunto com o material de ajuda e o plano de desenvolvimento.

# 27 Assistente de preparação da campanha

## 27 1 Objetivo e arquitetura da experiência

A entrada Nova campanha abre Preparar campanha com quatro etapas:
Mailing, Público, Acionamento e Campanha. A preparação é um rascunho
independente; não deve criar uma campanha, reservar contatos ou realizar
envios antes da confirmação final. Mailings importados e listas salvas
são entidades reutilizáveis e permanecem disponíveis mesmo se a
preparação for abandonada.

O topo apresenta a etapa atual e permite retornar às etapas anteriores.
Etapas futuras permanecem indisponíveis até a validação da etapa atual.
O centro contém o trabalho da etapa. O resumo lateral apresenta mailing,
quantidade de contatos na prévia, jornada e estratégia com versão. No
rodapé estão Voltar e a ação principal; Salvar e sair fica acessível no
cabeçalho. Em telas estreitas o resumo fica abaixo do conteúdo e os
controles se reorganizam sem sobreposição com o menu móvel.

## 27 2 Etapa Mailing

Apresentar três entradas: Importar mailing, Mailing existente e Lista
existente. Reutilizar uma lista identifica automaticamente seu mailing
de origem e mantém as regras e ordenação publicadas. A importação ocorre
dentro desta etapa, com subetapas Origem, Campos e Conferência. Permitir
CSV e colagem de planilha, seleção de separador e indicação da linha de
cabeçalho.

Mapear identificador, nome, até cinco telefones, três destinos digitais,
e-mail e campos adicionais. Preservar zeros do identificador, campos
originais, tipos e histórico dos contatos. Aplicar as validações da
seção de importação. A importação parcial exige confirmação explícita e
conserva relatório de rejeitados com linhas, valores e motivos. Ao
concluir, selecionar o mailing criado e avançar para Público. Não criar
uma campanha como efeito da importação.

Critérios de aceite: seleção vazia impede avanço; CSV e colagem
percorrem o mesmo mapeamento; erros permanecem corrigíveis; importação
válida retorna à preparação; registros rejeitados não entram na nova
base; escolher outra origem invalida a revisão do público e do
acionamento.

## 27 3 Etapa Público

Oferecer Usar todos os contatos e Filtrar e criar lista. Uma lista
previamente escolhida aparece com suas regras publicadas e prévia. Usar
todos os contatos conserva a referência direta ao mailing, sem criar uma
lista artificial. Validação e DNC continuam obrigatórios. Para modificar
uma lista existente, criar uma nova seleção sobre seu mailing,
preservando a lista original.

A opção de filtros apresenta nome da lista, prompt de regras de negócio,
regras interpretadas, quantidade selecionada, exclusões por motivo e
tabela de contatos. Ajustes manuais de filtros, origem do score e
ordenação ficam em uma seção expansível. O prompt não pode aplicar
silenciosamente uma regra não reconhecida. Alterações pendentes, erros
de interpretação, limites inválidos ou resultado vazio impedem a
continuação.

Continuar para acionamento salva a lista publicada, com identificador e
versão, e a associa à preparação. Revisitar a etapa sem mudanças não
gera outra versão. Alterar nome ou regras gera nova versão da lista
criada pela preparação. A interface informa previamente que continuar
salva a lista, enquanto a campanha permanece por criar.

O contador da prévia representa contatos disponíveis após filtros,
validação e DNC. Não deve ser rotulado como contatos acionáveis agora:
calendário, limites compartilhados, capacidade, destino e retorno
pendente são avaliados pelo motor a cada tentativa. O protótipo já
aplica validação e DNC na prévia; em produção, a API deve fornecer
separadamente selecionados, excluídos e elegíveis naquele instante, com
motivos e horário de apuração.

Critérios de aceite: exibir regras antes do avanço; nunca ignorar
cláusulas não interpretadas; preservar mailing; permitir caminho sem
filtros de negócio; manter paginação e busca sobre o público atual;
revalidar resultados ao retornar de uma alteração da origem.

## 27 4 Etapa Acionamento

Escolher canal simples ou jornada multicanal publicada. Mostrar canais
em sequência e disponibilizar os prazos de feedback, esperas entre
canais e explicação das condições de encerramento. Selecionar uma
estratégia publicada e apresentar limites totais e diários, calendário,
intervalos e tentativas dos canais utilizados. As regras de tabulação
definem retentar, avançar, encaminhar, encerrar ou exigir revisão
técnica.

A ação Ajustar estratégia salva a preparação e abre o editor completo da
entidade Estratégia com uma cópia independente. O original e as
campanhas em operação permanecem preservados. No editor, oferecer Voltar
sem usar ajustes e Usar estratégia publicada. Para usar, é necessário
publicar uma versão válida. A escolha atualiza a preparação e retorna à
etapa Acionamento. As configurações avançadas não são armazenadas como
parâmetros avulsos da campanha.

O mockup utiliza a tela existente de Estratégias com uma faixa de
retorno ao assistente, mantendo todos os parâmetros disponíveis. Para
produção, essa mesma experiência pode ocupar um painel lateral amplo,
desde que preserve o contrato de cópia, publicação, retorno e gestão de
foco. Não duplicar a lógica de validação em um segundo formulário.

Critérios de aceite: impedir avanço sem estratégia válida ou jornada
disponível; apresentar apenas os canais relevantes no resumo; impedir
uso de ajustes não publicados; retornar sem perder público e nome;
manter a estratégia original inalterada.

## 27 5 Etapa Campanha

Solicitar nome obrigatório e descrição opcional. Apresentar público com
referência à lista ou mailing, jornada, estratégia e versão, calendário
e alertas de configuração. Cada seção deve oferecer edição da etapa
correspondente. Exibir a estimativa de custo com sua premissa: no
mockup, uma tentativa por contato disponível no primeiro canal, usando a
tarifa cadastrada. Tarifa desconhecida deve aparecer como não informada,
nunca como zero. Retentativas e canais seguintes não integram essa
estimativa simplificada.

Oferecer Salvar como pronta, Criar e iniciar e Criar e agendar. As duas
últimas são a ação principal conforme a escolha de início imediato ou
agendado. Salvar como pronta não inicia nem agenda, mesmo quando uma
data foi preenchida. Agendar exige data futura, explicitamente no
horário de São Paulo. Persistir o instante em UTC e o fuso de origem em
produção. Após o sucesso, limpar o rascunho e abrir o detalhe da
campanha com público, operação e tentativas.

No mockup, o estado Agendada é persistido no navegador e reavaliado a
cada dez segundos enquanto a aplicação está aberta. Ao vencer a data,
passa a Em execução; calendário e demais controles continuam sendo
aplicados pelo motor demonstrativo. Não há garantia de disparo com o
navegador fechado. A implementação de produção exige agendador
persistente, processamento idempotente, retomada após indisponibilidade,
auditoria e cancelamento ou reagendamento controlados.

Critérios de aceite: nome vazio e data passada impedem confirmação; um
clique válido cria uma única campanha; salvar pronta não despacha; o
agendamento não antecipa a ativação; a criação preserva as versões e os
snapshots usados; falha de persistência mantém o rascunho disponível
para nova tentativa.

## 27 6 Rascunhos e consistência entre etapas

Persistir etapa, origem, configuração de importação, filtros, prompt,
pendências de interpretação, lista preparada, jornada, estratégia, nome,
descrição e intenção de agendamento. O protótipo armazena esses dados no
navegador. A produção deve utilizar preparação persistida por usuário e
workspace, com controle de concorrência, salvamento automático,
indicador de falha e retomada em outro dispositivo. Dados de importação
precisam de armazenamento seguro e política de expiração.

Alterar a origem reinicia a seleção de público; voltar para editar
filtros exige aplicar novamente e revisar o acionamento antes da
confirmação. A revisão final consulta novamente a base disponível. Em
produção, mudanças concorrentes em lista, jornada, estratégia ou
conexões devem gerar aviso com comparação e exigir revisão das partes
afetadas. O servidor valida as dependências novamente em uma operação
transacional e cria a campanha com chave de idempotência, impedindo
duplicidade por repetição ou falha de rede.

## 27 7 Plano de implementação para a equipe

Entrega 1: componente de assistente com estado persistente, navegação
acessível, resumo responsivo, autosave e mensagens por campo. Migrar
rascunhos antigos para a nova sequência sem perder seleções.

Entrega 2: integrar importação assíncrona, mapeamento, validação,
relatório de rejeitados e deduplicação de contatos. Concluir a
importação produz mailingId, versão e estatísticas, retornando à
preparação.

Entrega 3: integrar o serviço de listas com interpretação explicável do
prompt, validação estruturada de regras, prévia paginada, contagens por
motivo e publicação versionada. Separar prévia de seleção e
elegibilidade operacional.

Entrega 4: integrar catálogo versionado de jornadas e estratégias,
copiar e publicar ajustes, retornar à preparação e avaliar
compatibilidade dos canais. Estimativas de custo devem informar
cobertura, tarifas, hipóteses e limites.

Entrega 5: implementar preflight no servidor, confirmação idempotente,
snapshots, agendamento persistente, auditoria e abertura da campanha
criada. Reservas ou envios somente após a ação de ativação autorizada.

Entrega 6: homologar os três pontos de entrada, retorno entre etapas,
importação parcial, filtro desconhecido, público vazio, publicação de
cópia da estratégia, nome obrigatório, data passada, reenvio da
confirmação, retomada após interrupção, mudanças concorrentes e operação
por teclado. Verificar foco e anúncios da etapa, erros associados ao
campo e rodapé acessível em telas pequenas.

Indicadores de produto: taxa de conclusão da preparação, tempo até
campanha pronta, abandono por etapa, frequência de correção de
importação, regras de prompt não reconhecidas e retornos para ajustar
estratégia. Não registrar o conteúdo de dados pessoais nos eventos
analíticos.
