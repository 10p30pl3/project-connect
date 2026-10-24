import type { FastifyInstance } from 'fastify';
import { getPool, one } from '../db/pool.js';
import { actor } from '../auth/context.js';
import { startOfOperationalDay } from '../engine/calendar.js';

export async function overviewRoutes(app: FastifyInstance) {
  app.get('/overview', async (req) => {
    const a = actor(req);
    const ws = await one(getPool(), `SELECT * FROM workspaces WHERE id=$1`, [a.workspaceId]);
    const day = startOfOperationalDay(new Date(), ws.timezone);
    const r = await one(
      getPool(),
      `SELECT
         (SELECT count(*) FILTER (WHERE status='RUNNING')::int FROM campaigns WHERE workspace_id=$1) AS running,
         (SELECT count(*) FILTER (WHERE status='PAUSED')::int FROM campaigns WHERE workspace_id=$1) AS paused,
         (SELECT count(*) FILTER (WHERE status='READY')::int FROM campaigns WHERE workspace_id=$1) AS ready,
         (SELECT count(*) FILTER (WHERE status='SCHEDULED')::int FROM campaigns WHERE workspace_id=$1) AS scheduled,
         (SELECT count(*) FILTER (WHERE status='COMPLETED')::int FROM campaigns WHERE workspace_id=$1) AS completed,
         (SELECT count(*)::int FROM attempts WHERE workspace_id=$1 AND state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')) AS active,
         (SELECT count(*)::int FROM attempts WHERE workspace_id=$1 AND state='RECONCILIATION') AS reconciliation,
         (SELECT count(*)::int FROM attempts WHERE workspace_id=$1 AND sent_at >= $2) AS sent_today,
         (SELECT count(*)::int FROM contacts WHERE workspace_id=$1) AS contacts,
         (SELECT count(*)::int FROM mailings WHERE workspace_id=$1) AS mailings`,
      [a.workspaceId, day],
    );
    return {
      campaigns: { running: r.running, paused: r.paused, ready: r.ready, scheduled: r.scheduled, completed: r.completed },
      attempts: { active: r.active, reconciliation: r.reconciliation, sentToday: r.sent_today },
      contacts: r.contacts,
      mailings: r.mailings,
      globalSuspension: ws.global_suspension,
    };
  });
}
