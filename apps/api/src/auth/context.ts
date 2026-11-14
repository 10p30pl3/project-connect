import type { FastifyReply, FastifyRequest } from 'fastify';
import { ROLES, isReadOnlyRole, isSuperAdminRole, type Role } from '@voll/shared';
import { HttpError, forbidden } from '../lib/problem.js';
import type { Actor } from '../lib/audit.js';
import { config } from '../config.js';
import { getPool, one } from '../db/pool.js';
import { sha256Hex } from '../lib/crypto.js';

export type SessionUser = { sub: string; role: Role; org: string; ws: string; sessionId?: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser;
    user: SessionUser;
  }
}

export const COOKIE_NAME = 'vc_session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedWorkspaceId(req: FastifyRequest): string | null {
  const raw = req.headers['x-workspace-id'];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

const VIEWER_ALLOWED_WRITE_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/select-workspace',
  '/auth/login',
  '/auth/logout',
  '/auth/select-workspace',
]);

function enforceViewerReadOnly(req: FastifyRequest, user: SessionUser) {
  if (!isReadOnlyRole(user.role)) return;
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const path = (req.url || '').split('?')[0];
  if (VIEWER_ALLOWED_WRITE_PATHS.has(path)) return;
  throw new HttpError(
    403,
    'Modo suporte somente-leitura',
    'Perfil SUPER_ADMIN_VIEWER possui permissão apenas de visualização; alterações foram bloqueadas.',
  );
}

/** Modo mockup (AUTH_DISABLED): respeita X-Demo-Role e X-Workspace-Id dinamicamente. */
async function demoUser(req: FastifyRequest): Promise<SessionUser> {
  const h = String(req.headers['x-demo-role'] ?? '').toUpperCase();
  const explicitRole: Role | null = (ROLES as readonly string[]).includes(h) ? (h as Role) : null;
  const reqWsId = requestedWorkspaceId(req);

  try {
    const wsRow = reqWsId
      ? await one<{ id: string; organization_id: string }>(
          getPool(),
          `SELECT id, organization_id FROM workspaces WHERE id=$1 AND active=true LIMIT 1`,
          [reqWsId],
        )
      : await one<{ id: string; organization_id: string }>(
          getPool(),
          `SELECT id, organization_id FROM workspaces WHERE active=true ORDER BY is_master DESC, created_at ASC LIMIT 1`,
        );

    const u = await one<{ id: string; organization_id: string; role: Role; global_role: Role | null }>(
      getPool(),
      `SELECT id, organization_id, role, global_role
         FROM users
        WHERE active=true
        ORDER BY ($1::text IS NOT NULL AND (global_role::text=$1 OR role::text=$1)) DESC,
                 (global_role IS NOT NULL) DESC,
                 (role='ADMIN') DESC,
                 created_at ASC
        LIMIT 1`,
      [explicitRole],
    );

    const effectiveRole: Role = explicitRole ?? ((u?.global_role ?? u?.role ?? 'ADMIN') as Role);

    if (wsRow && u) {
      return { sub: u.id, role: effectiveRole, org: wsRow.organization_id, ws: wsRow.id };
    }
    if (u) {
      const anyWs = await one<{ id: string; organization_id: string }>(
        getPool(),
        `SELECT id, organization_id FROM workspaces ORDER BY is_master DESC, created_at ASC LIMIT 1`,
      );
      return {
        sub: u.id,
        role: effectiveRole,
        org: anyWs?.organization_id ?? u.organization_id,
        ws: anyWs?.id ?? reqWsId ?? '00000000-0000-4000-8000-000000000020',
      };
    }
  } catch {
    // DB offline fallback no modo demo
  }

  return {
    sub: '00000000-0000-4000-8000-000000000001',
    role: explicitRole ?? 'ADMIN',
    org: '00000000-0000-4000-8000-000000000010',
    ws: reqWsId ?? '00000000-0000-4000-8000-000000000020',
  };
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  if (config.authDisabled) {
    const user = await demoUser(req);
    req.user = user;
    enforceViewerReadOnly(req, user);
    return;
  }

  try {
    await req.jwtVerify({ onlyCookie: true });
  } catch {
    throw new HttpError(401, 'Não autenticado', 'Faça login para continuar');
  }

  const jwtUser = req.user as SessionUser;
  const rawToken = req.cookies?.[COOKIE_NAME];
  let activeWsId = requestedWorkspaceId(req) ?? jwtUser.ws;
  let effectiveRole: Role = jwtUser.role;
  let effectiveOrg = jwtUser.org;

  if (rawToken) {
    const tokenHash = sha256Hex(rawToken);
    const session = await one<{
      id: string;
      active_workspace_id: string | null;
      expires_at: string;
      revoked_at: string | null;
    }>(
      getPool(),
      `SELECT id, active_workspace_id, expires_at, revoked_at FROM user_sessions WHERE token_hash=$1 LIMIT 1`,
      [tokenHash],
    ).catch(() => null);

    if (session) {
      if (session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
        throw new HttpError(401, 'Sessão expirada', 'Sua sessão expirou por inatividade. Faça login novamente.');
      }
      if (!requestedWorkspaceId(req) && session.active_workspace_id) {
        activeWsId = session.active_workspace_id;
      }
      await getPool()
        .query(
          `UPDATE user_sessions
              SET last_activity_at = now(),
                  expires_at = now() + interval '8 hours'
            WHERE id = $1`,
          [session.id],
        )
        .catch(() => {});
    }
  }

  if (activeWsId) {
    if (isSuperAdminRole(jwtUser.role)) {
      const targetWs = await one<{ id: string; organization_id: string }>(
        getPool(),
        `SELECT id, organization_id FROM workspaces WHERE id=$1 AND active=true LIMIT 1`,
        [activeWsId],
      ).catch(() => null);
      if (!targetWs) {
        throw new HttpError(404, 'Empresa não encontrada', 'O workspace selecionado está inativo ou não existe.');
      }
      effectiveOrg = targetWs.organization_id;
    } else {
      const membership = await one<{ workspace_id: string; organization_id: string; role: Role }>(
        getPool(),
        `SELECT uw.workspace_id, w.organization_id, uw.role
           FROM user_workspaces uw
           JOIN workspaces w ON w.id = uw.workspace_id
          WHERE uw.user_id=$1 AND uw.workspace_id=$2 AND w.active=true
          LIMIT 1`,
        [jwtUser.sub, activeWsId],
      ).catch(() => null);

      if (!membership) {
        throw new HttpError(403, 'Acesso negado à empresa', 'Você não possui vínculo com o workspace selecionado.');
      }
      effectiveRole = membership.role;
      effectiveOrg = membership.organization_id;
    }
  }

  const resolvedUser: SessionUser = {
    sub: jwtUser.sub,
    role: effectiveRole,
    org: effectiveOrg,
    ws: activeWsId,
    sessionId: jwtUser.sessionId,
  };
  req.user = resolvedUser;
  enforceViewerReadOnly(req, resolvedUser);
}

export function requireRoles(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    const u = req.user as SessionUser | undefined;
    if (!u) throw new HttpError(401, 'Não autenticado', 'Faça login para continuar');
    if (isSuperAdminRole(u.role) || u.role === 'ADMIN') return;
    if (!roles.includes(u.role)) throw forbidden();
  };
}

export async function requireSuperAdmin(req: FastifyRequest) {
  const u = req.user as SessionUser | undefined;
  if (!u) throw new HttpError(401, 'Não autenticado', 'Faça login para continuar');
  if (!isSuperAdminRole(u.role)) {
    throw new HttpError(
      403,
      'Acesso restrito ao Super Admin',
      'Somente usuários Super Admin podem acessar configurações globais e faturamento multi-tenant.',
    );
  }
}

export function actor(req: FastifyRequest): Actor & { role: Role } {
  const u = req.user as SessionUser | undefined;
  if (!u) throw new HttpError(401, 'Não autenticado');
  return { userId: u.sub, organizationId: u.org, workspaceId: u.ws, role: u.role };
}

/** Perfis por capacidade (§17.1). ADMIN / SUPER_ADMIN sempre permitidos. */
export const CAN = {
  manageData: ['MANAGER'] as Role[], // mailings, listas, jornadas, estratégias, campanhas
  operate: ['MANAGER', 'SUPERVISOR'] as Role[], // pausar/retomar/encerrar
  supervise: ['SUPERVISOR'] as Role[], // reconciliar, bloquear
  admin: [] as Role[],
};
