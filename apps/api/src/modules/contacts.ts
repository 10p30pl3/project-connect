import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ContactCreateSchema, DestinationCreateSchema, maskAddress } from '@voll/shared';
import { getPool, likePattern, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { conflict, notFound, parse, unprocessable } from '../lib/problem.js';
import { normalizeEmail, normalizePhone } from '../lib/phone.js';
import { audit } from '../lib/audit.js';
import { startOfOperationalDay } from '../engine/calendar.js';
import { ATTEMPT_FROM, ATTEMPT_SELECT, attemptRow } from '../services/views.js';

const DestPatchSchema = z.object({ valid: z.boolean().optional(), priority: z.number().int().min(1).max(99).optional() });

export async function contactRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>('/contacts', async (req) => {
    const a = actor(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.cursor ?? 0) || 0);
    const search = likePattern(req.query.q);
    const rows = await q(
      getPool(),
      `WITH page AS (
         SELECT c.id, c.external_id, c.name, c.history_total
           FROM contacts c
          WHERE c.workspace_id=$1 AND ($2::text IS NULL OR c.name ILIKE $2 OR c.external_id ILIKE $2)
          ORDER BY c.name ASC NULLS LAST, c.external_id ASC
          OFFSET $3 LIMIT $4
       )
       SELECT c.id, c.external_id, c.name, c.history_total,
              EXISTS (SELECT 1 FROM blocks b WHERE b.contact_id=c.id AND b.scope='CONTACT' AND b.revoked_at IS NULL) AS blocked,
              (SELECT COALESCE(json_agg(json_build_object('channelType', x.channel_type, 'count', x.n)), '[]'::json)
                 FROM (SELECT channel_type, count(*)::int AS n FROM contact_destinations d WHERE d.contact_id=c.id GROUP BY channel_type) x) AS destinations,
              (SELECT count(*)::int FROM counter_consumptions k WHERE k.contact_id=c.id AND k.kind='CONFIRMED') AS new_attempts,
              (SELECT json_build_object('code', a.tabulation_code, 'name', COALESCE(t.name, a.tabulation_code), 'at', a.finalized_at)
                 FROM attempts a LEFT JOIN tabulations t ON t.workspace_id=a.workspace_id AND t.code=a.tabulation_code
                WHERE a.contact_id=c.id AND a.tabulation_code IS NOT NULL ORDER BY a.finalized_at DESC LIMIT 1) AS last_tab,
              (SELECT count(DISTINCT campaign_id)::int FROM enrollments e WHERE e.contact_id=c.id) AS campaigns
         FROM page c`,
      [a.workspaceId, search, offset, limit + 1],
    );
    const [{ total }] = await q(
      getPool(),
      `SELECT count(*)::int AS total FROM contacts c WHERE c.workspace_id=$1 AND ($2::text IS NULL OR c.name ILIKE $2 OR c.external_id ILIKE $2)`,
      [a.workspaceId, search],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        externalId: r.external_id,
        name: r.name,
        blocked: r.blocked,
        destinations: r.destinations,
        // histórico desconhecido → total null (nunca zero fabricado, AC11)
        attempts: { total: r.history_total === null ? null : r.history_total + r.new_attempts, new: r.new_attempts },
        lastTabulation: r.last_tab,
        campaigns: r.campaigns,
      })),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
      total,
    };
  });

  app.post('/contacts', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(ContactCreateSchema, req.body);
    const a = actor(req);
    const created = await tx(async (t) => {
      const existing = await one(t, `SELECT id FROM contacts WHERE workspace_id=$1 AND external_id=$2`, [a.workspaceId, body.externalId]);
      if (existing) throw conflict('Já existe um contato cadastrado com este identificador neste workspace');

      const contact = await one(
        t,
        `INSERT INTO contacts (workspace_id, external_id, name, attributes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [a.workspaceId, body.externalId, body.name, JSON.stringify({})],
      );

      if (body.phone?.trim()) {
        const normPhone = normalizePhone(body.phone.trim());
        if (normPhone.ok) {
          await t.query(
            `INSERT INTO contact_destinations (workspace_id, contact_id, channel_type, address, priority, source)
             VALUES ($1, $2, 'VOICE', $3, 1, 'MANUAL'),
                    ($1, $2, 'WHATSAPP', $3, 1, 'MANUAL')
             ON CONFLICT DO NOTHING`,
            [a.workspaceId, contact!.id, normPhone.value],
          );
        }
      }

      if (body.email?.trim()) {
        const normEmail = normalizeEmail(body.email.trim());
        if (normEmail.ok) {
          await t.query(
            `INSERT INTO contact_destinations (workspace_id, contact_id, channel_type, address, priority, source)
             VALUES ($1, $2, 'EMAIL', $3, 1, 'MANUAL')
             ON CONFLICT DO NOTHING`,
            [a.workspaceId, contact!.id, normEmail.value],
          );
        }
      }

      await audit(t, a, 'contact.create', 'contact', contact!.id, { after: { name: contact!.name, externalId: contact!.external_id } });
      return contact!;
    });
    return reply.code(201).send(created);
  });

  app.get<{ Params: { id: string } }>('/contacts/:id', async (req) => {
    const a = actor(req);
    const c = await one(getPool(), `SELECT * FROM contacts WHERE id=$1 AND workspace_id=$2`, [req.params.id, a.workspaceId]);
    if (!c) throw notFound('Contato');
    const blocks = await q(
      getPool(),
      `SELECT id, scope, destination_id AS "destinationId", reason, origin, created_at AS "createdAt", revoked_at AS "revokedAt"
         FROM blocks WHERE contact_id=$1 ORDER BY created_at DESC`,
      [c.id],
    );
    const activeDestBlocks = new Set(blocks.filter((b) => b.scope === 'DESTINATION' && !b.revokedAt).map((b) => b.destinationId));
    const dests = await q(getPool(), `SELECT * FROM contact_destinations WHERE contact_id=$1 ORDER BY channel_type, priority, created_at`, [c.id]);
    const ws = await one(getPool(), `SELECT timezone FROM workspaces WHERE id=$1`, [a.workspaceId]);
    const dayStart = startOfOperationalDay(new Date(), ws.timezone);
    const [cnt] = await q(
      getPool(),
      `SELECT count(*) FILTER (WHERE kind='CONFIRMED')::int AS total,
              count(*) FILTER (WHERE kind='CONFIRMED' AND effective_at >= $2)::int AS today
         FROM counter_consumptions WHERE contact_id=$1`,
      [c.id, dayStart],
    );
    const byChannel = await q(
      getPool(),
      `SELECT channel_type AS "channelType", count(*)::int AS count FROM counter_consumptions WHERE contact_id=$1 AND kind='CONFIRMED' GROUP BY 1`,
      [c.id],
    );
    const enrollments = await q(
      getPool(),
      `SELECT e.state, e.stage, cp.id, cp.name FROM enrollments e JOIN campaigns cp ON cp.id=e.campaign_id WHERE e.contact_id=$1 ORDER BY e.created_at DESC`,
      [c.id],
    );
    const attempts = await q(
      getPool(),
      `SELECT ${ATTEMPT_SELECT} FROM ${ATTEMPT_FROM} WHERE a.contact_id=$1 ORDER BY a.created_at DESC LIMIT 20`,
      [c.id],
    );
    const goldenProfile = await one(
      getPool(),
      `SELECT best_time_window, best_hour_utc, best_day_of_week, preferred_channel, locator_score,
              phone_intent_tier, total_attempts_lifetime, total_confirmed_cpcs, last_cpc_at,
              last_cpc_tabulation, quarantined_destinations, tags, updated_at
         FROM contact_intelligence_profiles WHERE contact_id=$1`,
      [c.id],
    );
    return {
      contact: {
        id: c.id,
        externalId: c.external_id,
        name: c.name,
        attributes: c.attributes,
        historyTotal: c.history_total,
        historyReferenceDate: c.history_reference_date,
      },
      goldenProfile: goldenProfile
        ? {
            bestTimeWindow: goldenProfile.best_time_window,
            preferredChannel: goldenProfile.preferred_channel,
            locatorScore: goldenProfile.locator_score,
            phoneIntentTier: goldenProfile.phone_intent_tier,
            totalAttemptsLifetime: goldenProfile.total_attempts_lifetime,
            totalConfirmedCpcs: goldenProfile.total_confirmed_cpcs,
            lastCpcAt: goldenProfile.last_cpc_at,
            lastCpcTabulation: goldenProfile.last_cpc_tabulation,
            quarantinedDestinations: goldenProfile.quarantined_destinations,
            tags: goldenProfile.tags,
            updatedAt: goldenProfile.updated_at,
          }
        : null,
      destinations: dests.map((d) => ({
        id: d.id,
        channelType: d.channel_type,
        addressMasked: maskAddress(d.address),
        address: d.address,
        label: d.label,
        priority: d.priority,
        valid: d.valid,
        blocked: activeDestBlocks.has(d.id),
      })),
      blocks,
      counters: { historyTotal: c.history_total, newTotal: cnt.total, today: cnt.today, byChannel },
      enrollments: enrollments.map((e) => ({ campaign: { id: e.id, name: e.name }, state: e.state, stage: e.stage })),
      attempts: attempts.map(attemptRow),
    };
  });

  app.post<{ Params: { id: string } }>('/contacts/:id/destinations', { preHandler: requireRoles(...CAN.manageData, ...CAN.supervise) }, async (req, reply) => {
    const body = parse(DestinationCreateSchema, req.body);
    const a = actor(req);
    const c = await one(getPool(), `SELECT id FROM contacts WHERE id=$1 AND workspace_id=$2`, [req.params.id, a.workspaceId]);
    if (!c) throw notFound('Contato');
    const norm = body.channelType === 'EMAIL' ? normalizeEmail(body.address) : normalizePhone(body.address);
    if (!norm.ok) throw unprocessable('Destino inválido', { address: norm.error });
    const counts = await one(
      getPool(),
      `SELECT count(*) FILTER (WHERE channel_type='VOICE')::int AS voice,
              count(*) FILTER (WHERE channel_type IN ('WHATSAPP','SMS'))::int AS digital,
              count(*) FILTER (WHERE channel_type='EMAIL')::int AS email
         FROM contact_destinations WHERE contact_id=$1`,
      [c.id],
    );
    const limitHit =
      (body.channelType === 'VOICE' && counts.voice >= 5) ||
      ((body.channelType === 'WHATSAPP' || body.channelType === 'SMS') && counts.digital >= 3) ||
      (body.channelType === 'EMAIL' && counts.email >= 1);
    if (limitHit) throw unprocessable('Limite de destinos atingido para este canal (5 telefones, 3 digitais, 1 e-mail)', { channelType: 'Limite atingido' });
    const created = await tx(async (t) => {
      const ins = await t.query(
        `INSERT INTO contact_destinations (workspace_id, contact_id, channel_type, address, label, priority, source)
         VALUES ($1,$2,$3,$4,$5,$6,'MANUAL') ON CONFLICT (contact_id, channel_type, address) DO NOTHING RETURNING *`,
        [a.workspaceId, c.id, body.channelType, norm.value, body.label ?? null, body.priority],
      );
      if (!ins.rowCount) throw conflict('Este destino já existe para o contato neste canal');
      const d = ins.rows[0];
      await audit(t, a, 'destination.create', 'contact', c.id, { after: { channelType: d.channel_type, address: maskAddress(d.address) } });
      return {
        id: d.id, channelType: d.channel_type, addressMasked: maskAddress(d.address), address: d.address,
        label: d.label, priority: d.priority, valid: d.valid, blocked: false,
      };
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string; destId: string } }>(
    '/contacts/:id/destinations/:destId',
    { preHandler: requireRoles(...CAN.manageData, ...CAN.supervise) },
    async (req) => {
      const body = parse(DestPatchSchema, req.body);
      const a = actor(req);
      return tx(async (t) => {
        const d = await one(
          t,
          `SELECT * FROM contact_destinations WHERE id=$1 AND contact_id=$2 AND workspace_id=$3 FOR UPDATE`,
          [req.params.destId, req.params.id, a.workspaceId],
        );
        if (!d) throw notFound('Destino');
        const r = await one(
          t,
          `UPDATE contact_destinations SET valid=COALESCE($2,valid), priority=COALESCE($3,priority) WHERE id=$1 RETURNING *`,
          [d.id, body.valid ?? null, body.priority ?? null],
        );
        await audit(t, a, 'destination.update', 'contact', d.contact_id, {
          before: { valid: d.valid, priority: d.priority },
          after: { valid: r.valid, priority: r.priority },
        });
        const blocked = await one(t, `SELECT 1 FROM blocks WHERE destination_id=$1 AND revoked_at IS NULL`, [d.id]);
        return {
          id: r.id, channelType: r.channel_type, addressMasked: maskAddress(r.address), address: r.address,
          label: r.label, priority: r.priority, valid: r.valid, blocked: !!blocked,
        };
      });
    },
  );
}
