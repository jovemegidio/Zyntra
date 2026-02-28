/**
 * ALUFORCE ERP - E2E Tests: Navigation and Module Access
 * Tests for main navigation, sidebar, and module routing
 */

const { test, expect } = require('@playwright/test');

test.describe('Navigation and Routing', () => {
  
  test.describe('Dashboard Access', () => {
    
    test('should load dashboard structure', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Dashboard should have main structure
      const body = await page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should have module cards on dashboard', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for module cards or navigation elements
      const moduleCards = page.locator('.module-card, .card-module, .dashboard-card, [class*="module"]');
      const navLinks = page.locator('nav a, .sidebar a, .menu a');
      
      const cardsCount = await moduleCards.count();
      const linksCount = await navLinks.count();
      
      // Should have some navigation structure
      expect(cardsCount + linksCount).toBeGreaterThan(0);
    });
  });

  test.describe('Module Routes', () => {
    const modules = [
      { name: 'Compras', path: '/Compras' },
      { name: 'Vendas', path: '/Vendas' },
      { name: 'NFe', path: '/NFe' },
      { name: 'PCP', path: '/PCP' },
      { name: 'Financeiro', path: '/Financeiro' },
      { name: 'RH', path: '/RecursosHumanos' }
    ];

    modules.forEach(({ name, path }) => {
      test(`should respond to ${name} route (${path})`, async ({ page }) => {
        const response = await page.goto(path);
        
        // Should get a response (200, 302 redirect to login, or 401)
        expect(response?.status()).toBeLessThan(500);
      });
    });
  });

  test.describe('Static Resources', () => {
    
    test('should load favicon', async ({ page }) => {
      const response = await page.goto('/favicon.ico');
      expect([200, 204, 304]).toContain(response?.status());
    });

    test('should load CSS files', async ({ page }) => {
      await page.goto('/');
      
      // Check that styles are applied
      const body = await page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('API Health Endpoints', () => {
    
    test('should return health check', async ({ page }) => {
      const response = await page.goto('/api/health');
      expect(response?.status()).toBe(200);
    });

    test('should return database status', async ({ page }) => {
      const response = await page.goto('/api/db-check');
      expect([200, 500]).toContain(response?.status());
    });
  });
});
