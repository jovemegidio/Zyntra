/**
 * ALUFORCE ERP — E2E Tests: NFe Module
 * Covers Notas Fiscais, Emissão, Consulta, DANFE
 */
const { test, expect } = require('@playwright/test');

test.describe('NFe Module', () => {

  test.describe('Module Access', () => {
    test('should respond to /NFe route', async ({ page }) => {
      const res = await page.goto('/NFe');
      expect(res?.status()).toBeLessThan(500);
    });

    test('should serve NFe index HTML', async ({ page }) => {
      const res = await page.goto('/NFe/index.html');
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe('NFe API Endpoints', () => {
    test('GET /api/nfe should respond', async ({ request }) => {
      const res = await request.get('/api/nfe');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/nfe/pendentes should respond', async ({ request }) => {
      const res = await request.get('/api/nfe/pendentes');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/nfe/emitidas should respond', async ({ request }) => {
      const res = await request.get('/api/nfe/emitidas');
      expect([200, 401, 403]).toContain(res.status());
    });
  });

  test.describe('NFe Page Structure', () => {
    test('should render NFe dashboard', async ({ page }) => {
      await page.goto('/NFe/index.html');
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('NFe API Data Contract', () => {
    test('GET /api/nfe/:id should handle not-found', async ({ request }) => {
      const res = await request.get('/api/nfe/999999');
      expect([404, 401, 403, 200]).toContain(res.status());
    });

    test('POST /api/nfe/emitir should reject empty body', async ({ request }) => {
      const res = await request.post('/api/nfe/emitir', { data: {} });
      expect([400, 401, 403, 422]).toContain(res.status());
    });
  });
});
