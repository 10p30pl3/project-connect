# Quickstart: validar a Ordem Guiada de Configuração

**Feature**: `009-telephony-setup-order`

## 1. Verificações estáticas

```bash
npm run contracts && npm run typecheck && npm run check:gateway && npm run test:arch
npm test -w @voll/voice-gateway
npm test -w @voll/api -- test/telephony-setup.test.ts   # função pura; não precisa de PostgreSQL
npm run build
```

Esperado: tudo verde. Testes de integração `@voll/api` que usam banco só rodam com PostgreSQL disponível.

## 2. Cenários de validação na interface

1. **Workspace novo (US1)**: abrir Telefonia; o painel lista Tronco, Agente, Canal, Rotas, Ramal e Teste, todos pendentes, com o primeiro destacado como próximo passo.
2. **Progresso**: criar um agente; ao voltar, Agente fica completo e o próximo passo avança sem recarregar a página.
3. **Problema**: desativar o tronco; a etapa Tronco muda para problema e o tooltip explica o motivo.
4. **Modo Básico**: alternar para Básico; só Agente, Canal e Teste aparecem.
5. **Aviso sem bloqueio (US2)**: sem tronco ativo, abrir "Nova Rota de Saída"; aparece aviso com atalho e o botão Salvar continua habilitado.
6. **Admin comum**: na etapa Tronco não há atalho de criação, só o status e o motivo.
7. **Abas (US3)**: no Modo Avançado, abas de Telefonia na ordem Troncos, Rotas, Ramais, Gravações, Provedor IA, DSP.
8. **Live API (US4)**: editar agente, escolher OpenAI Live API; a lista mostra só o modelo Live. Trocar para OpenAI Realtime; a lista muda. Salvar, reabrir e conferir persistência.
