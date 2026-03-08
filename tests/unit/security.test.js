/**
 * Unit tests for security utilities and middleware patterns
 */
const assert = require('assert');

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL: ${name} — ${e.message}`);
    }
}

console.log('--- Security & Middleware Tests ---');

// Test password-validator edge cases
const { validatePasswordStrength } = require('../../utils/password-validator');

test('password with only spaces rejected', () => {
    const r = validatePasswordStrength('          ');
    assert.strictEqual(r.valid, false);
});

test('password with unicode chars accepted if strong', () => {
    const r = validatePasswordStrength('Str0ng!Pássw€rd');
    assert.strictEqual(r.valid, true);
});

test('password exactly 10 chars at boundary', () => {
    const r = validatePasswordStrength('Abc1!efghi');
    assert.strictEqual(r.valid, true);
});

test('password 9 chars rejected', () => {
    const r = validatePasswordStrength('Abc1!efgh');
    assert.strictEqual(r.valid, false);
});

test('validatePasswordStrength returns errors array', () => {
    const r = validatePasswordStrength('weak');
    assert.ok(Array.isArray(r.errors));
    assert.ok(r.errors.length > 0);
});

test('strong password returns empty errors', () => {
    const r = validatePasswordStrength('My$ecure2026!');
    assert.ok(Array.isArray(r.errors));
    assert.strictEqual(r.errors.length, 0);
});

// Test circuit breaker state machine
const { CircuitBreaker } = require('../../services/resilience');

test('circuit breaker respects custom threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 1000 });
    assert.strictEqual(cb.getState().state, 'CLOSED');
    assert.strictEqual(cb.getState().failureCount, 0);
});

test('circuit breaker failure count increments', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 5000 });
    try { await cb.execute(() => { throw new Error('f1'); }); } catch {}
    assert.strictEqual(cb.getState().failureCount, 1);
    assert.strictEqual(cb.getState().state, 'CLOSED'); // Still closed
    try { await cb.execute(() => { throw new Error('f2'); }); } catch {}
    assert.strictEqual(cb.getState().failureCount, 2);
    assert.strictEqual(cb.getState().state, 'CLOSED'); // Still closed
    try { await cb.execute(() => { throw new Error('f3'); }); } catch {}
    assert.strictEqual(cb.getState().state, 'OPEN'); // Now open
});

test('circuit breaker resets on success', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 5000 });
    try { await cb.execute(() => { throw new Error('f1'); }); } catch {}
    assert.strictEqual(cb.getState().failureCount, 1);
    await cb.execute(() => Promise.resolve('ok'));
    assert.strictEqual(cb.getState().failureCount, 0); // Reset
});

// Test external-breakers module
test('all 4 breakers exist and are CircuitBreaker instances', () => {
    const breakers = require('../../services/external-breakers');
    assert.ok(breakers.smtpBreaker);
    assert.ok(breakers.discordBreaker);
    assert.ok(breakers.n8nBreaker);
    assert.ok(breakers.sefazBreaker);
    // Each should have execute method
    assert.strictEqual(typeof breakers.smtpBreaker.execute, 'function');
    assert.strictEqual(typeof breakers.discordBreaker.execute, 'function');
    assert.strictEqual(typeof breakers.n8nBreaker.execute, 'function');
    assert.strictEqual(typeof breakers.sefazBreaker.execute, 'function');
});

test('getAllBreakerStates returns all 4 statuses', () => {
    const { getAllBreakerStates } = require('../../services/external-breakers');
    const states = getAllBreakerStates();
    assert.ok(states.smtp);
    assert.ok(states.discord);
    assert.ok(states.n8n);
    assert.ok(states.sefaz);
    // Each status should have state property
    assert.ok(['CLOSED', 'OPEN', 'HALF_OPEN'].includes(states.smtp.state));
});

console.log(`\n${passed}/${total} security & middleware tests passed\n`);
if (passed < total) process.exit(1);
