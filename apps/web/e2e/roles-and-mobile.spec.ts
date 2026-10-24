import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('perfil Analista consulta sem botões de ação', async ({ page, browser }) => {
  await login(page);
  const ts = Date.now();
  const email = `analista.${ts}@voll.local`;
  const res = await page.request.post('/api/users', { data: { email, name: 'Ana Analista', role: 'ANALYST', password: 'Analista@2026' } });
  expect(res.ok(), await res.text()).toBeTruthy();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, email, 'Analista@2026');
  await p2.goto('/campanhas');
  await expect(p2.getByRole('heading', { name: 'Campanhas' })).toBeVisible();
  await expect(p2.getByRole('link', { name: 'Nova campanha' })).toHaveCount(0);
  const first = p2.locator('table.data tbody tr a').first();
  if (await first.count()) {
    await first.click();
    await expect(p2.getByRole('tab', { name: 'Visão geral' })).toBeVisible();
    for (const name of ['Pausar', 'Retomar', 'Encerrar', 'Iniciar agora']) await expect(p2.getByRole('button', { name })).toHaveCount(0);
  }
  await p2.goto('/controle');
  await expect(p2.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
  await ctx.close();
});

test('navegação móvel 390x844 com 5 destinos', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page);
  const nav = page.getByTestId('mobile-nav');
  await expect(nav).toBeVisible();
  for (const name of ['Início', 'Campanhas', 'Listas', 'Tentativas', 'Mais']) await expect(nav.getByRole('link', { name })).toBeInViewport();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden();
  await nav.getByRole('link', { name: 'Mais' }).click();
  await expect(nav.getByRole('link', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Canais' }).click();
  await expect(page.getByRole('heading', { name: 'Canais' })).toBeVisible();
  // sem rolagem horizontal
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBeFalsy();
  await ctx.close();
});
