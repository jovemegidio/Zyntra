// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * ALUFORCE ERP - Playwright E2E Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'coverage/e2e-report', open: 'never' }],
    ['json', { outputFile: 'coverage/e2e-results.json' }],
    ['list']
  ],
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      DEV_MOCK: '1',
      NODE_ENV: 'test'
    }
  },
});
