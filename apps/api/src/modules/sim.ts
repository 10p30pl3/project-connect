import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, one } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { conflict, notFound, parse } from '../lib/problem.js';
import { processConnectorEvent } from '../engine/results.js';
import { buildEvent } from '../connectors/simulated.js';

/** Ferramentas do conector simulado — somente fora de produção. */
export async function simRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/sim/attempts/:id/repeat-last-event', { preHandler: requireRoles(...CAN.supervise, ...CAN.manageData) }, async (req) => {
    const a = actor(req);
    const at = await one(getPool(), `SELECT * FROM attempts WHERE id=$1 AND workspace_id=$2`, [req.params.id, a.workspaceId]);
    if (!at) throw notFound('Tentativa');
    const last = await one(
      getPool(),
      `SELECT payload FROM connector_inbox WHERE attempt_id=$1 ORDER BY id DESC LIMIT 1`,
      [at.id],
    );
    if (!last) throw conflict('A tentativa ainda não recebeu nenhum evento do canal');
    const conn = await one(getPool(), `SELECT id, workspace_id FROM connections WHERE id=$1`, [at.connection_id]);
    const r = await processConnectorEvent(conn, last.payload, last.payload);
    return { accepted: true, duplicate: r.duplicate };
  });

  app.post<{ Params: { id: string } }>('/sim/attempts/:id/result', { preHandler: requireRoles(...CAN.supervise, ...CAN.manageData) }, async (req) => {
    const body = parse(z.object({ tabulationCode: z.string().min(1) }), req.body);
    const a = actor(req);
    const at = await one(getPool(), `SELECT * FROM attempts WHERE id=$1 AND workspace_id=$2`, [req.params.id, a.workspaceId]);
    if (!at) throw notFound('Tentativa');
    if (!at.provider_attempt_id || !['SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION'].includes(at.state))
      throw conflict('Só é possível simular resultado para tentativa enviada ou em reconciliação');
    const conn = await one(getPool(), `SELECT id, workspace_id FROM connections WHERE id=$1`, [at.connection_id]);
    const ev = buildEvent(at.provider_attempt_id, body.tabulationCode === 'OPT_OUT' ? 'OPT_OUT' : 'RESULT', body.tabulationCode);
    const r = await processConnectorEvent(conn, ev as any, ev);
    return { accepted: true, duplicate: r.duplicate };
  });
}
