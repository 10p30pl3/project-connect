/** Reserva exclusiva (§4.2 passos 3–6, AC01, OP01, CT05). */
import { maskAddress, type ReasonCode } from '@voll/shared';
import { getPool, one, q, tx, type Client } from '../db/pool.js';
import { buildContexts, evaluateEnrollment, loadCampaignRuntime, type EnrollmentRow } from './eligibility.js';
import { logEvent } from './events.js';
import { inCalendar } from './calendar.js';

const STEP_SKIP_REASONS: ReasonCode[] = ['NO_DESTINATION', 'CHANNEL_EXHAUSTED', 'DESTINATION_BLOCKED'];

export type ReserveOutcome = { reserved: string } | { skipped: ReasonCode | 'NOT_FOUND' | 'STEP_ADVANCED' };

/** Avança a etapa quando não há destino utilizável (§6.2 passo 13); sem etapas → conclui sem sucesso. */
export async function advanceStage(
  c: Client,
  e: { id: string; stage: number; campaign_id: string; contact_id: string },
  stepsLength: number,
  workspaceId: string,
  reason: string,
  nextEligibleAt: Date = new Date(),
) {
  if (e.stage + 1 < stepsLength) {
    await c.query(
      `UPDATE enrollments SET stage=stage+1, destination_cursor=0, next_eligible_at=$2, updated_at=now() WHERE id=$1`,
      [e.id, nextEligibleAt],
    );
    await logEvent(c, { workspaceId, campaignId: e.campaign_id, contactId: e.contact_id, type: 'STAGE_ADVANCED', reason, data: { enrollmentId: e.id, toStage: e.stage + 1 } });
  } else {
    await c.query(
      `UPDATE enrollments SET state='DONE_FAIL', terminal_reason=$2, updated_at=now() WHERE id=$1`,
      [e.id, reason === 'NO_DESTINATION' ? 'NO_DESTINATION' : 'EXHAUSTED'],
    );
    await logEvent(c, { workspaceId, campaignId: e.campaign_id, contactId: e.contact_id, type: 'FLOW_FINISHED', reason, data: { enrollmentId: e.id } });
  }
}

export async function reserveEnrollment(campaignId: string, enrollmentId: string, now: Date = new Date()): Promise<ReserveOutcome> {
  try {
    return await tx(async (c) => {
      const e = await one<EnrollmentRow & { campaign_id: string }>(
        c,
        `SELECT id, contact_id, campaign_id, state, stage, destination_cursor, next_eligible_at, order_key FROM enrollments WHERE id=$1`,
        [enrollmentId],
      );
      if (!e) return { skipped: 'NOT_FOUND' as const };
      // serializa por cliente entre campanhas e workers
      await c.query(`SELECT id FROM contacts WHERE id=$1 FOR UPDATE`, [e.contact_id]);
      const fresh = await one<EnrollmentRow & { campaign_id: string }>(
        c,
        `SELECT id, contact_id, campaign_id, state, stage, destination_cursor, next_eligible_at, order_key FROM enrollments WHERE id=$1 FOR UPDATE`,
        [enrollmentId],
      );
      const rt = await loadCampaignRuntime(c, campaignId);
      if (!fresh || !rt) return { skipped: 'NOT_FOUND' as const };
      const ctx = (await buildContexts(c, rt, [fresh], now)).get(fresh.id)!;
      const ev = evaluateEnrollment(ctx);
      await c.query(`UPDATE enrollments SET last_evaluated_at=$2 WHERE id=$1`, [fresh.id, now]);
      if (!ev.eligible) {
        const onlyDestination = ev.reasons.every((r) => STEP_SKIP_REASONS.includes(r) || r === 'OUTSIDE_CALENDAR');
        if (onlyDestination && ev.reasons.some((r) => STEP_SKIP_REASONS.includes(r)) && fresh.state === 'ACTIVE') {
          await advanceStage(c, fresh, rt.steps.length, rt.workspaceId, ev.primaryReason!);
          return { skipped: 'STEP_ADVANCED' as const };
        }
        return { skipped: ev.primaryReason! };
      }
      const step = ev.step!;
      const dest = ev.destination!;
      const lease = new Date(now.getTime() + rt.strategy.distribution.leaseSeconds * 1000);
      const [a] = await q(
        c,
        `INSERT INTO attempts (workspace_id, campaign_id, enrollment_id, contact_id, destination_id, destination_address,
                               channel_type, connection_id, stage, state, lease_until, strategy_version_id,
                               journey_version_id, list_version_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESERVED',$10,$11,$12,$13,$14,$14)
         RETURNING id, trace_id`,
        [
          rt.workspaceId, rt.id, fresh.id, fresh.contact_id, dest.id, dest.address, step.channelType, step.connectionId,
          fresh.stage, lease, rt.strategyVersionId, rt.journeyVersionId, rt.listVersionId, now,
        ],
      );
      await c.query(
        `INSERT INTO counter_consumptions (workspace_id, contact_id, attempt_id, campaign_id, channel_type, destination_id, kind, effective_at)
         VALUES ($1,$2,$3,$4,$5,$6,'PROVISIONAL',$7)`,
        [rt.workspaceId, fresh.contact_id, a.id, rt.id, step.channelType, dest.id, now],
      );
      await c.query(`INSERT INTO outbox (attempt_id, available_at) VALUES ($1,$2)`, [a.id, now]);
      await logEvent(c, {
        workspaceId: rt.workspaceId,
        attemptId: a.id,
        campaignId: rt.id,
        contactId: fresh.contact_id,
        type: 'RESERVED',
        to: 'RESERVED',
        occurredAt: now,
        data: {
          destination: maskAddress(dest.address),
          channelType: step.channelType,
          stage: fresh.stage,
          strategyVersion: rt.strategyVersion,
          leaseUntil: lease.toISOString(),
          counters: ev.counters,
        },
      });
      return { reserved: a.id as string };
    });
  } catch (err: any) {
    if (err?.code === '23505' && String(err?.constraint ?? '').includes('attempts_one_active_per_contact')) {
      return { skipped: 'ACTIVE_RESERVATION' };
    }
    throw err;
  }
}

/** Uma rodada de distribuição para a campanha (§4.1: lote e máximo pendente da estratégia). */
export async function runReservations(campaignId: string, now: Date = new Date()): Promise<{ reserved: number; evaluated: number }> {
  const pool = getPool();
  const rt = await loadCampaignRuntime(pool, campaignId);
  if (!rt || rt.status !== 'RUNNING') return { reserved: 0, evaluated: 0 };
  const [ws] = await q(pool, `SELECT global_suspension FROM workspaces WHERE id=$1`, [rt.workspaceId]);
  if (ws.global_suspension) return { reserved: 0, evaluated: 0 };
  if (!inCalendar(rt.strategy.calendar, now)) return { reserved: 0, evaluated: 0 };

  const [{ n: pending }] = await q(
    pool,
    `SELECT count(*)::int AS n FROM attempts WHERE campaign_id=$1 AND state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')`,
    [campaignId],
  );
  const budget = Math.min(rt.strategy.distribution.batchSize, rt.strategy.distribution.maxPending - pending);
  if (budget <= 0) return { reserved: 0, evaluated: 0 };

  const cands = await q<EnrollmentRow>(
    pool,
    `SELECT e.id, e.contact_id, e.state, e.stage, e.destination_cursor, e.next_eligible_at, e.order_key
       FROM enrollments e
      WHERE e.campaign_id=$1 AND e.state='ACTIVE' AND e.next_eligible_at <= $2
        AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.workspace_id=$3 AND a.contact_id=e.contact_id
                          AND a.state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION'))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.workspace_id=$3 AND b.contact_id=e.contact_id
                          AND b.scope='CONTACT' AND b.revoked_at IS NULL)
      ORDER BY e.last_evaluated_at NULLS FIRST, e.order_key
      LIMIT $4`,
    [campaignId, now, rt.workspaceId, budget * 4],
  );
  if (!cands.length) return { reserved: 0, evaluated: 0 };
  const ctxs = await buildContexts(pool, rt, cands, now);
  let reserved = 0;
  const notTried: string[] = [];
  for (const e of cands) {
    if (reserved >= budget) break;
    const ev = evaluateEnrollment(ctxs.get(e.id)!);
    const stepSkip = !ev.eligible && ev.reasons.some((r) => STEP_SKIP_REASONS.includes(r));
    if (!ev.eligible && !stepSkip) {
      notTried.push(e.id);
      continue;
    }
    const r = await reserveEnrollment(campaignId, e.id, now);
    if ('reserved' in r) reserved++;
  }
  if (notTried.length) {
    await pool.query(`UPDATE enrollments SET last_evaluated_at=$2 WHERE id = ANY($1)`, [notTried, now]);
  }
  return { reserved, evaluated: cands.length };
}
