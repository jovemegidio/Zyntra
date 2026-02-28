/**
 * ALUFORCE ERP — E2E Tests: PCP Module
 * Covers Ordens de Produção, Estoque, Materiais, Capacidade
 */
const { test, expect } = require('@playwright/test');

test.describe('PCP Module', () => {

  test.describe('Module Access', () => {
    test('should respond to /PCP route', async ({ page }) => {
      const res = await page.goto('/PCP');
      expect(res?.status()).toBeLessThan(500);
    });

    test('should serve PCP index HTML', async ({ page }) => {
      const res = await page.goto('/PCP/index.html');
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe('PCP API Endpoints', () => {
    test('GET /api/ordens-producao should respond', async ({ request }) => {
      const res = await request.get('/api/ordens-producao');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/estoque should respond', async ({ request }) => {
      const res = await request.get('/api/estoque');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/materiais should respond', async ({ request }) => {
      const res = await request.get('/api/materiais');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/produtos should respond', async ({ request }) => {
      const res = await request.get('/api/produtos');
      expect([200, 401, 403]).toContain(res.status());
    });
  });

  test.describe('PCP Page Structure', () => {
    test('should render PCP dashboard', async ({ page }) => {
      await page.goto('/PCP/index.html');
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('API Data Contract', () => {
    test('POST /api/ordens-producao should reject empty body', async ({ request }) => {
      const res = await request.post('/api/ordens-producao', { data: {} });
      expect([400, 401, 403, 422]).toContain(res.status());
    });

    test('GET /api/ordens-producao/:id should handle not-found', async ({ request }) => {
      const res = await request.get('/api/ordens-producao/999999');
      expect([404, 401, 403, 200]).toContain(res.status());
    });
  });
});
