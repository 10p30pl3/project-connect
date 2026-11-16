import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'node:http';
import { closePool, getPool, one, q } from '../src/db/pool.js';
import { processOutbox } from '../src/engine/dispatch.js';
import { runReservations } from '../src/engine/reserve.js';
import { tick } from '../src/engine/maintenance.js';
import {
  api,
  attemptsOf,
  createCampaign,
  importCsv,
  login,
  makeApp,
  makeStrategy,
  resetDb,
  type Api,
} from './helpers.js';

type FakeTrunk = {
  id: string;
  name: string;
  direction: 'inbound' | 'outbound' | 'both';
  active: boolean;
  online: boolean;
  maxChannels: number;
  activeCalls: number;
};

let app: FastifyInstance;
let managerApi: Api;
let supervisorApi: Api;
let operatorApi: Api;
let mailingId: string;
let voiceJourneyVersionId: string;
let voiceConnId: string;
let strategyVersionId: string;
let fakeServer: http.Server;
let fakeBaseUrl: string;
let fakeTrunks: FakeTrunk[] = [];
let recordedCallRequests: any[] = [];
let force429 = false;

async function setupFakeGateway() {
  fakeServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/trunks/availability') {
      const requestedIds = url.searchParams.get('trunkIds')?.split(',').filter(Boolean) ?? [];
      const trunks = fakeTrunks
        .filter((t) => requestedIds.length === 0 || requestedIds.includes(t.id))
        .map((t) => ({
          ...t,
          availableChannels:
            t.active && t.online && t.direction !== 'inbound'
              ? Math.max(0, t.maxChannels - t.activeCalls)
              : 0,
        }));
      const totalChannels = trunks
        .filter((t) => t.active && t.online && t.direction !== 'inbound')
        .reduce((s, t) => s + t.maxChannels, 0);
      const activeCalls = trunks.reduce((s, t) => s + t.activeCalls, 0);
      const availableChannels = trunks.reduce((s, t) => s + t.availableChannels, 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          trunks,
          summary: {
            totalTrunks: trunks.length,
            onlineOutboundTrunks: trunks.filter((t) => t.active && t.online && t.direction !== 'inbound').length,
            totalChannels,
            activeCalls,
            availableChannels,
          },
        }),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/calls') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      recordedCallRequests.push(body);

      if (force429) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'trunk_capacity_exceeded', retryAfterSec: 5 }));
        return;
      }

      const allow = Array.isArray(body.trunkIds) && body.trunkIds.length > 0 ? new Set(body.trunkIds) : null;
      const picked = fakeTrunks.find(
        (t) =>
          (!allow || allow.has(t.id)) &&
          t.active &&
          t.online &&
          t.direction !== 'inbound' &&
          t.activeCalls < t.maxChannels,
      );
      if (!picked) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'trunk_capacity_exceeded', retryAfterSec: 5 }));
        return;
      }
      picked.activeCalls += 1;
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          status: 'ACCEPTED',
          providerAttemptId: `va-${body.attemptId}`,
          trunkId: picked.id,
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
  const addr = fakeServer.address() as { port: number };
  fakeBaseUrl = `http://127.0.0.1:${addr.port}`;
}

function buildTenContactsCsv() {
  const rows = ['id;nome;telefone1;telefone2;whatsapp1;historico'];
  for (let i = 1; i <= 10; i++) {
    const id = String(i).padStart(4, '0');
    const phoneSuffix = String(1000 + i);
    rows.push(`${id};Contato ${i};(11) 98888-${phoneSuffix};;;0`);
  }
  return rows.join('\n');
}

beforeAll(async () => {
  await setupFakeGateway();
  app = await makeApp();
});

afterAll(async () => {
  await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  await app.close();
  await closePool();
});

beforeEach(async () => {
  const { workspaceId } = await resetDb();
  recordedCallRequests = [];
  force429 = false;
  fakeTrunks = [
    { id: 't-1', name: 'Tronco Principal', direction: 'outbound', active: true, online: true, maxChannels: 2, activeCalls: 0 },
    { id: 't-2', name: 'Tronco Reserva', direction: 'both', active: true, online: true, maxChannels: 1, activeCalls: 0 },
  ];

  const pool = getPool();
  await pool.query(
    `INSERT INTO user_workspaces (user_id, workspace_id, role, is_default)
     SELECT id, $1, role, true
       FROM users
      WHERE email IN ('gestor@voll.local', 'supervisor@voll.local', 'operador@voll.local')
     ON CONFLICT (user_id, workspace_id) DO NOTHING`,
    [workspaceId],
  );

  managerApi = api(app, await login(app, 'gestor@voll.local', 'Voll@2026'));
  supervisorApi = api(app, await login(app, 'supervisor@voll.local', 'Voll@2026'));
  operatorApi = api(app, await login(app, 'operador@voll.local', 'Voll@2026'));

  // Ativa conexão VOICE_APP apontando para o fake gateway
  const vc = await one<{ id: string; workspace_id: string }>(
    pool,
    `UPDATE connections
        SET active = true,
            config = jsonb_build_object(
              'voiceAppBaseUrl', $1::text,
              'voiceAppToken', 'test-token',
              'defaultCallerId', '+551130001000',
              'tenantId', 'default'
            )
      WHERE provider = 'VOICE_APP'
      RETURNING id, workspace_id`,
    [fakeBaseUrl],
  );
  voiceConnId = vc!.id;

  await pool.query(
    `INSERT INTO workspace_channel_endpoints (workspace_id, config)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (workspace_id) DO UPDATE SET config = EXCLUDED.config`,
    [
      vc!.workspace_id,
      JSON.stringify({
        voice: {
          voiceAppBaseUrl: fakeBaseUrl,
          voiceAppToken: 'test-token',
          defaultCallerId: '+551130001000',
        },
      }),
    ],
  );

  const jv = await one<{ id: string }>(
    pool,
    `SELECT jv.id
       FROM journeys j
       JOIN journey_versions jv ON jv.journey_id = j.id
      WHERE j.name = 'Voz IA · Tronco Direct Call'
      ORDER BY jv.version DESC LIMIT 1`,
  );
  voiceJourneyVersionId = jv!.id;

  const strat = await makeStrategy(managerApi, 'Estratégia Troncos 24x7');
  strategyVersionId = strat.versionId;

  const imp = await importCsv(managerApi, 'Dez Contatos', buildTenContactsCsv());
  expect(imp.result.status).toBe(201);
  mailingId = imp.result.body.mailingId;
});

describe('002-campaign-trunk-dialer', () => {
  it('US1: limita envios pela capacidade livre dos troncos, aplica dialMultiplier e registra trunk_id', async () => {
    // 2 troncos online = 3 canais livres, multiplier 1x => reserva no máximo 3 de 10 contatos
    const camRes = await managerApi.post('/campaigns', {
      name: 'Campanha Troncos 1x',
      mailingId,
      journeyVersionId: voiceJourneyVersionId,
      strategyVersionId,
      startMode: 'NOW',
      trunkIds: ['t-1', 't-2'],
      dialMultiplier: 1,
    });
    expect(camRes.status).toBe(201);
    const cam = camRes.body;

    const r1 = await runReservations(cam.id);
    expect(r1.reserved).toBe(3);

    const out = await processOutbox();
    expect(out.processed).toBe(3);
    expect(recordedCallRequests).toHaveLength(3);
    expect(recordedCallRequests[0].trunkIds).toEqual(['t-1', 't-2']);

    const attempts = await attemptsOf(cam.id);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.trunk_id === 't-1' || a.trunk_id === 't-2')).toBe(true);

    // Sem troncos livres agora (activeCalls=3/3), nova rodada não reserva nem descarta fila
    const r2 = await runReservations(cam.id);
    expect(r2.reserved).toBe(0);

    const activeEnrollments = await one<{ n: number }>(
      getPool(),
      `SELECT count(*)::int AS n FROM enrollments WHERE campaign_id = $1 AND state = 'ACTIVE'`,
      [cam.id],
    );
    expect(activeEnrollments!.n).toBe(10);

    // Gestor aumenta canais de t-1 e define dialMultiplier=2 => 2 canais livres extras * 2 = 4 reservas
    fakeTrunks[0].maxChannels = 4; // t-1 tinha 2 ocupados de 4 -> 2 livres; t-2 com 1/1 -> 0 livres => total 2 livres * 2x = 4
    const upd = await managerApi.put(`/campaigns/${cam.id}/dialer-config`, {
      trunkIds: ['t-1', 't-2'],
      dialMultiplier: 2,
    });
    expect(upd.status).toBe(200);

    const r3 = await runReservations(cam.id);
    expect(r3.reserved).toBe(4);
  });

  it('US2: pausa envios com 0 vagas sem descartar fila, reabastece quando libera e evita overshoot entre 2 campanhas', async () => {
    const camA = await createCampaign(managerApi, {
      name: 'Campanha A',
      mailingId,
      journeyVersionId: voiceJourneyVersionId,
      strategyVersionId,
      startMode: 'NOW',
    });
    const camB = await createCampaign(managerApi, {
      name: 'Campanha B',
      mailingId,
      journeyVersionId: voiceJourneyVersionId,
      strategyVersionId,
      startMode: 'NOW',
    });

    // Lotar todos os troncos antes do primeiro tick
    fakeTrunks[0].activeCalls = 2;
    fakeTrunks[1].activeCalls = 1;

    await tick();
    expect(await attemptsOf(camA.id)).toHaveLength(0);
    expect(await attemptsOf(camB.id)).toHaveLength(0);

    // Libera exatamente 3 canais no cluster: tick deve distribuir no máximo 3 somando Campanha A + Campanha B
    fakeTrunks[0].activeCalls = 0;
    fakeTrunks[1].activeCalls = 0;

    await tick();
    const aAttempts = await attemptsOf(camA.id);
    const bAttempts = await attemptsOf(camB.id);
    expect(aAttempts.length + bAttempts.length).toBeLessThanOrEqual(3);
    expect(aAttempts.length + bAttempts.length).toBeGreaterThan(0);

    // Se gateway devolver 429 trunk_capacity_exceeded no dispatch, o item permanece retriable na outbox
    const c429 = await managerApi.post('/campaigns', {
      name: 'Campanha 429 Retry',
      mailingId,
      journeyVersionId: voiceJourneyVersionId,
      strategyVersionId,
      startMode: 'NOW',
      trunkIds: ['t-2'],
    });
    fakeTrunks[1].activeCalls = 0;
    await runReservations(c429.body.id);

    force429 = true;
    const out429 = await processOutbox();
    expect(out429.processed).toBeGreaterThanOrEqual(1);

    const pendingOutbox = await one<{ n: number; last_error: string | null }>(
      getPool(),
      `SELECT count(*)::int AS n, max(last_error) AS last_error
         FROM outbox
        WHERE attempt_id IN (SELECT id FROM attempts WHERE campaign_id = $1)
          AND status = 'PENDING'`,
      [c429.body.id],
    );
    expect(pendingOutbox!.n).toBe(1);
    expect(pendingOutbox!.last_error).toContain('trunk_capacity_exceeded');
  });

  it('US3 & RBAC: bloqueia Operador/Supervisor na escolha de troncos/multiplicador, expõe dialer-status e audita alterações do Gestor', async () => {
    // Operador tentando criar campanha / configurar troncos recebe 403
    const opCreate = await operatorApi.post('/campaigns', {
      name: 'Tentativa Operador',
      mailingId,
      journeyVersionId: voiceJourneyVersionId,
      strategyVersionId,
      trunkIds: ['t-1'],
      dialMultiplier: 3,
    });
    expect(opCreate.status).toBe(403);

    const cam = await createCampaign(managerApi, {
      name: 'Campanha Governança',
      mailingId,
      journeyVersionId: voiceJourneyVersionId,
      strategyVersionId,
      startMode: 'NOW',
    });

    // Operador e Supervisor não podem alterar dialer-config (403)
    const opPut = await operatorApi.put(`/campaigns/${cam.id}/dialer-config`, {
      trunkIds: ['t-1'],
      dialMultiplier: 2,
    });
    expect(opPut.status).toBe(403);

    const supPut = await supervisorApi.put(`/campaigns/${cam.id}/dialer-config`, {
      trunkIds: ['t-1'],
      dialMultiplier: 2,
    });
    expect(supPut.status).toBe(403);

    // Operador visualiza status em modo somente leitura (canEditDialerConfig = false)
    const opStatus = await operatorApi.get(`/campaigns/${cam.id}/dialer-status`);
    expect(opStatus.status).toBe(200);
    expect(opStatus.body.canEditDialerConfig).toBe(false);
    expect(opStatus.body.loadedTotal).toBe(10);
    expect(opStatus.body.availableTrunkSlots).toBe(3);
    expect(opStatus.body.effectiveQuota).toBe(3);

    // Gestor consegue consultar GET /telephony/trunks/availability e atualizar dialer-config com trilha de auditoria
    const availRes = await managerApi.get('/telephony/trunks/availability?trunkIds=t-1');
    expect(availRes.status).toBe(200);
    expect(availRes.body.availableChannels).toBe(2);

    const mgrPut = await managerApi.put(`/campaigns/${cam.id}/dialer-config`, {
      trunkIds: ['t-1'],
      dialMultiplier: 2,
    });
    expect(mgrPut.status).toBe(200);
    expect(mgrPut.body.trunkIds).toEqual(['t-1']);
    expect(mgrPut.body.dialMultiplier).toBe(2);

    const mgrStatus = await managerApi.get(`/campaigns/${cam.id}/dialer-status`);
    expect(mgrStatus.status).toBe(200);
    expect(mgrStatus.body.canEditDialerConfig).toBe(true);
    expect(mgrStatus.body.trunkIds).toEqual(['t-1']);
    expect(mgrStatus.body.dialMultiplier).toBe(2);
    expect(mgrStatus.body.effectiveQuota).toBe(4); // t-1 possui 2 canais livres * 2x

    const auditRows = await q<{ action: string; entity_id: string }>(
      getPool(),
      `SELECT action, entity_id FROM audit_log WHERE entity = 'campaign' AND entity_id = $1 AND action = 'campaign.dialer_config'`,
      [cam.id],
    );
    expect(auditRows.length).toBe(1);
    expect(voiceConnId).toBeTruthy();
  });
});
