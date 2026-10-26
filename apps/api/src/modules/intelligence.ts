import type { FastifyInstance } from 'fastify';
import {
  OverrideContactPlanSchema,
  PromoteLabToProductionSchema,
  StartIntelligenceRunSchema,
  UpdateHypothesisSchema,
} from '@voll/shared';
import { getPool, likePattern, one, q, tx } from '../db/pool.js';
import { actor, CAN, requireRoles } from '../auth/context.js';
import { notFound, parse } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import {
  BRAZIL_DDD_CATALOG,
  GLOBAL_DIALERS_BENCHMARK,
  STUDY_ROADMAP_PHASES,
  TIC_DOMICILIOS_2025_BY_AGE,
} from '../intelligence/brazil-reference.js';
import {
  ensureWorkspaceHypotheses,
  executeNextLabWave,
  promoteLabToProduction,
  runIntelligencePipeline,
  type Contact8Blocks,
} from '../intelligence/cpc-plan-engine.js';

export async function intelligenceRoutes(app: FastifyInstance) {
  app.get('/intelligence/study', async (req) => {
    const a = actor(req);
    await tx(async (c) => {
      await ensureWorkspaceHypotheses(c, a.workspaceId);
    });
    const hypotheses = await q(
      getPool(),
      `SELECT id, code, family, title, description, public_evidence, candidate_variables,
              internal_test, allowed_decision, benchmark_tool, enabled,
              production_weight::float AS production_weight, lab_weight::float AS lab_weight, updated_at
         FROM cpc_study_hypotheses
        WHERE workspace_id = $1
        ORDER BY family ASC, code ASC`,
      [a.workspaceId],
    );
    return {
      cpcDefinition:
        'Contato com a Pessoa Certa (CPC), confirmado exclusivamente por registro de tabulação auditável. A finalidade informada no prompt inicial altera hipóteses, canais e janelas, sem jamais alterar o significado de CPC.',
      ticDomicilios2025ByAge: TIC_DOMICILIOS_2025_BY_AGE,
      dddCatalogSample: Object.values(BRAZIL_DDD_CATALOG),
      globalDialersBenchmark: GLOBAL_DIALERS_BENCHMARK,
      studyRoadmapPhases: STUDY_ROADMAP_PHASES,
      hypotheses: hypotheses.map((h) => ({
        id: h.id,
        code: h.code,
        family: h.family,
        title: h.title,
        description: h.description,
        publicEvidence: h.public_evidence,
        candidateVariables: h.candidate_variables,
        internalTest: h.internal_test,
        allowedDecision: h.allowed_decision,
        benchmarkTool: h.benchmark_tool,
        enabled: h.enabled,
        productionWeight: Number(h.production_weight),
        labWeight: Number(h.lab_weight),
        updatedAt: h.updated_at,
      })),
    };
  });

  app.patch<{ Params: { code: string } }>(
    '/intelligence/hypotheses/:code',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      const body = parse(UpdateHypothesisSchema, req.body);
      return tx(async (c) => {
        await ensureWorkspaceHypotheses(c, a.workspaceId);
        const existing = await one(
          c,
          `SELECT * FROM cpc_study_hypotheses WHERE workspace_id=$1 AND code=$2`,
          [a.workspaceId, req.params.code],
        );
        if (!existing) throw notFound('Hipótese de estudo');
        const enabled = body.enabled ?? existing.enabled;
        const prodW = body.productionWeight ?? Number(existing.production_weight);
        const labW = body.labWeight ?? Number(existing.lab_weight);
        await c.query(
          `UPDATE cpc_study_hypotheses
              SET enabled=$1, production_weight=$2, lab_weight=$3, updated_at=now()
            WHERE id=$4`,
          [enabled, prodW, labW, existing.id],
        );
        await audit(c, a, 'intelligence.hypothesis.update', 'cpc_hypothesis', existing.id, {
          reason: body.reason ?? 'Calibração de hipótese da esteira de CPC',
          before: { enabled: existing.enabled, productionWeight: existing.production_weight, labWeight: existing.lab_weight },
          after: { enabled, productionWeight: prodW, labWeight: labW },
        });
        return { ok: true, code: existing.code, enabled, productionWeight: prodW, labWeight: labW };
      });
    },
  );

  app.get<{ Querystring: { mailingId?: string } }>('/intelligence/runs', async (req) => {
    const a = actor(req);
    const mailingId = req.query.mailingId ?? null;
    const rows = await q(
      getPool(),
      `SELECT r.*, m.name AS mailing_name
         FROM mailing_intelligence_runs r
         JOIN mailings m ON m.id = r.mailing_id
        WHERE r.workspace_id = $1
          AND ($2::uuid IS NULL OR r.mailing_id = $2)
        ORDER BY r.created_at DESC
        LIMIT 30`,
      [a.workspaceId, mailingId],
    );
    return {
      items: rows.map(formatRunRow),
    };
  });

  app.get<{ Params: { id: string } }>('/intelligence/runs/:id', async (req) => {
    const a = actor(req);
    const run = await one(
      getPool(),
      `SELECT r.*, m.name AS mailing_name
         FROM mailing_intelligence_runs r
         JOIN mailings m ON m.id = r.mailing_id
        WHERE r.id = $1 AND r.workspace_id = $2`,
      [req.params.id, a.workspaceId],
    );
    if (!run) throw notFound('Execução da esteira de inteligência');
    const waves = await q(
      getPool(),
      `SELECT * FROM lab_experiment_waves WHERE run_id = $1 ORDER BY wave_number ASC`,
      [run.id],
    );
    return {
      ...formatRunRow(run),
      waves: waves.map((w) => ({
        id: w.id,
        waveNumber: w.wave_number,
        dayLabel: w.day_label,
        status: w.status,
        sampleSize: w.sample_size,
        dispatchedCount: w.dispatched_count,
        confirmedCpcCount: w.confirmed_cpc_count,
        observedCpcRate: Number(w.observed_cpc_rate),
        observedCostPerCpcBrl: Number(w.observed_cost_per_cpc_brl),
        productionBaselineCpcBrl: Number(w.production_baseline_cpc_brl),
        expectedGainPct: Number(w.expected_gain_pct),
        hypothesesTested: w.hypotheses_tested ?? [],
        adjustmentsApplied: w.adjustments_applied ?? [],
        executedAt: w.executed_at,
      })),
    };
  });

  app.post('/intelligence/runs', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const a = actor(req);
    const body = parse(StartIntelligenceRunSchema, req.body);
    const mailing = await one(getPool(), `SELECT id, name FROM mailings WHERE id=$1 AND workspace_id=$2`, [
      body.mailingId,
      a.workspaceId,
    ]);
    if (!mailing) throw notFound('Mailing');

    const runId = await tx(async (c) => {
      const id = await runIntelligencePipeline(c, a.workspaceId, a.userId, body, {
        preSimulateLabWaves: body.mode !== 'PRODUCTION' ? 1 : 0,
      });
      await audit(c, a, 'intelligence.run.start', 'mailing_intelligence_run', id, {
        reason: body.purposePrompt,
        after: { mailingId: body.mailingId, mode: body.mode, purposeCode: body.purposeCode },
      });
      return id;
    });

    const full = await one(
      getPool(),
      `SELECT r.*, m.name AS mailing_name FROM mailing_intelligence_runs r JOIN mailings m ON m.id=r.mailing_id WHERE r.id=$1`,
      [runId],
    );
    return reply.code(201).send(formatRunRow(full));
  });

  app.post<{ Params: { id: string } }>(
    '/intelligence/runs/:id/lab/next-wave',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      return tx(async (c) => {
        const res = await executeNextLabWave(c, a.workspaceId, req.params.id);
        await audit(c, a, 'intelligence.lab.next_wave', 'mailing_intelligence_run', req.params.id, {
          after: res,
        });
        return res;
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/intelligence/runs/:id/lab/promote',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      const body = parse(PromoteLabToProductionSchema, req.body ?? {});
      return tx(async (c) => {
        const res = await promoteLabToProduction(c, a.workspaceId, a.userId, req.params.id, body.reason);
        await audit(c, a, 'intelligence.lab.promote_to_production', 'mailing_intelligence_run', req.params.id, {
          reason: body.reason,
          after: res,
        });
        return res;
      });
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { track?: string; status?: string; channel?: string; q?: string; limit?: string };
  }>('/intelligence/runs/:id/plans', async (req) => {
    const a = actor(req);
    const run = await one(getPool(), `SELECT id FROM mailing_intelligence_runs WHERE id=$1 AND workspace_id=$2`, [
      req.params.id,
      a.workspaceId,
    ]);
    if (!run) throw notFound('Execução da esteira');
    const track = req.query.track && req.query.track !== 'ALL' ? req.query.track : null;
    const status = req.query.status && req.query.status !== 'ALL' ? req.query.status : null;
    const channel = req.query.channel && req.query.channel !== 'ALL' ? req.query.channel : null;
    const search = likePattern(req.query.q);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));

    const rows = await q(
      getPool(),
      `SELECT p.*, c.external_id, c.name AS contact_name
         FROM contact_cpc_plans p
         JOIN contacts c ON c.id = p.contact_id
        WHERE p.run_id = $1
          AND ($2::text IS NULL OR p.operating_track = $2)
          AND ($3::text IS NULL OR p.decision_status = $3)
          AND ($4::text IS NULL OR p.primary_channel = $4)
          AND ($5::text IS NULL OR c.name ILIKE $5 OR c.external_id ILIKE $5 OR p.ddd ILIKE $5)
        ORDER BY p.priority_rank ASC, p.created_at ASC
        LIMIT $6`,
      [run.id, track, status, channel, search, limit],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        contactId: r.contact_id,
        externalId: r.external_id,
        contactName: r.contact_name,
        operatingTrack: r.operating_track,
        labWaveNumber: r.lab_wave_number,
        priorityRank: r.priority_rank,
        priorityScore: r.priority_score,
        decisionStatus: r.decision_status,
        decisionReason: r.decision_reason,
        estimatedCpcProb: Number(r.estimated_cpc_prob),
        expectedCostToCpcBrl: Number(r.expected_cost_to_cpc_brl),
        expectedCostPerCpcBrl: Number(r.expected_cost_per_cpc_brl),
        bruteForceCpcBrl: Number(r.brute_force_cpc_brl),
        primaryChannel: r.primary_channel,
        preferredDestination: r.preferred_destination,
        localTimeWindow: r.local_time_window,
        timezoneIana: r.timezone_iana,
        ageBracket: r.age_bracket,
        ddd: r.ddd,
        uf: r.uf,
        macroRegion: r.macro_region,
        cityTier: r.city_tier,
        phoneIntentTier: r.phone_intent_tier,
        locatorScore: r.locator_score,
        dispatchedToActuator: r.dispatched_to_actuator,
        humanReviewed: r.human_reviewed,
        humanReviewReason: r.human_review_reason,
        blocks: r.blocks as Contact8Blocks,
      })),
    };
  });

  app.post<{ Params: { id: string; contactId: string } }>(
    '/intelligence/runs/:id/plans/:contactId/override',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      const body = parse(OverrideContactPlanSchema, req.body);
      return tx(async (c) => {
        const plan = await one(
          c,
          `SELECT * FROM contact_cpc_plans WHERE run_id=$1 AND contact_id=$2 AND workspace_id=$3`,
          [req.params.id, req.params.contactId, a.workspaceId],
        );
        if (!plan) throw notFound('Plano do contato');
        const blocks = plan.blocks as Contact8Blocks;
        if (body.status) {
          blocks.decision.status = body.status;
          blocks.decision.reason = `Revisão humana: ${body.reason}`;
        }
        if (body.primaryChannel) {
          blocks.channel.primaryChannel = body.primaryChannel;
        }
        if (body.localTimeWindow) {
          blocks.schedule.localTimeWindow = body.localTimeWindow;
        }
        blocks.governance.reviewContestStatus = 'REVISADO_HUMANO';
        blocks.governance.humanReviewReason = body.reason;

        await c.query(
          `UPDATE contact_cpc_plans
              SET decision_status = $1,
                  decision_reason = $2,
                  primary_channel = $3,
                  local_time_window = $4,
                  human_reviewed = true,
                  human_review_reason = $5,
                  blocks = $6,
                  updated_at = now()
            WHERE id = $7`,
          [
            blocks.decision.status,
            blocks.decision.reason,
            blocks.channel.primaryChannel,
            blocks.schedule.localTimeWindow,
            body.reason,
            JSON.stringify(blocks),
            plan.id,
          ],
        );
        await audit(c, a, 'intelligence.plan.human_override', 'contact_cpc_plan', plan.id, {
          reason: body.reason,
          after: { status: blocks.decision.status, primaryChannel: blocks.channel.primaryChannel, localTimeWindow: blocks.schedule.localTimeWindow },
        });
        return { ok: true, blocks };
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { track?: string } }>('/intelligence/runs/:id/export.csv', async (req, reply) => {
    const a = actor(req);
    const run = await one(getPool(), `SELECT * FROM mailing_intelligence_runs WHERE id=$1 AND workspace_id=$2`, [
      req.params.id,
      a.workspaceId,
    ]);
    if (!run) throw notFound('Execução da esteira');
    const track = req.query.track && req.query.track !== 'ALL' ? req.query.track : null;

    const rows = await q(
      getPool(),
      `SELECT p.*, c.external_id, c.name AS contact_name, r.raw_fields
         FROM contact_cpc_plans p
         JOIN contacts c ON c.id = p.contact_id
         JOIN mailing_records r ON r.id = p.mailing_record_id
        WHERE p.run_id = $1
          AND ($2::text IS NULL OR p.operating_track = $2)
        ORDER BY p.priority_rank ASC`,
      [run.id, track],
    );

    const headers = [
      'id_cliente',
      'nome_cliente',
      '1_decisao_modo',
      '1_decisao_onda_lab',
      '1_decisao_prioridade_rank',
      '1_decisao_score',
      '1_decisao_status',
      '1_decisao_motivo',
      '2_cpc_prob_estimada_pct',
      '2_cpc_phone_intent_tier',
      '2_cpc_confianca',
      '2_cpc_confirmado_historico',
      '3_canal_primario',
      '3_canal_destino_preferido',
      '3_canal_fallback',
      '3_canal_arquetipo_comportamental',
      '4_horario_janela_local',
      '4_horario_fuso_iana',
      '4_horario_reciclagem_turnos',
      '4_horario_base',
      '5_tentativas_qtd_passos',
      '5_tentativas_sequencia_resumo',
      '5_tentativas_warmup_microjornada',
      '6_economia_custo_ate_cpc_brl',
      '6_economia_custo_por_cpc_esperado_brl',
      '6_economia_forca_bruta_cpc_brl',
      '6_economia_poupanca_por_cpc_brl',
      '7_evidencia_locator_score',
      '7_evidencia_faixa_etaria_cetic',
      '7_evidencia_ddd_uf_regiao',
      '7_evidencia_esgotamento_dados_pct',
      '7_evidencia_hipoteses_aplicadas',
      '8_governanca_finalidade',
      '8_governanca_politica_bina',
      '8_governanca_modo_lcm',
      '8_governanca_status_revisao',
    ];

    const csvRows = rows.map((r) => {
      const b = r.blocks as Contact8Blocks;
      const seqStr = (b.attempts?.candidateSequence ?? [])
        .map((s) => `${s.step}:${s.channel}@${s.localTimeWindow}`)
        .join(' -> ');
      return [
        r.external_id,
        r.contact_name ?? '',
        b.decision?.operatingTrack ?? r.operating_track,
        b.decision?.labWaveNumber ?? '',
        b.decision?.priorityRank ?? r.priority_rank,
        b.decision?.priorityScore ?? r.priority_score,
        b.decision?.status ?? r.decision_status,
        b.decision?.reason ?? r.decision_reason,
        (Number(r.estimated_cpc_prob) * 100).toFixed(1) + '%',
        b.cpc?.phoneIntentTier ?? r.phone_intent_tier,
        b.cpc?.confidenceLevel ?? 'MEDIA',
        b.cpc?.confirmedCpcHistoryCount ?? 0,
        r.primary_channel ?? '',
        r.preferred_destination ?? '',
        b.channel?.fallbackChannel ?? '',
        b.channel?.behavioralArchetype ?? '',
        r.local_time_window,
        r.timezone_iana,
        (b.schedule?.shiftRecyclingOrder ?? []).join(' > '),
        b.schedule?.scheduleBasis ?? '',
        (b.attempts?.candidateSequence ?? []).length,
        seqStr,
        b.attempts?.microJourneyWarmup ? 'SIM' : 'NAO',
        Number(r.expected_cost_to_cpc_brl).toFixed(2),
        Number(r.expected_cost_per_cpc_brl).toFixed(2),
        Number(r.brute_force_cpc_brl).toFixed(2),
        Number(b.economics?.estimatedSavingsPerCpcBrl ?? 0).toFixed(2),
        r.locator_score,
        r.age_bracket,
        `${r.ddd ?? ''}/${r.uf ?? ''} (${r.macro_region ?? ''})`,
        `${b.evidence?.dataCapExhaustionPct ?? 39}%`,
        (b.evidence?.appliedHypotheses ?? []).join('|'),
        b.governance?.purposeCode ?? run.purpose_code,
        b.governance?.callerIdPolicy ?? '',
        b.governance?.lcmPrivacyMode ? 'SIM' : 'NAO',
        b.governance?.reviewContestStatus ?? 'AUTOMATICO_AUDITAVEL',
      ];
    });

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="plano-cpc-8blocos-${run.id.slice(0, 8)}.csv"`);
    return toCsv(headers, csvRows);
  });

  app.get<{ Params: { id: string } }>('/intelligence/runs/:id/export.json', async (req, reply) => {
    const a = actor(req);
    const run = await one(getPool(), `SELECT * FROM mailing_intelligence_runs WHERE id=$1 AND workspace_id=$2`, [
      req.params.id,
      a.workspaceId,
    ]);
    if (!run) throw notFound('Execução da esteira');
    const plans = await q(
      getPool(),
      `SELECT p.contact_id, c.external_id, c.name, p.operating_track, p.lab_wave_number, p.priority_rank, p.blocks
         FROM contact_cpc_plans p
         JOIN contacts c ON c.id = p.contact_id
        WHERE p.run_id = $1
        ORDER BY p.priority_rank ASC`,
      [run.id],
    );
    reply.header('content-disposition', `attachment; filename="plano-cpc-8blocos-${run.id.slice(0, 8)}.json"`);
    return {
      run: formatRunRow(run),
      plans: plans.map((p) => ({
        contactId: p.contact_id,
        externalId: p.external_id,
        name: p.name,
        operatingTrack: p.operating_track,
        labWaveNumber: p.lab_wave_number,
        priorityRank: p.priority_rank,
        blocks: p.blocks,
      })),
    };
  });
}

function formatRunRow(r: any) {
  return {
    id: r.id,
    mailingId: r.mailing_id,
    mailingName: r.mailing_name,
    mode: r.mode,
    purposeCode: r.purpose_code,
    purposePrompt: r.purpose_prompt,
    referenceDate: r.reference_date,
    labSamplePct: Number(r.lab_sample_pct),
    plannedDaysWaves: r.planned_days_waves,
    completedWaves: r.completed_waves,
    maxAttemptsPerContact: r.max_attempts_per_contact,
    maxAcceptableCpcBrl: Number(r.max_acceptable_cpc_brl),
    channelTariffs: r.channel_tariffs ?? {},
    productionListVersionId: r.production_list_version_id,
    productionCampaignId: r.production_campaign_id,
    labCampaignId: r.lab_campaign_id,
    sampleCalc: r.sample_calc ?? {},
    cohortSummary: r.cohort_summary ?? {},
    productionSummary: r.production_summary ?? {},
    labSummary: r.lab_summary ?? {},
    promotedToProduction: r.promoted_to_production,
    promotedAt: r.promoted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
