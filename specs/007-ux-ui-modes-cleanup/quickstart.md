# Quickstart Validation: Revisão de UX/UI para Modos Básico e Avançado

## Pré-requisitos

```bash
npm run typecheck
npm run test:arch -w @voll/api
npm run build
```

Subir frontend em modo demonstração para inspeção visual:

```bash
VITE_DEMO_MOCK=true npm run dev -w @voll/web -- --port 4173
```

## Cenários de Validação (`http://localhost:4173`)

### 1. Seletor de Modo e Navegação Limpa
1. Acessar `http://localhost:4173` como `ADMIN` (ou alternar perfil para `ADMIN`).
2. Na barra lateral, verificar que o seletor `Básico` | `Avançado` não repete o rótulo do modo ativo e possui ícone `?` (`InfoTooltip`) funcional.
3. No modo **Básico**, confirmar que apenas os módulos essenciais aparecem e não há grupo com título duplicado.
4. Alternar para **Avançado** e confirmar que módulos operacionais avançados (`Listas`, `Jornadas`, `Estratégias`, `Tabulação`, `Relatórios`, `Limites`, `Observabilidade`) aparecem, mas **`Sistema`** e o botão **`+ Nova`** de provisionamento de empresa permanecem ocultos para `ADMIN`.

### 2. Tooltips no Lugar de Textos Explicativos Inline
1. Visitar `/tentativas`, `/calendarios`, `/agentes-de-voz`, `/telefonia`, `/campanhas` e `/campanhas/:id`.
2. Confirmar ausência de parágrafos ou subtítulos conceituais longos inline.
3. Passar o mouse / focar nos ícones `?` (`InfoTooltip`) dos cabeçalhos e campos e confirmar que a explicação aparece corretamente em tooltip.

### 3. Controles Especiais Exclusivos de Super Admin
1. Ainda como `ADMIN` no modo **Avançado**, navegar diretamente para `/sistema` e verificar exibição de estado de acesso restrito sem expor ações globais; verificar em `/telefonia` e `/consumo` que nós de infraestrutura global e tarifas/custos internos não aparecem.
2. Alternar perfil (no menu de demonstração) para `SUPER_ADMIN`.
3. Confirmar que **`Sistema`**, **`+ Nova`** empresa (com campo de tarifa PSTN) e os controles de infraestrutura/custos em `Telefonia` e `Billing & Consumo` ficam visíveis normalmente.
