# UI/UX Contract: Modos Básico e Avançado + Super Admin (`007-ux-ui-modes-cleanup`)

## 1. Navegação e Seletor de Modo (`Layout.tsx` & `More.tsx`)

- **Seletor de Modo (`basic` | `advanced`)**:
  - Exibe rótulo curto (`Modo` ou `Interface`) + `<InfoTooltip />` explicando os dois níveis, seguido imediatamente pelo controle segmentado `Básico` | `Avançado`.
  - **Proibido** repetir o nome do modo ativo em texto separado ao lado ou acima dos botões.
- **`NavItem`**:
  - Suporta `minMode?: 'basic' | 'advanced'` e `superAdminOnly?: boolean`.
  - Filtro efetivo de exibição:
    `isAtLeast(it.minMode ?? 'basic') && (!it.superAdminOnly || isSuper)`
  - Grupos sem itens visíveis não são renderizados; grupos com título igual ao único item visível evitam repetição visual desnecessária.

## 2. Política de Tooltips (`PageHeader`, `Card`, `Field`, `InfoTooltip`)

- Toda página com explicação conceitual usa `PageHeader` com `tooltip="..."` em vez de `subtitle="..."` descritivo.
- Subtítulos em `PageHeader` ficam reservados apenas a metadados factuais do registro (ex.: `ID`, contagem, descrição editável da campanha).
- Parágrafos explicativos (`<p className="text-xs text-slate-...">`) e `Alert`s puramente conceituais dentro de cards/abas/modais devem ser convertidos em `<InfoTooltip content="..." />` junto ao título do `Card` ou `Field.label`.

## 3. Fronteira de Controles Especiais (`SUPER_ADMIN`)

- `/sistema` (`SystemPage`) e item de menu `Sistema`: `superAdminOnly: true`. Acesso direto por não-Super Admin renderiza bloqueio limpo sem expor dados/ações de plataforma.
- Provisionamento multi-tenant (`+ Nova` em `WorkspaceSwitcher`) e `Tarifa Venda PSTN`: renderizados apenas quando `isSuperAdminRole(me?.role)` é verdadeiro.
- Infraestrutura de nós (`FreeSWITCH`, `Drachtio`, `Whisper`), engenharia global SIP/DSP e custos/tarifas internos em `Telephony`, `Billing` e `Reports`: visíveis exclusivamente quando `isSuperAdminRole(me?.role)` é verdadeiro.
