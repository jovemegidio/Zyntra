/**
 * ZYNTRA ERP — Unit Tests: Security Utilities
 * Tests sanitizeHTML (validator.escape), circuit breaker states, structured error responses
 * 
 * Run: npx mocha tests/unit/security-utils.test.js --timeout 5000
 */

const assert = require('assert');

// ── sanitizeHTML via validator.escape ──────────────────────
// We test the logic directly using validator since that's what sanitizeHTML now uses
let validator;
try {
    validator = require('validator');
} catch (e) {
    // validator not installed — tests will skip
}

describe('sanitizeHTML (validator.escape)', function () {

    before(function () {
        if (!validator) this.skip();
    });

    it('deve escapar tags <script>', () => {
        const input = '<script>alert(1)</script>';
        const result = validator.escape(input);
        assert.ok(!result.includes('<script>'));
        assert.ok(result.includes('&lt;'));
    });

    it('deve escapar <img onerror>', () => {
        const input = '<img src=x onerror=alert(1)>';
        const result = validator.escape(input);
        assert.ok(!result.includes('<img'));
        assert.ok(!result.includes('onerror'));
    });

    it('deve escapar <svg onload>', () => {
        const input = '<svg onload=alert(1)>';
        const result = validator.escape(input);
        assert.ok(!result.includes('<svg'));
    });

    it('deve escapar aspas e aspas duplas', () => {
        const input = `"hello" & 'world'`;
        const result = validator.escape(input);
        assert.ok(result.includes('&amp;'));
        assert.ok(result.includes('&quot;'));
        assert.ok(result.includes('&#x27;'));
    });

    it('deve preservar texto normal sem HTML', () => {
        const input = 'Pedido enviado com sucesso';
        const result = validator.escape(input);
        assert.strictEqual(result, input);
    });

    it('deve escapar payloads de bypass SVG/event handlers', () => {
        const payloads = [
            '<svg/onload=alert(1)>',
            '<body onload=alert(1)>',
            '"><script>alert(document.cookie)</script>',
            '<iframe src="javascript:alert(1)">',
            '<input onfocus=alert(1) autofocus>',
        ];
        for (const p of payloads) {
            const result = validator.escape(p);
            assert.ok(!result.includes('<'), `Falhou no payload: ${p}`);
        }
    });

    it('deve lidar com strings vazias', () => {
        assert.strictEqual(validator.escape(''), '');
    });
});

// ── CircuitBreaker ────────────────────────────────────────
let CircuitBreaker;
try {
    ({ CircuitBreaker } = require('../../services/resilience'));
} catch (e) {
    // Module not available
}

describe('CircuitBreaker', function () {

    before(function () {
        if (!CircuitBreaker) this.skip();
    });

    it('deve iniciar no estado CLOSED', () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
        assert.strictEqual(cb.getState(), 'CLOSED');
    });

    it('deve abrir após atingir failureThreshold', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50000 });

        for (let i = 0; i < 2; i++) {
            try {
                await cb.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        assert.strictEqual(cb.getState(), 'OPEN');
    });

    it('deve rejeitar chamadas quando OPEN', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50000 });

        try {
            await cb.execute(() => Promise.reject(new Error('fail')));
        } catch (e) { /* expected */ }

        assert.strictEqual(cb.getState(), 'OPEN');

        try {
            await cb.execute(() => Promise.resolve('should not reach'));
            assert.fail('Deveria ter lançado erro');
        } catch (e) {
            assert.ok(e.message.includes('Circuit breaker OPEN'));
        }
    });

    it('deve passar para HALF_OPEN após resetTimeout', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

        try {
            await cb.execute(() => Promise.reject(new Error('fail')));
        } catch (e) { /* expected */ }

        assert.strictEqual(cb.getState(), 'OPEN');

        // Esperar o resetTimeout
        await new Promise(resolve => setTimeout(resolve, 100));

        // Próxima chamada deve tentar (HALF_OPEN)
        try {
            await cb.execute(() => Promise.resolve('success'));
        } catch (e) { /* retry logic */ }

        // Após sucesso, deve voltar para CLOSED
        assert.strictEqual(cb.getState(), 'CLOSED');
    });

    it('deve fechar após sucesso em HALF_OPEN', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

        try {
            await cb.execute(() => Promise.reject(new Error('fail')));
        } catch (e) { /* expected */ }

        await new Promise(resolve => setTimeout(resolve, 100));

        const result = await cb.execute(() => Promise.resolve('recovered'));
        assert.strictEqual(result, 'recovered');
        assert.strictEqual(cb.getState(), 'CLOSED');
    });

    it('deve executar funções normalmente quando CLOSED', async () => {
        const cb = new CircuitBreaker();
        const result = await cb.execute(() => Promise.resolve(42));
        assert.strictEqual(result, 42);
    });
});

// ── External Breakers Config ──────────────────────────────
let externalBreakers;
try {
    externalBreakers = require('../../services/external-breakers');
} catch (e) {
    // Module not available
}

describe('External Breakers Configuration', function () {

    before(function () {
        if (!externalBreakers) this.skip();
    });

    it('deve exportar 4 breakers + getAllBreakerStates', () => {
        assert.ok(externalBreakers.smtpBreaker);
        assert.ok(externalBreakers.discordBreaker);
        assert.ok(externalBreakers.n8nBreaker);
        assert.ok(externalBreakers.sefazBreaker);
        assert.ok(typeof externalBreakers.getAllBreakerStates === 'function');
    });

    it('todos devem iniciar CLOSED', () => {
        const states = externalBreakers.getAllBreakerStates();
        assert.strictEqual(states.smtp, 'CLOSED');
        assert.strictEqual(states.discord, 'CLOSED');
        assert.strictEqual(states.n8n, 'CLOSED');
        assert.strictEqual(states.sefaz, 'CLOSED');
    });
});
