import type { FastifyInstance } from 'fastify';
import { ConnectionUpdateSchema, JourneyCreateSchema, StrategyCreateSchema, StrategyPublishSchema } from '@voll/shared';
import { getPool, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { forbidden, notFound, parse, unprocessable } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_SIMULATION } from '../connectors/simulated.js';

function connectionDto(r: any) {
  return {
    id: r.id,
    name: r.name,
    channelType: r.channel_type,
    provider: r.provider,
    tariff: r.tariff,
    tariffUpdatedAt: r.tariff_updated_at,
    active: r.active,
    simulation: r.provider === 'SIMULATED' ? { ...DEFAULT_SIMULATION, ...(r.config?.simulation ?? {}) } : null,
  };
}

export async function loadJourneys(workspaceId: string, journeyId?: string) {
  const rows = await q(
    getPool(),
    `SELECT j.id, j.name, v.id AS v_id, v.version, v.steps, v.published_at
       FROM journeys j JOIN LATERAL (SELECT * FROM journey_versions WHERE journey_id=j.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE j.workspace_id=$1 AND ($2::uuid IS NULL OR j.id=$2) ORDER BY j.name`,
    [workspaceId, journeyId ?? null],
  );
  const conns = await q(getPool(), `SELECT id, name FROM connections WHERE workspace_id=$1`, [workspaceId]);
  const cname = Object.fromEntries(conns.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    latestVersion: {
      id: r.v_id,
      version: r.version,
      publishedAt: r.published_at,
      steps: (r.steps as any[]).map((s) => ({ ...s, connectionName: cname[s.connectionId] ?? null })),
    },
  }));
}

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/tabulations', async (req) => {
    const rows = await q(
      getPool(),
      `SELECT id, code, name, is_cpc AS "isCpc", is_conversion AS "isConversion", is_opt_out AS "isOptOut",
              invalidates_destination AS "invalidatesDestination", channel_types::text[] AS "channelTypes"
         FROM tabulations WHERE workspace_id=$1 ORDER BY name`,
      [actor(req).workspaceId],
    );
    return { items: rows };
  });

  app.get('/connections', async (req) => {
    const rows = await q(getPool(), `SELECT * FROM connections WHERE workspace_id=$1 ORDER BY channel_type, name`, [actor(req).workspaceId]);
    return { items: rows.map(connectionDto) };
  });

  app.patch<{ Params: { id: string } }>('/connections/:id', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const body = parse(ConnectionUpdateSchema, req.body);
    const a = actor(req);
    return tx(async (c) => {
      const before = await one(c, `SELECT * FROM connections WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
      if (!before) throw notFound('Conexão');
      if (body.simulation && body.simulation.maxDelaySeconds < body.simulation.minDelaySeconds)
        throw unprocessable('Corrija os campos indicados', { 'simulation.maxDelaySeconds': 'Deve ser maior ou igual ao mínimo' });
      const config = body.simulation ? { ...before.config, simulation: body.simulation } : before.config;
      const tariffChanged = body.tariff !== undefined && body.tariff !== before.tariff;
      const after = await one(
        c,
        `UPDATE connections SET name=COALESCE($2,name), active=COALESCE($3,active), config=$4,
                tariff = CASE WHEN $5 THEN $6::numeric ELSE tariff END,
                tariff_updated_at = CASE WHEN $5 THEN now() ELSE tariff_updated_at END
          WHERE id=$1 RETURNING *`,
        [before.id, body.name ?? null, body.active ?? null, JSON.stringify(config), tariffChanged, body.tariff ?? null],
      );
      await audit(c, a, 'connection.update', 'connection', before.id, {
        before: { name: before.name, tariff: before.tariff, active: before.active, simulation: before.config?.simulation ?? null },
        after: { name: after.name, tariff: after.tariff, active: after.active, simulation: after.config?.simulation ?? null },
      });
      return connectionDto(after);
    });
  });

  app.get('/journeys', async (req) => ({ items: await loadJourneys(actor(req).workspaceId) }));

  app.post('/journeys', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(JourneyCreateSchema, req.body);
    const a = actor(req);
    const conns = await q(getPool(), `SELECT id, channel_type FROM connections WHERE workspace_id=$1`, [a.workspaceId]);
    const byId = Object.fromEntries(conns.map((c) => [c.id, c.channel_type]));
    const fieldErrors: Record<string, string> = {};
    body.steps.forEach((s, i) => {
      if (!byId[s.connectionId]) fieldErrors[`steps.${i}.connectionId`] = 'Conexão não encontrada';
      else if (byId[s.connectionId] !== s.channelType) fieldErrors[`steps.${i}.connectionId`] = 'Conexão incompatível com o canal';
    });
    if (Object.keys(fieldErrors).length) throw unprocessable('Corrija as etapas da jornada', fieldErrors);
    const id = await tx(async (c) => {
      const j = await one(c, `INSERT INTO journeys (workspace_id, name) VALUES ($1,$2) RETURNING id`, [a.workspaceId, body.name]);
      await c.query(`INSERT INTO journey_versions (journey_id, version, steps) VALUES ($1,1,$2)`, [j!.id, JSON.stringify(body.steps)]);
      await audit(c, a, 'journey.publish', 'journey', j!.id, { after: body });
      return j!.id as string;
    });
    return reply.code(201).send((await loadJourneys(a.workspaceId, id))[0]);
  });

  const loadStrategies = async (workspaceId: string, id?: string) =>
    (
      await q(
        getPool(),
        `SELECT s.id, s.name, s.protected, v.id AS v_id, v.version, v.config, v.published_at
           FROM strategies s JOIN LATERAL (SELECT * FROM strategy_versions WHERE strategy_id=s.id ORDER BY version DESC LIMIT 1) v ON true
          WHERE s.workspace_id=$1 AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.name`,
        [workspaceId, id ?? null],
      )
    ).map((r) => ({
      id: r.id,
      name: r.name,
      protected: r.protected,
      latestVersion: { id: r.v_id, version: r.version, config: r.config, publishedAt: r.published_at },
    }));

  app.get('/strategies', async (req) => ({ items: await loadStrategies(actor(req).workspaceId) }));

  app.get<{ Params: { id: string } }>('/strategies/:id', async (req) => {
    const [s] = await loadStrategies(actor(req).workspaceId, req.params.id);
    if (!s) throw notFound('Estratégia');
    const versions = await q(
      getPool(),
      `SELECT v.id, v.version, v.config, v.published_at AS "publishedAt", u.name AS "publishedBy"
         FROM strategy_versions v LEFT JOIN users u ON u.id=v.published_by WHERE v.strategy_id=$1 ORDER BY v.version DESC`,
      [s.id],
    );
    return { ...s, versions };
  });

  app.post('/strategies', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(StrategyCreateSchema, req.body);
    const a = actor(req);
    if (body.copyOf) {
      const src = await one(getPool(), `SELECT id FROM strategies WHERE id=$1 AND workspace_id=$2`, [body.copyOf, a.workspaceId]);
      if (!src) throw notFound('Estratégia de origem');
    }
    const id = await tx(async (c) => {
      const s = await one(c, `INSERT INTO strategies (workspace_id, name, protected) VALUES ($1,$2,false) RETURNING id`, [a.workspaceId, body.name]);
      await c.query(`INSERT INTO strategy_versions (strategy_id, version, config, published_by) VALUES ($1,1,$2,$3)`, [
        s!.id, JSON.stringify(body.config), a.userId,
      ]);
      await audit(c, a, 'strategy.publish', 'strategy', s!.id, { after: { version: 1, copyOf: body.copyOf ?? null, config: body.config } });
      return s!.id as string;
    });
    return reply.code(201).send((await loadStrategies(a.workspaceId, id))[0]);
  });

  app.post<{ Params: { id: string } }>('/strategies/:id/versions', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const a = actor(req);
    await tx(async (c) => {
      const s = await one(c, `SELECT * FROM strategies WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
      if (!s) throw notFound('Estratégia');
      if (s.protected) throw forbidden('Template predefinido é protegido: crie uma cópia para personalizar');
      const body = parse(StrategyPublishSchema, req.body);
      const prev = await one(c, `SELECT version, config FROM strategy_versions WHERE strategy_id=$1 ORDER BY version DESC LIMIT 1`, [s.id]);
      const v = (prev?.version ?? 0) + 1;
      await c.query(`INSERT INTO strategy_versions (strategy_id, version, config, published_by) VALUES ($1,$2,$3,$4)`, [
        s.id, v, JSON.stringify(body.config), a.userId,
      ]);
      await audit(c, a, 'strategy.publish', 'strategy', s.id, { before: prev, after: { version: v, config: body.config } });
    });
    return reply.code(201).send((await loadStrategies(a.workspaceId, req.params.id))[0]);
  });
}
