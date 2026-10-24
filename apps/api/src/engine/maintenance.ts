/** Manutenção periódica do motor (worker). */
import { createHmac } from 'node:crypto';
import { getPool, q, tx } from '../db/pool.js';
import { config } from '../config.js';
import { releaseCapacity, transition } from './events.js';
import { materializeEnrollments } from './materialize.js';
import { runReservations } from './reserve.js';
import { processOutbox } from './dispatch.js';

/** Reserva vencida sem envio → liberada, sem consumo nem custo (AC02). */
export async function expireLeases(now: Date = new Date()) {
  return tx(async (c) => {
    const rows = await q(
      c,
      `SELECT id, workspace_id, campaign_id, contact_id, state FROM attempts
        WHERE state='RESERVED' AND lease_until < $1 FOR UPDATE SKIP LOCKED`,
      [now],
    );
    for (const a of rows) {
      await transition(c, a, 'RELEASED', 'LEASE_EXPIRED', { reason: 'LEASE_EXPIRED' });
      await releaseCapacity(c, a.id);
    }
    return rows.length;
  });
}

/** Enviado sem retorno no prazo → reconciliação visível, sem novo envio (AC05, OP05). */
export async function markFeedbackTimeouts(now: Date = new Date()) {
  return tx(async (c) => {
    const rows = await q(
      c,
      `SELECT id, workspace_id, campaign_id, contact_id, state FROM attempts
        WHERE state IN ('SENT','AWAITING_FEEDBACK') AND feedback_deadline < $1 FOR UPDATE SKIP LOCKED`,
      [now],
    );
    for (const a of rows) {
      await transition(c, a, 'RECONCILIATION', 'NO_RETURN', { reason: 'NO_RETURN' });
    }
    return rows.length;
  });
}

export async function startScheduled(now: Date = new Date()) {
  const rows = await q(
    getPool(),
    `UPDATE campaigns SET status='RUNNING', started_at=COALESCE(started_at, $1)
      WHERE status='SCHEDULED' AND scheduled_at <= $1 RETURNING id`,
    [now],
  );
  for (const r of rows) await materializeEnrollments(getPool(), r.id);
  return rows.length;
}

/** Conclui automaticamente quando não há inscrições acionáveis nem tentativas pendentes (§4.3). */
export async function autoComplete() {
  const rows = await q(
    getPool(),
    `UPDATE campaigns c SET status='COMPLETED', finished_at=now()
      WHERE c.status='RUNNING' AND c.materialized_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM list_versions lv WHERE lv.id=c.list_version_id AND lv.membership_mode='DYNAMIC')
        AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.campaign_id=c.id AND e.state='ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.campaign_id=c.id AND a.state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION'))
      RETURNING id`,
  );
  return rows.length;
}

export function signBody(body: string, secret: string) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export type Deliver = (connectionId: string, body: string, signature: string) => Promise<boolean>;

export const httpDeliver: Deliver = async (connectionId, body, signature) => {
  try {
    const r = await fetch(`${config.publicUrl}/api/connectors/${connectionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voll-signature': signature },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
};

/** O "provedor" simulado entrega webhooks agendados, assinados, pelo caminho HTTP real. */
export async function deliverSimEvents(deliver: Deliver = httpDeliver, now: Date = new Date(), limit = 50) {
  const due = await tx(async (c) => {
    const rows = await q(
      c,
      `SELECT s.id, s.connection_id, s.payload, c.webhook_secret FROM sim_scheduled_events s
         JOIN connections c ON c.id = s.connection_id
        WHERE s.delivered_at IS NULL AND s.deliver_at <= $1 AND s.tries < 10
        ORDER BY s.deliver_at LIMIT $2 FOR UPDATE OF s SKIP LOCKED`,
      [now, limit],
    );
    if (rows.length) await c.query(`UPDATE sim_scheduled_events SET tries=tries+1 WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
    return rows;
  });
  let ok = 0;
  for (const r of due) {
    const body = JSON.stringify(r.payload);
    const delivered = await deliver(r.connection_id, body, signBody(body, r.webhook_secret));
    if (delivered) {
      ok++;
      await getPool().query(`UPDATE sim_scheduled_events SET delivered_at=now() WHERE id=$1`, [r.id]);
    } else {
      await getPool().query(`UPDATE sim_scheduled_events SET deliver_at=now() + interval '5 seconds' WHERE id=$1`, [r.id]);
    }
  }
  return ok;
}

const lastDynamic = new Map<string, number>();

/** Um ciclo completo do worker. */
export async function tick(opts: { deliver?: Deliver; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const stats = { expired: 0, timeouts: 0, started: 0, reserved: 0, dispatched: 0, delivered: 0, completed: 0 };
  stats.expired = await expireLeases(now);
  stats.timeouts = await markFeedbackTimeouts(now);
  stats.started = await startScheduled(now);
  const running = await q(
    getPool(),
    `SELECT c.id, c.materialized_at, lv.membership_mode FROM campaigns c
       LEFT JOIN list_versions lv ON lv.id = c.list_version_id WHERE c.status='RUNNING'`,
  );
  for (const r of running) {
    const dynamic = r.membership_mode === 'DYNAMIC';
    const last = lastDynamic.get(r.id) ?? 0;
    if (!r.materialized_at || (dynamic && now.getTime() - last > 10_000)) {
      await materializeEnrollments(getPool(), r.id);
      lastDynamic.set(r.id, now.getTime());
    }
    stats.reserved += (await runReservations(r.id, now)).reserved;
  }
  stats.dispatched = (await processOutbox(50, now)).processed;
  stats.delivered = await deliverSimEvents(opts.deliver ?? httpDeliver, now);
  stats.completed = await autoComplete();
  return stats;
}
