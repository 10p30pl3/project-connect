import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL é obrigatória'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET inválida'),
  VOICE_APP_BASE_URL: z.string().optional().default(''),
  VOICE_APP_TOKEN: z.string().optional().default(''),
  WEB_ORIGIN: z.string().optional().default('http://localhost:5173'),
  AUTH_DISABLED: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
});

export function validateEnv() {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    API_PORT: process.env.API_PORT ?? 3333,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/voll_connect',
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    VOICE_APP_BASE_URL: process.env.VOICE_APP_BASE_URL ?? '',
    VOICE_APP_TOKEN: process.env.VOICE_APP_TOKEN ?? '',
    WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    AUTH_DISABLED: process.env.AUTH_DISABLED,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`[env-validator] Configuração de ambiente inválida: ${details}`);
  }

  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL) {
      throw new Error('[env-validator] DATABASE_URL deve estar explicitamente definida em produção.');
    }
    if (env.JWT_SECRET === 'dev-secret-change-me' || env.JWT_SECRET.length < 32) {
      throw new Error('[env-validator] JWT_SECRET em produção deve possuir ao menos 32 caracteres aleatórios.');
    }
    if (env.TOKEN_ENCRYPTION_KEY && env.TOKEN_ENCRYPTION_KEY.length < 16) {
      throw new Error('[env-validator] TOKEN_ENCRYPTION_KEY deve possuir ao menos 16 caracteres.');
    }
    if (env.VOICE_APP_BASE_URL && !env.VOICE_APP_TOKEN) {
      console.warn('[env-validator] AVISO: VOICE_APP_BASE_URL definida sem VOICE_APP_TOKEN.');
    }
  }

  return env;
}
