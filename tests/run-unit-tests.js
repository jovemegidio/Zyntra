// Quick test runner for password-validator
const { validatePasswordStrength } = require('../utils/password-validator');

const tests = [
    { n: 'empty', p: '', v: false },
    { n: 'null', p: null, v: false },
    { n: 'short', p: 'Ab1!short', v: false },
    { n: 'no-upper', p: 'abcdefgh1!@#', v: false },
    { n: 'no-lower', p: 'ABCDEFGH1!@#', v: false },
    { n: 'no-number', p: 'Abcdefgh!@#&', v: false },
    { n: 'no-special', p: 'Abcdefgh1234', v: false },
    { n: 'common-pw', p: 'Password123!', v: false },
    { n: 'aluforce', p: 'Aluforce1!xx', v: false },
    { n: 'strong', p: 'Str0ng!Pass#99', v: true },
    { n: 'strong2', p: 'My$ecure2026!', v: true },
];

let pass = 0, fail = 0;
tests.forEach(t => {
    const r = validatePasswordStrength(t.p);
    if (r.valid === t.v) {
        pass++;
        console.log('  PASS:', t.n);
    } else {
        fail++;
        console.log('  FAIL:', t.n, 'expected', t.v, 'got', r.valid, r.errors);
    }
});

console.log('\n' + pass + '/' + tests.length + ' passed');
if (fail > 0) process.exit(1);

// Circuit breaker test
const { CircuitBreaker } = require('../services/resilience');

async function testCircuitBreaker() {
    console.log('\n--- Circuit Breaker Tests ---');
    let p2 = 0, f2 = 0;

    // Test 1: starts CLOSED
    const cb1 = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 1000 });
    if (cb1.getState().state === 'CLOSED') { p2++; console.log('  PASS: starts CLOSED'); }
    else { f2++; console.log('  FAIL: starts CLOSED'); }

    // Test 2: executes fn
    const r = await cb1.execute(() => Promise.resolve('ok'));
    if (r === 'ok') { p2++; console.log('  PASS: executes fn'); }
    else { f2++; console.log('  FAIL: executes fn'); }

    // Test 3: opens after threshold
    const cb2 = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 1000 });
    try { await cb2.execute(() => { throw new Error('f1'); }); } catch {}
    try { await cb2.execute(() => { throw new Error('f2'); }); } catch {}
    if (cb2.getState().state === 'OPEN') { p2++; console.log('  PASS: opens after threshold'); }
    else { f2++; console.log('  FAIL: opens after threshold, got', cb2.getState()); }

    // Test 4: rejects when OPEN
    try {
        await cb2.execute(() => Promise.resolve('shouldnt'));
        f2++; console.log('  FAIL: should reject when OPEN');
    } catch (e) {
        if (e.message.includes('OPEN')) { p2++; console.log('  PASS: rejects when OPEN'); }
        else { f2++; console.log('  FAIL: wrong error msg'); }
    }

    // Test 5: external-breakers exports
    const breakers = require('../services/external-breakers');
    if (breakers.smtpBreaker && breakers.discordBreaker && breakers.n8nBreaker && breakers.sefazBreaker) {
        p2++; console.log('  PASS: external-breakers exports');
    } else {
        f2++; console.log('  FAIL: external-breakers exports');
    }

    // Test 6: getAllBreakerStates
    const states = breakers.getAllBreakerStates();
    if (states.smtp && states.discord && states.n8n && states.sefaz) {
        p2++; console.log('  PASS: getAllBreakerStates');
    } else {
        f2++; console.log('  FAIL: getAllBreakerStates');
    }

    console.log('\n' + p2 + '/6 circuit breaker tests passed');
    if (f2 > 0) process.exit(1);

    // Repository tests (unit)
    require('./unit/repository.test.js');

    // Repository integration tests (async)
    const runIntegration = require('./unit/repository-integration.test.js');
    await runIntegration();

    // Security & middleware tests
    require('./unit/security.test.js');
}

testCircuitBreaker().catch(e => { console.error(e); process.exit(1); });
