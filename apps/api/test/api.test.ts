/** Contrato HTTP: autenticação, perfis, validação, importação (§26.5), destinos (AC12), rascunho, idempotência, simulação ponta a ponta. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool, one, q } from '../src/db/pool.js';
import { tick } from '../src/engine/maintenance.js';
import { setSimulationRandom } from '../src/connectors/simulated.js';
import { SMALL_CSV, api, catalog, importCsv, injectDeliver, login, makeApp, postWebhook, resetDb, type Api } from './helpers.js';

let app: FastifyInstance;
let a: Api;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  a = api(app, await login(app));
});

const strategyBody = (over: Record<string, unknown> = {}) => ({
  name: 'Teste',
  config: {
    calendar: { days: [1, 2, 3], start: '08:00', end: '20:00', timezone: 'America/Sao_Paulo' },
    limits: { total: 3, daily: 5, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
    retry: { intervalMinutes: 10, maxPerDestination: 2 },
    distribution: { batchSize: 10, maxPending: 10, leaseSeconds: 60 },
    tabulationRules: {},
    ...over,
  },
});

describe('autenticação e perfis', () => {
  it('401 sem sessão; me com sessão', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/campaigns' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['content-type']).toMatch(/problem\+json/);
    const me = await a.get('/auth/me');
    expect(me.body.role).toBe('ADMIN');
    expect(me.body.workspace.timezone).toBe('America/Sao_Paulo');
  });

  it('login inválido → 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@voll.local', password: 'errada' } });
    expect(r.statusCode).toBe(401);
  });

  it('403 para perfil sem permissão', async () => {
    const op = api(app, await login(app, 'operador@voll.local'));
    expect((await op.post('/strategies', strategyBody())).status).toBe(403);
    const an = api(app, await login(app, 'analista@voll.local'));
    expect((await an.put('/control', { dailyLimit: 1, totalLimit: 2, globalSuspension: false, reason: 'xxx' })).status).toBe(403);
    expect((await an.get('/campaigns')).status).toBe(200); // leitura liberada
    const sup = api(app, await login(app, 'supervisor@voll.local'));
    expect((await sup.get('/users')).status).toBe(403);
  });

  it('template protegido exige cópia (403)', async () => {
    const cat = await catalog();
    const r = await a.post(`/strategies/${cat.strategyId('Padrão cobrança')}/versions`, { config: strategyBody({ limits: { total: 10, daily: 3, scope: 'WORKSPACE' } }).config });
    expect(r.status).toBe(403);
  });
});

describe('validação (§26.2)', () => {
  it('422 com fieldErrors quando diário > total e horário inválido', async () => {
    const r = await a.post('/strategies', strategyBody({ limits: { total: 3, daily: 5, scope: 'WORKSPACE' }, calendar: { days: [1], start: '18:00', end: '08:00', timezone: 'America/Sao_Paulo' } }));
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors['config.limits.daily']).toMatch(/diário/);
    expect(r.body.fieldErrors['config.calendar.end']).toMatch(/posterior/);
  });

  it('controle central rejeita diário > total', async () => {
    const r = await a.put('/control', { dailyLimit: 5, totalLimit: 3, globalSuspension: false, reason: 'teste' });
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.dailyLimit).toBeTruthy();
  });
});

describe('importação (§16.1, §26.5)', () => {
  const csv = ['id;nome;telefone1;telefone2;valor', '000123;Ana Teste;(11) 98888-0001;(11) 98888-0001;1.234,56', '000124;Bia Teste;1,23E+10;;10'].join('\n');

  it('prévia aponta inconsistências por linha e sugere mapeamento', async () => {
    const r = await a.post('/imports/preview', { content: csv });
    expect(r.status).toBe(200);
    expect(r.body.validRows).toBe(0);
    expect(r.body.rejectedRows).toBe(2);
    expect(r.body.rows[0].errors.join()).toMatch(/repetido/);
    expect(r.body.rows[1].errors.join()).toMatch(/notação científica/);
    expect(r.body.suggestedMapping.find((m: any) => m.column === 'id').target).toBe('external_id');
  });

  it('importação parcial exige confirmação, preserva zeros e relatório de rejeitados', async () => {
    const ok = ['id;nome;telefone1;valor', '000123;Ana Teste;(11) 98888-0001;1.234,56', '000124;Bia Teste;123;10'].join('\n');
    const prev = await a.post('/imports/preview', { content: ok });
    const mapping = prev.body.suggestedMapping;
    const no = await a.post('/imports', { name: 'Parcial', content: ok, mapping });
    expect(no.status).toBe(422);
    expect(no.body.fieldErrors.acceptPartial).toBeTruthy();
    expect(await q(getPool(), `SELECT 1 FROM contacts`)).toHaveLength(0);
    const yes = await a.post('/imports', { name: 'Parcial', content: ok, mapping, acceptPartial: true });
    expect(yes.status).toBe(201);
    expect(yes.body).toMatchObject({ validRows: 1, rejectedRows: 1 });
    const c = await one(getPool(), `SELECT * FROM contacts`);
    expect(c.external_id).toBe('000123');
    expect(c.attributes.valor).toBe(1234.56);
    const rep = await a.get(`/mailings/${yes.body.mailingId}/versions/${yes.body.versionId}/rejected.csv`);
    expect(rep.status).toBe(200);
    expect(rep.body).toMatch(/linha_original/);
    expect(rep.body).toMatch(/3;000124/);
  });

  it('nenhum válido → 422', async () => {
    const prev = await a.post('/imports/preview', { content: csv });
    const r = await a.post('/imports', { name: 'X', content: csv, mapping: prev.body.suggestedMapping, acceptPartial: true });
    expect(r.status).toBe(422);
  });

  it('reimportação reutiliza o contato e não apaga destinos', async () => {
    await importCsv(a, 'Um', SMALL_CSV);
    const second = ['id;nome;telefone1', '0001;;(11) 97777-0001'].join('\n');
    await importCsv(a, 'Dois', second);
    const c = await one(getPool(), `SELECT * FROM contacts WHERE external_id='0001'`);
    expect(c.name).toBe('Cliente Um');
    const d = await q(getPool(), `SELECT * FROM contact_destinations WHERE contact_id=$1 AND channel_type='VOICE'`, [c.id]);
    expect(d).toHaveLength(3);
  });
});

describe('contatos e destinos (AC12)', () => {
  it('não duplica número no mesmo canal; mesmo número em canal digital é permitido', async () => {
    await importCsv(a, 'Um', SMALL_CSV);
    const c = await one(getPool(), `SELECT id FROM contacts WHERE external_id='0002'`);
    const dup = await a.post(`/contacts/${c.id}/destinations`, { channelType: 'VOICE', address: '(11) 92222-0001' });
    expect(dup.status).toBe(409);
    const wa = await a.post(`/contacts/${c.id}/destinations`, { channelType: 'WHATSAPP', address: '(11) 92222-0001' });
    expect(wa.status).toBe(201);
    const bad = await a.post(`/contacts/${c.id}/destinations`, { channelType: 'VOICE', address: '123' });
    expect(bad.status).toBe(422);
    const det = await a.get(`/contacts/${c.id}`);
    expect(det.body.destinations).toHaveLength(2);
    expect(det.body.counters.historyTotal).toBe(1);
    const list = await a.get('/contacts?q=Dois');
    expect(list.body.items[0].attempts).toEqual({ total: 1, new: 0 });
  });
});

describe('listas (§7)', () => {
  it('prévia, publicação de fotografia e de lista dinâmica', async () => {
    const imp = await importCsv(a, 'Base', SMALL_CSV);
    const prev = await a.post('/lists/preview', { mailingId: imp.result.body.mailingId, filters: [{ field: 'name', op: 'contains', value: 'Um' }] });
    expect(prev.body.selected).toBe(1);
    const empty = await a.post('/lists', { name: 'Vazia', mailingId: imp.result.body.mailingId, filters: [{ field: 'name', op: 'eq', value: 'ninguém' }], membershipMode: 'SNAPSHOT' });
    expect(empty.status).toBe(422);
    const snap = await a.post('/lists', { name: 'Foto', mailingId: imp.result.body.mailingId, filters: [], membershipMode: 'SNAPSHOT' });
    expect(snap.status).toBe(201);
    expect(snap.body.memberCount).toBe(2);
    const v2 = await a.post('/lists', { name: 'Foto', listId: snap.body.listId, mailingId: imp.result.body.mailingId, filters: [{ field: 'external_id', op: 'eq', value: '0001' }], membershipMode: 'DYNAMIC' });
    expect(v2.body.version).toBe(2);
    const members = await a.get(`/lists/versions/${snap.body.listVersionId}/members`);
    expect(members.body.items).toHaveLength(2); // v1 inalterada (AC20)
  });
});

describe('assistente e campanhas (§27)', () => {
  it('rascunho com concorrência otimista', async () => {
    const s1 = await a.put('/campaign-draft', { data: { step: 'MAILING' }, revision: 0 });
    expect(s1.body.revision).toBe(1);
    const s2 = await a.put('/campaign-draft', { data: { step: 'AUDIENCE' }, revision: 1 });
    expect(s2.body.revision).toBe(2);
    const stale = await a.put('/campaign-draft', { data: { step: 'CAMPAIGN' }, revision: 1 });
    expect(stale.status).toBe(409);
    expect((await a.get('/campaign-draft')).body.data.step).toBe('AUDIENCE');
  });

  it('preflight, criação idempotente, nome obrigatório e data passada', async () => {
    const imp = await importCsv(a, 'Base', SMALL_CSV);
    const cat = await catalog();
    const base = {
      mailingId: imp.result.body.mailingId,
      journeyVersionId: cat.journey('Discador'),
      strategyVersionId: cat.strategy('Padrão cobrança'),
    };
    const pf = await a.post('/campaigns/preflight', base);
    expect(pf.status).toBe(200);
    expect(pf.body.audience.count).toBe(2);
    expect(pf.body.costEstimate.value).toBeCloseTo(0.24, 4);
    expect(pf.body.strategy.summary).toMatch(/Até 10 tentativas/);
    expect((await a.post('/campaigns', { ...base, name: '', startMode: 'READY' })).body.fieldErrors.name).toBeTruthy();
    const past = await a.post('/campaigns', { ...base, name: 'X', startMode: 'SCHEDULE', scheduledAt: '2020-01-01T10:00:00-03:00' });
    expect(past.body.fieldErrors.scheduledAt).toMatch(/futura/);
    await a.put('/campaign-draft', { data: { step: 'CAMPAIGN' }, revision: 0 });
    const h = { 'idempotency-key': 'chave-123' };
    const c1 = await a.post('/campaigns', { ...base, name: 'Idem', startMode: 'READY' }, h);
    const c2 = await a.post('/campaigns', { ...base, name: 'Idem', startMode: 'READY' }, h);
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(200);
    expect(c2.body.id).toBe(c1.body.id);
    expect(c1.body.status).toBe('READY');
    expect((await a.get('/campaign-draft')).body).toBeNull(); // rascunho removido após sucesso
    // pronta não despacha
    expect(await q(getPool(), `SELECT 1 FROM enrollments WHERE campaign_id=$1`, [c1.body.id])).toHaveLength(0);
    const started = await a.post(`/campaigns/${c1.body.id}/start`);
    expect(started.body.status).toBe('RUNNING');
    expect((await a.post(`/campaigns/${c1.body.id}/start`)).status).toBe(409);
    expect((await a.post(`/campaigns/${c1.body.id}/close`, {})).status).toBe(422);
    expect((await a.post(`/campaigns/${c1.body.id}/close`, { reason: 'fim do teste' })).body.status).toBe('CLOSED');
  });

  it('webhook com assinatura inválida → 401; evento órfão não cria nada', async () => {
    const cat = await catalog();
    const conn = cat.connection('VOICE');
    const bad = await postWebhook(app, conn, { eventId: 'e1', providerAttemptId: 'p1', type: 'RESULT', occurredAt: new Date().toISOString(), tabulationCode: 'NO_ANSWER' }, true);
    expect(bad.statusCode).toBe(401);
    const orphan = await postWebhook(app, conn, { eventId: 'e2', providerAttemptId: 'nao-existe', type: 'RESULT', occurredAt: new Date().toISOString(), tabulationCode: 'NO_ANSWER' });
    expect(orphan.statusCode).toBe(200);
    expect((await one(getPool(), `SELECT status FROM connector_inbox WHERE external_event_id='e2'`)).status).toBe('ORPHAN');
  });
});

describe('ponta a ponta com o conector simulado', () => {
  it('worker reserva, envia, recebe webhooks reais (com duplicados) e aplica a estratégia', async () => {
    const imp = await importCsv(a, 'Base', SMALL_CSV);
    const cat = await catalog();
    // simulação: sempre retorna, sempre duplica
    await getPool().query(
      `UPDATE connections SET config = jsonb_set(config, '{simulation}', (config->'simulation') || '{"noReturnRate":0,"duplicateRate":1,"outcomes":{"NO_ANSWER":1}}'::jsonb)`,
    );
    setSimulationRandom(() => 0.5);
    const c = await a.post('/campaigns', {
      name: 'E2E', startMode: 'NOW', mailingId: imp.result.body.mailingId,
      journeyVersionId: cat.journey('Discador'), strategyVersionId: cat.strategy('Demonstração 24x7'),
    });
    const deliver = injectDeliver(app);
    const s1 = await tick({ deliver });
    expect(s1.reserved).toBe(2);
    expect(s1.dispatched).toBe(2);
    const s2 = await tick({ deliver, now: new Date(Date.now() + 30_000) });
    expect(s2.delivered).toBeGreaterThanOrEqual(4); // resultado + duplicata para cada tentativa
    const atts = await q(getPool(), `SELECT state, tabulation_code FROM attempts WHERE campaign_id=$1`, [c.body.id]);
    expect(atts.every((x) => x.state === 'FINALIZED' && x.tabulation_code === 'NO_ANSWER')).toBe(true);
    const dups = await q(getPool(), `SELECT 1 FROM attempt_events WHERE campaign_id=$1 AND duplicate`, [c.body.id]);
    expect(dups.length).toBe(2);
    const ops = await a.get(`/operation/attempts?campaignId=${c.body.id}`);
    expect(ops.body.total).toBe(2);
    const det = await a.get(`/attempts/${ops.body.items[0].id}`);
    expect(det.body.timeline.map((t: any) => t.eventType)).toEqual(
      expect.arrayContaining(['RESERVED', 'DISPATCH_ACCEPTED', 'RESULT', 'RULE_APPLIED', 'DUPLICATE_IGNORED']),
    );
    const camp = await a.get(`/campaigns/${c.body.id}`);
    expect(camp.body.operationalState).toBe('PROCESSING');
    const ov = await a.get('/overview');
    expect(ov.body.campaigns.running).toBe(1);
    setSimulationRandom(Math.random);
  });
});

describe('esteira de inteligência de contato & otimização de CPC (Produção + Laboratório)', () => {
  const richCsv = [
    'id;nome;telefone1;telefone2;whatsapp;idade;uf;cidade;valor;atraso',
    '001001;Dona Maria Aparecida;(11) 3222-4455;(11) 98888-1001;11988881001;68;SP;São Paulo;1450,00;45',
    '001002;Lucas Gabriel Silva;(71) 99111-2233;;71991112233;21;BA;Salvador;320,00;18',
    '001003;Carlos Eduardo Souza;(21) 98765-4321;(21) 2233-4455;21987654321;41;RJ;Rio de Janeiro;2890,00;90',
    '001004;Fernanda Oliveira;(92) 98111-3344;;92981113344;33;AM;Manaus;610,00;30',
    '001005;Seu José Raimundo;(85) 3456-7890;(85) 98877-6655;;72;CE;Fortaleza;980,00;60',
    '001006;Patrícia Costa;(41) 99988-7766;;41999887766;29;PR;Curitiba;540,00;15',
  ].join('\n');

  it('retorna o catálogo de estudo TIC Domicílios 2025, benchmark global e 29 hipóteses H-A..H-L', async () => {
    const study = await a.get('/intelligence/study');
    expect(study.status).toBe(200);
    expect(study.body.studyReference.ticDomicilios2025.length).toBeGreaterThanOrEqual(5);
    expect(study.body.studyReference.globalBenchmark.length).toBeGreaterThanOrEqual(8);
    expect(study.body.hypotheses.length).toBe(29);

    const hA4 = study.body.hypotheses.find((h: any) => h.code === 'H-A4');
    expect(hA4).toBeTruthy();

    const patched = await a.patch('/intelligence/hypotheses/H-A4', {
      enabled: true,
      productionWeight: 1.15,
      labWeight: 1.25,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.productionWeight).toBe(1.15);
    expect(patched.body.labWeight).toBe(1.25);
  });

  it('executa a esteira em PARALLEL_BOTH (Modo Produção + Modo Laboratório), gera 8 blocos, roda ondas e promove para Produção', async () => {
    const imp = await importCsv(a, 'Carteira Brasil CPC', richCsv);
    const mailingId = imp.result.body.mailingId as string;

    const runRes = await a.post('/intelligence/runs', {
      mailingId,
      mode: 'PARALLEL_BOTH',
      purposeCode: 'COBRANCA',
      purposePrompt: 'Renegociação amigável de faturas em atraso; minimizar R$ por CPC confirmado por tabulação.',
      labSamplePct: 35,
      plannedDaysWaves: 2,
      maxAttemptsPerContact: 4,
      maxAcceptableCpcBrl: 1.9,
    });
    expect(runRes.status).toBe(201);
    const run = runRes.body;
    expect(run.mode).toBe('PARALLEL_BOTH');
    expect(run.cohortSummary.totalReceived).toBe(6);
    expect(run.cohortSummary.eligibleCount).toBe(6);
    // Modo Produção envia imediatamente seus contatos para os acionadores (sem aguardar ondas de teste)
    expect(run.productionSummary.trackCount).toBeGreaterThan(0);
    expect(run.productionSummary.dispatchedToActuatorsCount).toBe(run.productionSummary.trackCount);
    expect(run.labSummary.sampleCount).toBeGreaterThan(0);

    // Consulta os planos individuais em 8 blocos
    const plansRes = await a.get(`/intelligence/runs/${run.id}/plans`);
    expect(plansRes.status).toBe(200);
    expect(plansRes.body.items.length).toBe(6);
    const firstPlan = plansRes.body.items[0];
    expect(firstPlan.blocks.bloco1_status_decisao).toBeTruthy();
    expect(firstPlan.blocks.bloco2_perfil_inferido).toBeTruthy();
    expect(firstPlan.blocks.bloco3_recomendacao_canal).toBeTruthy();
    expect(firstPlan.blocks.bloco4_janela_horaria).toBeTruthy();
    expect(firstPlan.blocks.bloco5_sequencia_cadencia).toBeTruthy();
    expect(firstPlan.blocks.bloco6_abordagem_linguagem).toBeTruthy();
    expect(firstPlan.blocks.bloco7_economia_cpc).toBeTruthy();
    expect(firstPlan.blocks.bloco8_explicabilidade_governanca).toBeTruthy();

    // Executa Onda 1 e Onda 2 do Modo Laboratório
    const w1 = await a.post(`/intelligence/runs/${run.id}/lab/next-wave`);
    expect(w1.status).toBe(200);
    expect(w1.body.completedWaves).toBe(1);

    const w2 = await a.post(`/intelligence/runs/${run.id}/lab/next-wave`);
    expect(w2.status).toBe(200);
    expect(w2.body.completedWaves).toBe(2);
    expect(w2.body.waves.length).toBe(2);
    expect(w2.body.labSummary.readyToPromote).toBe(true);

    // Aplica revisão humana (LGPD Art. 20) em um contato
    const ovr = await a.post(`/intelligence/runs/${run.id}/plans/${firstPlan.contactId}/override`, {
      decisionStatus: 'INCLUIDO_PRIORITARIO',
      primaryChannel: 'VOICE',
      reason: 'Cliente solicitou retorno exclusivamente por ligação matinal.',
    });
    expect(ovr.status).toBe(200);

    // Promove os ganhos validados do Laboratório para a Produção ("Colocar em Produção")
    const prom = await a.post(`/intelligence/runs/${run.id}/lab/promote`, {
      reason: 'Ganhos estatisticamente validados após 2 ondas no Modo Laboratório.',
    });
    expect(prom.status).toBe(200);
    expect(prom.body.status).toBe('PROMOTED_TO_PRODUCTION');
    expect(prom.body.promotedAt).toBeTruthy();

    // Exportações CSV e JSON
    const csvExp = await app.inject({
      method: 'GET',
      url: `/api/intelligence/runs/${run.id}/export.csv`,
      headers: { cookie: await login(app) },
    });
    expect(csvExp.statusCode).toBe(200);
    expect(csvExp.body).toContain('external_id;nome;track;status_decisao');
  });
});
