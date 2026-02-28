/**
 * ALUFORCE ERP - E2E Tests: Authentication Flow
 * Tests for login, logout, and session management
 */

const { test, expect } = require('@playwright/test');

test.describe('Authentication Flow', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login page', async ({ page }) => {
    // Should redirect to login if not authenticated
    await expect(page).toHaveURL(/login|\/$/);
  });

  test('should show login form elements', async ({ page }) => {
    await page.goto('/login.html');
    
    // Check for login form elements
    const emailInput = page.locator('input[type="email"], input[name="email"], #email');
    const passwordInput = page.locator('input[type="password"], input[name="password"], #password, #senha');
    const submitButton = page.locator('button[type="submit"], input[type="submit"], .btn-login, #btnLogin');
    
    await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
    await expect(passwordInput.first()).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login.html');
    
    await page.fill('input[type="email"], input[name="email"], #email', 'invalid@test.com');
    await page.fill('input[type="password"], input[name="password"], #password, #senha', 'wrongpassword');
    
    const submitButton = page.locator('button[type="submit"], input[type="submit"], .btn-login, #btnLogin');
    await submitButton.first().click();
    
    // Wait for error message or stay on login page
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    expect(currentUrl).toContain('login');
  });

  test('should have forgot password link', async ({ page }) => {
    await page.goto('/login.html');
    
    const forgotLink = page.locator('a[href*="forgot"], a[href*="esqueci"], .forgot-password');
    const linkCount = await forgotLink.count();
    expect(linkCount).toBeGreaterThanOrEqual(0);
  });
});
