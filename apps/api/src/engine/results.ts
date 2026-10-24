/** Retornos dos conectores e aplicação da estratégia (§4.2 passo 8, §6.2, §10.2, §18.2). */
import type { ConnectorEvent, StrategyConfig, TabulationAction } from '@voll/shared';
import { one, q, tx, type Client } from '../db/pool.js';
import { cancelUnsent, logEvent, transition } from './events.js';
import { advanceStage } from './reserve.js';
import { orderedStepDestinations } from './eligibility.js';

type Tab = { code: string; name: string; is_cpc: boolean; is_conversion: boolean; is_opt_out: boolean; invalidates_destination: boolean };

export type ProcessOutcome = { accepted: true; duplicate: boolean; status: 'PROCESSED' | 'ORPHAN' | 'ERROR' | 'DUPLICATE' };

/** Webhook normalizado. Registra antes de aplicar efeitos; idempotente por (conexão, eventId). */
export async function processConnectorEvent(
  connection: { id: string; workspace_id: string },
  ev: ConnectorEvent,
  raw: unknown,
): Promise<ProcessOutcome> {
  return tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO connector_inbox (workspace_id, connection_id, external_event_id, event_type, payload)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (connection_id, external_event_id) DO NOTHING RETURNING id`,
      [connection.workspace_id, connection.id, ev.eventId, ev.type, JSON.stringify(raw)],
    );
    const attempt = await one(
      c,
      `SELECT * FROM attempts WHERE connection_id=$1 AND provider_attempt_id=$2 FOR UPDATE`,
      [connection.id, ev.providerAttemptId],
    );
    if (!ins.rowCount) {
      await c.query(
        `UPDATE connector_inbox SET duplicate_count = duplicate_count + 1 WHERE connection_id=$1 AND external_event_id=$2`,
        [connection.id, ev.eventId],
      );
      await logEvent(c, {
        workspaceId: connection.workspace_id,
        attemptId: attempt?.id ?? null,
        campaignId: attempt?.campaign_id ?? null,
        contactId: attempt?.contact_id ?? null,
        type: 'DUPLICATE_IGNORED',
        externalEventId: ev.eventId,
        duplicate: true,
        occurredAt: ev.occurredAt,
        data: { eventType: ev.type, tabulationCode: ev.tabulationCode ?? null },
      });
      return { accepted: true, duplicate: true, status: 'DUPLICATE' };
    }
    const inboxId = ins.rows[0].id;
    if (!attempt) {
      // evento sem tentativa conhecida: retido para investigação, sem criar nada (§11)
      await c.query(`UPDATE connector_inbox SET status='ORPHAN', processed_at=now() WHERE id=$1`, [inboxId]);
      return { accepted: true, duplicate: false, status: 'ORPHAN' };
    }
    await c.query(`UPDATE connector_inbox SET attempt_id=$2 WHERE id=$1`, [inboxId, attempt.id]);
    const status = await applyEvent(c, attempt, ev);
    await c.query(`UPDATE connector_inbox SET status=$2, processed_at=now(), error=$3 WHERE id=$1`, [
      inboxId, status === 'ERROR' ? 'ERROR' : 'PROCESSED', status === 'ERROR' ? 'tabulação desconhecida' : null,
    ]);
    return { accepted: true, duplicate: false, status: status === 'ERROR' ? 'ERROR' : 'PROCESSED' };
  });
}

async function applyEvent(c: Client, a: any, ev: ConnectorEvent): Promise<'OK' | 'ERROR'> {
  const meta = { externalEventId: ev.eventId, occurredAt: ev.occurredAt };
  const open = ['SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION'].includes(a.state);
  if (ev.cost !== undefined && open) {
    await c.query(`UPDATE attempts SET cost_confirmed=$2 WHERE id=$1`, [a.id, ev.cost]);
  }

  if (ev.type === 'OPT_OUT') {
    if (open) {
      await transition(c, a, 'FINALIZED', 'OPT_OUT', {
        ...meta, reason: 'OPT_OUT', extraSql: `finalized_at=now(), tabulation_code=$4`, extraParams: ['OPT_OUT'],
      });
    } else {
      await logEvent(c, { workspaceId: a.workspace_id, attemptId: a.id, campaignId: a.campaign_id, contactId: a.contact_id, type: 'LATE_OPT_OUT', ...meta });
    }
    // opt-out prevalece mesmo após resultado tardio (§10.2)
    await applyOptOut(c, a.workspace_id, a.contact_id, 'OPT_OUT', 'Cliente solicitou não ser contatado (retorno do canal)', null);
    return 'OK';
  }

  if (ev.type === 'DELIVERY_CONFIRMED') {
    if (a.state === 'SENT') {
      await transition(c, a, 'AWAITING_FEEDBACK', 'DELIVERY_CONFIRMED', meta);
    } else {
      await logEvent(c, { workspaceId: a.workspace_id, attemptId: a.id, campaignId: a.campaign_id, contactId: a.contact_id, type: 'LATE_DELIVERY', ...meta });
    }
    return 'OK';
  }

  if (ev.type === 'RESULT_UNKNOWN') {
    if (a.state === 'SENT' || a.state === 'AWAITING_FEEDBACK') {
      await transition(c, a, 'RECONCILIATION', 'RESULT_UNKNOWN', { ...meta, reason: 'RESULT_UNKNOWN' });
    } else {
      await logEvent(c, { workspaceId: a.workspace_id, attemptId: a.id, campaignId: a.campaign_id, contactId: a.contact_id, type: 'RESULT_UNKNOWN', ...meta, reason: 'IGNORED_STATE' });
    }
    return 'OK';
  }

  // RESULT
  const tab = await one<Tab>(c, `SELECT * FROM tabulations WHERE workspace_id=$1 AND code=$2`, [a.workspace_id, ev.tabulationCode ?? '']);
  if (!tab) {
    if (open && a.state !== 'RECONCILIATION') {
      await transition(c, a, 'RECONCILIATION', 'RESULT', { ...meta, reason: 'UNKNOWN_TABULATION', data: { tabulationCode: ev.tabulationCode ?? null } });
    }
    return 'ERROR';
  }
  if (!open) {
    // não reabre fluxo finalizado/cancelado (OB04)
    await logEvent(c, {
      workspaceId: a.workspace_id, attemptId: a.id, campaignId: a.campaign_id, contactId: a.contact_id,
      type: 'LATE_RESULT', ...meta, data: { tabulationCode: tab.code },
    });
    if (tab.is_opt_out) await applyOptOut(c, a.workspace_id, a.contact_id, 'OPT_OUT', `Tabulação ${tab.name}`, null);
    return 'OK';
  }
  await finalizeWithTabulation(c, a, tab, meta);
  return 'OK';
}

export async function finalizeWithTabulation(c: Client, a: any, tab: Tab, meta: { externalEventId?: string | null; occurredAt?: string | null; reason?: string }) {
  const wasReconciliation = a.state === 'RECONCILIATION';
  await transition(c, a, 'FINALIZED', wasReconciliation ? 'RECONCILED' : 'RESULT', {
    externalEventId: meta.externalEventId,
    occurredAt: meta.occurredAt,
    reason: meta.reason ?? null,
    extraSql: `finalized_at=now(), tabulation_code=$4`,
    extraParams: [tab.code],
    data: { tabulationCode: tab.code, tabulation: tab.name, cpc: tab.is_cpc, conversion: tab.is_conversion },
  });
  if (tab.invalidates_destination) {
    await c.query(`UPDATE contact_destinations SET valid=false WHERE id=$1`, [a.destination_id]);
  }
  if (tab.is_opt_out) {
    await applyOptOut(c, a.workspace_id, a.contact_id, 'OPT_OUT', `Tabulação ${tab.name}`, null);
    return;
  }
  await applyStrategyRule(c, a, tab);
}

export function defaultAction(tab: Tab): TabulationAction {
  if (tab.is_conversion) return 'FINISH_SUCCESS';
  if (tab.invalidates_destination) return 'NEXT_DESTINATION';
  return 'RETRY';
}

/** Aplica a regra da versão de estratégia DA TENTATIVA (AC25). */
export async function applyStrategyRule(c: Client, a: any, tab: Tab | null, forcedAction?: TabulationAction) {
  const e = await one(c, `SELECT * FROM enrollments WHERE id=$1 FOR UPDATE`, [a.enrollment_id]);
  if (!e || e.state !== 'ACTIVE' || e.stage !== a.stage) return;
  const sv = await one<{ config: StrategyConfig; version: number }>(c, `SELECT config, version FROM strategy_versions WHERE id=$1`, [a.strategy_version_id]);
  const jv = await one<{ steps: any[] }>(c, `SELECT steps FROM journey_versions WHERE id=$1`, [a.journey_version_id]);
  const cfg = sv!.config;
  const steps = jv!.steps;
  const action: TabulationAction = forcedAction ?? (tab ? cfg.tabulationRules[tab.code] ?? defaultAction(tab) : 'RETRY');
  const now = new Date();
  const log = (type: string, data: Record<string, unknown>) =>
    logEvent(c, { workspaceId: a.workspace_id, attemptId: a.id, campaignId: a.campaign_id, contactId: a.contact_id, type, data: { action, strategyVersion: sv!.version, ...data } });

  if (action === 'FINISH_SUCCESS' || action === 'FINISH_FAIL') {
    const state = action === 'FINISH_SUCCESS' ? 'DONE_SUCCESS' : 'DONE_FAIL';
    await c.query(`UPDATE enrollments SET state=$2, terminal_reason=$3, updated_at=now() WHERE id=$1`, [e.id, state, tab?.code ?? action]);
    await log('RULE_APPLIED', { enrollmentState: state });
    return;
  }
  if (action === 'NEXT_STEP') {
    await log('RULE_APPLIED', {});
    await advanceStage(c, { ...e, campaign_id: a.campaign_id }, steps.length, a.workspace_id, 'NEXT_STEP');
    return;
  }

  // RETRY / NEXT_DESTINATION: calcula destino seguinte e se a etapa se esgotou
  const step = steps[e.stage];
  const dests = await q(
    c,
    `SELECT d.id, d.channel_type AS "channelType", d.address, d.priority, d.valid,
            EXISTS (SELECT 1 FROM blocks b WHERE b.destination_id=d.id AND b.revoked_at IS NULL) AS blocked
       FROM contact_destinations d WHERE d.contact_id=$1 ORDER BY d.priority, d.created_at, d.address`,
    [a.contact_id],
  );
  const ordered = orderedStepDestinations({ destinations: dests as any }, step.channelType);
  const counts = Object.fromEntries(
    (
      await q(
        c,
        `SELECT destination_id, count(*)::int AS n FROM counter_consumptions WHERE campaign_id=$1 AND contact_id=$2 AND kind <> 'RELEASED' GROUP BY destination_id`,
        [a.campaign_id, a.contact_id],
      )
    ).map((r) => [r.destination_id, r.n]),
  );
  let cursor = e.destination_cursor;
  const idx = ordered.findIndex((d) => d.id === a.destination_id);
  if (action === 'NEXT_DESTINATION' && idx >= 0) cursor = idx + 1;
  const max = cfg.retry.maxPerDestination;
  const usable = ordered.slice(cursor).some((d) => d.valid && !d.blocked && (counts[d.id] ?? 0) < max);
  const nextAt = action === 'RETRY' ? new Date(now.getTime() + cfg.retry.intervalMinutes * 60_000) : now;
  if (!usable) {
    await log('RULE_APPLIED', { stepExhausted: true });
    await advanceStage(c, { ...e, campaign_id: a.campaign_id }, steps.length, a.workspace_id, 'CHANNEL_EXHAUSTED', nextAt);
    return;
  }
  await c.query(`UPDATE enrollments SET destination_cursor=$2, next_eligible_at=$3, updated_at=now() WHERE id=$1`, [e.id, cursor, nextAt]);
  await log('RULE_APPLIED', { nextEligibleAt: nextAt.toISOString(), destinationCursor: cursor });
}

/** DNC: bloqueia o cliente, cancela reservas não enviadas e encerra inscrições ativas (AC03, AC15, CT01). */
export async function applyOptOut(c: Client, workspaceId: string, contactId: string, origin: string, reason: string, userId: string | null) {
  const existing = await one(
    c,
    `SELECT id FROM blocks WHERE workspace_id=$1 AND contact_id=$2 AND scope='CONTACT' AND revoked_at IS NULL`,
    [workspaceId, contactId],
  );
  if (!existing) {
    await c.query(
      `INSERT INTO blocks (workspace_id, scope, contact_id, reason, origin, created_by) VALUES ($1,'CONTACT',$2,$3,$4,$5)`,
      [workspaceId, contactId, reason, origin, userId],
    );
  }
  await cancelUnsent(c, `workspace_id=$1 AND contact_id=$2`, [workspaceId, contactId], 'DNC');
  if (origin === 'OPT_OUT') {
    await c.query(
      `UPDATE enrollments SET state='CANCELLED', terminal_reason='OPT_OUT', updated_at=now()
        WHERE contact_id=$1 AND state='ACTIVE'`,
      [contactId],
    );
  }
}
