/**
 * ALUFORCE ERP — E2E Tests: Financeiro Module
 * Covers Contas a Pagar/Receber, DRE, Conciliação, Fluxo de Caixa
 */
const { test, expect } = require('@playwright/test');

test.describe('Financeiro Module', () => {

  test.describe('Module Access', () => {
    test('should respond to /Financeiro route', async ({ page }) => {
      const res = await page.goto('/Financeiro');
      expect(res?.status()).toBeLessThan(500);
    });

    test('should serve Financeiro index HTML', async ({ page }) => {
      const res = await page.goto('/Financeiro/index.html');
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe('Financeiro API Endpoints', () => {
    test('GET /api/financeiro/contas-pagar should respond', async ({ request }) => {
      const res = await request.get('/api/financeiro/contas-pagar');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/financeiro/contas-receber should respond', async ({ request }) => {
      const res = await request.get('/api/financeiro/contas-receber');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/financeiro/dre should respond', async ({ request }) => {
      const res = await request.get('/api/financeiro/dre');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/financeiro/fluxo-caixa should respond', async ({ request }) => {
      const res = await request.get('/api/financeiro/fluxo-caixa');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/financeiro/categorias should respond', async ({ request }) => {
      const res = await request.get('/api/financeiro/categorias');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/conciliacao-bancaria should respond', async ({ request }) => {
      const res = await request.get('/api/conciliacao-bancaria');
      expect([200, 401, 403]).toContain(res.status());
    });
  });

  test.describe('Financeiro Page Structure', () => {
    test('should render financial dashboard', async ({ page }) => {
      await page.goto('/Financeiro/index.html');
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body');
      await expect(body).toBeVisible();
      const text = await body.textContent();
      expect(text.length).toBeGreaterThan(0);
    });
  });

  test.describe('API Data Contract', () => {
    test('POST /api/financeiro/contas-pagar should reject invalid body', async ({ request }) => {
      const res = await request.post('/api/financeiro/contas-pagar', { data: {} });
      expect([400, 401, 403, 422]).toContain(res.status());
    });
  });
});
