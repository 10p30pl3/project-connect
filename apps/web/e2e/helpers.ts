import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@voll.local';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Voll@2026';

/** Entra no app. No modo mockup (AUTH_DISABLED) não há tela de login: o perfil vem de `demoRole`. */
export async function login(page: Page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD, demoRole = 'ADMIN') {
  await page.addInitScript((r) => localStorage.setItem('vc_demo_role', r), demoRole);
  await page.goto('/login');
  const menu = page.getByRole('button', { name: /Menu do usuário/ });
  const field = page.getByLabel('E-mail');
  await expect(menu.or(field)).toBeVisible();
  if (await menu.isVisible()) return;
  await field.fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /Menu do usuário/ })).toBeVisible();
}

/** Estratégia 24x7 para que o teste não dependa do horário de execução. */
export async function createAlwaysOnStrategy(request: APIRequestContext, name: string) {
  const tabs = (await (await request.get('/api/tabulations')).json()) as { items: { code: string; isConversion: boolean; isOptOut: boolean }[] };
  const rules: Record<string, string> = {};
  for (const t of tabs.items) rules[t.code] = t.isConversion ? 'FINISH_SUCCESS' : t.isOptOut ? 'FINISH_FAIL' : 'RETRY';
  const res = await request.post('/api/strategies', {
    data: {
      name,
      config: {
        calendar: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', timezone: 'America/Sao_Paulo' },
        limits: { total: 10, daily: 5, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
        retry: { intervalMinutes: 1, maxPerDestination: 3 },
        distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
        tabulationRules: rules,
      },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: string };
}
