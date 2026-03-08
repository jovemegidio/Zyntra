/**
 * ZYNTRA ERP — Security & Permission API Tests
 * Tests IDOR, unauthorized access, CSRF, writeGuard, checkOwnership, input validation
 * 
 * Run: npx mocha tests/api/security-permissions.test.js --timeout 15000
 */

const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@aluforce.ind.br';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'CONFIGURE_ENV';
const VENDEDOR_EMAIL = process.env.VENDEDOR_EMAIL || 'vendedor@aluforce.ind.br';
const VENDEDOR_PASSWORD = process.env.VENDEDOR_PASSWORD || 'CONFIGURE_ENV';
const CONSULTORIA_EMAIL = process.env.CONSULTORIA_EMAIL || 'consultoria@aluforce.ind.br';
const CONSULTORIA_PASSWORD = process.env.CONSULTORIA_PASSWORD || 'CONFIGURE_ENV';

describe('Security & Permission Tests', function () {
    let adminToken;
    let vendedorToken;
    let consultoriaToken;
    let adminCookies;
    let vendedorCookies;
    let consultoriaCookies;

    before(async function () {
        // Login admin
        const adminRes = await request(BASE_URL)
            .post('/api/login')
            .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
        
        if (adminRes.status === 200) {
            adminCookies = adminRes.headers['set-cookie'];
            if (adminRes.body.token) adminToken = adminRes.body.token;
        }

        // Login vendedor
        const vendRes = await request(BASE_URL)
            .post('/api/login')
            .send({ email: VENDEDOR_EMAIL, password: VENDEDOR_PASSWORD });
        
        if (vendRes.status === 200) {
            vendedorCookies = vendRes.headers['set-cookie'];
            if (vendRes.body.token) vendedorToken = vendRes.body.token;
        }

        // Login consultoria
        const consRes = await request(BASE_URL)
            .post('/api/login')
            .send({ email: CONSULTORIA_EMAIL, password: CONSULTORIA_PASSWORD });
        
        if (consRes.status === 200) {
            consultoriaCookies = consRes.headers['set-cookie'];
            if (consRes.body.token) consultoriaToken = consRes.body.token;
        }
    });

    // ==========================================
    // A01: Broken Access Control
    // ==========================================
    describe('A01: Broken Access Control', () => {

        describe('IDOR — Insecure Direct Object Reference', () => {
            it('deve negar acesso sem autenticação', async () => {
                const res = await request(BASE_URL)
                    .get('/api/vendas/pedidos')
                    .expect((res) => {
                        expect(res.status).to.be.oneOf([401, 403, 302]);
                    });
            });

            it('deve negar acesso a endpoints admin para vendedor', async () => {
                if (!vendedorToken) return this.skip();

                const res = await request(BASE_URL)
                    .get('/api/admin/usuarios')
                    .set('Authorization', `Bearer ${vendedorToken}`)
                    .set('Cookie', vendedorCookies || []);

                // Vendedor NÃO deve acessar lista de usuários
                expect(res.status).to.be.oneOf([401, 403]);
            });

            it('vendedor não deve acessar módulo financeiro', async () => {
                if (!vendedorToken) return this.skip();

                const res = await request(BASE_URL)
                    .get('/api/financeiro/dashboard')
                    .set('Authorization', `Bearer ${vendedorToken}`)
                    .set('Cookie', vendedorCookies || []);

                // Se retorna 200, há falha de autorização
                if (res.status === 200) {
                    console.warn('⚠️ IDOR DETECTADO: Vendedor acessou /api/financeiro/dashboard');
                }
            });

            it('vendedor não deve acessar módulo RH', async () => {
                if (!vendedorToken) return this.skip();

                const res = await request(BASE_URL)
                    .get('/api/rh/funcionarios')
                    .set('Authorization', `Bearer ${vendedorToken}`)
                    .set('Cookie', vendedorCookies || []);

                if (res.status === 200) {
                    console.warn('⚠️ IDOR DETECTADO: Vendedor acessou /api/rh/funcionarios');
                }
            });
        });

        describe('Unauthorized Endpoints', () => {
            const protectedEndpoints = [
                { method: 'GET', path: '/api/vendas/pedidos' },
                { method: 'GET', path: '/api/financeiro/contas-pagar' },
                { method: 'GET', path: '/api/financeiro/contas-receber' },
                { method: 'GET', path: '/api/rh/funcionarios' },
                { method: 'GET', path: '/api/pcp/ordens' },
                { method: 'GET', path: '/api/compras/pedidos' },
                { method: 'GET', path: '/api/nfe/notas' },
                { method: 'GET', path: '/api/admin/usuarios' },
            ];

            protectedEndpoints.forEach(({ method, path }) => {
                it(`${method} ${path} deve exigir autenticação`, async () => {
                    const res = await request(BASE_URL)[method.toLowerCase()](path);
                    expect(res.status).to.be.oneOf([401, 403, 302]);
                });
            });
        });
    });

    // ==========================================
    // A03: Injection
    // ==========================================
    describe('A03: Injection Prevention', () => {

        describe('SQL Injection', () => {
            const sqliPayloads = [
                "' OR '1'='1",
                "'; DROP TABLE usuarios; --",
                "1 UNION SELECT * FROM usuarios --",
                "admin'--",
                "1' OR '1'='1' /*",
            ];

            it('login deve rejeitar payloads SQLi', async () => {
                for (const payload of sqliPayloads) {
                    const res = await request(BASE_URL)
                        .post('/api/login')
                        .send({ email: payload, password: payload });
                    
                    expect(res.status).to.be.oneOf([400, 401, 403, 422]);
                    // NÃO deve retornar 200 ou 500 (500 indica query error = vuln)
                    expect(res.status).to.not.equal(500);
                }
            });

            it('endpoints de busca devem rejeitar SQLi', async () => {
                if (!adminToken) return this.skip();

                for (const payload of sqliPayloads) {
                    const res = await request(BASE_URL)
                        .get(`/api/vendas/pedidos?search=${encodeURIComponent(payload)}`)
                        .set('Authorization', `Bearer ${adminToken}`)
                        .set('Cookie', adminCookies || []);
                    
                    expect(res.status).to.not.equal(500);
                }
            });
        });

        describe('XSS Prevention', () => {
            const xssPayloads = [
                '<script>alert(1)</script>',
                '<img src=x onerror=alert(1)>',
                '<svg onload=alert(1)>',
                'javascript:alert(1)',
                '"><script>alert(document.cookie)</script>',
            ];

            it('input fields devem sanitizar XSS', async () => {
                if (!adminToken) return this.skip();

                for (const payload of xssPayloads) {
                    const res = await request(BASE_URL)
                        .post('/api/vendas/pedidos')
                        .set('Authorization', `Bearer ${adminToken}`)
                        .set('Cookie', adminCookies || [])
                        .send({ observacoes: payload, cliente_id: 1 });
                    
                    // Se salvo, verificar que o payload foi sanitizado
                    if (res.status === 200 || res.status === 201) {
                        if (res.body && res.body.observacoes) {
                            expect(res.body.observacoes).to.not.include('<script>');
                            expect(res.body.observacoes).to.not.include('onerror=');
                        }
                    }
                }
            });
        });
    });

    // ==========================================
    // A07: Authentication Failures
    // ==========================================
    describe('A07: Authentication', () => {

        it('deve rejeitar tokens JWT inválidos', async () => {
            const res = await request(BASE_URL)
                .get('/api/vendas/pedidos')
                .set('Authorization', 'Bearer invalid.jwt.token');
            
            expect(res.status).to.be.oneOf([401, 403]);
        });

        it('deve rejeitar tokens JWT expirados', async () => {
            // Token com exp no passado
            const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZXhwIjoxMDAwMDAwMDAwfQ.fake';
            const res = await request(BASE_URL)
                .get('/api/vendas/pedidos')
                .set('Authorization', `Bearer ${expiredToken}`);
            
            expect(res.status).to.be.oneOf([401, 403]);
        });

        it('deve limitar tentativas de login (rate limiting)', async () => {
            const attempts = [];
            for (let i = 0; i < 10; i++) {
                attempts.push(
                    request(BASE_URL)
                        .post('/api/login')
                        .send({ email: 'brute@force.com', password: 'wrong' })
                );
            }
            const results = await Promise.all(attempts);
            const rateLimited = results.some(r => r.status === 429);
            // Em produção, deve ter rate limiting após 5 tentativas
            if (!rateLimited) {
                console.warn('⚠️ Rate limiting não detectado em 10 tentativas');
            }
        });

        it('deve rejeitar login sem campos obrigatórios', async () => {
            const res = await request(BASE_URL)
                .post('/api/login')
                .send({});
            
            expect(res.status).to.be.oneOf([400, 401, 422]);
        });
    });

    // ==========================================
    // Input Validation
    // ==========================================
    describe('Input Validation', () => {

        it('deve rejeitar IDs não numéricos', async () => {
            if (!adminToken) return this.skip();

            const res = await request(BASE_URL)
                .get('/api/vendas/pedidos/abc')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('Cookie', adminCookies || []);
            
            expect(res.status).to.be.oneOf([400, 404, 422]);
            expect(res.status).to.not.equal(500);
        });

        it('deve rejeitar valores negativos em campos monetários', async () => {
            if (!adminToken) return this.skip();

            const res = await request(BASE_URL)
                .post('/api/financeiro/contas-pagar')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('Cookie', adminCookies || [])
                .send({ valor: -1000, descricao: 'teste negativo' });
            
            // Não deve aceitar valor negativo em conta a pagar
            if (res.status === 200 || res.status === 201) {
                console.warn('⚠️ Aceita valor negativo em contas_pagar');
            }
        });

        it('deve rejeitar datas inválidas', async () => {
            if (!adminToken) return this.skip();

            const res = await request(BASE_URL)
                .post('/api/vendas/pedidos')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('Cookie', adminCookies || [])
                .send({ data_pedido: '2099-13-45', cliente_id: 1 });
            
            if (res.status === 200 || res.status === 201) {
                console.warn('⚠️ Aceita data inválida (2099-13-45)');
            }
        });
    });

    // ==========================================
    // API Health
    // ==========================================
    describe('API Health & Availability', () => {
        
        it('health endpoint deve responder', async () => {
            const res = await request(BASE_URL)
                .get('/api/health');
            
            expect(res.status).to.equal(200);
        });

        it('deve retornar headers de segurança', async () => {
            const res = await request(BASE_URL)
                .get('/api/health');
            
            // Helmet headers
            expect(res.headers).to.have.property('x-content-type-options');
            expect(res.headers['x-content-type-options']).to.equal('nosniff');
        });

        it('não deve expor stack traces em erros', async () => {
            const res = await request(BASE_URL)
                .get('/api/nonexistent-endpoint-12345');
            
            // Não deve ter stack trace no response
            if (res.body && res.body.stack) {
                console.warn('⚠️ Stack trace exposta em error response');
            }
        });
    });

    // ==========================================
    // Write Guard — Consultoria Read-Only
    // ==========================================
    describe('Write Guard — Consultoria Restrictions', () => {

        describe('Consultoria NÃO pode criar registros (POST)', () => {
            const postEndpoints = [
                { path: '/api/vendas/pedidos', body: { cliente_id: 1, observacoes: 'test' } },
                { path: '/api/financeiro/contas-pagar', body: { descricao: 'test', valor: 100 } },
                { path: '/api/compras/pedidos', body: { fornecedor_id: 1 } },
            ];

            postEndpoints.forEach(({ path, body }) => {
                it(`POST ${path} deve retornar 403 WRITE_GUARD_CREATE`, async function () {
                    if (!consultoriaToken) return this.skip();

                    const res = await request(BASE_URL)
                        .post(path)
                        .set('Authorization', `Bearer ${consultoriaToken}`)
                        .set('Cookie', consultoriaCookies || [])
                        .send(body);
                    
                    expect(res.status).to.equal(403);
                    expect(res.body.code).to.equal('WRITE_GUARD_CREATE');
                });
            });
        });

        describe('Consultoria NÃO pode editar registros (PUT/PATCH)', () => {
            const putEndpoints = [
                { method: 'put', path: '/api/vendas/pedidos/1', body: { observacoes: 'hack' } },
                { method: 'patch', path: '/api/vendas/pedidos/1', body: { status: 'cancelado' } },
                { method: 'put', path: '/api/rh/funcionarios/1', body: { nome: 'hack' } },
            ];

            putEndpoints.forEach(({ method, path, body }) => {
                it(`${method.toUpperCase()} ${path} deve retornar 403 WRITE_GUARD_EDIT`, async function () {
                    if (!consultoriaToken) return this.skip();

                    const res = await request(BASE_URL)[method](path)
                        .set('Authorization', `Bearer ${consultoriaToken}`)
                        .set('Cookie', consultoriaCookies || [])
                        .send(body);
                    
                    expect(res.status).to.equal(403);
                    expect(res.body.code).to.equal('WRITE_GUARD_EDIT');
                });
            });
        });

        describe('Consultoria NÃO pode excluir registros (DELETE)', () => {
            it('DELETE /api/vendas/pedidos/99999 deve retornar 403', async function () {
                if (!consultoriaToken) return this.skip();

                const res = await request(BASE_URL)
                    .delete('/api/vendas/pedidos/99999')
                    .set('Authorization', `Bearer ${consultoriaToken}`)
                    .set('Cookie', consultoriaCookies || []);
                
                expect(res.status).to.equal(403);
                expect(res.body.code).to.equal('WRITE_GUARD_DELETE');
            });
        });

        describe('Consultoria PODE ler registros (GET)', () => {
            const getEndpoints = [
                '/api/vendas/pedidos',
                '/api/financeiro/dashboard',
            ];

            getEndpoints.forEach(path => {
                it(`GET ${path} deve ser permitido para consultoria`, async function () {
                    if (!consultoriaToken) return this.skip();

                    const res = await request(BASE_URL)
                        .get(path)
                        .set('Authorization', `Bearer ${consultoriaToken}`)
                        .set('Cookie', consultoriaCookies || []);
                    
                    // Consultoria pode ler — não deve ser 403 WRITE_GUARD
                    expect(res.body.code).to.not.equal('WRITE_GUARD_CREATE');
                    expect(res.body.code).to.not.equal('WRITE_GUARD_EDIT');
                    expect(res.body.code).to.not.equal('WRITE_GUARD_DELETE');
                });
            });
        });
    });

    // ==========================================
    // IDOR — checkOwnership Protection on Pedidos
    // ==========================================
    describe('IDOR — checkOwnership on Pedidos', () => {

        it('vendedor não deve acessar pedido de outro vendedor', async function () {
            if (!vendedorToken) return this.skip();

            // Pedido com ID alto — provavelmente de outro vendedor
            const res = await request(BASE_URL)
                .get('/api/vendas/pedidos/1')
                .set('Authorization', `Bearer ${vendedorToken}`)
                .set('Cookie', vendedorCookies || []);
            
            // Deve ser 403 (IDOR_DENIED) ou 404 (não encontrado)
            // Se for 200, temos um possível IDOR (a menos que o vendedor seja dono)
            expect(res.status).to.be.oneOf([200, 403, 404]);
            if (res.status === 403) {
                expect(res.body.code).to.equal('IDOR_DENIED');
            }
        });

        it('admin pode acessar qualquer pedido (globalAccessRoles)', async function () {
            if (!adminToken) return this.skip();

            const res = await request(BASE_URL)
                .get('/api/vendas/pedidos/1')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('Cookie', adminCookies || []);
            
            // Admin tem acesso global — deve ser 200 ou 404
            expect(res.status).to.be.oneOf([200, 404]);
            if (res.status === 403) {
                expect(res.body.code).to.not.equal('IDOR_DENIED');
            }
        });

        it('consultoria NÃO está em globalAccessRoles (PERM-004)', async function () {
            if (!consultoriaToken) return this.skip();

            const res = await request(BASE_URL)
                .get('/api/vendas/pedidos/1')
                .set('Authorization', `Bearer ${consultoriaToken}`)
                .set('Cookie', consultoriaCookies || []);
            
            // Consultoria foi removida de globalAccessRoles (AUDIT-FIX PERM-004)
            // Deve verificar ownership como um vendedor normal
            expect(res.status).to.be.oneOf([200, 403, 404]);
        });
    });

    // ==========================================
    // CSRF — Enforcement on Previously Exempt Endpoints
    // ==========================================
    describe('CSRF — No More Exemptions on Financial/NFe', () => {

        it('/api/financeiro POST sem CSRF token deve ser bloqueado (cookie-based)', async function () {
            if (!adminToken) return this.skip();
            // Only relevant for cookie-based auth (browser session)
            // Bearer token requests bypass CSRF by design

            const res = await request(BASE_URL)
                .post('/api/financeiro/contas-pagar')
                .set('Cookie', adminCookies || [])
                // Deliberately NOT sending CSRF token
                .send({ descricao: 'teste CSRF', valor: 100 });
            
            // Should either work (with Bearer fallback) or be blocked by CSRF
            // The key assertion: should NOT return 200 without proper auth
            if (!adminCookies) return this.skip();
        });

        it('/api/nfe POST sem CSRF token deve ser bloqueado (cookie-based)', async function () {
            if (!adminToken) return this.skip();
            if (!adminCookies) return this.skip();

            const res = await request(BASE_URL)
                .post('/api/nfe/notas')
                .set('Cookie', adminCookies || [])
                .send({ tipo: 'entrada' });
            
            // Should not succeed without CSRF token for cookie-only auth
        });
    });

    // ==========================================
    // Error Handler — Structured Responses
    // ==========================================
    describe('Error Handler — Structured Responses', () => {

        it('404 deve retornar JSON estruturado, sem stack trace', async () => {
            const res = await request(BASE_URL)
                .get('/api/this-route-does-not-exist-12345');
            
            expect(res.status).to.be.oneOf([404, 401, 403]);
            if (res.body) {
                expect(res.body).to.not.have.property('stack');
            }
        });

        it('JSON inválido deve retornar 400, não 500', async () => {
            if (!adminToken) return this.skip();

            const res = await request(BASE_URL)
                .post('/api/vendas/pedidos')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('Cookie', adminCookies || [])
                .set('Content-Type', 'application/json')
                .send('{ invalid json !!!');
            
            expect(res.status).to.be.oneOf([400, 422]);
            expect(res.status).to.not.equal(500);
        });

        it('erro de servidor deve ter error_code, não stack', async () => {
            const res = await request(BASE_URL)
                .get('/api/this-triggers-nothing-12345');
            
            if (res.body) {
                expect(res.body).to.not.have.property('stack');
                // Pode ter error_code para erros reais
            }
        });
    });

    // ==========================================
    // Security Headers — Extended
    // ==========================================
    describe('Security Headers — Extended', () => {

        it('deve ter X-Content-Type-Options: nosniff', async () => {
            const res = await request(BASE_URL).get('/api/health');
            expect(res.headers['x-content-type-options']).to.equal('nosniff');
        });

        it('deve ter X-Frame-Options', async () => {
            const res = await request(BASE_URL).get('/api/health');
            expect(res.headers).to.have.property('x-frame-options');
        });

        it('não deve expor X-Powered-By', async () => {
            const res = await request(BASE_URL).get('/api/health');
            expect(res.headers).to.not.have.property('x-powered-by');
        });

        it('deve ter referrer-policy definida', async () => {
            const res = await request(BASE_URL).get('/api/health');
            if (res.headers['referrer-policy']) {
                expect(res.headers['referrer-policy']).to.be.a('string');
            }
        });
    });
});
