import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getPool, one, q } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';
import { signBody, type Deliver } from '../src/engine/maintenance.js';

export async function resetDb() {
  const pool = getPool();
  const tables = (
    await q(pool, `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'`)
  ).map((r) => `"${r.tablename}"`);
  await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const s = await seed({ withSampleMailing: false });
  // simulação determinística nos testes: sem retornos automáticos nem duplicatas
  await pool.query(
    `UPDATE connections SET config = jsonb_set(config, '{simulation}', (config->'simulation') || '{"noReturnRate":1,"duplicateRate":0}'::jsonb)`,
  );
  return s;
}

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false, loginRateMax: 10_000 });
  await app.ready();
  return app;
}

export async function login(app: FastifyInstance, email = 'admin@voll.local', password = 'Voll@2026') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login falhou: ${r.statusCode} ${r.body}`);
  const cookie = r.cookies.find((c) => c.name === 'vc_session')!;
  return `vc_session=${cookie.value}`;
}

export function api(app: FastifyInstance, cookie: string) {
  const call = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method: method as any, url: `/api${url}`, payload: payload as any, headers: { cookie, ...headers } });
    let body: any = r.body;
    try {
      body = r.json();
    } catch {
      /* texto */
    }
    return { status: r.statusCode, body };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p?: unknown, h?: Record<string, string>) => call('POST', u, p ?? {}, h),
    put: (u: string, p?: unknown) => call('PUT', u, p ?? {}),
    patch: (u: string, p?: unknown) => call('PATCH', u, p ?? {}),
    del: (u: string) => call('DELETE', u),
  };
}

export type Api = ReturnType<typeof api>;

export async function importCsv(a: Api, name: string, csv: string, acceptPartial = false) {
  const prev = await a.post('/imports/preview', { content: csv, delimiter: 'auto', hasHeader: true });
  if (prev.status !== 200) throw new Error(JSON.stringify(prev.body));
  const r = await a.post('/imports', { name, content: csv, delimiter: 'auto', hasHeader: true, mapping: prev.body.suggestedMapping, acceptPartial });
  return { preview: prev.body, result: r };
}

export async function catalog() {
  const pool = getPool();
  const journeys = await q(pool, `SELECT j.name, v.id FROM journeys j JOIN journey_versions v ON v.journey_id=j.id`);
  const strategies = await q(pool, `SELECT s.id AS strategy_id, s.name, v.id FROM strategies s JOIN strategy_versions v ON v.strategy_id=s.id`);
  const conns = await q(pool, `SELECT id, name, channel_type, webhook_secret, workspace_id FROM connections`);
  return {
    journey: (n: string) => journeys.find((j) => j.name === n)!.id as string,
    strategy: (n: string) => strategies.find((s) => s.name === n)!.id as string,
    strategyId: (n: string) => strategies.find((s) => s.name === n)!.strategy_id as string,
    connection: (ch: string) => conns.find((c) => c.channel_type === ch)!,
  };
}

/** Cria uma estratégia 24x7 com limites sob medida e devolve o id da versão. */
export async function makeStrategy(a: Api, name: string, over: { total?: number; daily?: number; retry?: number; maxPerDestination?: number; lease?: number } = {}) {
  const r = await a.post('/strategies', {
    name,
    config: {
      calendar: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', timezone: 'America/Sao_Paulo' },
      limits: { total: over.total ?? 10, daily: over.daily ?? 5, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: over.retry ?? 1, maxPerDestination: over.maxPerDestination ?? 3 },
      distribution: { batchSize: 50, maxPending: 100, leaseSeconds: over.lease ?? 60 },
      tabulationRules: { CONVERSION: 'FINISH_SUCCESS', NO_ANSWER: 'RETRY', CPC_NO_DEAL: 'RETRY', INVALID_NUMBER: 'NEXT_DESTINATION' },
    },
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { strategyId: r.body.id as string, versionId: r.body.latestVersion.id as string };
}

export async function createCampaign(
  a: Api,
  opts: { name: string; mailingId: string; journeyVersionId: string; strategyVersionId: string; listVersionId?: string; startMode?: 'NOW' | 'READY' },
) {
  const r = await a.post('/campaigns', { startMode: 'NOW', ...opts });
  if (r.status !== 201 && r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}

export async function enrollmentOf(campaignId: string, externalId: string) {
  return one(
    getPool(),
    `SELECT e.* FROM enrollments e JOIN contacts c ON c.id=e.contact_id WHERE e.campaign_id=$1 AND c.external_id=$2`,
    [campaignId, externalId],
  );
}

export async function attemptsOf(campaignId: string) {
  return q(getPool(), `SELECT * FROM attempts WHERE campaign_id=$1 ORDER BY created_at, id`, [campaignId]);
}

/** Entrega de webhooks pelo caminho HTTP real (inject), com assinatura. */
export function injectDeliver(app: FastifyInstance): Deliver {
  return async (connectionId, body, signature) => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/connectors/${connectionId}/events`,
      payload: body,
      headers: { 'content-type': 'application/json', 'x-voll-signature': signature },
    });
    return r.statusCode === 200;
  };
}

export async function postWebhook(app: FastifyInstance, conn: { id: string; webhook_secret: string }, event: Record<string, unknown>, badSig = false) {
  const body = JSON.stringify(event);
  return app.inject({
    method: 'POST',
    url: `/api/connectors/${conn.id}/events`,
    payload: body,
    headers: { 'content-type': 'application/json', 'x-voll-signature': badSig ? 'sha256=deadbeef' : signBody(body, conn.webhook_secret) },
  });
}

export const resultEvent = (providerAttemptId: string, tabulationCode: string, eventId = `ev-${Math.random().toString(36).slice(2)}`) => ({
  eventId,
  providerAttemptId,
  type: tabulationCode === 'OPT_OUT' ? 'OPT_OUT' : 'RESULT',
  occurredAt: new Date().toISOString(),
  tabulationCode,
});

export const SMALL_CSV = [
  'id;nome;telefone1;telefone2;whatsapp1;historico',
  '0001;Cliente Um;(11) 91111-0001;(11) 91111-0002;(11) 91111-0009;0',
  '0002;Cliente Dois;(11) 92222-0001;;;1',
].join('\n');
