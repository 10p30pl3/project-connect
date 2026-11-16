# Quickstart Validation: Edição de Configurações e Histórico de Campanha

## Pré-requisitos
- Workspace compilando (`npm run typecheck`) e testes passando (`npm run test:arch -w @voll/api`).
- Ambiente web rodando em modo demo (`VITE_DEMO_MOCK=true`) ou conectado à API com PostgreSQL migrado até `017_campaign_history_index.sql`.

## Cenários de Validação

1. **Editar configurações da campanha (US1)**
   - Acessar `/campanhas/:id` de uma campanha ativa, pausada, agendada ou em rascunho.
   - Clicar em **Editar configurações**.
   - Alterar **Nome**, **Calendário de funcionamento** e **Estratégia**, informar opcionalmente um motivo e salvar.
   - Esperado: modal fecha, resumo da campanha exibe imediatamente os novos valores.

2. **Registro automático no histórico com pessoa, data-hora e diff (US2 & US3)**
   - Na mesma página `/campanhas/:id`, abrir a aba **Histórico**.
   - Esperado: o evento mais recente no topo mostra:
     - **Pessoa**: nome e e-mail do usuário autenticado;
     - **Data e hora**: formato completo `dd/mm/aaaa, hh:mm:ss`;
     - **Modificações**: apenas os 3 campos alterados (`Nome`, `Calendário de funcionamento`, `Estratégia`) com `valorAnterior → valorNovo`.

3. **Salvamento sem mudanças (Edge Case / FR-008)**
   - Abrir **Editar configurações** e clicar em **Salvar alterações** sem modificar nenhum campo.
   - Esperado: nenhuma nova entrada é adicionada na aba **Histórico**.

4. **Campanha encerrada / arquivada (FR-002)**
   - Acessar uma campanha `COMPLETED`, `CANCELLED` ou arquivada.
   - Esperado: ação **Editar configurações** desabilitada/oculta e requisição direta `PATCH /campaigns/:id` rejeitada com erro `409`.
