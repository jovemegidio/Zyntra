/**
 * ALUFORCE ERP — E2E Tests: Compras Module
 * Covers Fornecedores, Pedidos de Compra, Cotações
 */
const { test, expect } = require('@playwright/test');

test.describe('Compras Module', () => {

  test.describe('Module Access', () => {
    test('should respond to /Compras route', async ({ page }) => {
      const res = await page.goto('/Compras');
      expect(res?.status()).toBeLessThan(500);
    });

    test('should serve Compras index HTML', async ({ page }) => {
      const res = await page.goto('/Compras/index.html');
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe('Compras API Endpoints', () => {
    test('GET /api/fornecedores should respond', async ({ request }) => {
      const res = await request.get('/api/fornecedores');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/compras/pedidos should respond', async ({ request }) => {
      const res = await request.get('/api/compras/pedidos');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/compras/cotacoes should respond', async ({ request }) => {
      const res = await request.get('/api/compras/cotacoes');
      expect([200, 401, 403]).toContain(res.status());
    });
  });

  test.describe('Compras Page Structure', () => {
    test('should render Compras dashboard', async ({ page }) => {
      await page.goto('/Compras/index.html');
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body');
      await expect(body).toBeVisible();
      const text = await body.textContent();
      expect(text.length).toBeGreaterThan(0);
    });
  });

  test.describe('API Data Contract', () => {
    test('POST /api/compras/pedidos should reject empty body', async ({ request }) => {
      const res = await request.post('/api/compras/pedidos', { data: {} });
      expect([400, 401, 403, 422]).toContain(res.status());
    });
  });
});
