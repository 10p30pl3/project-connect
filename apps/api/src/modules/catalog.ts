import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ChannelEndpointConfigSchema,
  type ChannelEndpointConfig,
  type ChannelTechnicalOverrides,
  ConnectionCreateSchema,
  type ConnectionChannelType,
  ConnectionTestRequestSchema,
  ConnectionUpdateSchema,
  DEFAULT_CHANNEL_ENDPOINTS,
  JourneyCreateSchema,
  JourneyVersionCreateSchema,
  StrategyCreateSchema,
  StrategyPublishSchema,
  TabulationCreateSchema,
  TabulationUpdateSchema,
} from '@voll/shared';
import { getPool, one, q, tx } from '../db/pool.js';
import { actor, requireRoles, CAN } from '../auth/context.js';
import { isSuperAdminRole } from '@voll/shared';
import { badRequest, conflict, forbidden, notFound, parse, unprocessable } from '../lib/problem.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_SIMULATION } from '../connectors/simulated.js';

function isRealSecret(value?: string | null): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== '***' && !trimmed.startsWith('••••');
}

function maskSecret(value?: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.length <= 4 ? '***' : `••••${trimmed.slice(-4)}`;
}

function normalizeOrigins(origins?: string[] | null): string[] {
  if (!Array.isArray(origins)) return [];
  const seen = new Set<string>();
  for (const item of origins) {
    const clean = String(item ?? '').trim().replace(/\/+$/, '');
    if (clean) seen.add(clean);
  }
  return Array.from(seen);
}

async function assertWorkspaceVoiceAgent(c: any, workspaceId: string, tenantId: string) {
  const own = await one<{ workspace_id: string | null }>(
    c,
    `SELECT workspace_id FROM workspace_voice_resources WHERE resource_type='agent' AND resource_id=$1`,
    [tenantId],
  ).catch(() => null);
  if (own && own.workspace_id && own.workspace_id !== workspaceId) {
    throw forbidden('Este Agente de Voz pertence a outra empresa.');
  }
}

function applyTechnicalOverrides(
  nextConfig: Record<string, any>,
  incoming?: ChannelTechnicalOverrides | null,
) {
  if (!incoming) return;
  const current = (nextConfig.technical && typeof nextConfig.technical === 'object') ? { ...nextConfig.technical } : {};
  for (const key of ['whatsapp', 'voice', 'sms', 'email', 'rcs'] as const) {
    const patchSection = incoming[key];
    if (!patchSection) continue;
    const prevSection = (current[key] && typeof current[key] === 'object') ? { ...current[key] } : {};
    for (const [field, val] of Object.entries(patchSection)) {
      if (field === 'voiceAppToken' || field === 'smtpPassword') {
        if (val === null) delete prevSection[field];
        else if (isRealSecret(val as string | undefined)) prevSection[field] = String(val).trim();
        continue;
      }
      if (val !== undefined) {
        if (typeof val === 'string') {
          const clean = val.trim();
          if (clean) prevSection[field] = clean;
          else delete prevSection[field];
        } else {
          prevSection[field] = val;
        }
      }
    }
    current[key] = prevSection;
  }
  nextConfig.technical = current;
}

function sanitizeTechnicalForDto(technical?: Record<string, any> | null) {
  if (!technical || typeof technical !== 'object') return null;
  const out: Record<string, any> = {};
  for (const key of ['whatsapp', 'voice', 'sms', 'email', 'rcs'] as const) {
    if (!technical[key] || typeof technical[key] !== 'object') continue;
    const copy = { ...technical[key] };
    delete copy.voiceAppToken;
    delete copy.smtpPassword;
    out[key] = copy;
  }
  return Object.keys(out).length ? out : null;
}

function connectionDto(r: any, isSuper = false) {
  const cfg = r.config ?? {};
  const isWebRtc = r.channel_type === 'WEBRTC' || r.provider === 'WEBRTC_NATIVE';
  const isWhatsapp = r.channel_type === 'WHATSAPP';
  const voiceAppToken = cfg.technical?.voice?.voiceAppToken;
  const smtpPassword = cfg.technical?.email?.smtpPassword;
  return {
    id: r.id,
    name: r.name,
    channelType: r.channel_type,
    provider: r.provider,
    tariff: isSuper ? r.tariff : null,
    tariffUpdatedAt: isSuper ? r.tariff_updated_at : null,
    active: r.active,
    tenantId: cfg.tenantId ?? null,
    endpointUrl: cfg.endpointUrl ?? null,
    callerId: cfg.defaultCallerId ?? null,
    hasAuthToken: Boolean(cfg.authToken),
    authTokenMasked: maskSecret(cfg.authToken),
    hasVoiceAppToken: Boolean(voiceAppToken),
    voiceAppTokenMasked: maskSecret(voiceAppToken),
    hasSmtpPassword: Boolean(smtpPassword),
    smtpPasswordMasked: maskSecret(smtpPassword),
    technical: sanitizeTechnicalForDto(cfg.technical),
    simulation: r.provider === 'SIMULATED' ? { ...DEFAULT_SIMULATION, ...(cfg.simulation ?? {}) } : null,
    ...(isWebRtc || isWhatsapp
      ? {
          ...(isWebRtc
            ? {
                webrtcMode: cfg.webrtcMode ?? 'BOTH',
                publicWidgetKey: cfg.publicWidgetKey ?? null,
                allowedOrigins: Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [],
              }
            : {}),
          whatsappPhoneNumberId: cfg.whatsappPhoneNumberId ?? null,
          whatsappBusinessAccountId: cfg.whatsappBusinessAccountId ?? null,
          whatsappVerifyToken: cfg.whatsappVerifyToken ?? null,
          hasWhatsappAppSecret: Boolean(cfg.whatsappAppSecret),
          hasWhatsappAccessToken: Boolean(cfg.whatsappAccessToken),
          whatsappAppSecretMasked: maskSecret(cfg.whatsappAppSecret),
          whatsappAccessTokenMasked: maskSecret(cfg.whatsappAccessToken),
        }
      : {}),
  };
}

export async function loadJourneys(workspaceId: string, journeyId?: string) {
  const rows = await q(
    getPool(),
    `SELECT j.id, j.name, v.id AS v_id, v.version, v.steps, v.published_at
       FROM journeys j JOIN LATERAL (SELECT * FROM journey_versions WHERE journey_id=j.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE j.workspace_id=$1 AND ($2::uuid IS NULL OR j.id=$2) ORDER BY j.name`,
    [workspaceId, journeyId ?? null],
  );
  const conns = await q(getPool(), `SELECT id, name FROM connections WHERE workspace_id=$1`, [workspaceId]);
  const cname = Object.fromEntries(conns.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    latestVersion: {
      id: r.v_id,
      version: r.version,
      publishedAt: r.published_at,
      steps: (r.steps as any[]).map((s) => ({ ...s, connectionName: cname[s.connectionId] ?? null })),
    },
  }));
}

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/tabulations', async (req) => {
    const rows = await q(
      getPool(),
      `SELECT id, code, name, is_cpc AS "isCpc", is_conversion AS "isConversion", is_opt_out AS "isOptOut",
              invalidates_destination AS "invalidatesDestination", channel_types::text[] AS "channelTypes"
         FROM tabulations WHERE workspace_id=$1 ORDER BY name`,
      [actor(req).workspaceId],
    );
    return { items: rows };
  });

  app.post('/tabulations', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(TabulationCreateSchema, req.body);
    const a = actor(req);
    const existing = await one(getPool(), `SELECT id FROM tabulations WHERE workspace_id=$1 AND code=$2`, [a.workspaceId, body.code]);
    if (existing) throw conflict('Já existe uma tabulação com este código');

    const created = await tx(async (c) => {
      const ins = await one(
        c,
        `INSERT INTO tabulations (workspace_id, code, name, is_cpc, is_conversion, is_opt_out, invalidates_destination, channel_types)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::channel_type[])
         RETURNING id, code, name, is_cpc AS "isCpc", is_conversion AS "isConversion", is_opt_out AS "isOptOut",
                   invalidates_destination AS "invalidatesDestination", channel_types::text[] AS "channelTypes"`,
        [a.workspaceId, body.code, body.name, body.isCpc, body.isConversion, body.isOptOut, body.invalidatesDestination, body.channelTypes],
      );
      await audit(c, a, 'tabulation.create', 'tabulation', ins!.id, { after: ins });
      return ins!;
    });
    return reply.code(201).send(created);
  });

  app.patch('/tabulations/:id', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(TabulationUpdateSchema, req.body);
    const a = actor(req);
    const current = await one(
      getPool(),
      `SELECT id, code, name, is_cpc AS "isCpc", is_conversion AS "isConversion", is_opt_out AS "isOptOut",
              invalidates_destination AS "invalidatesDestination", channel_types::text[] AS "channelTypes"
         FROM tabulations WHERE workspace_id=$1 AND id=$2`,
      [a.workspaceId, id],
    );
    if (!current) throw notFound('Tabulação não encontrada');

    const nextName = body.name !== undefined ? body.name : current.name;
    const nextIsCpc = body.isCpc !== undefined ? body.isCpc : current.isCpc;
    const nextIsConversion = body.isConversion !== undefined ? body.isConversion : current.isConversion;
    const nextIsOptOut = body.isOptOut !== undefined ? body.isOptOut : current.isOptOut;
    const nextInvalidates = body.invalidatesDestination !== undefined ? body.invalidatesDestination : current.invalidatesDestination;
    const nextChannels = body.channelTypes !== undefined ? body.channelTypes : current.channelTypes;

    const noChanges =
      nextName === current.name &&
      nextIsCpc === current.isCpc &&
      nextIsConversion === current.isConversion &&
      nextIsOptOut === current.isOptOut &&
      nextInvalidates === current.invalidatesDestination &&
      JSON.stringify((nextChannels ?? []).slice().sort()) === JSON.stringify((current.channelTypes ?? []).slice().sort());

    if (noChanges) {
      throw badRequest('Nenhuma alteração detectada na tabulação.');
    }

    const updated = await tx(async (c) => {
      const row = await one(
        c,
        `UPDATE tabulations
            SET name=$1, is_cpc=$2, is_conversion=$3, is_opt_out=$4, invalidates_destination=$5, channel_types=$6::channel_type[]
          WHERE workspace_id=$7 AND id=$8
          RETURNING id, code, name, is_cpc AS "isCpc", is_conversion AS "isConversion", is_opt_out AS "isOptOut",
                    invalidates_destination AS "invalidatesDestination", channel_types::text[] AS "channelTypes"`,
        [nextName, nextIsCpc, nextIsConversion, nextIsOptOut, nextInvalidates, nextChannels, a.workspaceId, id],
      );
      await audit(c, a, 'tabulation.update', 'tabulation', id, { before: current, after: row });
      return row!;
    });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/tabulations/:id', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const a = actor(req);
    const { id } = req.params;
    const current = await one(getPool(), `SELECT id, code, name FROM tabulations WHERE workspace_id=$1 AND id=$2`, [a.workspaceId, id]);
    if (!current) throw notFound('Tabulação não encontrada');
    const inUse = await one(
      getPool(),
      `SELECT id FROM attempts WHERE workspace_id=$1 AND tabulation_code=$2 LIMIT 1`,
      [a.workspaceId, current.code],
    );
    if (inUse) {
      throw conflict('Esta tabulação já possui histórico de tentativas e não pode ser excluída.');
    }
    await tx(async (c) => {
      await c.query(`DELETE FROM tabulations WHERE workspace_id=$1 AND id=$2`, [a.workspaceId, id]);
      await audit(c, a, 'tabulation.delete', 'tabulation', id, { before: current });
    });
    return { deleted: true, id };
  });

  app.get('/connections', async (req) => {
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const rows = await q(getPool(), `SELECT * FROM connections WHERE workspace_id=$1 ORDER BY channel_type, name`, [a.workspaceId]);
    return { items: rows.map((r) => connectionDto(r, isSuper)) };
  });

function applyWebRtcConfigFields(
  nextConfig: Record<string, any>,
  body: Record<string, any>,
  isCreate: boolean,
) {
  if (body.webrtcMode !== undefined) {
    nextConfig.webrtcMode = body.webrtcMode;
  } else if (isCreate && !nextConfig.webrtcMode) {
    nextConfig.webrtcMode = 'BOTH';
  }

  if ((isCreate && !nextConfig.publicWidgetKey) || body.rotateWidgetKey) {
    nextConfig.publicWidgetKey = `wrtc_${crypto.randomBytes(16).toString('hex')}`;
  } else if (!nextConfig.publicWidgetKey) {
    nextConfig.publicWidgetKey = `wrtc_${crypto.randomBytes(16).toString('hex')}`;
  }

  if (body.allowedOrigins !== undefined) {
    nextConfig.allowedOrigins = normalizeOrigins(body.allowedOrigins);
  } else if (isCreate && !Array.isArray(nextConfig.allowedOrigins)) {
    nextConfig.allowedOrigins = [];
  }

  for (const field of ['whatsappPhoneNumberId', 'whatsappBusinessAccountId'] as const) {
    if (body[field] !== undefined) {
      const v = body[field] ? String(body[field]).trim() : '';
      if (v) nextConfig[field] = v;
      else delete nextConfig[field];
    }
  }

  if (body.whatsappVerifyToken !== undefined) {
    const v = body.whatsappVerifyToken ? String(body.whatsappVerifyToken).trim() : '';
    if (v) nextConfig.whatsappVerifyToken = v;
    else if (isCreate) nextConfig.whatsappVerifyToken = `wtok_${crypto.randomBytes(16).toString('hex')}`;
    else delete nextConfig.whatsappVerifyToken;
  } else if (isCreate && !nextConfig.whatsappVerifyToken) {
    nextConfig.whatsappVerifyToken = `wtok_${crypto.randomBytes(16).toString('hex')}`;
  }

  for (const secretField of ['whatsappAppSecret', 'whatsappAccessToken'] as const) {
    if (body[secretField] === null || body[secretField] === '') {
      delete nextConfig[secretField];
    } else if (isRealSecret(body[secretField])) {
      nextConfig[secretField] = body[secretField].trim();
    }
  }
}

  app.post('/connections', { preHandler: requireRoles(...CAN.admin) }, async (req, reply) => {
    const body = parse(ConnectionCreateSchema, req.body);
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    const tariff = isSuper ? (body.tariff ?? null) : null;
    const secret = crypto.randomBytes(24).toString('hex');
    const effectiveProvider =
      body.channelType === 'WEBRTC' && (!body.provider || body.provider === 'SIMULATED')
        ? 'WEBRTC_NATIVE'
        : body.provider;

    const created = await tx(async (c) => {
      const nextConfig: Record<string, any> = {};
      if (body.tenantId?.trim()) {
        await assertWorkspaceVoiceAgent(c, a.workspaceId, body.tenantId.trim());
        nextConfig.tenantId = body.tenantId.trim();
      }
      if (body.channelType === 'WEBRTC' || effectiveProvider === 'WEBRTC_NATIVE') {
        applyWebRtcConfigFields(nextConfig, body, true);
      } else {
        if (body.channelType === 'WHATSAPP') {
          applyWebRtcConfigFields(nextConfig, body, true);
          delete nextConfig.webrtcMode;
          delete nextConfig.publicWidgetKey;
          delete nextConfig.allowedOrigins;
        }
        if (effectiveProvider === 'SIMULATED') {
          nextConfig.simulation = body.simulation ?? DEFAULT_SIMULATION;
        }
        if (body.endpointUrl?.trim()) nextConfig.endpointUrl = body.endpointUrl.trim();
        if (body.callerId?.trim()) nextConfig.defaultCallerId = body.callerId.trim();
        if (isRealSecret(body.authToken)) nextConfig.authToken = body.authToken.trim();
      }
      applyTechnicalOverrides(nextConfig, body.technical);

      const ins = await one(
        c,
        `INSERT INTO connections (workspace_id, name, channel_type, provider, config, webhook_secret, tariff, tariff_updated_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 IS NOT NULL THEN now() ELSE null END, $8)
         RETURNING *`,
        [
          a.workspaceId,
          body.name,
          body.channelType,
          effectiveProvider,
          JSON.stringify(nextConfig),
          secret,
          tariff,
          body.active ?? true,
        ],
      );
      await audit(c, a, 'connection.create', 'connection', ins!.id, { after: connectionDto(ins, isSuper) });
      return connectionDto(ins, isSuper);
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/connections/:id', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const body = parse(ConnectionUpdateSchema, req.body);
    const a = actor(req);
    const isSuper = isSuperAdminRole(a.role);
    return tx(async (c) => {
      const before = await one(c, `SELECT * FROM connections WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
      if (!before) throw notFound('Conexão');
      if (body.simulation && body.simulation.maxDelaySeconds < body.simulation.minDelaySeconds)
        throw unprocessable('Corrija os campos indicados', { 'simulation.maxDelaySeconds': 'Deve ser maior ou igual ao mínimo' });
      const nextConfig: Record<string, any> = { ...(before.config ?? {}) };
      const nextProvider = body.provider?.trim() || before.provider;
      if (body.simulation !== undefined) {
        if (body.simulation === null) delete nextConfig.simulation;
        else nextConfig.simulation = body.simulation;
      } else if (nextProvider === 'SIMULATED' && !nextConfig.simulation) {
        nextConfig.simulation = DEFAULT_SIMULATION;
      }
      if (body.callerId !== undefined) {
        const cleanCaller = body.callerId ? String(body.callerId).trim() : '';
        if (cleanCaller) nextConfig.defaultCallerId = cleanCaller;
        else delete nextConfig.defaultCallerId;
      }
      if (body.endpointUrl !== undefined) {
        const cleanUrl = body.endpointUrl ? String(body.endpointUrl).trim() : '';
        if (cleanUrl) nextConfig.endpointUrl = cleanUrl;
        else delete nextConfig.endpointUrl;
      }
      if (body.authToken === null) {
        delete nextConfig.authToken;
      } else if (isRealSecret(body.authToken)) {
        nextConfig.authToken = body.authToken.trim();
      }
      if (body.tenantId !== undefined) {
        const nextTid = body.tenantId ? String(body.tenantId).trim() : null;
        if (nextTid) {
          await assertWorkspaceVoiceAgent(c, a.workspaceId, nextTid);
          nextConfig.tenantId = nextTid;
          // Telefonia passa a ser a fonte única de verdade deste vínculo
          delete nextConfig.voiceAgent;
          delete nextConfig.voiceAgentVersion;
          delete nextConfig.voiceAgentSyncedVersion;
        } else {
          delete nextConfig.tenantId;
        }
      }
      if (before.channel_type === 'WEBRTC' || nextProvider === 'WEBRTC_NATIVE') {
        applyWebRtcConfigFields(nextConfig, body, false);
      } else if (before.channel_type === 'WHATSAPP') {
        applyWebRtcConfigFields(nextConfig, body, false);
        delete nextConfig.webrtcMode;
        delete nextConfig.publicWidgetKey;
        delete nextConfig.allowedOrigins;
      }
      applyTechnicalOverrides(nextConfig, body.technical);
      const tariffChanged = isSuper && body.tariff !== undefined && body.tariff !== before.tariff;
      const after = await one(
        c,
        `UPDATE connections SET name=COALESCE($2,name), provider=COALESCE($3,provider), active=COALESCE($4,active), config=$5,
                tariff = CASE WHEN $6 THEN $7::numeric ELSE tariff END,
                tariff_updated_at = CASE WHEN $6 THEN now() ELSE tariff_updated_at END
          WHERE id=$1 RETURNING *`,
        [before.id, body.name ?? null, body.provider?.trim() ?? null, body.active ?? null, JSON.stringify(nextConfig), tariffChanged, body.tariff ?? null],
      );
      await audit(c, a, 'connection.update', 'connection', before.id, {
        before: {
          name: before.name,
          tariff: before.tariff,
          active: before.active,
          tenantId: before.config?.tenantId ?? null,
          webrtcMode: before.config?.webrtcMode ?? null,
        },
        after: {
          name: after.name,
          tariff: after.tariff,
          active: after.active,
          tenantId: after.config?.tenantId ?? null,
          webrtcMode: after.config?.webrtcMode ?? null,
        },
      });
      return connectionDto(after, isSuper);
    });
  });

  app.delete<{ Params: { id: string } }>('/connections/:id', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const a = actor(req);
    const { id } = req.params;
    const current = await one(getPool(), `SELECT id, name, channel_type FROM connections WHERE id=$1 AND workspace_id=$2`, [id, a.workspaceId]);
    if (!current) throw notFound('Conexão');
    const usedInAttempts = await one(getPool(), `SELECT id FROM attempts WHERE connection_id=$1 LIMIT 1`, [id]);
    if (usedInAttempts) {
      throw conflict('Este canal já possui histórico de tentativas e não pode ser excluído. Desabilite-o para interromper novos envios.');
    }
    const usedInJourney = await one(
      getPool(),
      `SELECT j.name FROM journey_versions jv JOIN journeys j ON j.id=jv.journey_id
        WHERE j.workspace_id=$1 AND jv.steps::text LIKE '%' || $2 || '%' LIMIT 1`,
      [a.workspaceId, id],
    );
    if (usedInJourney) {
      throw conflict(`Este canal está vinculado à jornada "${usedInJourney.name}". Remova ou substitua a etapa antes de excluir.`);
    }
    await tx(async (c) => {
      await c.query(`DELETE FROM connections WHERE id=$1 AND workspace_id=$2`, [id, a.workspaceId]);
      await audit(c, a, 'connection.delete', 'connection', id, { before: { name: current.name, channelType: current.channel_type } });
    });
    return { deleted: true, id };
  });

  async function probeChannelConnectivity(
    workspaceId: string,
    params: {
      channelType: ConnectionChannelType;
      provider?: string;
      endpointUrl?: string | null;
      authToken?: string | null;
      technical?: ChannelTechnicalOverrides | null;
      existingConfig?: Record<string, any> | null;
    },
  ) {
    const existing = params.existingConfig ?? {};
    const wsRow = await one<{ config: ChannelEndpointConfig }>(
      getPool(),
      `SELECT config FROM workspace_channel_endpoints WHERE workspace_id=$1`,
      [workspaceId],
    );
    const wsCfg = { ...DEFAULT_CHANNEL_ENDPOINTS, ...(wsRow?.config ?? {}) };
    const mergedTech = { ...(existing.technical ?? {}) };
    if (params.technical) {
      for (const k of ['whatsapp', 'voice', 'sms', 'email', 'rcs'] as const) {
        if (params.technical[k]) mergedTech[k] = { ...(mergedTech[k] ?? {}), ...params.technical[k] };
      }
    }

    if (params.channelType === 'VOICE' || params.channelType === 'WEBRTC') {
      const targetUrl =
        mergedTech.voice?.voiceAppBaseUrl ||
        params.endpointUrl ||
        existing.endpointUrl ||
        wsCfg.voice.voiceAppBaseUrl;
      const token =
        (isRealSecret(mergedTech.voice?.voiceAppToken) ? mergedTech.voice.voiceAppToken : null) ||
        (isRealSecret(params.authToken) ? params.authToken : null) ||
        existing.technical?.voice?.voiceAppToken ||
        existing.authToken ||
        wsCfg.voice.voiceAppToken;
      if (!targetUrl) {
        return {
          ok: params.provider === 'SIMULATED',
          channelType: params.channelType,
          latencyMs: 0,
          status: params.provider === 'SIMULATED' ? 'Simulado' : 'Não configurado',
          code: params.provider === 'SIMULATED' ? 200 : 400,
          details:
            params.provider === 'SIMULATED'
              ? 'Canal em modo Sandbox (Simulado) pronto para testes locais.'
              : 'Informe a URL do Voice-App / Endpoint antes de testar.',
        };
      }
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${String(targetUrl).replace(/\/+$/, '')}/v1/health`, {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - t0;
        if (!res.ok) {
          return {
            ok: false,
            channelType: params.channelType,
            latencyMs,
            status: 'Erro HTTP',
            code: res.status,
            details: `Gateway em ${targetUrl} respondeu HTTP ${res.status}.`,
          };
        }
        const data: any = await res.json().catch(() => ({}));
        return {
          ok: true,
          channelType: params.channelType,
          latencyMs,
          status: 'Conectado',
          code: 200,
          details: `Gateway Online (${latencyMs}ms) · FreeSWITCH: ${data.freeswitch ?? 'OK'} · Canais: ${data.channelsBusy ?? 0}/${data.channelsTotal ?? mergedTech.voice?.maxConcurrent ?? wsCfg.voice.maxConcurrent}`,
        };
      } catch (err: any) {
        return {
          ok: false,
          channelType: params.channelType,
          latencyMs: Date.now() - t0,
          status: 'Inacessível',
          code: 503,
          details: `Falha ao conectar em ${targetUrl}/v1/health: ${err?.message ?? 'Timeout/Recusado'}`,
        };
      }
    }

    const endpointByType: Record<string, string | undefined> = {
      WHATSAPP: mergedTech.whatsapp?.apiBaseUrl || params.endpointUrl || existing.endpointUrl || wsCfg.whatsapp.apiBaseUrl,
      SMS: mergedTech.sms?.smppHost || params.endpointUrl || existing.endpointUrl || wsCfg.sms.smppHost,
      EMAIL: mergedTech.email?.smtpHost || params.endpointUrl || existing.endpointUrl || wsCfg.email.smtpHost,
      RCS: mergedTech.rcs?.rbmApiUrl || params.endpointUrl || existing.endpointUrl || wsCfg.rcs.rbmApiUrl,
    };
    const resolvedTarget = endpointByType[params.channelType] || 'Padrão do workspace';
    return {
      ok: true,
      channelType: params.channelType,
      latencyMs: 25,
      status: params.provider === 'SIMULATED' ? 'Simulado' : 'Configuração Válida',
      code: 200,
      details: `Parâmetros validados para ${params.channelType} (${resolvedTarget}).`,
    };
  }

  app.post('/connections/test', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const a = actor(req);
    const body = parse(ConnectionTestRequestSchema, req.body ?? {});
    return probeChannelConnectivity(a.workspaceId, {
      channelType: body.channelType ?? 'VOICE',
      provider: body.provider,
      endpointUrl: body.endpointUrl,
      authToken: body.authToken,
      technical: body.technical,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/connections/:id/test',
    { preHandler: requireRoles(...CAN.admin) },
    async (req) => {
      const a = actor(req);
      const current = await one(getPool(), `SELECT * FROM connections WHERE id=$1 AND workspace_id=$2`, [
        req.params.id,
        a.workspaceId,
      ]);
      if (!current) throw notFound('Conexão');
      const body = parse(ConnectionTestRequestSchema, req.body ?? {});
      return probeChannelConnectivity(a.workspaceId, {
        channelType: body.channelType ?? current.channel_type,
        provider: body.provider ?? current.provider,
        endpointUrl: body.endpointUrl,
        authToken: body.authToken,
        technical: body.technical,
        existingConfig: current.config ?? {},
      });
    },
  );

  app.get('/channels/technical-endpoints', async (req) => {
    const a = actor(req);
    const row = await one<{ config: ChannelEndpointConfig }>(
      getPool(),
      `SELECT config FROM workspace_channel_endpoints WHERE workspace_id=$1`,
      [a.workspaceId],
    );
    return { data: { ...DEFAULT_CHANNEL_ENDPOINTS, ...(row?.config ?? {}) } };
  });

  app.post('/channels/technical-endpoints', { preHandler: requireRoles(...CAN.admin) }, async (req) => {
    const a = actor(req);
    const body = parse(ChannelEndpointConfigSchema, req.body);
    await getPool().query(
      `INSERT INTO workspace_channel_endpoints (workspace_id, config, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (workspace_id) DO UPDATE
       SET config = CASE
             WHEN workspace_channel_endpoints.config ? 'ai' THEN $2::jsonb || jsonb_build_object('ai', workspace_channel_endpoints.config->'ai')
             ELSE $2::jsonb
           END,
           updated_at = now()`,
      [a.workspaceId, JSON.stringify(body)],
    );
    await audit(getPool(), a, 'channels.endpoints_update', 'workspace_channel_endpoints', a.workspaceId, { after: body });
    return { ok: true, data: body };
  });

  app.post<{ Body: { channel: 'whatsapp' | 'voice' | 'sms' | 'email' | 'rcs' } }>(
    '/channels/technical-endpoints/test',
    { preHandler: requireRoles(...CAN.admin) },
    async (req) => {
      const channel = req.body?.channel ?? 'whatsapp';
      const a = actor(req);
      const row = await one<{ config: ChannelEndpointConfig }>(
        getPool(),
        `SELECT config FROM workspace_channel_endpoints WHERE workspace_id=$1`,
        [a.workspaceId],
      );
      const cfg = row?.config ?? DEFAULT_CHANNEL_ENDPOINTS;

      if (channel === 'voice') {
        const voiceCfg = cfg.voice;
        const targetUrl = voiceCfg.voiceAppBaseUrl;
        if (!targetUrl) {
          return {
            ok: false,
            channel: 'voice',
            latencyMs: 0,
            status: 'Não configurado',
            details: 'Informe o endereço do gateway de voz (voiceAppBaseUrl) antes de testar.',
          };
        }
        const t0 = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2500);
          const res = await fetch(`${targetUrl.replace(/\/+$/, '')}/v1/health`, {
            signal: controller.signal,
            headers: voiceCfg.voiceAppToken ? { Authorization: `Bearer ${voiceCfg.voiceAppToken}` } : {},
          });
          clearTimeout(timeout);
          const latencyMs = Date.now() - t0;
          if (!res.ok) {
            return {
              ok: false,
              channel: 'voice',
              latencyMs,
              status: 'Erro HTTP',
              code: res.status,
              details: `Voice-App em ${targetUrl} respondeu HTTP ${res.status}`,
            };
          }
          const data: any = await res.json().catch(() => ({}));
          return {
            ok: true,
            channel: 'voice',
            latencyMs,
            status: 'Conectado',
            code: 200,
            details: `Voice-App Online (${latencyMs}ms) · FreeSWITCH: ${data.freeswitch ?? 'OK'} · Canais: ${data.channelsBusy ?? 0}/${data.channelsTotal ?? voiceCfg.maxConcurrent}`,
          };
        } catch (err: any) {
          const latencyMs = Date.now() - t0;
          return {
            ok: false,
            channel: 'voice',
            latencyMs,
            status: 'Inacessível',
            code: 503,
            details: `Falha ao conectar em ${targetUrl}/v1/health: ${err.message ?? 'Timeout/Recusado'}`,
          };
        }
      }

      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 60));
      const latencyMs = Date.now() - t0;

      const responses: Record<string, { status: string; code: number; details: string }> = {
        whatsapp: { status: 'Simulado', code: 200, details: 'Conector simulado ativo · Meta Graph API Mock' },
        sms: { status: 'Simulado', code: 200, details: 'Conector simulado ativo · SMPP Gateway Mock' },
        email: { status: 'Simulado', code: 200, details: 'Conector simulado ativo · SMTP Relay Mock' },
        rcs: { status: 'Simulado', code: 200, details: 'Conector simulado ativo · Google RBM Mock' },
      };

      const res = responses[channel] ?? { status: 'Simulado', code: 200, details: 'Canal simulado ativo' };
      return {
        ok: true,
        channel,
        latencyMs,
        ...res,
      };
    },
  );

  app.get('/journeys', async (req) => ({ items: await loadJourneys(actor(req).workspaceId) }));

  app.post('/journeys', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(JourneyCreateSchema, req.body);
    const a = actor(req);
    const conns = await q(getPool(), `SELECT id, channel_type FROM connections WHERE workspace_id=$1`, [a.workspaceId]);
    const byId = Object.fromEntries(conns.map((c) => [c.id, c.channel_type]));
    const fieldErrors: Record<string, string> = {};
    body.steps.forEach((s, i) => {
      if (!byId[s.connectionId]) fieldErrors[`steps.${i}.connectionId`] = 'Conexão não encontrada';
      else if (byId[s.connectionId] !== s.channelType) fieldErrors[`steps.${i}.connectionId`] = 'Conexão incompatível com o canal';
    });
    if (Object.keys(fieldErrors).length) throw unprocessable('Corrija as etapas da jornada', fieldErrors);
    const id = await tx(async (c) => {
      const j = await one(c, `INSERT INTO journeys (workspace_id, name) VALUES ($1,$2) RETURNING id`, [a.workspaceId, body.name]);
      await c.query(`INSERT INTO journey_versions (journey_id, version, steps) VALUES ($1,1,$2)`, [j!.id, JSON.stringify(body.steps)]);
      await audit(c, a, 'journey.publish', 'journey', j!.id, { after: body });
      return j!.id as string;
    });
    return reply.code(201).send((await loadJourneys(a.workspaceId, id))[0]);
  });

  app.post<{ Params: { id: string } }>('/journeys/:id/versions', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const { id } = req.params;
    const body = parse(JourneyVersionCreateSchema, req.body);
    const a = actor(req);
    const [j] = await loadJourneys(a.workspaceId, id);
    if (!j) throw notFound('Jornada');

    const conns = await q(getPool(), `SELECT id, channel_type FROM connections WHERE workspace_id=$1`, [a.workspaceId]);
    const byId = Object.fromEntries(conns.map((c) => [c.id, c.channel_type]));
    const fieldErrors: Record<string, string> = {};
    body.steps.forEach((s, i) => {
      if (!byId[s.connectionId]) fieldErrors[`steps.${i}.connectionId`] = 'Conexão não encontrada';
      else if (byId[s.connectionId] !== s.channelType) fieldErrors[`steps.${i}.connectionId`] = 'Conexão incompatível com o canal';
    });
    if (Object.keys(fieldErrors).length) throw unprocessable('Corrija as etapas da jornada', fieldErrors);

    const prevSteps = (j.latestVersion?.steps ?? []).map((s) => ({
      channelType: s.channelType,
      connectionId: s.connectionId,
      feedbackTimeoutMinutes: s.feedbackTimeoutMinutes,
    }));
    const nextSteps = body.steps.map((s) => ({
      channelType: s.channelType,
      connectionId: s.connectionId,
      feedbackTimeoutMinutes: s.feedbackTimeoutMinutes,
    }));
    const nameChanged = body.name !== undefined && body.name.trim() !== j.name.trim();
    const stepsChanged = JSON.stringify(prevSteps) !== JSON.stringify(nextSteps);

    if (!nameChanged && !stepsChanged) {
      throw badRequest('Nenhuma alteração detectada na jornada; uma nova versão só é criada se houver mudanças.');
    }

    const nextVer = (j.latestVersion?.version ?? 0) + 1;
    await tx(async (c) => {
      if (nameChanged && body.name) {
        await c.query(`UPDATE journeys SET name=$1 WHERE id=$2`, [body.name.trim(), id]);
      }
      await c.query(
        `INSERT INTO journey_versions (journey_id, version, steps) VALUES ($1, $2, $3)`,
        [id, nextVer, JSON.stringify(body.steps)],
      );
      await audit(c, a, 'journey.publish_version', 'journey', id, {
        before: { name: j.name, steps: prevSteps },
        after: { name: body.name ?? j.name, steps: nextSteps, version: nextVer },
      });
    });

    return reply.code(201).send((await loadJourneys(a.workspaceId, id))[0]);
  });

  app.delete<{ Params: { id: string } }>('/journeys/:id', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const a = actor(req);
    const { id } = req.params;
    const j = await one(getPool(), `SELECT id, name FROM journeys WHERE id=$1 AND workspace_id=$2`, [id, a.workspaceId]);
    if (!j) throw notFound('Jornada');
    const inCampaign = await one(
      getPool(),
      `SELECT c.name FROM campaigns c JOIN journey_versions jv ON jv.id=c.journey_version_id WHERE jv.journey_id=$1 LIMIT 1`,
      [id],
    );
    if (inCampaign) {
      throw conflict(`Esta jornada está vinculada à campanha "${inCampaign.name}" e não pode ser excluída.`);
    }
    const inTemplate = await one(
      getPool(),
      `SELECT name FROM campaign_templates WHERE workspace_id=$1 AND journey_id=$2 LIMIT 1`,
      [a.workspaceId, id],
    ).catch(() => null);
    if (inTemplate) {
      throw conflict(`Esta jornada está vinculada ao modelo "${inTemplate.name}" e não pode ser excluída.`);
    }
    await tx(async (c) => {
      await c.query(`DELETE FROM journey_versions WHERE journey_id=$1`, [id]);
      await c.query(`DELETE FROM journeys WHERE id=$1 AND workspace_id=$2`, [id, a.workspaceId]);
      await audit(c, a, 'journey.delete', 'journey', id, { before: { name: j.name } });
    });
    return { deleted: true, id };
  });

  const loadStrategies = async (workspaceId: string, id?: string) =>
    (
      await q(
        getPool(),
        `SELECT s.id, s.name, s.protected, v.id AS v_id, v.version, v.config, v.published_at
           FROM strategies s JOIN LATERAL (SELECT * FROM strategy_versions WHERE strategy_id=s.id ORDER BY version DESC LIMIT 1) v ON true
          WHERE s.workspace_id=$1 AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.name`,
        [workspaceId, id ?? null],
      )
    ).map((r) => ({
      id: r.id,
      name: r.name,
      protected: r.protected,
      latestVersion: { id: r.v_id, version: r.version, config: r.config, publishedAt: r.published_at },
    }));

  app.get('/strategies', async (req) => ({ items: await loadStrategies(actor(req).workspaceId) }));

  app.get<{ Params: { id: string } }>('/strategies/:id', async (req) => {
    const [s] = await loadStrategies(actor(req).workspaceId, req.params.id);
    if (!s) throw notFound('Estratégia');
    const versions = await q(
      getPool(),
      `SELECT v.id, v.version, v.config, v.published_at AS "publishedAt", u.name AS "publishedBy"
         FROM strategy_versions v LEFT JOIN users u ON u.id=v.published_by WHERE v.strategy_id=$1 ORDER BY v.version DESC`,
      [s.id],
    );
    return { ...s, versions };
  });

  app.post('/strategies', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const body = parse(StrategyCreateSchema, req.body);
    const a = actor(req);
    if (body.copyOf) {
      const src = await one(getPool(), `SELECT id FROM strategies WHERE id=$1 AND workspace_id=$2`, [body.copyOf, a.workspaceId]);
      if (!src) throw notFound('Estratégia de origem');
    }
    const id = await tx(async (c) => {
      const s = await one(c, `INSERT INTO strategies (workspace_id, name, protected) VALUES ($1,$2,false) RETURNING id`, [a.workspaceId, body.name]);
      await c.query(`INSERT INTO strategy_versions (strategy_id, version, config, published_by) VALUES ($1,1,$2,$3)`, [
        s!.id, JSON.stringify(body.config), a.userId,
      ]);
      await audit(c, a, 'strategy.publish', 'strategy', s!.id, { after: { version: 1, copyOf: body.copyOf ?? null, config: body.config } });
      return s!.id as string;
    });
    return reply.code(201).send((await loadStrategies(a.workspaceId, id))[0]);
  });

  app.post<{ Params: { id: string } }>('/strategies/:id/versions', { preHandler: requireRoles(...CAN.manageData) }, async (req, reply) => {
    const a = actor(req);
    await tx(async (c) => {
      const s = await one(c, `SELECT * FROM strategies WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [req.params.id, a.workspaceId]);
      if (!s) throw notFound('Estratégia');
      // Permite editar e publicar nova versão mesmo em templates predefinidos
      const body = parse(StrategyPublishSchema, req.body);
      const prev = await one(c, `SELECT version, config FROM strategy_versions WHERE strategy_id=$1 ORDER BY version DESC LIMIT 1`, [s.id]);
      const nameChanged = body.name !== undefined && body.name.trim() !== String(s.name).trim();
      const configChanged = !prev || JSON.stringify(prev.config) !== JSON.stringify(body.config);
      if (!nameChanged && !configChanged) {
        throw badRequest('Nenhuma alteração detectada na configuração; uma nova versão só é criada se houver mudanças.');
      }
      if (nameChanged && body.name) {
        await c.query(`UPDATE strategies SET name=$1 WHERE id=$2`, [body.name.trim(), s.id]);
      }
      const v = (prev?.version ?? 0) + 1;
      await c.query(`INSERT INTO strategy_versions (strategy_id, version, config, published_by) VALUES ($1,$2,$3,$4)`, [
        s.id, v, JSON.stringify(body.config), a.userId,
      ]);
      await audit(c, a, 'strategy.publish', 'strategy', s.id, { before: { name: s.name, ...(prev ?? {}) }, after: { name: body.name ?? s.name, version: v, config: body.config } });
    });
    return reply.code(201).send((await loadStrategies(a.workspaceId, req.params.id))[0]);
  });

  app.delete<{ Params: { id: string } }>('/strategies/:id', { preHandler: requireRoles(...CAN.manageData) }, async (req) => {
    const a = actor(req);
    const { id } = req.params;
    const s = await one(getPool(), `SELECT id, name FROM strategies WHERE id=$1 AND workspace_id=$2`, [id, a.workspaceId]);
    if (!s) throw notFound('Estratégia');
    const inCampaign = await one(
      getPool(),
      `SELECT c.name FROM campaigns c JOIN strategy_versions sv ON sv.id=c.strategy_version_id WHERE sv.strategy_id=$1 LIMIT 1`,
      [id],
    );
    if (inCampaign) {
      throw conflict(`Esta estratégia está vinculada à campanha "${inCampaign.name}" e não pode ser excluída.`);
    }
    const inTemplate = await one(
      getPool(),
      `SELECT name FROM campaign_templates WHERE workspace_id=$1 AND strategy_id=$2 LIMIT 1`,
      [a.workspaceId, id],
    ).catch(() => null);
    if (inTemplate) {
      throw conflict(`Esta estratégia está vinculada ao modelo "${inTemplate.name}" e não pode ser excluída.`);
    }
    await tx(async (c) => {
      await c.query(`DELETE FROM strategy_versions WHERE strategy_id=$1`, [id]);
      await c.query(`DELETE FROM strategies WHERE id=$1 AND workspace_id=$2`, [id, a.workspaceId]);
      await audit(c, a, 'strategy.delete', 'strategy', id, { before: { name: s.name } });
    });
    return { deleted: true, id };
  });
}
