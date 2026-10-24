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

export type BuildOptions = { logger?: boolean; loginRateMax?: number };

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
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

  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: '8h' },
  });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    const p = toProblem(err);
    if (p.status >= 500) {
      req.log.error(err);
      if (!opts.logger) console.error(err);
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
        if (!config.isProduction) await simRoutes(p);
      });
    },
    { prefix: '/api' },
  );
  return app;
}
