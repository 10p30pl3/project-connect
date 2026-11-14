import type { FastifyInstance } from 'fastify';
import { ImportCommitSchema, ImportPreviewSchema } from '@voll/shared';
import { getPool, likePattern, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { notFound, parse, unprocessable } from '../lib/problem.js';
import { buildPreview, commitImport } from '../services/importer.js';
import { toCsv } from '../lib/csv.js';
import { audit } from '../lib/audit.js';
import { conflict } from '../lib/problem.js';

export async function mailingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { archived?: string } }>('/mailings', async (req) => {
    const mode = req.query.archived === 'true' ? 'archived' : req.query.archived === 'all' ? 'all' : 'active';
    const filterSql =
      mode === 'archived'
        ? 'AND m.archived_at IS NOT NULL'
        : mode === 'all'
          ? ''
          : 'AND m.archived_at IS NULL';
    const rows = await q(
      getPool(),
      `SELECT m.id, m.name, m.created_at, m.archived_at, m.archived_reason,
              (SELECT count(*)::int FROM mailing_records r WHERE r.mailing_id=m.id) AS record_count,
              v.version, v.valid_rows, v.rejected_rows, v.created_at AS v_created
         FROM mailings m
         JOIN LATERAL (SELECT * FROM mailing_versions WHERE mailing_id=m.id ORDER BY version DESC LIMIT 1) v ON true
        WHERE m.workspace_id=$1 ${filterSql} ORDER BY m.created_at DESC`,
      [actor(req).workspaceId],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        archivedAt: r.archived_at ?? null,
        archivedReason: r.archived_reason ?? null,
        recordCount: r.record_count,
        lastVersion: { version: r.version, validRows: r.valid_rows, rejectedRows: r.rejected_rows, createdAt: r.v_created },
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/mailings/:id', async (req) => {
    const m = await one(getPool(), `SELECT * FROM mailings WHERE id=$1 AND workspace_id=$2`, [req.params.id, actor(req).workspaceId]);
    if (!m) throw notFound('Mailing');
    const versions = await q(
      getPool(),
      `SELECT id, version, total_rows, valid_rows, rejected_rows, created_at, field_mapping FROM mailing_versions WHERE mailing_id=$1 ORDER BY version DESC`,
      [m.id],
    );
    const [{ n }] = await q(getPool(), `SELECT count(*)::int AS n FROM mailing_records WHERE mailing_id=$1`, [m.id]);
    const mapping = versions[0]?.field_mapping ?? [];
    const columns = mapping
      .filter((x: any) => x.target === 'attribute')
      .map((x: any) => (x.attributeName ?? x.column).trim());
    return {
      id: m.id,
      name: m.name,
      createdAt: m.created_at,
      archivedAt: m.archived_at ?? null,
      archivedReason: m.archived_reason ?? null,
      recordCount: n,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        totalRows: v.total_rows,
        validRows: v.valid_rows,
        rejectedRows: v.rejected_rows,
        createdAt: v.created_at,
      })),
      columns,
    };
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/mailings/:id/archive',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      const row = await tx(async (c) => {
        const m = await one(c, `SELECT id, name, archived_at FROM mailings WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
        if (!m) throw notFound('Mailing');
        if (m.archived_at) throw conflict('Este mailing já está arquivado.');
        const activeCamp = await one(
          c,
          `SELECT name FROM campaigns WHERE workspace_id=$1 AND mailing_id=$2 AND status='RUNNING' LIMIT 1`,
          [a.workspaceId, m.id],
        );
        if (activeCamp) {
          throw conflict(`O mailing está sendo utilizado na campanha ativa "${activeCamp.name}". Pause ou encerre a campanha antes de arquivá-lo.`);
        }
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null;
        const upd = await one(
          c,
          `UPDATE mailings SET archived_at = now(), archived_reason = $2 WHERE id=$1 RETURNING id, name, archived_at, archived_reason`,
          [m.id, reason],
        );
        await audit(c, a, 'mailing.archive', 'mailing', m.id, { before: { archivedAt: null }, after: { archivedAt: upd!.archived_at, reason } });
        return upd!;
      });
      return { id: row.id, name: row.name, archivedAt: row.archived_at, archivedReason: row.archived_reason };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mailings/:id/unarchive',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      const row = await tx(async (c) => {
        const m = await one(c, `SELECT id, name, archived_at FROM mailings WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
        if (!m) throw notFound('Mailing');
        if (!m.archived_at) throw conflict('Este mailing não está arquivado.');
        const upd = await one(
          c,
          `UPDATE mailings SET archived_at = NULL, archived_reason = NULL WHERE id=$1 RETURNING id, name, archived_at, archived_reason`,
          [m.id],
        );
        await audit(c, a, 'mailing.unarchive', 'mailing', m.id, { before: { archivedAt: m.archived_at }, after: { archivedAt: null } });
        return upd!;
      });
      return { id: row.id, name: row.name, archivedAt: row.archived_at, archivedReason: row.archived_reason };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string; q?: string } }>(
    '/mailings/:id/records',
    async (req) => {
      const a = actor(req);
      const m = await one(getPool(), `SELECT id FROM mailings WHERE id=$1 AND workspace_id=$2`, [req.params.id, a.workspaceId]);
      if (!m) throw notFound('Mailing');
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const cursor = Number(req.query.cursor ?? 0);
      const search = likePattern(req.query.q);
      const rows = await q(
        getPool(),
        `SELECT r.id, r.row_number, r.contact_id, r.typed_fields, c.external_id, c.name,
                EXISTS (SELECT 1 FROM blocks b WHERE b.contact_id=c.id AND b.scope='CONTACT' AND b.revoked_at IS NULL) AS blocked
           FROM mailing_records r JOIN contacts c ON c.id=r.contact_id
          WHERE r.mailing_id=$1 AND r.row_number > $2
            AND ($3::text IS NULL OR c.name ILIKE $3 OR c.external_id ILIKE $3)
          ORDER BY r.row_number LIMIT $4`,
        [m.id, cursor, search, limit + 1],
      );
      const [{ total }] = await q(
        getPool(),
        `SELECT count(*)::int AS total FROM mailing_records r JOIN contacts c ON c.id=r.contact_id
          WHERE r.mailing_id=$1 AND ($2::text IS NULL OR c.name ILIKE $2 OR c.external_id ILIKE $2)`,
        [m.id, search],
      );
      const page = rows.slice(0, limit);
      return {
        items: page.map((r) => ({
          id: r.id,
          rowNumber: r.row_number,
          contactId: r.contact_id,
          externalId: r.external_id,
          name: r.name,
          fields: r.typed_fields,
          blocked: r.blocked,
        })),
        nextCursor: rows.length > limit ? String(page[page.length - 1].row_number) : null,
        total,
      };
    },
  );

  app.get<{ Params: { id: string; versionId: string } }>('/mailings/:id/versions/:versionId/rejected.csv', async (req, reply) => {
    const v = await one(
      getPool(),
      `SELECT v.* FROM mailing_versions v JOIN mailings m ON m.id=v.mailing_id
        WHERE v.id=$1 AND v.mailing_id=$2 AND m.workspace_id=$3`,
      [req.params.versionId, req.params.id, actor(req).workspaceId],
    );
    if (!v) throw notFound('Versão do mailing');
    const headers: string[] = v.headers;
    const rows = (v.rejected_report as any[]).map((r) => [r.rowNumber, ...headers.map((h) => r.values[h] ?? ''), r.errors.join(' | ')]);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="rejeitados-v${v.version}.csv"`);
    return toCsv(['linha_original', ...headers, 'motivos'], rows);
  });

  app.post('/imports/preview', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const body = parse(ImportPreviewSchema, req.body);
    const opts = {
      defaultTimezone: body.defaultTimezone,
      defaultDurationMinutes: body.defaultWindowDurationMinutes,
    };
    return buildPreview(body.content, body.delimiter, body.hasHeader, body.mapping, opts).response;
  });

  app.post('/imports', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(ImportCommitSchema, req.body);
    const a = actor(req);
    const key = (req.headers['idempotency-key'] as string | undefined) || body.idempotencyKey;
    const opts = {
      defaultTimezone: body.defaultTimezone,
      defaultDurationMinutes: body.defaultWindowDurationMinutes,
      idempotencyKey: key,
    };
    const preview = buildPreview(body.content, body.delimiter, body.hasHeader, body.mapping, opts);
    const r = preview.response;
    if (r.schemaErrors.length) throw unprocessable(r.schemaErrors.join('; '), { mapping: r.schemaErrors[0] });
    if (r.validRows === 0) throw unprocessable('Nenhum registro válido para importar');
    if (r.rejectedRows > 0 && !body.acceptPartial)
      throw unprocessable(
        `${r.rejectedRows} registro(s) com inconsistência. Confirme a importação parcial de ${r.validRows} válido(s) ou corrija o arquivo.`,
        { acceptPartial: 'Confirme a importação parcial' },
      );
    const result = await tx(async (c) => {
      const res = await commitImport(c, { id: a.workspaceId }, a.userId, body.name, preview, opts);
      await audit(c, a, 'mailing.import', 'mailing', res.mailingId, {
        after: { name: body.name, validRows: res.validRows, rejectedRows: res.rejectedRows, idempotent: (res as any).idempotentReplay ?? false },
      });
      return res;
    });
    return reply.code(201).send(result);
  });
}
