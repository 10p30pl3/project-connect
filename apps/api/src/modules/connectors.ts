import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConnectorEventSchema } from '@voll/shared';
import { getPool, one } from '../db/pool.js';
import { HttpError, notFound, parse } from '../lib/problem.js';
import { processConnectorEvent } from '../engine/results.js';

export function verifySignature(raw: string, secret: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
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
    return { accepted: true, duplicate: r.duplicate };
  });
}
