/**
 * ALUFORCE ERP — E2E Tests: API Health & Observability
 * Covers /api/health, /metrics, performance baselines
 */
const { test, expect } = require('@playwright/test');

test.describe('API Health & Observability', () => {

  test.describe('Health Endpoint', () => {
    test('GET /api/health should return 200', async ({ request }) => {
      const res = await request.get('/api/health');
      expect(res.status()).toBe(200);
    });

    test('/api/health should return JSON with status', async ({ request }) => {
      const res = await request.get('/api/health');
      const body = await res.json();
      expect(body).toHaveProperty('status');
    });

    test('/api/health should include uptime', async ({ request }) => {
      const res = await request.get('/api/health');
      const body = await res.json();
      expect(body.uptime).toBeDefined();
    });

    test('/api/health should include memory info', async ({ request }) => {
      const res = await request.get('/api/health');
      const body = await res.json();
      expect(body.memory || body.memoryUsage).toBeDefined();
    });
  });

  test.describe('Metrics Endpoint', () => {
    test('GET /metrics should return 200', async ({ request }) => {
      const res = await request.get('/metrics');
      expect(res.status()).toBe(200);
    });

    test('/metrics should return Prometheus text format', async ({ request }) => {
      const res = await request.get('/metrics');
      const contentType = res.headers()['content-type'];
      expect(contentType).toContain('text/plain');
    });

    test('/metrics should contain process_uptime_seconds', async ({ request }) => {
      const res = await request.get('/metrics');
      const text = await res.text();
      expect(text).toContain('process_uptime_seconds');
    });

    test('/metrics should contain http_requests_total', async ({ request }) => {
      const res = await request.get('/metrics');
      const text = await res.text();
      expect(text).toContain('http_requests_total');
    });

    test('/metrics should contain db_pool metrics', async ({ request }) => {
      const res = await request.get('/metrics');
      const text = await res.text();
      expect(text).toContain('db_pool_');
    });
  });

  test.describe('Performance Baselines', () => {
    test('/api/health should respond under 500ms', async ({ request }) => {
      const start = Date.now();
      await request.get('/api/health');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    test('root page should respond under 2000ms', async ({ page }) => {
      const start = Date.now();
      await page.goto('/');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });
  });

  test.describe('Error Handling', () => {
    test('should return 404 for unknown API route', async ({ request }) => {
      const res = await request.get('/api/rota-inexistente-xyz');
      expect([404, 401]).toContain(res.status());
    });

    test('should not expose stack trace on error', async ({ request }) => {
      const res = await request.get('/api/rota-inexistente-xyz');
      const text = await res.text();
      expect(text).not.toContain('at Object.');
      expect(text).not.toContain('node_modules');
    });
  });
});
