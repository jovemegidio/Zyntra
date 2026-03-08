/**
 * ZYNTRA ERP — Unit Tests: Circuit Breaker
 * Tests the CircuitBreaker from services/resilience.js
 * 
 * Run: npx mocha tests/unit/circuit-breaker.test.js --timeout 10000
 */

const assert = require('assert');
const { CircuitBreaker } = require('../../services/resilience');

describe('CircuitBreaker', () => {
    it('should start in CLOSED state', () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 1000 });
        assert.strictEqual(cb.getState().state, 'CLOSED');
    });

    it('should execute function successfully in CLOSED state', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 1000 });
        const result = await cb.execute(() => Promise.resolve('ok'));
        assert.strictEqual(result, 'ok');
    });

    it('should open after reaching failure threshold', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 1000 });

        // First failure
        try { await cb.execute(() => { throw new Error('fail1'); }); } catch {}
        assert.strictEqual(cb.getState().state, 'CLOSED');

        // Second failure — should open
        try { await cb.execute(() => { throw new Error('fail2'); }); } catch {}
        assert.strictEqual(cb.getState().state, 'OPEN');
    });

    it('should reject requests when OPEN', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

        try { await cb.execute(() => { throw new Error('fail'); }); } catch {}
        assert.strictEqual(cb.getState().state, 'OPEN');

        try {
            await cb.execute(() => Promise.resolve('should-not-run'));
            assert.fail('Should have thrown');
        } catch (err) {
            assert.ok(err.message.includes('Circuit breaker OPEN'));
        }
    });

    it('should transition to HALF_OPEN after resetTimeout', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });

        try { await cb.execute(() => { throw new Error('fail'); }); } catch {}
        assert.strictEqual(cb.getState().state, 'OPEN');

        await new Promise(r => setTimeout(r, 150));

        // Next call should be allowed (HALF_OPEN)
        const result = await cb.execute(() => Promise.resolve('recovered'));
        assert.strictEqual(result, 'recovered');
    });

    it('should reset failure count on success', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });

        try { await cb.execute(() => { throw new Error('fail1'); }); } catch {}
        // success resets counter
        await cb.execute(() => Promise.resolve('ok'));
        try { await cb.execute(() => { throw new Error('fail2'); }); } catch {}

        // Should still be CLOSED because counter was reset
        assert.strictEqual(cb.getState().state, 'CLOSED');
    });
});

describe('external-breakers', () => {
    it('should export all breaker instances', () => {
        const breakers = require('../../services/external-breakers');
        assert.ok(breakers.smtpBreaker);
        assert.ok(breakers.discordBreaker);
        assert.ok(breakers.n8nBreaker);
        assert.ok(breakers.sefazBreaker);
        assert.ok(typeof breakers.getAllBreakerStates === 'function');
    });

    it('getAllBreakerStates should return states for all breakers', () => {
        const { getAllBreakerStates } = require('../../services/external-breakers');
        const states = getAllBreakerStates();
        assert.ok(states.smtp);
        assert.ok(states.discord);
        assert.ok(states.n8n);
        assert.ok(states.sefaz);
    });
});
