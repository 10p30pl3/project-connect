import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Smoke da interface com a API simulada via page.route (não depende do backend).
 * Executar com apenas o Vite no ar: `npm run dev:web` e `npx playwright test smoke-mocked`.
 * Os mocks ficam somente neste arquivo de teste.
 */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = {
  id: uuid(1),
  email: 'admin@voll.local',
  name: 'Admin Voll',
  role: 'ADMIN',
  organization: { id: uuid(2), name: 'Voll' },
  workspace: { id: uuid(3), name: 'Principal', timezone: 'America/Sao_Paulo' },
};
const CONFIG = {
  calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00', timezone: 'America/Sao_Paulo' },
  limits: { total: 6, daily: 3, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
  retry: { intervalMinutes: 60, maxPerDestination: 2 },
  distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
  tabulationRules: { CONVERSION: 'FINISH_SUCCESS', NO_ANSWER: 'RETRY' },
};
const TABS = [
  { id: uuid(40), code: 'CONVERSION', name: 'Acordo fechado', isCpc: true, isConversion: true, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE'] },
  { id: uuid(41), code: 'NO_ANSWER', name: 'Não atendeu', isCpc: false, isConversion: false, isOptOut: false, invalidatesDestination: false, channelTypes: ['VOICE'] },
];
const CAMPAIGN = {
  id: uuid(70),
  name: 'Campanha Mock',
  status: 'RUNNING',
  statusLabel: 'Em execução',
  operationalState: 'PROCESSING',
  operationalExplanation: 'Processando: reservas e envios em andamento.',
  audience: { type: 'LIST', name: 'Lista SP' },
  journeyName: 'Discador simples',
  strategyName: 'Padrão',
  strategyVersion: 1,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  progress: { members: 2, finished: 0, active: 2 },
  description: null,
  mailing: { id: uuid(10), name: 'Mailing Mock' },
  listVersion: { id: uuid(31), version: 1, membershipMode: 'SNAPSHOT' },
  journey: { id: uuid(50), version: 1, steps: [{ channelType: 'VOICE', connectionId: uuid(60), feedbackTimeoutMinutes: 30, connectionName: 'Discador simulado' }] },
  strategy: { id: uuid(20), version: 1, config: CONFIG },
  scheduledAt: null,
};
const ATTEMPT = {
  id: uuid(80),
  contact: { id: uuid(90), externalId: '001', name: 'Ana' },
  channelType: 'VOICE',
  connectionName: 'Discador simulado',
  destinationMasked: '1198****01',
  stage: 0,
  state: 'SENT',
  stateLabel: 'Enviado',
  tabulation: null,
  createdAt: new Date().toISOString(),
  sentAt: new Date().toISOString(),
  finalizedAt: null,
  nextAction: 'Aguardar retorno do canal',
};

async function mockApi(page: Page, state: { logged: boolean; draft: unknown; revision: number; createdKeys: string[] }) {
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const m = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});

    if (path === '/auth/me') return state.logged ? json(ME) : json({ type: 'unauthorized', title: 'Sessão expirada', status: 401 }, 401);
    if (path === '/auth/login') {
      const b = body();
      if (b.password !== 'Voll@2026') return json({ type: 'auth', title: 'E-mail ou senha inválidos', status: 401 }, 401);
      state.logged = true;
      return json({ user: ME });
    }
    if (path === '/overview')
      return json({ campaigns: { running: 1, paused: 0, ready: 0, scheduled: 0, completed: 0 }, attempts: { active: 1, reconciliation: 0, sentToday: 3 }, contacts: 3, mailings: 1, globalSuspension: false });
    if (path === '/campaign-draft') {
      if (m === 'GET') return json(state.draft ? { data: state.draft, revision: state.revision, updatedAt: new Date().toISOString() } : null);
      if (m === 'PUT') {
        const b = body();
        if (b.revision !== state.revision) return json({ type: 'conflict', title: 'Conflito', status: 409 }, 409);
        state.draft = b.data;
        state.revision += 1;
        return json({ revision: state.revision, updatedAt: new Date().toISOString() });
      }
      state.draft = null;
      state.revision = 0;
      return route.fulfill({ status: 204 });
    }
    if (path === '/mailings' && m === 'GET')
      return json({ items: [{ id: uuid(10), name: 'Mailing Mock', createdAt: new Date().toISOString(), recordCount: 3, lastVersion: { version: 1, validRows: 3, rejectedRows: 1, createdAt: new Date().toISOString() } }] });
    if (path === '/lists' && m === 'GET') return json({ items: [] });
    if (path === '/journeys')
      return json({ items: [{ id: uuid(50), name: 'Discador simples', latestVersion: { id: uuid(51), version: 1, steps: CAMPAIGN.journey.steps } }] });
    if (path === '/strategies' && m === 'GET')
      return json({ items: [{ id: uuid(20), name: 'Padrão', protected: true, latestVersion: { id: uuid(21), version: 1, config: CONFIG, publishedAt: new Date().toISOString() } }] });
    if (path === '/tabulations') return json({ items: TABS });
    if (path === '/imports/preview') {
      const b = body();
      return json({
        delimiter: ';',
        headers: ['id', 'nome', 'telefone1', 'cidade'],
        totalRows: 4,
        suggestedMapping: [
          { column: 'id', target: 'external_id', type: 'text', required: true },
          { column: 'nome', target: 'name', type: 'text', required: false },
          { column: 'telefone1', target: 'phone1', type: 'text', required: false },
          { column: 'cidade', target: 'attribute', attributeName: 'cidade', type: 'text', required: false },
        ],
        rows: [
          { rowNumber: 2, values: { id: '001', nome: 'Ana', telefone1: '11987650001', cidade: 'SP' }, errors: [] },
          { rowNumber: 4, values: { id: '003', nome: 'Carla', telefone1: '123', cidade: 'RJ' }, errors: ['telefone1: deve ter de 10 a 15 dígitos'] },
        ],
        validRows: 3,
        rejectedRows: 1,
        schemaErrors: [],
        _mapping: b.mapping,
      });
    }
    if (path === '/imports') {
      const b = body();
      if (!b.acceptPartial) return json({ type: 'v', title: 'Confirme a importação parcial', status: 422, fieldErrors: { acceptPartial: 'Confirme' } }, 422);
      return json({ mailingId: uuid(10), versionId: uuid(11), validRows: 3, rejectedRows: 1 });
    }
    if (path === '/lists/preview')
      return json({
        selected: (body().filters ?? []).length ? 2 : 3,
        excluded: [{ reason: 'DNC', count: 1 }],
        sample: [{ contactId: uuid(90), externalId: '001', name: 'Ana', fields: { cidade: 'SP' } }],
        fields: [
          { key: 'cidade', type: 'text' },
          { key: 'nome', type: 'text' },
        ],
      });
    if (path === '/lists' && m === 'POST') return json({ listId: uuid(30), listVersionId: uuid(31), version: 1, memberCount: 2 });
    if (path === '/campaigns/preflight')
      return json({
        audience: { type: 'LIST', name: 'Lista SP', count: 2 },
        journey: { name: 'Discador simples', steps: CAMPAIGN.journey.steps },
        strategy: { name: 'Padrão', version: 1, summary: ['Até 6 tentativas no total e 3 por dia'] },
        nextWindow: new Date(Date.now() + 3600_000).toISOString(),
        costEstimate: { value: null, premise: 'Uma tentativa por contato no primeiro canal; tarifa não informada.' },
        warnings: [],
      });
    if (path === '/campaigns' && m === 'POST') {
      const b = body();
      if (!b.name) return json({ type: 'v', title: 'Verifique', status: 422, fieldErrors: { name: 'Informe o nome da campanha' } }, 422);
      state.createdKeys.push(req.headers()['idempotency-key']);
      return json({ ...CAMPAIGN, name: b.name });
    }
    if (path === '/campaigns' && m === 'GET') return json({ items: [CAMPAIGN] });
    if (path === `/campaigns/${CAMPAIGN.id}`) return json(CAMPAIGN);
    if (path === `/campaigns/${CAMPAIGN.id}/attempts`) return json({ items: [ATTEMPT], nextCursor: null, total: 1 });
    if (path === `/campaigns/${CAMPAIGN.id}/eligibility`)
      return json({
        evaluatedAt: new Date().toISOString(),
        cards: { members: 2, eligibleNow: 0, reserved: 0, pending: 1, reconciliation: 0, finished: 0 },
        reasons: [{ reason: 'ACTIVE_RESERVATION', count: 1 }],
        items: [
          {
            enrollmentId: uuid(100),
            contact: ATTEMPT.contact,
            enrollmentState: 'ACTIVE',
            stage: 0,
            channelType: 'VOICE',
            destinationMasked: '1198****01',
            eligible: false,
            primaryReason: 'ACTIVE_RESERVATION',
            reasons: ['ACTIVE_RESERVATION', 'OUTSIDE_CALENDAR'],
            counters: { total: null, today: 1, totalLimit: 6, dailyLimit: 3 },
            nextEligibleAt: null,
            strategyVersion: 1,
          },
        ],
        nextCursor: null,
      });
    if (path === `/campaigns/${CAMPAIGN.id}/indicators`)
      return json({
        sent: 1,
        contactsWorked: 1,
        cpcContacts: 0,
        cpcRate: 0,
        conversions: 0,
        cost: { known: 0, coverage: { withCost: 0, total: 1 }, partial: true },
        costPerCpc: null,
        costPerConversion: null,
        pending: { reserved: 0, sent: 1, awaitingFeedback: 0, reconciliation: 0 },
        byChannel: [{ channelType: 'VOICE', sent: 1, cpc: 0, conversions: 0 }],
        byTabulation: [],
      });
    if (path === `/attempts/${ATTEMPT.id}`)
      return json({
        attempt: {
          ...ATTEMPT,
          traceId: uuid(81),
          strategyVersionId: uuid(21),
          journeyVersionId: uuid(51),
          tariffSnapshot: null,
          costConfirmed: null,
          leaseUntil: null,
          feedbackDeadline: null,
          providerAttemptId: 'sim-1',
        },
        explanation: { whatHappened: 'Enviado ao canal.', why: 'O canal aceitou o envio.', nextAction: 'Aguardar retorno do canal.' },
        timeline: [
          { id: 1, eventType: 'RESERVED', label: 'Contato reservado', fromState: null, toState: 'RESERVED', reasonCode: null, duplicate: false, occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), data: {} },
          { id: 2, eventType: 'DISPATCH_ACCEPTED', label: 'Enviado ao canal', fromState: 'RESERVED', toState: 'SENT', reasonCode: null, duplicate: false, occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), data: {} },
          { id: 3, eventType: 'DELIVERY_CONFIRMED', label: 'Retorno associado à tentativa', fromState: 'SENT', toState: 'SENT', reasonCode: null, duplicate: true, occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), data: {} },
        ],
      });
    return json({ type: 'not_found', title: `Mock ausente: ${m} ${path}`, status: 404 }, 404);
  });
}

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true });
};

test.describe('smoke com API simulada', () => {
  test('login, visão geral, assistente completo e detalhe da campanha', async ({ page }) => {
    const state = { logged: false, draft: null as unknown, revision: 0, createdKeys: [] as string[] };
    await mockApi(page, state);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('E-mail').fill('admin@voll.local');
    await page.getByLabel('Senha').fill('errada');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('E-mail ou senha inválidos')).toBeVisible();
    await page.getByLabel('Senha').fill('Voll@2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Olá, Admin/ })).toBeVisible();
    await shot(page, '01-overview');

    await page.getByRole('link', { name: 'Nova campanha' }).click();
    await expect(page.getByRole('heading', { name: /Etapa 1 de 4: Mailing/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Público/ })).toBeDisabled();
    await page.getByLabel('Nome do mailing').fill('Mailing Mock');
    await page.getByTestId('import-content').fill('id;nome;telefone1;cidade\n001;Ana;11987650001;SP');
    await page.getByRole('button', { name: 'Continuar para campos' }).click();
    await page.getByRole('button', { name: 'Conferir registros' }).click();
    await expect(page.getByText('telefone1: deve ter de 10 a 15 dígitos')).toBeVisible();
    await shot(page, '02-conferencia');
    await page.getByRole('button', { name: 'Importar 3 válidos' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Importar 3 válidos' }).click();

    await expect(page.getByRole('heading', { name: /Etapa 2 de 4: Público/ })).toBeVisible();
    await expect(page.getByTestId('draft-saved')).toBeVisible();
    await page.getByRole('radio', { name: /Filtrar e criar lista/ }).check();
    await page.getByLabel('Nome da lista').fill('Lista SP');
    await page.getByRole('button', { name: 'Adicionar filtro' }).click();
    await page.getByLabel('Campo do filtro 1').selectOption({ label: 'cidade' });
    await page.getByLabel('Valor do filtro 1').fill('SP');
    // continuar com prévia pendente é bloqueado
    await page.getByRole('button', { name: 'Continuar para acionamento' }).click();
    await expect(page.getByText(/alterações de filtros não aplicadas/)).toBeVisible();
    await shot(page, '03-publico');
    await page.getByRole('button', { name: 'Aplicar filtros na prévia' }).click();
    await expect(page.getByTestId('preview-selected')).toHaveText('2');
    await page.getByRole('button', { name: 'Continuar para acionamento' }).click();

    await expect(page.getByRole('heading', { name: /Etapa 3 de 4: Acionamento/ })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar para campanha' }).click();
    await expect(page.getByText('Escolha uma jornada publicada')).toBeVisible();
    await page.locator('#journey-group label').first().click();
    await page.getByRole('radio', { name: /Padrão/ }).check();
    await expect(page.getByText('Resumo da estratégia Padrão')).toBeVisible();
    await shot(page, '04-acionamento');
    await page.getByRole('button', { name: 'Continuar para campanha' }).click();

    await expect(page.getByRole('heading', { name: /Etapa 4 de 4: Campanha/ })).toBeVisible();
    await expect(page.getByText('não informada', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Criar e iniciar' }).click();
    await expect(page.getByText('Informe o nome da campanha')).toBeVisible();
    await expect(page.getByLabel('Nome da campanha')).toBeFocused();
    await shot(page, '05-campanha');
    await page.getByLabel('Nome da campanha').fill('Campanha Mock');
    await page.getByRole('button', { name: 'Criar e iniciar' }).click();
    await expect(page).toHaveURL(new RegExp(`/campanhas/${CAMPAIGN.id}`));
    expect(state.createdKeys).toHaveLength(1);
    expect(state.createdKeys[0]).toMatch(/[0-9a-f-]{36}/);

    await page.getByRole('tab', { name: 'Tentativas' }).click();
    await page.getByTestId('attempts-table').getByRole('button', { name: 'Ver tentativa' }).click();
    const drawer = page.getByRole('dialog', { name: 'Detalhe da tentativa' });
    await expect(drawer.getByText('Aguardar retorno do canal.')).toBeVisible();
    await expect(drawer.getByText('Duplicado — ignorado, sem novo efeito')).toBeVisible();
    await shot(page, '06-tentativa');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await page.getByRole('tab', { name: 'Elegibilidade e reservas' }).click();
    await expect(page.getByText('desconhecido', { exact: false }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Indicadores' }).click();
    await expect(page.getByText(/custo exibido é parcial/)).toBeVisible();
    await shot(page, '07-indicadores');
  });

  test('saída protegida do assistente e barra móvel', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const state = { logged: true, draft: { step: 'MAILING', mailingId: uuid(10), extra: { mailingSource: 'MAILING' } }, revision: 1, createdKeys: [] };
    await mockApi(page, state);
    await page.goto('/campanhas/nova');
    await expect(page.getByText('Retomamos seu rascunho')).toBeVisible();
    const nav = page.getByTestId('mobile-nav');
    for (const n of ['Início', 'Campanhas', 'Listas', 'Tentativas', 'Mais']) await expect(nav.getByRole('link', { name: n })).toBeInViewport();
    await nav.getByRole('link', { name: 'Campanhas' }).click();
    const dlg = page.getByRole('dialog', { name: 'Sair da preparação?' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Continuar editando' })).toBeVisible();
    await shot(page, '08-mobile-saida');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(page).toHaveURL(/\/campanhas\/nova/);
    await nav.getByRole('link', { name: 'Campanhas' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar rascunho e sair' }).click();
    await expect(page).toHaveURL(/\/campanhas$/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBeFalsy();
    await ctx.close();
  });
});
