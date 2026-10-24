import type { FastifyInstance } from 'fastify';
import { ResolveReconciliationSchema } from '@voll/shared';
import { getPool, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { conflict, notFound, parse, unprocessable } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { ATTEMPT_FROM, ATTEMPT_SELECT, EVENT_LABEL, attemptRow, explainAttempt } from '../services/views.js';
import { applyStrategyRule, finalizeWithTabulation } from '../engine/results.js';
import { transition } from '../engine/events.js';

export async function attemptRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/attempts/:id', async (req) => {
    const a = actor(req);
    const r = await one(getPool(), `SELECT ${ATTEMPT_SELECT} FROM ${ATTEMPT_FROM} WHERE a.id=$1 AND a.workspace_id=$2`, [req.params.id, a.workspaceId]);
    if (!r) throw notFound('Tentativa');
    const events = await q(
      getPool(),
      `SELECT id, event_type, from_state, to_state, reason_code, duplicate, occurred_at, received_at, data, external_event_id
         FROM attempt_events WHERE attempt_id=$1 ORDER BY id`,
      [r.id],
    );
    return {
      attempt: {
        ...attemptRow(r),
        traceId: r.trace_id,
        strategyVersionId: r.strategy_version_id,
        journeyVersionId: r.journey_version_id,
        tariffSnapshot: r.tariff_snapshot,
        costConfirmed: r.cost_confirmed,
        leaseUntil: r.lease_until,
        feedbackDeadline: r.feedback_deadline,
        providerAttemptId: r.provider_attempt_id,
      },
      explanation: explainAttempt(r),
      timeline: events.map((e) => ({
        id: String(e.id),
        eventType: e.event_type,
        label: EVENT_LABEL[e.event_type] ?? e.event_type,
        fromState: e.from_state,
        toState: e.to_state,
        reasonCode: e.reason_code,
        duplicate: e.duplicate,
        occurredAt: e.occurred_at,
        receivedAt: e.received_at,
        data: { ...e.data, ...(e.external_event_id ? { externalEventId: e.external_event_id } : {}) },
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/attempts/:id/reconcile', { preHandler: requireRoles(...CAN.supervise) }, async (req) => {
    const body = parse(ResolveReconciliationSchema, req.body);
    const ac = actor(req);
    await tx(async (c) => {
      const at = await one(c, `SELECT * FROM attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, ac.workspaceId]);
      if (!at) throw notFound('Tentativa');
      if (at.state !== 'RECONCILIATION') throw conflict('A tentativa não está em reconciliação');
      if (body.resolution === 'TABULATE') {
        const tab = await one(c, `SELECT * FROM tabulations WHERE workspace_id=$1 AND code=$2`, [ac.workspaceId, body.tabulationCode ?? '']);
        if (!tab) throw unprocessable('Selecione uma tabulação válida', { tabulationCode: 'Tabulação inválida' });
        await finalizeWithTabulation(c, at, tab, { reason: 'MANUAL_RESOLUTION' });
      } else {
        await transition(c, at, 'FINALIZED', 'RECONCILED_MANUAL', {
          reason: 'CONFIRMED_FAILED',
          extraSql: 'finalized_at=now()',
          data: { by: ac.userId, reason: body.reason },
        });
        await applyStrategyRule(c, at, null, 'RETRY');
      }
      await audit(c, ac, 'attempt.reconcile', 'attempt', at.id, { reason: body.reason, before: { state: 'RECONCILIATION' }, after: body });
    });
    return { ok: true };
  });

  app.get<{ Querystring: { state?: string; campaignId?: string; q?: string; cursor?: string; limit?: string } }>(
    '/operation/attempts',
    async (req) => {
      const a = actor(req);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const offset = Math.max(0, Number(req.query.cursor ?? 0) || 0);
      const search = req.query.q?.trim() ? `%${req.query.q.trim()}%` : null;
      const params = [a.workspaceId, req.query.state ?? null, req.query.campaignId ?? null, search];
      const where = `a.workspace_id=$1 AND ($2::text IS NULL OR a.state::text=$2) AND ($3::uuid IS NULL OR a.campaign_id=$3)
                     AND ($4::text IS NULL OR c.name ILIKE $4 OR c.external_id ILIKE $4 OR a.id::text ILIKE $4 OR a.trace_id::text ILIKE $4)`;
      const rows = await q(
        getPool(),
        `SELECT ${ATTEMPT_SELECT} FROM ${ATTEMPT_FROM} WHERE ${where} 
          ORDER BY a.created_at DESC, a.id DESC OFFSET $5 LIMIT $6`,
        [...params, offset, limit + 1],
      );
      const [{ total }] = await q(getPool(), `SELECT count(*)::int AS total FROM attempts a JOIN contacts c ON c.id=a.contact_id WHERE ${where}`, params);
      const page = rows.slice(0, limit);
      return {
        items: page.map(attemptRow),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
        total,
      };
    },
  );
}
