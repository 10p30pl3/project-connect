import type { FastifyInstance } from 'fastify';
import { isSuperAdminRole } from '@voll/shared';
import { getPool, one } from '../db/pool.js';
import { actor } from '../auth/context.js';
import { startOfOperationalDay } from '../engine/calendar.js';

export async function overviewRoutes(app: FastifyInstance) {
  app.get('/overview', async (req) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const ws = await one(getPool(), `SELECT * FROM workspaces WHERE id=$1`, [a.workspaceId]);
    const day = startOfOperationalDay(new Date(), ws.timezone);
    const r = await one(
      getPool(),
      `WITH camp AS (
         SELECT
           count(*) FILTER (WHERE status='RUNNING')::int AS running,
           count(*) FILTER (WHERE status='PAUSED')::int AS paused,
           count(*) FILTER (WHERE status='READY')::int AS ready,
           count(*) FILTER (WHERE status='SCHEDULED')::int AS scheduled,
           count(*) FILTER (WHERE status='COMPLETED')::int AS completed
         FROM campaigns WHERE workspace_id=$1
       ),
       att AS (
         SELECT
           count(*) FILTER (WHERE a.state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION'))::int AS active,
           count(*) FILTER (WHERE a.state='RECONCILIATION')::int AS reconciliation,
           count(*) FILTER (WHERE a.sent_at >= $2)::int AS sent_today,
           count(*)::int AS total_attempts,
           count(*) FILTER (WHERE t.is_cpc=true)::int AS cpc_attempts,
           COALESCE(sum(COALESCE(a.cost_confirmed, a.tariff_snapshot, c.tariff, 0)) FILTER (WHERE a.sent_at IS NOT NULL), 0)::float AS total_cost_brl
         FROM attempts a
         LEFT JOIN tabulations t ON t.workspace_id=a.workspace_id AND t.code=a.tabulation_code
         LEFT JOIN connections c ON c.id=a.connection_id
         WHERE a.workspace_id=$1
       )
       SELECT
         camp.running, camp.paused, camp.ready, camp.scheduled, camp.completed,
         att.active, att.reconciliation, att.sent_today, att.total_attempts, att.cpc_attempts, att.total_cost_brl,
         (SELECT count(*)::int FROM contacts WHERE workspace_id=$1) AS contacts,
         (SELECT count(*)::int FROM mailings WHERE workspace_id=$1) AS mailings,
         (SELECT avg(brute_force_cpc_brl)::float FROM contact_cpc_plans WHERE workspace_id=$1) AS baseline_cpc_brl
       FROM camp, att`,
      [a.workspaceId, day],
    );
    const totalAttempts = Number(r.total_attempts ?? 0);
    const cpcAttempts = Number(r.cpc_attempts ?? 0);
    const totalCostBrl = Number(r.total_cost_brl ?? 0);
    const baselineCpcBrl = r.baseline_cpc_brl != null ? Number(r.baseline_cpc_brl) : null;
    const cpcRatePct = totalAttempts > 0 ? Number(((cpcAttempts / totalAttempts) * 100).toFixed(1)) : null;
    const rawCostPerCpcBrl = isSuper && cpcAttempts > 0 ? Number((totalCostBrl / cpcAttempts).toFixed(2)) : null;
    const rawSavingsPct =
      isSuper && rawCostPerCpcBrl !== null && baselineCpcBrl && baselineCpcBrl > 0
        ? Number((((baselineCpcBrl - rawCostPerCpcBrl) / baselineCpcBrl) * 100).toFixed(1))
        : null;
    return {
      viewMode: isSuper ? 'SUPER_ADMIN_FULL' : 'CLIENT_TIME_ONLY',
      campaigns: { running: r.running, paused: r.paused, ready: r.ready, scheduled: r.scheduled, completed: r.completed },
      attempts: { active: r.active, reconciliation: r.reconciliation, sentToday: r.sent_today },
      contacts: r.contacts,
      mailings: r.mailings,
      globalSuspension: ws.global_suspension,
      kpis: {
        totalAttempts,
        cpcAttempts,
        cpcRatePct,
        costPerCpcBrl: rawCostPerCpcBrl,
        savingsPct: rawSavingsPct,
      },
    };
  });
}
