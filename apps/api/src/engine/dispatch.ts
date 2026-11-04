/** Envio via outbox (§4.2 passo 7, §18.2). Revalida imediatamente antes de enviar. */
import { getPool, one, q, tx } from '../db/pool.js';
import { getAdapter, TransientConnectorError, type SendResult } from '../connectors/adapter.js';
import { releaseCapacity, transition } from './events.js';

const MAX_TECH_RETRIES = 5;

export async function processOutbox(limit = 25, now: Date = new Date()): Promise<{ processed: number }> {
  const pending = await q<{ id: number }>(
    getPool(),
    `SELECT id FROM outbox 
      WHERE status='PENDING' 
        AND available_at <= $1 
        AND (claim_lease_until IS NULL OR claim_lease_until < $1) 
      ORDER BY id LIMIT $2`,
    [now, limit],
  );
  if (!pending.length) return { processed: 0 };
  let processed = 0;
  const CHUNK_SIZE = 5;
  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    const chunk = pending.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(chunk.map((p) => dispatchOne(p.id, now)));
    processed += results.filter(Boolean).length;
  }
  return { processed };
}

export async function claimOne(outboxId: number, now: Date = new Date()) {
  return tx(async (c) => {
    const ob = await one<{ id: number; attempt_id: string; status: string; tries: number }>(
      c,
      `SELECT id, attempt_id, status, tries FROM outbox 
        WHERE id=$1 AND status='PENDING' 
          AND (claim_lease_until IS NULL OR claim_lease_until < $2) 
        FOR UPDATE SKIP LOCKED`,
      [outboxId, now],
    );
    if (!ob) return null;

    // Lease de claim de 15 segundos
    const claimLeaseUntil = new Date(now.getTime() + 15_000);
    await c.query(`UPDATE outbox SET claimed_at=$2, claim_lease_until=$3 WHERE id=$1`, [ob.id, now, claimLeaseUntil]);

    const a = await one(c, `SELECT * FROM attempts WHERE id=$1 FOR UPDATE`, [ob.attempt_id]);
    const finish = (status: 'DONE' | 'FAILED', err?: string) =>
      c.query(`UPDATE outbox SET status=$2, last_error=$3, tries=tries+1, claim_lease_until=NULL WHERE id=$1`, [ob.id, status, err ?? null]);

    if (!a || a.state !== 'RESERVED') {
      await finish('FAILED', 'tentativa não está reservada');
      return null;
    }
    // revalidação (§4.2 passo 7)
    const camp = await one(c, `SELECT status FROM campaigns WHERE id=$1`, [a.campaign_id]);
    const ws = await one(c, `SELECT global_suspension FROM workspaces WHERE id=$1`, [a.workspace_id]);
    const block = await one(
      c,
      `SELECT scope FROM blocks WHERE workspace_id=$1 AND contact_id=$2 AND revoked_at IS NULL
          AND (scope='CONTACT' OR destination_id=$3) LIMIT 1`,
      [a.workspace_id, a.contact_id, a.destination_id],
    );
    const dest = await one(c, `SELECT valid FROM contact_destinations WHERE id=$1`, [a.destination_id]);
    const conn = await one(c, `SELECT * FROM connections WHERE id=$1`, [a.connection_id]);
    let cancelReason: string | null = null;
    if (block) cancelReason = block.scope === 'CONTACT' ? 'DNC' : 'DESTINATION_BLOCKED';
    else if (camp?.status !== 'RUNNING') cancelReason = camp?.status === 'PAUSED' ? 'CAMPAIGN_PAUSED' : 'CAMPAIGN_NOT_RUNNING';
    else if (ws?.global_suspension) cancelReason = 'GLOBAL_SUSPENSION';
    else if (!dest?.valid) cancelReason = 'INVALID_DESTINATION';
    else if (!conn?.active) cancelReason = 'CHANNEL_UNAVAILABLE';
    if (cancelReason) {
      await transition(c, a, 'CANCELLED', 'CANCELLED', { reason: cancelReason });
      await releaseCapacity(c, a.id);
      await finish('FAILED', cancelReason);
      return null;
    }
    if (new Date(a.lease_until).getTime() < now.getTime()) {
      await transition(c, a, 'RELEASED', 'LEASE_EXPIRED', { reason: 'LEASE_EXPIRED' });
      await releaseCapacity(c, a.id);
      await finish('FAILED', 'reserva vencida');
      return null;
    }

    return { ob, a, conn };
  });
}

export async function dispatchOne(outboxId: number, now: Date = new Date()): Promise<boolean> {
  const claimed = await claimOne(outboxId, now);
  if (!claimed) return false;
  const { ob, a, conn } = claimed;

  let result: SendResult | undefined;
  let techError: Error | null = null;
  try {
    result = await getAdapter(conn.provider).send(getPool(), { attempt: a, connection: conn });
  } catch (err: any) {
    techError = err;
  }

  return tx(async (c) => {
    const currentOb = await one(c, `SELECT * FROM outbox WHERE id=$1 FOR UPDATE`, [ob.id]);
    const freshA = await one(c, `SELECT * FROM attempts WHERE id=$1 FOR UPDATE`, [a.id]);
    if (!currentOb || !freshA) return false;

    const finish = (status: 'DONE' | 'FAILED', err?: string) =>
      c.query(`UPDATE outbox SET status=$2, last_error=$3, tries=tries+1, claim_lease_until=NULL WHERE id=$1`, [currentOb.id, status, err ?? null]);

    if (techError) {
      const tries = currentOb.tries + 1;
      if (techError instanceof TransientConnectorError && tries < MAX_TECH_RETRIES) {
        const backoff = Math.min(60_000, 1000 * 2 ** tries);
        await c.query(`UPDATE outbox SET tries=$2, last_error=$3, available_at=$4, claim_lease_until=NULL WHERE id=$1`, [
          currentOb.id, tries, String(techError.message), new Date(now.getTime() + backoff),
        ]);
        return true;
      }
      if (techError instanceof TransientConnectorError) {
        if (freshA.state === 'RESERVED') {
          await transition(c, freshA, 'RELEASED', 'DISPATCH_FAILED', { reason: 'CHANNEL_UNAVAILABLE' });
          await releaseCapacity(c, freshA.id);
        }
        await finish('FAILED', 'conector indisponível');
        return true;
      }
      // erro desconhecido: pode ter sido aceito — reconciliar, sem novo envio
      if (freshA.state === 'RESERVED') {
        await transition(c, freshA, 'RECONCILIATION', 'DISPATCH_INCONCLUSIVE', { reason: 'DISPATCH_ERROR', data: { error: String(techError.message) } });
      }
      await finish('DONE', String(techError.message));
      return true;
    }

    if (!result) return false;

    if (result.status === 'REJECTED') {
      if (freshA.state === 'RESERVED') {
        await transition(c, freshA, 'RELEASED', 'DISPATCH_REJECTED', { reason: result.reason });
        await releaseCapacity(c, freshA.id);
      }
      await finish('FAILED', result.reason);
      return true;
    }

    const sentAt = now;
    const steps = (await one(c, `SELECT steps FROM journey_versions WHERE id=$1`, [freshA.journey_version_id]))!.steps;
    const timeout = (steps[freshA.stage]?.feedbackTimeoutMinutes ?? 30) as number;
    const deadline = new Date(sentAt.getTime() + timeout * 60_000);
    const tariff = conn.tariff === null || conn.tariff === undefined ? null : Number(conn.tariff);

    const isAlreadyProgressed = ['AWAITING_FEEDBACK', 'RECONCILIATION', 'FINALIZED'].includes(freshA.state);

    if (result.status === 'ACCEPTED') {
      if (!isAlreadyProgressed && freshA.state === 'RESERVED') {
        await transition(c, freshA, 'SENT', 'DISPATCH_ACCEPTED', {
          extraSql: `sent_at=$4, provider_attempt_id=$5, feedback_deadline=$6, tariff_snapshot=$7, tariff_captured_at=$4`,
          extraParams: [sentAt, result.providerAttemptId, deadline, tariff],
          occurredAt: sentAt,
          data: { providerAttemptId: result.providerAttemptId, tariff, tariffVersion: conn.tariff_updated_at, connection: conn.name },
        });
      } else if (result.providerAttemptId && !freshA.provider_attempt_id) {
        await c.query(`UPDATE attempts SET provider_attempt_id=$2 WHERE id=$1`, [freshA.id, result.providerAttemptId]);
      }
    } else {
      // inconclusivo: pode ter sido enviado — consome e reconcilia (não reenviar, §4.3)
      if (!isAlreadyProgressed && freshA.state === 'RESERVED') {
        await transition(c, freshA, 'RECONCILIATION', 'DISPATCH_INCONCLUSIVE', {
          reason: result.reason,
          extraSql: `sent_at=$4, provider_attempt_id=$5, feedback_deadline=$6, tariff_snapshot=$7, tariff_captured_at=$4`,
          extraParams: [sentAt, result.providerAttemptId ?? null, deadline, tariff],
          occurredAt: sentAt,
        });
      }
    }

    // consumo confirmado uma única vez (AC08, OP03)
    await c.query(`UPDATE counter_consumptions SET kind='CONFIRMED', effective_at=$2 WHERE attempt_id=$1 AND kind='PROVISIONAL'`, [freshA.id, sentAt]);
    await finish('DONE');
    return true;
  });
}
