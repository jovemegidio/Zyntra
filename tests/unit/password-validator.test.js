/**
 * ZYNTRA ERP — Unit Tests: Password Validator
 * Tests password strength policy enforcement
 * 
 * Run: npx mocha tests/unit/password-validator.test.js --timeout 5000
 */

const assert = require('assert');
const { validatePasswordStrength } = require('../../utils/password-validator');

describe('validatePasswordStrength', () => {
    it('should reject empty password', () => {
        const result = validatePasswordStrength('');
        assert.strictEqual(result.valid, false);
    });

    it('should reject null password', () => {
        const result = validatePasswordStrength(null);
        assert.strictEqual(result.valid, false);
    });

    it('should reject password shorter than 10 characters', () => {
        const result = validatePasswordStrength('Ab1!short');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('10 caracteres')));
    });

    it('should reject password without uppercase', () => {
        const result = validatePasswordStrength('abcdefgh1!@#');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('maiúscula')));
    });

    it('should reject password without lowercase', () => {
        const result = validatePasswordStrength('ABCDEFGH1!@#');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('minúscula')));
    });

    it('should reject password without number', () => {
        const result = validatePasswordStrength('Abcdefgh!@#&');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('número')));
    });

    it('should reject password without special character', () => {
        const result = validatePasswordStrength('Abcdefgh1234');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('especial')));
    });

    it('should reject common passwords', () => {
        const result = validatePasswordStrength('Password123!');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('comuns')));
    });

    it('should reject password containing aluforce', () => {
        const result = validatePasswordStrength('Aluforce1!xx');
        assert.strictEqual(result.valid, false);
    });

    it('should accept strong password', () => {
        const result = validatePasswordStrength('Str0ng!Pass#99');
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);
    });

    it('should accept another strong password', () => {
        const result = validatePasswordStrength('My$ecure2026!');
        assert.strictEqual(result.valid, true);
    });

    it('should return multiple errors for very weak password', () => {
        const result = validatePasswordStrength('abc');
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.length >= 3);
    });
});
