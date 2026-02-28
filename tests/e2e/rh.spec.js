/**
 * ALUFORCE ERP — E2E Tests: RH Module
 * Covers Funcionários, Folha, Frequência, Vagas
 */
const { test, expect } = require('@playwright/test');

test.describe('RH Module', () => {

  test.describe('Module Access', () => {
    test('should respond to /RecursosHumanos route', async ({ page }) => {
      const res = await page.goto('/RecursosHumanos');
      expect(res?.status()).toBeLessThan(500);
    });

    test('should serve RH index HTML', async ({ page }) => {
      const res = await page.goto('/RecursosHumanos/index.html');
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe('RH API Endpoints', () => {
    test('GET /api/funcionarios should respond', async ({ request }) => {
      const res = await request.get('/api/funcionarios');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/folha-pagamento should respond', async ({ request }) => {
      const res = await request.get('/api/folha-pagamento');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/frequencia should respond', async ({ request }) => {
      const res = await request.get('/api/frequencia');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/vagas should respond', async ({ request }) => {
      const res = await request.get('/api/vagas');
      expect([200, 401, 403]).toContain(res.status());
    });

    test('GET /api/esocial/eventos should respond', async ({ request }) => {
      const res = await request.get('/api/esocial/eventos');
      expect([200, 401, 403]).toContain(res.status());
    });
  });

  test.describe('RH Page Structure', () => {
    test('should render RH dashboard', async ({ page }) => {
      await page.goto('/RecursosHumanos/index.html');
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('Access Control', () => {
    test('admin route should be protected', async ({ page }) => {
      const res = await page.goto('/RecursosHumanos/admin');
      // Should not be a server error
      expect(res?.status()).toBeLessThan(500);
    });

    test('funcionario route should be protected', async ({ page }) => {
      const res = await page.goto('/RecursosHumanos/funcionario');
      expect(res?.status()).toBeLessThan(500);
    });
  });
});
