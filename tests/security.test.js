/**
 * Testes para Middlewares de Segurança
 * 
 * Testa: CSRF, Rate Limiting, Audit Log
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// ========================================
// CSRF TESTS
// ========================================
describe('CSRF Protection', async () => {
    // Mock do módulo CSRF
    const { generateToken, csrfProtection, originValidation } = await import('../src/middleware/csrf.js');
    
    describe('generateToken', () => {
        it('deve gerar token com 64 caracteres hexadecimais', () => {
            const token = generateToken();
            assert.strictEqual(token.length, 64);
            assert.match(token, /^[a-f0-9]+$/);
        });
        
        it('deve gerar tokens únicos', () => {
            const tokens = new Set();
            for (let i = 0; i < 100; i++) {
                tokens.add(generateToken());
            }
            assert.strictEqual(tokens.size, 100);
        });
    });
    
    describe('csrfProtection middleware', () => {
        let mockReq, mockRes, nextCalled;
        
        beforeEach(() => {
            nextCalled = false;
            mockReq = {
                method: 'GET',
                path: '/api/test',
                headers: {},
                cookies: {}
            };
            mockRes = {
                statusCode: 200,
                cookie: mock.fn(),
                status: mock.fn(function(code) { this.statusCode = code; return this; }),
                json: mock.fn()
            };
        });
        
        it('deve permitir métodos GET sem validação', () => {
            const middleware = csrfProtection();
            mockReq.method = 'GET';
            
            middleware(mockReq, mockRes, () => { nextCalled = true; });
            
            assert.strictEqual(nextCalled, true);
        });
        
        it('deve permitir rotas ignoradas', () => {
            const middleware = csrfProtection({ ignorePaths: ['/api/login'] });
            mockReq.method = 'POST';
            mockReq.path = '/api/login';
            
            middleware(mockReq, mockRes, () => { nextCalled = true; });
            
            assert.strictEqual(nextCalled, true);
        });
        
        it('deve rejeitar POST sem token CSRF', () => {
            const middleware = csrfProtection();
            mockReq.method = 'POST';
            
            middleware(mockReq, mockRes, () => { nextCalled = true; });
            
            assert.strictEqual(nextCalled, false);
            assert.strictEqual(mockRes.statusCode, 403);
        });
    });
    
    describe('originValidation middleware', () => {
        let mockReq, mockRes, nextCalled;
        
        beforeEach(() => {
            nextCalled = false;
            mockReq = {
                method: 'POST',
                headers: {}
            };
            mockRes = {
                statusCode: 200,
                status: mock.fn(function(code) { this.statusCode = code; return this; }),
                json: mock.fn()
            };
        });
        
        it('deve permitir requisições da mesma origem', () => {
            const middleware = originValidation(['https://example.com']);
            mockReq.headers.origin = 'https://example.com';
            
            middleware(mockReq, mockRes, () => { nextCalled = true; });
            
            assert.strictEqual(nextCalled, true);
        });
        
        it('deve rejeitar origens não permitidas', () => {
            const middleware = originValidation(['https://example.com']);
            mockReq.headers.origin = 'https://malicious.com';
            
            middleware(mockReq, mockRes, () => { nextCalled = true; });
            
            assert.strictEqual(nextCalled, false);
            assert.strictEqual(mockRes.statusCode, 403);
        });
    });
});

// ========================================
// RATE LIMIT TESTS
// ========================================
describe('Rate Limiting', async () => {
    const { createRateLimiter, RATE_LIMITS, categorizeRoute } = await import('../src/middleware/rate-limit.js');
    
    describe('RATE_LIMITS configuração', () => {
        it('deve ter configurações para todas as categorias', () => {
            const requiredCategories = ['auth', 'financial', 'upload', 'write', 'read', 'general'];
            
            for (const category of requiredCategories) {
                assert.ok(RATE_LIMITS[category], `Falta categoria: ${category}`);
                assert.ok(RATE_LIMITS[category].max, `Falta max para ${category}`);
                assert.ok(RATE_LIMITS[category].windowMs, `Falta windowMs para ${category}`);
            }
        });
        
        it('auth deve ter o menor limite', () => {
            assert.ok(RATE_LIMITS.auth.max <= 10, 'Auth deve ter no máximo 10 tentativas');
        });
        
        it('read deve ter maior limite que write', () => {
            assert.ok(RATE_LIMITS.read.max > RATE_LIMITS.write.max);
        });
    });
    
    describe('categorizeRoute', () => {
        it('deve categorizar rotas de autenticação', () => {
            assert.strictEqual(categorizeRoute('/api/login', 'POST'), 'auth');
            assert.strictEqual(categorizeRoute('/api/auth/login', 'POST'), 'auth');
            assert.strictEqual(categorizeRoute('/api/logout', 'POST'), 'auth');
        });
        
        it('deve categorizar rotas financeiras', () => {
            assert.strictEqual(categorizeRoute('/api/financeiro/pagar', 'POST'), 'financial');
            assert.strictEqual(categorizeRoute('/api/pagamentos', 'POST'), 'financial');
            assert.strictEqual(categorizeRoute('/api/nfe/emitir', 'POST'), 'financial');
        });
        
        it('deve categorizar uploads', () => {
            assert.strictEqual(categorizeRoute('/api/upload', 'POST'), 'upload');
            assert.strictEqual(categorizeRoute('/api/files', 'POST'), 'upload');
        });
        
        it('deve categorizar operações de escrita', () => {
            assert.strictEqual(categorizeRoute('/api/pedidos', 'POST'), 'write');
            assert.strictEqual(categorizeRoute('/api/clientes/123', 'PUT'), 'write');
            assert.strictEqual(categorizeRoute('/api/produtos/456', 'DELETE'), 'write');
        });
        
        it('deve categorizar operações de leitura', () => {
            assert.strictEqual(categorizeRoute('/api/pedidos', 'GET'), 'read');
            assert.strictEqual(categorizeRoute('/api/clientes/123', 'GET'), 'read');
        });
    });
    
    describe('createRateLimiter', () => {
        it('deve criar middleware funcional', () => {
            const limiter = createRateLimiter({ max: 5, windowMs: 60000 });
            
            assert.strictEqual(typeof limiter, 'function');
            assert.strictEqual(limiter.length, 3); // (req, res, next)
        });
        
        it('deve permitir requisições dentro do limite', () => {
            const limiter = createRateLimiter({ max: 10, windowMs: 60000 });
            
            let nextCalled = false;
            const mockReq = { ip: '127.0.0.1', path: '/test' };
            const mockRes = {
                set: mock.fn(),
                status: mock.fn(() => mockRes),
                json: mock.fn()
            };
            
            limiter(mockReq, mockRes, () => { nextCalled = true; });
            
            assert.strictEqual(nextCalled, true);
        });
        
        it('deve bloquear após exceder limite', () => {
            const limiter = createRateLimiter({ max: 2, windowMs: 60000 });
            
            let blocked = false;
            const mockReq = { ip: '192.168.1.100', path: '/test' };
            const mockRes = {
                set: mock.fn(),
                status: mock.fn(() => mockRes),
                json: mock.fn(() => { blocked = true; })
            };
            
            // Primeiras 2 requisições devem passar
            for (let i = 0; i < 2; i++) {
                limiter(mockReq, mockRes, () => {});
            }
            
            // Terceira deve ser bloqueada
            limiter(mockReq, mockRes, () => {});
            
            assert.strictEqual(blocked, true);
        });
    });
});

// ========================================
// AUDIT LOG TESTS
// ========================================
describe('Audit Log', async () => {
    const { 
        AuditEntry, 
        log, 
        logAction, 
        AUDIT_CONFIG 
    } = await import('../src/middleware/audit.js');
    
    describe('AuditEntry', () => {
        it('deve criar entrada com todos os campos', () => {
            const entry = new AuditEntry({
                action: 'DELETE',
                entity: 'pedidos',
                entityId: '123',
                userId: 1,
                userEmail: 'admin@teste.com',
                ip: '192.168.1.1'
            });
            
            assert.strictEqual(entry.action, 'DELETE');
            assert.strictEqual(entry.entity, 'pedidos');
            assert.strictEqual(entry.entityId, '123');
            assert.strictEqual(entry.userId, 1);
            assert.ok(entry.id, 'Deve ter ID gerado');
            assert.ok(entry.timestamp, 'Deve ter timestamp');
        });
        
        it('deve gerar JSON válido', () => {
            const entry = new AuditEntry({
                action: 'UPDATE',
                entity: 'clientes',
                entityId: '456'
            });
            
            const json = entry.toJSON();
            
            assert.strictEqual(json.action, 'UPDATE');
            assert.strictEqual(json.entity, 'clientes');
            assert.ok(json.user, 'Deve ter objeto user');
            assert.ok(json.request, 'Deve ter objeto request');
            assert.ok(json.changes, 'Deve ter objeto changes');
            assert.ok(json.result, 'Deve ter objeto result');
        });
        
        it('deve serializar para string', () => {
            const entry = new AuditEntry({
                action: 'CREATE',
                entity: 'produtos'
            });
            
            const str = entry.toString();
            
            assert.strictEqual(typeof str, 'string');
            assert.ok(str.includes('CREATE'));
            assert.ok(str.includes('produtos'));
        });
        
        it('deve gerar IDs únicos', () => {
            const entries = [];
            for (let i = 0; i < 50; i++) {
                entries.push(new AuditEntry({ action: 'TEST' }));
            }
            
            const ids = new Set(entries.map(e => e.id));
            assert.strictEqual(ids.size, 50);
        });
    });
    
    describe('AUDIT_CONFIG', () => {
        it('deve ter configurações padrão', () => {
            assert.ok(AUDIT_CONFIG.logDir, 'Deve ter diretório de log');
            assert.ok(AUDIT_CONFIG.tableName, 'Deve ter nome da tabela');
            assert.ok(AUDIT_CONFIG.retentionDays, 'Deve ter dias de retenção');
        });
        
        it('deve ter ações críticas definidas', () => {
            assert.ok(AUDIT_CONFIG.criticalActions.includes('DELETE'));
            assert.ok(AUDIT_CONFIG.criticalActions.includes('UPDATE_PASSWORD'));
            assert.ok(AUDIT_CONFIG.criticalActions.includes('LOGIN_FAILED'));
        });
        
        it('deve ter entidades sensíveis definidas', () => {
            assert.ok(AUDIT_CONFIG.sensitiveEntities.includes('usuarios'));
            assert.ok(AUDIT_CONFIG.sensitiveEntities.includes('pedidos'));
            assert.ok(AUDIT_CONFIG.sensitiveEntities.includes('contas_pagar'));
        });
    });
    
    describe('log function', () => {
        it('deve criar log sem erros', async () => {
            // Não deve lançar exceção
            await assert.doesNotReject(async () => {
                await log({
                    action: 'TEST',
                    entity: 'test',
                    entityId: '1',
                    userId: 1
                });
            });
        });
    });
    
    describe('logAction helper', () => {
        it('deve logar ações customizadas', async () => {
            await assert.doesNotReject(async () => {
                await logAction('CUSTOM_ACTION', {
                    entity: 'custom',
                    entityId: '999',
                    metadata: { custom: 'data' }
                });
            });
        });
    });
});

// ========================================
// INTEGRATION TESTS
// ========================================
describe('Security Middleware Integration', () => {
    describe('Middleware chain', () => {
        it('middlewares devem ser funções', async () => {
            const { csrfProtection } = await import('../src/middleware/csrf.js');
            const { smartRateLimiter } = await import('../src/middleware/rate-limit.js');
            const { auditWriteMiddleware } = await import('../src/middleware/audit.js');
            
            assert.strictEqual(typeof csrfProtection, 'function');
            assert.strictEqual(typeof smartRateLimiter, 'function');
            assert.strictEqual(typeof auditWriteMiddleware, 'function');
        });
        
        it('middlewares devem retornar funções', async () => {
            const { csrfProtection } = await import('../src/middleware/csrf.js');
            const { smartRateLimiter } = await import('../src/middleware/rate-limit.js');
            const { auditWriteMiddleware } = await import('../src/middleware/audit.js');
            
            const csrf = csrfProtection();
            const rate = smartRateLimiter();
            const audit = auditWriteMiddleware();
            
            assert.strictEqual(typeof csrf, 'function');
            assert.strictEqual(typeof rate, 'function');
            assert.strictEqual(typeof audit, 'function');
        });
    });
    
    describe('Request simulation', () => {
        it('deve processar requisição GET através de todos middlewares', async () => {
            const { csrfProtection } = await import('../src/middleware/csrf.js');
            const { smartRateLimiter } = await import('../src/middleware/rate-limit.js');
            
            const mockReq = {
                method: 'GET',
                path: '/api/test',
                ip: '127.0.0.1',
                headers: {},
                cookies: {}
            };
            
            const mockRes = {
                set: mock.fn(),
                cookie: mock.fn(),
                status: mock.fn(() => mockRes),
                json: mock.fn()
            };
            
            let passedCSRF = false;
            let passedRate = false;
            
            const csrf = csrfProtection();
            const rate = smartRateLimiter();
            
            csrf(mockReq, mockRes, () => { passedCSRF = true; });
            rate(mockReq, mockRes, () => { passedRate = true; });
            
            assert.strictEqual(passedCSRF, true, 'Deve passar CSRF para GET');
            assert.strictEqual(passedRate, true, 'Deve passar Rate Limit');
        });
    });
});

console.log('🧪 Executando testes de segurança...');
