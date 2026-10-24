/**
 * Elegibilidade explicável (§4.2). `evaluateEnrollment` é PURA e é a única regra usada tanto
 * pela reserva (engine/reserve.ts) quanto pela tela de elegibilidade (GET /campaigns/:id/eligibility).
 */
import type { ChannelType, JourneyStep, ReasonCode, StrategyConfig } from '@voll/shared';
import type { Db } from '../db/pool.js';
import { q } from '../db/pool.js';
import { inCalendar, startOfOperationalDay } from './calendar.js';

export type DestinationInfo = {
  id: string;
  channelType: ChannelType;
  address: string;
  priority: number;
  valid: boolean;
  blocked: boolean; // bloqueio ativo do destino
};

export type EvalContext = {
  now: Date;
  campaign: { id: string; status: string };
  workspace: { globalSuspension: boolean; dailyLimit: number | null; totalLimit: number | null };
  enrollment: { id: string; state: string; stage: number; destinationCursor: number; nextEligibleAt: Date };
  steps: JourneyStep[];
  strategy: StrategyConfig;
  contact: { id: string; externalId: string | null; historyTotal: number | null };
  contactBlocked: boolean;
  /** destinos do contato, todos os canais */
  destinations: DestinationInfo[];
  connectionsActive: Record<string, boolean>;
  activeAttempt: { state: string; campaignId: string } | null;
  counters: {
    workspaceTotal: number; // consumos não liberados, workspace inteiro
    workspaceToday: number;
    campaignTotal: number;
    campaignToday: number;
    perDestination: Record<string, number>; // nesta campanha
  };
};

export type EvalResult = {
  eligible: boolean;
  primaryReason: ReasonCode | null;
  reasons: ReasonCode[];
  destination: DestinationInfo | null;
  step: JourneyStep | null;
  counters: { total: number | null; today: number; totalLimit: number; dailyLimit: number };
};

/** Destinos do canal da etapa em ordem de seleção (prioridade, depois inserção). */
export function orderedStepDestinations(ctx: Pick<EvalContext, 'destinations'>, channel: ChannelType) {
  return ctx.destinations.filter((d) => d.channelType === channel);
}

/** Escolhe o destino da etapa a partir do cursor (§6.2). */
export function pickDestination(
  ctx: Pick<EvalContext, 'destinations' | 'counters' | 'strategy'>,
  channel: ChannelType,
  cursor: number,
): { destination: DestinationInfo | null; reason: ReasonCode | null } {
  const list = orderedStepDestinations(ctx, channel).slice(cursor);
  if (list.length === 0) return { destination: null, reason: 'NO_DESTINATION' };
  const usable = list.filter((d) => d.valid && !d.blocked);
  if (usable.length === 0) {
    return { destination: null, reason: list.some((d) => d.blocked) ? 'DESTINATION_BLOCKED' : 'NO_DESTINATION' };
  }
  const max = ctx.strategy.retry.maxPerDestination;
  const avail = usable.find((d) => (ctx.counters.perDestination[d.id] ?? 0) < max);
  if (!avail) return { destination: null, reason: 'CHANNEL_EXHAUSTED' };
  return { destination: avail, reason: null };
}

export function evaluateEnrollment(ctx: EvalContext): EvalResult {
  const reasons: ReasonCode[] = [];
  const s = ctx.strategy;
  const scopeCampaign = s.limits.scope === 'CAMPAIGN';
  const known = scopeCampaign ? ctx.counters.campaignTotal : ctx.counters.workspaceTotal;
  const today = scopeCampaign ? ctx.counters.campaignToday : ctx.counters.workspaceToday;
  const historyUnknown = ctx.contact.historyTotal === null;
  const total = scopeCampaign ? known : historyUnknown ? (s.limits.incompleteHistory === 'BLOCK' ? null : known) : known + (ctx.contact.historyTotal ?? 0);

  // 1-2. DNC, suspensão, registro, inscrição
  if (ctx.contactBlocked) reasons.push('DNC');
  if (ctx.workspace.globalSuspension) reasons.push('GLOBAL_SUSPENSION');
  if (!ctx.contact.externalId) reasons.push('INVALID_RECORD');
  if (ctx.enrollment.state !== 'ACTIVE') reasons.push('FLOW_ENDED');

  // destino da etapa
  const step = ctx.steps[ctx.enrollment.stage] ?? null;
  let destination: DestinationInfo | null = null;
  if (!step) {
    if (!reasons.includes('FLOW_ENDED')) reasons.push('FLOW_ENDED');
  } else {
    const pick = pickDestination(ctx, step.channelType, ctx.enrollment.destinationCursor);
    destination = pick.destination;
    if (pick.reason) reasons.push(pick.reason);
  }

  // 3. tentativa ativa no workspace
  if (ctx.activeAttempt) reasons.push(ctx.activeAttempt.state === 'RECONCILIATION' ? 'RECONCILIATION' : 'ACTIVE_RESERVATION');

  // 4. retentativa e limites
  if (ctx.enrollment.nextEligibleAt.getTime() > ctx.now.getTime()) reasons.push('AWAITING_RETRY');
  if (total === null) reasons.push('INCOMPLETE_HISTORY');
  else if (total >= s.limits.total) reasons.push('TOTAL_LIMIT');
  if (today >= s.limits.daily) reasons.push('DAILY_LIMIT');
  // limites institucionais (sempre no workspace, somando histórico conhecido) — nunca ampliados pelo template
  const wsTotal = ctx.counters.workspaceTotal + (ctx.contact.historyTotal ?? 0);
  if (ctx.workspace.totalLimit != null && wsTotal >= ctx.workspace.totalLimit && !reasons.includes('TOTAL_LIMIT'))
    reasons.push('TOTAL_LIMIT');
  if (ctx.workspace.dailyLimit != null && ctx.counters.workspaceToday >= ctx.workspace.dailyLimit && !reasons.includes('DAILY_LIMIT'))
    reasons.push('DAILY_LIMIT');

  // 5. calendário, pausa, canal
  if (!inCalendar(s.calendar, ctx.now)) reasons.push('OUTSIDE_CALENDAR');
  if (ctx.campaign.status === 'PAUSED') reasons.push('CAMPAIGN_PAUSED');
  else if (ctx.campaign.status !== 'RUNNING' && !reasons.includes('FLOW_ENDED')) reasons.push('FLOW_ENDED');
  if (step && ctx.connectionsActive[step.connectionId] === false) reasons.push('CHANNEL_UNAVAILABLE');

  const effectiveTotalLimit = Math.min(s.limits.total, ctx.workspace.totalLimit ?? Infinity);
  const effectiveDailyLimit = Math.min(s.limits.daily, ctx.workspace.dailyLimit ?? Infinity);
  return {
    eligible: reasons.length === 0,
    primaryReason: reasons[0] ?? null,
    reasons,
    destination,
    step,
    counters: { total, today, totalLimit: effectiveTotalLimit, dailyLimit: effectiveDailyLimit },
  };
}

// ---------------------------------------------------------------------------------------------
// Carregamento em lote (um instante lógico por chamada)

export type CampaignRuntime = {
  id: string;
  workspaceId: string;
  status: string;
  mailingId: string;
  listVersionId: string | null;
  journeyVersionId: string;
  strategyVersionId: string;
  steps: JourneyStep[];
  strategy: StrategyConfig;
  strategyVersion: number;
  membershipMode: 'SNAPSHOT' | 'DYNAMIC' | null;
  timezone: string;
};

export async function loadCampaignRuntime(db: Db, campaignId: string): Promise<CampaignRuntime | null> {
  const rows = await q(
    db,
    `SELECT c.id, c.workspace_id, c.status, c.mailing_id, c.list_version_id, c.journey_version_id, c.strategy_version_id,
            jv.steps, sv.config, sv.version AS strategy_version, lv.membership_mode, w.timezone
       FROM campaigns c
       JOIN journey_versions jv ON jv.id = c.journey_version_id
       JOIN strategy_versions sv ON sv.id = c.strategy_version_id
       JOIN workspaces w ON w.id = c.workspace_id
       LEFT JOIN list_versions lv ON lv.id = c.list_version_id
      WHERE c.id = $1`,
    [campaignId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    status: r.status,
    mailingId: r.mailing_id,
    listVersionId: r.list_version_id,
    journeyVersionId: r.journey_version_id,
    strategyVersionId: r.strategy_version_id,
    steps: r.steps,
    strategy: r.config,
    strategyVersion: r.strategy_version,
    membershipMode: r.membership_mode,
    timezone: r.timezone,
  };
}

export type EnrollmentRow = {
  id: string;
  contact_id: string;
  state: string;
  stage: number;
  destination_cursor: number;
  next_eligible_at: Date;
  order_key: number;
};

/** Monta os contextos de avaliação para um conjunto de inscrições da mesma campanha. */
export async function buildContexts(
  db: Db,
  campaign: CampaignRuntime,
  enrollments: EnrollmentRow[],
  now: Date,
): Promise<Map<string, EvalContext & { contactName: string | null }>> {
  const out = new Map<string, EvalContext & { contactName: string | null }>();
  if (enrollments.length === 0) return out;
  const contactIds = [...new Set(enrollments.map((e) => e.contact_id))];
  const tz = campaign.strategy.calendar.timezone || campaign.timezone;
  const dayStart = startOfOperationalDay(now, tz);

  const [ws] = await q(
    db,
    `SELECT global_suspension, institutional_daily_limit, institutional_total_limit FROM workspaces WHERE id=$1`,
    [campaign.workspaceId],
  );
  const contacts = await q(db, `SELECT id, external_id, name, history_total FROM contacts WHERE id = ANY($1)`, [contactIds]);
  const blocks = await q(
    db,
    `SELECT contact_id, scope, destination_id FROM blocks WHERE workspace_id=$1 AND contact_id = ANY($2) AND revoked_at IS NULL`,
    [campaign.workspaceId, contactIds],
  );
  const dests = await q(
    db,
    `SELECT id, contact_id, channel_type, address, priority, valid FROM contact_destinations
      WHERE contact_id = ANY($1) ORDER BY priority, created_at, address`,
    [contactIds],
  );
  const active = await q(
    db,
    `SELECT contact_id, state, campaign_id FROM attempts
      WHERE workspace_id=$1 AND contact_id = ANY($2) AND state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')`,
    [campaign.workspaceId, contactIds],
  );
  const cons = await q(
    db,
    `SELECT contact_id,
            count(*)::int AS ws_total,
            count(*) FILTER (WHERE effective_at >= $3)::int AS ws_today,
            count(*) FILTER (WHERE campaign_id = $4)::int AS c_total,
            count(*) FILTER (WHERE campaign_id = $4 AND effective_at >= $3)::int AS c_today
       FROM counter_consumptions
      WHERE workspace_id=$1 AND contact_id = ANY($2) AND kind <> 'RELEASED'
      GROUP BY contact_id`,
    [campaign.workspaceId, contactIds, dayStart, campaign.id],
  );
  const perDest = await q(
    db,
    `SELECT destination_id, count(*)::int AS n FROM counter_consumptions
      WHERE campaign_id=$1 AND contact_id = ANY($2) AND kind <> 'RELEASED' GROUP BY destination_id`,
    [campaign.id, contactIds],
  );
  const connIds = [...new Set(campaign.steps.map((s) => s.connectionId))];
  const conns = await q(db, `SELECT id, active FROM connections WHERE id = ANY($1)`, [connIds]);

  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const blockedContacts = new Set(blocks.filter((b) => b.scope === 'CONTACT').map((b) => b.contact_id));
  const blockedDests = new Set(blocks.filter((b) => b.scope === 'DESTINATION').map((b) => b.destination_id));
  const destsBy = new Map<string, DestinationInfo[]>();
  for (const d of dests) {
    const list = destsBy.get(d.contact_id) ?? [];
    list.push({ id: d.id, channelType: d.channel_type, address: d.address, priority: d.priority, valid: d.valid, blocked: blockedDests.has(d.id) });
    destsBy.set(d.contact_id, list);
  }
  const activeBy = new Map(active.map((a) => [a.contact_id, a]));
  const consBy = new Map(cons.map((c) => [c.contact_id, c]));
  const perDestMap: Record<string, number> = Object.fromEntries(perDest.map((p) => [p.destination_id, p.n]));
  const connectionsActive: Record<string, boolean> = Object.fromEntries(conns.map((c) => [c.id, c.active]));

  for (const e of enrollments) {
    const c = contactMap.get(e.contact_id);
    const a = activeBy.get(e.contact_id);
    const k = consBy.get(e.contact_id);
    out.set(e.id, {
      now,
      contactName: c?.name ?? null,
      campaign: { id: campaign.id, status: campaign.status },
      workspace: {
        globalSuspension: ws.global_suspension,
        dailyLimit: ws.institutional_daily_limit,
        totalLimit: ws.institutional_total_limit,
      },
      enrollment: {
        id: e.id,
        state: e.state,
        stage: e.stage,
        destinationCursor: e.destination_cursor,
        nextEligibleAt: new Date(e.next_eligible_at),
      },
      steps: campaign.steps,
      strategy: campaign.strategy,
      contact: { id: e.contact_id, externalId: c?.external_id ?? null, historyTotal: c?.history_total ?? null },
      contactBlocked: blockedContacts.has(e.contact_id),
      destinations: destsBy.get(e.contact_id) ?? [],
      connectionsActive,
      activeAttempt: a ? { state: a.state, campaignId: a.campaign_id } : null,
      counters: {
        workspaceTotal: k?.ws_total ?? 0,
        workspaceToday: k?.ws_today ?? 0,
        campaignTotal: k?.c_total ?? 0,
        campaignToday: k?.c_today ?? 0,
        perDestination: perDestMap,
      },
    });
  }
  return out;
}
