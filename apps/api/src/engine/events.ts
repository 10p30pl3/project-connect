import type { AttemptState } from '@voll/shared';
import type { Db } from '../db/pool.js';

export type EventInput = {
  workspaceId: string;
  attemptId?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
  type: string;
  from?: AttemptState | null;
  to?: AttemptState | null;
  reason?: string | null;
  externalEventId?: string | null;
  duplicate?: boolean;
  occurredAt?: Date | string | null;
  data?: Record<string, unknown>;
};

export async function logEvent(db: Db, e: EventInput) {
  await db.query(
    `INSERT INTO attempt_events (workspace_id, attempt_id, campaign_id, contact_id, event_type, from_state, to_state,
                                 reason_code, external_event_id, duplicate, occurred_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, now()),$12)`,
    [
      e.workspaceId,
      e.attemptId ?? null,
      e.campaignId ?? null,
      e.contactId ?? null,
      e.type,
      e.from ?? null,
      e.to ?? null,
      e.reason ?? null,
      e.externalEventId ?? null,
      e.duplicate ?? false,
      e.occurredAt ?? null,
      JSON.stringify(e.data ?? {}),
    ],
  );
}

/** Muda o estado de uma tentativa (já bloqueada FOR UPDATE) e registra o evento. */
export async function transition(
  db: Db,
  a: { id: string; workspace_id: string; campaign_id: string; contact_id: string; state: AttemptState },
  to: AttemptState,
  type: string,
  opts: { reason?: string | null; extraSql?: string; extraParams?: unknown[]; data?: Record<string, unknown>; externalEventId?: string | null; occurredAt?: string | Date | null } = {},
) {
  const extra = opts.extraSql ? `, ${opts.extraSql}` : '';
  await db.query(
    `UPDATE attempts SET state=$2, state_reason=$3, updated_at=now()${extra} WHERE id=$1`,
    [a.id, to, opts.reason ?? null, ...(opts.extraParams ?? [])],
  );
  await logEvent(db, {
    workspaceId: a.workspace_id,
    attemptId: a.id,
    campaignId: a.campaign_id,
    contactId: a.contact_id,
    type,
    from: a.state,
    to,
    reason: opts.reason ?? null,
    data: opts.data,
    externalEventId: opts.externalEventId,
    occurredAt: opts.occurredAt,
  });
  a.state = to;
}

/** Devolve a capacidade provisória (reserva não enviada). */
export async function releaseCapacity(db: Db, attemptId: string) {
  await db.query(`UPDATE counter_consumptions SET kind='RELEASED' WHERE attempt_id=$1 AND kind='PROVISIONAL'`, [attemptId]);
  await db.query(`UPDATE outbox SET status='FAILED', last_error=COALESCE(last_error,'cancelado') WHERE attempt_id=$1 AND status='PENDING'`, [attemptId]);
}

/** Cancela tentativas reservadas e ainda não enviadas (pausa/encerramento/bloqueio). */
export async function cancelUnsent(db: Db, where: string, params: unknown[], reason: string) {
  const rows = await db.query(
    `SELECT id, workspace_id, campaign_id, contact_id, state FROM attempts WHERE state='RESERVED' AND ${where} FOR UPDATE`,
    params as any[],
  );
  for (const a of rows.rows) {
    await transition(db, a, 'CANCELLED', 'CANCELLED', { reason });
    await releaseCapacity(db, a.id);
  }
  return rows.rowCount ?? 0;
}
