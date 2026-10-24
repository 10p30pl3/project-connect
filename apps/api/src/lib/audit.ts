import type { Db } from '../db/pool.js';

export type Actor = { userId: string | null; organizationId: string; workspaceId: string };

export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  opts: { reason?: string | null; before?: unknown; after?: unknown } = {},
) {
  await db.query(
    `INSERT INTO audit_log (organization_id, workspace_id, user_id, action, entity, entity_id, reason, before, after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      actor.organizationId,
      actor.workspaceId,
      actor.userId,
      action,
      entity,
      entityId,
      opts.reason ?? null,
      opts.before === undefined ? null : JSON.stringify(opts.before),
      opts.after === undefined ? null : JSON.stringify(opts.after),
    ],
  );
}
