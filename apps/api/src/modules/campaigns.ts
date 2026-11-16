import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_LABEL,
  CampaignDialerConfigSchema,
  CreateCampaignSchema,
  REASON_CODES,
  SaveDraftSchema,
  UpdateCampaignSchema,
  isDialerManagerRole,
  isSuperAdminRole,
  maskAddress,
  type CampaignDialerStatus,
  type CampaignHistoryChange,
  type CampaignHistoryItem,
  type CampaignStatus,
  type ReasonCode,
  type StrategyConfig,
} from '@voll/shared';
import { getPool, one, q, tx, type Db } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { HttpError, conflict, forbidden, notFound, parse, unprocessable } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { describeNextWindow, inCalendar, strategySummary } from '../engine/calendar.js';
import { computeMembership } from '../engine/membership.js';
import { materializeEnrollments } from '../engine/materialize.js';
import { buildContexts, evaluateEnrollment, loadCampaignRuntime } from '../engine/eligibility.js';
import { cancelUnsent } from '../engine/events.js';
import { computeCampaignQuota, loadWorkspaceTrunkSnapshot } from '../engine/trunk-capacity.js';
import { campaignIndicators } from '../services/indicators.js';
import { ATTEMPT_FROM, ATTEMPT_SELECT, attemptRow } from '../services/views.js';

const SUMMARY_SQL = `
  SELECT c.*, j.id AS journey_id, j.name AS journey_name, jv.version AS journey_version, jv.steps,
         s.id AS strategy_id, s.name AS strategy_name, sv.version AS strategy_version, sv.config,
         m.name AS mailing_name, l.name AS list_name, lv.version AS list_version, lv.membership_mode,
         cal.name AS calendar_name, cal.timezone AS calendar_timezone, cal.windows AS calendar_windows, cal.holiday_policy AS calendar_holiday_policy, cal.active AS calendar_active,
         w.global_suspension,
         (SELECT count(*)::int FROM enrollments e WHERE e.campaign_id=c.id) AS members,
         (SELECT count(*)::int FROM enrollments e WHERE e.campaign_id=c.id AND e.state <> 'ACTIVE') AS finished,
         (SELECT count(*)::int FROM enrollments e WHERE e.campaign_id=c.id AND e.state = 'ACTIVE') AS active_enrollments,
         (SELECT count(*)::int FROM enrollments e WHERE e.campaign_id=c.id AND e.state = 'ACTIVE' AND e.next_eligible_at <= now()) AS ready_enrollments,
         (SELECT count(*)::int FROM attempts a WHERE a.campaign_id=c.id AND a.state IN ('RESERVED','SENT','AWAITING_FEEDBACK','RECONCILIATION')) AS active_attempts
    FROM campaigns c
    JOIN journey_versions jv ON jv.id=c.journey_version_id JOIN journeys j ON j.id=jv.journey_id
    JOIN strategy_versions sv ON sv.id=c.strategy_version_id JOIN strategies s ON s.id=sv.strategy_id
    JOIN mailings m ON m.id=c.mailing_id
    JOIN workspaces w ON w.id=c.workspace_id
    LEFT JOIN calendars cal ON cal.id=c.calendar_id
    LEFT JOIN list_versions lv ON lv.id=c.list_version_id LEFT JOIN lists l ON l.id=lv.list_id`;

/** Estado operacional derivado (§26.6) — não altera contadores nem dispara acionamentos. */
export function operational(r: any, now = new Date()): { state: string; explanation: string } {
  const dynamic = r.membership_mode === 'DYNAMIC';
  if (r.status === 'RUNNING') {
    if (r.global_suspension)
      return { state: 'WAITING_RELEASE', explanation: 'Aguardando liberação: há suspensão global ativa no Controle central. Nenhum novo acionamento será feito.' };
    if (!r.materialized_at) return { state: 'PROCESSING', explanation: 'Preparando as inscrições da base.' };
    const cfg = r.config as StrategyConfig;
    const cal = r.calendar_windows
      ? { timezone: r.calendar_timezone, windows: r.calendar_windows, holidayPolicy: r.calendar_holiday_policy }
      : cfg.calendar;
    if (r.active_enrollments > 0 && !inCalendar(cal, now)) {
      const nw = describeNextWindow(cal, now);
      return { state: 'WAITING_WINDOW', explanation: `Aguardando próxima janela: fora do calendário de funcionamento.${nw ? ` Próxima abertura: ${nw}.` : ''}` };
    }
    if (r.ready_enrollments > 0) return { state: 'PROCESSING', explanation: 'Processando: há clientes na fila de seleção; cada um é revalidado antes da reserva.' };
    if (r.active_attempts > 0)
      return { state: 'WAITING_RETURNS', explanation: `Aguardando retornos: ${r.active_attempts} tentativa(s) reservada(s), enviada(s) ou em reconciliação.` };
    if (r.active_enrollments > 0)
      return { state: 'PROCESSING', explanation: 'Processando: clientes aguardam o intervalo de retentativa ou limites do dia.' };
    return {
      state: 'BASE_PROCESSED',
      explanation: dynamic
        ? 'Base processada com execução habilitada: a lista é dinâmica e novos clientes que satisfaçam os filtros entram automaticamente.'
        : 'Base processada: sem clientes acionáveis nem tentativas pendentes; a campanha será concluída.',
    };
  }
  if (r.status === 'PAUSED') {
    return r.active_attempts > 0
      ? { state: 'WAITING_RETURNS', explanation: 'Pausada: nenhum novo acionamento, mas retornos de tentativas já enviadas continuam sendo processados.' }
      : { state: 'IDLE', explanation: 'Pausada: nenhum novo acionamento até ser retomada.' };
  }
  const text: Record<string, string> = {
    READY: 'Pronta: criada sem iniciar. Inicie para habilitar a operação.',
    SCHEDULED: `Agendada para ${r.scheduled_at ? new Date(r.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} (horário de São Paulo).`,
    CLOSED: 'Encerrada: novas entregas impedidas; tentativas já aceitas permanecem rastreadas.',
    COMPLETED: 'Concluída: não há inscrições acionáveis nem tentativas pendentes.',
    ARCHIVED: 'Arquivada: histórico e indicadores preservados; não aparece na operação ativa.',
  };
  return { state: 'IDLE', explanation: text[r.status] ?? '' };
}

function summary(r: any) {
  const op = operational(r);
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    statusLabel: CAMPAIGN_STATUS_LABEL[r.status as CampaignStatus],
    operationalState: op.state,
    operationalExplanation: op.explanation,
    audience: r.list_version_id
      ? { type: 'LIST', name: `${r.list_name} v${r.list_version}`, membershipMode: r.membership_mode }
      : { type: 'MAILING', name: r.mailing_name, membershipMode: null },
    journeyName: r.journey_name,
    strategyName: r.strategy_name,
    strategyVersion: r.strategy_version,
    calendarId: r.calendar_id ?? null,
    calendarName: r.calendar_name ?? null,
    voiceAgentId: r.voice_agent_id ?? null,
    trunkIds: Array.isArray(r.trunk_ids) ? r.trunk_ids.map(String) : [],
    dialMultiplier: r.dial_multiplier !== null && r.dial_multiplier !== undefined ? Number(r.dial_multiplier) : 1,
    createdAt: r.created_at,
    startedAt: r.started_at,
    archivedAt: r.archived_at ?? null,
    archivedReason: r.archived_reason ?? null,
    progress: { members: r.members, finished: r.finished, active: r.active_attempts },
  };
}

function detail(r: any) {
  return {
    ...summary(r),
    description: r.description,
    scheduledAt: r.scheduled_at,
    mailing: { id: r.mailing_id, name: r.mailing_name },
    listVersion: r.list_version_id ? { id: r.list_version_id, version: r.list_version, membershipMode: r.membership_mode, name: r.list_name } : null,
    journey: { id: r.journey_id, versionId: r.journey_version_id, version: r.journey_version, name: r.journey_name, steps: r.steps },
    strategy: { id: r.strategy_id, versionId: r.strategy_version_id, version: r.strategy_version, name: r.strategy_name, config: r.config, summary: strategySummary(r.config) },
    calendar: r.calendar_id
      ? {
          id: r.calendar_id,
          name: r.calendar_name,
          timezone: r.calendar_timezone,
          windows: r.calendar_windows,
          holidayPolicy: r.calendar_holiday_policy,
          active: r.calendar_active,
          holidays: [],
        }
      : null,
  };
}

async function loadCampaignRow(db: Db, id: string, workspaceId: string) {
  const r = await one(db, `${SUMMARY_SQL} WHERE c.id=$1 AND c.workspace_id=$2`, [id, workspaceId]);
  if (!r) throw notFound('Campanha');
  return r;
}

const PreflightSchema = z.object({
  mailingId: z.string().uuid().nullish(),
  listVersionId: z.string().uuid().nullish(),
  journeyVersionId: z.string().uuid().nullish(),
  strategyVersionId: z.string().uuid().nullish(),
  calendarId: z.string().uuid().nullish(),
}).passthrough();

async function audienceCount(db: Db, workspaceId: string, mailingId: string, listVersionId?: string | null) {
  if (listVersionId) {
    const lv = await one(
      db,
      `SELECT v.*, l.name, l.mailing_id FROM list_versions v JOIN lists l ON l.id=v.list_id WHERE v.id=$1 AND l.workspace_id=$2`,
      [listVersionId, workspaceId],
    );
    if (!lv) throw unprocessable('Lista não encontrada', { listVersionId: 'Lista não encontrada' });
    if (lv.mailing_id !== mailingId) throw unprocessable('A lista não pertence ao mailing selecionado', { listVersionId: 'Lista de outro mailing' });
    const count =
      lv.membership_mode === 'SNAPSHOT'
        ? lv.member_count
        : (await computeMembership(db, workspaceId, mailingId, lv.filters, lv.sort)).members.length;
    return { type: 'LIST' as const, name: `${lv.name} v${lv.version}`, count, membershipMode: lv.membership_mode };
  }
  const m = await one(db, `SELECT name FROM mailings WHERE id=$1 AND workspace_id=$2`, [mailingId, workspaceId]);
  if (!m) throw unprocessable('Mailing não encontrado', { mailingId: 'Mailing não encontrado' });
  const count = (await computeMembership(db, workspaceId, mailingId, [], [])).members.length;
  return { type: 'MAILING' as const, name: m.name, count, membershipMode: null };
}

async function assertValidWorkspaceTrunks(workspaceId: string, trunkIds: string[]) {
  if (!trunkIds.length) return;
  const snap = await loadWorkspaceTrunkSnapshot(getPool(), workspaceId);
  if (!snap.gatewayConfigured || !snap.gatewayOnline) return;
  const valid = new Set(snap.trunks.filter((t) => t.direction !== 'inbound').map((t) => t.id));
  const invalid = trunkIds.filter((id) => !valid.has(id));
  if (invalid.length > 0) {
    throw unprocessable(`Tronco(s) inválido(s) ou indisponível(is) para este workspace: ${invalid.join(', ')}`, {
      trunkIds: invalid.join(', '),
    });
  }
}

export async function campaignRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- rascunho do assistente (§27.6)
  app.get('/campaign-draft', async (req) => {
    const a = actor(req);
    const d = await one(getPool(), `SELECT data, revision, updated_at FROM campaign_drafts WHERE workspace_id=$1 AND user_id=$2`, [a.workspaceId, a.userId]);
    return d ? { data: d.data, revision: d.revision, updatedAt: d.updated_at } : null;
  });

  app.put('/campaign-draft', async (req) => {
    const body = parse(SaveDraftSchema, req.body);
    const a = actor(req);
    return tx(async (c) => {
      const cur = await one(c, `SELECT revision FROM campaign_drafts WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE`, [a.workspaceId, a.userId]);
      if (cur && cur.revision !== body.revision)
        throw new HttpError(409, 'Conflito', 'O rascunho foi alterado em outra aba ou dispositivo. Recarregue para revisar.');
      if (!cur && body.revision !== 0) throw conflict('O rascunho não existe mais. Recarregue para continuar.');
      const r = await one(
        c,
        `INSERT INTO campaign_drafts (workspace_id, user_id, data, revision) VALUES ($1,$2,$3,1)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET data=EXCLUDED.data, revision=campaign_drafts.revision+1, updated_at=now()
         RETURNING revision, updated_at`,
        [a.workspaceId, a.userId, JSON.stringify(body.data)],
      );
      return { revision: r!.revision, updatedAt: r!.updated_at };
    });
  });

  app.delete('/campaign-draft', async (req, reply) => {
    const a = actor(req);
    await getPool().query(`DELETE FROM campaign_drafts WHERE workspace_id=$1 AND user_id=$2`, [a.workspaceId, a.userId]);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- preflight e criação
  app.post('/campaigns/preflight', async (req) => {
    const body = parse(PreflightSchema, req.body);
    const a = actor(req);
    const db = getPool();
    const warnings: string[] = [];
    const ws = await one(db, `SELECT global_suspension FROM workspaces WHERE id=$1`, [a.workspaceId]);
    if (ws.global_suspension) warnings.push('Suspensão global ativa: o acionamento aguardará liberação no Controle central.');
    const audience = body.mailingId ? await audienceCount(db, a.workspaceId, body.mailingId, body.listVersionId) : null;
    let journey: any = null;
    let firstTariff: number | null | undefined;
    let firstChannel: string | null = null;
    if (body.journeyVersionId) {
      const jv = await one(
        db,
        `SELECT jv.*, j.name FROM journey_versions jv JOIN journeys j ON j.id=jv.journey_id WHERE jv.id=$1 AND j.workspace_id=$2`,
        [body.journeyVersionId, a.workspaceId],
      );
      if (!jv) throw unprocessable('Jornada não encontrada', { journeyVersionId: 'Jornada não encontrada' });
      const conns = await q(db, `SELECT id, name, active, tariff FROM connections WHERE id = ANY($1)`, [(jv.steps as any[]).map((s) => s.connectionId)]);
      const byId = Object.fromEntries(conns.map((c) => [c.id, c]));
      journey = {
        name: jv.name,
        version: jv.version,
        steps: (jv.steps as any[]).map((s) => ({ ...s, connectionName: byId[s.connectionId]?.name ?? null, channelLabel: CHANNEL_LABEL[s.channelType as keyof typeof CHANNEL_LABEL] })),
      };
      for (const s of jv.steps as any[]) {
        if (!byId[s.connectionId]) warnings.push('Uma etapa da jornada não tem conexão padrão vinculada.');
        else if (!byId[s.connectionId].active) warnings.push(`A conexão "${byId[s.connectionId].name}" está inativa.`);
      }
      const first = (jv.steps as any[])[0];
      firstTariff = first ? byId[first.connectionId]?.tariff ?? null : null;
      firstChannel = first ? CHANNEL_LABEL[first.channelType as keyof typeof CHANNEL_LABEL] : null;
    }
    let strategy: any = null;
    let nextWindow: string | null = null;
    if (body.strategyVersionId) {
      const sv = await one(
        db,
        `SELECT sv.*, s.name FROM strategy_versions sv JOIN strategies s ON s.id=sv.strategy_id WHERE sv.id=$1 AND s.workspace_id=$2`,
        [body.strategyVersionId, a.workspaceId],
      );
      if (!sv) throw unprocessable('Estratégia não encontrada', { strategyVersionId: 'Estratégia não encontrada' });
      strategy = { name: sv.name, version: sv.version, summary: strategySummary(sv.config), config: sv.config };
      nextWindow = describeNextWindow(sv.config.calendar, new Date());
      if (body.calendarId) {
        const cal = await one(db, `SELECT timezone, windows, holiday_policy FROM calendars WHERE id=$1 AND workspace_id=$2`, [body.calendarId, a.workspaceId]);
        if (cal) {
          nextWindow = describeNextWindow({ timezone: cal.timezone, windows: cal.windows, holidayPolicy: cal.holiday_policy }, new Date());
        }
      }
      if (sv.config.limits.incompleteHistory === 'BLOCK' && body.mailingId) {
        const [{ n }] = await q(
          db,
          `SELECT count(DISTINCT c.id)::int AS n FROM mailing_records r JOIN contacts c ON c.id=r.contact_id
            WHERE r.mailing_id=$1 AND c.history_total IS NULL`,
          [body.mailingId],
        );
        if (n > 0) warnings.push(`${n} contato(s) sem histórico importado ficarão aguardando revisão (política de histórico incompleto).`);
      }
    }
    const isSuper = isSuperAdminRole(a.role);
    const count = audience?.count ?? 0;
    const costValue =
      !isSuper || firstTariff === null || firstTariff === undefined ? null : Math.round(count * firstTariff * 10000) / 10000;
    return {
      audience,
      journey,
      strategy,
      nextWindow,
      costEstimate: {
        value: journey && audience ? costValue : null,
        premise: !isSuper
          ? 'Visão do cliente exibe estritamente consumo de tempo e volume de acionamentos.'
          : firstTariff === null && journey
            ? `Tarifa do primeiro canal (${firstChannel}) não informada — custo desconhecido, não zero.`
            : `Uma tentativa por contato disponível no primeiro canal (${firstChannel ?? '—'}), usando a tarifa cadastrada. Retentativas e canais seguintes não entram nesta estimativa.`,
      },
      warnings,
    };
  });

  app.post('/campaigns', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(CreateCampaignSchema, req.body);
    const a = actor(req);
    const requestedTrunks = Array.isArray(body.trunkIds) ? [...new Set(body.trunkIds.map((s) => s.trim()).filter(Boolean))] : [];
    const requestedMultiplier = body.dialMultiplier ?? 1;
    const voiceAgentId = body.voiceAgentId ? body.voiceAgentId.trim() : null;
    if ((requestedTrunks.length > 0 || body.dialMultiplier !== undefined) && !isDialerManagerRole(a.role)) {
      throw new HttpError(403, 'Acesso restrito ao Gestor', 'Apenas Gestores podem definir troncos ou multiplicador da campanha.');
    }
    if (voiceAgentId) {
      const own = await one<{ workspace_id: string | null }>(
        getPool(),
        `SELECT workspace_id FROM workspace_voice_resources WHERE resource_type='agent' AND resource_id=$1`,
        [voiceAgentId],
      ).catch(() => null);
      if (own && own.workspace_id && own.workspace_id !== a.workspaceId) {
        throw forbidden('Este Agente de Voz pertence a outro workspace.');
      }
    }
    await assertValidWorkspaceTrunks(a.workspaceId, requestedTrunks);

    const key = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 200) ?? null;
    const result = await tx(async (c) => {
      if (key) {
        const ex = await one(c, `SELECT id FROM campaigns WHERE workspace_id=$1 AND idempotency_key=$2`, [a.workspaceId, key]);
        if (ex) return { id: ex.id as string, existing: true };
      }
      // revalida dependências no servidor (§27.6)
      await audienceCount(c, a.workspaceId, body.mailingId, body.listVersionId);
      const jv = await one(c, `SELECT jv.id FROM journey_versions jv JOIN journeys j ON j.id=jv.journey_id WHERE jv.id=$1 AND j.workspace_id=$2`, [body.journeyVersionId, a.workspaceId]);
      if (!jv) throw unprocessable('Jornada não encontrada', { journeyVersionId: 'Jornada não encontrada' });
      const sv = await one(c, `SELECT sv.id FROM strategy_versions sv JOIN strategies s ON s.id=sv.strategy_id WHERE sv.id=$1 AND s.workspace_id=$2`, [body.strategyVersionId, a.workspaceId]);
      if (!sv) throw unprocessable('Estratégia não encontrada', { strategyVersionId: 'Estratégia não encontrada' });
      if (body.calendarId) {
        const cal = await one(c, `SELECT id FROM calendars WHERE id=$1 AND workspace_id=$2`, [body.calendarId, a.workspaceId]);
        if (!cal) throw unprocessable('Calendário não encontrado', { calendarId: 'Calendário não encontrado' });
      }
      const status = body.startMode === 'NOW' ? 'RUNNING' : body.startMode === 'SCHEDULE' ? 'SCHEDULED' : 'READY';
      const ins = await one(
        c,
        `INSERT INTO campaigns (workspace_id, name, description, status, mailing_id, list_version_id, journey_version_id,
                                strategy_version_id, calendar_id, scheduled_at, trunk_ids, dial_multiplier, voice_agent_id, idempotency_key, created_by, started_at)
         VALUES ($1,$2,$3,$4::campaign_status,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $4::text='RUNNING' THEN now() END)
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING id`,
        [
          a.workspaceId, body.name, body.description ?? null, status, body.mailingId, body.listVersionId ?? null,
          body.journeyVersionId, body.strategyVersionId, body.calendarId ?? null,
          body.startMode === 'SCHEDULE' ? body.scheduledAt : null, requestedTrunks, requestedMultiplier, voiceAgentId, key, a.userId,
        ],
      );
      if (!ins) {
        const ex = await one(c, `SELECT id FROM campaigns WHERE workspace_id=$1 AND idempotency_key=$2`, [a.workspaceId, key]);
        return { id: ex!.id as string, existing: true };
      }
      if (status === 'RUNNING') await materializeEnrollments(c, ins.id);
      await c.query(`DELETE FROM campaign_drafts WHERE workspace_id=$1 AND user_id=$2`, [a.workspaceId, a.userId]);
      await audit(c, a, 'campaign.create', 'campaign', ins.id, { after: { ...body, trunkIds: requestedTrunks, dialMultiplier: requestedMultiplier, voiceAgentId, status } });
      return { id: ins.id as string, existing: false };
    });
    const row = await loadCampaignRow(getPool(), result.id, a.workspaceId);
    return reply.code(result.existing ? 200 : 201).send(detail(row));
  });

  // ---------------------------------------------------------------- consulta
  app.get<{ Querystring: { status?: string } }>('/campaigns', async (req) => {
    const a = actor(req);
    const st = req.query.status?.trim() || null;
    const rows = await q(
      getPool(),
      `${SUMMARY_SQL} WHERE c.workspace_id=$1 AND (CASE WHEN $2::text IS NOT NULL THEN c.status::text = $2 ELSE c.status::text <> 'ARCHIVED' END) ORDER BY c.created_at DESC`,
      [a.workspaceId, st],
    );
    return { items: rows.map(summary) };
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (req) => detail(await loadCampaignRow(getPool(), req.params.id, actor(req).workspaceId)));

  app.patch<{ Params: { id: string } }>(
    '/campaigns/:id',
    { preHandler: requireRoles(...CAN.manageData) },
    async (req) => {
      const a = actor(req);
      const body = parse(UpdateCampaignSchema, req.body);

      if (body.trunkIds !== undefined || body.dialMultiplier !== undefined) {
        if (!isDialerManagerRole(a.role)) {
          throw new HttpError(403, 'Acesso restrito ao Gestor', 'Apenas Gestores podem definir troncos ou multiplicador da campanha.');
        }
        if (body.trunkIds !== undefined) {
          await assertValidWorkspaceTrunks(a.workspaceId, [...new Set(body.trunkIds.map((s) => s.trim()).filter(Boolean))]);
        }
      }

      const fmtSched = (v: string | Date | null | undefined): string | null => {
        if (!v) return null;
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime())) return String(v);
        return new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(d);
      };

      const resolveLabels = async (
        db: Db,
        refs: {
          listVersionId: string | null;
          journeyVersionId: string;
          strategyVersionId: string;
          calendarId: string | null;
        },
      ) => {
        let listLabel = 'Todos os contatos do mailing';
        if (refs.listVersionId) {
          const lv = await one<{ name: string; version: number }>(
            db,
            `SELECT l.name, lv.version FROM list_versions lv JOIN lists l ON l.id=lv.list_id WHERE lv.id=$1 AND l.workspace_id=$2`,
            [refs.listVersionId, a.workspaceId],
          );
          if (!lv) throw notFound('Versão da lista');
          listLabel = `${lv.name} (v${lv.version})`;
        }
        const jv = await one<{ name: string; version: number }>(
          db,
          `SELECT j.name, jv.version FROM journey_versions jv JOIN journeys j ON j.id=jv.journey_id WHERE jv.id=$1 AND j.workspace_id=$2`,
          [refs.journeyVersionId, a.workspaceId],
        );
        if (!jv) throw notFound('Versão da jornada');
        const sv = await one<{ name: string; version: number }>(
          db,
          `SELECT s.name, sv.version FROM strategy_versions sv JOIN strategies s ON s.id=sv.strategy_id WHERE sv.id=$1 AND s.workspace_id=$2`,
          [refs.strategyVersionId, a.workspaceId],
        );
        if (!sv) throw notFound('Versão da estratégia');
        let calendarLabel = 'Padrão da estratégia';
        if (refs.calendarId) {
          const cal = await one<{ name: string }>(
            db,
            `SELECT name FROM calendars WHERE id=$1 AND workspace_id=$2`,
            [refs.calendarId, a.workspaceId],
          );
          if (!cal) throw notFound('Calendário de funcionamento');
          calendarLabel = cal.name;
        }
        return {
          listLabel,
          journeyLabel: `${jv.name} (v${jv.version})`,
          strategyLabel: `${sv.name} (v${sv.version})`,
          calendarLabel,
        };
      };

      const result = await tx(async (c) => {
        const cur = await one<{
          id: string;
          name: string;
          description: string | null;
          status: string;
          archived_at: string | null;
          list_version_id: string | null;
          journey_version_id: string;
          strategy_version_id: string;
          calendar_id: string | null;
          voice_agent_id: string | null;
          scheduled_at: string | null;
          trunk_ids: string[] | null;
          dial_multiplier: string | number | null;
        }>(c, `SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);

        if (!cur) throw notFound('Campanha');
        if (cur.archived_at || cur.status === 'ARCHIVED' || cur.status === 'COMPLETED' || cur.status === 'CANCELLED') {
          throw conflict('Campanhas encerradas ou arquivadas não podem ser editadas.');
        }

        const nextName = body.name !== undefined ? body.name : cur.name;
        const nextDescription = body.description !== undefined ? (body.description || null) : cur.description;
        const nextListVersionId = body.listVersionId !== undefined ? body.listVersionId : cur.list_version_id;
        const nextJourneyVersionId = body.journeyVersionId !== undefined ? body.journeyVersionId : cur.journey_version_id;
        const nextStrategyVersionId = body.strategyVersionId !== undefined ? body.strategyVersionId : cur.strategy_version_id;
        const nextCalendarId = body.calendarId !== undefined ? body.calendarId : cur.calendar_id;
        const nextVoiceAgentId = body.voiceAgentId !== undefined ? body.voiceAgentId : cur.voice_agent_id;
        const nextScheduledAt =
          body.scheduledAt !== undefined ? body.scheduledAt : cur.scheduled_at ? new Date(cur.scheduled_at).toISOString() : null;
        const curTrunks = Array.isArray(cur.trunk_ids) ? cur.trunk_ids.map(String) : [];
        const nextTrunks =
          body.trunkIds !== undefined ? [...new Set(body.trunkIds.map((s) => s.trim()).filter(Boolean))] : curTrunks;
        const curMultiplier = cur.dial_multiplier !== null && cur.dial_multiplier !== undefined ? Number(cur.dial_multiplier) : 1;
        const nextMultiplier = body.dialMultiplier !== undefined ? body.dialMultiplier : curMultiplier;

        if (body.scheduledAt !== undefined) {
          const curSchedIso = cur.scheduled_at ? new Date(cur.scheduled_at).toISOString() : null;
          if (nextScheduledAt !== curSchedIso && !['DRAFT', 'READY', 'SCHEDULED'].includes(cur.status)) {
            throw unprocessable('Agendamento só pode ser alterado antes do início da campanha.');
          }
          if (nextScheduledAt && new Date(nextScheduledAt).getTime() <= Date.now()) {
            throw unprocessable('A data e hora de agendamento deve ser futura.');
          }
        }

        const beforeLabels = await resolveLabels(c, {
          listVersionId: cur.list_version_id,
          journeyVersionId: cur.journey_version_id,
          strategyVersionId: cur.strategy_version_id,
          calendarId: cur.calendar_id,
        });
        const afterLabels = await resolveLabels(c, {
          listVersionId: nextListVersionId,
          journeyVersionId: nextJourneyVersionId,
          strategyVersionId: nextStrategyVersionId,
          calendarId: nextCalendarId,
        });

        const changes: CampaignHistoryChange[] = [];
        if (nextName !== cur.name) {
          changes.push({ field: 'name', label: 'Nome', before: cur.name, after: nextName });
        }
        if ((nextDescription ?? null) !== (cur.description ?? null)) {
          changes.push({ field: 'description', label: 'Descrição', before: cur.description ?? null, after: nextDescription ?? null });
        }
        if (nextListVersionId !== cur.list_version_id) {
          changes.push({ field: 'listVersionId', label: 'Público / Lista', before: beforeLabels.listLabel, after: afterLabels.listLabel });
        }
        if (nextJourneyVersionId !== cur.journey_version_id) {
          changes.push({ field: 'journeyVersionId', label: 'Jornada', before: beforeLabels.journeyLabel, after: afterLabels.journeyLabel });
        }
        if (nextStrategyVersionId !== cur.strategy_version_id) {
          changes.push({ field: 'strategyVersionId', label: 'Estratégia', before: beforeLabels.strategyLabel, after: afterLabels.strategyLabel });
        }
        if (nextCalendarId !== cur.calendar_id) {
          changes.push({ field: 'calendarId', label: 'Calendário de funcionamento', before: beforeLabels.calendarLabel, after: afterLabels.calendarLabel });
        }
        if ((nextVoiceAgentId ?? null) !== (cur.voice_agent_id ?? null)) {
          changes.push({ field: 'voiceAgentId', label: 'Agente de Voz', before: cur.voice_agent_id ?? null, after: nextVoiceAgentId ?? null });
        }
        const curSchedMs = cur.scheduled_at ? new Date(cur.scheduled_at).getTime() : null;
        const nextSchedMs = nextScheduledAt ? new Date(nextScheduledAt).getTime() : null;
        if (curSchedMs !== nextSchedMs) {
          changes.push({ field: 'scheduledAt', label: 'Agendamento', before: fmtSched(cur.scheduled_at), after: fmtSched(nextScheduledAt) });
        }
        if (JSON.stringify(curTrunks) !== JSON.stringify(nextTrunks)) {
          changes.push({
            field: 'trunkIds',
            label: 'Troncos do discador',
            before: curTrunks.length ? curTrunks.join(', ') : 'Automático',
            after: nextTrunks.length ? nextTrunks.join(', ') : 'Automático',
          });
        }
        if (Math.abs(curMultiplier - nextMultiplier) > 0.001) {
          changes.push({
            field: 'dialMultiplier',
            label: 'Multiplicador do discador',
            before: `${curMultiplier.toFixed(1)}x`,
            after: `${nextMultiplier.toFixed(1)}x`,
          });
        }

        if (changes.length === 0) {
          return { changed: false, changes: [] as CampaignHistoryChange[] };
        }

        await c.query(
          `UPDATE campaigns
              SET name=$3,
                  description=$4,
                  list_version_id=$5,
                  journey_version_id=$6,
                  strategy_version_id=$7,
                  calendar_id=$8,
                  voice_agent_id=$9,
                  scheduled_at=$10,
                  trunk_ids=$11,
                  dial_multiplier=$12
            WHERE id=$1 AND workspace_id=$2`,
          [
            cur.id,
            a.workspaceId,
            nextName,
            nextDescription,
            nextListVersionId,
            nextJourneyVersionId,
            nextStrategyVersionId,
            nextCalendarId,
            nextVoiceAgentId,
            nextScheduledAt,
            nextTrunks,
            nextMultiplier,
          ],
        );

        await audit(c, a, 'campaign.updated', 'campaign', cur.id, {
          reason: body.reason ?? null,
          before: {
            name: cur.name,
            description: cur.description,
            list: beforeLabels.listLabel,
            journey: beforeLabels.journeyLabel,
            strategy: beforeLabels.strategyLabel,
            calendar: beforeLabels.calendarLabel,
            voiceAgentId: cur.voice_agent_id,
            scheduledAt: cur.scheduled_at,
            trunkIds: curTrunks,
            dialMultiplier: curMultiplier,
          },
          after: {
            name: nextName,
            description: nextDescription,
            list: afterLabels.listLabel,
            journey: afterLabels.journeyLabel,
            strategy: afterLabels.strategyLabel,
            calendar: afterLabels.calendarLabel,
            voiceAgentId: nextVoiceAgentId,
            scheduledAt: nextScheduledAt,
            trunkIds: nextTrunks,
            dialMultiplier: nextMultiplier,
            changes,
          },
        });

        return { changed: true, changes };
      });

      const updated = detail(await loadCampaignRow(getPool(), req.params.id, a.workspaceId));
      return { campaign: updated, changed: result.changed, changes: result.changes };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/campaigns/:id/history', async (req) => {
    const a = actor(req);
    await loadCampaignRow(getPool(), req.params.id, a.workspaceId);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
    const rows = await q<{
      id: string | number;
      action: string;
      user_id: string | null;
      actor_name: string | null;
      actor_email: string | null;
      reason: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      at: string | Date;
    }>(
      getPool(),
      `SELECT l.id, l.action, l.user_id, u.name AS actor_name, u.email AS actor_email,
              l.reason, l.before, l.after, l.at
         FROM audit_log l
         LEFT JOIN users u ON u.id = l.user_id
        WHERE l.workspace_id=$1 AND l.entity='campaign' AND l.entity_id=$2
        ORDER BY l.at DESC, l.id DESC
        LIMIT $3`,
      [a.workspaceId, req.params.id, limit],
    );

    const items: CampaignHistoryItem[] = rows.map((r) => {
      let changes: CampaignHistoryChange[] = [];
      const afterObj = r.after && typeof r.after === 'object' ? r.after : null;
      const beforeObj = r.before && typeof r.before === 'object' ? r.before : null;

      if (afterObj && Array.isArray(afterObj.changes)) {
        changes = afterObj.changes as CampaignHistoryChange[];
      } else if (r.action === 'campaign.create' && afterObj) {
        changes = [
          {
            field: 'status',
            label: 'Criação da campanha',
            before: null,
            after: String(afterObj.status ?? 'CREATED'),
          },
        ];
      } else if (r.action === 'campaign.dialer_config' && beforeObj && afterObj) {
        if (JSON.stringify(beforeObj.trunkIds ?? []) !== JSON.stringify(afterObj.trunkIds ?? [])) {
          changes.push({
            field: 'trunkIds',
            label: 'Troncos do discador',
            before: Array.isArray(beforeObj.trunkIds) && beforeObj.trunkIds.length ? beforeObj.trunkIds.join(', ') : 'Automático',
            after: Array.isArray(afterObj.trunkIds) && afterObj.trunkIds.length ? afterObj.trunkIds.join(', ') : 'Automático',
          });
        }
        if (Number(beforeObj.dialMultiplier ?? 1) !== Number(afterObj.dialMultiplier ?? 1)) {
          changes.push({
            field: 'dialMultiplier',
            label: 'Multiplicador do discador',
            before: `${Number(beforeObj.dialMultiplier ?? 1).toFixed(1)}x`,
            after: `${Number(afterObj.dialMultiplier ?? 1).toFixed(1)}x`,
          });
        }
      } else if (beforeObj && afterObj && ('status' in beforeObj || 'status' in afterObj)) {
        const bSt = beforeObj.status ? CAMPAIGN_STATUS_LABEL[String(beforeObj.status) as CampaignStatus] ?? String(beforeObj.status) : null;
        const aSt = afterObj.status ? CAMPAIGN_STATUS_LABEL[String(afterObj.status) as CampaignStatus] ?? String(afterObj.status) : null;
        changes = [{ field: 'status', label: 'Status', before: bSt, after: aSt }];
      }

      return {
        id: String(r.id),
        action: r.action,
        actorId: r.user_id,
        actorName: r.actor_name || r.actor_email || 'Sistema',
        actorEmail: r.actor_email,
        reason: r.reason,
        at: new Date(r.at).toISOString(),
        changes,
      };
    });

    return { items };
  });

  app.put<{ Params: { id: string } }>('/campaigns/:id/dialer-config', async (req) => {
    const a = actor(req);
    if (!isDialerManagerRole(a.role)) {
      throw new HttpError(403, 'Acesso restrito ao Gestor', 'Apenas Gestores podem definir troncos ou multiplicador da campanha.');
    }
    const body = parse(CampaignDialerConfigSchema, req.body);
    const cleanTrunks = [...new Set(body.trunkIds.map((s) => s.trim()).filter(Boolean))];
    await assertValidWorkspaceTrunks(a.workspaceId, cleanTrunks);

    const updated = await tx(async (c) => {
      const cur = await one<{ id: string; trunk_ids: string[] | null; dial_multiplier: string | number | null }>(
        c,
        `SELECT id, trunk_ids, dial_multiplier FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
        [req.params.id, a.workspaceId],
      );
      if (!cur) throw notFound('Campanha');
      const r = await one<{ id: string; trunk_ids: string[]; dial_multiplier: string | number }>(
        c,
        `UPDATE campaigns SET trunk_ids=$3, dial_multiplier=$4 WHERE id=$1 AND workspace_id=$2 RETURNING id, trunk_ids, dial_multiplier`,
        [req.params.id, a.workspaceId, cleanTrunks, body.dialMultiplier],
      );
      await audit(c, a, 'campaign.dialer_config', 'campaign', cur.id, {
        before: { trunkIds: cur.trunk_ids ?? [], dialMultiplier: Number(cur.dial_multiplier ?? 1) },
        after: { trunkIds: r!.trunk_ids, dialMultiplier: Number(r!.dial_multiplier) },
      });
      return r!;
    });

    return {
      campaignId: updated.id,
      trunkIds: updated.trunk_ids,
      dialMultiplier: Number(updated.dial_multiplier),
    };
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id/dialer-status', async (req): Promise<CampaignDialerStatus> => {
    const a = actor(req);
    const r = await loadCampaignRow(getPool(), req.params.id, a.workspaceId);
    const trunkIds: string[] = Array.isArray(r.trunk_ids) ? r.trunk_ids.map(String) : [];
    const dialMultiplier = r.dial_multiplier !== null && r.dial_multiplier !== undefined ? Number(r.dial_multiplier) : 1;
    const snap = await loadWorkspaceTrunkSnapshot(getPool(), a.workspaceId);
    const qRes = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: trunkIds, dialMultiplier });

    const cfg = r.config as StrategyConfig;
    const cal = r.calendar_windows
      ? { timezone: r.calendar_timezone, windows: r.calendar_windows, holidayPolicy: r.calendar_holiday_policy }
      : cfg.calendar;

    let waitingReason = qRes.waitingReason;
    if (r.status === 'PAUSED') waitingReason = 'PAUSED';
    else if (r.global_suspension) waitingReason = 'GLOBAL_SUSPENSION';
    else if (r.active_enrollments > 0 && !inCalendar(cal, new Date())) waitingReason = 'OUTSIDE_CALENDAR';
    else if (!snap.gatewayConfigured) waitingReason = 'NO_ELIGIBLE_TRUNKS';

    return {
      campaignId: r.id,
      trunkIds,
      dialMultiplier,
      loadedTotal: Number(r.members ?? 0),
      activeDialing: Number(r.active_attempts ?? 0),
      queuedWaitingTrunk: Number(r.active_enrollments ?? 0),
      completedOrSkipped: Number(r.finished ?? 0),
      availableTrunkSlots: qRes.availableTrunkSlots,
      totalTrunkChannels: qRes.totalTrunkChannels,
      effectiveQuota: qRes.effectiveQuota,
      waitingReason,
      canEditDialerConfig: isDialerManagerRole(a.role),
      trunks: qRes.eligibleTrunks,
    };
  });

  // ---------------------------------------------------------------- ciclo de vida
  const lifecycle = (
    path: string,
    from: CampaignStatus[],
    to: CampaignStatus,
    action: string,
    extra?: (c: any, id: string) => Promise<void>,
  ) =>
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(
      `/campaigns/:id/${path}`,
      { preHandler: requireRoles(...CAN.operate) },
      async (req) => {
        const a = actor(req);
        await tx(async (c) => {
          const cur = await one(c, `SELECT id, status FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
          if (!cur) throw notFound('Campanha');
          if (!from.includes(cur.status))
            throw conflict(`Não é possível ${action} uma campanha com status ${CAMPAIGN_STATUS_LABEL[cur.status as CampaignStatus]}`);
          const reason = (req.body as any)?.reason ?? null;
          if (path === 'close' && (!reason || String(reason).trim().length < 3))
            throw unprocessable('Informe o motivo do encerramento', { reason: 'Informe o motivo' });
          await c.query(
            `UPDATE campaigns SET status=$2::campaign_status,
                    started_at = CASE WHEN $2::text='RUNNING' THEN COALESCE(started_at, now()) ELSE started_at END,
                    finished_at = CASE WHEN $2::text IN ('CLOSED','COMPLETED') THEN now() ELSE finished_at END,
                    close_reason = CASE WHEN $2::text='CLOSED' THEN $3 ELSE close_reason END
              WHERE id=$1`,
            [cur.id, to, reason],
          );
          if (extra) await extra(c, cur.id);
          await audit(c, a, `campaign.${path}`, 'campaign', cur.id, { before: { status: cur.status }, after: { status: to }, reason });
        });
        return detail(await loadCampaignRow(getPool(), req.params.id, a.workspaceId));
      },
    );
  lifecycle('start', ['READY', 'SCHEDULED'], 'RUNNING', 'iniciar', async (c, id) => {
    await materializeEnrollments(c, id);
  });
  lifecycle('pause', ['RUNNING'], 'PAUSED', 'pausar');
  lifecycle('resume', ['PAUSED'], 'RUNNING', 'retomar');
  lifecycle('close', ['READY', 'SCHEDULED', 'RUNNING', 'PAUSED'], 'CLOSED', 'encerrar', async (c, id) => {
    await cancelUnsent(c, `campaign_id=$1`, [id], 'CAMPAIGN_CLOSED');
    await c.query(`UPDATE enrollments SET state='CANCELLED', terminal_reason='CAMPAIGN_CLOSED', updated_at=now() WHERE campaign_id=$1 AND state='ACTIVE'`, [id]);
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/campaigns/:id/archive',
    { preHandler: requireRoles(...CAN.operate) },
    async (req) => {
      const a = actor(req);
      await tx(async (c) => {
        const cur = await one(c, `SELECT id, status FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
        if (!cur) throw notFound('Campanha');
        if (cur.status === 'ARCHIVED') throw conflict('Campanha já está arquivada.');
        if (cur.status === 'RUNNING') throw conflict('Pause ou encerre a campanha antes de arquivá-la.');
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null;
        await c.query(
          `UPDATE campaigns
              SET previous_status = status,
                  status = 'ARCHIVED'::campaign_status,
                  archived_at = now(),
                  archived_reason = $2
            WHERE id=$1`,
          [cur.id, reason],
        );
        await audit(c, a, 'campaign.archive', 'campaign', cur.id, { before: { status: cur.status }, after: { status: 'ARCHIVED' }, reason });
      });
      return detail(await loadCampaignRow(getPool(), req.params.id, a.workspaceId));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/campaigns/:id/unarchive',
    { preHandler: requireRoles(...CAN.operate) },
    async (req) => {
      const a = actor(req);
      await tx(async (c) => {
        const cur = await one(
          c,
          `SELECT id, status, previous_status, finished_at FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
          [req.params.id, a.workspaceId],
        );
        if (!cur) throw notFound('Campanha');
        if (cur.status !== 'ARCHIVED') throw conflict('Esta campanha não está arquivada.');
        const restoredStatus: CampaignStatus = cur.previous_status || (cur.finished_at ? 'COMPLETED' : 'READY');
        await c.query(
          `UPDATE campaigns
              SET status = $2::campaign_status,
                  archived_at = NULL,
                  archived_reason = NULL,
                  previous_status = NULL
            WHERE id=$1`,
          [cur.id, restoredStatus],
        );
        await audit(c, a, 'campaign.unarchive', 'campaign', cur.id, { before: { status: 'ARCHIVED' }, after: { status: restoredStatus } });
      });
      return detail(await loadCampaignRow(getPool(), req.params.id, a.workspaceId));
    },
  );

  // ---------------------------------------------------------------- tentativas da campanha
  app.get<{ Params: { id: string }; Querystring: { state?: string; cursor?: string; limit?: string } }>(
    '/campaigns/:id/attempts',
    async (req) => {
      const a = actor(req);
      await loadCampaignRow(getPool(), req.params.id, a.workspaceId);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const offset = Math.max(0, Number(req.query.cursor ?? 0) || 0);
      const rows = await q(
        getPool(),
        `SELECT ${ATTEMPT_SELECT} FROM ${ATTEMPT_FROM}
          WHERE a.campaign_id=$1 AND ($2::text IS NULL OR a.state::text=$2) 
          ORDER BY a.created_at DESC, a.id DESC OFFSET $3 LIMIT $4`,
        [req.params.id, req.query.state ?? null, offset, limit + 1],
      );
      const [{ total }] = await q(
        getPool(),
        `SELECT count(*)::int AS total FROM attempts a WHERE a.campaign_id=$1 AND ($2::text IS NULL OR a.state::text=$2)`,
        [req.params.id, req.query.state ?? null],
      );
      const page = rows.slice(0, limit);
      return {
        items: page.map(attemptRow),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
        total,
      };
    },
  );

  // ---------------------------------------------------------------- elegibilidade (§4.1, T07)
  // Janela máxima avaliada em memória por requisição para proteger contra OOM em campanhas com milhões de inscritos
  const MAX_ELIGIBILITY_EVAL_WINDOW = 5000;
  app.get<{ Params: { id: string }; Querystring: { reason?: string; cursor?: string; limit?: string } }>(
    '/campaigns/:id/eligibility',
    async (req) => {
      const a = actor(req);
      await loadCampaignRow(getPool(), req.params.id, a.workspaceId);
      const rt = (await loadCampaignRuntime(getPool(), req.params.id))!;
      const now = new Date(); // mesmo instante lógico para cartões, motivos e linhas
      const [enrStats] = await q(
        getPool(),
        `SELECT count(*)::int AS total_members,
                count(*) FILTER (WHERE state <> 'ACTIVE')::int AS total_finished
           FROM enrollments WHERE campaign_id=$1`,
        [rt.id],
      );
      const enr = await q(
        getPool(),
        `SELECT id, contact_id, state, stage, destination_cursor, next_eligible_at, order_key
           FROM enrollments WHERE campaign_id=$1 ORDER BY order_key LIMIT $2`,
        [rt.id, MAX_ELIGIBILITY_EVAL_WINDOW],
      );
      const ctxs = await buildContexts(getPool(), rt, enr, now);
      const evals = enr.map((e) => {
        const ctx = ctxs.get(e.id)!;
        const ev = evaluateEnrollment(ctx);
        return { e, ctx, ev };
      });
      const [att] = await q(
        getPool(),
        `SELECT count(*) FILTER (WHERE state='RESERVED')::int AS reserved,
                count(*) FILTER (WHERE state IN ('SENT','AWAITING_FEEDBACK'))::int AS pending,
                count(*) FILTER (WHERE state='RECONCILIATION')::int AS reconciliation
           FROM attempts WHERE campaign_id=$1`,
        [rt.id],
      );
      const reasonCounts: Record<string, number> = {};
      for (const x of evals) if (x.ev.primaryReason) reasonCounts[x.ev.primaryReason] = (reasonCounts[x.ev.primaryReason] ?? 0) + 1;
      const filterReason = req.query.reason && (REASON_CODES as readonly string[]).includes(req.query.reason) ? (req.query.reason as ReasonCode) : null;
      const eligibleFilter = req.query.reason === 'ELIGIBLE';
      const filtered = evals.filter((x) => (eligibleFilter ? x.ev.eligible : filterReason ? x.ev.reasons.includes(filterReason) : true));
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const offset = Math.max(0, Number(req.query.cursor ?? 0) || 0);
      const page = filtered.slice(offset, offset + limit);
      return {
        evaluatedAt: now.toISOString(),
        cards: {
          members: enrStats?.total_members ?? enr.length,
          eligibleNow: evals.filter((x) => x.ev.eligible).length,
          reserved: att.reserved,
          pending: att.pending,
          reconciliation: att.reconciliation,
          finished: enrStats?.total_finished ?? enr.filter((e) => e.state !== 'ACTIVE').length,
        },
        reasons: Object.entries(reasonCounts)
          .map(([reason, count]) => ({ reason, count }))
          .sort((x, y) => y.count - x.count),
        items: page.map(({ e, ctx, ev }) => ({
          enrollmentId: e.id,
          contact: { id: e.contact_id, externalId: ctx.contact.externalId, name: ctx.contactName },
          enrollmentState: e.state,
          stage: e.stage,
          channelType: ev.step?.channelType ?? null,
          destinationMasked: ev.destination ? maskAddress(ev.destination.address) : null,
          eligible: ev.eligible,
          primaryReason: ev.primaryReason,
          reasons: ev.reasons,
          counters: ev.counters,
          nextEligibleAt: e.state === 'ACTIVE' ? e.next_eligible_at : null,
          strategyVersion: rt.strategyVersion,
        })),
        nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
        total: filtered.length,
      };
    },
  );

  // ---------------------------------------------------------------- indicadores (§8)
  app.get<{ Params: { id: string } }>('/campaigns/:id/indicators', async (req) => {
    const a = actor(req);
    await loadCampaignRow(getPool(), req.params.id, a.workspaceId);
    const ind = await campaignIndicators(getPool(), req.params.id);
    if (isSuperAdminRole(a.role)) return ind;
    return {
      ...ind,
      viewMode: 'CLIENT_TIME_ONLY',
      cost: { known: null, coverage: ind.cost.coverage },
      costPerCpc: null,
      costPerConversion: null,
    };
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id/indicators.csv', async (req, reply) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const row = await loadCampaignRow(getPool(), req.params.id, a.workspaceId);
    const ind = await campaignIndicators(getPool(), req.params.id);
    const extractedAt = new Date().toISOString();
    const lines: unknown[][] = [
      ['campanha', row.name],
      ['estrategia', `${row.strategy_name} v${row.strategy_version}`],
      ['extraido_em_utc', extractedAt],
      ['tentativas_enviadas', ind.sent],
      ['clientes_trabalhados', ind.contactsWorked],
      ['clientes_cpc', ind.cpcContacts],
      ['taxa_cpc', ind.cpcRate === null ? 'ausente' : ind.cpcRate.toFixed(4)],
      ['conversoes', ind.conversions],
      ...(isSuper
        ? [
            ['custo_conhecido_brl', ind.cost.known.toFixed(4)],
            ['cobertura_custo', `${ind.cost.coverage.withCost}/${ind.cost.coverage.total}`],
            ['custo_por_cpc_brl', ind.costPerCpc === null ? 'ausente' : ind.costPerCpc.toFixed(4)],
            ['custo_por_conversao_brl', ind.costPerConversion === null ? 'ausente' : ind.costPerConversion.toFixed(4)],
          ]
        : []),
      ['pendentes_reservados', ind.pending.reserved],
      ['pendentes_enviados', ind.pending.sent],
      ['pendentes_aguardando_feedback', ind.pending.awaitingFeedback],
      ['pendentes_reconciliacao', ind.pending.reconciliation],
      ...ind.byTabulation.map((t: any) => [`tabulacao:${t.code}`, t.count]),
    ];
    await audit(getPool(), a, 'indicators.export', 'campaign', row.id, { after: { extractedAt } });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="indicadores-${row.id.slice(0, 8)}.csv"`);
    return toCsv(['indicador', 'valor'], lines);
  });

  // ---------------------------------------------------------------- modelos de campanha (templates)
  const readOnlyTemplatesError = () =>
    new HttpError(
      403,
      'Modo Somente Leitura',
      'Modelos de Campanha está bloqueado em modo somente leitura para esta operação.',
    );

  app.post<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/campaigns/:id/save-as-template',
    { preHandler: requireRoles(...CAN.operate) },
    async () => {
      throw readOnlyTemplatesError();
    },
  );

  app.get('/campaign-templates', async (req) => {
    const a = actor(req);
    const rows = await q(
      getPool(),
      `SELECT t.*, j.name AS journey_name, s.name AS strategy_name, sv.version AS strategy_version, cal.name AS calendar_name
         FROM campaign_templates t
         LEFT JOIN journeys j ON j.id = t.journey_id
         LEFT JOIN strategies s ON s.id = t.strategy_id
         LEFT JOIN strategy_versions sv ON sv.id = t.strategy_version_id
         LEFT JOIN calendars cal ON cal.id = t.calendar_id
        WHERE t.workspace_id = $1
        ORDER BY t.created_at DESC`,
      [a.workspaceId],
    );
    const items = rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      purposeCode: r.purpose_code,
      journeyId: r.journey_id,
      journeyName: r.journey_name ?? 'Jornada',
      journeyVersionId: r.journey_version_id,
      strategyId: r.strategy_id,
      strategyName: r.strategy_name ?? 'Estratégia',
      strategyVersionId: r.strategy_version_id,
      strategyVersion: r.strategy_version ?? 1,
      calendarId: r.calendar_id ?? null,
      calendarName: r.calendar_name ?? null,
      startMode: r.start_mode,
      sourceCampaignId: r.source_campaign_id,
      sourceCampaignName: r.source_campaign_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      usageCount: r.usage_count ?? 0,
    }));
    return { items };
  });

  app.get<{ Params: { id: string } }>('/campaign-templates/:id', async (req) => {
    const a = actor(req);
    const r = await one(
      getPool(),
      `SELECT t.*, j.name AS journey_name, s.name AS strategy_name, sv.version AS strategy_version, cal.name AS calendar_name
         FROM campaign_templates t
         LEFT JOIN journeys j ON j.id = t.journey_id
         LEFT JOIN strategies s ON s.id = t.strategy_id
         LEFT JOIN strategy_versions sv ON sv.id = t.strategy_version_id
         LEFT JOIN calendars cal ON cal.id = t.calendar_id
        WHERE t.workspace_id = $1 AND t.id = $2`,
      [a.workspaceId, req.params.id],
    );
    if (!r) throw notFound('Modelo de campanha não encontrado');
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      purposeCode: r.purpose_code,
      journeyId: r.journey_id,
      journeyName: r.journey_name ?? 'Jornada',
      journeyVersionId: r.journey_version_id,
      strategyId: r.strategy_id,
      strategyName: r.strategy_name ?? 'Estratégia',
      strategyVersionId: r.strategy_version_id,
      strategyVersion: r.strategy_version ?? 1,
      calendarId: r.calendar_id ?? null,
      calendarName: r.calendar_name ?? null,
      startMode: r.start_mode,
      sourceCampaignId: r.source_campaign_id,
      sourceCampaignName: r.source_campaign_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      usageCount: r.usage_count ?? 0,
    };
  });

  app.post('/campaign-templates', { preHandler: requireRoles(...CAN.manageData) }, async () => {
    throw readOnlyTemplatesError();
  });

  app.put<{ Params: { id: string } }>('/campaign-templates/:id', { preHandler: requireRoles(...CAN.manageData) }, async () => {
    throw readOnlyTemplatesError();
  });

  app.delete<{ Params: { id: string } }>('/campaign-templates/:id', { preHandler: requireRoles(...CAN.manageData) }, async () => {
    throw readOnlyTemplatesError();
  });
}
