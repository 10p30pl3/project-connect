/**
 * Módulo Billing Multi-Tenant & Consumo:
 * - Visão SUPER_ADMIN / SUPER_ADMIN_VIEWER (`SUPER_ADMIN_FULL`): tarifas, custos PSTN, IA STS/LLM,
 *   consumíveis (WhatsApp/SMS/Email/AMD), receita estimada, margem líquida e ledger particionado.
 * - Visão Cliente (`CLIENT_TIME_ONLY`): estritamente consumo de tempo (minutos/segundos), franquia
 *   restante, volume de ligações e tempo médio, sem preços, fórmulas, USD/BRL ou contagem de tokens.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isSuperAdminRole } from '@voll/shared';
import { actor, requireSuperAdmin } from '../auth/context.js';
import { ensureUpcomingPartitions } from '../db/partition-service.js';
import { getPool, one, q } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { sha256Hex } from '../lib/crypto.js';
import { idempotencyGuard } from '../lib/idempotency.js';
import { HttpError, parse } from '../lib/problem.js';
import { proxyJson } from './telephony.js';

type PlanRow = {
  workspace_id: string;
  plan_name: string;
  monthly_included_minutes: number;
  monthly_platform_fee_brl: number;
  voice_rate_per_min_brl: number;
  voice_rate_client_per_min_brl: number;
  ai_markup_multiplier: number;
  usd_to_brl_rate: number;
  whatsapp_unit_brl: number;
  sms_unit_brl: number;
  email_unit_brl: number;
  amd_unit_brl: number;
  billing_cycle_day: number;
};

const DEFAULT_PLAN: Omit<PlanRow, 'workspace_id'> = {
  plan_name: 'Voll Client Standard',
  monthly_included_minutes: 1000,
  monthly_platform_fee_brl: 0,
  voice_rate_per_min_brl: 0.14,
  voice_rate_client_per_min_brl: 0.25,
  ai_markup_multiplier: 1.8,
  usd_to_brl_rate: 5.8,
  whatsapp_unit_brl: 0.08,
  sms_unit_brl: 0.065,
  email_unit_brl: 0.004,
  amd_unit_brl: 0.012,
  billing_cycle_day: 1,
};

const PlanUpdateSchema = z.object({
  planName: z.string().trim().min(2).max(120).optional(),
  monthlyIncludedMinutes: z.coerce.number().int().min(0).max(5_000_000).optional(),
  monthlyPlatformFeeBrl: z.coerce.number().min(0).max(1_000_000).optional(),
  voiceRatePerMinBrl: z.coerce.number().min(0).max(100).optional(),
  voiceRateClientPerMinBrl: z.coerce.number().min(0).max(100).optional(),
  aiMarkupMultiplier: z.coerce.number().min(1).max(20).optional(),
  usdToBrlRate: z.coerce.number().min(1).max(30).optional(),
  whatsappUnitBrl: z.coerce.number().min(0).max(50).optional(),
  smsUnitBrl: z.coerce.number().min(0).max(50).optional(),
  emailUnitBrl: z.coerce.number().min(0).max(50).optional(),
  amdUnitBrl: z.coerce.number().min(0).max(50).optional(),
});

let lastSyncAt = 0;
let lastPartitionCheckAt = 0;

function parseBoundedPeriod(fromRaw?: string, toRaw?: string): { fromIso: string; toIso: string } {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

  let from = fromRaw ? new Date(fromRaw) : defaultFrom;
  let to = toRaw ? new Date(toRaw) : defaultTo;

  if (Number.isNaN(from.getTime())) from = defaultFrom;
  if (Number.isNaN(to.getTime()) || to <= from) {
    to = new Date(from.getTime() + 31 * 86400_000);
  }

  // Bounded query guard (máximo 366 dias para evitar scan ilimitado)
  const maxSpanMs = 366 * 86400_000;
  if (to.getTime() - from.getTime() > maxSpanMs) {
    from = new Date(to.getTime() - maxSpanMs);
  }
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function stableDate(raw?: string | number | null): string {
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '2026-01-01T00:00:00.000Z';
}

export async function syncBillingLedger(force = false, anchorWorkspaceId?: string) {
  const now = Date.now();
  if (!force && now - lastSyncAt < 10_000) return { synced: false, cached: true };
  lastSyncAt = now;

  if (now - lastPartitionCheckAt > 3600_000) {
    lastPartitionCheckAt = now;
    await ensureUpcomingPartitions(1, 3).catch(() => {});
  }

  const pool = getPool();
  const [wsRows, planRows, agentMapRows] = await Promise.all([
    q<{ id: string; is_master: boolean }>(pool, `SELECT id, COALESCE(is_master, false) AS is_master FROM workspaces`),
    q<PlanRow>(pool, `SELECT * FROM tenant_billing_plans`),
    q<{ resource_id: string; workspace_id: string | null }>(
      pool,
      `SELECT resource_id, workspace_id FROM workspace_voice_resources WHERE resource_type = 'agent'`,
    ).catch(() => []),
  ]);

  const masterWsId = wsRows.find((w) => w.is_master)?.id ?? wsRows[0]?.id ?? anchorWorkspaceId;
  if (!masterWsId) return { synced: false, items: 0 };

  const planByWs = new Map<string, PlanRow>();
  for (const p of planRows) planByWs.set(p.workspace_id, p);
  const wsForAgent = new Map<string, string>();
  for (const m of agentMapRows) {
    if (m.workspace_id) wsForAgent.set(m.resource_id, m.workspace_id);
  }

  const planFor = (wsId: string): PlanRow => planByWs.get(wsId) ?? { workspace_id: wsId, ...DEFAULT_PLAN };

  let syncedItems = 0;

  // 1. Sincronizar chamadas do gateway de voz (PSTN + AMD) e extrato de IA STS
  try {
    const [histRaw, stmtOpenAi, stmtEleven] = await Promise.all([
      proxyJson(masterWsId, '/v1/calls/history?limit=400').catch(() => ({ history: [] })),
      proxyJson(masterWsId, '/v1/ai-costs/statement?provider=openai&limit=400').catch(() => ({ statement: [] })),
      proxyJson(masterWsId, '/v1/ai-costs/statement?provider=elevenlabs&limit=400').catch(() => ({ statement: [] })),
    ]);

    const history = Array.isArray(histRaw?.history) ? histRaw.history : [];
    for (const h of history) {
      const callId = String(h?.callId || '').trim();
      if (!callId) continue;
      const agentId = String(h?.tenantId || 'default');
      const wsId = wsForAgent.get(agentId) ?? masterWsId;
      const plan = planFor(wsId);
      const occurredAt = stableDate(h?.startedAt || h?.endedAt);
      const durSec = Math.max(0, Math.round(Number(h?.durationSec ?? 0)));
      const minutes = durSec / 60;
      const pstnCost = minutes * Number(plan.voice_rate_per_min_brl);
      const clientCharge = minutes * Number(plan.voice_rate_client_per_min_brl);

      await pool
        .query(
          `INSERT INTO tenant_billing_ledger
             (workspace_id, occurred_at, source_ref, category, provider, direction, duration_seconds, units, unit_label,
              provider_cost_usd, provider_cost_brl, client_charge_brl, metadata)
           VALUES ($1, $2, $3, 'TELEPHONY_PSTN', 'freeswitch', $4, $5, $6, 'min', 0, $7, $8, $9::jsonb)
           ON CONFLICT (workspace_id, source_ref, occurred_at) DO UPDATE
           SET duration_seconds = GREATEST(tenant_billing_ledger.duration_seconds, EXCLUDED.duration_seconds),
               units = GREATEST(tenant_billing_ledger.units, EXCLUDED.units),
               provider_cost_brl = EXCLUDED.provider_cost_brl,
               client_charge_brl = EXCLUDED.client_charge_brl,
               metadata = EXCLUDED.metadata`,
          [
            wsId,
            occurredAt,
            `gw-call:${callId}`,
            h?.direction || null,
            durSec,
            Number(minutes.toFixed(4)),
            Number(pstnCost.toFixed(6)),
            Number(clientCharge.toFixed(6)),
            JSON.stringify({
              agentId,
              caller: h?.caller ?? null,
              called: h?.called ?? null,
              hangupReason: h?.hangupReason ?? null,
              amdResult: h?.amdResult ?? null,
            }),
          ],
        )
        .catch(() => {});
      syncedItems += 1;

      if (h?.amdResult) {
        const amdCost = Number(plan.amd_unit_brl);
        await pool
          .query(
            `INSERT INTO tenant_billing_ledger
               (workspace_id, occurred_at, source_ref, category, provider, direction, duration_seconds, units, unit_label,
                provider_cost_usd, provider_cost_brl, client_charge_brl, metadata)
             VALUES ($1, $2, $3, 'AMD_DSP', 'whisper', $4, 0, 1, 'detecção', 0, $5, $6, $7::jsonb)
             ON CONFLICT (workspace_id, source_ref, occurred_at) DO NOTHING`,
            [
              wsId,
              occurredAt,
              `gw-amd:${callId}`,
              h?.direction || null,
              Number((amdCost * 0.5).toFixed(6)),
              Number(amdCost.toFixed(6)),
              JSON.stringify({ agentId, amdResult: h.amdResult }),
            ],
          )
          .catch(() => {});
      }
    }

    const statements = [
      ...(Array.isArray(stmtOpenAi?.statement) ? stmtOpenAi.statement.map((s: any) => ({ ...s, _prov: 'openai' })) : []),
      ...(Array.isArray(stmtEleven?.statement) ? stmtEleven.statement.map((s: any) => ({ ...s, _prov: 'elevenlabs' })) : []),
    ];

    for (let idx = 0; idx < statements.length; idx += 1) {
      const s = statements[idx];
      const agentId = String(s?.tenantId || 'default');
      const wsId = wsForAgent.get(agentId) ?? masterWsId;
      const plan = planFor(wsId);
      const occurredAt = stableDate(s?.at || s?.timestamp);
      const costUsd = Math.max(0, Number(s?.costUsd ?? 0));
      const costBrl = costUsd * Number(plan.usd_to_brl_rate);
      const clientBrl = costBrl * Number(plan.ai_markup_multiplier);
      const refSeed = `${s._prov}:${s?.callId || ''}:${s?.model || ''}:${occurredAt}:${s?.inputTokens ?? 0}:${s?.outputTokens ?? 0}:${idx}`;
      const sourceRef = `gw-ai:${s?.id || sha256Hex(refSeed).slice(0, 24)}`;

      await pool
        .query(
          `INSERT INTO tenant_billing_ledger
             (workspace_id, occurred_at, source_ref, category, provider, tokens_in, tokens_out, units, unit_label,
              provider_cost_usd, provider_cost_brl, client_charge_brl, metadata)
           VALUES ($1, $2, $3, 'AI_REALTIME', $4, $5, $6, 1, 'sessão', $7, $8, $9, $10::jsonb)
           ON CONFLICT (workspace_id, source_ref, occurred_at) DO UPDATE
           SET provider_cost_usd = GREATEST(tenant_billing_ledger.provider_cost_usd, EXCLUDED.provider_cost_usd),
               provider_cost_brl = EXCLUDED.provider_cost_brl,
               client_charge_brl = EXCLUDED.client_charge_brl`,
          [
            wsId,
            occurredAt,
            sourceRef,
            s._prov,
            Math.max(0, Math.round(Number(s?.inputTokens ?? 0))),
            Math.max(0, Math.round(Number(s?.outputTokens ?? 0))),
            Number(costUsd.toFixed(6)),
            Number(costBrl.toFixed(6)),
            Number(clientBrl.toFixed(6)),
            JSON.stringify({ agentId, callId: s?.callId ?? null, model: s?.model ?? null }),
          ],
        )
        .catch(() => {});
      syncedItems += 1;
    }
  } catch {
    // Gateway offline: segue com consumíveis já presentes no PostgreSQL
  }

  // 2. Sincronizar consumíveis omnichannel recentes (attempts: WHATSAPP, SMS, EMAIL + ai_cost_usd LLM)
  const attemptRows = await q<{
    id: string;
    workspace_id: string;
    channel_type: string;
    cost_confirmed: number | null;
    tariff_snapshot: number | null;
    ai_cost_usd: number | null;
    created_at: string;
  }>(
    pool,
    `SELECT id, workspace_id, channel_type::text AS channel_type, cost_confirmed, tariff_snapshot, ai_cost_usd, created_at
       FROM attempts
      WHERE created_at >= now() - interval '60 days'
        AND state IN ('SENT', 'AWAITING_FEEDBACK', 'FINALIZED')
        AND channel_type IN ('WHATSAPP', 'SMS', 'EMAIL')
      ORDER BY created_at DESC
      LIMIT 1000`,
  ).catch(() => []);

  for (const att of attemptRows) {
    const plan = planFor(att.workspace_id);
    const defaultUnit =
      att.channel_type === 'WHATSAPP'
        ? plan.whatsapp_unit_brl
        : att.channel_type === 'SMS'
          ? plan.sms_unit_brl
          : plan.email_unit_brl;
    const clientCharge = Number(att.cost_confirmed ?? att.tariff_snapshot ?? defaultUnit);
    const provCost = clientCharge * 0.65;
    await pool
      .query(
        `INSERT INTO tenant_billing_ledger
           (workspace_id, occurred_at, source_ref, category, provider, units, unit_label,
            provider_cost_usd, provider_cost_brl, client_charge_brl, metadata)
         VALUES ($1, $2, $3, $4, 'omnichannel', 1, 'msg', 0, $5, $6, $7::jsonb)
         ON CONFLICT (workspace_id, source_ref, occurred_at) DO NOTHING`,
        [
          att.workspace_id,
          stableDate(att.created_at),
          `attempt:${att.id}`,
          att.channel_type,
          Number(provCost.toFixed(6)),
          Number(clientCharge.toFixed(6)),
          JSON.stringify({ attemptId: att.id }),
        ],
      )
      .catch(() => {});

    if (att.ai_cost_usd && Number(att.ai_cost_usd) > 0) {
      const usd = Number(att.ai_cost_usd);
      const brl = usd * Number(plan.usd_to_brl_rate);
      await pool
        .query(
          `INSERT INTO tenant_billing_ledger
             (workspace_id, occurred_at, source_ref, category, provider, units, unit_label,
              provider_cost_usd, provider_cost_brl, client_charge_brl, metadata)
           VALUES ($1, $2, $3, 'AI_LLM', 'openai', 1, 'análise', $4, $5, $6, $7::jsonb)
           ON CONFLICT (workspace_id, source_ref, occurred_at) DO NOTHING`,
          [
            att.workspace_id,
            stableDate(att.created_at),
            `attempt-llm:${att.id}`,
            Number(usd.toFixed(6)),
            Number(brl.toFixed(6)),
            Number((brl * Number(plan.ai_markup_multiplier)).toFixed(6)),
            JSON.stringify({ attemptId: att.id }),
          ],
        )
        .catch(() => {});
    }
  }

  return { synced: true, items: syncedItems };
}

export async function billingRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      scope?: string;
      workspaceId?: string;
      sync?: string;
      category?: string;
      provider?: string;
      q?: string;
    };
  }>(
    '/billing/summary',
    async (req) => {
      const a = actor(req);
      const isSuper = isSuperAdminRole(a.role);
      const { fromIso, toIso } = parseBoundedPeriod(req.query.from, req.query.to);

      await syncBillingLedger(req.query.sync === 'true' && isSuper, a.workspaceId);

      const pool = getPool();

      // ---------------- VISÃO DO CLIENTE: ESTRITAMENTE CONSUMO DE TEMPO ----------------
      if (!isSuper) {
        const ws = await one<{ id: string; name: string; plan_code: string }>(
          pool,
          `SELECT id, name, COALESCE(plan_code, 'GROWTH') AS plan_code FROM workspaces WHERE id = $1`,
          [a.workspaceId],
        );
        const plan = await one<PlanRow>(pool, `SELECT * FROM tenant_billing_plans WHERE workspace_id = $1`, [a.workspaceId]);
        const includedMinutes = Number(plan?.monthly_included_minutes ?? DEFAULT_PLAN.monthly_included_minutes);

        const timeAgg = await one<{
          total_calls: number;
          inbound_calls: number;
          outbound_calls: number;
          total_duration_sec: number;
        }>(
          pool,
          `SELECT COUNT(*)::int AS total_calls,
                  COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound_calls,
                  COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound_calls,
                  COALESCE(SUM(duration_seconds), 0)::int AS total_duration_sec
             FROM tenant_billing_ledger
            WHERE workspace_id = $1
              AND category = 'TELEPHONY_PSTN'
              AND occurred_at >= $2::timestamptz
              AND occurred_at < $3::timestamptz`,
          [a.workspaceId, fromIso, toIso],
        );

        const byAgentRows = await q<{ agent_id: string; calls_count: number; total_duration_sec: number }>(
          pool,
          `SELECT COALESCE(metadata->>'agentId', 'default') AS agent_id,
                  COUNT(*)::int AS calls_count,
                  COALESCE(SUM(duration_seconds), 0)::int AS total_duration_sec
             FROM tenant_billing_ledger
            WHERE workspace_id = $1
              AND category = 'TELEPHONY_PSTN'
              AND occurred_at >= $2::timestamptz
              AND occurred_at < $3::timestamptz
            GROUP BY 1
            ORDER BY total_duration_sec DESC`,
          [a.workspaceId, fromIso, toIso],
        );

        const recentCallsRows = await q<{
          occurred_at: string;
          source_ref: string;
          direction: string | null;
          duration_seconds: number;
          agent_id: string;
          called: string | null;
          caller: string | null;
        }>(
          pool,
          `SELECT occurred_at,
                  source_ref,
                  direction,
                  duration_seconds,
                  COALESCE(metadata->>'agentId', 'default') AS agent_id,
                  metadata->>'called' AS called,
                  metadata->>'caller' AS caller
             FROM tenant_billing_ledger
            WHERE workspace_id = $1
              AND category = 'TELEPHONY_PSTN'
              AND occurred_at >= $2::timestamptz
              AND occurred_at < $3::timestamptz
            ORDER BY occurred_at DESC
            LIMIT 100`,
          [a.workspaceId, fromIso, toIso],
        );

        const totalCalls = Number(timeAgg?.total_calls ?? 0);
        const totalDurationSec = Number(timeAgg?.total_duration_sec ?? 0);
        const totalMinutes = Number((totalDurationSec / 60).toFixed(2));
        const avgCallDurationSec = totalCalls > 0 ? Math.round(totalDurationSec / totalCalls) : 0;
        const remainingMinutes = Math.max(0, Number((includedMinutes - totalMinutes).toFixed(2)));
        const extraMinutes = Math.max(0, Number((totalMinutes - includedMinutes).toFixed(2)));
        const quotaUsagePct = includedMinutes > 0 ? Math.min(999, Number(((totalMinutes / includedMinutes) * 100).toFixed(1))) : 0;

        return {
          viewMode: 'CLIENT_TIME_ONLY',
          period: { from: fromIso, to: toIso },
          workspace: {
            id: ws?.id ?? a.workspaceId,
            name: ws?.name ?? 'Empresa',
            planCode: ws?.plan_code ?? 'GROWTH',
            planName: plan?.plan_name ?? DEFAULT_PLAN.plan_name,
            monthlyIncludedMinutes: includedMinutes,
          },
          timeSummary: {
            totalCalls,
            inboundCalls: Number(timeAgg?.inbound_calls ?? 0),
            outboundCalls: Number(timeAgg?.outbound_calls ?? 0),
            totalDurationSec,
            totalMinutes,
            avgCallDurationSec,
            includedMinutes,
            remainingMinutes,
            extraMinutes,
            quotaUsagePct,
          },
          byAgent: byAgentRows.map((r) => ({
            agentId: r.agent_id,
            callsCount: Number(r.calls_count),
            totalDurationSec: Number(r.total_duration_sec),
            avgDurationSec: r.calls_count > 0 ? Math.round(r.total_duration_sec / r.calls_count) : 0,
          })),
          recentCallsTime: recentCallsRows.map((c) => ({
            occurredAt: c.occurred_at,
            callId: c.source_ref.replace(/^gw-call:/, ''),
            agentId: c.agent_id,
            direction: c.direction ?? 'outbound',
            caller: c.caller ?? '—',
            called: c.called ?? '—',
            durationSec: Number(c.duration_seconds),
          })),
        };
      }

      // ---------------- VISÃO SUPER ADMIN: BILLING MULTI-TENANT COMPLETO ----------------
      const targetWs = req.query.workspaceId || (req.query.scope === 'workspace' ? a.workspaceId : null);

      const tenantStats = await q<{
        workspace_id: string;
        workspace_name: string;
        is_master: boolean;
        plan_code: string;
        plan_name: string;
        monthly_included_minutes: number;
        monthly_platform_fee_brl: number;
        voice_rate_per_min_brl: number;
        voice_rate_client_per_min_brl: number;
        ai_markup_multiplier: number;
        usd_to_brl_rate: number;
        whatsapp_unit_brl: number;
        sms_unit_brl: number;
        email_unit_brl: number;
        amd_unit_brl: number;
        calls_count: number;
        duration_sec: number;
        pstn_cost_brl: number;
        pstn_charge_brl: number;
        ai_cost_usd: number;
        ai_cost_brl: number;
        ai_charge_brl: number;
        ai_tokens_in: number;
        ai_tokens_out: number;
        consumables_cost_brl: number;
        consumables_charge_brl: number;
      }>(
        pool,
        `WITH agg AS (
           SELECT workspace_id,
                  COUNT(*) FILTER (WHERE category = 'TELEPHONY_PSTN')::int AS calls_count,
                  COALESCE(SUM(duration_seconds) FILTER (WHERE category = 'TELEPHONY_PSTN'), 0)::int AS duration_sec,
                  COALESCE(SUM(provider_cost_brl) FILTER (WHERE category = 'TELEPHONY_PSTN'), 0)::numeric(14,4) AS pstn_cost_brl,
                  COALESCE(SUM(client_charge_brl) FILTER (WHERE category = 'TELEPHONY_PSTN'), 0)::numeric(14,4) AS pstn_charge_brl,
                  COALESCE(SUM(provider_cost_usd) FILTER (WHERE category IN ('AI_REALTIME', 'AI_LLM')), 0)::numeric(14,6) AS ai_cost_usd,
                  COALESCE(SUM(provider_cost_brl) FILTER (WHERE category IN ('AI_REALTIME', 'AI_LLM')), 0)::numeric(14,4) AS ai_cost_brl,
                  COALESCE(SUM(client_charge_brl) FILTER (WHERE category IN ('AI_REALTIME', 'AI_LLM')), 0)::numeric(14,4) AS ai_charge_brl,
                  COALESCE(SUM(tokens_in), 0)::bigint AS ai_tokens_in,
                  COALESCE(SUM(tokens_out), 0)::bigint AS ai_tokens_out,
                  COALESCE(SUM(provider_cost_brl) FILTER (WHERE category IN ('WHATSAPP', 'SMS', 'EMAIL', 'AMD_DSP', 'STORAGE')), 0)::numeric(14,4) AS consumables_cost_brl,
                  COALESCE(SUM(client_charge_brl) FILTER (WHERE category IN ('WHATSAPP', 'SMS', 'EMAIL', 'AMD_DSP', 'STORAGE')), 0)::numeric(14,4) AS consumables_charge_brl
             FROM tenant_billing_ledger
            WHERE occurred_at >= $1::timestamptz
              AND occurred_at < $2::timestamptz
              AND ($3::uuid IS NULL OR workspace_id = $3::uuid)
            GROUP BY workspace_id
         )
         SELECT w.id AS workspace_id,
                w.name AS workspace_name,
                COALESCE(w.is_master, false) AS is_master,
                COALESCE(w.plan_code, 'GROWTH') AS plan_code,
                COALESCE(p.plan_name, 'Voll Client Standard') AS plan_name,
                COALESCE(p.monthly_included_minutes, 1000) AS monthly_included_minutes,
                COALESCE(p.monthly_platform_fee_brl, 0) AS monthly_platform_fee_brl,
                COALESCE(p.voice_rate_per_min_brl, 0.14) AS voice_rate_per_min_brl,
                COALESCE(p.voice_rate_client_per_min_brl, 0.25) AS voice_rate_client_per_min_brl,
                COALESCE(p.ai_markup_multiplier, 1.8) AS ai_markup_multiplier,
                COALESCE(p.usd_to_brl_rate, 5.8) AS usd_to_brl_rate,
                COALESCE(p.whatsapp_unit_brl, 0.08) AS whatsapp_unit_brl,
                COALESCE(p.sms_unit_brl, 0.065) AS sms_unit_brl,
                COALESCE(p.email_unit_brl, 0.004) AS email_unit_brl,
                COALESCE(p.amd_unit_brl, 0.012) AS amd_unit_brl,
                COALESCE(a.calls_count, 0) AS calls_count,
                COALESCE(a.duration_sec, 0) AS duration_sec,
                COALESCE(a.pstn_cost_brl, 0) AS pstn_cost_brl,
                COALESCE(a.pstn_charge_brl, 0) AS pstn_charge_brl,
                COALESCE(a.ai_cost_usd, 0) AS ai_cost_usd,
                COALESCE(a.ai_cost_brl, 0) AS ai_cost_brl,
                COALESCE(a.ai_charge_brl, 0) AS ai_charge_brl,
                COALESCE(a.ai_tokens_in, 0) AS ai_tokens_in,
                COALESCE(a.ai_tokens_out, 0) AS ai_tokens_out,
                COALESCE(a.consumables_cost_brl, 0) AS consumables_cost_brl,
                COALESCE(a.consumables_charge_brl, 0) AS consumables_charge_brl
           FROM workspaces w
           LEFT JOIN tenant_billing_plans p ON p.workspace_id = w.id
           LEFT JOIN agg a ON a.workspace_id = w.id
          WHERE COALESCE(w.active, true) = true
            AND ($3::uuid IS NULL OR w.id = $3::uuid)
          ORDER BY COALESCE(w.is_master, false) DESC, w.created_at ASC`,
        [fromIso, toIso, targetWs],
      );

      const categoryRows = await q<{
        category: string;
        events_count: number;
        units: number;
        unit_label: string;
        duration_sec: number;
        tokens_in: number;
        tokens_out: number;
        provider_cost_usd: number;
        provider_cost_brl: number;
        client_charge_brl: number;
      }>(
        pool,
        `SELECT category,
                COUNT(*)::int AS events_count,
                COALESCE(SUM(units), 0)::numeric(14,2) AS units,
                MAX(unit_label) AS unit_label,
                COALESCE(SUM(duration_seconds), 0)::int AS duration_sec,
                COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
                COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
                COALESCE(SUM(provider_cost_usd), 0)::numeric(14,6) AS provider_cost_usd,
                COALESCE(SUM(provider_cost_brl), 0)::numeric(14,4) AS provider_cost_brl,
                COALESCE(SUM(client_charge_brl), 0)::numeric(14,4) AS client_charge_brl
           FROM tenant_billing_ledger
          WHERE occurred_at >= $1::timestamptz
            AND occurred_at < $2::timestamptz
            AND ($3::uuid IS NULL OR workspace_id = $3::uuid)
          GROUP BY category
          ORDER BY provider_cost_brl DESC, events_count DESC`,
        [fromIso, toIso, targetWs],
      );

      const filterCategory = req.query.category && req.query.category !== 'ALL' ? String(req.query.category).trim() : null;
      const filterProvider = req.query.provider && req.query.provider !== 'ALL' ? String(req.query.provider).trim() : null;
      const filterSearch = req.query.q && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;

      const ledgerRows = await q<{
        id: string;
        workspace_id: string;
        workspace_name: string;
        occurred_at: string;
        source_ref: string;
        category: string;
        provider: string;
        direction: string | null;
        duration_seconds: number;
        units: number;
        unit_label: string;
        tokens_in: number;
        tokens_out: number;
        provider_cost_usd: number;
        provider_cost_brl: number;
        client_charge_brl: number;
      }>(
        pool,
        `SELECT l.id::text, l.workspace_id, w.name AS workspace_name, l.occurred_at, l.source_ref, l.category, l.provider,
                l.direction, l.duration_seconds, l.units, l.unit_label, l.tokens_in, l.tokens_out,
                l.provider_cost_usd, l.provider_cost_brl, l.client_charge_brl
           FROM tenant_billing_ledger l
           JOIN workspaces w ON w.id = l.workspace_id
          WHERE l.occurred_at >= $1::timestamptz
            AND l.occurred_at < $2::timestamptz
            AND ($3::uuid IS NULL OR l.workspace_id = $3::uuid)
            AND ($4::text IS NULL OR l.category = $4)
            AND ($5::text IS NULL OR l.provider = $5)
            AND ($6::text IS NULL OR l.source_ref ILIKE $6 OR w.name ILIKE $6)
          ORDER BY l.occurred_at DESC
          LIMIT 250`,
        [fromIso, toIso, targetWs, filterCategory, filterProvider, filterSearch],
      );

      const byTenant = tenantStats.map((t) => {
        const totalMinutes = Number((Number(t.duration_sec) / 60).toFixed(2));
        const pstnCost = Number(t.pstn_cost_brl);
        const aiCostBrl = Number(t.ai_cost_brl);
        const consumablesCost = Number(t.consumables_cost_brl);
        const totalProviderCostBrl = Number((pstnCost + aiCostBrl + consumablesCost).toFixed(4));
        const platformFee = Number(t.monthly_platform_fee_brl);
        const estimatedClientRevenueBrl = Number(
          (platformFee + Number(t.pstn_charge_brl) + Number(t.ai_charge_brl) + Number(t.consumables_charge_brl)).toFixed(4),
        );
        const netMarginBrl = Number((estimatedClientRevenueBrl - totalProviderCostBrl).toFixed(4));
        const included = Number(t.monthly_included_minutes);
        return {
          workspaceId: t.workspace_id,
          workspaceName: t.workspace_name,
          isMaster: Boolean(t.is_master),
          planCode: t.plan_code,
          planName: t.plan_name,
          callsCount: Number(t.calls_count),
          durationSec: Number(t.duration_sec),
          totalMinutes,
          monthlyIncludedMinutes: included,
          includedRemainingMinutes: Math.max(0, Number((included - totalMinutes).toFixed(2))),
          quotaUsagePct: included > 0 ? Math.min(999, Number(((totalMinutes / included) * 100).toFixed(1))) : 0,
          monthlyPlatformFeeBrl: platformFee,
          pstnCostBrl: pstnCost,
          aiCostUsd: Number(t.ai_cost_usd),
          aiCostBrl,
          aiTokensIn: Number(t.ai_tokens_in),
          aiTokensOut: Number(t.ai_tokens_out),
          consumablesCostBrl: consumablesCost,
          totalProviderCostBrl,
          estimatedClientRevenueBrl,
          netMarginBrl,
          plan: {
            planName: t.plan_name,
            monthlyIncludedMinutes: included,
            monthlyPlatformFeeBrl: platformFee,
            voiceRatePerMinBrl: Number(t.voice_rate_per_min_brl),
            voiceRateClientPerMinBrl: Number(t.voice_rate_client_per_min_brl),
            aiMarkupMultiplier: Number(t.ai_markup_multiplier),
            usdToBrlRate: Number(t.usd_to_brl_rate),
            whatsappUnitBrl: Number(t.whatsapp_unit_brl),
            smsUnitBrl: Number(t.sms_unit_brl),
            emailUnitBrl: Number(t.email_unit_brl),
            amdUnitBrl: Number(t.amd_unit_brl),
          },
        };
      });

      const totals = byTenant.reduce(
        (acc, t) => {
          acc.totalCalls += t.callsCount;
          acc.totalDurationSec += t.durationSec;
          acc.pstnCostBrl += t.pstnCostBrl;
          acc.aiCostUsd += t.aiCostUsd;
          acc.aiCostBrl += t.aiCostBrl;
          acc.aiTokensIn += t.aiTokensIn;
          acc.aiTokensOut += t.aiTokensOut;
          acc.consumablesCostBrl += t.consumablesCostBrl;
          acc.platformFeeBrl += t.monthlyPlatformFeeBrl;
          acc.estimatedClientRevenueBrl += t.estimatedClientRevenueBrl;
          acc.totalProviderCostBrl += t.totalProviderCostBrl;
          return acc;
        },
        {
          totalCalls: 0,
          totalDurationSec: 0,
          pstnCostBrl: 0,
          aiCostUsd: 0,
          aiCostBrl: 0,
          aiTokensIn: 0,
          aiTokensOut: 0,
          consumablesCostBrl: 0,
          platformFeeBrl: 0,
          estimatedClientRevenueBrl: 0,
          totalProviderCostBrl: 0,
        },
      );

      const netMarginBrl = totals.estimatedClientRevenueBrl - totals.totalProviderCostBrl;
      const marginPct =
        totals.estimatedClientRevenueBrl > 0 ? Number(((netMarginBrl / totals.estimatedClientRevenueBrl) * 100).toFixed(1)) : 0;

      return {
        viewMode: 'SUPER_ADMIN_FULL',
        period: { from: fromIso, to: toIso },
        totals: {
          ...totals,
          totalMinutes: Number((totals.totalDurationSec / 60).toFixed(2)),
          pstnCostBrl: Number(totals.pstnCostBrl.toFixed(4)),
          aiCostUsd: Number(totals.aiCostUsd.toFixed(6)),
          aiCostBrl: Number(totals.aiCostBrl.toFixed(4)),
          consumablesCostBrl: Number(totals.consumablesCostBrl.toFixed(4)),
          totalProviderCostBrl: Number(totals.totalProviderCostBrl.toFixed(4)),
          platformFeeBrl: Number(totals.platformFeeBrl.toFixed(2)),
          estimatedClientRevenueBrl: Number(totals.estimatedClientRevenueBrl.toFixed(2)),
          netMarginBrl: Number(netMarginBrl.toFixed(2)),
          marginPct,
        },
        byCategory: categoryRows.map((c) => ({
          category: c.category,
          eventsCount: Number(c.events_count),
          units: Number(c.units),
          unitLabel: c.unit_label,
          durationSec: Number(c.duration_sec),
          tokensIn: Number(c.tokens_in),
          tokensOut: Number(c.tokens_out),
          providerCostUsd: Number(c.provider_cost_usd),
          providerCostBrl: Number(c.provider_cost_brl),
          clientChargeBrl: Number(c.client_charge_brl),
        })),
        byTenant,
        ledger: ledgerRows.map((l) => ({
          id: l.id,
          workspaceId: l.workspace_id,
          workspaceName: l.workspace_name,
          occurredAt: l.occurred_at,
          sourceRef: l.source_ref,
          category: l.category,
          provider: l.provider,
          direction: l.direction,
          durationSec: Number(l.duration_seconds),
          units: Number(l.units),
          unitLabel: l.unit_label,
          tokensIn: Number(l.tokens_in),
          tokensOut: Number(l.tokens_out),
          providerCostUsd: Number(l.provider_cost_usd),
          providerCostBrl: Number(l.provider_cost_brl),
          clientChargeBrl: Number(l.client_charge_brl),
        })),
      };
    },
  );

  app.post('/billing/sync', { preHandler: requireSuperAdmin }, async (req) => {
    const a = actor(req);
    const r = await syncBillingLedger(true, a.workspaceId);
    await audit(getPool(), a, 'billing.sync', 'tenant_billing_ledger', 'all', { after: r });
    return { ok: true, ...r };
  });

  app.put<{ Params: { workspaceId: string } }>(
    '/billing/plans/:workspaceId',
    { preHandler: [requireSuperAdmin, idempotencyGuard('billing.update_plan')] },
    async (req) => {
      const a = actor(req);
      const { workspaceId } = req.params;
      const ws = await one<{ id: string }>(getPool(), `SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
      if (!ws) throw new HttpError(404, 'Empresa não encontrada');

      const body = parse(PlanUpdateSchema, req.body);
      const current =
        (await one<PlanRow>(getPool(), `SELECT * FROM tenant_billing_plans WHERE workspace_id = $1`, [workspaceId])) ?? {
          workspace_id: workspaceId,
          ...DEFAULT_PLAN,
        };

      const next = {
        plan_name: body.planName ?? current.plan_name,
        monthly_included_minutes: body.monthlyIncludedMinutes ?? current.monthly_included_minutes,
        monthly_platform_fee_brl: body.monthlyPlatformFeeBrl ?? current.monthly_platform_fee_brl,
        voice_rate_per_min_brl: body.voiceRatePerMinBrl ?? current.voice_rate_per_min_brl,
        voice_rate_client_per_min_brl: body.voiceRateClientPerMinBrl ?? current.voice_rate_client_per_min_brl,
        ai_markup_multiplier: body.aiMarkupMultiplier ?? current.ai_markup_multiplier,
        usd_to_brl_rate: body.usdToBrlRate ?? current.usd_to_brl_rate,
        whatsapp_unit_brl: body.whatsappUnitBrl ?? current.whatsapp_unit_brl,
        sms_unit_brl: body.smsUnitBrl ?? current.sms_unit_brl,
        email_unit_brl: body.emailUnitBrl ?? current.email_unit_brl,
        amd_unit_brl: body.amdUnitBrl ?? current.amd_unit_brl,
      };

      await getPool().query(
        `INSERT INTO tenant_billing_plans
           (workspace_id, plan_name, monthly_included_minutes, monthly_platform_fee_brl, voice_rate_per_min_brl,
            voice_rate_client_per_min_brl, ai_markup_multiplier, usd_to_brl_rate, whatsapp_unit_brl, sms_unit_brl,
            email_unit_brl, amd_unit_brl, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
         ON CONFLICT (workspace_id) DO UPDATE
         SET plan_name = EXCLUDED.plan_name,
             monthly_included_minutes = EXCLUDED.monthly_included_minutes,
             monthly_platform_fee_brl = EXCLUDED.monthly_platform_fee_brl,
             voice_rate_per_min_brl = EXCLUDED.voice_rate_per_min_brl,
             voice_rate_client_per_min_brl = EXCLUDED.voice_rate_client_per_min_brl,
             ai_markup_multiplier = EXCLUDED.ai_markup_multiplier,
             usd_to_brl_rate = EXCLUDED.usd_to_brl_rate,
             whatsapp_unit_brl = EXCLUDED.whatsapp_unit_brl,
             sms_unit_brl = EXCLUDED.sms_unit_brl,
             email_unit_brl = EXCLUDED.email_unit_brl,
             amd_unit_brl = EXCLUDED.amd_unit_brl,
             updated_at = now()`,
        [
          workspaceId,
          next.plan_name,
          next.monthly_included_minutes,
          next.monthly_platform_fee_brl,
          next.voice_rate_per_min_brl,
          next.voice_rate_client_per_min_brl,
          next.ai_markup_multiplier,
          next.usd_to_brl_rate,
          next.whatsapp_unit_brl,
          next.sms_unit_brl,
          next.email_unit_brl,
          next.amd_unit_brl,
        ],
      );

      await audit(getPool(), a, 'billing.plan_update', 'tenant_billing_plan', workspaceId, {
        before: current,
        after: next,
      });

      return { ok: true, workspaceId, plan: next };
    },
  );
}
