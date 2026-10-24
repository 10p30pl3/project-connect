/** Indicadores (§8.2). Denominador zero → null; cobertura de custo incompleta → custos unitários null. */
import type { Db } from '../db/pool.js';
import { q } from '../db/pool.js';

export async function campaignIndicators(db: Db, campaignId: string) {
  const [base] = await q(
    db,
    `SELECT
       count(*) FILTER (WHERE a.sent_at IS NOT NULL)::int AS sent,
       count(DISTINCT a.contact_id) FILTER (WHERE a.sent_at IS NOT NULL)::int AS worked,
       count(DISTINCT a.contact_id) FILTER (WHERE t.is_cpc)::int AS cpc,
       count(DISTINCT a.contact_id) FILTER (WHERE t.is_conversion)::int AS conversions,
       COALESCE(sum(COALESCE(a.cost_confirmed, a.tariff_snapshot)) FILTER (WHERE a.sent_at IS NOT NULL), 0)::float AS known_cost,
       count(*) FILTER (WHERE a.sent_at IS NOT NULL AND COALESCE(a.cost_confirmed, a.tariff_snapshot) IS NOT NULL)::int AS with_cost,
       count(*) FILTER (WHERE a.state='RESERVED')::int AS reserved,
       count(*) FILTER (WHERE a.state='SENT')::int AS p_sent,
       count(*) FILTER (WHERE a.state='AWAITING_FEEDBACK')::int AS awaiting,
       count(*) FILTER (WHERE a.state='RECONCILIATION')::int AS reconciliation
     FROM attempts a LEFT JOIN tabulations t ON t.workspace_id=a.workspace_id AND t.code=a.tabulation_code
    WHERE a.campaign_id=$1`,
    [campaignId],
  );
  const byChannel = await q(
    db,
    `SELECT a.channel_type AS "channelType",
            count(*) FILTER (WHERE a.sent_at IS NOT NULL)::int AS sent,
            count(DISTINCT a.contact_id) FILTER (WHERE t.is_cpc)::int AS cpc,
            count(DISTINCT a.contact_id) FILTER (WHERE t.is_conversion)::int AS conversions
       FROM attempts a LEFT JOIN tabulations t ON t.workspace_id=a.workspace_id AND t.code=a.tabulation_code
      WHERE a.campaign_id=$1 GROUP BY a.channel_type ORDER BY a.channel_type`,
    [campaignId],
  );
  const byTabulation = await q(
    db,
    `SELECT a.tabulation_code AS code, COALESCE(t.name, a.tabulation_code) AS name, count(*)::int AS count
       FROM attempts a LEFT JOIN tabulations t ON t.workspace_id=a.workspace_id AND t.code=a.tabulation_code
      WHERE a.campaign_id=$1 AND a.tabulation_code IS NOT NULL GROUP BY 1,2 ORDER BY count DESC`,
    [campaignId],
  );
  const partial = base.with_cost < base.sent;
  const known = Math.round(base.known_cost * 10000) / 10000;
  return {
    sent: base.sent,
    contactsWorked: base.worked,
    cpcContacts: base.cpc,
    cpcRate: base.worked > 0 ? base.cpc / base.worked : null,
    conversions: base.conversions,
    cost: { known, coverage: { withCost: base.with_cost, total: base.sent }, partial },
    costPerCpc: !partial && base.cpc > 0 ? known / base.cpc : null,
    costPerConversion: !partial && base.conversions > 0 ? known / base.conversions : null,
    pending: { reserved: base.reserved, sent: base.p_sent, awaitingFeedback: base.awaiting, reconciliation: base.reconciliation },
    byChannel,
    byTabulation,
  };
}
