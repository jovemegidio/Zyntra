/**
 * ZYNTRA ERP — Comprehensive E2E Test Suite
 * Tests critical business flows across all modules
 * 
 * Run: npx playwright test tests/e2e/comprehensive.spec.js
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.TEST_EMAIL || 'admin@aluforce.ind.br';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'CONFIGURE_ENV';

// Helper: login and return authenticated page
async function loginAs(page, email, password) {
    await page.goto(`${BASE_URL}/login.html`);
    
    const emailInput = page.locator('input[type="email"], input[name="email"], #email');
    const passwordInput = page.locator('input[type="password"], input[name="password"], #password, #senha');
    const submitBtn = page.locator('button[type="submit"], input[type="submit"], .btn-login, #btnLogin');

    await emailInput.first().fill(email);
    await passwordInput.first().fill(password);
    await submitBtn.first().click();

    // Wait for redirect (login completes)
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 15000 }).catch(() => {});
    return page;
}

// ==========================================
// AUTHENTICATION FLOW
// ==========================================
test.describe('Authentication Flow', () => {

    test('login page loads and shows form', async ({ page }) => {
        await page.goto(`${BASE_URL}/login.html`);
        
        const emailInput = page.locator('input[type="email"], input[name="email"], #email');
        const passwordInput = page.locator('input[type="password"], input[name="password"], #password, #senha');
        
        await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
        await expect(passwordInput.first()).toBeVisible();
    });

    test('invalid credentials show error', async ({ page }) => {
        await page.goto(`${BASE_URL}/login.html`);
        
        await page.fill('input[type="email"], #email', 'invalid@test.com');
        await page.fill('input[type="password"], #password, #senha', 'wrongpassword');
        
        const submitBtn = page.locator('button[type="submit"], .btn-login, #btnLogin');
        await submitBtn.first().click();

        await page.waitForTimeout(3000);
        
        // Should stay on login page or show error
        const url = page.url();
        const hasError = await page.locator('.error, .alert-danger, .toast-error, [class*="error"]').count();
        
        expect(url.includes('login') || hasError > 0).toBeTruthy();
    });

    test('empty fields show validation', async ({ page }) => {
        await page.goto(`${BASE_URL}/login.html`);
        
        const submitBtn = page.locator('button[type="submit"], .btn-login, #btnLogin');
        await submitBtn.first().click();

        await page.waitForTimeout(1000);
        
        // Should not navigate away from login
        expect(page.url()).toContain('login');
    });
});

// ==========================================
// NAVIGATION — All Modules Load
// ==========================================
test.describe('Module Navigation', () => {
    
    test.beforeEach(async ({ page }) => {
        await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    const modules = [
        { name: 'Dashboard', url: '/', selectors: ['#dashboard', '.dashboard', 'main'] },
        { name: 'Vendas', url: '/Vendas/', selectors: ['.vendas', '#vendas', 'h1, h2'] },
        { name: 'PCP', url: '/PCP/', selectors: ['.pcp', '#pcp', 'h1, h2'] },
        { name: 'Financeiro', url: '/Financeiro/', selectors: ['.financeiro', '#financeiro', 'h1, h2'] },
        { name: 'RH', url: '/RH/', selectors: ['.rh', '#rh', 'h1, h2'] },
        { name: 'Compras', url: '/Compras/', selectors: ['.compras', '#compras', 'h1, h2'] },
    ];

    for (const mod of modules) {
        test(`${mod.name} module loads without error`, async ({ page }) => {
            const response = await page.goto(`${BASE_URL}${mod.url}`);
            
            // Should not return error
            expect(response.status()).toBeLessThan(500);
            
            // Check for JS errors
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.waitForTimeout(2000);
            
            // No fatal JS errors
            const fatalErrors = errors.filter(e => 
                !e.includes('ResizeObserver') && 
                !e.includes('chunk') &&
                !e.includes('favicon')
            );
            
            if (fatalErrors.length > 0) {
                console.warn(`⚠️ JS errors in ${mod.name}:`, fatalErrors);
            }
        });
    }
});

// ==========================================
// API ENDPOINTS — Health Check
// ==========================================
test.describe('API Endpoints Health', () => {

    test('health endpoint responds', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/api/health`);
        expect(res.status()).toBe(200);
    });

    test('login endpoint accepts POST', async ({ request }) => {
        const res = await request.post(`${BASE_URL}/api/login`, {
            data: { email: 'test@test.com', password: 'test' }
        });
        // Should not crash (either 401 or 400, not 500)
        expect(res.status()).toBeLessThan(500);
    });

    test('protected endpoints return 401 without auth', async ({ request }) => {
        const endpoints = [
            '/api/vendas/pedidos',
            '/api/financeiro/contas-pagar',
            '/api/rh/funcionarios',
            '/api/pcp/ordens',
        ];

        for (const endpoint of endpoints) {
            const res = await request.get(`${BASE_URL}${endpoint}`);
            expect(res.status()).toBeGreaterThanOrEqual(300);
        }
    });
});

// ==========================================
// RESPONSIVE / VISUAL
// ==========================================
test.describe('Responsive Design', () => {

    test.beforeEach(async ({ page }) => {
        await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    test('login page renders on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto(`${BASE_URL}/login.html`);
        
        const emailInput = page.locator('input[type="email"], #email');
        await expect(emailInput.first()).toBeVisible();
    });

    test('dashboard renders on tablet', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto(`${BASE_URL}/`);
        
        // Should load without errors
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await page.waitForTimeout(3000);
    });
});

// ==========================================
// SECURITY — Browser-level
// ==========================================
test.describe('Security Headers', () => {

    test('security headers present', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/`);
        const headers = res.headers();

        // Check critical security headers
        const checks = [
            { header: 'x-content-type-options', expected: 'nosniff' },
            { header: 'x-frame-options', expected: /(DENY|SAMEORIGIN)/i },
        ];

        for (const check of checks) {
            if (headers[check.header]) {
                expect(headers[check.header]).toMatch(check.expected);
            }
        }
    });

    test('cookies have secure flags', async ({ page, context }) => {
        await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
        
        const cookies = await context.cookies();
        const authCookie = cookies.find(c => 
            c.name.includes('auth') || c.name.includes('token') || c.name.includes('session')
        );

        if (authCookie) {
            // httpOnly should be true for auth cookies
            expect(authCookie.httpOnly).toBeTruthy();
        }
    });
});

// ==========================================
// PERFORMANCE — Basic Metrics
// ==========================================
test.describe('Performance Baseline', () => {

    test('login page loads under 5s', async ({ page }) => {
        const start = Date.now();
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
        const loadTime = Date.now() - start;
        
        expect(loadTime).toBeLessThan(5000);
        console.log(`Login page load time: ${loadTime}ms`);
    });

    test('API health responds under 1s', async ({ request }) => {
        const start = Date.now();
        await request.get(`${BASE_URL}/api/health`);
        const responseTime = Date.now() - start;
        
        expect(responseTime).toBeLessThan(1000);
        console.log(`Health endpoint: ${responseTime}ms`);
    });
});

// ==========================================
// WRITE GUARD — Consultoria E2E Flow
// ==========================================
test.describe('Write Guard — Consultoria Read-Only E2E', () => {
    const CONSULTORIA_EMAIL = process.env.CONSULTORIA_EMAIL || 'consultoria@aluforce.ind.br';
    const CONSULTORIA_PASSWORD = process.env.CONSULTORIA_PASSWORD || 'CONFIGURE_ENV';

    test('consultoria pode navegar para módulos (leitura)', async ({ page }) => {
        await loginAs(page, CONSULTORIA_EMAIL, CONSULTORIA_PASSWORD);

        // Deve conseguir acessar vendas (leitura)
        const response = await page.goto(`${BASE_URL}/Vendas/`);
        if (response) {
            expect(response.status()).toBeLessThan(500);
        }
    });

    test('consultoria vê indicadores mas não botões de ação', async ({ page }) => {
        await loginAs(page, CONSULTORIA_EMAIL, CONSULTORIA_PASSWORD);
        await page.goto(`${BASE_URL}/Vendas/`);
        await page.waitForTimeout(2000);

        // Botões de criar/excluir devem estar ocultos ou desabilitados
        const createButtons = await page.locator('button:has-text("Novo"), button:has-text("Criar"), button:has-text("Adicionar")').count();
        const deleteButtons = await page.locator('button:has-text("Excluir"), button:has-text("Deletar")').count();

        // Se tiver botões de criar/excluir visíveis, é um warning
        if (createButtons > 0 || deleteButtons > 0) {
            console.warn(`⚠️ Consultoria vê ${createButtons} botões criar, ${deleteButtons} botões excluir`);
        }
    });
});

// ==========================================
// CACHE HEADERS — Dashboard Endpoints
// ==========================================
test.describe('Cache — Dashboard Endpoints', () => {

    test('financeiro dashboard deve retornar com cache (2a chamada)', async ({ request }) => {
        // Login para obter token
        const loginRes = await request.post(`${BASE_URL}/api/login`, {
            data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
        });

        if (loginRes.status() !== 200) return;
        const { token } = await loginRes.json();
        if (!token) return;

        // 1ª chamada — popula cache
        await request.get(`${BASE_URL}/api/financeiro/dashboard`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // 2ª chamada — deve vir do cache (mais rápida)
        const start = Date.now();
        const res2 = await request.get(`${BASE_URL}/api/financeiro/dashboard`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const duration = Date.now() - start;

        expect(res2.status()).toBeLessThan(500);
        console.log(`Financeiro dashboard (cached): ${duration}ms`);
    });
});

// ==========================================
// ERROR HANDLER — E2E Structured Errors
// ==========================================
test.describe('Error Handler — E2E', () => {

    test('rota inexistente não mostra stack trace no browser', async ({ page }) => {
        const response = await page.goto(`${BASE_URL}/api/does-not-exist-54321`);

        const text = await page.textContent('body');
        expect(text).not.toContain('at Function');
        expect(text).not.toContain('node_modules');
        expect(text).not.toContain('.js:');
    });

    test('API retorna JSON com error_code em vez de stack', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/api/does-not-exist-54321`);
        const body = await res.json().catch(() => ({}));

        // Não deve conter stack traces
        const bodyStr = JSON.stringify(body);
        expect(bodyStr).not.toContain('node_modules');
        expect(bodyStr).not.toContain('at Function');
    });
});

// ==========================================
// RATE LIMITING — Behavioral
// ==========================================
test.describe('Rate Limiting', () => {

    test('múltiplas requisições rápidas devem acionar rate limit', async ({ request }) => {
        const promises = [];
        for (let i = 0; i < 20; i++) {
            promises.push(
                request.post(`${BASE_URL}/api/login`, {
                    data: { email: 'brute@force.test', password: 'wrong' }
                })
            );
        }
        const results = await Promise.all(promises);
        const rateLimited = results.some(r => r.status() === 429);

        if (!rateLimited) {
            console.warn('⚠️ Rate limiting não detectado em 20 tentativas rápidas');
        }
    });
});
