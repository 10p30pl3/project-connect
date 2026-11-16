# Research: Revisão de UX/UI para Modos Básico e Avançado (`007-ux-ui-modes-cleanup`)

## 1. Arquitetura Atual de Modos e Permissões

- **Decision**: Manter ortogonalidade estrita entre `ExperienceMode` (`'basic' | 'advanced'` em `apps/web/src/lib/experience-mode.tsx`) e autorização (`isSuperAdminRole(me?.role)` de `@voll/shared` + `can(...)` de `apps/web/src/lib/auth.tsx`), adicionando flag explícita `superAdminOnly?: boolean` em itens de navegação (`NavItem` em `apps/web/src/components/Layout.tsx`) e um componente de proteção `SuperAdminGuard` para rotas exclusivas de plataforma.
- **Rationale**: Atualmente, a barra lateral filtra apenas por `minMode`, expondo `/sistema` a qualquer perfil no modo Avançado, e o `WorkspaceSwitcher` libera `+ Nova` para `ADMIN` em modo demo. Separar visualmente `Básico` / `Avançado` (densidade operacional do usuário) de `SUPER_ADMIN` (controles especiais de plataforma, custos internos e infraestrutura) elimina exposição indevida e reduz ruído.
- **Alternatives considered**: Criar um terceiro modo `"super_admin"` no seletor de experiência; rejeitado porque mistura preferência de interface com controle de acesso e confundiria usuários comuns.

## 2. Eliminação de Redundâncias na Navegação e Seletor de Modo

- **Decision**:
  - Simplificar o seletor `Básico | Avançado` na barra lateral (`Layout.tsx`) e na tela `More.tsx`, removendo a repetição do nome do modo ativo acima dos botões (`Nível da interface` + badge redundante) e substituindo o atributo nativo `title` por `<InfoTooltip />` discreto ao lado do rótulo.
  - Em `NAV_GROUPS`, remover títulos de grupo redundantes quando o grupo contém apenas um item homônimo (ex.: grupo `Sistema` → item `Sistema`) ou agrupá-lo de forma limpa sob `Governança` / seção administrativa visível apenas a `SUPER_ADMIN`.
  - Quando o usuário alternar para o modo **Básico** estando em uma rota exclusiva do modo **Avançado**, exibir estado limpo com link direto para voltar à `Visão geral` ou reativar o modo Avançado (sem barra lateral vazia ou inconsistente).
- **Rationale**: Menos texto repetido no topo da barra lateral libera altura útil para os links de navegação e reduz carga cognitiva imediata.
- **Alternatives considered**: Esconder o seletor de modo dentro do menu do usuário; rejeitado porque a alternância frequente entre Básico e Avançado deve continuar a 1 clique, porém com visual limpo.

## 3. Migração de Textos Explicativos Inline para Tooltips (`InfoTooltip`)

- **Decision**: Auditar `PageHeader.subtitle`, `<p>` descritivos em `Card`/`Modal`/seções e `Alert`s puramente conceituais em `apps/web/src/pages/` e `apps/web/src/components/`, convertendo explicações conceituais para `tooltip` em `PageHeader` ou `<InfoTooltip content="..." />` ao lado do título/rótulo. Manter inline **apenas**:
  - Metadados factuais da entidade (ex.: `ID`, contagem de registros, data de criação, descrição cadastrada da campanha).
  - Erros de validação de formulário, alertas dinâmicos de estado operacional bloqueante e confirmações de ações destrutivas.
- **Rationale**: Alinha integralmente o frontend ao Princípio IV da Constituição (*High-Density UI & Tooltip-Only Guidance*) e elimina rolagem/fricção desnecessária.
- **Alternatives considered**: Colapsar textos explicativos em accordions; rejeitado porque accordions ainda ocupam espaço vertical e criam clique extra de expansão.

## 4. Separação de Controles Especiais de Super Admin nas Páginas

- **Decision**: Revisar todas as páginas que exibem controles técnicos ou financeiros especiais:
  - **Navegação e `/sistema` (`System.tsx`)**: visível apenas para `SUPER_ADMIN`; não-Super Admin que abrir `/sistema` diretamente recebe `EmptyState`/aviso limpo com botão para `/`.
  - **`WorkspaceSwitcher` (`Layout.tsx`)**: botão `+ Nova` (provisionamento de tenant) e campo `Tarifa Venda PSTN` visíveis exclusivamente para `isSuperAdminRole(me?.role)`.
  - **`Telephony.tsx` e `telephony/SettingsTabs.tsx`**: cards de infraestrutura global (nós FreeSWITCH, Drachtio, Whisper, saúde de cluster, provedores/chaves globais e tarifas/custos internos) estritamente restritos a `isSuperAdminRole(me?.role)`, separando o que é operação avançada do cliente (ramais, filas, chamadas ao vivo, gravações) do que é engenharia de plataforma.
  - **`Billing.tsx` e `Reports.tsx`**: custos internos de provedor IA/PSTN e margens estritamente restritos a `isSuperAdminRole(me?.role)`; clientes veem apenas consumo de tempo e indicadores operacionais.
- **Rationale**: Garante experiência limpa para `ADMIN`, `MANAGER`, `SUPERVISOR` e `OPERATOR` mesmo no modo Avançado, sem perder capacidades operacionais legítimas.
- **Alternatives considered**: Ocultar toda a seção de Telefonia no modo Avançado para não-Super Admin; rejeitado porque clientes precisam operar ramais, chamadas e agentes de voz.
