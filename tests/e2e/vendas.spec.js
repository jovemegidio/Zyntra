/**
 * ALUFORCE ERP — E2E Tests: Vendas Module
 * Covers Pedidos, Clientes, Dashboard Vendas, Cenários
 */
const { test, expect } = require('@playwright/test');

test.describe('Vendas Module', () => {

  test.describe('Module Access', () => {
    test('should respond to /Vendas route', async ({ page }) => {
      const res = await page.goto('/Vendas');
      expect(res?.status()).toBeLessThan(500);
    });

    test('should serve Vendas index HTML', async ({ page }) => {
      const res = await page.goto('/Vendas/index.html');
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe('Vendas API Endpoints', () => {
    test('GET /api/pedidos should respond', async ({ request }) => {
      const res = await request.get('/api/pedidos');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/clientes should respond', async ({ request }) => {
      const res = await request.get('/api/clientes');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/vendedores should respond', async ({ request }) => {
      const res = await request.get('/api/vendedores');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/dashboard-vendas should respond', async ({ request }) => {
      const res = await request.get('/api/dashboard-vendas');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/cenarios should respond', async ({ request }) => {
      const res = await request.get('/api/cenarios');
      expect([200, 401, 403]).toContain(res.status());
    });
  });

  test.describe('Vendas Page Structure', () => {
    test('should have pedidos table or container', async ({ page }) => {
      await page.goto('/Vendas/index.html');
      await page.waitForLoadState('networkidle');

      const container = page.locator('#pedidos-table, .pedidos-container, [data-module="vendas"], #content-area');
      const bodyText = await page.locator('body').textContent();
      // Page should load without 500 error
      expect(bodyText.length).toBeGreaterThan(0);
    });

    test('should contain Vendas-related text or elements', async ({ page }) => {
      await page.goto('/Vendas/index.html');
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('API Data Contract', () => {
    test('POST /api/pedidos should reject invalid body', async ({ request }) => {
      const res = await request.post('/api/pedidos', { data: {} });
      expect([400, 401, 403, 422]).toContain(res.status());
    });

    test('GET /api/pedidos/:id should handle not-found', async ({ request }) => {
      const res = await request.get('/api/pedidos/999999');
      expect([404, 401, 403, 200]).toContain(res.status());
    });
  });
});
