/**
 * Invariantes do motor (plano v2.2): AC01–AC08, AC24, AC25, OP01–OP03, CT01, CS01, CS02.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPool, one, q, closePool } from '../src/db/pool.js';
import { reserveEnrollment, runReservations } from '../src/engine/reserve.js';
import { processOutbox } from '../src/engine/dispatch.js';
import { expireLeases, markFeedbackTimeouts } from '../src/engine/maintenance.js';
import {
  SMALL_CSV, api, attemptsOf, catalog, createCampaign, enrollmentOf, importCsv, login, makeApp, makeStrategy,
  postWebhook, resetDb, resultEvent, type Api,
} from './helpers.js';

let app: FastifyInstance;
let a: Api;
let mailingId: string;
let cat: Awaited<ReturnType<typeof catalog>>;
const plus = (min: number) => new Date(Date.now() + min * 60_000);

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
  const imp = await importCsv(a, 'Pequeno', SMALL_CSV);
  expect(imp.result.status).toBe(201);
  mailingId = imp.result.body.mailingId;
  cat = await catalog();
});

async function campaign(name: string, strategyVersionId?: string, journey = 'Discador') {
  return createCampaign(a, {
    name,
    mailingId,
    journeyVersionId: cat.journey(journey),
    strategyVersionId: strategyVersionId ?? cat.strategy('Demonstração 24x7'),
  });
}

async function reserveAndSend(campaignId: string, externalId: string, now = new Date()) {
  const e = await enrollmentOf(campaignId, externalId);
  const r = await reserveEnrollment(campaignId, e.id, now);
  expect(r).toHaveProperty('reserved');
  await processOutbox(50, now);
  const at = await one(getPool(), `SELECT * FROM attempts WHERE id=$1`, [(r as any).reserved]);
  return at;
}

describe('C01 reserva e elegibilidade', () => {
  it('AC01/OP01: reservas concorrentes do mesmo cliente em duas campanhas → apenas uma', async () => {
    const c1 = await campaign('A');
    const c2 = await campaign('B');
    const e1 = await enrollmentOf(c1.id, '0001');
    const e2 = await enrollmentOf(c2.id, '0001');
    const results = await Promise.all([
      reserveEnrollment(c1.id, e1.id),
      reserveEnrollment(c2.id, e2.id),
      reserveEnrollment(c1.id, e1.id),
      reserveEnrollment(c2.id, e2.id),
    ]);
    expect(results.filter((r) => 'reserved' in r)).toHaveLength(1);
    const [{ n }] = await q(
      getPool(),
      `SELECT count(*)::int AS n FROM attempts a JOIN contacts c ON c.id=a.contact_id
        WHERE c.external_id='0001' AND a.state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')`,
    );
    expect(n).toBe(1);
    // capacidade reservada atomicamente junto com a tentativa
    const [{ k }] = await q(getPool(), `SELECT count(*)::int AS k FROM counter_consumptions WHERE kind='PROVISIONAL'`);
    expect(k).toBe(1);
  });

  it('AC02: reserva não enviada que expira não consome tentativa nem custo', async () => {
    const c = await campaign('Expira');
    const e = await enrollmentOf(c.id, '0001');
    const r = await reserveEnrollment(c.id, e.id);
    expect(r).toHaveProperty('reserved');
    expect(await expireLeases(plus(5))).toBe(1);
    const at = await one(getPool(), `SELECT * FROM attempts WHERE id=$1`, [(r as any).reserved]);
    expect(at.state).toBe('RELEASED');
    expect(at.sent_at).toBeNull();
    const cons = await one(getPool(), `SELECT kind FROM counter_consumptions WHERE attempt_id=$1`, [at.id]);
    expect(cons.kind).toBe('RELEASED');
    const ind = await a.get(`/campaigns/${c.id}/indicators`);
    expect(ind.body.sent).toBe(0);
    expect(ind.body.cost.known).toBe(0);
    // dispatch posterior não envia reserva vencida
    await processOutbox(50, plus(5));
    expect((await one(getPool(), `SELECT state FROM attempts WHERE id=$1`, [at.id])).state).toBe('RELEASED');
  });

  it('AC03/CT01: DNC após a reserva impede o envio e cancela; DNC prevalece na elegibilidade', async () => {
    const c = await campaign('DNC');
    const e = await enrollmentOf(c.id, '0001');
    const r = await reserveEnrollment(c.id, e.id);
    // bloqueio gravado sem passar pela API (corrida): a revalidação antes do envio cancela
    await getPool().query(
      `INSERT INTO blocks (workspace_id, scope, contact_id, reason) SELECT workspace_id, 'CONTACT', contact_id, 'teste' FROM attempts WHERE id=$1`,
      [(r as any).reserved],
    );
    await processOutbox();
    const at = await one(getPool(), `SELECT * FROM attempts WHERE id=$1`, [(r as any).reserved]);
    expect(at.state).toBe('CANCELLED');
    expect(at.state_reason).toBe('DNC');
    expect(at.sent_at).toBeNull();
    expect((await one(getPool(), `SELECT kind FROM counter_consumptions WHERE attempt_id=$1`, [at.id])).kind).toBe('RELEASED');
    // nunca mais é reservado e a elegibilidade explica o motivo
    expect(await reserveEnrollment(c.id, e.id, plus(10))).toEqual({ skipped: 'DNC' });
    const el = await a.get(`/campaigns/${c.id}/eligibility`);
    const row = el.body.items.find((i: any) => i.contact.externalId === '0001');
    expect(row.primaryReason).toBe('DNC');
  });

  it('AC03: bloqueio pela API cancela reservas não enviadas', async () => {
    const c = await campaign('DNC API');
    const e = await enrollmentOf(c.id, '0002');
    const r = await reserveEnrollment(c.id, e.id);
    expect(r).toHaveProperty('reserved');
    const res = await a.post('/blocks', { scope: 'CONTACT', contactId: e.contact_id, reason: 'Pedido do cliente' });
    expect(res.status).toBe(201);
    expect((await one(getPool(), `SELECT state FROM attempts WHERE id=$1`, [(r as any).reserved])).state).toBe('CANCELLED');
  });

  it('AC05/OP05: envio sem retorno vira reconciliação visível e bloqueia novo envio', async () => {
    const c = await campaign('Sem retorno');
    const at = await reserveAndSend(c.id, '0001');
    expect(at.state).toBe('SENT');
    expect(await markFeedbackTimeouts(plus(10))).toBe(1);
    const after = await one(getPool(), `SELECT * FROM attempts WHERE id=$1`, [at.id]);
    expect(after.state).toBe('RECONCILIATION');
    expect(after.state_reason).toBe('NO_RETURN');
    const r = await runReservations(c.id, plus(10));
    const again = await q(getPool(), `SELECT id FROM attempts WHERE contact_id=$1 AND id <> $2 AND state <> 'RELEASED'`, [at.contact_id, at.id]);
    expect(again).toHaveLength(0);
    expect(r.reserved).toBe(1); // somente o outro cliente
    const el = await a.get(`/campaigns/${c.id}/eligibility?reason=RECONCILIATION`);
    expect(el.body.items.map((i: any) => i.contact.externalId)).toContain('0001');
    const detail = await a.get(`/attempts/${at.id}`);
    expect(detail.body.explanation.why).toMatch(/novo envio/);
  });

  it('AC06/OP02: campanha pausada recebe resultados e não produz novos envios', async () => {
    const c = await campaign('Pausa');
    const sent = await reserveAndSend(c.id, '0001');
    const e2 = await enrollmentOf(c.id, '0002');
    const r2 = await reserveEnrollment(c.id, e2.id);
    expect((await a.post(`/campaigns/${c.id}/pause`)).status).toBe(200);
    // resultado chega com a campanha pausada
    const res = await postWebhook(app, cat.connection('VOICE'), resultEvent(sent.provider_attempt_id, 'NO_ANSWER'));
    expect(res.statusCode).toBe(200);
    expect((await one(getPool(), `SELECT state FROM attempts WHERE id=$1`, [sent.id])).state).toBe('FINALIZED');
    // reserva pendente não é enviada
    await processOutbox();
    const p = await one(getPool(), `SELECT state, state_reason FROM attempts WHERE id=$1`, [(r2 as any).reserved]);
    expect(p).toEqual({ state: 'CANCELLED', state_reason: 'CAMPAIGN_PAUSED' });
    expect((await runReservations(c.id, plus(5))).reserved).toBe(0);
    // retomada volta a operar
    expect((await a.post(`/campaigns/${c.id}/resume`)).status).toBe(200);
    expect((await runReservations(c.id, plus(5))).reserved).toBeGreaterThan(0);
  });
});

describe('C02 contadores compartilhados e idempotência', () => {
  it('AC04/OB03: webhook repetido não duplica contagem, custo nem efeitos', async () => {
    const c = await campaign('Duplicado');
    const at = await reserveAndSend(c.id, '0001');
    const ev = resultEvent(at.provider_attempt_id, 'CPC_NO_DEAL', 'evt-fixo-1');
    const r1 = await postWebhook(app, cat.connection('VOICE'), ev);
    const r2 = await postWebhook(app, cat.connection('VOICE'), ev);
    expect(r1.json()).toEqual({ accepted: true, duplicate: false });
    expect(r2.json()).toEqual({ accepted: true, duplicate: true });
    const cons = await q(getPool(), `SELECT * FROM counter_consumptions WHERE contact_id=$1`, [at.contact_id]);
    expect(cons).toHaveLength(1);
    expect(cons[0].kind).toBe('CONFIRMED');
    const dup = await q(getPool(), `SELECT * FROM attempt_events WHERE attempt_id=$1 AND duplicate`, [at.id]);
    expect(dup).toHaveLength(1);
    const ind = (await a.get(`/campaigns/${c.id}/indicators`)).body;
    expect(ind.sent).toBe(1);
    expect(ind.cpcContacts).toBe(1);
    expect(ind.cost.known).toBeCloseTo(0.12, 4);
    expect(ind.costPerCpc).toBeCloseTo(0.12, 4);
    // repetir pelo simulador também é ignorado
    const rep = await a.post(`/sim/attempts/${at.id}/repeat-last-event`);
    expect(rep.body.duplicate).toBe(true);
  });

  it('AC08/AC24: três retornos da mesma tentativa = um envio; resultado tardio não reabre', async () => {
    const c = await campaign('Três retornos');
    const at = await reserveAndSend(c.id, '0001');
    const conn = cat.connection('VOICE');
    await postWebhook(app, conn, resultEvent(at.provider_attempt_id, 'CONVERSION'));
    await postWebhook(app, conn, resultEvent(at.provider_attempt_id, 'NO_ANSWER'));
    await postWebhook(app, conn, { eventId: 'x-unk', providerAttemptId: at.provider_attempt_id, type: 'RESULT_UNKNOWN', occurredAt: new Date().toISOString() });
    const fin = await one(getPool(), `SELECT * FROM attempts WHERE id=$1`, [at.id]);
    expect(fin.state).toBe('FINALIZED');
    expect(fin.tabulation_code).toBe('CONVERSION');
    expect(await q(getPool(), `SELECT 1 FROM counter_consumptions WHERE attempt_id=$1`, [at.id])).toHaveLength(1);
    const e = await enrollmentOf(c.id, '0001');
    expect(e.state).toBe('DONE_SUCCESS');
    const ind = (await a.get(`/campaigns/${c.id}/indicators`)).body;
    expect(ind.sent).toBe(1);
    expect(ind.conversions).toBe(1);
    const late = await q(getPool(), `SELECT 1 FROM attempt_events WHERE attempt_id=$1 AND event_type='LATE_RESULT'`, [at.id]);
    expect(late).toHaveLength(1);
  });

  it('AC07: teto diário compartilhado entre duas campanhas e dois canais', async () => {
    const s = await makeStrategy(a, 'Diário 2', { daily: 2, total: 10 });
    const ca = await campaign('Discador', s.versionId, 'Discador');
    const cb = await campaign('WhatsApp', s.versionId, 'WhatsApp → Discador');
    const t1 = await reserveAndSend(ca.id, '0001');
    await postWebhook(app, cat.connection('VOICE'), resultEvent(t1.provider_attempt_id, 'NO_ANSWER'));
    const t2 = await reserveAndSend(cb.id, '0001');
    expect(t2.channel_type).toBe('WHATSAPP');
    await postWebhook(app, cat.connection('WHATSAPP'), resultEvent(t2.provider_attempt_id, 'NO_ANSWER'));
    const e = await enrollmentOf(ca.id, '0001');
    expect(await reserveEnrollment(ca.id, e.id, plus(3))).toEqual({ skipped: 'DAILY_LIMIT' });
    const el = await a.get(`/campaigns/${ca.id}/eligibility`);
    const row = el.body.items.find((i: any) => i.contact.externalId === '0001');
    expect(row.reasons).toContain('DAILY_LIMIT');
    expect(row.counters.today).toBe(2);
  });

  it('limite institucional prevalece sobre o template (§19)', async () => {
    const c = await campaign('Institucional');
    const put = await a.put('/control', { dailyLimit: 1, totalLimit: null, globalSuspension: false, reason: 'teste de limite' });
    expect(put.status).toBe(200);
    const t1 = await reserveAndSend(c.id, '0001');
    await postWebhook(app, cat.connection('VOICE'), resultEvent(t1.provider_attempt_id, 'NO_ANSWER'));
    const e = await enrollmentOf(c.id, '0001');
    expect(await reserveEnrollment(c.id, e.id, plus(3))).toEqual({ skipped: 'DAILY_LIMIT' });
  });

  it('AC25: a tentativa mantém a versão da estratégia usada na reserva', async () => {
    const s = await makeStrategy(a, 'Versionada');
    const c = await campaign('Versão', s.versionId);
    const at = await reserveAndSend(c.id, '0001');
    const v2 = await a.post(`/strategies/${s.strategyId}/versions`, {
      config: {
        calendar: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', timezone: 'America/Sao_Paulo' },
        limits: { total: 10, daily: 5, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
        retry: { intervalMinutes: 1, maxPerDestination: 3 },
        distribution: { batchSize: 50, maxPending: 100, leaseSeconds: 60 },
        tabulationRules: { NO_ANSWER: 'FINISH_FAIL' },
      },
    });
    expect(v2.status).toBe(201);
    // troca de template na campanha afeta novas entregas, não a tentativa em andamento
    await getPool().query(`UPDATE campaigns SET strategy_version_id=$2 WHERE id=$1`, [c.id, v2.body.latestVersion.id]);
    await postWebhook(app, cat.connection('VOICE'), resultEvent(at.provider_attempt_id, 'NO_ANSWER'));
    const e = await enrollmentOf(c.id, '0001');
    expect(e.state).toBe('ACTIVE'); // regra da v1 (RETRY), não da v2 (FINISH_FAIL)
    const fin = await one(getPool(), `SELECT strategy_version_id FROM attempts WHERE id=$1`, [at.id]);
    expect(fin.strategy_version_id).toBe(s.versionId);
    // versão publicada é imutável
    await expect(getPool().query(`UPDATE strategy_versions SET config='{}' WHERE id=$1`, [s.versionId])).rejects.toThrow(/imutável/);
  });

  it('§6.2: alterna destino e avança/conclui ao esgotar os destinos sem reiniciar', async () => {
    const s = await makeStrategy(a, 'Um por destino', { maxPerDestination: 1 });
    const c = await campaign('Destinos', s.versionId);
    const conn = cat.connection('VOICE');
    const t1 = await reserveAndSend(c.id, '0001');
    await postWebhook(app, conn, resultEvent(t1.provider_attempt_id, 'NO_ANSWER'));
    const t2 = await reserveAndSend(c.id, '0001', plus(2));
    expect(t2.destination_id).not.toBe(t1.destination_id);
    await postWebhook(app, conn, resultEvent(t2.provider_attempt_id, 'NO_ANSWER'));
    const e = await enrollmentOf(c.id, '0001');
    expect(e.state).toBe('DONE_FAIL');
    expect(e.terminal_reason).toBe('EXHAUSTED');
  });
});

describe('C05 custos', () => {
  it('CS01/CS02: tarifa preservada no envio; desconhecida ≠ zero; custo parcial omite unitários', async () => {
    const c = await campaign('Custos');
    const conn = cat.connection('VOICE');
    const t1 = await reserveAndSend(c.id, '0001');
    expect(t1.tariff_snapshot).toBeCloseTo(0.12, 4);
    expect((await a.patch(`/connections/${conn.id}`, { tariff: null })).status).toBe(200);
    const t2 = await reserveAndSend(c.id, '0002');
    expect(t2.tariff_snapshot).toBeNull();
    expect((await one(getPool(), `SELECT tariff_snapshot FROM attempts WHERE id=$1`, [t1.id])).tariff_snapshot).toBeCloseTo(0.12, 4);
    await postWebhook(app, conn, resultEvent(t1.provider_attempt_id, 'CPC_NO_DEAL'));
    const ind = (await a.get(`/campaigns/${c.id}/indicators`)).body;
    expect(ind.cost.partial).toBe(true);
    expect(ind.cost.coverage).toEqual({ withCost: 1, total: 2 });
    expect(ind.costPerCpc).toBeNull();
    // zero explícito é preservado como zero
    await a.patch(`/connections/${conn.id}`, { tariff: 0 });
    await postWebhook(app, conn, resultEvent(t2.provider_attempt_id, 'NO_ANSWER'));
    const t3 = await reserveAndSend(c.id, '0002', plus(2));
    expect(t3.tariff_snapshot).toBe(0);
  });
});

describe('opt-out', () => {
  it('OPT_OUT do canal bloqueia o cliente e encerra inscrições em todas as campanhas', async () => {
    const c1 = await campaign('O1');
    const c2 = await campaign('O2');
    const at = await reserveAndSend(c1.id, '0001');
    await postWebhook(app, cat.connection('VOICE'), resultEvent(at.provider_attempt_id, 'OPT_OUT'));
    const b = await one(getPool(), `SELECT origin FROM blocks WHERE contact_id=$1 AND revoked_at IS NULL`, [at.contact_id]);
    expect(b.origin).toBe('OPT_OUT');
    expect((await enrollmentOf(c2.id, '0001')).state).toBe('CANCELLED');
    expect((await attemptsOf(c2.id)).length).toBe(0);
  });
});
