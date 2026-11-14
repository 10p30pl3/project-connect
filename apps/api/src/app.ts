import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { COOKIE_NAME, authenticate } from './auth/context.js';
import { sendProblem, toProblem } from './lib/problem.js';
import { authRoutes } from './modules/auth.js';
import { mailingRoutes } from './modules/mailings.js';
import { listRoutes } from './modules/lists.js';
import { catalogRoutes } from './modules/catalog.js';
import { campaignRoutes } from './modules/campaigns.js';
import { attemptRoutes } from './modules/attempts.js';
import { contactRoutes } from './modules/contacts.js';
import { controlRoutes } from './modules/control.js';
import { connectorRoutes } from './modules/connectors.js';
import { simRoutes } from './modules/sim.js';
import { overviewRoutes } from './modules/overview.js';
import { intelligenceRoutes } from './modules/intelligence.js';
import { reportRoutes } from './modules/reports.js';
import { aiRoutes } from './modules/ai.js';
import { voiceAgentRoutes } from './modules/voice-agent.js';
import { telephonyRoutes } from './modules/telephony.js';
import { billingRoutes } from './modules/billing.js';
import { validateEnv } from './config/env-validator.js';
import { ensureUpcomingPartitions } from './db/partition-service.js';
import { registerIdempotencyHook } from './lib/idempotency.js';
import { getPool, one } from './db/pool.js';
import { audit } from './lib/audit.js';

export type BuildOptions = { logger?: boolean; loginRateMax?: number };

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  validateEnv();
  void ensureUpcomingPartitions(1, 3).catch(() => {});

  const app = Fastify({
    logger: opts.logger
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.headers["x-voll-signature"]',
              '*.password',
              '*.address',
              '*.email',
              '*.phone',
              '*.webhook_secret',
            ],
            censor: '[oculto]',
          },
        }
      : false,
    bodyLimit: 3 * 1024 * 1024,
  });

  // guarda o corpo bruto para validar a assinatura HMAC dos webhooks
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = body as string;
    req.rawBody = text;
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err: any = new Error('JSON inválido');
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  if (config.isProduction && (!config.jwtSecret || config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 32)) {
    throw new Error('FATAL: JWT_SECRET inseguro em ambiente de produção (mínimo 32 caracteres exigido).');
  }

  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: '8h' },
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => {
      const fwd = req.headers['x-forwarded-for'];
      const firstIp = typeof fwd === 'string' ? fwd.split(',')[0].trim() : '';
      return firstIp || req.ip || '127.0.0.1';
    },
  });
  registerIdempotencyHook(app);

  // Cabeçalhos de segurança HTTP padrão OWASP
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (config.isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const p = toProblem(err);
    if (p.status >= 500) {
      req.log.error(err);
      if (!opts.logger) console.error(err);
      const u = req.user as { sub?: string; org?: string; ws?: string } | undefined;
      void (async () => {
        const orgId =
          u?.org ??
          (await one<{ organization_id: string }>(getPool(), `SELECT organization_id FROM workspaces LIMIT 1`)
            .then((r) => r?.organization_id)
            .catch(() => null));
        if (!orgId) return;
        await audit(
          getPool(),
          { userId: u?.sub ?? null, organizationId: orgId, workspaceId: u?.ws ?? null },
          'system.error_500',
          'http_request',
          (req.url || '').split('?')[0].slice(0, 200),
          {
            reason: String((err as Error)?.message ?? 'Erro interno').slice(0, 300),
            after: { method: req.method, status: p.status },
          },
        );
      })().catch(() => {});
    }
    return sendProblem(reply, p);
  });
  app.setNotFoundHandler((_req, reply) =>
    sendProblem(reply, { type: 'https://voll.connect/problems/404', title: 'Não encontrado', status: 404 }),
  );

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await authRoutes(api, { loginRateMax: opts.loginRateMax ?? 20 });
      await connectorRoutes(api); // público, autenticado por HMAC
      await api.register(async (p) => {
        p.addHook('preHandler', authenticate);
        await overviewRoutes(p);
        await mailingRoutes(p);
        await listRoutes(p);
        await catalogRoutes(p);
        await campaignRoutes(p);
        await attemptRoutes(p);
        await contactRoutes(p);
        await controlRoutes(p);
        await intelligenceRoutes(p);
        await reportRoutes(p);
        await aiRoutes(p);
        await voiceAgentRoutes(p);
        await telephonyRoutes(p);
        await billingRoutes(p);
        if (!config.isProduction) await simRoutes(p);
      });
    },
    { prefix: '/api' },
  );
  return app;
}
