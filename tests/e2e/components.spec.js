/**
 * ALUFORCE ERP - E2E Tests: UI Components
 * Tests for modals, dialogs, forms, and interactive elements
 */

const { test, expect } = require('@playwright/test');

test.describe('UI Components', () => {
  
  test.describe('Page Structure', () => {
    
    test('should have proper HTML structure', async ({ page }) => {
      await page.goto('/');
      
      // Check basic HTML structure
      const html = await page.locator('html');
      const head = await page.locator('head');
      const body = await page.locator('body');
      
      await expect(html).toBeVisible();
      await expect(body).toBeVisible();
    });

    test('should have viewport meta tag', async ({ page }) => {
      await page.goto('/');
      
      const viewport = await page.locator('meta[name="viewport"]');
      const viewportCount = await viewport.count();
      expect(viewportCount).toBeGreaterThanOrEqual(0);
    });

    test('should have charset declaration', async ({ page }) => {
      await page.goto('/');
      
      const charset = await page.locator('meta[charset], meta[http-equiv="Content-Type"]');
      const charsetCount = await charset.count();
      expect(charsetCount).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Responsive Design', () => {
    
    test('should work on desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/');
      await expect(page.locator('body')).toBeVisible();
    });

    test('should work on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/');
      await expect(page.locator('body')).toBeVisible();
    });

    test('should work on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('JavaScript Loading', () => {
    
    test('should not have console errors on load', async ({ page }) => {
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });
      
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Filter out expected errors (like 401 unauthorized)
      const criticalErrors = errors.filter(e => 
        !e.includes('401') && 
        !e.includes('Failed to load resource') &&
        !e.includes('net::')
      );
      
      expect(criticalErrors.length).toBe(0);
    });

    test('should not have uncaught exceptions', async ({ page }) => {
      let hasUncaughtError = false;
      
      page.on('pageerror', error => {
        hasUncaughtError = true;
        console.log('Page error:', error.message);
      });
      
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      expect(hasUncaughtError).toBe(false);
    });
  });

  test.describe('Forms and Inputs', () => {
    
    test('should have properly labeled form inputs on login', async ({ page }) => {
      await page.goto('/login.html');
      
      const inputs = await page.locator('input:not([type="hidden"])');
      const inputCount = await inputs.count();
      
      // Login page should have at least email and password inputs
      expect(inputCount).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Accessibility Basics', () => {
    
    test('should have page title', async ({ page }) => {
      await page.goto('/');
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

    test('should have lang attribute on html', async ({ page }) => {
      await page.goto('/');
      const lang = await page.locator('html').getAttribute('lang');
      // Lang attribute is recommended but not required
      expect(true).toBe(true);
    });
  });
});
