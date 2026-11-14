import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { actor } from '../auth/context.js';
import { getPool, one } from '../db/pool.js';
import { sha256Hex } from './crypto.js';

type PendingIdempotency = {
  workspaceId: string;
  actorId: string;
  method: string;
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    _idempotencyPending?: PendingIdempotency;
  }
}

function stableHashPayload(body: unknown): string {
  return sha256Hex(JSON.stringify(body ?? {}));
}

export function idempotencyGuard(routeKey: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!idempotencyKey) return;

    const a = actor(req);
    const requestHash = stableHashPayload(req.body);
    const method = req.method.toUpperCase();
    const actorId = a.userId ?? 'demo';

    // Remove registros expirados desta chave antes do claim atômico (evita TOCTOU em concorrência)
    await getPool()
      .query(
        `DELETE FROM api_idempotency_records
          WHERE workspace_id = $1 AND method = $2 AND route_key = $3 AND idempotency_key = $4 AND expires_at <= now()`,
        [a.workspaceId, method, routeKey, idempotencyKey],
      )
      .catch(() => {});

    const claimed = await one<{ id: string }>(
      getPool(),
      `INSERT INTO api_idempotency_records
         (workspace_id, actor_id, method, route_key, idempotency_key, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6, 0, '{"_processing":true}'::jsonb)
       ON CONFLICT (workspace_id, method, route_key, idempotency_key) DO NOTHING
       RETURNING id::text`,
      [a.workspaceId, actorId, method, routeKey, idempotencyKey, requestHash],
    ).catch(() => null);

    if (!claimed) {
      const existing = await one<{ request_hash: string; status_code: number; response_body: unknown }>(
        getPool(),
        `SELECT request_hash, status_code, response_body
           FROM api_idempotency_records
          WHERE workspace_id = $1
            AND method = $2
            AND route_key = $3
            AND idempotency_key = $4`,
        [a.workspaceId, method, routeKey, idempotencyKey],
      ).catch(() => null);

      if (existing) {
        if (existing.request_hash !== requestHash) {
          return reply.code(409).send({
            type: 'https://httpstatuses.com/409',
            title: 'Conflito de idempotência',
            status: 409,
            detail: 'Esta Idempotency-Key já foi utilizada anteriormente com um payload diferente.',
          });
        }
        if (existing.status_code === 0) {
          return reply.code(409).send({
            type: 'https://httpstatuses.com/409',
            title: 'Requisição em andamento',
            status: 409,
            detail: 'Uma requisição idêntica com esta Idempotency-Key ainda está sendo processada.',
          });
        }
        reply.header('X-Idempotent-Replay', 'true');
        return reply.code(existing.status_code).send(existing.response_body ?? { ok: true });
      }
    }

    req._idempotencyPending = {
      workspaceId: a.workspaceId,
      actorId,
      method,
      routeKey,
      idempotencyKey,
      requestHash,
    };
  };
}

export function registerIdempotencyHook(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    const pending = req._idempotencyPending;
    if (!pending) return payload;
    req._idempotencyPending = undefined;

    if (reply.statusCode >= 500) {
      await getPool()
        .query(
          `DELETE FROM api_idempotency_records
            WHERE workspace_id = $1 AND method = $2 AND route_key = $3 AND idempotency_key = $4 AND status_code = 0`,
          [pending.workspaceId, pending.method, pending.routeKey, pending.idempotencyKey],
        )
        .catch(() => {});
      return payload;
    }

    let parsedBody: unknown = null;
    if (typeof payload === 'string') {
      try {
        parsedBody = JSON.parse(payload);
      } catch {
        parsedBody = { raw: payload.slice(0, 1000) };
      }
    } else if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      parsedBody = payload;
    }

    await getPool()
      .query(
        `UPDATE api_idempotency_records
            SET status_code = $5,
                response_body = $6::jsonb
          WHERE workspace_id = $1 AND method = $2 AND route_key = $3 AND idempotency_key = $4`,
        [
          pending.workspaceId,
          pending.method,
          pending.routeKey,
          pending.idempotencyKey,
          reply.statusCode,
          parsedBody === null ? null : JSON.stringify(parsedBody),
        ],
      )
      .catch(() => {});

    return payload;
  });
}
