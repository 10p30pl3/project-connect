import type { FastifyInstance } from 'fastify';
import { BlockCreateSchema, BlockRevokeSchema, InstitutionalLimitsSchema } from '@voll/shared';
import { getPool, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, requireSuperAdmin, CAN } from '../auth/context.js';
import { conflict, notFound, parse, unprocessable } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { applyOptOut } from '../engine/results.js';
import { cancelUnsent } from '../engine/events.js';
import { seed } from '../db/seed.js';
import { getPartitionStats, ensureUpcomingPartitions } from '../db/partition-service.js';

export async function controlRoutes(app: FastifyInstance) {
  app.get('/control', async (req) => {
    const w = await one(getPool(), `SELECT * FROM workspaces WHERE id=$1`, [actor(req).workspaceId]);
    return { dailyLimit: w.institutional_daily_limit, totalLimit: w.institutional_total_limit, globalSuspension: w.global_suspension };
  });

  app.put('/control', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const body = parse(InstitutionalLimitsSchema, req.body);
    const a = actor(req);
    return tx(async (c) => {
      const before = await one(c, `SELECT * FROM workspaces WHERE id=$1 FOR UPDATE`, [a.workspaceId]);
      const w = await one(
        c,
        `UPDATE workspaces SET institutional_daily_limit=$2, institutional_total_limit=$3, global_suspension=$4 WHERE id=$1 RETURNING *`,
        [a.workspaceId, body.dailyLimit, body.totalLimit, body.globalSuspension],
      );
      if (body.globalSuspension && !before.global_suspension) {
        // suspensão impede novos envios: cancela reservas ainda não enviadas
        await cancelUnsent(c, `workspace_id=$1`, [a.workspaceId], 'GLOBAL_SUSPENSION');
      }
      await audit(c, a, 'control.update', 'workspace', a.workspaceId, {
        reason: body.reason,
        before: { dailyLimit: before.institutional_daily_limit, totalLimit: before.institutional_total_limit, globalSuspension: before.global_suspension },
        after: { dailyLimit: w.institutional_daily_limit, totalLimit: w.institutional_total_limit, globalSuspension: w.global_suspension },
      });
      return { dailyLimit: w.institutional_daily_limit, totalLimit: w.institutional_total_limit, globalSuspension: w.global_suspension };
    });
  });

  app.post('/blocks', { preHandler: requireRoles(...CAN.supervise) }, async (req, reply) => {
    const body = parse(BlockCreateSchema, req.body);
    const a = actor(req);
    const created = await tx(async (c) => {
      const contact = await one(c, `SELECT id FROM contacts WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [body.contactId, a.workspaceId]);
      if (!contact) throw notFound('Contato');
      let blockId: string;
      if (body.scope === 'CONTACT') {
        const exists = await one(c, `SELECT id FROM blocks WHERE contact_id=$1 AND scope='CONTACT' AND revoked_at IS NULL`, [contact.id]);
        if (exists) throw conflict('O cliente já está bloqueado');
        await applyOptOut(c, a.workspaceId, contact.id, 'MANUAL', body.reason, a.userId);
        blockId = (await one(c, `SELECT id FROM blocks WHERE contact_id=$1 AND scope='CONTACT' AND revoked_at IS NULL`, [contact.id]))!.id;
      } else {
        if (!body.destinationId) throw unprocessable('Informe o destino', { destinationId: 'Selecione o destino' });
        const d = await one(c, `SELECT id FROM contact_destinations WHERE id=$1 AND contact_id=$2`, [body.destinationId, contact.id]);
        if (!d) throw notFound('Destino');
        const exists = await one(c, `SELECT id FROM blocks WHERE destination_id=$1 AND revoked_at IS NULL`, [d.id]);
        if (exists) throw conflict('O destino já está bloqueado');
        blockId = (await one(
          c,
          `INSERT INTO blocks (workspace_id, scope, contact_id, destination_id, reason, origin, created_by)
           VALUES ($1,'DESTINATION',$2,$3,$4,'MANUAL',$5) RETURNING id`,
          [a.workspaceId, contact.id, d.id, body.reason, a.userId],
        ))!.id;
        await cancelUnsent(c, `destination_id=$1`, [d.id], 'DESTINATION_BLOCKED');
      }
      await audit(c, a, 'block.create', 'contact', contact.id, { reason: body.reason, after: { scope: body.scope, destinationId: body.destinationId ?? null, blockId } });
      const b = await one(
        c,
        `SELECT id, scope, contact_id AS "contactId", destination_id AS "destinationId", reason, origin, created_at AS "createdAt", revoked_at AS "revokedAt" FROM blocks WHERE id=$1`,
        [blockId],
      );
      return b;
    });
    return reply.code(201).send(created);
  });

  app.post<{ Params: { id: string } }>('/blocks/:id/revoke', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const body = parse(BlockRevokeSchema, req.body);
    const a = actor(req);
    return tx(async (c) => {
      const b = await one(c, `SELECT * FROM blocks WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
      if (!b) throw notFound('Bloqueio');
      if (b.revoked_at) throw conflict('Bloqueio já revogado');
      await c.query(`UPDATE blocks SET revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE id=$1`, [b.id, a.userId, body.reason]);
      await audit(c, a, 'block.revoke', 'contact', b.contact_id, {
        reason: body.reason,
        before: { blockId: b.id, scope: b.scope, origin: b.origin, reason: b.reason },
        after: { revoked: true },
      });
      return { ok: true };
    });
  });

  app.get<{ Querystring: { cursor?: string; limit?: string; entity?: string } }>('/audit', async (req) => {
    const a = actor(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const entityFilter = req.query.entity && req.query.entity !== 'ALL' ? `%${req.query.entity.trim()}%` : null;
    const rows = await q(
      getPool(),
      `SELECT l.id, l.at, u.name AS user_name, l.action, l.entity, l.entity_id, l.reason, l.before, l.after
         FROM audit_log l LEFT JOIN users u ON u.id=l.user_id
        WHERE l.organization_id=$1
          AND ($2::bigint IS NULL OR l.id < $2)
          AND ($3::text IS NULL OR l.entity ILIKE $3)
        ORDER BY l.id DESC LIMIT $4`,
      [a.organizationId, cursor, entityFilter, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: String(r.id), at: r.at, user: { name: r.user_name ?? 'Sistema' }, action: r.action, entity: r.entity,
        entityId: r.entity_id, reason: r.reason, before: r.before, after: r.after,
      })),
      nextCursor: rows.length > limit ? String(page[page.length - 1].id) : null,
    };
  });

  app.post('/system/reset', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const a = actor(req);
    await tx(async (c) => {
      await c.query(
        `DELETE FROM sim_scheduled_events WHERE connection_id IN (SELECT id FROM connections WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(`DELETE FROM connector_inbox WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(
        `DELETE FROM outbox WHERE attempt_id IN (SELECT id FROM attempts WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(`DELETE FROM counter_consumptions WHERE workspace_id=$1`, [a.workspaceId]);
      // Bypass transacional local sem lock exclusivo global na tabela attempt_events
      await c.query(`SET LOCAL voll.allow_mutation = 'on'`);
      await c.query(`DELETE FROM attempt_events WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM attempts WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(
        `DELETE FROM enrollments WHERE campaign_id IN (SELECT id FROM campaigns WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(`DELETE FROM contact_cpc_plans WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(
        `DELETE FROM lab_experiment_waves WHERE run_id IN (SELECT id FROM mailing_intelligence_runs WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(`DELETE FROM mailing_intelligence_runs WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM contact_intelligence_profiles WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM campaign_drafts WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM campaigns WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM blocks WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(
        `DELETE FROM list_members WHERE list_version_id IN (
          SELECT lv.id FROM list_versions lv JOIN lists l ON l.id=lv.list_id WHERE l.workspace_id=$1
        )`,
        [a.workspaceId],
      );
      await c.query(
        `DELETE FROM list_versions WHERE list_id IN (SELECT id FROM lists WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(`DELETE FROM lists WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(
        `DELETE FROM mailing_records WHERE mailing_id IN (SELECT id FROM mailings WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(
        `DELETE FROM mailing_versions WHERE mailing_id IN (SELECT id FROM mailings WHERE workspace_id=$1)`,
        [a.workspaceId],
      );
      await c.query(`DELETE FROM mailings WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM contact_destinations WHERE workspace_id=$1`, [a.workspaceId]);
      await c.query(`DELETE FROM contacts WHERE workspace_id=$1`, [a.workspaceId]);

      await audit(c, a, 'system.reset', 'workspace', a.workspaceId, {
        reason: 'Reset operacional completo (Telefonia & Agentes IA preservados) executado via portal Sistema',
      });
    });
    return { ok: true, reset: true, preservedTelephony: true };
  });

  app.post('/system/seed-demo', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const a = actor(req);
    const result = await seed({ withSampleMailing: true, workspaceId: a.workspaceId });
    await audit(getPool(), a, 'system.seed_demo', 'workspace', a.workspaceId, {
      reason: 'Carga de dados de exemplo (1.000 contatos)',
    });
    return { ok: true, ...result };
  });

  app.get('/observability/partitions', { preHandler: requireSuperAdmin }, async () => {
    return getPartitionStats();
  });

  app.post('/observability/partitions/ensure', { preHandler: requireSuperAdmin }, async (req) => {
    const a = actor(req);
    const res = await ensureUpcomingPartitions(1, 3);
    await audit(getPool(), a, 'observability.partitions_ensure', 'partition', 'tenant_billing_ledger', { after: res });
    return { ok: true, ...res };
  });
}
