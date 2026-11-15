export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/voll_connect',
  port: Number(process.env.API_PORT ?? 3333),
  publicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:3333',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  workerTickMs: Number(process.env.WORKER_TICK_MS ?? 2000),
  isProduction: process.env.NODE_ENV === 'production',
  /** Modo mockup: permitido somente fora de produção (NODE_ENV=production sempre exige autenticação). */
  authDisabled:
    process.env.NODE_ENV !== 'production' &&
    process.env.AUTH_DISABLED !== 'false',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@voll.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Voll@2026',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};
