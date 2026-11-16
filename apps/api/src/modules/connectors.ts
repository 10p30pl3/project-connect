import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConnectorEventSchema } from '@voll/shared';
import { getPool, one, q } from '../db/pool.js';
import { HttpError, notFound, parse } from '../lib/problem.js';
import { processConnectorEvent } from '../engine/results.js';
import { runReservations } from '../engine/reserve.js';
import { createWorkspaceTrunkBudgetPool } from '../engine/trunk-capacity.js';
import { processOutbox } from '../engine/dispatch.js';

export function verifySignature(raw: string, secret: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const replenishInFlight = new Set<string>();

function scheduleWorkspaceReplenish(workspaceId: string) {
  if (process.env.NODE_ENV === 'test' && process.env.ENABLE_WEBHOOK_REPLENISH !== 'true') return;
  if (replenishInFlight.has(workspaceId)) return;
  replenishInFlight.add(workspaceId);
  setImmediate(async () => {
    try {
      const db = getPool();
      const running = await q<{ id: string }>(
        db,
        `SELECT id FROM campaigns WHERE workspace_id=$1 AND status='RUNNING' AND materialized_at IS NOT NULL`,
        [workspaceId],
      );
      if (running.length > 0) {
        const pool = createWorkspaceTrunkBudgetPool(db);
        for (const c of running) await runReservations(c.id, new Date(), pool);
        await processOutbox(25, new Date());
      }
    } catch {
      // Falha silenciosa: o ciclo periódico do worker reprocessará normalmente
    } finally {
      replenishInFlight.delete(workspaceId);
    }
  });
}

/** Webhook público dos conectores (§11, §18.2). Autenticado por HMAC; idempotente. */
export async function connectorRoutes(app: FastifyInstance) {
  app.post<{ Params: { connectionId: string } }>('/connectors/:connectionId/events', async (req) => {
    const id = req.params.connectionId;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Conexão');
    const conn = await one(getPool(), `SELECT id, workspace_id, webhook_secret FROM connections WHERE id=$1`, [id]);
    if (!conn) throw notFound('Conexão');
    const raw = req.rawBody ?? '';
    const sigHeader = (req.headers['x-voll-signature'] ?? req.headers['x-webhook-signature']) as string | undefined;
    if (!verifySignature(raw, conn.webhook_secret, sigHeader))
      throw new HttpError(401, 'Assinatura inválida', 'Origem do webhook não autenticada');
    const tsHeader = req.headers['x-webhook-timestamp'] as string | undefined;
    if (tsHeader !== undefined) {
      const tsNum = Number(tsHeader);
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) {
        throw new HttpError(401, 'Timestamp expirado', 'Janela de replay do webhook excedida');
      }
    }
    const ev = parse(ConnectorEventSchema, req.body);
    const r = await processConnectorEvent(conn, ev, req.body);
    if (!r.duplicate && ev.type === 'RESULT') {
      scheduleWorkspaceReplenish(conn.workspace_id);
    }
    return { accepted: true, duplicate: r.duplicate };
  });
}
