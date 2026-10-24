import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@voll/shared';
import { HttpError, forbidden } from '../lib/problem.js';
import type { Actor } from '../lib/audit.js';

export type SessionUser = { sub: string; role: Role; org: string; ws: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser;
    user: SessionUser;
  }
}

export const COOKIE_NAME = 'vc_session';

export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
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
