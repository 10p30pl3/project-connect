/** Envio via outbox (§4.2 passo 7, §18.2). Revalida imediatamente antes de enviar. */
import { getPool, one, q, tx } from '../db/pool.js';
import { getAdapter, TransientConnectorError } from '../connectors/adapter.js';
import { releaseCapacity, transition } from './events.js';

const MAX_TECH_RETRIES = 5;

export async function processOutbox(limit = 25, now: Date = new Date()): Promise<{ processed: number }> {
  const pending = await q(
    getPool(),
    `SELECT id FROM outbox WHERE status='PENDING' AND available_at <= $1 ORDER BY id LIMIT $2`,
    [now, limit],
  );
  let processed = 0;
  for (const p of pending) {
    const done = await dispatchOne(p.id, now);
    if (done) processed++;
  }
  return { processed };
}

export async function dispatchOne(outboxId: number, now: Date = new Date()): Promise<boolean> {
  return tx(async (c) => {
    const ob = await one(c, `SELECT * FROM outbox WHERE id=$1 AND status='PENDING' FOR UPDATE SKIP LOCKED`, [outboxId]);
    if (!ob) return false;
    const a = await one(c, `SELECT * FROM attempts WHERE id=$1 FOR UPDATE`, [ob.attempt_id]);
    const finish = (status: 'DONE' | 'FAILED', err?: string) =>
      c.query(`UPDATE outbox SET status=$2, last_error=$3, tries=tries+1 WHERE id=$1`, [ob.id, status, err ?? null]);
    if (!a || a.state !== 'RESERVED') {
      await finish('FAILED', 'tentativa não está reservada');
      return true;
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
      return true;
    }
    if (new Date(a.lease_until).getTime() < now.getTime()) {
      await transition(c, a, 'RELEASED', 'LEASE_EXPIRED', { reason: 'LEASE_EXPIRED' });
      await releaseCapacity(c, a.id);
      await finish('FAILED', 'reserva vencida');
      return true;
    }

    let result;
    try {
      result = await getAdapter(conn.provider).send(c, { attempt: a, connection: conn });
    } catch (err) {
      const tries = ob.tries + 1;
      if (err instanceof TransientConnectorError && tries < MAX_TECH_RETRIES) {
        const backoff = Math.min(60_000, 1000 * 2 ** tries);
        await c.query(`UPDATE outbox SET tries=$2, last_error=$3, available_at=$4 WHERE id=$1`, [
          ob.id, tries, String((err as Error).message), new Date(now.getTime() + backoff),
        ]);
        return true;
      }
      if (err instanceof TransientConnectorError) {
        // nunca chegou ao provedor: libera sem consumo
        await transition(c, a, 'RELEASED', 'DISPATCH_FAILED', { reason: 'CHANNEL_UNAVAILABLE' });
        await releaseCapacity(c, a.id);
        await finish('FAILED', 'conector indisponível');
        return true;
      }
      // erro desconhecido: pode ter sido aceito — reconciliar, sem novo envio
      await transition(c, a, 'RECONCILIATION', 'DISPATCH_INCONCLUSIVE', { reason: 'DISPATCH_ERROR', data: { error: String((err as Error).message) } });
      await finish('DONE', String((err as Error).message));
      return true;
    }

    if (result.status === 'REJECTED') {
      await transition(c, a, 'RELEASED', 'DISPATCH_REJECTED', { reason: result.reason });
      await releaseCapacity(c, a.id);
      await finish('FAILED', result.reason);
      return true;
    }
    const sentAt = now;
    const steps = (await one(c, `SELECT steps FROM journey_versions WHERE id=$1`, [a.journey_version_id]))!.steps;
    const timeout = (steps[a.stage]?.feedbackTimeoutMinutes ?? 30) as number;
    const deadline = new Date(sentAt.getTime() + timeout * 60_000);
    const tariff = conn.tariff === null || conn.tariff === undefined ? null : Number(conn.tariff);
    if (result.status === 'ACCEPTED') {
      await transition(c, a, 'SENT', 'DISPATCH_ACCEPTED', {
        extraSql: `sent_at=$4, provider_attempt_id=$5, feedback_deadline=$6, tariff_snapshot=$7, tariff_captured_at=$4`,
        extraParams: [sentAt, result.providerAttemptId, deadline, tariff],
        occurredAt: sentAt,
        data: { providerAttemptId: result.providerAttemptId, tariff, tariffVersion: conn.tariff_updated_at, connection: conn.name },
      });
    } else {
      // inconclusivo: pode ter sido enviado — consome e reconcilia (não reenviar, §4.3)
      await transition(c, a, 'RECONCILIATION', 'DISPATCH_INCONCLUSIVE', {
        reason: result.reason,
        extraSql: `sent_at=$4, provider_attempt_id=$5, feedback_deadline=$6, tariff_snapshot=$7, tariff_captured_at=$4`,
        extraParams: [sentAt, result.providerAttemptId ?? null, deadline, tariff],
        occurredAt: sentAt,
      });
    }
    // consumo confirmado uma única vez (AC08, OP03)
    await c.query(`UPDATE counter_consumptions SET kind='CONFIRMED', effective_at=$2 WHERE attempt_id=$1 AND kind='PROVISIONAL'`, [a.id, sentAt]);
    await finish('DONE');
    return true;
  });
}
