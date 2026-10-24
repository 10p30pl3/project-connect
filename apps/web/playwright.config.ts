import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do Voll Connect.
 * - Os testes principais (e2e/*.spec.ts) miram a API real: suba Postgres, API, worker e web antes
 *   (`npm run dev` na raiz) ou defina E2E_BASE_URL.
 * - O smoke com rotas simuladas (e2e/smoke-mocked.spec.ts) roda só com o Vite (`npm run dev:web`).
 * Credenciais: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (padrão do seed).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
