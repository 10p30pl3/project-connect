import type { FastifyInstance } from 'fastify';
import { CalendarCreateSchema, CalendarHolidayCreateSchema } from '@voll/shared';
import { getPool, one, q } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { notFound, parse } from '../lib/problem.js';

export async function calendarRoutes(app: FastifyInstance) {
  app.get('/calendars', async (req) => {
    const workspaceId = actor(req).workspaceId;
    const includeArchived = (req.query as { includeArchived?: string }).includeArchived === 'true';
    const calendars = await q(
      getPool(),
      `SELECT id, name, description, timezone, windows, holiday_policy, active, archived_at, created_at, updated_at
       FROM calendars
       WHERE workspace_id = $1 ${includeArchived ? '' : 'AND archived_at IS NULL'}
       ORDER BY name`,
      [workspaceId],
    );

    const items = await Promise.all(
      calendars.map(async (c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        timezone: c.timezone,
        windows: c.windows,
        holidayPolicy: c.holiday_policy,
        active: c.active,
        archivedAt: c.archived_at ? new Date(c.archived_at).toISOString() : null,
        createdAt: c.created_at ? new Date(c.created_at).toISOString() : undefined,
        updatedAt: c.updated_at ? new Date(c.updated_at).toISOString() : undefined,
        holidays: await q(
          getPool(),
          `SELECT id, date::text, name, action, start_time AS "startTime", end_time AS "endTime"
           FROM calendar_holidays
           WHERE calendar_id = $1
           ORDER BY date`,
          [c.id],
        ),
      })),
    );
    return { items };
  });

  app.post('/calendars', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(CalendarCreateSchema, req.body);
    const workspaceId = actor(req).workspaceId;
    const row = await one(
      getPool(),
      `INSERT INTO calendars (workspace_id, name, description, timezone, windows, holiday_policy, active)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, name, description, timezone, windows, holiday_policy AS "holidayPolicy", active, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [workspaceId, body.name, body.description ?? null, body.timezone, JSON.stringify(body.windows), body.holidayPolicy, body.active],
    );
    return reply.code(201).send({ ...row, holidays: [] });
  });

  app.patch('/calendars/:id', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const id = (req.params as { id: string }).id;
    const body = parse(CalendarCreateSchema.partial(), req.body);
    const workspaceId = actor(req).workspaceId;
    const current = await one(getPool(), 'SELECT * FROM calendars WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    if (!current) throw notFound('Calendário');

    const row = await one(
      getPool(),
      `UPDATE calendars
       SET name = $3, description = $4, timezone = $5, windows = $6::jsonb, holiday_policy = $7, active = $8, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING id, name, description, timezone, windows, holiday_policy AS "holidayPolicy", active, archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        workspaceId,
        body.name ?? current.name,
        body.description === undefined ? current.description : body.description,
        body.timezone ?? current.timezone,
        JSON.stringify(body.windows ?? current.windows),
        body.holidayPolicy ?? current.holiday_policy,
        body.active ?? current.active,
      ],
    );
    const holidays = await q(
      getPool(),
      `SELECT id, date::text, name, action, start_time AS "startTime", end_time AS "endTime"
       FROM calendar_holidays WHERE calendar_id = $1 ORDER BY date`,
      [id],
    );
    return { ...row, holidays };
  });

  app.post('/calendars/:id/archive', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const id = (req.params as { id: string }).id;
    const workspaceId = actor(req).workspaceId;
    const row = await one(
      getPool(),
      `UPDATE calendars SET archived_at = now(), active = false, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING id, archived_at AS "archivedAt"`,
      [id, workspaceId],
    );
    if (!row) throw notFound('Calendário');
    return row;
  });

  app.post('/calendars/:id/restore', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const id = (req.params as { id: string }).id;
    const workspaceId = actor(req).workspaceId;
    const row = await one(
      getPool(),
      `UPDATE calendars SET archived_at = NULL, active = true, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING id, archived_at AS "archivedAt"`,
      [id, workspaceId],
    );
    if (!row) throw notFound('Calendário');
    return row;
  });

  app.delete('/calendars/:id', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const workspaceId = actor(req).workspaceId;
    const row = await one(getPool(), 'DELETE FROM calendars WHERE id = $1 AND workspace_id = $2 RETURNING id', [id, workspaceId]);
    if (!row) throw notFound('Calendário');
    return reply.code(204).send();
  });

  app.post('/calendars/:id/holidays', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(CalendarHolidayCreateSchema, req.body);
    const id = (req.params as { id: string }).id;
    const workspaceId = actor(req).workspaceId;
    const calendar = await one(getPool(), 'SELECT id FROM calendars WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    if (!calendar) throw notFound('Calendário');

    const row = await one(
      getPool(),
      `INSERT INTO calendar_holidays (calendar_id, date, name, action, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (calendar_id, date, name)
       DO UPDATE SET action = EXCLUDED.action, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING id, date::text, name, action, start_time AS "startTime", end_time AS "endTime"`,
      [id, body.date, body.name, body.action, body.startTime ?? null, body.endTime ?? null],
    );
    return reply.code(201).send(row);
  });

  app.delete('/calendars/:id/holidays/:holidayId', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const { id, holidayId } = req.params as { id: string; holidayId: string };
    const workspaceId = actor(req).workspaceId;
    const row = await one(
      getPool(),
      `DELETE FROM calendar_holidays h USING calendars c
       WHERE h.id = $1 AND h.calendar_id = c.id AND c.id = $2 AND c.workspace_id = $3
       RETURNING h.id`,
      [holidayId, id, workspaceId],
    );
    if (!row) throw notFound('Feriado');
    return reply.code(204).send();
  });
}
