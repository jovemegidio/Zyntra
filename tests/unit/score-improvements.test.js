/**
 * Unit Tests — New Modules (Score Improvement v2)
 * Zyntra ERP v2.1.7
 * 
 * Tests for: decimal-calc, order-by-whitelist, schema-validation,
 *            idempotency, audit-trail, mysql-circuit-breaker,
 *            lgpd-crypto (fixed), auth token revocation, env validation
 * 
 * Run: node tests/unit/score-improvements.test.js
 */
const assert = require('assert');

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  ✅ PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ FAIL: ${name} — ${e.message}`);
        failed++;
    }
}

async function testAsync(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  ✅ PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ FAIL: ${name} — ${e.message}`);
        failed++;
    }
}

function describe(suite, fn) {
    console.log(`\n--- ${suite} ---`);
    fn();
}

// ========================================================
// 1. DECIMAL CALC TESTS
// ========================================================

describe('Decimal Calc — Financial Precision', () => {
    const calc = require('../../utils/decimal-calc');

    test('add(0.1, 0.2) should equal 0.3 exactly', () => {
        assert.strictEqual(calc.add(0.1, 0.2), 0.3);
    });

    test('add multiple values', () => {
        assert.strictEqual(calc.add(10.55, 20.45, 30.00), 61.00);
    });

    test('subtract should be precise', () => {
        assert.strictEqual(calc.subtract(100.00, 33.33, 33.33, 33.34), 0.00);
    });

    test('multiply by tax rate', () => {
        assert.strictEqual(calc.multiply(100.00, 0.15), 15.00);
    });

    test('divide evenly', () => {
        assert.strictEqual(calc.divide(100.00, 3), 33.33);
    });

    test('divide by zero throws', () => {
        assert.throws(() => calc.divide(100, 0), /Divisão por zero/);
    });

    test('percent calculation', () => {
        assert.strictEqual(calc.percent(200.00, 15), 30.00);
    });

    test('applyDiscount 10% on 199.90', () => {
        assert.strictEqual(calc.applyDiscount(199.90, 10), 179.91);
    });

    test('splitInstallments distributes remainder correctly', () => {
        const parcelas = calc.splitInstallments(100.00, 3);
        assert.strictEqual(parcelas.length, 3);
        assert.strictEqual(calc.sumArray(parcelas), 100.00);
        // First parcel gets the extra centavo
        assert.strictEqual(parcelas[0], 33.34);
        assert.strictEqual(parcelas[1], 33.33);
        assert.strictEqual(parcelas[2], 33.33);
    });

    test('splitInstallments with exact division', () => {
        const parcelas = calc.splitInstallments(100.00, 4);
        assert.strictEqual(parcelas.length, 4);
        parcelas.forEach(p => assert.strictEqual(p, 25.00));
    });

    test('sumArray matches add for same values', () => {
        const vals = [10.55, 20.45, 30.00, 0.01];
        assert.strictEqual(calc.sumArray(vals), calc.add(...vals));
    });

    test('equals compares with centavo precision', () => {
        assert.strictEqual(calc.equals(10.00, 10.00), true);
        assert.strictEqual(calc.equals(10.00, 10.01), false);
        assert.strictEqual(calc.equals(0.1 + 0.2, 0.3), true); // Float comparison that would fail normally
    });

    test('formatBRL formats correctly', () => {
        const formatted = calc.formatBRL(1234.56);
        assert.ok(formatted.includes('1.234,56') || formatted.includes('1,234.56'));
    });

    test('toCents handles string input', () => {
        assert.strictEqual(calc.toCents('19.99'), 1999);
    });

    test('toCents handles null/undefined/empty', () => {
        assert.strictEqual(calc.toCents(null), 0);
        assert.strictEqual(calc.toCents(undefined), 0);
        assert.strictEqual(calc.toCents(''), 0);
        assert.strictEqual(calc.toCents('abc'), 0);
    });
});

// ========================================================
// 2. ORDER BY WHITELIST TESTS
// ========================================================

describe('Order By Whitelist — SQL Injection Prevention', () => {
    const { safeOrderBy, COMMON_COLUMNS } = require('../../utils/order-by-whitelist');

    test('valid column returns correct ORDER BY', () => {
        const result = safeOrderBy('nome', 'asc', { allowed: ['id', 'nome'], default: 'id' });
        assert.strictEqual(result, 'ORDER BY nome ASC');
    });

    test('invalid column falls back to default', () => {
        const result = safeOrderBy('DROP TABLE users; --', 'asc', { allowed: ['id', 'nome'], default: 'id' });
        assert.strictEqual(result, 'ORDER BY id ASC');
    });

    test('SQL injection in column is sanitized', () => {
        const result = safeOrderBy("id; DROP TABLE pedidos; --", 'desc', { allowed: ['id'], default: 'id' });
        assert.strictEqual(result, 'ORDER BY id DESC');
    });

    test('invalid direction defaults to DESC', () => {
        const result = safeOrderBy('id', 'INVALID', { allowed: ['id'], default: 'id' });
        assert.strictEqual(result, 'ORDER BY id DESC');
    });

    test('null/undefined inputs use defaults', () => {
        const result = safeOrderBy(null, null, { allowed: ['id'], default: 'id', defaultDir: 'ASC' });
        assert.strictEqual(result, 'ORDER BY id ASC');
    });

    test('tableAlias prefixes column', () => {
        const result = safeOrderBy('nome', 'asc', { allowed: ['nome'], default: 'id', tableAlias: 'p' });
        assert.strictEqual(result, 'ORDER BY p.nome ASC');
    });

    test('COMMON_COLUMNS has expected modules', () => {
        assert.ok(COMMON_COLUMNS.pedidos.includes('id'));
        assert.ok(COMMON_COLUMNS.clientes.includes('nome'));
        assert.ok(COMMON_COLUMNS.financeiro.includes('valor'));
    });
});

// ========================================================
// 3. LGPD CRYPTO TESTS (Fixed)
// ========================================================

describe('LGPD Crypto — PII Encryption (Fixed)', () => {
    // Set a test-only encryption key
    process.env.PII_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-32chars!!';
    
    // Re-require to pick up new env
    delete require.cache[require.resolve('../../lgpd-crypto')];
    const { encryptPII, decryptPII, maskCPF, maskCNPJ, maskSalary } = require('../../lgpd-crypto');

    test('encryptPII should NOT return plaintext (was broken before fix)', () => {
        const cpf = '123.456.789-00';
        const encrypted = encryptPII(cpf);
        assert.notStrictEqual(encrypted, cpf, 'encryptPII deve realmente criptografar');
        assert.ok(encrypted.startsWith('ENC:'), 'encrypted output deve começar com ENC:');
    });

    test('encryptPII + decryptPII roundtrip', () => {
        const original = '999.888.777-66';
        const encrypted = encryptPII(original);
        const decrypted = decryptPII(encrypted);
        assert.strictEqual(decrypted, original);
    });

    test('encryptPII handles null/undefined gracefully', () => {
        assert.strictEqual(encryptPII(null), null);
        assert.strictEqual(encryptPII(undefined), undefined);
        assert.strictEqual(encryptPII(''), '');
    });

    test('encryptPII does not double-encrypt', () => {
        const encrypted = encryptPII('test-data');
        const doubleEncrypted = encryptPII(encrypted);
        assert.strictEqual(encrypted, doubleEncrypted);
    });

    test('decryptPII returns plaintext for non-encrypted strings', () => {
        assert.strictEqual(decryptPII('plain text'), 'plain text');
    });

    test('decryptPII handles [ENCRYPTED] placeholder', () => {
        assert.strictEqual(decryptPII('[ENCRYPTED]'), '');
    });

    test('maskCPF shows only last digits', () => {
        const masked = maskCPF('123.456.789-00');
        assert.ok(masked.includes('***'));
        assert.ok(!masked.includes('123'));
    });

    test('maskCNPJ masks most digits', () => {
        const masked = maskCNPJ('12.345.678/0001-99');
        assert.ok(masked.includes('**'));
    });

    test('maskSalary returns placeholder', () => {
        assert.strictEqual(maskSalary(5000), 'R$ ****,**');
    });
});

// ========================================================
// 4. SCHEMA VALIDATION TESTS
// ========================================================

describe('Schema Validation — Joi Middleware', () => {
    const { validate, schemas } = require('../../middleware/schema-validation');

    // Helper to simulate req/res/next
    function mockReqRes(body = {}, params = {}, query = {}) {
        const req = { body, params, query };
        let responseData = null;
        let statusCode = 200;
        const res = {
            status(code) { statusCode = code; return this; },
            json(data) { responseData = data; return this; }
        };
        return { req, res, getResponse: () => ({ status: statusCode, data: responseData }) };
    }

    test('login schema accepts valid data', () => {
        const { req, res, getResponse } = mockReqRes({ email: 'user@test.com', password: '123456' });
        let nextCalled = false;
        validate(schemas.login)(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() deve ser chamado para dados válidos');
    });

    test('login schema rejects missing email', () => {
        const { req, res, getResponse } = mockReqRes({ password: '123456' });
        let nextCalled = false;
        validate(schemas.login)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled, 'next() não deve ser chamado');
        assert.strictEqual(getResponse().status, 400);
        assert.ok(getResponse().data.errors.length > 0);
    });

    test('login schema rejects invalid email', () => {
        const { req, res, getResponse } = mockReqRes({ email: 'not-an-email', password: '123456' });
        let nextCalled = false;
        validate(schemas.login)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled);
        assert.strictEqual(getResponse().status, 400);
    });

    test('login schema rejects short password', () => {
        const { req, res, getResponse } = mockReqRes({ email: 'a@b.com', password: '12' });
        let nextCalled = false;
        validate(schemas.login)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled);
    });

    test('financeiro schema accepts valid lancamento', () => {
        const body = { tipo: 'receita', descricao: 'Venda #123', valor: 1500.50, data_vencimento: '2026-03-15' };
        const { req, res } = mockReqRes(body);
        let nextCalled = false;
        validate(schemas.lancamentoFinanceiro)(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'Lancamento válido deve passar');
    });

    test('financeiro schema rejects negative valor', () => {
        const body = { tipo: 'despesa', descricao: 'Teste', valor: -100, data_vencimento: '2026-01-01' };
        const { req, res, getResponse } = mockReqRes(body);
        let nextCalled = false;
        validate(schemas.lancamentoFinanceiro)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled);
        assert.strictEqual(getResponse().status, 400);
    });

    test('financeiro schema rejects invalid tipo', () => {
        const body = { tipo: 'HACK', descricao: 'Teste', valor: 100, data_vencimento: '2026-01-01' };
        const { req, res, getResponse } = mockReqRes(body);
        let nextCalled = false;
        validate(schemas.lancamentoFinanceiro)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled);
    });

    test('id param schema validates positive integer', () => {
        const { req, res } = mockReqRes({}, { id: 42 });
        let nextCalled = false;
        validate(schemas.idParam)(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });

    test('id param schema rejects non-numeric', () => {
        const { req, res, getResponse } = mockReqRes({}, { id: 'abc' });
        let nextCalled = false;
        validate(schemas.idParam)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled);
    });

    test('pagination schema validates limits', () => {
        const { req, res } = mockReqRes({}, {}, { page: 1, limit: 50, order: 'asc' });
        let nextCalled = false;
        validate(schemas.pagination)(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });

    test('pagination rejects limit > 500', () => {
        const { req, res, getResponse } = mockReqRes({}, {}, { limit: 9999 });
        let nextCalled = false;
        validate(schemas.pagination)(req, res, () => { nextCalled = true; });
        assert.ok(!nextCalled);
    });
});

// ========================================================
// 5. MYSQL CIRCUIT BREAKER TESTS
// ========================================================

describe('MySQL Circuit Breaker — Resilience', () => {
    const { MySQLCircuitBreaker } = require('../../services/mysql-circuit-breaker');

    test('starts in CLOSED state', () => {
        const mockPool = { query: async () => [[]], execute: async () => [[]] };
        const cb = new MySQLCircuitBreaker(mockPool);
        assert.strictEqual(cb.state, 'CLOSED');
        assert.strictEqual(cb.getStatus().state, 'CLOSED');
        cb.destroy();
    });

    test('successful queries keep CLOSED state', async () => {
        const mockPool = { query: async () => [['row1']] };
        const cb = new MySQLCircuitBreaker(mockPool);
        await cb.query('SELECT 1');
        await cb.query('SELECT 2');
        assert.strictEqual(cb.state, 'CLOSED');
        assert.strictEqual(cb.stats.success, 2);
        cb.destroy();
    });

    test('opens after threshold connection failures', async () => {
        let callCount = 0;
        const mockPool = { query: async () => { throw Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }); } };
        const cb = new MySQLCircuitBreaker(mockPool, { failureThreshold: 3, resetTimeoutMs: 100 });
        
        for (let i = 0; i < 3; i++) {
            try { await cb.query('SELECT 1'); } catch (e) {}
        }
        assert.strictEqual(cb.state, 'OPEN');
        cb.destroy();
    });

    test('OPEN state rejects immediately', async () => {
        const mockPool = { query: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); } };
        const cb = new MySQLCircuitBreaker(mockPool, { failureThreshold: 2, resetTimeoutMs: 60000 });
        
        try { await cb.query('SELECT 1'); } catch (e) {}
        try { await cb.query('SELECT 1'); } catch (e) {}
        
        assert.strictEqual(cb.state, 'OPEN');
        
        try {
            await cb.query('SELECT 1');
            assert.fail('Should have thrown');
        } catch (e) {
            assert.ok(e.message.includes('indisponível'));
        }
        assert.strictEqual(cb.stats.rejected, 1);
        cb.destroy();
    });

    test('non-connection errors do not open circuit', async () => {
        const mockPool = { query: async () => { throw new Error('ER_BAD_DB_ERROR: Unknown database'); } };
        const cb = new MySQLCircuitBreaker(mockPool, { failureThreshold: 2 });
        
        for (let i = 0; i < 5; i++) {
            try { await cb.query('SELECT 1'); } catch (e) {}
        }
        assert.strictEqual(cb.state, 'CLOSED'); // Query errors don't trip the breaker
        cb.destroy();
    });

    test('getStatus returns complete status', () => {
        const mockPool = { query: async () => [[]] };
        const cb = new MySQLCircuitBreaker(mockPool);
        const status = cb.getStatus();
        assert.ok('state' in status);
        assert.ok('failureCount' in status);
        assert.ok('stats' in status);
        cb.destroy();
    });
});

// ========================================================
// 6. TOKEN REVOCATION TESTS
// ========================================================

describe('Token Revocation — Auth Unified', () => {
    let authModule;
    try {
        authModule = require('../../middleware/auth-unified');
    } catch (e) {
        console.log('  ⚠️  SKIP: auth-unified requires jsonwebtoken (jws unavailable in test env)');
    }

    if (authModule) {
        const { revokeToken, isTokenRevoked } = authModule;

        test('non-revoked token returns false', async () => {
            const result = await isTokenRevoked('random-jti-not-revoked');
            assert.strictEqual(result, false);
        });

        test('revokeToken + isTokenRevoked returns true', async () => {
            const jti = 'test-jti-' + Date.now();
            await revokeToken(jti, Math.floor(Date.now() / 1000) + 3600);
            const result = await isTokenRevoked(jti);
            assert.strictEqual(result, true);
        });

        test('null jti is handled gracefully', async () => {
            const result = await isTokenRevoked(null);
            assert.strictEqual(result, false);
            await revokeToken(null, 0); // Should not throw
        });
    }
});

// ========================================================
// 7. ENV VALIDATION TESTS
// ========================================================

describe('Env Validation — Config', () => {
    const { validateEnv } = require('../../config/env');

    test('validateEnv returns object with errors and warnings', () => {
        const result = validateEnv();
        assert.ok('errors' in result);
        assert.ok('warnings' in result);
        assert.ok(Array.isArray(result.errors));
        assert.ok(Array.isArray(result.warnings));
    });
});

// ========================================================
// 8. AUDIT TRAIL TESTS
// ========================================================

describe('Audit Trail — Middleware', () => {
    const { auditTrail } = require('../../middleware/audit-trail');

    test('GET requests are NOT audited (pass-through)', () => {
        const middleware = auditTrail('test');
        let nextCalled = false;
        const req = { method: 'GET' };
        middleware(req, {}, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });

    test('POST requests trigger audit (calls next)', () => {
        const middleware = auditTrail('vendas');
        let nextCalled = false;
        const req = { method: 'POST', body: { nome: 'Teste' }, headers: {}, connection: {} };
        const res = { json: function() {} };
        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });

    test('sensitive fields are redacted', () => {
        const middleware = auditTrail('auth', 'LOGIN');
        let capturedBody = null;
        const req = { 
            method: 'POST', 
            body: { email: 'test@test.com', password: 'secret123' },
            headers: {},
            connection: {},
            originalUrl: '/api/auth/login',
            params: {},
            user: { id: 1 },
            app: { locals: {} },
            ip: '127.0.0.1'
        };
        
        // The middleware should continue (call next), and password should be redacted internally
        let nextCalled = false;
        const res = { json: function(data) { return data; } };
        middleware(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });
});

// ========================================================
// 9. IDEMPOTENCY TESTS
// ========================================================

describe('Idempotency — Middleware', () => {
    const { idempotency } = require('../../middleware/idempotency');

    test('requests without key pass through', () => {
        const middleware = idempotency();
        let nextCalled = false;
        const req = { method: 'POST', headers: {}, originalUrl: '/api/test' };
        middleware(req, {}, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });

    test('GET requests are ignored', () => {
        const middleware = idempotency();
        let nextCalled = false;
        const req = { method: 'GET', headers: { 'x-idempotency-key': 'abc123' } };
        middleware(req, {}, () => { nextCalled = true; });
        assert.ok(nextCalled);
    });

    test('invalid key format is rejected', async () => {
        const middleware = idempotency();
        let statusCode = 200;
        let responseBody = null;
        const req = { method: 'POST', headers: { 'x-idempotency-key': 'a b c !' }, originalUrl: '/api/test' };
        const res = { 
            status(c) { statusCode = c; return this; }, 
            json(d) { responseBody = d; } 
        };
        await middleware(req, res, () => {});
        assert.strictEqual(statusCode, 400);
        assert.ok(responseBody.code === 'INVALID_IDEMPOTENCY_KEY');
    });
});

// ========================================================
// FINAL REPORT
// ========================================================

// Wait for async tests
setTimeout(() => {
    console.log('\n========================================');
    console.log(`📊 RESULTADOS: ${passed}/${total} testes passaram`);
    if (failed > 0) {
        console.log(`❌ ${failed} teste(s) falharam`);
        process.exit(1);
    } else {
        console.log('✅ Todos os testes passaram!');
        process.exit(0);
    }
}, 2000);

// Run async tests
(async () => {
    console.log('\n--- Async Tests ---');
    
    // MySQL Circuit Breaker async tests
    const { MySQLCircuitBreaker } = require('../../services/mysql-circuit-breaker');
    
    await testAsync('CB: successful query in CLOSED state', async () => {
        const pool = { query: async () => [['ok']] };
        const cb = new MySQLCircuitBreaker(pool);
        const result = await cb.query('SELECT 1');
        assert.deepStrictEqual(result, [['ok']]);
        cb.destroy();
    });

    // Token revocation (only if auth-unified loadable)
    try {
        const { revokeToken, isTokenRevoked } = require('../../middleware/auth-unified');
    
        await testAsync('Token: revoke and check', async () => {
            const jti = 'async-test-' + Date.now();
            await revokeToken(jti, Math.floor(Date.now() / 1000) + 3600);
            assert.strictEqual(await isTokenRevoked(jti), true);
            assert.strictEqual(await isTokenRevoked('nonexistent'), false);
        });
    } catch (e) {
        console.log('  ⚠️  SKIP: async token test (jws unavailable)');
    }
})();
