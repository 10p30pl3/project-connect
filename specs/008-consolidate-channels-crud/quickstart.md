# Quickstart & Validation Guide: Consolidar Abas de Canais e CRUD Completo

**Feature**: `008-consolidate-channels-crud`

## 1. Verificações Estáticas e Build

```bash
npm run contracts
npm run typecheck
npm run check:gateway
npm run test:arch
npm run build
```

Esperado: zero erros TypeScript em `@voll/shared`, `@voll/api` e `@voll/web`, e build de produção concluído.

## 2. Cenários de Validação End-to-End em `/canais`

1. **Visão Única (US1)**:
   - Fazer login como Super Admin e navegar para **Canais & Integrações** (`/canais`).
   - Confirmar que **não existem** as duas abas (*Conectores & Conexões* / *Configurar Endereços Técnicos*).
   - Alternar entre visualização em cartões e tabela e confirmar consistência das ações.

2. **CRUD Completo com Revelação Progressiva (US2 — Modo Básico vs Avançado)**:
   - No **Modo Básico**, clicar em **Novo canal**: confirmar que **Configurações Básicas** aparecem abertas e **Configurações Avançadas & Endereços Técnicos** inicia recolhida, podendo ser expandida com um clique.
   - No **Modo Avançado**, clicar em **Novo canal**: confirmar que **Configurações Avançadas & Endereços Técnicos** inicia expandida.
   - Criar um canal (ex.: `WHATSAPP` ou `VOICE`), preencher `endpointUrl`/dados técnicos, clicar em **Testar Conectividade** e salvar.

3. **Edição com Preservação de Segredos e Exclusão (US2 + US3)**:
   - Abrir **Configurar** no canal criado, editar apenas o **Nome** e salvar; reabrir e confirmar que o token/segredo anterior permanece salvo e mascarado.
   - Alterar um campo técnico (ex.: `Webhook URL`, `Phone Number ID`, `SMTP Host` ou `Voice-App URL`), salvar e confirmar persistência após recarregar a página.
   - Testar exclusão do canal sem tentativas/jornadas vinculadas e confirmar remoção; validar bloqueio com mensagem clara caso haja vínculo ativo.
