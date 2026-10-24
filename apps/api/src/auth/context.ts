import type { FastifyReply, FastifyRequest } from 'fastify';
import { ROLES, type Role } from '@voll/shared';
import { HttpError, forbidden } from '../lib/problem.js';
import type { Actor } from '../lib/audit.js';
import { config } from '../config.js';
import { getPool, one } from '../db/pool.js';

export type SessionUser = { sub: string; role: Role; org: string; ws: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser;
    user: SessionUser;
  }
}

export const COOKIE_NAME = 'vc_session';

const demoCache = new Map<Role, SessionUser>();

/** Modo mockup (AUTH_DISABLED): usuário demo do perfil pedido em X-Demo-Role (padrão ADMIN). */
async function demoUser(req: FastifyRequest): Promise<SessionUser> {
  const h = String(req.headers['x-demo-role'] ?? '').toUpperCase();
  const role: Role = (ROLES as readonly string[]).includes(h) ? (h as Role) : 'ADMIN';
  const cached = demoCache.get(role);
  if (cached) return cached;
  const u = await one(
    getPool(),
    `SELECT u.id, u.role, u.organization_id AS org,
            (SELECT id FROM workspaces w WHERE w.organization_id=u.organization_id ORDER BY created_at LIMIT 1) AS ws
       FROM users u WHERE u.active ORDER BY (u.role=$1) DESC, (u.role='ADMIN') DESC, u.created_at LIMIT 1`,
    [role],
  );
  if (!u) throw new HttpError(401, 'Não autenticado', 'Nenhum usuário cadastrado; rode npm run db:seed');
  const s: SessionUser = { sub: u.id, role: u.role, org: u.org, ws: u.ws };
  demoCache.set(role, s);
  return s;
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  if (config.authDisabled) {
    req.user = await demoUser(req);
    return;
  }
  try {
    await req.jwtVerify({ onlyCookie: true });
  } catch {
    throw new HttpError(401, 'Não autenticado', 'Faça login para continuar');
  }
}

export function requireRoles(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    const u = req.user as SessionUser | undefined;
    if (!u) throw new HttpError(401, 'Não autenticado', 'Faça login para continuar');
    if (u.role !== 'ADMIN' && !roles.includes(u.role)) throw forbidden();
  };
}

export function actor(req: FastifyRequest): Actor & { role: Role } {
  const u = req.user as SessionUser;
  return { userId: u.sub, organizationId: u.org, workspaceId: u.ws, role: u.role };
}

/** Perfis por capacidade (§17.1). ADMIN sempre permitido. */
export const CAN = {
  manageData: ['MANAGER'] as Role[], // mailings, listas, jornadas, estratégias, campanhas
  operate: ['MANAGER', 'SUPERVISOR'] as Role[], // pausar/retomar/encerrar
  supervise: ['SUPERVISOR'] as Role[], // reconciliar, bloquear
  admin: [] as Role[],
};
