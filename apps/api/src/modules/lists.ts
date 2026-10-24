import type { FastifyInstance } from 'fastify';
import { ListPreviewSchema, ListPublishSchema } from '@voll/shared';
import { getPool, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { notFound, parse, unprocessable } from '../lib/problem.js';
import { computeMembership } from '../engine/membership.js';

async function mailingFields(mailingId: string) {
  const v = await one(
    getPool(),
    `SELECT field_mapping FROM mailing_versions WHERE mailing_id=$1 ORDER BY version DESC LIMIT 1`,
    [mailingId],
  );
  const attrs = ((v?.field_mapping ?? []) as any[])
    .filter((m) => m.target === 'attribute')
    .map((m) => ({ key: (m.attributeName ?? m.column).trim(), type: m.type ?? 'text' }));
  return [{ key: 'name', type: 'text' }, { key: 'external_id', type: 'text' }, ...attrs];
}

export async function listRoutes(app: FastifyInstance) {
  app.get('/lists', async (req) => {
    const rows = await q(
      getPool(),
      `SELECT l.id, l.name, m.id AS mailing_id, m.name AS mailing_name,
              v.id AS v_id, v.version, v.membership_mode, v.member_count, v.published_at
         FROM lists l JOIN mailings m ON m.id=l.mailing_id
         JOIN LATERAL (SELECT * FROM list_versions WHERE list_id=l.id ORDER BY version DESC LIMIT 1) v ON true
        WHERE l.workspace_id=$1 ORDER BY v.published_at DESC`,
      [actor(req).workspaceId],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        mailing: { id: r.mailing_id, name: r.mailing_name },
        latestVersion: { id: r.v_id, version: r.version, membershipMode: r.membership_mode, memberCount: r.member_count, publishedAt: r.published_at },
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/lists/:id', async (req) => {
    const l = await one(
      getPool(),
      `SELECT l.*, m.name AS mailing_name FROM lists l JOIN mailings m ON m.id=l.mailing_id WHERE l.id=$1 AND l.workspace_id=$2`,
      [req.params.id, actor(req).workspaceId],
    );
    if (!l) throw notFound('Lista');
    const versions = await q(
      getPool(),
      `SELECT id, version, filters, sort, membership_mode AS "membershipMode", member_count AS "memberCount", published_at AS "publishedAt"
         FROM list_versions WHERE list_id=$1 ORDER BY version DESC`,
      [l.id],
    );
    return {
      id: l.id,
      name: l.name,
      mailing: { id: l.mailing_id, name: l.mailing_name },
      createdAt: l.created_at,
      latestVersion: versions[0] ?? null,
      versions,
      fields: await mailingFields(l.mailing_id),
    };
  });

  app.post('/lists/preview', async (req) => {
    const body = parse(ListPreviewSchema, req.body);
    const a = actor(req);
    const m = await one(getPool(), `SELECT id FROM mailings WHERE id=$1 AND workspace_id=$2`, [body.mailingId, a.workspaceId]);
    if (!m) throw notFound('Mailing');
    const r = await computeMembership(getPool(), a.workspaceId, m.id, body.filters, body.sort);
    return {
      selected: r.members.length,
      excluded: r.excluded,
      filteredOut: r.filteredOut,
      sample: r.members.slice(0, 50).map((x) => ({ contactId: x.contactId, externalId: x.externalId, name: x.name, fields: x.fields })),
      fields: await mailingFields(m.id),
    };
  });

  app.post('/lists', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(ListPublishSchema, req.body);
    const a = actor(req);
    const result = await tx(async (c) => {
      const m = await one(c, `SELECT id FROM mailings WHERE id=$1 AND workspace_id=$2`, [body.mailingId, a.workspaceId]);
      if (!m) throw notFound('Mailing');
      const r = await computeMembership(c, a.workspaceId, m.id, body.filters, body.sort);
      if (r.members.length === 0) throw unprocessable('A lista precisa ter pelo menos um contato disponível', { filters: 'Nenhum contato disponível com estes filtros' });
      let listId = body.listId;
      if (listId) {
        const l = await one(c, `SELECT id, mailing_id FROM lists WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [listId, a.workspaceId]);
        if (!l) throw notFound('Lista');
        if (l.mailing_id !== m.id) throw unprocessable('A nova versão deve usar o mesmo mailing', { mailingId: 'Mailing diferente da lista' });
        await c.query(`UPDATE lists SET name=$2 WHERE id=$1`, [listId, body.name]);
      } else {
        listId = (await one(c, `INSERT INTO lists (workspace_id, mailing_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [
          a.workspaceId, m.id, body.name, a.userId,
        ]))!.id;
      }
      const [{ v }] = await q(c, `SELECT COALESCE(max(version),0)+1 AS v FROM list_versions WHERE list_id=$1`, [listId]);
      const lv = await one(
        c,
        `INSERT INTO list_versions (list_id, version, filters, sort, membership_mode, member_count, published_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [listId, v, JSON.stringify(body.filters), JSON.stringify(body.sort), body.membershipMode, r.members.length, a.userId],
      );
      if (body.membershipMode === 'SNAPSHOT') {
        await c.query(
          `INSERT INTO list_members (list_version_id, contact_id, mailing_record_id, order_key)
           SELECT $1, x.c, x.r, x.o FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS x(c, r, o)`,
          [lv!.id, r.members.map((x) => x.contactId), r.members.map((x) => x.recordId), r.members.map((_, i) => i + 1)],
        );
      }
      return { listId: listId!, listVersionId: lv!.id as string, version: v as number, memberCount: r.members.length };
    });
    return reply.code(201).send(result);
  });

  app.get<{ Params: { versionId: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/lists/versions/:versionId/members',
    async (req) => {
      const a = actor(req);
      const lv = await one(
        getPool(),
        `SELECT v.*, l.mailing_id FROM list_versions v JOIN lists l ON l.id=v.list_id WHERE v.id=$1 AND l.workspace_id=$2`,
        [req.params.versionId, a.workspaceId],
      );
      if (!lv) throw notFound('Versão da lista');
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const offset = Number(req.query.cursor ?? 0);
      let all: { contactId: string; externalId: string; name: string | null; fields: Record<string, unknown> }[];
      if (lv.membership_mode === 'SNAPSHOT') {
        const rows = await q(
          getPool(),
          `SELECT lm.contact_id, c.external_id, c.name, r.typed_fields FROM list_members lm
             JOIN contacts c ON c.id=lm.contact_id JOIN mailing_records r ON r.id=lm.mailing_record_id
            WHERE lm.list_version_id=$1 ORDER BY lm.order_key`,
          [lv.id],
        );
        all = rows.map((r) => ({ contactId: r.contact_id, externalId: r.external_id, name: r.name, fields: r.typed_fields }));
      } else {
        const r = await computeMembership(getPool(), a.workspaceId, lv.mailing_id, lv.filters, lv.sort);
        all = r.members.map((x) => ({ contactId: x.contactId, externalId: x.externalId, name: x.name, fields: x.fields }));
      }
      const page = all.slice(offset, offset + limit);
      return { items: page, nextCursor: offset + limit < all.length ? String(offset + limit) : null, total: all.length };
    },
  );
}
