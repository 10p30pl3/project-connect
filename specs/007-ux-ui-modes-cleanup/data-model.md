# Data Model & UI Governance: Revisão de UX/UI para Modos Básico e Avançado (`007-ux-ui-modes-cleanup`)

> Esta feature não altera tabelas PostgreSQL nem contratos de API/worker; ela governa o modelo de visibilidade e orientação visual no frontend (`apps/web`).

## 1. Modelo de Visibilidade de Interface (`VisibilityMatrix`)

Cada módulo, aba, card ou controle especial em `apps/web` é classificado segundo dois eixos ortogonais:

| Eixo | Valores | Responsabilidade |
|---|---|---|
| `minMode` (`ExperienceMode`) | `'basic' \| 'advanced'` | Complexidade visual e densidade operacional escolhida pelo usuário |
| `roleGate` | `'all' \| 'permission' \| 'super_admin'` | Autorização por perfil (`SUPER_ADMIN` exclusivo para controles especiais de plataforma) |

### Matriz de Classificação por Área

| Área / Controle | Modo Básico | Modo Avançado | Restrição Super Admin |
|---|---|---|---|
| `Visão geral`, `Campanhas`, `Contatos`, `Mailings`, `Calendários`, `Canais`, `Agentes de Voz` | Visível (fluxo limpo, sem textos inline) | Visível (métricas e filtros completos) | Não (respeita `can(...)`) |
| `Consumo de Tempo` / `Billing & Consumo` | Visível (apenas minutos/tempo para cliente) | Visível (detalhamento de uso) | Custos/tarifas R$ e margens somente `SUPER_ADMIN` |
| `Modelos de campanhas`, `Central de inteligência`, `Listas`, `Jornadas`, `Estratégias`, `Tabulação`, `Relatórios`, `Limites`, `Observabilidade` | Oculto | Visível | Custos internos e ações globais somente `SUPER_ADMIN` |
| `Telefonia` — chamadas, ramais, softphone, tenants do usuário | Visível (essencial: chamadas, testar ramais) | Visível (métricas de turno, transcript detalhado, filtros) | Infraestrutura global (nós FreeSWITCH/Drachtio/Whisper, engenharia SIP/DSP global, tarifas) somente `SUPER_ADMIN` |
| `Sistema` (`/sistema`) e provisionamento multi-tenant (`+ Nova` empresa) | Oculto | Oculto para clientes | **Exclusivo `SUPER_ADMIN`** |

## 2. Modelo de Conteúdo Contextual (`GuidancePolicy`)

- **Inline permitido**:
  - Títulos curtos (`PageHeader.title`, `Card.title`, `Field.label`).
  - Metadados factuais da instância (ID, contagem, data/hora, status).
  - Erros de validação de campo, confirmações destrutivas em modal e alertas dinâmicos de estado operacional.
- **Obrigatório em Tooltip (`PageHeader.tooltip` / `<InfoTooltip />`)**:
  - Descrições conceituais de páginas (`subtitle` conceitual).
  - Explicações de funcionamento de modos, métricas, regras de discagem, janelas de calendário e campos de formulário.
