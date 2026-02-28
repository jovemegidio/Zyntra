/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                                                                           ║
 * ║   ALUFORCE ERP - Visual Regression & Mobile Test Suite                    ║
 * ║   Playwright Configuration for Enterprise Mobile/Tablet Testing           ║
 * ║                                                                           ║
 * ║   © 2026 ALUFORCE - Sistema de Gestão Empresarial                        ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/mobile-tablet',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'test-results/results.json' }],
        ['junit', { outputFile: 'test-results/junit.xml' }]
    ],
    
    use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    
    /* Screenshot comparison settings */
    expect: {
        toHaveScreenshot: {
            maxDiffPixels: 100,
            threshold: 0.2,
        },
    },

    /* Configure projects for major browsers and devices */
    projects: [
        /* ========== MOBILE DEVICES ========== */
        {
            name: 'Mobile Chrome - iPhone SE',
            use: { 
                ...devices['iPhone SE'],
                viewport: { width: 375, height: 667 },
            },
        },
        {
            name: 'Mobile Chrome - iPhone 12',
            use: { 
                ...devices['iPhone 12'],
                viewport: { width: 390, height: 844 },
            },
        },
        {
            name: 'Mobile Chrome - iPhone 12 Pro Max',
            use: { 
                ...devices['iPhone 12 Pro Max'],
                viewport: { width: 428, height: 926 },
            },
        },
        {
            name: 'Mobile Chrome - Pixel 5',
            use: { 
                ...devices['Pixel 5'],
                viewport: { width: 393, height: 851 },
            },
        },
        {
            name: 'Mobile Chrome - Galaxy S21',
            use: {
                viewport: { width: 360, height: 800 },
                userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
            },
        },

        /* ========== TABLET DEVICES ========== */
        {
            name: 'Tablet - iPad Mini Portrait',
            use: { 
                ...devices['iPad Mini'],
                viewport: { width: 768, height: 1024 },
            },
        },
        {
            name: 'Tablet - iPad Mini Landscape',
            use: { 
                ...devices['iPad Mini landscape'],
                viewport: { width: 1024, height: 768 },
            },
        },
        {
            name: 'Tablet - iPad Pro 11 Portrait',
            use: { 
                ...devices['iPad Pro 11'],
                viewport: { width: 834, height: 1194 },
            },
        },
        {
            name: 'Tablet - iPad Pro 11 Landscape',
            use: { 
                ...devices['iPad Pro 11 landscape'],
                viewport: { width: 1194, height: 834 },
            },
        },
        {
            name: 'Tablet - Galaxy Tab S7',
            use: {
                viewport: { width: 800, height: 1280 },
                userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
                deviceScaleFactor: 2,
                isMobile: true,
                hasTouch: true,
            },
        },

        /* ========== DESKTOP REFERENCE ========== */
        {
            name: 'Desktop Chrome',
            use: { 
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
            },
        },
        {
            name: 'Desktop - Laptop',
            use: { 
                viewport: { width: 1366, height: 768 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
        },
    ],

    /* Run local dev server before starting the tests */
    webServer: {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
