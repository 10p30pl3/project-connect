import type { FastifyInstance } from 'fastify';
import { isSuperAdminRole } from '@voll/shared';
import { getPool, one, q } from '../db/pool.js';
import { actor } from '../auth/context.js';
import { startOfOperationalDay } from '../engine/calendar.js';

const CHANNEL_META: Array<{ channel: string; label: string }> = [
  { channel: 'VOICE', label: 'Discador Telefônico (Voz)' },
  { channel: 'WHATSAPP', label: 'WhatsApp Oficial (Meta Cloud)' },
  { channel: 'SMS', label: 'SMS / RCS' },
  { channel: 'EMAIL', label: 'E-mail Transacional' },
];

const HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

const WEEKDAY_DEFS = [
  { dow: 1, day: 'Segunda-feira', short: 'Seg' },
  { dow: 2, day: 'Terça-feira', short: 'Ter' },
  { dow: 3, day: 'Quarta-feira', short: 'Qua' },
  { dow: 4, day: 'Quinta-feira', short: 'Qui' },
  { dow: 5, day: 'Sexta-feira', short: 'Sex' },
  { dow: 6, day: 'Sábado', short: 'Sáb' },
];

function pct(num: number, den: number, dec = 1): number {
  if (!den || den <= 0) return 0;
  return Number(((num / den) * 100).toFixed(dec));
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/summary', async (req) => {
    const a = actor(req);
    const query = req.query as { campaignId?: string; channel?: string; period?: string };
    const pool = getPool();

    const campaignId = query.campaignId && /^[0-9a-f-]{36}$/i.test(query.campaignId) ? query.campaignId : null;
    const channelType =
      query.channel && ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'].includes(query.channel) ? query.channel : null;
    const period = query.period || '30d';

    const ws = await one<{ timezone?: string }>(pool, `SELECT timezone FROM workspaces WHERE id=$1`, [a.workspaceId]);
    const tz = ws?.timezone || 'America/Sao_Paulo';
    const sinceDate =
      period === 'today'
        ? startOfOperationalDay(new Date(), tz)
        : period === '7d'
          ? new Date(Date.now() - 7 * 86_400_000)
          : new Date(Date.now() - 30 * 86_400_000);

    const penRow = await one<{
      total_contacts: number;
      active_blocks: number;
      total_enrolled: number;
      worked_enrolled: number;
      untouched_active: number;
      in_retry: number;
      completed_success: number;
      exhausted_max: number;
    }>(
      pool,
      `SELECT
         (SELECT count(*)::int FROM contacts WHERE workspace_id = $1) AS total_contacts,
         (SELECT count(*)::int FROM blocks WHERE workspace_id = $1 AND revoked_at IS NULL) AS active_blocks,
         count(*)::int AS total_enrolled,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM attempts a WHERE a.enrollment_id = e.id AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
         ))::int AS worked_enrolled,
         count(*) FILTER (WHERE e.state = 'ACTIVE' AND NOT EXISTS (
           SELECT 1 FROM attempts a WHERE a.enrollment_id = e.id AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
         ))::int AS untouched_active,
         count(*) FILTER (WHERE e.state = 'ACTIVE' AND EXISTS (
           SELECT 1 FROM attempts a WHERE a.enrollment_id = e.id AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
         ))::int AS in_retry,
         count(*) FILTER (WHERE e.state = 'DONE_SUCCESS')::int AS completed_success,
         count(*) FILTER (WHERE e.state IN ('DONE_FAIL', 'CANCELLED'))::int AS exhausted_max
       FROM enrollments e
       JOIN campaigns c ON c.id = e.campaign_id
      WHERE c.workspace_id = $1
        AND ($2::uuid IS NULL OR e.campaign_id = $2::uuid)`,
      [a.workspaceId, campaignId, channelType],
    );

    const isSuper = isSuperAdminRole(a.role);

    const byChannelRows = await q<{
      channel_type: string;
      attempts: number;
      connects: number;
      humans: number;
      amds: number;
      busies: number;
      cpcs: number;
      conversions: number;
      opt_outs: number;
    }>(
      pool,
      `SELECT
         a.channel_type::text AS channel_type,
         count(*)::int AS attempts,
         count(*) FILTER (
           WHERE COALESCE(t.is_cpc, false)
              OR a.tabulation_code IN ('VOICEMAIL','BUSY','NO_ANSWER','WRONG_PERSON','OPT_OUT','CALLBACK_SCHEDULED','REPLIED','CPC_NO_DEAL','CONVERSION')
              OR (a.sent_at IS NOT NULL AND a.state IN ('SENT','AWAITING_FEEDBACK','FINALIZED') AND COALESCE(a.tabulation_code,'') <> 'INVALID_NUMBER')
         )::int AS connects,
         count(*) FILTER (
           WHERE COALESCE(t.is_cpc, false)
              OR a.tabulation_code IN ('WRONG_PERSON','OPT_OUT','CALLBACK_SCHEDULED','REPLIED','CPC_NO_DEAL','CONVERSION')
         )::int AS humans,
         count(*) FILTER (WHERE a.tabulation_code = 'VOICEMAIL')::int AS amds,
         count(*) FILTER (WHERE a.tabulation_code = 'BUSY')::int AS busies,
         count(*) FILTER (WHERE COALESCE(t.is_cpc, false))::int AS cpcs,
         count(*) FILTER (WHERE COALESCE(t.is_conversion, false))::int AS conversions,
         count(*) FILTER (WHERE COALESCE(t.is_opt_out, false))::int AS opt_outs
       FROM attempts a
       LEFT JOIN tabulations t ON t.workspace_id = a.workspace_id AND t.code = a.tabulation_code
      WHERE a.workspace_id = $1
        AND ($2::uuid IS NULL OR a.campaign_id = $2::uuid)
        AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
        AND COALESCE(a.sent_at, a.created_at) >= $4
      GROUP BY a.channel_type`,
      [a.workspaceId, campaignId, channelType, sinceDate],
    );

    const attemptStats = byChannelRows.reduce(
      (acc, r) => ({
        total_attempts: acc.total_attempts + Number(r.attempts ?? 0),
        connect_count: acc.connect_count + Number(r.connects ?? 0),
        human_answer_count: acc.human_answer_count + Number(r.humans ?? 0),
        amd_count: acc.amd_count + Number(r.amds ?? 0),
        busy_count: acc.busy_count + Number(r.busies ?? 0),
        rpc_count: acc.rpc_count + Number(r.cpcs ?? 0),
        conversion_count: acc.conversion_count + Number(r.conversions ?? 0),
        opt_out_count: acc.opt_out_count + Number(r.opt_outs ?? 0),
      }),
      {
        total_attempts: 0,
        connect_count: 0,
        human_answer_count: 0,
        amd_count: 0,
        busy_count: 0,
        rpc_count: 0,
        conversion_count: 0,
        opt_out_count: 0,
      },
    );

    const retryRows = await q<{
      step: number;
      attempts: number;
      cpc: number;
      conversions: number;
      total_cost: number;
    }>(
      pool,
      `WITH numbered AS (
         SELECT
           ROW_NUMBER() OVER (PARTITION BY a.enrollment_id ORDER BY a.created_at ASC, a.id ASC) AS step,
           COALESCE(a.cost_confirmed, a.tariff_snapshot, c.tariff, 0)::float AS cost_brl,
           COALESCE(t.is_cpc, false) AS is_cpc,
           COALESCE(t.is_conversion, false) AS is_conversion
         FROM attempts a
         LEFT JOIN connections c ON c.id = a.connection_id
         LEFT JOIN tabulations t ON t.workspace_id = a.workspace_id AND t.code = a.tabulation_code
        WHERE a.workspace_id = $1
          AND ($2::uuid IS NULL OR a.campaign_id = $2::uuid)
          AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
          AND COALESCE(a.sent_at, a.created_at) >= $4
       )
       SELECT
         step::int,
         count(*)::int AS attempts,
         count(*) FILTER (WHERE is_cpc)::int AS cpc,
         count(*) FILTER (WHERE is_conversion)::int AS conversions,
         COALESCE(sum(cost_brl), 0)::float AS total_cost
       FROM numbered
       WHERE step <= 10
       GROUP BY step
       ORDER BY step ASC`,
      [a.workspaceId, campaignId, channelType, sinceDate],
    );

    const hourRows = await q<{ dow: number; hr: number; total: number; cpc: number }>(
      pool,
      `SELECT
         EXTRACT(ISODOW FROM timezone($5, COALESCE(a.sent_at, a.created_at)))::int AS dow,
         EXTRACT(HOUR FROM timezone($5, COALESCE(a.sent_at, a.created_at)))::int AS hr,
         count(*)::int AS total,
         count(*) FILTER (WHERE COALESCE(t.is_cpc, false))::int AS cpc
       FROM attempts a
       LEFT JOIN tabulations t ON t.workspace_id = a.workspace_id AND t.code = a.tabulation_code
      WHERE a.workspace_id = $1
        AND ($2::uuid IS NULL OR a.campaign_id = $2::uuid)
        AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
        AND COALESCE(a.sent_at, a.created_at) >= $4
      GROUP BY 1, 2`,
      [a.workspaceId, campaignId, channelType, sinceDate, tz],
    );

    const tabRows = await q<{
      code: string;
      name: string;
      is_cpc: boolean;
      is_conversion: boolean;
      is_opt_out: boolean;
      invalidates_destination: boolean;
      count: number;
    }>(
      pool,
      `SELECT t.code, t.name, t.is_cpc, t.is_conversion, t.is_opt_out, t.invalidates_destination,
              coalesce(count(a.id), 0)::int AS count
         FROM tabulations t
         LEFT JOIN attempts a
           ON a.tabulation_code = t.code
          AND a.workspace_id = t.workspace_id
          AND ($2::uuid IS NULL OR a.campaign_id = $2::uuid)
          AND ($3::channel_type IS NULL OR a.channel_type = $3::channel_type)
          AND COALESCE(a.sent_at, a.created_at) >= $4
        WHERE t.workspace_id = $1
        GROUP BY t.id, t.code, t.name, t.is_cpc, t.is_conversion, t.is_opt_out, t.invalidates_destination
        ORDER BY count DESC, t.name ASC`,
      [a.workspaceId, campaignId, channelType, sinceDate],
    );

    // 1. Penetração e Esgotamento (dados reais de enrollments / contacts)
    const totalEnrolled = Number(penRow?.total_enrolled ?? 0);
    const totalContacts = Number(penRow?.total_contacts ?? 0);
    const activeBlocks = Number(penRow?.active_blocks ?? 0);
    const optOutAttempts = Number(attemptStats?.opt_out_count ?? 0);

    const totalRecords = totalEnrolled > 0 ? totalEnrolled : !campaignId ? totalContacts : 0;
    const workedRecords = totalEnrolled > 0 ? Number(penRow?.worked_enrolled ?? 0) : 0;
    const inRetryRecords = totalEnrolled > 0 ? Number(penRow?.in_retry ?? 0) : 0;
    const completedSuccess = totalEnrolled > 0 ? Number(penRow?.completed_success ?? 0) : 0;
    const exhaustedMaxAttempts = totalEnrolled > 0 ? Number(penRow?.exhausted_max ?? 0) : 0;
    const dncExcluded = campaignId ? optOutAttempts : Math.max(optOutAttempts, activeBlocks);
    const availableRecords =
      totalEnrolled > 0
        ? Number(penRow?.untouched_active ?? 0)
        : Math.max(0, totalRecords - dncExcluded);

    const penetration = {
      totalRecords,
      workedRecords,
      availableRecords,
      inRetryRecords,
      completedSuccess,
      exhaustedMaxAttempts,
      dncExcluded,
      penetrationRate: pct(workedRecords, totalRecords),
      exhaustionRate: pct(completedSuccess + exhaustedMaxAttempts, totalRecords),
      churnRate: pct(dncExcluded, totalRecords, 2),
    };

    // 2. Eficiência de Discagem & Funil de Contato
    const totalAttempts = Number(attemptStats?.total_attempts ?? 0);
    const connectCount = Number(attemptStats?.connect_count ?? 0);
    const humanAnswerCount = Number(attemptStats?.human_answer_count ?? 0);
    const amdCount = Number(attemptStats?.amd_count ?? 0);
    const busyCount = Number(attemptStats?.busy_count ?? 0);
    const rpcCount = Number(attemptStats?.rpc_count ?? 0);
    const conversionCount = Number(attemptStats?.conversion_count ?? 0);

    const byChanMap = new Map(byChannelRows.map((r) => [r.channel_type, r]));
    const byChannel = CHANNEL_META.map((m) => {
      const r = byChanMap.get(m.channel);
      const att = Number(r?.attempts ?? 0);
      return {
        channel: m.channel,
        label: m.label,
        attempts: att,
        connectRate: pct(Number(r?.connects ?? 0), att),
        humanAnswerRate: pct(Number(r?.humans ?? 0), att),
        amdRate: m.channel === 'VOICE' ? pct(Number(r?.amds ?? 0), att) : 0,
        cpcRate: pct(Number(r?.cpcs ?? 0), att),
        conversionRate: pct(Number(r?.conversions ?? 0), att),
        avgDurationSec: 0,
      };
    });

    const connectFunnel = {
      totalAttempts,
      connectCount,
      connectRate: pct(connectCount, totalAttempts),
      humanAnswerCount,
      humanAnswerRate: pct(humanAnswerCount, totalAttempts),
      amdCount,
      amdRate: pct(amdCount, totalAttempts),
      busyCount,
      busyRate: pct(busyCount, totalAttempts),
      rpcCount,
      rpcRate: pct(rpcCount, totalAttempts),
      rpcOverHumanRate: pct(rpcCount, humanAnswerCount),
      conversionCount,
      conversionOverTotalRate: pct(conversionCount, totalAttempts),
      conversionOverRpcRate: pct(conversionCount, rpcCount),
      byChannel,
    };

    // 3. Eficácia de Retentativas & Ponto de Rendimento Incremental
    const totalConvInRetry = retryRows.reduce((acc, r) => acc + Number(r.conversions ?? 0), 0);
    let cumConv = 0;
    const retrySteps = retryRows.map((r) => {
      const att = Number(r.attempts ?? 0);
      const cpc = Number(r.cpc ?? 0);
      const conv = Number(r.conversions ?? 0);
      const cost = Number(r.total_cost ?? 0);
      cumConv += conv;
      return {
        step: Number(r.step),
        attempts: att,
        cpc,
        cpcRate: pct(cpc, att),
        conversions: conv,
        convRate: pct(conv, att, 2),
        costPerCpc: isSuper && cpc > 0 ? Number((cost / cpc).toFixed(2)) : null,
        cumulativeConvPct: pct(cumConv, totalConvInRetry),
      };
    });

    const productiveSteps = retrySteps.filter((s) => s.convRate >= 3);
    const optimalCutoffStep =
      productiveSteps.length > 0
        ? productiveSteps[productiveSteps.length - 1].step
        : retrySteps.length > 0
          ? retrySteps[retrySteps.length - 1].step
          : 0;

    const retryEffectiveness = {
      steps: retrySteps,
      optimalCutoffStep,
      analysis:
        retrySteps.length === 0
          ? 'Nenhuma tentativa registrada no período selecionado para calcular a curva de rendimento incremental.'
          : totalConvInRetry === 0
            ? `${fmtSimple(totalAttempts)} tentativa(s) registrada(s) até o momento, ainda sem conversões fechadas neste filtro.`
            : `Ponto de corte observado até a ${optimalCutoffStep}ª tentativa (${totalConvInRetry} conversão(ões) acumulada(s) nos dados reais do workspace).`,
    };

    // 4. Mapa de Calor & Melhor Horário
    const hourMap = new Map<string, { total: number; cpc: number }>();
    for (const r of hourRows) {
      hourMap.set(`${r.dow}:${r.hr}`, { total: Number(r.total), cpc: Number(r.cpc) });
    }
    const weekdays = WEEKDAY_DEFS.map((w) => {
      const cpcHourly = HOURS.map((_, idx) => {
        const hr = 8 + idx;
        const cell = hourMap.get(`${w.dow}:${hr}`);
        return cell && cell.total > 0 ? Math.round((cell.cpc / cell.total) * 100) : 0;
      });
      return { day: w.day, short: w.short, cpcHourly };
    });

    let bestWeekday: { label: string; rate: number } | null = null;
    let bestSaturday: { label: string; rate: number } | null = null;
    let worstSlot: { label: string; rate: number } | null = null;

    for (const r of hourRows) {
      if (r.hr < 8 || r.hr > 19 || r.total <= 0) continue;
      const rate = Math.round((r.cpc / r.total) * 100);
      const hrStr = `${String(r.hr).padStart(2, '0')}:00`;
      const dayName = WEEKDAY_DEFS.find((d) => d.dow === r.dow)?.short ?? '';
      if (r.dow >= 1 && r.dow <= 5) {
        if (!bestWeekday || rate > bestWeekday.rate) bestWeekday = { label: `${hrStr} (${dayName} · ${rate}%)`, rate };
      } else if (r.dow === 6) {
        if (!bestSaturday || rate > bestSaturday.rate) bestSaturday = { label: `${hrStr} (${rate}%)`, rate };
      }
      if (!worstSlot || rate < worstSlot.rate) worstSlot = { label: `${hrStr} (${dayName || 'Fim de sem.'} · ${rate}%)`, rate };
    }

    const bestTime = {
      hours: HOURS,
      weekdays,
      peakWindowWeekdays: bestWeekday?.label ?? 'Aguardando acionamentos',
      peakWindowSaturday: bestSaturday?.label ?? 'Sem dados aos sábados',
      worstWindow: worstSlot?.label ?? 'Aguardando acionamentos',
    };

    // 5. Sintético de Tabulações & Desfechos
    const mappedTabs = tabRows.map((t) => {
      let category = 'UNPRODUCTIVE';
      if (t.is_conversion) category = 'POSITIVE';
      else if (t.is_opt_out) category = 'OPT_OUT';
      else if (t.invalidates_destination) category = 'INVALID_DATA';
      else if (t.is_cpc) category = 'NEUTRAL';
      const count = Number(t.count ?? 0);
      return {
        code: t.code,
        name: t.name,
        category,
        count,
        pct: pct(count, totalAttempts),
        isConversion: Boolean(t.is_conversion),
        isCpc: Boolean(t.is_cpc),
      };
    });

    return {
      viewMode: isSuper ? 'SUPER_ADMIN_FULL' : 'CLIENT_TIME_ONLY',
      filters: {
        campaignId,
        channel: channelType,
        period,
      },
      reports: {
        penetration,
        connectFunnel,
        retryEffectiveness,
        bestTime,
        dispositions: {
          items: mappedTabs,
          total: totalAttempts,
          positivePct: Number(
            mappedTabs
              .filter((t) => t.category === 'POSITIVE')
              .reduce((acc, t) => acc + t.pct, 0)
              .toFixed(1),
          ),
          cpcPct: pct(rpcCount, totalAttempts),
          invalidDataPct: Number(
            mappedTabs
              .filter((t) => t.category === 'INVALID_DATA')
              .reduce((acc, t) => acc + t.pct, 0)
              .toFixed(1),
          ),
          optOutPct: Number(
            mappedTabs
              .filter((t) => t.category === 'OPT_OUT')
              .reduce((acc, t) => acc + t.pct, 0)
              .toFixed(1),
          ),
        },
      },
    };
  });
}

function fmtSimple(n: number): string {
  return n.toLocaleString('pt-BR');
}
