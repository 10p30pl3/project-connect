/** Inscrições da campanha a partir da base (§7.2, §7.3). Idempotente (AC22). */
import type { Db } from '../db/pool.js';
import { q } from '../db/pool.js';
import { computeMembership } from './membership.js';

export async function materializeEnrollments(db: Db, campaignId: string): Promise<{ inserted: number; removed: number }> {
  const [c] = await q(
    db,
    `SELECT c.id, c.workspace_id, c.mailing_id, c.list_version_id, c.materialized_at,
            lv.membership_mode, lv.filters, lv.sort
       FROM campaigns c LEFT JOIN list_versions lv ON lv.id = c.list_version_id WHERE c.id=$1`,
    [campaignId],
  );
  if (!c) return { inserted: 0, removed: 0 };
  const dynamic = c.membership_mode === 'DYNAMIC';
  if (!dynamic && c.materialized_at) return { inserted: 0, removed: 0 };

  let rows: { contactId: string; recordId: string; orderKey: number }[] = [];
  let matched: Set<string> | null = null;
  if (c.membership_mode === 'SNAPSHOT') {
    rows = (
      await q(db, `SELECT contact_id, mailing_record_id, order_key FROM list_members WHERE list_version_id=$1 ORDER BY order_key`, [
        c.list_version_id,
      ])
    ).map((r) => ({ contactId: r.contact_id, recordId: r.mailing_record_id, orderKey: r.order_key }));
  } else {
    const m = await computeMembership(db, c.workspace_id, c.mailing_id, dynamic ? c.filters : [], dynamic ? c.sort : []);
    rows = m.members.map((x, i) => ({ contactId: x.contactId, recordId: x.recordId, orderKey: i + 1 }));
    matched = m.matched;
  }

  let inserted = 0;
  if (rows.length) {
    const r = await db.query(
      `INSERT INTO enrollments (campaign_id, contact_id, mailing_record_id, order_key, btc_start_minute, btc_end_minute, btc_timezone, btc_source)
       SELECT $1, x.contact_id, x.record_id, x.order_key,
              (mr.typed_fields->>'btc_start_minute')::smallint,
              (mr.typed_fields->>'btc_end_minute')::smallint,
              mr.typed_fields->>'btc_timezone',
              mr.typed_fields->>'btc_source'
         FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS x(contact_id, record_id, order_key)
         LEFT JOIN mailing_records mr ON mr.id = x.record_id
       ON CONFLICT (campaign_id, contact_id, cycle) DO NOTHING`,
      [campaignId, rows.map((r) => r.contactId), rows.map((r) => r.recordId), rows.map((r) => r.orderKey)],
    );
    inserted = r.rowCount ?? 0;
  }

  let removed = 0;
  if (dynamic && matched) {
    // quem deixou de satisfazer os filtros sai da fila de novos acionamentos, sem apagar tentativas (AC19)
    const r = await db.query(
      `UPDATE enrollments e SET state='CANCELLED', terminal_reason='LEFT_DYNAMIC_LIST', updated_at=now()
        WHERE e.campaign_id=$1 AND e.state='ACTIVE' AND NOT (e.contact_id = ANY($2::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.enrollment_id=e.id AND a.state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION'))`,
      [campaignId, [...matched]],
    );
    removed = r.rowCount ?? 0;
  }
  await db.query(`UPDATE campaigns SET materialized_at=now() WHERE id=$1`, [campaignId]);
  return { inserted, removed };
}
