# Diretrizes de Desenvolvimento e Padrões para Agentes — Voll Plan

Este documento estabelece as diretrizes de engenharia, arquitetura e, especialmente, os **padrões de experiência do usuário (UI/UX)** obrigatórios para qualquer agente de IA ou desenvolvedor atuando no repositório do **Voll Plan**.

---

## 1. Padrão Obrigatório de UI/UX: Textos Explicativos vs. Tooltip (?)

> [!IMPORTANT]
> **Regra de Ouro da Interface:**  
> **Nenhum texto explicativo, conceito, instrução de preenchimento ou parágrafo descritivo deve ficar solto no corpo visual das telas, cards ou formulários.**  
> **Toda e qualquer explicação conceitual deve estar contida exclusivamente em um Tooltip de Ajuda `(?)`.**

### 1.1. Motivação e Objetivo
O Voll Connect é uma plataforma de missão crítica utilizada por supervisores, gestores de tráfego de voz/mensageria e operadores. Poluir a tela com parágrafos explicativos diminui a densidade de informação útil, empurra dados operacionais para fora da dobra da tela e gera ruído visual desnecessário.

### 1.2. Regras de Aplicação Prática

1. **Cabeçalhos de Página (`PageHeader`)**:
   - **Evitar** subtítulos longos e explicativos (`subtitle="..."`).
   - **Usar** a prop `tooltip="..."` para contextualizar a função daquela página através do ícone `(?)` ao lado do título:
     ```tsx
     // ✅ CORRETO
     <PageHeader
       title="Sistema"
       tooltip="Configurações gerais da plataforma, credenciais da OpenAI API e parâmetros operacionais."
     />

     // ❌ ERRADO
     <PageHeader
       title="Sistema"
       subtitle="Aqui você configura todas as chaves e parâmetros de rede do sistema Voll Connect de forma fácil."
     />
     ```

2. **Cards (`Card`)**:
   - Não inserir parágrafos de texto no topo do card (`<p className="text-sm text-slate-600">...</p>`).
   - Utilizar a prop `tooltip="..."` nativa do componente `Card`:
     ```tsx
     // ✅ CORRETO
     <Card
       title="Integração com OpenAI API"
       tooltip="Configure a chave de API da OpenAI para habilitar o motor GPT na criação interativa e estruturação de campanhas."
       actions={<Badge tone="green">Ativo</Badge>}
     >
       {/* Conteúdo estritamente operacional / campos */}
     </Card>

     // ❌ ERRADO
     <Card title="Integração com OpenAI API">
       <p className="text-sm text-slate-500 mb-4">
         Essa opção serve para você conectar a sua inteligência artificial e montar campanhas com linguagem natural...
       </p>
       ...
     </Card>
     ```

3. **Campos de Formulário (`Field`)**:
   - **Não usar** a prop `hint` para descrições conceituais ou explicações sobre o formato esperado (`sk-...`, regras, etc.). A prop `hint` deve ser evitada ou restrita a mensagens de sistema dinâmicas.
   - **Sempre usar** a prop `tooltip="..."` no `Field`, que renderiza automaticamente o ícone `(?)` (`<InfoTooltip />`) ao lado do label do campo:
     ```tsx
     // ✅ CORRETO
     <Field
       label="OpenAI API Token"
       required
       tooltip="Chave secreta iniciada com 'sk-...'. Armazenada com segurança no navegador para acionamento das rotas de inteligência artificial. Obtenha em platform.openai.com."
     >
       {(ids) => (
         <Input id={ids.id} aria-describedby={ids.describedBy} type="password" value={apiKey} ... />
       )}
     </Field>

     // ❌ ERRADO
     <Field
       label="OpenAI API Token"
       hint="Sua chave inicia com 'sk-...' e é armazenada com segurança no navegador."
     >
       ...
     </Field>
     ```

4. **Diretrizes, Políticas e Parâmetros de Segurança**:
   - Em vez de blocos de texto ou parágrafos com marcadores (`•`), estruture listas enxutas com Badges objetivos e o ícone `(?)` (`<InfoTooltip content="..." />`) em cada linha:
     ```tsx
     // ✅ CORRETO
     <div className="py-2.5 flex items-center justify-between gap-3">
       <div className="flex items-center gap-1.5 text-slate-700 font-medium">
         <span>Criptografia de Credenciais</span>
         <InfoTooltip content="Sua chave de API é enviada via TLS criptografada e nunca é compartilhada com outros clientes ou terceiros." />
       </div>
       <Badge tone="green">TLS Ponta a Ponta</Badge>
     </div>
     ```

5. **Componente Reutilizável de Tooltip**:
   - Utilizar `<InfoTooltip content="..." />` de `apps/web/src/components/ui.tsx` para qualquer ícone informativo pontual em tabelas, headers ou listas.

---

## 2. Arquitetura do Repositório (Monorepo)

O projeto é estruturado em **npm workspaces**:

```
project-connect/
├── packages/
│   └── shared/          # Schemas Zod, tipos TypeScript, constantes e contratos de API
├── apps/
│   ├── api/             # Backend Fastify, rotas em src/modules/, banco de dados e integrações
│   └── web/             # Frontend React 19 + Vite + Tailwind CSS + TanStack Query + Radix UI
└── agentes.md           # Este guia de padrões e diretrizes
```

### 2.1. Regra de Paridade (Backend Real & Mock)
O Voll Connect suporta dois modos operacionais simultâneos:
1. **Modo Full-Stack / Conectado**: Consumindo a API Fastify (`apps/api`).
2. **Modo Demonstração / Deploy Estático (Vercel/Mock)**: Controlado por `apps/web/src/lib/mock-backend.ts`.

> [!WARNING]
> Sempre que adicionar ou modificar um endpoint no backend (`apps/api/src/modules/`), **implemente obrigatoriamente a rota correspondente em `apps/web/src/lib/mock-backend.ts`** para manter 100% de paridade no modo demonstrativo e nos testes estáticos.

---

## 3. Padrões de Navegação e Menus

- A barra lateral de navegação é definida em `apps/web/src/components/Layout.tsx` no array `GROUPS`.
- Seções principais do sistema:
  - **OPERAÇÃO:** Visão geral, Campanhas, Central de inteligência
  - **DADOS:** Contatos, Mailings, Listas
  - **CONFIGURAÇÃO:** Jornadas, Estratégias avançadas, Tabulações, Canais
  - **RELATÓRIOS:** Relatórios
  - **GOVERNANÇA:** Limites, Observabilidade
  - **SISTEMA:** Sistema (`/sistema` para gestão de credenciais OpenAI, modelos e status operacional)

---

## 4. Checklist de Qualidade Obrigatório antes de Concluir Tarefas

Antes de finalizar qualquer modificação ou enviar código ao branch `main`, o agente deve executar:

1. **Validação de Tipagem e Build:**
   ```bash
   npm run typecheck && npm run build
   ```
   *Ambos devem finalizar com código de saída 0 (zero erros em `@voll/shared`, `@voll/api` e `@voll/web`).*

2. **Verificação de Usabilidade Visual (Padrão Tooltip `(?)`):**
   - Confirmar se não há textos explicativos ou descrições verbosas poluindo a tela.
   - Confirmar se todas as dicas, conceitos e regras técnicas foram movidas para `tooltip` / `<InfoTooltip />`.

3. **Validação E2E com DevTools:**
   - Navegar na interface modificada, testar interações e capturar screenshots comprobatórios.

4. **Git Commit & Push:**
   - Mensagens semânticas em inglês no formato Conventional Commits (ex: `feat(system): ...`, `fix(ui): ...`).
