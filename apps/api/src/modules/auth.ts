import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { CreateUserSchema, LoginSchema } from '@voll/shared';
import { getPool, one, q } from '../db/pool.js';
import { parse, HttpError, conflict } from '../lib/problem.js';
import { COOKIE_NAME, authenticate, actor, requireRoles } from '../auth/context.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';

export async function loadMe(userId: string) {
  const r = await one(
    getPool(),
    `SELECT u.id, u.email, u.name, u.role, o.id AS org_id, o.name AS org_name,
            w.id AS ws_id, w.name AS ws_name, w.timezone
       FROM users u JOIN organizations o ON o.id=u.organization_id
       JOIN LATERAL (SELECT * FROM workspaces WHERE organization_id=o.id ORDER BY created_at LIMIT 1) w ON true
      WHERE u.id=$1 AND u.active`,
    [userId],
  );
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    organization: { id: r.org_id, name: r.org_name },
    workspace: { id: r.ws_id, name: r.ws_name, timezone: r.timezone },
  };
}

export async function authRoutes(app: FastifyInstance, opts: { loginRateMax: number }) {
  app.post('/auth/login', { config: { rateLimit: { max: opts.loginRateMax, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(LoginSchema, req.body);
    const u = await one(getPool(), `SELECT * FROM users WHERE lower(email)=lower($1) AND active`, [body.email]);
    const ok = u ? await bcrypt.compare(body.password, u.password_hash) : false;
    if (!u || !ok) throw new HttpError(401, 'Credenciais inválidas', 'E-mail ou senha incorretos');
    const me = await loadMe(u.id);
    const token = app.jwt.sign({ sub: u.id, role: u.role, org: u.organization_id, ws: me!.workspace.id });
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: 8 * 3600,
    });
    return { user: me };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: authenticate }, async (req) => {
    const me = await loadMe(actor(req).userId!);
    if (!me) throw new HttpError(401, 'Não autenticado', 'Usuário inativo');
    return me;
  });

  app.get('/users', { preHandler: [authenticate, requireRoles()] }, async (req) => {
    const items = await q(
      getPool(),
      `SELECT id, email, name, role, active, created_at AS "createdAt" FROM users WHERE organization_id=$1 ORDER BY name`,
      [actor(req).organizationId],
    );
    return { items };
  });

  app.post('/users', { preHandler: [authenticate, requireRoles()] }, async (req, reply) => {
    const body = parse(CreateUserSchema, req.body);
    const a = actor(req);
    const exists = await one(getPool(), `SELECT 1 FROM users WHERE lower(email)=lower($1)`, [body.email]);
    if (exists) throw conflict('Já existe um usuário com este e-mail');
    const hash = await bcrypt.hash(body.password, 10);
    const u = await one(
      getPool(),
      `INSERT INTO users (organization_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, email, name, role, active, created_at AS "createdAt"`,
      [a.organizationId, body.email, body.name, hash, body.role],
    );
    await audit(getPool(), a, 'user.create', 'user', u.id, { after: { email: body.email, role: body.role } });
    return reply.code(201).send(u);
  });
}
