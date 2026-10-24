import { expect, test } from '@playwright/test';
import { createAlwaysOnStrategy, login } from './helpers';

/**
 * Fluxo completo contra a API real (§27): importar CSV com 1 linha inválida → importação parcial →
 * filtrar e publicar lista → jornada/estratégia → criar e iniciar → tentativas → detalhe da tentativa.
 */
test('assistente completo cria e inicia campanha, que gera tentativas', async ({ page }) => {
  const ts = Date.now();
  await login(page);
  const strategyName = `E2E 24x7 ${ts}`;
  await createAlwaysOnStrategy(page.request, strategyName);

  // limpa rascunho anterior, se houver
  await page.request.delete('/api/campaign-draft');

  await page.goto('/campanhas/nova');
  await expect(page.getByRole('heading', { name: /Etapa 1 de 4: Mailing/ })).toBeVisible();

  // ---- Mailing: importar
  const csv = [
    'id;nome;telefone1;cidade',
    `E2E${ts}-001;Ana Teste;11987650001;Sao Paulo`,
    `E2E${ts}-002;Bruno Teste;11987650002;Sao Paulo`,
    `E2E${ts}-003;Carla Invalida;123;Rio`,
    `E2E${ts}-004;Diego Teste;11987650004;Rio`,
  ].join('\n');
  await page.getByLabel('Nome do mailing').fill(`Mailing E2E ${ts}`);
  await page.getByTestId('import-content').fill(csv);
  await page.getByRole('button', { name: 'Continuar para campos' }).click();
  await expect(page.getByRole('region', { name: 'Definição dos campos' })).toBeVisible();
  await page.getByRole('button', { name: 'Conferir registros' }).click();
  await expect(page.getByText('Inconsistentes')).toBeVisible();
  const importBtn = page.getByRole('button', { name: /Importar 3 válidos/ });
  await expect(importBtn).toBeVisible();
  await importBtn.click();
  const dialog = page.getByRole('dialog', { name: /Importar somente os registros válidos/ });
  await expect(dialog).toContainText('3');
  await dialog.getByRole('button', { name: /Importar 3 válidos/ }).click();

  // ---- Público: filtrar e criar lista
  await expect(page.getByRole('heading', { name: /Etapa 2 de 4: Público/ })).toBeVisible();
  await page.getByRole('radio', { name: /Filtrar e criar lista/ }).check();
  await page.getByLabel('Nome da lista').fill(`Lista E2E ${ts}`);
  await page.getByRole('button', { name: 'Adicionar filtro' }).click();
  await page.getByLabel('Campo do filtro 1').selectOption({ label: 'cidade' });
  await page.getByLabel('Valor do filtro 1').fill('Sao Paulo');
  await page.getByRole('button', { name: 'Aplicar filtros na prévia' }).click();
  await expect(page.getByTestId('preview-selected')).toHaveText('2');
  await page.getByRole('button', { name: 'Continuar para acionamento' }).click();

  // ---- Acionamento
  await expect(page.getByRole('heading', { name: /Etapa 3 de 4: Acionamento/ })).toBeVisible();
  await page.locator('#journey-group label').filter({ hasText: 'Discador' }).first().click();
  await page.getByRole('radio', { name: new RegExp(strategyName) }).check();
  await expect(page.getByText(`Resumo da estratégia ${strategyName}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continuar para campanha' }).click();

  // ---- Campanha: nome obrigatório
  await expect(page.getByRole('heading', { name: /Etapa 4 de 4: Campanha/ })).toBeVisible();
  await page.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(page.getByText('Informe o nome da campanha')).toBeVisible();
  await expect(page.getByLabel('Nome da campanha')).toBeFocused();
  await page.getByLabel('Nome da campanha').fill(`Campanha E2E ${ts}`);
  await expect(page.getByRole('region', { name: 'Quem será contatado' })).toContainText('2');
  await page.getByRole('button', { name: 'Criar e iniciar' }).click();

  // ---- Detalhe da campanha
  await expect(page).toHaveURL(/\/campanhas\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: new RegExp(`Campanha E2E ${ts}`) })).toBeVisible();
  await expect(page.getByTestId('operational-explanation')).not.toBeEmpty();
  await page.getByRole('tab', { name: 'Tentativas' }).click();
  const table = page.getByTestId('attempts-table');
  await expect(table).toBeVisible({ timeout: 60_000 });
  await expect(table.locator('tbody tr').first()).toBeVisible();

  // ---- Detalhe da tentativa
  await table.getByRole('button', { name: 'Ver tentativa' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Detalhe da tentativa' });
  await expect(drawer.getByText('O que aconteceu')).toBeVisible();
  await expect(drawer.getByText('Próxima ação')).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Linha do tempo' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // ---- Elegibilidade e indicadores renderizam
  await page.getByRole('tab', { name: 'Elegibilidade e reservas' }).click();
  await expect(page.getByText('Membros da base')).toBeVisible();
  await page.getByRole('tab', { name: 'Indicadores' }).click();
  await expect(page.getByText('Tentativas enviadas')).toBeVisible();
});
