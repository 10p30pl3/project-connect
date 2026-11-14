import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  CreateUserSchema,
  LoginSchema,
  isReadOnlyRole,
  isSuperAdminRole,
  type Role,
} from '@voll/shared';
import { getPool, one, q, tx } from '../db/pool.js';
import { parse, HttpError, conflict } from '../lib/problem.js';
import { COOKIE_NAME, authenticate, actor, requireRoles } from '../auth/context.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { sha256Hex } from '../lib/crypto.js';
import { idempotencyGuard } from '../lib/idempotency.js';

const DEFAULT_TABULATIONS = [
  { code: 'CONVERSION', name: 'Acordo fechado', is_cpc: true, is_conversion: true, is_optout: false, is_invalid: false, channels: null },
  { code: 'CPC_NO_DEAL', name: 'Titular sem acordo', is_cpc: true, is_conversion: false, is_optout: false, is_invalid: false, channels: null },
  { code: 'CALLBACK_SCHEDULED', name: 'Reagendamento solicitado', is_cpc: true, is_conversion: false, is_optout: false, is_invalid: false, channels: ['VOICE'] },
  { code: 'VOICEMAIL', name: 'Caixa postal', is_cpc: false, is_conversion: false, is_optout: false, is_invalid: false, channels: ['VOICE'] },
  { code: 'NO_ANSWER', name: 'Não atendeu', is_cpc: false, is_conversion: false, is_optout: false, is_invalid: false, channels: null },
  { code: 'BUSY', name: 'Ocupado', is_cpc: false, is_conversion: false, is_optout: false, is_invalid: false, channels: null },
  { code: 'WRONG_PERSON', name: 'Terceiro', is_cpc: false, is_conversion: false, is_optout: false, is_invalid: false, channels: null },
  { code: 'INVALID_NUMBER', name: 'Número inválido', is_cpc: false, is_conversion: false, is_optout: false, is_invalid: true, channels: null },
  { code: 'OPT_OUT', name: 'Não deseja contato', is_cpc: false, is_conversion: false, is_optout: true, is_invalid: false, channels: null },
  { code: 'READ_NO_REPLY', name: 'Lida sem resposta', is_cpc: false, is_conversion: false, is_optout: false, is_invalid: false, channels: ['WHATSAPP', 'SMS'] },
  { code: 'REPLIED', name: 'Respondeu', is_cpc: true, is_conversion: false, is_optout: false, is_invalid: false, channels: ['WHATSAPP', 'SMS', 'EMAIL'] },
];

type WorkspaceOption = {
  id: string;
  name: string;
  timezone: string;
  organizationId: string;
  organizationName: string;
  isMaster: boolean;
  planCode: string;
  role: Role;
};

export async function listAccessibleWorkspaces(
  userId: string,
  effectiveRole: Role,
  includeAllInDemo = config.authDisabled,
): Promise<WorkspaceOption[]> {
  const pool = getPool();
  if (includeAllInDemo || isSuperAdminRole(effectiveRole)) {
    const rows = await q<{
      id: string;
      name: string;
      timezone: string;
      organization_id: string;
      org_name: string;
      is_master: boolean;
      plan_code: string;
    }>(
      pool,
      `SELECT w.id, w.name, w.timezone, w.organization_id, o.name AS org_name,
              COALESCE(w.is_master, false) AS is_master,
              COALESCE(w.plan_code, 'GROWTH') AS plan_code
         FROM workspaces w
         JOIN organizations o ON o.id = w.organization_id
        WHERE COALESCE(w.active, true) = true
        ORDER BY COALESCE(w.is_master, false) DESC, w.created_at ASC`,
    ).catch(() => []);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      timezone: r.timezone,
      organizationId: r.organization_id,
      organizationName: r.org_name,
      isMaster: Boolean(r.is_master),
      planCode: r.plan_code,
      role: effectiveRole,
    }));
  }

  const rows = await q<{
    id: string;
    name: string;
    timezone: string;
    organization_id: string;
    org_name: string;
    is_master: boolean;
    plan_code: string;
    ws_role: Role;
  }>(
    pool,
    `SELECT w.id, w.name, w.timezone, w.organization_id, o.name AS org_name,
            COALESCE(w.is_master, false) AS is_master,
            COALESCE(w.plan_code, 'GROWTH') AS plan_code,
            uw.role AS ws_role
       FROM user_workspaces uw
       JOIN workspaces w ON w.id = uw.workspace_id
       JOIN organizations o ON o.id = w.organization_id
      WHERE uw.user_id = $1 AND COALESCE(w.active, true) = true
      ORDER BY COALESCE(w.is_master, false) DESC, uw.is_default DESC, w.created_at ASC`,
    [userId],
  ).catch(() => []);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    organizationId: r.organization_id,
    organizationName: r.org_name,
    isMaster: Boolean(r.is_master),
    planCode: r.plan_code,
    role: r.ws_role,
  }));
}

export async function loadMe(
  userId: string,
  opts: { workspaceId?: string | null; roleOverride?: Role; includeAllWorkspaces?: boolean } = {},
) {
  const r = await one<{
    id: string;
    email: string;
    name: string;
    role: Role;
    global_role: Role | null;
    org_id: string;
    org_name: string;
  }>(
    getPool(),
    `SELECT u.id, u.email, u.name, u.role, u.global_role, o.id AS org_id, o.name AS org_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = $1 AND u.active`,
    [userId],
  );
  if (!r) return null;

  const baseRole = opts.roleOverride ?? r.global_role ?? r.role;
  const workspaces = await listAccessibleWorkspaces(userId, baseRole, opts.includeAllWorkspaces ?? config.authDisabled);
  const selected =
    workspaces.find((w) => w.id === opts.workspaceId) ??
    workspaces.find((w) => w.isMaster) ??
    workspaces[0] ?? {
      id: opts.workspaceId ?? '00000000-0000-4000-8000-000000000020',
      name: 'Principal',
      timezone: 'America/Sao_Paulo',
      organizationId: r.org_id,
      organizationName: r.org_name,
      isMaster: true,
      planCode: 'ENTERPRISE',
      role: baseRole,
    };

  const effectiveRole: Role = opts.roleOverride ?? (isSuperAdminRole(baseRole) ? baseRole : selected.role);

  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: effectiveRole,
    globalRole: r.global_role ?? (isSuperAdminRole(effectiveRole) ? effectiveRole : null),
    isSuperAdmin: isSuperAdminRole(effectiveRole),
    readOnlyMode: isReadOnlyRole(effectiveRole),
    organization: { id: selected.organizationId, name: selected.organizationName },
    workspace: {
      id: selected.id,
      name: selected.name,
      timezone: selected.timezone,
      isMaster: selected.isMaster,
      planCode: selected.planCode,
    },
    workspaces,
  };
}

// Hash dummy pré-computado para mitigar enumeração de e-mails via ataque de tempo (timing side-channel)
const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa').max(120),
  timezone: z.string().trim().default('America/Sao_Paulo'),
  planCode: z.string().trim().default('GROWTH'),
  planName: z.string().trim().default('Voll Client Standard'),
  monthlyIncludedMinutes: z.coerce.number().int().min(0).max(5_000_000).default(1000),
  voiceRateClientPerMinBrl: z.coerce.number().min(0).max(100).default(0.25),
});

const SelectWorkspaceSchema = z.object({
  workspaceId: z.string().uuid('workspaceId inválido'),
});

export async function authRoutes(app: FastifyInstance, opts: { loginRateMax: number }) {
  app.post('/auth/login', { config: { rateLimit: { max: opts.loginRateMax, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(LoginSchema, req.body);
    const u = await one(getPool(), `SELECT * FROM users WHERE lower(email)=lower($1) AND active`, [body.email]);
    const ok = await bcrypt.compare(body.password, u ? u.password_hash : DUMMY_BCRYPT_HASH);
    if (!u || !ok) throw new HttpError(401, 'Credenciais inválidas', 'E-mail ou senha incorretos');

    const me = await loadMe(u.id, { includeAllWorkspaces: false });
    const sessionRole: Role = (u.global_role ?? me?.role ?? u.role) as Role;
    const token = app.jwt.sign({ sub: u.id, role: sessionRole, org: u.organization_id, ws: me!.workspace.id });

    await getPool()
      .query(
        `INSERT INTO user_sessions (token_hash, user_id, active_workspace_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          sha256Hex(token),
          u.id,
          me!.workspace.id,
          req.ip ?? null,
          String(req.headers['user-agent'] ?? '').slice(0, 300),
        ],
      )
      .catch(() => {});

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: 8 * 3600,
    });
    return { user: me };
  });

  app.post('/auth/logout', async (req, reply) => {
    const rawToken = req.cookies?.[COOKIE_NAME];
    if (rawToken) {
      await getPool()
        .query(`UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256Hex(rawToken)])
        .catch(() => {});
    }
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: authenticate }, async (req) => {
    const a = actor(req);
    const me = await loadMe(a.userId!, {
      workspaceId: a.workspaceId,
      roleOverride: config.authDisabled ? a.role : undefined,
      includeAllWorkspaces: config.authDisabled || isSuperAdminRole(a.role),
    });
    if (!me) throw new HttpError(401, 'Não autenticado', 'Usuário inativo');
    return { ...me, demoMode: config.authDisabled };
  });

  app.get('/auth/workspaces', { preHandler: authenticate }, async (req) => {
    const a = actor(req);
    const items = await listAccessibleWorkspaces(
      a.userId!,
      a.role,
      config.authDisabled || isSuperAdminRole(a.role),
    );
    return { items, activeWorkspaceId: a.workspaceId };
  });

  app.post('/auth/select-workspace', { preHandler: authenticate }, async (req) => {
    const a = actor(req);
    const body = parse(SelectWorkspaceSchema, req.body);
    const allowed = await listAccessibleWorkspaces(
      a.userId!,
      a.role,
      config.authDisabled || isSuperAdminRole(a.role),
    );
    const target = allowed.find((w) => w.id === body.workspaceId);
    if (!target) {
      throw new HttpError(403, 'Acesso negado à empresa', 'Usuário não possui acesso ao workspace selecionado.');
    }

    const rawToken = req.cookies?.[COOKIE_NAME];
    if (rawToken) {
      await getPool()
        .query(
          `UPDATE user_sessions SET active_workspace_id = $2, last_activity_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
          [sha256Hex(rawToken), target.id],
        )
        .catch(() => {});
    }
    return { ok: true, workspace: target };
  });

  app.post(
    '/auth/workspaces',
    { preHandler: [authenticate, idempotencyGuard('auth.create_workspace')] },
    async (req, reply) => {
      const a = actor(req);
      const canProvision =
        (isSuperAdminRole(a.role) && !isReadOnlyRole(a.role)) || (config.authDisabled && a.role === 'ADMIN');
      if (!canProvision) {
        throw new HttpError(
          403,
          'Permissão insuficiente',
          'Apenas Super Admin (ou Administrador em modo laboratório) pode provisionar novas empresas.',
        );
      }

      const body = parse(CreateWorkspaceSchema, req.body);
      const created = await tx(async (c) => {
        const ws = await one<{
          id: string;
          organization_id: string;
          name: string;
          timezone: string;
          is_master: boolean;
          plan_code: string;
        }>(
          c,
          `INSERT INTO workspaces (organization_id, name, timezone, is_master, active, plan_code)
           VALUES ($1, $2, $3, false, true, $4)
           RETURNING id, organization_id, name, timezone, is_master, plan_code`,
          [a.organizationId, body.name, body.timezone, body.planCode],
        );

        await c.query(
          `INSERT INTO tenant_billing_plans
             (workspace_id, plan_name, monthly_included_minutes, voice_rate_client_per_min_brl)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id) DO NOTHING`,
          [ws!.id, body.planName, body.monthlyIncludedMinutes, body.voiceRateClientPerMinBrl],
        );

        for (const t of DEFAULT_TABULATIONS) {
          await c.query(
            `INSERT INTO tabulations (workspace_id, code, name, is_cpc, is_conversion, is_opt_out, invalidates_destination, channel_types)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::channel_type[])
             ON CONFLICT (workspace_id, code) DO NOTHING`,
            [ws!.id, t.code, t.name, t.is_cpc, t.is_conversion, t.is_optout, t.is_invalid, t.channels ?? ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL']],
          );
        }

        if (a.userId) {
          await c.query(
            `INSERT INTO user_workspaces (user_id, workspace_id, role, is_default)
             VALUES ($1, $2, 'ADMIN', false)
             ON CONFLICT (user_id, workspace_id) DO NOTHING`,
            [a.userId, ws!.id],
          );
        }

        await audit(c, a, 'workspace.create', 'workspace', ws!.id, {
          after: {
            name: ws!.name,
            timezone: ws!.timezone,
            planCode: ws!.plan_code,
            monthlyIncludedMinutes: body.monthlyIncludedMinutes,
          },
        });

        return ws!;
      });

      return reply.code(201).send({
        workspace: {
          id: created.id,
          name: created.name,
          timezone: created.timezone,
          organizationId: created.organization_id,
          isMaster: created.is_master,
          planCode: created.plan_code,
        },
      });
    },
  );

  app.get('/users', { preHandler: [authenticate, requireRoles()] }, async (req) => {
    const items = await q(
      getPool(),
      `SELECT id, email, name, role, global_role AS "globalRole", active, created_at AS "createdAt"
         FROM users
        WHERE organization_id=$1
        ORDER BY name`,
      [actor(req).organizationId],
    );
    return { items };
  });

  app.post('/users', { preHandler: [authenticate, requireRoles()] }, async (req, reply) => {
    const body = parse(CreateUserSchema, req.body);
    const a = actor(req);
    if (isSuperAdminRole(body.role) && !isSuperAdminRole(a.role)) {
      throw new HttpError(403, 'Permissão insuficiente', 'Somente Super Admin pode atribuir papéis globais SaaS.');
    }
    const exists = await one(getPool(), `SELECT 1 FROM users WHERE lower(email)=lower($1)`, [body.email]);
    if (exists) throw conflict('Já existe um usuário com este e-mail');
    const hash = await bcrypt.hash(body.password, 10);
    const u = await one<{ id: string }>(
      getPool(),
      `INSERT INTO users (organization_id, email, name, password_hash, role, global_role)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, name, role, global_role AS "globalRole", active, created_at AS "createdAt"`,
      [
        a.organizationId,
        body.email,
        body.name,
        hash,
        body.role,
        isSuperAdminRole(body.role) ? body.role : null,
      ],
    );
    await getPool()
      .query(
        `INSERT INTO user_workspaces (user_id, workspace_id, role, is_default)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (user_id, workspace_id) DO NOTHING`,
        [u!.id, a.workspaceId, body.role],
      )
      .catch(() => {});
    await audit(getPool(), a, 'user.create', 'user', u!.id, { after: { email: body.email, role: body.role } });
    return reply.code(201).send(u);
  });
}
